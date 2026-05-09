# Obsidian EagleBridge

【[中文](./doc/ReadmeZH.md) / EN】

This is a sample plugin for Obsidian, designed to integrate Obsidian with the Eagle software.

[eagle](https://eagle.cool) is a powerful attachment management software that allows for easy management of large quantities of images, videos, and audio materials, suitable for various scenarios such as collection, organization, and search. It supports Windows systems.

## Features Overview

This plugin includes the following functionalities:

- Quick eagle attachment navigation in Obsidian
- Tag synchronization
- File viewing
- Attachment management
- **Image auto-retry**: Eagle images that fail to load are automatically retried (up to 8 times) with cache-busting
- **Audio/Video inline playback**: Eagle-linked media files play directly in Obsidian via native `<audio>`/`<video>` elements
- **Mobile LAN viewing**: View Eagle-linked images and attachments from mobile Obsidian on the same LAN
- **Vault-wide batch migration**: Upload all local attachments across the vault to Eagle, with backup, confirmation modal, and configurable options
- **Export Markdown with Eagle attachments**: Export a .md file with Eagle localhost links rewritten to relative attachment paths, bundled as folder or ZIP
- **Download Eagle attachments to local**: Reverse of batch upload — download Eagle-linked attachments to a local directory and replace localhost links with relative paths (current file or vault-wide)
- **i18n**: UI automatically switches between English and Chinese based on Obsidian's language setting

[![GitHub stars](https://img.shields.io/github/stars/zyjGraphein/Obsidian-EagleBridge?style=flat&label=Stars)](https://github.com/zyjGraphein/Obsidian-EagleBridge/stargazers)
[![Total Downloads](https://img.shields.io/github/downloads/zyjGraphein/Obsidian-EagleBridge/total?style=flat&label=Total%20Downloads)](https://github.com/zyjGraphein/Obsidian-EagleBridge/releases)
[![GitHub Release](https://img.shields.io/github/v/release/zyjGraphein/Obsidian-EagleBridge?style=flat&label=Release)](https://github.com/zyjGraphein/Obsidian-EagleBridge/releases/latest)
![GitHub Downloads (specific asset, all releases)|150](https://img.shields.io/github/downloads/zyjGraphein/Obsidian-EagleBridge/main.js) 
![GitHub Downloads (specific asset, latest release)](https://img.shields.io/github/downloads/zyjGraphein/Obsidian-EagleBridge/latest/main.js)
[![GitHub License](https://img.shields.io/github/license/zyjGraphein/Obsidian-EagleBridge?style=flat&label=License)](https://github.com/zyjGraphein/Obsidian-EagleBridge/blob/master/LICENSE)
[![GitHub Issues](https://img.shields.io/github/issues/zyjGraphein/Obsidian-EagleBridge?style=flat&label=Issues)](https://github.com/zyjGraphein/Obsidian-EagleBridge/issues)
[![GitHub Last Commit](https://img.shields.io/github/last-commit/zyjGraphein/Obsidian-EagleBridge?style=flat&label=Last%20Commit)](https://github.com/zyjGraphein/Obsidian-EagleBridge/commits/master)

## Initial Setup Instructions

1. **Configure the Listening Port**: Set a four-digit, complex value between 1000 and 9999 (e.g., 6060) to avoid conflicts with common port numbers. Once set, it is recommended not to change it to ensure stable attachment links.

2. **Set Eagle Library Location**: Select the library in the top left corner of the Eagle software and copy its path, for example: `D:\onedrive\eagle\Library`.

You need to restart Obsidian after completing these configurations, and then you can start using the plugin.


## Showcase

### Load Attachments from Eagle

<img src="assets/fromeagle.gif" width="800">

### Upload Local Attachments to Eagle via EagleBridge and View in Obsidian

<img src="assets/upload.gif" width="800">


## Installation Instructions

### Install via BRAT

Add `https://github.com/zyjGraphein/Obsidian-EagleBridge` to [BRAT](https://github.com/TfTHacker/obsidian42-brat).

### Manual Installation

Visit the latest release page, download `main.js`, `manifest.json`, and `style.css`, then place them into `<your_vault>/.obsidian/plugins/EagleBridge/`.


## Usage Guide

- Text Tutorial ([中文](./doc/TutorialZH.md) / [EN](./doc/Tutorial.md))
- Video Tutorial ([Obsidian EagleBridge -bilibili](https://www.bilibili.com/video/BV1voQsYaE5W/?share_source=copy_web&vd_source=491bedf306ddb53a3baa114332c02b93))


### Notes
- When using the plugin, Eagle must be running in the background, and the open state should correspond to the repository at the specified path.
- If Eagle is not running or is not in the target path repository, you can still view images, but the context menu functions and attachment uploads to Eagle will not work.
- When exporting notes as a PDF, images will display correctly, but other links (URLs, PDFs, MP4s) will still be clickable. However, when shared with others (outside the local environment), these links may not open.

### Mobile LAN Viewing

1. On desktop: go to plugin Settings → **LAN IP address** → click 🔍 to auto-detect (or enter manually, e.g., `192.168.1.100`)
2. Sync your vault to mobile Obsidian (use any sync plugin)
3. On mobile: ensure the device is on the same LAN as the desktop
4. Eagle images and attachments will load from the desktop server automatically

> **Note**: Mobile mode is view-only. Upload, context menus, and Eagle API operations require the desktop app.

### Vault-Wide Batch Migration

Upload all local attachments (images, audio, video, PDFs) from every Markdown file to Eagle in one go:

1. Go to plugin Settings → **Batch migration** → configure options:
   - **Delete original files**: Move originals to trash after successful upload
   - **Backup attachments**: Copy all files to `.eaglebridge-backup/` before migration
   - **Wait time**: Delay between Eagle API calls (default 2s, increase if uploads fail)
   - **Keep temporary files**: Preserve temp copies used during upload
2. Run command: **Upload all Markdown attachments to Eagle**
3. Review the confirmation modal showing file count and attachment count
4. Confirm to start. A notice shows final stats (uploaded, replaced, deleted, errors)

### Download Eagle Attachments to Local

Reverse of batch migration — download Eagle-linked attachments back to a local directory and replace localhost links with relative paths:

1. Go to plugin Settings → **Batch migration** → set **Eagle download directory** (default: `attachment/` in vault root)
2. Run command: **Download Eagle attachments to local (current file)** or **Download Eagle attachments to local (vault-wide)**
3. Choose the download directory in the popup (overrides the default)
4. Confirm to start. Attachments are copied from Eagle library and links are rewritten to relative paths

### Export Markdown with Eagle Attachments

Export a Markdown file with all Eagle localhost links replaced by relative attachment paths:

1. Right-click a `.md` file in the file explorer → **Export Markdown with Eagle attachments**
2. Choose format (Folder or ZIP) and destination path
3. Click Export. The package contains the rewritten `.md` and an `attachment/` folder with all Eagle files

## Development Guide

This plugin follows the structure of the [Obsidian Sample Plugin](https://github.com/obsidianmd/obsidian-sample-plugin). More details can be found there.

- Clone this repository
- Ensure your NodeJS is at least v16 (`node --version`)
- Run `npm i` or `yarn` to install dependencies
- Run `npm run dev` to start the compiler in watch mode


## To-Do List

- [x] Support embedded previews for various file formats (e.g., PDF, MP4, PSD, OBJ, etc.)
- [x] Auto-retry for image loading failures
- [x] Inline audio/video playback for Eagle links
- [x] Mobile LAN viewing support
- [x] Vault-wide batch migration with backup
- [x] Export Markdown with Eagle attachments (folder/ZIP)
- [x] Download Eagle attachments back to local
- [x] i18n support (English / Chinese)
- [ ] Add support for macOS.
- [ ] Support updating position when dragging.

## Known Limitations

Currently, there is no effective method to prevent accidental deletion of attachments when traversing all file references. It is recommended to delete within Eagle and use ID retrieval to remove links in `.md` files.


## Issues and Suggestions

You are welcome to submit issues for:

- Bug reports
- Ideas for new features
- Optimizations for existing features

If you are considering developing a large feature, please contact me first so we can determine if it is a good fit for this plugin.


## Credits
This plugin also utilizes API calls from [eagle](https://api.eagle.cool/) to enable viewing, editing, and uploading of Eagle content.

The right-click functionality and image zooming in this plugin draw inspiration from [AttachFlow](https://github.com/Yaozhuwa/AttachFlow)

Video and PDF external link embedding previews are inspired by the corresponding features of [auto-embed](https://github.com/GnoxNahte/obsidian-auto-embed).

Additionally, it is also inspired by some features from[PicGo+Eagle+Python](https://zhuanlan.zhihu.com/p/695526765), [obsidian-auto-link-title](https://github.com/zolrath/obsidian-auto-link-title) and [obsidian-image-auto-upload-plugin](https://github.com/renmu123/obsidian-image-auto-upload-plugin). 

Additionally, support from the Obsidian forum ([get-the-source-path-when-drag-and-drop-or-copying-a-file-image-from-outside](https://forum.obsidian.md/t/how-to-get-the-source-path-when-drag-and-drop-or-copying-a-file-image-from-outside/96437)) helped in implementing the ability to capture file sources via copying or dragging.


## License

This project is licensed under the [GNU General Public License v3 (GPL-3.0)](https://github.com/zyjGraphein/EagleBridge/blob/master/LICENSE).


## Support

If you appreciate this plugin and want to say thanks, you can buy me a coffee!

<img src="assets/coffee.png" width="400">