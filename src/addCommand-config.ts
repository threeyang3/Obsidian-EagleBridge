import MyPlugin from './main';
import { syncCurrentPageTags } from "./synchronizedpagetabs";
import { syncCurrentPageObsidianLinkToEagle } from './obsidianLinkSync';
import { uploadCurrentMarkdownAttachmentsToEagle, uploadVaultMarkdownAttachmentsToEagle } from './markdownAttachmentBatchUpload';
import { downloadCurrentFileEagleAttachments, downloadVaultEagleAttachments } from './eagleAttachmentDownload';
import { t } from './i18n';

export const addCommandSynchronizedPageTabs = (myPlugin: MyPlugin) => {
	myPlugin.addCommand({
		id: "synchronized-page-tabs",
		name: t('cmd.syncPageTags'),
		callback: async () => {
			await syncCurrentPageTags(myPlugin.app, myPlugin.settings, { notify: true });
		},
	});
};

export const addCommandSyncCurrentPageObsidianLink = (myPlugin: MyPlugin) => {
	myPlugin.addCommand({
		id: "sync-current-page-obsidian-link-to-eagle",
		name: t('cmd.syncObsidianLink'),
		callback: async () => {
			await syncCurrentPageObsidianLinkToEagle(myPlugin.app, myPlugin.settings);
		},
	});
};

export const addCommandUploadCurrentMarkdownAttachments = (myPlugin: MyPlugin) => {
	myPlugin.addCommand({
		id: 'upload-current-markdown-attachments-to-eagle',
		name: t('cmd.uploadCurrent'),
		checkCallback: (checking: boolean) => {
			const activeFile = myPlugin.app.workspace.getActiveFile();
			const canRun = activeFile?.extension === 'md';
			if (!canRun) {
				return false;
			}

			if (!checking) {
				void uploadCurrentMarkdownAttachmentsToEagle(myPlugin);
			}

			return true;
		},
	});
};
export const addCommandUploadVaultMarkdownAttachments = (myPlugin: MyPlugin) => {
	myPlugin.addCommand({
		id: 'upload-vault-markdown-attachments-to-eagle',
		name: t('cmd.uploadVault'),
		callback: async () => {
			await uploadVaultMarkdownAttachmentsToEagle(myPlugin);
		},
	});
};

export const addCommandDownloadCurrentFileEagleAttachments = (myPlugin: MyPlugin) => {
	myPlugin.addCommand({
		id: 'download-current-file-eagle-attachments',
		name: t('cmd.downloadCurrent'),
		checkCallback: (checking: boolean) => {
			const activeFile = myPlugin.app.workspace.getActiveFile();
			const canRun = activeFile?.extension === 'md';
			if (!canRun) {
				return false;
			}

			if (!checking) {
				void downloadCurrentFileEagleAttachments(myPlugin);
			}

			return true;
		},
	});
};

export const addCommandDownloadVaultEagleAttachments = (myPlugin: MyPlugin) => {
	myPlugin.addCommand({
		id: 'download-vault-eagle-attachments',
		name: t('cmd.downloadVault'),
		callback: async () => {
			await downloadVaultEagleAttachments(myPlugin);
		},
	});
};
