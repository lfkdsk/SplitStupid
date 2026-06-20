// Design tokens mirrored from the web's styles.css — both the light `:root`
// palette and the dark `@media (prefers-color-scheme: dark)` one. The active
// palette is picked from the system appearance at launch so the native UI
// matches the web for a given system setting.
//
// Note: picked once at module load (StyleSheet.create is static), so it
// follows the system light/dark setting on app *restart*. Live-switching
// would mean refactoring each screen's styles into a useTheme() hook — a
// follow-up, not needed for parity with the web's current look.
import { Appearance } from 'react-native'

interface Palette {
  bg: string
  bgElevated: string
  bgSubtle: string
  fg: string
  fgMuted: string
  fgSubtle: string
  border: string
  borderStrong: string
  accent: string
  accentHover: string
  accentBg: string
  accentFg: string
  positive: string
  positiveBg: string
  negative: string
  negativeBg: string
}

const light: Palette = {
  bg: '#faf6ef',
  bgElevated: '#ffffff',
  bgSubtle: '#f3ece0',
  fg: '#1a1410',
  fgMuted: '#6f6356',
  fgSubtle: '#a89c8b',
  border: 'rgba(26, 20, 16, 0.10)',
  borderStrong: 'rgba(26, 20, 16, 0.22)',
  accent: '#c2410c',
  accentHover: '#9a3412',
  accentBg: 'rgba(194, 65, 12, 0.08)',
  accentFg: '#fff8f1',
  positive: '#3f6212',
  positiveBg: 'rgba(63, 98, 18, 0.10)',
  negative: '#9f1239',
  negativeBg: 'rgba(159, 18, 57, 0.08)',
}

const dark: Palette = {
  bg: '#15110d',
  bgElevated: '#1f1a14',
  bgSubtle: '#2a241c',
  fg: '#f4ede1',
  fgMuted: '#a89c8b',
  fgSubtle: '#6f6356',
  border: 'rgba(244, 237, 225, 0.10)',
  borderStrong: 'rgba(244, 237, 225, 0.22)',
  accent: '#fb923c',
  accentHover: '#fdba74',
  accentBg: 'rgba(251, 146, 60, 0.14)',
  accentFg: '#15110d',
  positive: '#a3e635',
  positiveBg: 'rgba(163, 230, 53, 0.14)',
  negative: '#fda4af',
  negativeBg: 'rgba(253, 164, 175, 0.14)',
}

export const isDark = (Appearance.getColorScheme() ?? 'light') === 'dark'
export const colors: Palette = isDark ? dark : light

export const radius = { sm: 4, md: 8, lg: 12, full: 9999 } as const

// The web's three faces — bundled .ttf, loaded via expo-font in App.tsx.
// (Variable fonts; iOS resolves fontWeight against the weight axis.)
export const fonts = {
  sans: 'Inter',
  display: 'Fraunces',
  mono: 'JetBrainsMono',
} as const

export const space = (n: number) => n * 4
