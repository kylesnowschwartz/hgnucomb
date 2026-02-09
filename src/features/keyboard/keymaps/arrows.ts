/**
 * Arrow-keys only keymap.
 *
 * No vim-style hjkl -- pure arrow navigation.
 * Up/down move vertically (zigzag), Shift for diagonals.
 *
 * Navigation bindings are shared constants -- add new nav combos to the
 * constants below, NOT to individual mode objects.
 */

import type { Keymap, KeyCombo, KeyAction } from '../types';

// ---------------------------------------------------------------------------
// Shared navigation constants (grid + selected modes spread these in)
// ---------------------------------------------------------------------------

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

export const arrowsKeymap: Keymap = {
  id: 'arrows',
  name: 'Arrows',
  description: 'Arrow keys only, Shift for diagonals',

  bindings: {
    // ========================================================================
    // Grid mode
    // ========================================================================
    grid: {
      ...NAV_ARROWS,
      ...NAV_META_ARROWS,
      'Meta+Escape': { type: 'close_panel' },
      ...UTILITIES,
    },

    // ========================================================================
    // Selected mode
    // ========================================================================
    selected: {
      ...NAV_ARROWS,
      ...NAV_META_ARROWS,

      Enter: { type: 'open_panel' },
      t: { type: 'spawn', cellType: 'terminal' },
      o: { type: 'spawn', cellType: 'orchestrator' },
      w: { type: 'spawn', cellType: 'worker' },
      'Meta+t': { type: 'spawn', cellType: 'terminal' },
      'Meta+o': { type: 'spawn', cellType: 'orchestrator' },
      'Meta+w': { type: 'spawn', cellType: 'worker' },
      x: { type: 'kill' },

      Escape: { type: 'clear_selection' },
      'Meta+Escape': { type: 'close_panel' },
      ...UTILITIES,
    },

    // ========================================================================
    // Terminal mode: leader+ combos pass through xterm
    // ========================================================================
    terminal: {
      'Meta+Escape': { type: 'close_panel' },
      ...NAV_META_ARROWS,

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
