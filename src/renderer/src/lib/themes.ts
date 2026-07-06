/**
 * Theme registry + applier. Themes are CSS-variable override blocks in
 * app.css keyed by `data-theme` on <html>; this module owns the metadata
 * for the picker and the switch itself.
 */

export type ThemeId =
  | 'obsidian'
  | 'midnight'
  | 'carbon'
  | 'xbox'
  | 'crimson'
  | 'aurora'
  | 'violet'
  | 'ember'
  | 'ocean'

export interface ThemeMeta {
  id: ThemeId
  name: string
  tagline: string
  /** Preview swatches: [background, surface, accent] */
  swatch: [string, string, string]
}

export const THEMES: ThemeMeta[] = [
  { id: 'crimson', name: 'Crimson', tagline: 'Warm black, red accent', swatch: ['#0d0a0b', '#1a1517', '#d64550'] },
  { id: 'obsidian', name: 'Obsidian', tagline: 'Near-black, emerald accent', swatch: ['#0a0a0b', '#17171b', '#2f9e6e'] },
  { id: 'midnight', name: 'Midnight', tagline: 'Deep blue, soft indigo accent', swatch: ['#0d1017', '#181e30', '#7aa2f7'] },
  { id: 'aurora', name: 'Aurora', tagline: 'Sea-glass teal on deep slate', swatch: ['#081011', '#131d20', '#2dd4bf'] },
  { id: 'ocean', name: 'Ocean', tagline: 'Abyssal blue, sky accent', swatch: ['#071019', '#101e2e', '#38bdf8'] },
  { id: 'violet', name: 'Violet', tagline: 'Dusky purple, lavender accent', swatch: ['#0d0a14', '#1a1527', '#a78bfa'] },
  { id: 'ember', name: 'Ember', tagline: 'Charcoal, molten amber accent', swatch: ['#100c08', '#1e1710', '#f59e0b'] },
  { id: 'carbon', name: 'Carbon', tagline: 'Pure monochrome, zero color', swatch: ['#0a0a0a', '#171717', '#7d8590'] },
  { id: 'xbox', name: 'Xbox', tagline: 'The classic console green', swatch: ['#0f0f0f', '#2d2d2d', '#107C10'] }
]

export const DEFAULT_THEME: ThemeId = 'crimson'

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
  // 'obsidian' is the base token set in @theme — no attribute needed.
  // Every other theme (including the default) is an override block.
  if (id === 'obsidian') delete root.dataset.theme
  else root.dataset.theme = id
}

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && THEMES.some((t) => t.id === v)
}
