/**
 * Catppuccin Mocha theme (dark, high contrast)
 * Source: https://github.com/catppuccin/palette (MIT License)
 */

// Base palette - all colors from Catppuccin Mocha
export const palette = {
  // Accent colors
  rosewater: '#f5e0dc',
  flamingo: '#f2cdcd',
  pink: '#f5c2e7',
  mauve: '#cba6f7',
  red: '#f38ba8',
  maroon: '#eba0ac',
  peach: '#fab387',
  yellow: '#f9e2af',
  green: '#a6e3a1',
  teal: '#94e2d5',
  sky: '#89dceb',
  sapphire: '#74c7ec',
  blue: '#89b4fa',
  lavender: '#b4befe',

  // Monochromatic (UI structure)
  text: '#cdd6f4',
  subtext1: '#bac2de',
  subtext0: '#a6adc8',
  overlay2: '#9399b2',
  overlay1: '#7f849c',
  overlay0: '#6c7086',
  surface2: '#585b70',
  surface1: '#45475a',
  surface0: '#313244',
  base: '#1e1e2e',
  mantle: '#181825',
  crust: '#11111b',
} as const;

// ANSI colors for terminal emulators (xterm.js)
export const ansi = {
  black: '#45475a',
  red: '#f38ba8',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  blue: '#89b4fa',
  magenta: '#f5c2e7',
  cyan: '#94e2d5',
  white: '#a6adc8',
  brightBlack: '#585b70',
  brightRed: '#f37799',
  brightGreen: '#89d88b',
  brightYellow: '#ebd391',
  brightBlue: '#74a8fc',
  brightMagenta: '#f2aede',
  brightCyan: '#6bd7ca',
  brightWhite: '#bac2de',
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

// Semantic UI colors
export const ui = {
  // Backgrounds
  background: palette.base,
  backgroundAlt: palette.mantle,
  backgroundMuted: palette.crust,

  // Surfaces (cards, panels, interactive elements)
  surface: palette.surface0,
  surfaceHover: palette.surface1,
  surfaceActive: palette.surface2,

  // Text
  textPrimary: palette.text,
  textSecondary: palette.subtext1,
  textMuted: palette.subtext0,
  textDisabled: palette.overlay0,

  // Borders
  border: palette.surface0,
  borderSubtle: palette.surface1,
  borderStrong: palette.overlay0,

  // States
  error: palette.red,
  errorMuted: palette.maroon,
  warning: palette.peach,
  warningMuted: palette.yellow,
  success: palette.green,
  successMuted: palette.teal,
  info: palette.blue,
  infoMuted: palette.sapphire,

  // Interactive
  link: palette.sapphire,
  linkHover: palette.blue,
  focus: palette.lavender,
  selection: palette.pink,
} as const;

// Agent type colors (for hex grid)
export const agentColors = {
  orchestrator: palette.blue,
  worker: palette.green,
  specialist: palette.mauve,
  // Connection lines between agents
  connection: palette.overlay0,
  connectionActive: palette.sapphire,
} as const;

// Hex grid specific
export const hexGrid = {
  background: palette.mantle,
  hexFill: palette.base,
  hexFillHover: palette.surface0, // Subtle fill when hovering empty cell
  hexStroke: palette.surface1,
  hexStrokeSelected: palette.pink,
  hexStrokeHover: palette.lavender,
  hexStrokeOrchestrator: palette.sapphire, // Distinct border for orchestrator cells
  hexStrokeWorker: palette.teal, // Distinct border for worker cells
  originMarker: palette.overlay0,
} as const;
