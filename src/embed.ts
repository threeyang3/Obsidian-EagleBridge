const AUDIO_EXTENSIONS = new Set([
	'.mp3', '.ogg', '.wav', '.flac', '.aac', '.m4a',
	'.m4b', '.wma', '.opus', '.weba', '.oga',
]);
const VIDEO_EXTENSIONS = new Set([
	'.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v',
	'.wmv', '.flv', '.mpeg', '.mpg', '.3gp',
]);

export function isURL(str: string): boolean {
	let url: URL;
	try {
		url = new URL(str);
	} catch {
		return false;
	}
	return url.protocol === "http:" || url.protocol === "https:";
}

export function isLocalHostLink(str: string): boolean {
	try {
		const url = new URL(str);
		return url.hostname === "localhost" || url.hostname === "127.0.0.1";
	} catch {
		return false;
	}
}

export function isAltTextImage(alt: string): boolean {
	const mainPart = alt.split('|')[0].trim();
	if (!mainPart) {
		return false;
	}
	return /^.+?\.(jpg|jpeg|png|gif|webp|svg|avif|bmp|ico)(?=$|[\s#\[{(])/i.test(mainPart);
}

export function rewriteLocalhostUrl(url: string, lanIp: string, port: number): string {
	if (!lanIp) return url;
	try {
		const parsed = new URL(url);
		if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
			parsed.hostname = lanIp;
			parsed.port = port.toString();
			return parsed.toString();
		}
	} catch {
		// not a valid URL
	}
	return url;
}

function getExtensionFromUrl(src: string): string {
	try {
		const url = new URL(src);
		const extParam = url.searchParams.get('eb_ext');
		if (extParam) return extParam.toLowerCase();
	} catch {
		// ignore
	}
	return '';
}

export function isVideoUrl(src: string): boolean {
	const ext = getExtensionFromUrl(src);
	return VIDEO_EXTENSIONS.has(ext);
}

export function isAudioUrl(src: string): boolean {
	const ext = getExtensionFromUrl(src);
	return AUDIO_EXTENSIONS.has(ext);
}

export interface EmbedResult {
	containerEl: HTMLElement;
	iframeEl?: HTMLIFrameElement;
}

export class LocalHostEmbedder {
	create(src: string): EmbedResult {
		const container = document.createElement('div');
		container.className = "eagle-embed-container";

		if (isVideoUrl(src)) {
			const video = document.createElement('video');
			video.src = src;
			video.controls = true;
			video.preload = "metadata";
			video.playsInline = true;
			video.style.width = "100%";
			video.style.maxHeight = "500px";
			video.style.background = "#000";
			container.appendChild(video);
			return { containerEl: container };
		}

		if (isAudioUrl(src)) {
			const audio = document.createElement('audio');
			audio.src = src;
			audio.controls = true;
			audio.preload = "metadata";
			audio.style.width = "100%";
			container.appendChild(audio);
			return { containerEl: container };
		}

		const iframe = document.createElement('iframe');
		iframe.src = src;
		iframe.width = "100%";
		iframe.height = "500px";
		iframe.style.border = "none";
		iframe.setAttribute("allowfullscreen", "true");
		iframe.setAttribute("loading", "lazy");
		container.appendChild(iframe);

		return {
			containerEl: container,
			iframeEl: iframe,
		};
	}

	shouldEmbed(src: string, alt?: string): boolean {
		if (alt && isAltTextImage(alt)) {
			console.log(`[Eagle-Embed] 跳过图片嵌入: ${alt}, URL: ${src}`);
			return false;
		}
		return isLocalHostLink(src);
	}
}

export const embedManager = new LocalHostEmbedder();
