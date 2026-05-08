const MAX_RETRIES = 8;
const listenedElements = new WeakSet<Element>();

function computeBackoff(retryCount: number): number {
	return Math.min(2000, 120 + retryCount * 180);
}

function getEagleInfoUrl(rawUrl: string): string {
	if (!rawUrl) return '';
	const match = String(rawUrl).trim().match(
		/https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/images\/[^/?#\s]+\.info(?:[?#][^\s)]*)?/i
	);
	return match?.[0] ?? '';
}

export function setupEagleImageAutoRetry(
	element: HTMLImageElement | HTMLIFrameElement,
	url: string,
): void {
	if (!element || listenedElements.has(element)) return;

	const infoUrl = getEagleInfoUrl(url);
	if (!infoUrl) return;

	listenedElements.add(element);
	element.dataset.eagleBridgeRetryBase = infoUrl;
	element.dataset.eagleBridgeRetryCount = '0';

	const scheduleRetry = () => {
		if (!element.isConnected) return;

		const count = Number(element.dataset.eagleBridgeRetryCount || '0');
		if (!Number.isFinite(count) || count >= MAX_RETRIES) return;

		element.dataset.eagleBridgeRetryCount = String(count + 1);
		const delay = computeBackoff(count);

		setTimeout(() => {
			if (!element.isConnected) return;

			const base = element.dataset.eagleBridgeRetryBase || infoUrl;
			try {
				const u = new URL(base);
				u.searchParams.set('eb_retry', String(Date.now()));
				(element as HTMLImageElement).src = u.toString();
			} catch {
				const sep = base.includes('?') ? '&' : '?';
				(element as HTMLImageElement).src = `${base}${sep}eb_retry=${Date.now()}`;
			}
		}, delay);
	};

	element.addEventListener('error', scheduleRetry);
}
