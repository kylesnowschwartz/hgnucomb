/**
 * Vim-style keymap: hjkl navigation with shift for diagonals.
 *
 * Direction mapping:
 *        NW    NE          Shift+k    Shift+l
 *         \    /              \          /
 *     W ----+---- E      h ----+---- l (no shift = E)
 *         /    \              /          \
 *        SW    SE          Shift+j    (Shift+; if needed)
 *
 * Up/down (k/j) move vertically in a zigzag pattern.
 * Shift+k/j move diagonally (NE/SE).
 *
 * Navigation bindings are shared constants -- add new nav combos to the
 * constants below, NOT to individual mode objects.
 */

import type { Keymap, KeyCombo, KeyAction } from '../types';

// ---------------------------------------------------------------------------
// Shared navigation constants (grid + selected modes spread these in)
// ---------------------------------------------------------------------------

/** hjkl cardinal + Shift diagonals */
const NAV_HJKL: Record<KeyCombo, KeyAction> = {
  h: { type: 'navigate', direction: 'w' },
  l: { type: 'navigate', direction: 'e' },
  k: { type: 'navigate_vertical', direction: 'up' },
  j: { type: 'navigate_vertical', direction: 'down' },
  'Shift+K': { type: 'navigate', direction: 'ne' },
  'Shift+J': { type: 'navigate', direction: 'se' },
  'Shift+H': { type: 'navigate', direction: 'nw' },
  'Shift+L': { type: 'navigate', direction: 'sw' },
};

/** Arrow keys cardinal + Shift diagonals */
const NAV_ARROWS: Record<KeyCombo, KeyAction> = {
  ArrowLeft: { type: 'navigate', direction: 'w' },
  ArrowRight: { type: 'navigate', direction: 'e' },
  ArrowUp: { type: 'navigate_vertical', direction: 'up' },
  ArrowDown: { type: 'navigate_vertical', direction: 'down' },
  'Shift+ArrowUp': { type: 'navigate', direction: 'ne' },
  'Shift+ArrowDown': { type: 'navigate', direction: 'se' },
  'Shift+ArrowLeft': { type: 'navigate', direction: 'nw' },
  'Shift+ArrowRight': { type: 'navigate', direction: 'sw' },
};

/** Cmd+arrows -- prevents browser back/forward, navigates grid instead */
const NAV_META_ARROWS: Record<KeyCombo, KeyAction> = {
  'Meta+ArrowLeft': { type: 'navigate', direction: 'w' },
  'Meta+ArrowRight': { type: 'navigate', direction: 'e' },
  'Meta+ArrowUp': { type: 'navigate_vertical', direction: 'up' },
  'Meta+ArrowDown': { type: 'navigate_vertical', direction: 'down' },
};

/** Leader+hjkl navigation -- usable in terminal mode */
const NAV_META_HJKL: Record<KeyCombo, KeyAction> = {
  'Meta+h': { type: 'navigate', direction: 'w' },
  'Meta+l': { type: 'navigate', direction: 'e' },
  'Meta+k': { type: 'navigate_vertical', direction: 'up' },
  'Meta+j': { type: 'navigate_vertical', direction: 'down' },
  'Meta+Shift+K': { type: 'navigate', direction: 'ne' },
  'Meta+Shift+J': { type: 'navigate', direction: 'se' },
  'Meta+Shift+H': { type: 'navigate', direction: 'nw' },
  'Meta+Shift+L': { type: 'navigate', direction: 'sw' },
};

/** Utilities shared across grid and selected modes */
const UTILITIES: Record<KeyCombo, KeyAction> = {
  g: { type: 'select_center' },
  m: { type: 'toggle_meta_panel' },
  '?': { type: 'show_help' },
};

/** Leader+ utilities -- usable in terminal mode */
const META_UTILITIES: Record<KeyCombo, KeyAction> = {
  'Meta+g': { type: 'select_center' },
  'Meta+m': { type: 'toggle_meta_panel' },
};

// ---------------------------------------------------------------------------
// Keymap definition
// ---------------------------------------------------------------------------

export const vimKeymap: Keymap = {
  id: 'vim',
  name: 'Vim',
  description: 'hjkl + arrows, Shift for diagonals',

  bindings: {
    // ========================================================================
    // Grid mode: navigate the canvas
    // ========================================================================
    grid: {
      ...NAV_HJKL,
      ...NAV_ARROWS,
      ...NAV_META_ARROWS,
      'Meta+Escape': { type: 'close_panel' },
      ...UTILITIES,
    },

    // ========================================================================
    // Selected mode: hex cell focused, can spawn/open/kill
    // ========================================================================
    selected: {
      ...NAV_HJKL,
      ...NAV_ARROWS,
      ...NAV_META_ARROWS,

      // Cell actions
      Enter: { type: 'open_panel' },
      t: { type: 'spawn', cellType: 'terminal' },
      o: { type: 'spawn', cellType: 'orchestrator' },
      w: { type: 'spawn', cellType: 'worker' },
      'Meta+t': { type: 'spawn', cellType: 'terminal' },
      'Meta+o': { type: 'spawn', cellType: 'orchestrator' },
      'Meta+w': { type: 'spawn', cellType: 'worker' },

      // x to initiate/confirm kill (lowercase, no modifier -- won't steal from terminal)
      x: { type: 'kill' },

      // Escape clears selection (also cancels pending kill)
      // When panel is open, this closes the panel first
      Escape: { type: 'clear_selection' },

      // Cmd+Escape is the global toggle -- closes panel if open
      'Meta+Escape': { type: 'close_panel' },

      ...UTILITIES,
    },

    // ========================================================================
    // Terminal mode: panel open, most keys go to terminal.
    // Leader+ combos pass through xterm to reach the keymap router.
    // ========================================================================
    terminal: {
      'Meta+Escape': { type: 'close_panel' },

      // Navigation: arrows and hjkl with leader
      ...NAV_META_ARROWS,
      ...NAV_META_HJKL,

      // Actions available via leader key
      'Meta+Enter': { type: 'open_panel' },
      'Meta+x': { type: 'kill' },

      // Spawn from terminal mode
      'Meta+t': { type: 'spawn', cellType: 'terminal' },
      'Meta+o': { type: 'spawn', cellType: 'orchestrator' },
      'Meta+w': { type: 'spawn', cellType: 'worker' },

      // Utilities
      ...META_UTILITIES,
      'Meta+?': { type: 'show_help' },
    },
  },
};
