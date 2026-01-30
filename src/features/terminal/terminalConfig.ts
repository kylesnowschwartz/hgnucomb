/**
 * Terminal sizing configuration.
 *
 * IMPORTANT: These values must match TerminalPanel.css and xterm.js settings.
 * If you change the terminal font or panel CSS, update these values.
 *
 * The dimension calculation ensures PTY spawns at the correct size BEFORE
 * xterm.js mounts. This prevents a resize race where programs (like Claude Code)
 * read terminal size on startup before FitAddon can resize.
 */

/** Font configuration for xterm.js */
export const TERMINAL_FONT = {
  family: '"JetBrainsMono Nerd Font", "SF Mono", Consolas, monospace',
  size: 14,
  /** Cell dimensions at this font size - measured from xterm.js */
  cellWidth: 8.0,
  cellHeight: 18.0,
} as const;

/**
 * Panel chrome dimensions - must match TerminalPanel.css
 *
 * These offsets are subtracted from panel dimensions to get the usable
 * terminal area that FitAddon measures.
 */
export const PANEL_CHROME = {
  /** .terminal-panel__header height (~11px font + 4px padding + 1px border) */
  headerHeight: 17,
  /** Total border width (1px each side) */
  border: 2,
  /** .terminal-panel__body horizontal padding (4px left + 4px right) */
  bodyPaddingH: 8,
} as const;

/** Minimum terminal dimensions (prevents unusably small terminals) */
export const MIN_TERMINAL = {
  cols: 40,
  rows: 10,
} as const;

/**
 * Calculate terminal cols/rows from panel pixel dimensions.
 * Matches xterm.js FitAddon's calculation to avoid resize on mount.
 */
export function calculateTerminalDimensions(
  panelWidth: number,
  panelHeight: number
): { cols: number; rows: number } {
  const { cellWidth, cellHeight } = TERMINAL_FONT;
  const { headerHeight, border, bodyPaddingH } = PANEL_CHROME;
  const { cols: minCols, rows: minRows } = MIN_TERMINAL;

  // FitAddon measures parentElement's computed dimensions
  const bodyWidth = panelWidth - border - bodyPaddingH;
  const bodyHeight = panelHeight - border - headerHeight;

  return {
    cols: Math.max(minCols, Math.floor(bodyWidth / cellWidth)),
    rows: Math.max(minRows, Math.floor(bodyHeight / cellHeight)),
  };
}
