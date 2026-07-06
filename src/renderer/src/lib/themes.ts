/**
 * Theme registry + applier. Themes are CSS-variable override blocks in
 * app.css keyed by `data-theme` on <html>; this module owns the metadata
 * for the picker and the switch itself.
 */

export type ThemeId = 'obsidian' | 'midnight' | 'carbon' | 'xbox' | 'crimson'

export interface ThemeMeta {
  id: ThemeId
  name: string
  tagline: string
  /** Preview swatches: [background, surface, accent] */
  swatch: [string, string, string]
}

export const THEMES: ThemeMeta[] = [
  { id: 'obsidian', name: 'Obsidian', tagline: 'Near-black, emerald accent', swatch: ['#0a0a0b', '#17171b', '#2f9e6e'] },
  { id: 'midnight', name: 'Midnight', tagline: 'Deep blue, soft indigo accent', swatch: ['#0d1017', '#181e30', '#7aa2f7'] },
  { id: 'carbon', name: 'Carbon', tagline: 'Pure monochrome, zero color', swatch: ['#0a0a0a', '#171717', '#7d8590'] },
  { id: 'xbox', name: 'Xbox', tagline: 'The classic console green', swatch: ['#0f0f0f', '#2d2d2d', '#107C10'] },
  { id: 'crimson', name: 'Crimson', tagline: 'Warm black, red accent', swatch: ['#0d0a0b', '#1a1517', '#d64550'] }
]

export const DEFAULT_THEME: ThemeId = 'obsidian'

let transitionTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Apply a theme. `animate` cross-fades colors (used for user-initiated
 * switches; startup applies instantly).
 */
export function applyTheme(id: ThemeId, animate = false): void {
  const root = document.documentElement
  if (animate) {
    root.classList.add('theme-transition')
    if (transitionTimer) clearTimeout(transitionTimer)
    transitionTimer = setTimeout(() => root.classList.remove('theme-transition'), 300)
  }
  if (id === DEFAULT_THEME) delete root.dataset.theme
  else root.dataset.theme = id
}

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && THEMES.some((t) => t.id === v)
}
