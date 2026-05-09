import en from './locales/en';
import zh from './locales/zh';

type LocaleMap = typeof en;
const locales: Record<string, LocaleMap> = { en, zh };

function getLocale(): string {
	return window.localStorage.getItem('language') || 'en';
}

export function t(key: keyof LocaleMap, params?: Record<string, string | number>): string {
	const locale = getLocale();
	const map = locales[locale] || locales['en'];
	const template = (map[key] as string) || (en[key] as string) || key;

	if (!params) {
		return template;
	}

	return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
		const value = params[name];
		return value !== undefined ? String(value) : `{{${name}}}`;
	});
}
