import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LocaleCode } from './locales.js';
import { defaultLocale, locales, isValidLocale } from './locales.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

function loadJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(resolve(__dirname, relativePath), 'utf-8'),
  ) as Record<string, unknown>;
}

const resources: Record<string, Record<string, unknown>> = {
  en: loadJson('./resources/en.json'),
  id: loadJson('./resources/id.json'),
};

/** Fallback policy: requested locale → English → raw key */
function resolveValue(locale: LocaleCode, key: string): string | undefined {
  const keys = key.split('.');
  let value: unknown = resources[locale];
  for (const k of keys) {
    if (value === null || value === undefined || typeof value !== 'object')
      return undefined;
    value = (value as Record<string, unknown>)[k];
  }
  if (typeof value === 'string') return value;

  // Fallback to English
  if (locale !== defaultLocale) {
    let fallback: unknown = resources[defaultLocale];
    for (const k of keys) {
      if (
        fallback === null ||
        fallback === undefined ||
        typeof fallback !== 'object'
      )
        return undefined;
      fallback = (fallback as Record<string, unknown>)[k];
    }
    if (typeof fallback === 'string') return fallback;
  }

  return undefined;
}

export type TranslationInterpolation = Record<string, string | number>;

/**
 * Translate a key for a given locale.
 * Supports dot-notation: t(locale, "nav.newIn")
 * Supports interpolation: t(locale, "catalog.productsCount", { count: 5 })
 * Falls back: locale → English → raw key
 */
export function t(
  locale: string,
  key: string,
  interpolation?: TranslationInterpolation,
): string {
  const localeCode = isValidLocale(locale) ? locale : defaultLocale;
  const value = resolveValue(localeCode, key);

  if (value === undefined) {
    if (process.env.NODE_ENV !== 'production') {
      process.stderr.write(
        `[i18n] Missing translation: "${key}" for locale "${locale}"\n`,
      );
    }
    return key;
  }

  if (!interpolation) return value;

  return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    name in interpolation ? String(interpolation[name]) : `{{${name}}}`,
  );
}

/**
 * Create a bound translator for a specific locale.
 * Returns a function: tt("nav.newIn") or tt("catalog.count", { count: 5 })
 */
export function createTranslator(locale: string) {
  const localeCode = isValidLocale(locale) ? locale : defaultLocale;
  return (key: string, interpolation?: TranslationInterpolation): string =>
    t(localeCode, key, interpolation);
}

/**
 * Get locale display info for templates.
 */
export function getLocaleDisplay(locale: string) {
  const code = isValidLocale(locale) ? locale : defaultLocale;
  return locales[code];
}
