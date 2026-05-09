import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
	App,
	FileSystemAdapter,
	Modal,
	Notice,
	Setting,
	TFile,
	type CachedMetadata,
	type Reference,
} from 'obsidian';
import type MyPlugin from './main';
import { isPathInsideDirectory } from './eaglePaths';
import { resolveFilePathToEagleLink, type ResolvedEagleLink } from './urlHandler';
import { t } from './i18n';

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

const NON_ATTACHMENT_EXTENSIONS = new Set(['md', 'canvas', 'base']);
const WIKILINK_REGEX = /^(!?)\[\[([\s\S]*?)\]\]$/;
const MARKDOWN_LINK_REGEX = /^(!?)\[([\s\S]*?)\]\(([\s\S]*?)\)$/;
const IMAGE_SIZE_REGEX = /^\d+(?:x\d+)?$/i;

interface ParsedOriginalReference {
	embed: boolean;
	label: string | null;
	imageSize: string | null;
}

interface AttachmentOccurrence {
	key: string;
	sourceFile: TFile;
	startOffset: number;
	endOffset: number;
	originalText: string;
	parsedReference: ParsedOriginalReference;
}

interface AttachmentTargetPlan {
	sourceFile: TFile;
	absolutePath: string;
	occurrences: AttachmentOccurrence[];
	otherMarkdownReferences: TFile[];
	otherCanvasReferences: TFile[];
	remainingCurrentReferences: number;
	sourceAlreadyInEagleLibrary: boolean;
}

interface AttachmentBatchPlan {
	file: TFile;
	originalContent: string;
	targets: AttachmentTargetPlan[];
}

interface DeletionSkipInfo {
	sourceFile: TFile;
	otherMarkdownReferences: TFile[];
	otherCanvasReferences: TFile[];
	remainingCurrentReferences: number;
	sourceAlreadyInEagleLibrary: boolean;
	deletionError: string | null;
}

interface ReplacementOperation {
	startOffset: number;
	endOffset: number;
	originalText: string;
	replacementText: string;
}

interface UploadExecutionStats {
	uploadedCount: number;
	reusedCount: number;
	replacedCount: number;
	deletedCount: number;
	skippedDeletionCount: number;
	retainedByReferenceCount: number;
}

export async function uploadCurrentMarkdownAttachmentsToEagle(plugin: MyPlugin): Promise<void> {
	const activeFile = plugin.app.workspace.getActiveFile();
	if (!(activeFile instanceof TFile) || activeFile.extension !== 'md') {
		new Notice(t('batch.noMarkdownFile'));
		return;
	}

	if (!(plugin.app.vault.adapter instanceof FileSystemAdapter)) {
		new Notice(t('batch.desktopOnly'));
		return;
	}

	let plan: AttachmentBatchPlan;
	try {
		plan = await buildAttachmentBatchPlan(plugin.app, activeFile, plugin.settings.libraryPath);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message === 'FILE_CACHE_UNAVAILABLE') {
			new Notice(t('batch.cacheNotReady'));
			return;
		}

		if (message === 'FILESYSTEM_ADAPTER_REQUIRED') {
			new Notice(t('batch.desktopOnly'));
			return;
		}

		new Notice(t('batch.analyzeFailed', { message }), 10000);
		return;
	}

	if (plan.targets.length === 0) {
		new Notice(t('batch.noLocalAttachments'));
		return;
	}

	const resolvedLinks = new Map<string, ResolvedEagleLink>();
	const uploadStats = {
		uploadedCount: 0,
		reusedCount: 0,
	};

	try {
		for (const target of plan.targets) {
			const resolvedLink = await resolveFilePathToEagleLink(target.absolutePath, plugin);
			resolvedLinks.set(target.sourceFile.path, resolvedLink);
			if (target.sourceAlreadyInEagleLibrary) {
				uploadStats.reusedCount += 1;
			} else {
				uploadStats.uploadedCount += 1;
			}
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		new Notice(t('batch.uploadFailed', { message }), 10000);
		return;
	}

	const replacements = buildReplacementOperations(plan, resolvedLinks);
	if (replacements.length === 0) {
		new Notice(t('batch.noEagleLinks'));
		return;
	}

	try {
		await plugin.app.vault.process(activeFile, (currentContent) => {
			if (currentContent !== plan.originalContent) {
				throw new Error('SOURCE_FILE_CHANGED');
			}

			return applyReplacementOperations(currentContent, replacements);
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message === 'SOURCE_FILE_CHANGED') {
			new Notice(t('batch.sourceFileChanged'), 10000);
			return;
		}

		if (message === 'REPLACEMENT_MISMATCH') {
			new Notice(t('batch.replacementMismatch'), 10000);
			return;
		}

		new Notice(t('batch.writeFailed', { message }), 10000);
		return;
	}

	const deletionSkips: DeletionSkipInfo[] = [];
	let deletedCount = 0;
	for (const target of plan.targets) {
		if (!canDeleteOriginalAttachment(target)) {
			deletionSkips.push({
				sourceFile: target.sourceFile,
				otherMarkdownReferences: target.otherMarkdownReferences,
				otherCanvasReferences: target.otherCanvasReferences,
				remainingCurrentReferences: target.remainingCurrentReferences,
				sourceAlreadyInEagleLibrary: target.sourceAlreadyInEagleLibrary,
				deletionError: null,
			});
			continue;
		}

		try {
			await plugin.app.vault.trash(target.sourceFile, true);
			deletedCount += 1;
		} catch (error) {
			deletionSkips.push({
				sourceFile: target.sourceFile,
				otherMarkdownReferences: target.otherMarkdownReferences,
				otherCanvasReferences: target.otherCanvasReferences,
				remainingCurrentReferences: target.remainingCurrentReferences,
				sourceAlreadyInEagleLibrary: target.sourceAlreadyInEagleLibrary,
				deletionError: error instanceof Error ? error.message : String(error),
			});
		}
	}

	const stats: UploadExecutionStats = {
		uploadedCount: uploadStats.uploadedCount,
		reusedCount: uploadStats.reusedCount,
		replacedCount: replacements.length,
		deletedCount,
		skippedDeletionCount: deletionSkips.length,
		retainedByReferenceCount: deletionSkips.filter((skip) =>
			skip.otherMarkdownReferences.length > 0 || skip.otherCanvasReferences.length > 0,
		).length,
	};

	if (deletionSkips.length > 0) {
		new Notice(t('batch.deletionSkipped', { count: deletionSkips.length }), 12000);
		new AttachmentDeletionReportModal(plugin.app, buildDeletionReportText(activeFile, deletionSkips)).open();
	}

	new Notice(buildCompletionMessage(stats), 12000);
}

async function buildAttachmentBatchPlan(
	app: App,
	file: TFile,
	libraryPath: string,
): Promise<AttachmentBatchPlan> {
	const originalContent = await app.vault.read(file);
	const fileCache = app.metadataCache.getFileCache(file);
	if (!fileCache) {
		throw new Error('FILE_CACHE_UNAVAILABLE');
	}

	const occurrences = collectAttachmentOccurrences(app, file, fileCache, originalContent);
	const currentReferenceCounts = collectCurrentAttachmentReferenceCounts(app, file, fileCache);
	const canvasReferenceIndex = await buildCanvasAttachmentReferenceIndex(app);
	const adapter = app.vault.adapter;
	if (!(adapter instanceof FileSystemAdapter)) {
		throw new Error('FILESYSTEM_ADAPTER_REQUIRED');
	}

	const targetsByPath = new Map<string, AttachmentTargetPlan>();
	for (const occurrence of occurrences) {
		const existingTarget = targetsByPath.get(occurrence.sourceFile.path);
		if (existingTarget) {
			existingTarget.occurrences.push(occurrence);
			continue;
		}

		const absolutePath = path.join(adapter.getBasePath(), occurrence.sourceFile.path);
		if (!fs.existsSync(absolutePath)) {
			continue;
		}

		targetsByPath.set(occurrence.sourceFile.path, {
			sourceFile: occurrence.sourceFile,
			absolutePath,
			occurrences: [occurrence],
			otherMarkdownReferences: getOtherMarkdownReferences(app, file, occurrence.sourceFile),
			otherCanvasReferences: canvasReferenceIndex.get(occurrence.sourceFile.path) ?? [],
			remainingCurrentReferences: 0,
			sourceAlreadyInEagleLibrary: libraryPath
				? isPathInsideDirectory(absolutePath, libraryPath)
				: false,
		});
	}

	for (const target of targetsByPath.values()) {
		const totalCurrentReferences = currentReferenceCounts.get(target.sourceFile.path) ?? target.occurrences.length;
		target.remainingCurrentReferences = Math.max(0, totalCurrentReferences - target.occurrences.length);
	}

	return {
		file,
		originalContent,
		targets: Array.from(targetsByPath.values()).sort((left, right) => {
			const leftOffset = left.occurrences[0]?.startOffset ?? Number.MAX_SAFE_INTEGER;
			const rightOffset = right.occurrences[0]?.startOffset ?? Number.MAX_SAFE_INTEGER;
			return leftOffset - rightOffset;
		}),
	};
}

function collectAttachmentOccurrences(
	app: App,
	file: TFile,
	cache: CachedMetadata,
	content: string,
): AttachmentOccurrence[] {
	const references = [...(cache.embeds ?? []), ...(cache.links ?? [])];
	const occurrences: AttachmentOccurrence[] = [];
	const seenKeys = new Set<string>();

	for (const reference of references) {
		const sourceFile = resolveAttachmentFile(app, file, reference);
		if (!sourceFile) {
			continue;
		}

		const startOffset = reference.position?.start?.offset;
		const endOffset = reference.position?.end?.offset;
		if (!Number.isFinite(startOffset) || !Number.isFinite(endOffset) || startOffset < 0 || endOffset <= startOffset) {
			continue;
		}

		const key = `${startOffset}:${endOffset}`;
		if (seenKeys.has(key)) {
			continue;
		}

		const originalText = content.slice(startOffset, endOffset);
		if (!originalText || !looksLikeAttachmentReference(originalText)) {
			continue;
		}

		seenKeys.add(key);
		occurrences.push({
			key,
			sourceFile,
			startOffset,
			endOffset,
			originalText,
			parsedReference: parseOriginalReference(originalText),
		});
	}

	return occurrences.sort((left, right) => left.startOffset - right.startOffset);
}

function collectCurrentAttachmentReferenceCounts(
	app: App,
	file: TFile,
	cache: CachedMetadata,
): Map<string, number> {
	const counts = new Map<string, number>();
	const references: Reference[] = [
		...(cache.links ?? []),
		...(cache.embeds ?? []),
		...(cache.frontmatterLinks ?? []),
	];

	for (const reference of references) {
		const resolvedFile = resolveAttachmentFile(app, file, reference);
		if (!resolvedFile) {
			continue;
		}

		counts.set(resolvedFile.path, (counts.get(resolvedFile.path) ?? 0) + 1);
	}

	return counts;
}

function resolveAttachmentFile(app: App, sourceFile: TFile, reference: Reference): TFile | null {
	const resolvedFile = app.metadataCache.getFirstLinkpathDest(reference.link, sourceFile.path);
	if (!(resolvedFile instanceof TFile)) {
		return null;
	}

	if (NON_ATTACHMENT_EXTENSIONS.has(resolvedFile.extension.toLowerCase())) {
		return null;
	}

	return resolvedFile;
}

function getOtherMarkdownReferences(app: App, sourceFile: TFile, targetFile: TFile): TFile[] {
	const referencingFiles: TFile[] = [];

	for (const markdownFile of app.vault.getMarkdownFiles()) {
		if (markdownFile.path === sourceFile.path) {
			continue;
		}

		const fileCache = app.metadataCache.getFileCache(markdownFile);
		if (!fileCache) {
			continue;
		}

		const references: Reference[] = [
			...(fileCache.links ?? []),
			...(fileCache.embeds ?? []),
			...(fileCache.frontmatterLinks ?? []),
		];

		const hasReference = references.some((reference) => {
			const resolvedFile = app.metadataCache.getFirstLinkpathDest(reference.link, markdownFile.path);
			return resolvedFile?.path === targetFile.path;
		});

		if (hasReference) {
			referencingFiles.push(markdownFile);
		}
	}

	return referencingFiles.sort((left, right) => left.path.localeCompare(right.path));
}

async function buildCanvasAttachmentReferenceIndex(app: App): Promise<Map<string, TFile[]>> {
	const index = new Map<string, TFile[]>();
	const canvasFiles = app.vault.getFiles().filter((file) => file.extension === 'canvas');

	await Promise.all(canvasFiles.map(async (canvasFile) => {
		try {
			const raw = await app.vault.read(canvasFile);
			if (!raw.trim()) {
				return;
			}

			const parsed = JSON.parse(raw) as { nodes?: Array<{ type?: unknown; file?: unknown }> };
			const referencedPaths = new Set<string>();

			for (const node of parsed.nodes ?? []) {
				if (node?.type !== 'file' || typeof node.file !== 'string') {
					continue;
				}

				const resolvedFile = app.metadataCache.getFirstLinkpathDest(node.file, canvasFile.path);
				if (!(resolvedFile instanceof TFile)) {
					continue;
				}

				if (NON_ATTACHMENT_EXTENSIONS.has(resolvedFile.extension.toLowerCase())) {
					continue;
				}

				referencedPaths.add(resolvedFile.path);
			}

			for (const referencedPath of referencedPaths) {
				const files = index.get(referencedPath);
				if (files) {
					files.push(canvasFile);
				} else {
					index.set(referencedPath, [canvasFile]);
				}
			}
		} catch {
			// Ignore malformed canvas content to avoid blocking the command.
		}
	}));

	for (const [targetPath, files] of index.entries()) {
		const dedupedFiles = Array.from(new Map(files.map((file) => [file.path, file])).values())
			.sort((left, right) => left.path.localeCompare(right.path));
		index.set(targetPath, dedupedFiles);
	}

	return index;
}

function parseOriginalReference(originalText: string): ParsedOriginalReference {
	const trimmed = originalText.trim();
	const wikiMatch = trimmed.match(WIKILINK_REGEX);
	if (wikiMatch) {
		const embed = wikiMatch[1] === '!';
		const inner = wikiMatch[2];
		const separatorIndex = inner.lastIndexOf('|');
		if (separatorIndex < 0) {
			return {
				embed,
				label: null,
				imageSize: null,
			};
		}

		const alias = inner.slice(separatorIndex + 1).trim();
		return {
			embed,
			label: alias || null,
			imageSize: IMAGE_SIZE_REGEX.test(alias) ? alias : null,
		};
	}

	const markdownMatch = trimmed.match(MARKDOWN_LINK_REGEX);
	if (markdownMatch) {
		const embed = markdownMatch[1] === '!';
		const label = markdownMatch[2].trim();
		return {
			embed,
			label: label || null,
			imageSize: extractMarkdownImageSize(label),
		};
	}

	return {
		embed: trimmed.startsWith('!'),
		label: null,
		imageSize: null,
	};
}

function extractMarkdownImageSize(label: string): string | null {
	const separatorIndex = label.lastIndexOf('|');
	if (separatorIndex < 0) {
		return null;
	}

	const sizePart = label.slice(separatorIndex + 1).trim();
	return IMAGE_SIZE_REGEX.test(sizePart) ? sizePart : null;
}

function buildReplacementOperations(
	plan: AttachmentBatchPlan,
	resolvedLinks: Map<string, ResolvedEagleLink>,
): ReplacementOperation[] {
	return plan.targets
		.flatMap((target) => target.occurrences.map((occurrence) => {
			const resolvedLink = resolvedLinks.get(target.sourceFile.path);
			if (!resolvedLink) {
				throw new Error(`Missing resolved Eagle link for ${target.sourceFile.path}`);
			}

			return {
				startOffset: occurrence.startOffset,
				endOffset: occurrence.endOffset,
				originalText: occurrence.originalText,
				replacementText: buildReplacementText(occurrence, resolvedLink),
			};
		}))
		.sort((left, right) => right.startOffset - left.startOffset);
}

function buildReplacementText(occurrence: AttachmentOccurrence, resolvedLink: ResolvedEagleLink): string {
	const { embed, label, imageSize } = occurrence.parsedReference;

	if (embed) {
		if (resolvedLink.isImage) {
			const imageLabel = imageSize
				? `${resolvedLink.fileName}|${imageSize}`
				: resolvedLink.fileName;
			return `![${escapeMarkdownLabel(imageLabel)}](${resolvedLink.url})`;
		}

		return `![${escapeMarkdownLabel(label || resolvedLink.fileName)}](${resolvedLink.url})`;
	}

	return `[${escapeMarkdownLabel(label || resolvedLink.fileName)}](${resolvedLink.url})`;
}

function applyReplacementOperations(content: string, replacements: ReplacementOperation[]): string {
	let nextContent = content;
	for (const replacement of replacements) {
		const currentText = nextContent.slice(replacement.startOffset, replacement.endOffset);
		if (currentText !== replacement.originalText) {
			throw new Error('REPLACEMENT_MISMATCH');
		}

		nextContent = `${nextContent.slice(0, replacement.startOffset)}${replacement.replacementText}${nextContent.slice(replacement.endOffset)}`;
	}

	return nextContent;
}

function canDeleteOriginalAttachment(target: AttachmentTargetPlan): boolean {
	return !target.sourceAlreadyInEagleLibrary
		&& target.otherMarkdownReferences.length === 0
		&& target.otherCanvasReferences.length === 0
		&& target.remainingCurrentReferences === 0;
}

function looksLikeAttachmentReference(originalText: string): boolean {
	const trimmed = originalText.trim();
	return WIKILINK_REGEX.test(trimmed) || MARKDOWN_LINK_REGEX.test(trimmed);
}

function escapeMarkdownLabel(label: string): string {
	return label
		.replace(/\\/g, '\\\\')
		.replace(/\]/g, '\\]')
		.replace(/\r?\n/g, ' ')
		.trim();
}

function buildCompletionMessage(stats: UploadExecutionStats): string {
	const parts = [
		t('batch.stat.replaced', { count: stats.replacedCount }),
	];

	if (stats.uploadedCount > 0) {
		parts.push(t('batch.stat.uploaded', { count: stats.uploadedCount }));
	}

	if (stats.reusedCount > 0) {
		parts.push(t('batch.stat.reused', { count: stats.reusedCount }));
	}

	if (stats.deletedCount > 0) {
		parts.push(t('batch.stat.deleted', { count: stats.deletedCount }));
	}

	if (stats.skippedDeletionCount > 0) {
		if (stats.retainedByReferenceCount > 0) {
			parts.push(t('batch.stat.retainedByRef', { count: stats.retainedByReferenceCount }));
		}

		const otherRetainedCount = stats.skippedDeletionCount - stats.retainedByReferenceCount;
		if (otherRetainedCount > 0) {
			parts.push(t('batch.stat.retainedOther', { count: otherRetainedCount }));
		}

		parts.push(t('batch.stat.hintGenerated'));
	}

	if (stats.deletedCount === 0 && stats.skippedDeletionCount === 0) {
		parts.push(t('batch.stat.notDeleted'));
	}

	return `${parts.join('，')}。`;
}

function buildDeletionReportText(activeFile: TFile, skips: DeletionSkipInfo[]): string {
	const lines = [
		t('batch.report.currentDoc', { path: activeFile.path }),
		t('batch.report.notDeletedHeader'),
		t('batch.report.notDeletedDesc'),
		'',
	];

	for (const skip of skips) {
		lines.push(t('batch.report.attachment', { path: skip.sourceFile.path }));

		if (skip.sourceAlreadyInEagleLibrary) {
			lines.push(t('batch.report.reasonInEagleLibrary'));
		}

		if (skip.remainingCurrentReferences > 0) {
			lines.push(t('batch.report.reasonCurrentRef', { count: skip.remainingCurrentReferences }));
		}

		if (skip.otherMarkdownReferences.length > 0) {
			lines.push(t('batch.report.reasonOtherMd'));
			for (const referenceFile of skip.otherMarkdownReferences) {
				lines.push(`- ${referenceFile.path}`);
			}
		}

		if (skip.otherCanvasReferences.length > 0) {
			lines.push(t('batch.report.reasonOtherCanvas'));
			for (const referenceFile of skip.otherCanvasReferences) {
				lines.push(`- ${referenceFile.path}`);
			}
		}

		if (skip.deletionError) {
			lines.push(t('batch.report.autoDeleteFailed', { message: skip.deletionError }));
		}

		lines.push('');
	}

	return lines.join('\n').trim();
}

class AttachmentDeletionReportModal extends Modal {
	private readonly reportText: string;

	constructor(app: App, reportText: string) {
		super(app);
		this.reportText = reportText;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: t('batch.report.title') });
		contentEl.createEl('p', {
			text: t('batch.report.desc'),
		});

		const reportEl = contentEl.createEl('textarea');
		reportEl.value = this.reportText;
		reportEl.readOnly = true;
		reportEl.rows = 18;
		reportEl.style.width = '100%';
		reportEl.style.minHeight = '320px';
		reportEl.style.fontFamily = 'var(--font-monospace)';
		reportEl.style.resize = 'vertical';

		new Setting(contentEl)
			.addButton((button) => {
				button
					.setButtonText(t('batch.report.copyHint'))
					.setCta()
					.onClick(() => {
						void copyTextToClipboard(this.reportText).then((copied) => {
							new Notice(copied ? t('batch.report.hintCopied') : t('batch.report.copyFailed'));
						});
					});
			})
			.addButton((button) => {
				button
					.setButtonText(t('batch.report.copyAndClose'))
					.onClick(() => {
						void copyTextToClipboard(this.reportText).then((copied) => {
							new Notice(copied ? t('batch.report.hintCopied') : t('batch.report.copyFailed'));
							this.close();
						});
					});
			})
			.addButton((button) => {
				button
					.setButtonText(t('batch.report.close'))
					.onClick(() => {
						this.close();
					});
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

async function copyTextToClipboard(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}

export async function uploadVaultMarkdownAttachmentsToEagle(plugin: MyPlugin): Promise<void> {
	if (!(plugin.app.vault.adapter instanceof FileSystemAdapter)) {
		new Notice(t('batch.desktopOnly'));
		return;
	}

	const markdownFiles = plugin.app.vault.getMarkdownFiles();
	const adapterBasePath = plugin.app.vault.adapter.getBasePath();

	// Phase 1: analyze all files, collect potential targets
	const allPlans: Array<{ file: TFile; plan: AttachmentBatchPlan }> = [];
	let totalAttachmentCount = 0;

	for (const file of markdownFiles) {
		let plan: AttachmentBatchPlan;
		try {
			plan = await buildAttachmentBatchPlan(plugin.app, file, plugin.settings.libraryPath);
		} catch {
			continue;
		}

		if (plan.targets.length === 0) {
			continue;
		}

		allPlans.push({ file, plan });
		totalAttachmentCount += plan.targets.length;
	}

	if (allPlans.length === 0) {
		new Notice(t('batch.vault.noAttachments'));
		return;
	}

	// Phase 2: confirmation modal
	const confirmed = await new Promise<boolean>((resolve) => {
		const modal = new VaultMigrationConfirmModal(plugin.app, allPlans, totalAttachmentCount, resolve);
		modal.open();
	});

	if (!confirmed) {
		new Notice(t('batch.vault.cancelled'));
		return;
	}

	// Phase 3: backup if enabled
	let backupDir = '';
	if (plugin.settings.migrateBackup) {
		try {
			backupDir = await backupAttachmentFiles(plugin, allPlans, adapterBasePath);
			new Notice(t('batch.vault.backupDone', { path: backupDir }), 8000);
		} catch (error) {
			new Notice(t('batch.vault.backupFailed', { message: error instanceof Error ? error.message : String(error) }), 10000);
			return;
		}
	}

	// Phase 4: execute uploads file by file
	let totalUploaded = 0;
	let totalReplaced = 0;
	let totalDeleted = 0;
	let totalErrors = 0;

	for (const { file, plan } of allPlans) {
		try {
			const resolvedLinks = new Map<string, ResolvedEagleLink>();

			for (const target of plan.targets) {
				try {
					const resolvedLink = await resolveFilePathToEagleLink(target.absolutePath, plugin);
					resolvedLinks.set(target.sourceFile.path, resolvedLink);
					if (!target.sourceAlreadyInEagleLibrary) {
						totalUploaded++;
					}
				} catch {
					totalErrors++;
					continue;
				}

				if (plugin.settings.migrateWaitImportSeconds > 0) {
					await delay(plugin.settings.migrateWaitImportSeconds * 1000);
				}
			}

			if (resolvedLinks.size === 0) {
				continue;
			}

			const replacements = buildReplacementOperations(plan, resolvedLinks);
			if (replacements.length === 0) {
				continue;
			}

			try {
				await plugin.app.vault.process(file, (currentContent) => {
					if (currentContent !== plan.originalContent) {
						throw new Error('SOURCE_FILE_CHANGED');
					}
					return applyReplacementOperations(currentContent, replacements);
				});
				totalReplaced += replacements.length;
			} catch {
				totalErrors++;
			}

			// delete originals if enabled
			if (plugin.settings.migrateDeleteOriginal) {
				for (const target of plan.targets) {
					if (canDeleteOriginalAttachment(target)) {
						try {
							await plugin.app.vault.trash(target.sourceFile, true);
							totalDeleted++;
						} catch {
							// skip deletion errors silently in batch mode
						}
					}
				}
			}
		} catch {
			totalErrors++;
		}
	}

	// Phase 5: cleanup temp files if not keeping them
	if (!plugin.settings.migrateKeepTemp) {
		const tempDir = path.join(os.tmpdir(), 'obsidian-uploads');
		try {
			if (fs.existsSync(tempDir)) {
				fs.rmSync(tempDir, { recursive: true, force: true });
			}
		} catch {
			// ignore cleanup errors
		}
	}

	new Notice(
		t('batch.completed', {
			fileCount: allPlans.length,
			uploaded: totalUploaded,
			replaced: totalReplaced,
			deleted: totalDeleted,
			errorSuffix: totalErrors > 0 ? t('batch.errorSuffix', { count: totalErrors }) : '',
		}),
		15000,
	);
}

async function backupAttachmentFiles(
	plugin: MyPlugin,
	plans: Array<{ file: TFile; plan: AttachmentBatchPlan }>,
	adapterBasePath: string,
): Promise<string> {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const vaultRoot = plugin.app.vault.adapter instanceof FileSystemAdapter
		? plugin.app.vault.adapter.getBasePath()
		: adapterBasePath;
	const backupDir = path.join(vaultRoot, '.eaglebridge-backup', timestamp);

	const filesToBackup = new Set<string>();
	for (const { plan } of plans) {
		for (const target of plan.targets) {
			filesToBackup.add(target.absolutePath);
		}
	}

	for (const filePath of filesToBackup) {
		if (!fs.existsSync(filePath)) {
			continue;
		}

		const relativePath = path.relative(vaultRoot, filePath);
		const destPath = path.join(backupDir, relativePath);
		const destDir = path.dirname(destPath);

		if (!fs.existsSync(destDir)) {
			fs.mkdirSync(destDir, { recursive: true });
		}

		fs.copyFileSync(filePath, destPath);
	}

	return backupDir;
}

class VaultMigrationConfirmModal extends Modal {
	private readonly plans: Array<{ file: TFile; plan: AttachmentBatchPlan }>;
	private readonly totalCount: number;
	private readonly resolve: (value: boolean) => void;

	constructor(
		app: App,
		plans: Array<{ file: TFile; plan: AttachmentBatchPlan }>,
		totalCount: number,
		resolve: (value: boolean) => void,
	) {
		super(app);
		this.plans = plans;
		this.totalCount = totalCount;
		this.resolve = resolve;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: t('batch.vault.confirm.title') });
		contentEl.createEl('p', {
			text: t('batch.vault.confirm.desc', { fileCount: this.plans.length, totalCount: this.totalCount }),
		});

		const fileList = contentEl.createEl('details');
		fileList.createEl('summary', { text: t('batch.vault.confirm.viewFiles', { count: this.plans.length }) });
		const listEl = fileList.createEl('ul');
		for (const { file, plan } of this.plans) {
			const item = listEl.createEl('li');
			item.textContent = t('batch.vault.confirm.fileItem', { path: file.path, count: plan.targets.length });
		}

		contentEl.createEl('hr');

		new Setting(contentEl)
			.addButton((button) => {
				button
					.setButtonText(t('batch.vault.confirm.start'))
					.setCta()
					.onClick(() => {
						this.close();
						this.resolve(true);
					});
			})
			.addButton((button) => {
				button
					.setButtonText(t('batch.vault.confirm.cancel'))
					.onClick(() => {
						this.close();
						this.resolve(false);
					});
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}