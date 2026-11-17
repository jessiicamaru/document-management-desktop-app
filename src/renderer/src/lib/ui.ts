// Applies appearance settings to the page as CSS variables (see styles.css).
// Light/dark itself is switched by the main process (nativeTheme), which also makes
// `prefers-color-scheme` follow the setting inside documents.

import type { UiSettings } from '../../../shared/types'
import { t } from '../../../shared/i18n'

const WIDTHS: Record<UiSettings['readingWidth'], string> = { narrow: '680px', normal: '800px', wide: '1040px' }
const FONTS: Record<UiSettings['readingFont'], string> = {
  sans: 'var(--font)',
  serif: "Georgia, Cambria, 'Times New Roman', serif"
}

export function applyUiSettings(ui: UiSettings): void {
  const root = document.documentElement.style
  root.setProperty('--accent-base', ui.accent)
  root.setProperty('--read-size', `${ui.readingSize}px`)
  root.setProperty('--read-width', WIDTHS[ui.readingWidth])
  root.setProperty('--read-font', FONTS[ui.readingFont])
  // Read by EpubView, which also watches it to switch right away.
  document.documentElement.dataset.epubSpread = ui.epubSpread
  document.documentElement.lang = ui.language
}

/** "5 phút trước", "hôm qua"... */
export function timeAgo(ts: number, now = Date.now()): string {
  const min = Math.round((now - ts) / 60000)
  if (min < 1) return t('vừa xong')
  if (min < 60) return t('{0} phút trước', { 0: min })
  const h = Math.round(min / 60)
  if (h < 24) return t('{0} giờ trước', { 0: h })
  const d = Math.round(h / 24)
  if (d === 1) return t('hôm qua')
  if (d < 30) return t('{0} ngày trước', { 0: d })
  return new Date(ts).toLocaleDateString('vi-VN')
}
