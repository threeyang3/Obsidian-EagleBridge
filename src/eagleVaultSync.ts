import * as fs from 'fs';
import * as path from 'path';
import { FileSystemAdapter, TFile, Notice } from 'obsidian';
import chokidar from 'chokidar';
import type MyPlugin from './main';
import { resolveEagleItem } from './exportMarkdown';
import { print } from './main';
import { t } from './i18n';

export interface EagleVaultMappingEntry {
	vaultPath: string;
	eagleFileName: string;
	lastSyncedMtime: number;
}

export type EagleVaultMapping = Record<string, EagleVaultMappingEntry>;

export interface SyncResult {
	checked: number;
	updated: number;
	errors: number;
}

const MAPPING_KEY = 'eagleVaultMapping';

let watcher: ReturnType<typeof chokidar.watch> | null = null;
let syncTimer: ReturnType<typeof setTimeout> | null = null;
let cachedMapping: EagleVaultMapping | null = null;

// ─── Mapping Management ───

export async function initMapping(plugin: MyPlugin): Promise<void> {
	const data = (await plugin.loadData()) ?? {};
	cachedMapping = (data[MAPPING_KEY] as EagleVaultMapping) ?? {};
}

export function getMapping(): EagleVaultMapping {
	return cachedMapping ?? {};
}

export async function saveMapping(plugin: MyPlugin, mapping: EagleVaultMapping): Promise<void> {
	cachedMapping = mapping;
	const data = (await plugin.loadData()) ?? {};
	data[MAPPING_KEY] = mapping;
	await plugin.saveData(data);
}

export async function addMapping(
	plugin: MyPlugin,
	itemId: string,
	vaultPath: string,
	eagleFileName: string,
): Promise<void> {
	const mapping = getMapping();

	let lastSyncedMtime = 0;
	const libraryPath = plugin.settings.libraryPath;
	if (libraryPath) {
		const eagleFilePath = getEagleItemFilePath(libraryPath, itemId, eagleFileName);
		if (eagleFilePath && fs.existsSync(eagleFilePath)) {
			try {
				lastSyncedMtime = fs.statSync(eagleFilePath).mtimeMs;
			} catch {
				// ignore
			}
		}
	}

	mapping[itemId] = { vaultPath, eagleFileName, lastSyncedMtime };
	await saveMapping(plugin, mapping);
}

export async function removeMapping(plugin: MyPlugin, itemId: string): Promise<void> {
	const mapping = getMapping();
	delete mapping[itemId];
	await saveMapping(plugin, mapping);
}

// ─── File Operations ───

export async function copyEagleItemToVault(
	plugin: MyPlugin,
	itemId: string,
	attachmentDir: string,
): Promise<{ vaultPath: string; fileName: string } | null> {
	const libraryPath = plugin.settings.libraryPath;
	if (!libraryPath) {
		return null;
	}

	const resolved = await resolveEagleItem(itemId, libraryPath);
	if (!resolved || resolved.externalUrl || !resolved.sourceFilePath) {
		return null;
	}

	const adapter = plugin.app.vault.adapter;
	if (!(adapter instanceof FileSystemAdapter)) {
		return null;
	}

	const vaultBasePath = adapter.getBasePath();
	const targetDir = path.join(vaultBasePath, attachmentDir);

	if (!fs.existsSync(targetDir)) {
		fs.mkdirSync(targetDir, { recursive: true });
	}

	const usedNames = new Set<string>();
	for (const entry of fs.readdirSync(targetDir)) {
		usedNames.add(entry.toLowerCase());
	}

	const targetFileName = allocateUniqueFileName(resolved.exportBaseName, usedNames);
	const targetPath = path.join(targetDir, targetFileName);

	await fs.promises.copyFile(resolved.sourceFilePath, targetPath);

	const relativeVaultPath = path.posix.join(attachmentDir, targetFileName);

	return { vaultPath: relativeVaultPath, fileName: targetFileName };
}

// ─── Sync Engine ───

export async function syncEagleToVault(plugin: MyPlugin): Promise<SyncResult> {
	const mapping = getMapping();
	const itemIds = Object.keys(mapping);

	if (itemIds.length === 0) {
		return { checked: 0, updated: 0, errors: 0 };
	}

	const libraryPath = plugin.settings.libraryPath;
	if (!libraryPath) {
		return { checked: itemIds.length, updated: 0, errors: 0 };
	}

	const adapter = plugin.app.vault.adapter;
	if (!(adapter instanceof FileSystemAdapter)) {
		return { checked: itemIds.length, updated: 0, errors: 0 };
	}

	const vaultBasePath = adapter.getBasePath();
	const result: SyncResult = { checked: 0, updated: 0, errors: 0 };

	for (const itemId of itemIds) {
		const entry = mapping[itemId];
		result.checked += 1;

		const eagleFilePath = getEagleItemFilePath(libraryPath, itemId, entry.eagleFileName);
		if (!eagleFilePath || !fs.existsSync(eagleFilePath)) {
			continue;
		}

		try {
			const eagleStat = fs.statSync(eagleFilePath);
			if (eagleStat.mtimeMs <= entry.lastSyncedMtime) {
				continue;
			}

			const vaultFilePath = path.join(vaultBasePath, entry.vaultPath);
			const vaultDir = path.dirname(vaultFilePath);
			if (!fs.existsSync(vaultDir)) {
				fs.mkdirSync(vaultDir, { recursive: true });
			}

			await fs.promises.copyFile(eagleFilePath, vaultFilePath);
			entry.lastSyncedMtime = eagleStat.mtimeMs;
			result.updated += 1;
		} catch (error) {
			print(`Sync failed for Eagle item ${itemId}:`, error);
			result.errors += 1;
		}
	}

	if (result.updated > 0) {
		await saveMapping(plugin, mapping);
	}

	return result;
}

export function startWatchingEagleLibrary(plugin: MyPlugin): void {
	stopWatchingEagleLibrary();

	if (!plugin.settings.autoSyncEagleToVault) {
		return;
	}

	const libraryPath = plugin.settings.libraryPath;
	if (!libraryPath) {
		return;
	}

	const watchPath = path.join(path.resolve(libraryPath), 'images');
	if (!fs.existsSync(watchPath)) {
		return;
	}

	watcher = chokidar.watch(watchPath, {
		ignored: /(^|[\/\\])\../,
		persistent: true,
		ignoreInitial: true,
		depth: 2,
	});

	watcher.on('change', (changedPath: string) => {
		scheduleIncrementalSync(plugin, changedPath);
	});
}

export function stopWatchingEagleLibrary(): void {
	if (watcher) {
		watcher.close();
		watcher = null;
	}

	if (syncTimer) {
		clearTimeout(syncTimer);
		syncTimer = null;
	}
}

// ─── Internal Helpers ───

function scheduleIncrementalSync(plugin: MyPlugin, changedPath: string): void {
	const mapping = getMapping();
	const itemIds = Object.keys(mapping);

	let matchedItemId: string | null = null;
	for (const itemId of itemIds) {
		const infoDir = `${itemId}.info`;
		if (changedPath.includes(infoDir)) {
			matchedItemId = itemId;
			break;
		}
	}

	if (!matchedItemId) {
		return;
	}

	if (syncTimer) {
		clearTimeout(syncTimer);
	}

	syncTimer = setTimeout(() => {
		syncTimer = null;
		void syncEagleToVault(plugin).then((result) => {
			if (result.updated > 0) {
				print(`Eagle → vault incremental sync: updated ${result.updated} file(s)`);
			}
		});
	}, 2000);
}

function getEagleItemFilePath(libraryPath: string, itemId: string, eagleFileName: string): string | null {
	const infoDirPath = path.join(path.resolve(libraryPath), 'images', `${itemId}.info`);
	const expectedPath = path.join(infoDirPath, eagleFileName);

	if (fs.existsSync(expectedPath)) {
		return expectedPath;
	}

	try {
		const entries = fs.readdirSync(infoDirPath, { withFileTypes: true });
		const fileEntries = entries.filter((e) => e.isFile() && e.name.toLowerCase() !== 'metadata.json');
		if (fileEntries.length === 0) {
			return null;
		}

		const match = fileEntries.find((e) => e.name.toLowerCase() === eagleFileName.toLowerCase());
		if (match) {
			return path.join(infoDirPath, match.name);
		}

		return path.join(infoDirPath, fileEntries[0].name);
	} catch {
		return null;
	}
}

function allocateUniqueFileName(preferred: string, usedNames: Set<string>): string {
	const safeName = sanitizeFileName(preferred) || 'attachment';
	const parsed = path.parse(safeName);
	const baseName = parsed.name || 'attachment';
	const ext = parsed.ext;

	let candidate = safeName;
	let suffix = 2;
	while (usedNames.has(candidate.toLowerCase())) {
		candidate = `${baseName}-${suffix}${ext}`;
		suffix += 1;
	}

	usedNames.add(candidate.toLowerCase());
	return candidate;
}

function sanitizeFileName(fileName: string): string {
	const parsed = path.parse(fileName);
	const safeName = sanitizeSegment(parsed.name) || 'file';
	const safeExt = sanitizeSegment(parsed.ext.replace(/^\./, ''));
	return safeExt ? `${safeName}.${safeExt}` : safeName;
}

function sanitizeSegment(value: string): string {
	return value
		.replace(/[<>:"/\\|?* -]/g, '_')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/[. ]+$/g, '');
}
