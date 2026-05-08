# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

- `npm run dev` — Start esbuild in watch mode (incremental builds)
- `npm run build` — Type-check then production build (`tsc -noEmit -skipLibCheck && node esbuild.config.mjs production`)
- `npm run version` — Bump version in manifest.json and versions.json
- ESLint is configured via `.eslintrc` (TypeScript-eslint based)

## Architecture Overview

Obsidian plugin that integrates with Eagle (digital asset manager). Communication between Obsidian and Eagle happens through two local HTTP endpoints:
- **Embedded server** (configurable port, default 6060) — serves Eagle library files (images, videos, PDFs) to Obsidian
- **Eagle API** (port 41595) — Eagle desktop app's API for item CRUD and metadata

### Source Layout (`src/`)

| File | Responsibility |
|---|---|
| `main.ts` | Plugin entry point. Registers events (paste, drop, modify, click), commands, views, editor extensions, and the Markdown post-processor. Owns `EagleReferenceIndex` and auto-tag-sync state machine. |
| `server.ts` | Embedded Node.js HTTP server. Serves Eagle library files with range-request support, LAN binding (`0.0.0.0`) for mobile access. Uses chokidar to watch for new uploads. Exports `detectLanIp()`. |
| `setting.ts` | Settings interface, defaults, backward-compat normalization, and the settings tab UI. |
| `urlHandler.ts` | Paste/drop event handling. Uploads files to Eagle via its API (`/api/item/addFromPath`, `/api/item/addBookmark`) and creates Markdown links. Resolves link types (image/audio/video) and appends `?eb_ext=` param for media type detection. |
| `menucall.ts` | Right-click context menus on Eagle images/links. Open in Obsidian/Eagle/default-app, copy links, modify properties, delete attachments. |
| `embed.ts` | `LocalHostEmbedder` class — replaces `<img>` tags with embeds. Uses `<video>`/`<audio>` elements for media files (detected via `?eb_ext=` param), iframes for others (PDF, websites). Exports `isVideoUrl()`, `isAudioUrl()`, `rewriteLocalhostUrl()` for mobile LAN. |
| `embed-state-field.ts` | CodeMirror 6 `StateField` that decorates localhost URLs with embed widgets in the editor. |
| `embed-widget.ts` | CodeMirror 6 `WidgetType` for rendering embedded content inline in editing mode. |
| `imageRetry.ts` | Auto-retry for Eagle images that fail to load: exponential backoff (up to 8 attempts), cache-busting `?eb_retry=` param, WeakSet dedup. |
| `eagleReferenceView.ts` | Custom `ItemView` showing all files (md/canvas) that reference a given Eagle item. Indexes all `.md` and `.canvas` files for Eagle URLs. |
| `eagleDeletion.ts` | Modal for deleting Eagle attachments from Eagle and optionally removing links from current/all files. |
| `eaglePaths.ts` | Path utilities: check if a path is inside Eagle library, resolve library-relative paths. |
| `synchronizedpagetabs.ts` | Bi-directional tag sync — pushes page tags to Eagle items and/or imports Eagle tags into YAML frontmatter. |
| `obsidianLinkSync.ts` | Writes `obsidian://adv-uri` links into Eagle item metadata for back-navigation. |
| `exportMarkdown.ts` | Exports a .md file with all Eagle attachment links replaced by relative paths, bundled as folder or ZIP. |
| `markdownAttachmentBatchUpload.ts` | Scans the current file (or all markdown files for vault-wide mode) for local file references, uploads to Eagle, replaces links, and optionally deletes originals. Supports backup and configurable delay. |
| `canvasHandler.ts` | Canvas integration — paste/drop file handling, auto-normalize Eagle node sizes, embed URLs. |
| `addCommand-config.ts` | Registers plugin commands: tag sync, Obsidian link sync, current-file batch upload, vault-wide batch upload. |
| `onElement.ts` | Utility — register event listener on a selector, returns a deregistration function. |

### Key Patterns

- **Plugin class**: `MyPlugin` extends `obsidian.Plugin`. All features are wired in `onload()` — events registered via `this.registerEvent()`, DOM events via `this.registerDomEvent()`, editor extensions via `this.registerEditorExtension()`.
- **Eagle API calls**: Direct `fetch()` to `http://localhost:41595/api/item/*`. No SDK.
- **Image handling**: Images from Eagle are served as `<img>` tags via the embedded server. Right-click context menus are registered via `onElement()` on `img` and `a.external-link` selectors. Auto-retry with cache-busting on load failure (`imageRetry.ts`).
- **Media embedding**: Audio/video Eagle links are rendered as native `<audio>`/`<video>` elements (not iframes), detected via `?eb_ext=` URL parameter. Other non-image files (PDF, websites) use iframes.
- **Mobile compatibility**: All Electron/Node.js dependencies are guarded with `Platform.isDesktopApp` or try/catch. On mobile, localhost URLs are rewritten to LAN IP for server access.
- **Vault-wide batch migration**: `uploadVaultMarkdownAttachmentsToEagle()` scans all markdown files, shows confirmation modal, supports backup to `.eaglebridge-backup/`, and respects per-setting delete/backup/delay/temp options.
- **Settings**: Flat `MyPluginSettings` interface with migration helpers (`normalizeAttachmentTagSyncMode`, `normalizeUploadSettings`) for backward compatibility.
- **Path safety**: All file serving validates paths are inside the Eagle library `images/` directory (`isPathInsideDirectory`).

### External Resources

- `eagle_to_ob/` — Standalone HTML/CSS panel used as an Eagle plugin (loaded inside Eagle's inspector panel)
- Obsidian API: `obsidian` module (latest)
- CodeMirror 6: `@codemirror/language`, `@codemirror/state`, `@codemirror/view`

### Notable Design Decisions

- The embedded server uses chokidar to watch for new image folders — when Eagle creates a new item, the server detects the new directory and emits the URL so paste/drop handlers can wait for it.
- Tag sync uses a debounced (600ms) state machine that tracks `FileTagSyncState` per file — compares previous vs current state to determine what changed.
- `exportMarkdown` uses Electron's `dialog` API for native file picker (showOpenDialog/showSaveDialog) and falls back to manual path input if unavailable.
- Canvas support mirrors the markdown paste/drop flow but creates canvas-specific nodes instead of Markdown links.
