export type ThemePref = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'stryde-theme'

export function getThemePref(): ThemePref {
  const v = localStorage.getItem(STORAGE_KEY)
  return v === 'light' || v === 'dark' ? v : 'system'
}

function apply(pref: ThemePref) {
  const dark =
    pref === 'dark' ||
    (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

export function setThemePref(pref: ThemePref) {
  if (pref === 'system') localStorage.removeItem(STORAGE_KEY)
  else localStorage.setItem(STORAGE_KEY, pref)
  apply(pref)
}

export function initTheme() {
  apply(getThemePref())
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getThemePref() === 'system') apply('system')
  })
}
