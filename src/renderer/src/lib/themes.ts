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
  | 'sakura'
  | 'cyber'
  | 'forest'
  | 'glacier'
  | 'solar'
  | 'orchid'

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
  { id: 'xbox', name: 'Xbox', tagline: 'The classic console green', swatch: ['#0f0f0f', '#2d2d2d', '#107C10'] },
  { id: 'sakura', name: 'Sakura', tagline: 'Ink black, blossom accent', swatch: ['#10080d', '#21131b', '#f472b6'] },
  { id: 'cyber', name: 'Cyber', tagline: 'Blue-black glass, neon cyan', swatch: ['#050c10', '#0d2028', '#22d3ee'] },
  { id: 'forest', name: 'Forest', tagline: 'Pine shadows, moss accent', swatch: ['#07100b', '#132019', '#84cc16'] },
  { id: 'glacier', name: 'Glacier', tagline: 'Cold slate, ice-cyan accent', swatch: ['#081015', '#14222c', '#67e8f9'] },
  { id: 'solar', name: 'Solar', tagline: 'Eclipse black, golden accent', swatch: ['#100f07', '#211f10', '#facc15'] },
  { id: 'orchid', name: 'Orchid', tagline: 'Smoked plum, bright orchid', swatch: ['#0f0913', '#22152b', '#e879f9'] }
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
