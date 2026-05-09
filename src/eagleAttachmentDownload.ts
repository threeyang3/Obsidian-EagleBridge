import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { App, FileSystemAdapter, Modal, Notice, Setting, TFile } from 'obsidian';
import type MyPlugin from './main';
import {
	collectMarkdownLinkMatches,
	resolveEagleItem,
	allocateUniqueFileName,
	formatMarkdownDestination,
	sanitizeFileName,
	ATTACHMENT_DIR_NAME,
	type EagleMarkdownLinkMatch,
} from './exportMarkdown';
import { t } from './i18n';

const electron = require('electron');

interface DownloadTarget {
	itemId: string;
	sourceFilePath: string;
	fileName: string;
}

interface DownloadReplacement {
	startOffset: number;
	endOffset: number;
	originalText: string;
	replacementText: string;
}

interface DownloadFileResult {
	file: TFile;
	replacedCount: number;
	skippedCount: number;
}

interface DownloadStats {
	fileCount: number;
	downloadedCount: number;
	reusedCount: number;
	replacedCount: number;
	skippedCount: number;
}

export async function downloadCurrentFileEagleAttachments(plugin: MyPlugin): Promise<void> {
	const activeFile = plugin.app.workspace.getActiveFile();
	if (!(activeFile instanceof TFile) || activeFile.extension !== 'md') {
		new Notice(t('batch.noMarkdownFile'));
		return;
	}

	if (!(plugin.app.vault.adapter instanceof FileSystemAdapter)) {
		new Notice(t('batch.desktopOnly'));
		return;
	}

	const content = await plugin.app.vault.read(activeFile);
	const matches = collectMarkdownLinkMatches(content);
	if (matches.length === 0) {
		new Notice(t('download.noEagleLinks'));
		return;
	}

	const downloadDir = await promptDownloadDir(plugin, activeFile);
	if (!downloadDir) {
		return;
	}

	const result = await downloadAndReplaceForFile(plugin, activeFile, content, matches, downloadDir);
	if (result.replacedCount > 0) {
		new Notice(t('download.completed', {
			replaced: result.replacedCount,
			skipped: result.skippedCount,
		}), 10000);
	} else {
		new Notice(t('download.nothingReplaced'));
	}
}

export async function downloadVaultEagleAttachments(plugin: MyPlugin): Promise<void> {
	if (!(plugin.app.vault.adapter instanceof FileSystemAdapter)) {
		new Notice(t('batch.desktopOnly'));
		return;
	}

	const markdownFiles = plugin.app.vault.getMarkdownFiles();
	const filesWithLinks: Array<{ file: TFile; content: string; matches: EagleMarkdownLinkMatch[] }> = [];

	for (const file of markdownFiles) {
		const content = await plugin.app.vault.read(file);
		const matches = collectMarkdownLinkMatches(content);
		if (matches.length > 0) {
			filesWithLinks.push({ file, content, matches });
		}
	}

	if (filesWithLinks.length === 0) {
		new Notice(t('download.noEagleLinksVault'));
		return;
	}

	const totalLinks = filesWithLinks.reduce((sum, f) => sum + f.matches.length, 0);
	const downloadDir = await promptDownloadDir(plugin, null, filesWithLinks.length, totalLinks);
	if (!downloadDir) {
		return;
	}

	const stats: DownloadStats = {
		fileCount: 0,
		downloadedCount: 0,
		reusedCount: 0,
		replacedCount: 0,
		skippedCount: 0,
	};

	for (const { file, content, matches } of filesWithLinks) {
		try {
			const result = await downloadAndReplaceForFile(plugin, file, content, matches, downloadDir);
			if (result.replacedCount > 0 || result.skippedCount > 0) {
				stats.fileCount += 1;
				stats.replacedCount += result.replacedCount;
				stats.skippedCount += result.skippedCount;
			}
		} catch (error) {
			print(`Failed to process ${file.path}:`, error);
		}
	}

	new Notice(t('download.completedVault', {
		fileCount: stats.fileCount,
		replaced: stats.replacedCount,
		skipped: stats.skippedCount,
	}), 15000);
}

function print(...args: unknown[]): void {
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	try {
		const { print: debugPrint } = require('./main');
		debugPrint(...args);
	} catch {
		// ignore
	}
}

async function downloadAndReplaceForFile(
	plugin: MyPlugin,
	file: TFile,
	content: string,
	matches: EagleMarkdownLinkMatch[],
	downloadDir: string,
): Promise<DownloadFileResult> {
	if (!plugin.settings.libraryPath) {
		throw new Error('EAGLE_LIBRARY_PATH_NOT_SET');
	}

	const usedFileNames = new Set<string>();
	// Pre-populate with existing files in the target directory
	if (fs.existsSync(downloadDir)) {
		for (const entry of fs.readdirSync(downloadDir)) {
			usedFileNames.add(entry.toLowerCase());
		}
	}

	const replacements: DownloadReplacement[] = [];
	let downloadedCount = 0;
	let skippedCount = 0;

	for (const match of matches) {
		const resolved = await resolveEagleItem(match.itemId, plugin.settings.libraryPath);
		if (!resolved || resolved.externalUrl || !resolved.sourceFilePath) {
			skippedCount += 1;
			continue;
		}

		const targetFileName = allocateUniqueFileName(resolved.exportBaseName, usedFileNames);
		const targetPath = path.join(downloadDir, targetFileName);

		try {
			if (!fs.existsSync(targetPath)) {
				await fs.promises.copyFile(resolved.sourceFilePath, targetPath);
				downloadedCount += 1;
			}
		} catch {
			skippedCount += 1;
			continue;
		}

		const mdDir = path.dirname(file.path);
		let relativePath = path.relative(mdDir, path.join(downloadDir, targetFileName));
		relativePath = relativePath.split(path.sep).join('/');
		if (!relativePath.startsWith('.') && !relativePath.startsWith('/')) {
			relativePath = './' + relativePath;
		}

		const destination = formatMarkdownDestination(relativePath);
		const label = match.label.trim().length > 0 ? match.label : resolved.exportBaseName;
		const replacementText = `${match.prefix}[${escapeMarkdownLabel(label)}](${destination})`;

		replacements.push({
			startOffset: match.index,
			endOffset: match.index + match.length,
			originalText: match.fullMatch,
			replacementText,
		});
	}

	if (replacements.length > 0) {
		replacements.sort((a, b) => b.startOffset - a.startOffset);

		await plugin.app.vault.process(file, (currentContent) => {
			let nextContent = currentContent;
			for (const replacement of replacements) {
				const currentText = nextContent.slice(replacement.startOffset, replacement.endOffset);
				if (currentText !== replacement.originalText) {
					throw new Error('REPLACEMENT_MISMATCH');
				}
				nextContent =
					nextContent.slice(0, replacement.startOffset) +
					replacement.replacementText +
					nextContent.slice(replacement.endOffset);
			}
			return nextContent;
		});
	}

	return { file, replacedCount: replacements.length, skippedCount };
}

function escapeMarkdownLabel(label: string): string {
	return label
		.replace(/\\/g, '\\\\')
		.replace(/\]/g, '\\]')
		.replace(/\r?\n/g, ' ')
		.trim();
}

async function promptDownloadDir(
	plugin: MyPlugin,
	file: TFile | null,
	fileCount?: number,
	totalLinks?: number,
): Promise<string | null> {
	return new Promise<string | null>((resolve) => {
		const modal = new DownloadDirModal(plugin, file, fileCount, totalLinks, resolve);
		modal.open();
	});
}

function getDefaultDownloadDir(plugin: MyPlugin): string {
	if (plugin.settings.eagleDownloadDir) {
		return plugin.settings.eagleDownloadDir;
	}

	const adapter = plugin.app.vault.adapter;
	if (adapter instanceof FileSystemAdapter) {
		return path.join(adapter.getBasePath(), ATTACHMENT_DIR_NAME);
	}

	return '';
}

function getDialogBridge(): { dialog: { showOpenDialog: (...args: unknown[]) => Promise<{ canceled: boolean; filePaths: string[] }> }; ownerWindow?: unknown } | null {
	const directDialog = electron?.dialog;
	if (directDialog?.showOpenDialog) {
		return {
			dialog: directDialog,
			ownerWindow: electron.BrowserWindow?.getFocusedWindow?.(),
		};
	}

	const remoteDialog = electron?.remote?.dialog;
	if (remoteDialog?.showOpenDialog) {
		return {
			dialog: remoteDialog,
			ownerWindow: electron.remote.BrowserWindow?.getFocusedWindow?.(),
		};
	}

	try {
		const remoteModule = require('@electron/remote');
		if (remoteModule?.dialog?.showOpenDialog) {
			return {
				dialog: remoteModule.dialog,
				ownerWindow: remoteModule.getCurrentWindow?.(),
			};
		}
	} catch {
		return null;
	}

	return null;
}

class DownloadDirModal extends Modal {
	private readonly plugin: MyPlugin;
	private readonly file: TFile | null;
	private readonly fileCount: number | undefined;
	private readonly totalLinks: number | undefined;
	private readonly resolve: (value: string | null) => void;
	private downloadDir: string;
	private dirInputEl: HTMLInputElement | null = null;

	constructor(
		plugin: MyPlugin,
		file: TFile | null,
		fileCount: number | undefined,
		totalLinks: number | undefined,
		resolve: (value: string | null) => void,
	) {
		super(plugin.app);
		this.plugin = plugin;
		this.file = file;
		this.fileCount = fileCount;
		this.totalLinks = totalLinks;
		this.resolve = resolve;
		this.downloadDir = getDefaultDownloadDir(plugin);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: t('download.title') });

		if (this.file) {
			contentEl.createEl('p', {
				text: t('download.descCurrent', { file: this.file.path, count: this.totalLinks ?? 0 }),
			});
		} else {
			contentEl.createEl('p', {
				text: t('download.descVault', { fileCount: this.fileCount ?? 0, linkCount: this.totalLinks ?? 0 }),
			});
		}

		new Setting(contentEl)
			.setName(t('download.dir.name'))
			.setDesc(t('download.dir.desc'))
			.addText((text) => {
				text
					.setPlaceholder(t('download.dir.placeholder'))
					.setValue(this.downloadDir)
					.onChange((value) => {
						this.downloadDir = value.trim();
					});
				text.inputEl.style.width = '100%';
				this.dirInputEl = text.inputEl;
			})
			.addExtraButton((button) => {
				button
					.setIcon('folder-open')
					.setTooltip(getDialogBridge() ? t('download.dir.browse') : t('download.dir.browseUnavailable'))
					.setDisabled(!getDialogBridge())
					.onClick(() => {
						void this.browseDir();
					});
			});

		new Setting(contentEl)
			.addButton((button) => {
				button
					.setButtonText(t('download.start'))
					.setCta()
					.onClick(() => {
						this.close();
						this.resolve(this.downloadDir || null);
					});
			})
			.addButton((button) => {
				button
					.setButtonText(t('download.cancel'))
					.onClick(() => {
						this.close();
						this.resolve(null);
					});
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async browseDir(): Promise<void> {
		const dialogBridge = getDialogBridge();
		if (!dialogBridge) {
			new Notice(t('download.dir.browseUnavailable'));
			return;
		}

		const options: Record<string, unknown> = {
			properties: ['openDirectory', 'createDirectory'],
			title: t('download.dir.browseTitle'),
		};

		if (this.downloadDir && fs.existsSync(this.downloadDir)) {
			options.defaultPath = this.downloadDir;
		}

		const result = dialogBridge.ownerWindow
			? await dialogBridge.dialog.showOpenDialog(dialogBridge.ownerWindow, options)
			: await dialogBridge.dialog.showOpenDialog(options);

		if (result.canceled || result.filePaths.length === 0) {
			return;
		}

		this.downloadDir = result.filePaths[0];
		if (this.dirInputEl) {
			this.dirInputEl.value = this.downloadDir;
		}
	}
}
