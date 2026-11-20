// The settings in use, for code outside React components (CodeMirror extensions, helpers).
// App.tsx calls setCurrentUi on every render, like setLanguage.

import { DEFAULT_UI, type UiSettings } from '../../../shared/types'

let current: UiSettings = DEFAULT_UI

export function setCurrentUi(ui: UiSettings): void {
  current = ui
}

export function currentUi(): UiSettings {
  return current
}
