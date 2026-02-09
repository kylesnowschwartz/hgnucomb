/**
 * Catppuccin Latte theme
 * Source: https://github.com/catppuccin/palette (MIT License)
 *
 * "Muted neon on white" - vibrant accents on a cool off-white base
 */

// Base palette - all colors from Catppuccin Latte
export const palette = {
  // Accent colors (the "neon")
  rosewater: '#dc8a78',
  flamingo: '#dd7878',
  pink: '#ea76cb',
  mauve: '#8839ef',
  red: '#d20f39',
  maroon: '#e64553',
  peach: '#fe640b',
  yellow: '#df8e1d',
  green: '#40a02b',
  teal: '#179299',
  sky: '#04a5e5',
  sapphire: '#209fb5',
  blue: '#1e66f5',
  lavender: '#7287fd',

  // Monochromatic (UI structure)
  text: '#4c4f69',
  subtext1: '#5c5f77',
  subtext0: '#6c6f85',
  overlay2: '#7c7f93',
  overlay1: '#8c8fa1',
  overlay0: '#9ca0b0',
  surface2: '#acb0be',
  surface1: '#bcc0cc',
  surface0: '#ccd0da',
  base: '#eff1f5',
  mantle: '#e6e9ef',
  crust: '#dce0e8',
} as const;

// ANSI colors for terminal emulators (xterm.js)
export const ansi = {
  black: '#5c5f77',
  red: '#d20f39',
  green: '#40a02b',
  yellow: '#df8e1d',
  blue: '#1e66f5',
  magenta: '#ea76cb',
  cyan: '#179299',
  white: '#acb0be',
  brightBlack: '#6c6f85',
  brightRed: '#de293e',
  brightGreen: '#49af3d',
  brightYellow: '#eea02d',
  brightBlue: '#456eff',
  brightMagenta: '#fe85d8',
  brightCyan: '#2d9fa8',
  brightWhite: '#bcc0cc',
} as const;

// xterm.js ITheme configuration
export const xtermTheme = {
  foreground: palette.text,
  background: palette.base,
  cursor: palette.text,
  cursorAccent: palette.base,
  selectionBackground: palette.surface2,
  selectionForeground: palette.text,

  black: ansi.black,
  red: ansi.red,
  green: ansi.green,
  yellow: ansi.yellow,
  blue: ansi.blue,
  magenta: ansi.magenta,
  cyan: ansi.cyan,
  white: ansi.white,

  brightBlack: ansi.brightBlack,
  brightRed: ansi.brightRed,
  brightGreen: ansi.brightGreen,
  brightYellow: ansi.brightYellow,
  brightBlue: ansi.brightBlue,
  brightMagenta: ansi.brightMagenta,
  brightCyan: ansi.brightCyan,
  brightWhite: ansi.brightWhite,
} as const;

// Agent type colors (for hex grid)
export const agentColors = {
  terminal: palette.teal,
  orchestrator: palette.blue,
  worker: palette.green,
  // Connection lines between agents
  connection: palette.overlay0,
} as const;

// Hex grid specific
export const hexGrid = {
  background: palette.mantle,
  hexFill: palette.base,
  hexFillHover: palette.surface0, // Subtle fill when cell is selected
  hexStroke: palette.surface1,
  originMarker: palette.overlay0,
  accentNeon: '#ffaa6e', // Electric peach - intentionally outside Catppuccin palette for max contrast
} as const;
