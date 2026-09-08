export interface LocaleConfig {
  code: string;
  name: string;
  htmlLang: string;
  default: boolean;
  /** URL path segment — empty string for default locale */
  pathPrefix: string;
}

export type LocaleCode = 'en' | 'id';

export const locales: Record<LocaleCode, LocaleConfig> = {
  en: {
    code: 'en',
    name: 'English',
    htmlLang: 'en',
    default: true,
    pathPrefix: '',
  },
  id: {
    code: 'id',
    name: 'Bahasa Indonesia',
    htmlLang: 'id-ID',
    default: false,
    pathPrefix: '/id',
  },
};

export const defaultLocale: LocaleCode = 'en';

export const supportedLocaleCodes = Object.keys(locales) as LocaleCode[];

/** Ordered list: default first, then others */
export const orderedLocales: LocaleConfig[] = [
  locales[defaultLocale],
  ...supportedLocaleCodes
    .filter((c) => c !== defaultLocale)
    .map((c) => locales[c]),
];

export function isValidLocale(code: string): code is LocaleCode {
  return code in locales;
}

export function getLocale(code: string): LocaleConfig | undefined {
  return isValidLocale(code) ? locales[code] : undefined;
}
