export type ThemePref = 'dark' | 'light' | 'system'

const KEY = 'texpad_theme'

export function getThemePref(): ThemePref {
  const v = localStorage.getItem(KEY)
  if (v === 'light' || v === 'dark' || v === 'system') return v
  return 'dark'
}

export function setThemePref(p: ThemePref) {
  localStorage.setItem(KEY, p)
  applyTheme(p)
}

export function effectiveTheme(p: ThemePref): 'dark' | 'light' {
  if (p === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  }
  return p
}

/** Applies resolved light/dark to `document.documentElement` for CSS. */
export function applyTheme(p: ThemePref) {
  document.documentElement.dataset.theme = effectiveTheme(p)
  document.documentElement.dataset.themePref = p
}

export function initTheme() {
  applyTheme(getThemePref())
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (getThemePref() === 'system') applyTheme('system')
  })
}
