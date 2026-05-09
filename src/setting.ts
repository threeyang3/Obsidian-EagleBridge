import { App, PluginSettingTab, Platform, Setting, Notice } from 'obsidian';
import MyPlugin from './main';
import { startServer, refreshServer, stopServer, detectLanIp } from './server';
import { t } from './i18n';

export interface EagleUploadSettings {
	enabled: boolean;
	markdown: boolean;
	canvas: boolean;
	image: boolean;
	video: boolean;
	website: boolean;
	other: boolean;
}

export type AttachmentTagSyncMode = 'off' | 'appendPageTagsToEagle' | 'importEagleTagsToYaml';
export type MarkdownExportFormat = 'folder' | 'zip';

export interface MyPluginSettings {
	mySetting: string;
	port: number;
	libraryPath: string;
	folderId?: string;
	clickView: boolean;
	adaptiveRatio: number;
	attachmentTagSyncMode: AttachmentTagSyncMode;
	exactSyncPageTagsToEagle: boolean;
	autoSyncObsidianLinkToEagle: boolean;
	obsidianStoreId: string;
	imageSize: number | undefined;
	upload: EagleUploadSettings;
	libraryPaths: string[];
	debug: boolean;
	openInObsidian: string;
	lanIpAddress: string;
	markdownExportFormat: MarkdownExportFormat;
	markdownExportDestinationPath: string;
	migrateDeleteOriginal: boolean;
	migrateBackup: boolean;
	migrateWaitImportSeconds: number;
	migrateKeepTemp: boolean;
	eagleDownloadDir: string;
}

export const DEFAULT_UPLOAD_SETTINGS: EagleUploadSettings = {
	enabled: true,
	markdown: true,
	canvas: true,
	image: true,
	video: true,
	website: false,
	other: true,
};

export const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: 'default',
	port: 6060,
	libraryPath: '',
	folderId: '',
	clickView: false,
	adaptiveRatio: 0.8,
	attachmentTagSyncMode: 'off',
	exactSyncPageTagsToEagle: false,
	autoSyncObsidianLinkToEagle: false,
	obsidianStoreId: '',
	imageSize: undefined,
	upload: { ...DEFAULT_UPLOAD_SETTINGS },
	libraryPaths: [],
	debug: false,
	openInObsidian: 'newPage',
	markdownExportFormat: 'folder',
	markdownExportDestinationPath: '',
	migrateDeleteOriginal: true,
	migrateBackup: false,
	migrateWaitImportSeconds: 2,
	migrateKeepTemp: false,
	lanIpAddress: '',
	eagleDownloadDir: '',
}

type LegacyUploadSettings = Partial<EagleUploadSettings> & {
	pdf?: boolean;
	website?: boolean;
};

type LegacyTagSyncSettings = {
	attachmentTagSyncMode?: AttachmentTagSyncMode;
	exactSyncPageTagsToEagle?: boolean;
	autoSyncPageTags?: boolean;
	importEagleTagsToYaml?: boolean;
};

export function normalizeUploadSettings(data: { upload?: LegacyUploadSettings; websiteUpload?: boolean } | null | undefined): EagleUploadSettings {
	const upload = data?.upload ?? {};
	const legacyWebsiteUpload = typeof data?.websiteUpload === 'boolean' ? data.websiteUpload : undefined;
	const hasLegacyOtherEnabled = upload.pdf === true || typeof upload.other === 'boolean';

	return {
		...DEFAULT_UPLOAD_SETTINGS,
		...upload,
		markdown: typeof upload.markdown === 'boolean' ? upload.markdown : DEFAULT_UPLOAD_SETTINGS.markdown,
		canvas: typeof upload.canvas === 'boolean' ? upload.canvas : DEFAULT_UPLOAD_SETTINGS.canvas,
		website: typeof upload.website === 'boolean'
			? upload.website
			: legacyWebsiteUpload ?? DEFAULT_UPLOAD_SETTINGS.website,
		other: typeof upload.other === 'boolean'
			? upload.other
			: hasLegacyOtherEnabled
				? true
				: DEFAULT_UPLOAD_SETTINGS.other,
	};
}

export function normalizeAttachmentTagSyncMode(data: LegacyTagSyncSettings | null | undefined): AttachmentTagSyncMode {
	const savedMode = data?.attachmentTagSyncMode;
	if (savedMode === 'off' || savedMode === 'appendPageTagsToEagle' || savedMode === 'importEagleTagsToYaml') {
		return savedMode;
	}

	if (data?.importEagleTagsToYaml) {
		return 'importEagleTagsToYaml';
	}

	if (data?.autoSyncPageTags) {
		return 'appendPageTagsToEagle';
	}

	return 'off';
}

export function isAppendPageTagsMode(settings: MyPluginSettings): boolean {
	return settings.attachmentTagSyncMode === 'appendPageTagsToEagle';
}

export function isImportEagleTagsMode(settings: MyPluginSettings): boolean {
	return settings.attachmentTagSyncMode === 'importEagleTagsToYaml';
}

export function shouldReplacePageTagsInEagle(settings: MyPluginSettings): boolean {
	return isAppendPageTagsMode(settings) && settings.exactSyncPageTagsToEagle;
}


export class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName(t('settings.port.name'))
			.setDesc(t('settings.port.desc'))
			.addText(text => text
				.setPlaceholder(t('settings.port.placeholder'))
				.setValue(this.plugin.settings.port.toString())
				.onChange(async (value) => {
					this.plugin.settings.port = parseInt(value);
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
				.setName(t('settings.libraryPaths.name'))
			.setDesc(t('settings.libraryPaths.desc', { path: this.plugin.settings.libraryPath }))
			.addButton(button => {
				button.setButtonText('+')
					.setCta()
					.onClick(() => {
						this.plugin.settings.libraryPaths.push('');
						this.plugin.saveSettings();
						this.display();
					});
			});

			this.plugin.settings.libraryPaths.forEach((path, index) => {
				new Setting(containerEl)
					.addText(text => text
						.setPlaceholder(t('settings.libraryPaths.placeholder'))
						.setValue(path)
						.onChange(async (value) => {
							this.plugin.settings.libraryPaths[index] = value;
							await this.plugin.saveSettings();
							await this.plugin.updateLibraryPath();
							this.display();
						}))
					.addExtraButton(button => {
						button.setIcon('cross')
							.setTooltip(t('settings.libraryPaths.remove'))
							.onClick(async () => {
								this.plugin.settings.libraryPaths.splice(index, 1);
								await this.plugin.saveSettings();
								await this.plugin.updateLibraryPath();
								this.display();
							});
					});
			});
		// new Setting(containerEl)
		// 	.setName('Current Library Path')
		// 	.setDesc('The first valid library path')
		// 	.addText(text => text
		// 		.setValue(this.plugin.settings.libraryPath)
		// 		.setDisabled(true)); // 禁用输入框，只显示有效路径

		new Setting(containerEl)
			.setName(t('settings.folderId.name'))
			.setDesc(t('settings.folderId.desc'))
			.addText(text => text
				.setPlaceholder(t('settings.folderId.placeholder'))
				.setValue(this.plugin.settings.folderId || '')
				.onChange(async (value) => {
					this.plugin.settings.folderId = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
		.setName(t('settings.imageSize.name'))
		.setDesc(t('settings.imageSize.desc'))
		.addText(text => text
			.setPlaceholder(t('settings.imageSize.placeholder'))
			.setValue(this.plugin.settings.imageSize?.toString() || '')
			.onChange(async (value) => {
				this.plugin.settings.imageSize = value ? parseInt(value) : undefined;
				await this.plugin.saveSettings();
			}));

        new Setting(containerEl)
            .setName(t('settings.clickView.name'))
            .setDesc(t('settings.clickView.desc'))
            .addToggle((toggle) => {
                toggle.setValue(this.plugin.settings.clickView)
                    .onChange(async (value) => {
                        this.plugin.settings.clickView = value;
                        await this.plugin.saveSettings();
                    });
            });

		new Setting(containerEl)
		.setName(t('settings.adaptiveRatio.name'))
		.setDesc(t('settings.adaptiveRatio.desc'))
		.addSlider((slider) => {
			slider.setLimits(0.1, 1, 0.05);
			slider.setValue(this.plugin.settings.adaptiveRatio);
			slider.onChange(async (value) => {
				this.plugin.settings.adaptiveRatio = value;
				new Notice(t('settings.adaptiveRatio.notice', { value }));
				await this.plugin.saveSettings();
			});
			slider.setDynamicTooltip();
		});

		const attachmentTagSyncPanel = containerEl.createDiv({ cls: 'eagle-tag-sync-panel' });
		attachmentTagSyncPanel.createEl('h3', { text: t('settings.tagSync.title') });
		attachmentTagSyncPanel.createEl('p', {
			text: t('settings.tagSync.desc'),
			cls: 'eagle-tag-sync-panel-desc',
		});

		new Setting(attachmentTagSyncPanel)
			.setName(t('settings.tagSync.direction.name'))
			.setDesc(t('settings.tagSync.direction.desc'))
			.addDropdown((dropdown) => {
				dropdown
					.addOption('off', t('settings.tagSync.mode.off'))
					.addOption('appendPageTagsToEagle', t('settings.tagSync.mode.append'))
					.addOption('importEagleTagsToYaml', t('settings.tagSync.mode.import'))
					.setValue(this.plugin.settings.attachmentTagSyncMode)
					.onChange(async (value: AttachmentTagSyncMode) => {
						this.plugin.settings.attachmentTagSyncMode = value;
						await this.plugin.saveSettings();
						this.plugin.refreshAutoTagSyncState();
						this.display();
					});
			});

		if (this.plugin.settings.attachmentTagSyncMode === 'appendPageTagsToEagle') {
			const appendModeCard = attachmentTagSyncPanel.createDiv({ cls: 'eagle-tag-sync-subcard' });
			new Setting(appendModeCard)
				.setName(t('settings.tagSync.exactAlign.name'))
				.setDesc(t('settings.tagSync.exactAlign.desc'))
				.addToggle((toggle) => {
					toggle.setValue(this.plugin.settings.exactSyncPageTagsToEagle)
						.onChange(async (value) => {
							this.plugin.settings.exactSyncPageTagsToEagle = value;
							await this.plugin.saveSettings();
							this.plugin.refreshAutoTagSyncState();
							this.display();
						});
				});
		}

		const attachmentTagSyncHint = attachmentTagSyncPanel.createDiv({ cls: 'eagle-tag-sync-hint' });
		const activeModeText = this.plugin.settings.attachmentTagSyncMode === 'appendPageTagsToEagle'
			? this.plugin.settings.exactSyncPageTagsToEagle
				? t('settings.tagSync.hint.exactAlign')
				: t('settings.tagSync.hint.append')
			: this.plugin.settings.attachmentTagSyncMode === 'importEagleTagsToYaml'
				? t('settings.tagSync.hint.import')
				: t('settings.tagSync.hint.off');
		attachmentTagSyncHint.setText(activeModeText);

		const obsidianLinkSyncPanel = containerEl.createDiv({ cls: 'eagle-obsidian-link-panel' });
		obsidianLinkSyncPanel.createEl('h3', { text: t('settings.obsidianLink.title') });
		obsidianLinkSyncPanel.createEl('p', {
			text: t('settings.obsidianLink.desc'),
			cls: 'eagle-obsidian-link-panel-desc',
		});

		new Setting(obsidianLinkSyncPanel)
			.setName(t('settings.obsidianLink.auto.name'))
			.setDesc(t('settings.obsidianLink.auto.desc'))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.autoSyncObsidianLinkToEagle)
					.onChange(async (value) => {
						this.plugin.settings.autoSyncObsidianLinkToEagle = value;
						await this.plugin.saveSettings();
						this.plugin.refreshAutoTagSyncState();
					});
			});

		new Setting(obsidianLinkSyncPanel)
			.setName(t('settings.obsidianLink.storeId.name'))
			.setDesc(t('settings.obsidianLink.storeId.desc'))
			.addText(text => text
				.setPlaceholder(t('settings.obsidianLink.storeId.placeholder'))
				.setValue(this.plugin.settings.obsidianStoreId)
				.onChange(async (value) => {
					this.plugin.settings.obsidianStoreId = value;
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
		.setName(t('settings.openInObsidian.name'))
		.setDesc(t('settings.openInObsidian.desc'))
		.addDropdown(dropdown => {
			dropdown.addOption('newPage', t('settings.openInObsidian.newPage'))
				.addOption('popup', t('settings.openInObsidian.popup'))
				.addOption('rightPane', t('settings.openInObsidian.rightPane'))
				.setValue(this.plugin.settings.openInObsidian || 'newPage')
				.onChange(async (value) => {
					this.plugin.settings.openInObsidian = value;
					await this.plugin.saveSettings();
				});
		});

		const uploadSettingsContainer = containerEl.createDiv({ cls: 'eagle-upload-panel' });

		new Setting(uploadSettingsContainer)
			.setName(t('settings.upload.name'))
			.setDesc(t('settings.upload.desc'))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.upload.enabled)
					.onChange(async (value) => {
						this.plugin.settings.upload.enabled = value;
						await this.plugin.saveSettings();
						this.display();
					});
			});

		const uploadTypesDetails = uploadSettingsContainer.createEl('details', { cls: 'eagle-upload-details' });
		uploadTypesDetails.open = this.plugin.settings.upload.enabled;
		uploadTypesDetails.createEl('summary', { text: t('settings.upload.configure') });
		const uploadGrid = uploadTypesDetails.createDiv({ cls: 'eagle-upload-grid' });
		const uploadTargetCard = uploadGrid.createDiv({ cls: 'eagle-upload-card' });
		const uploadFormatCard = uploadGrid.createDiv({ cls: 'eagle-upload-card' });

		uploadTargetCard.createEl('h3', { text: t('settings.upload.obsidianType') });
		uploadTargetCard.createEl('p', {
			text: t('settings.upload.obsidianTypeDesc'),
			cls: 'eagle-upload-card-desc',
		});

		new Setting(uploadTargetCard)
			.setName(t('settings.upload.markdown.name'))
			.setDesc(t('settings.upload.markdown.desc'))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.upload.markdown)
					.onChange(async (value) => {
						this.plugin.settings.upload.markdown = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(uploadTargetCard)
			.setName(t('settings.upload.canvas.name'))
			.setDesc(t('settings.upload.canvas.desc'))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.upload.canvas)
					.onChange(async (value) => {
						this.plugin.settings.upload.canvas = value;
						await this.plugin.saveSettings();
					});
			});

		uploadFormatCard.createEl('h3', { text: t('settings.upload.contentType') });
		uploadFormatCard.createEl('p', {
			text: t('settings.upload.contentTypeDesc'),
			cls: 'eagle-upload-card-desc',
		});

		new Setting(uploadFormatCard)
			.setName(t('settings.upload.image.name'))
			.setDesc(t('settings.upload.image.desc'))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.upload.image)
					.onChange(async (value) => {
						this.plugin.settings.upload.image = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(uploadFormatCard)
			.setName(t('settings.upload.video.name'))
			.setDesc(t('settings.upload.video.desc'))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.upload.video)
					.onChange(async (value) => {
						this.plugin.settings.upload.video = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(uploadFormatCard)
			.setName(t('settings.upload.website.name'))
			.setDesc(t('settings.upload.website.desc'))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.upload.website)
					.onChange(async (value) => {
						this.plugin.settings.upload.website = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(uploadFormatCard)
			.setName(t('settings.upload.other.name'))
			.setDesc(t('settings.upload.other.desc'))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.upload.other)
					.onChange(async (value) => {
						this.plugin.settings.upload.other = value;
						await this.plugin.saveSettings();
					});
			});

		if (Platform.isDesktopApp) {
			new Setting(containerEl)
				.setName(t('settings.lanIp.name'))
				.setDesc(t('settings.lanIp.desc'))
				.addText(text => text
					.setPlaceholder(t('settings.lanIp.placeholder'))
					.setValue(this.plugin.settings.lanIpAddress)
					.onChange(async (value) => {
						this.plugin.settings.lanIpAddress = value.trim();
						await this.plugin.saveSettings();
					}))
				.addExtraButton(button => {
					button.setIcon('search')
						.setTooltip(t('settings.lanIp.autoDetect'))
						.onClick(async () => {
							const ip = detectLanIp();
							if (ip) {
								this.plugin.settings.lanIpAddress = ip;
								await this.plugin.saveSettings();
								this.display();
								new Notice(t('settings.lanIp.detected', { ip }));
							} else {
								new Notice(t('settings.lanIp.detectFailed'));
							}
						});
					});
			}

		new Setting(containerEl)
			.setName(t('settings.server.name'))
			.setDesc(t('settings.server.desc'))
			.addButton(button => button
				.setButtonText(t('settings.server.button'))
				.onClick(() => {
					refreshServer(this.plugin.settings.libraryPath, this.plugin.settings.port);
				}));

		new Setting(containerEl)
			.setName(t('settings.debug.name'))
			.setDesc(t('settings.debug.desc'))
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.debug)
				.onChange(async (value) => {
					this.plugin.settings.debug = value;
					await this.plugin.saveSettings();
				}));

		const migrationPanel = containerEl.createDiv({ cls: 'eagle-migration-panel' });
		migrationPanel.createEl('h3', { text: t('settings.migration.title') });

		new Setting(migrationPanel)
			.setName(t('settings.migration.deleteOriginal.name'))
			.setDesc(t('settings.migration.deleteOriginal.desc'))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.migrateDeleteOriginal)
					.onChange(async (value) => {
						this.plugin.settings.migrateDeleteOriginal = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(migrationPanel)
			.setName(t('settings.migration.backup.name'))
			.setDesc(t('settings.migration.backup.desc'))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.migrateBackup)
					.onChange(async (value) => {
						this.plugin.settings.migrateBackup = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(migrationPanel)
			.setName(t('settings.migration.waitTime.name'))
			.setDesc(t('settings.migration.waitTime.desc'))
			.addSlider((slider) => {
				slider.setLimits(0, 10, 1);
				slider.setValue(this.plugin.settings.migrateWaitImportSeconds);
				slider.onChange(async (value) => {
					this.plugin.settings.migrateWaitImportSeconds = value;
					await this.plugin.saveSettings();
				});
				slider.setDynamicTooltip();
			});

		new Setting(migrationPanel)
			.setName(t('settings.migration.keepTemp.name'))
			.setDesc(t('settings.migration.keepTemp.desc'))
			.addToggle((toggle) => {
				toggle.setValue(this.plugin.settings.migrateKeepTemp)
					.onChange(async (value) => {
						this.plugin.settings.migrateKeepTemp = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(migrationPanel)
			.setName(t('settings.downloadDir.name'))
			.setDesc(t('settings.downloadDir.desc'))
			.addText((text) => {
				text
					.setPlaceholder(t('settings.downloadDir.placeholder'))
					.setValue(this.plugin.settings.eagleDownloadDir)
					.onChange(async (value) => {
						this.plugin.settings.eagleDownloadDir = value.trim();
						await this.plugin.saveSettings();
					});
				text.inputEl.style.width = '100%';
			});

	}
}
