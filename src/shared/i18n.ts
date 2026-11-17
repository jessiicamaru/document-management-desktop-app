// Interface language: Vietnamese (the language the app is written in) or English.
//
// Every text the app shows is written in Vietnamese in the code, wrapped in t():
//   t('Đang quét thư mục…')
//   t('Đã đổi tag ở {0} bài', { 0: n })      // {0}, {1}... are filled in
// In English, t() looks the Vietnamese text up in locales/en.ts; a text that has no
// translation yet is shown in Vietnamese rather than not at all.
//
// The main process and the window each have their own copy of this module; both are told
// the language from Settings (setLanguage).

import { EN } from './locales/en'

export type Language = 'vi' | 'en'

let current: Language = 'vi'

export function setLanguage(lang: Language): void {
  current = lang
}

export function getLanguage(): Language {
  return current
}

/** The default for a new install: Vietnamese on a Vietnamese Windows, otherwise English. */
export function languageForLocale(locale: string): Language {
  return locale.toLowerCase().startsWith('vi') ? 'vi' : 'en'
}

export function t(vi: string, vars?: Record<string | number, unknown>): string {
  const text = current === 'en' ? (EN[vi] ?? vi) : vi
  return vars ? text.replace(/\{(\w+)\}/g, (all, key: string) => (key in vars ? String(vars[key]) : all)) : text
}
