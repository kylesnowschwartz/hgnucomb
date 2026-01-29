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
 */

import type { Keymap } from '../types';

export const vimKeymap: Keymap = {
  id: 'vim',
  name: 'Vim',
  description: 'hjkl + arrows, Shift for diagonals',

  bindings: {
    // ========================================================================
    // Grid mode: navigate the canvas
    // ========================================================================
    grid: {
      // Movement - hjkl
      h: { type: 'navigate', direction: 'w' },
      l: { type: 'navigate', direction: 'e' },
      k: { type: 'navigate_vertical', direction: 'up' },    // Zigzag up
      j: { type: 'navigate_vertical', direction: 'down' },  // Zigzag down
      'Shift+K': { type: 'navigate', direction: 'ne' },     // Diagonal NE
      'Shift+J': { type: 'navigate', direction: 'se' },     // Diagonal SE
      'Shift+H': { type: 'navigate', direction: 'nw' },     // Diagonal NW
      'Shift+L': { type: 'navigate', direction: 'sw' },     // Diagonal SW

      // Movement - arrows
      ArrowLeft: { type: 'navigate', direction: 'w' },
      ArrowRight: { type: 'navigate', direction: 'e' },
      ArrowUp: { type: 'navigate_vertical', direction: 'up' },
      ArrowDown: { type: 'navigate_vertical', direction: 'down' },
      'Shift+ArrowUp': { type: 'navigate', direction: 'ne' },
      'Shift+ArrowDown': { type: 'navigate', direction: 'se' },
      'Shift+ArrowLeft': { type: 'navigate', direction: 'nw' },
      'Shift+ArrowRight': { type: 'navigate', direction: 'sw' },

      // Cmd+arrows - prevent browser back/forward navigation
      'Meta+ArrowLeft': { type: 'navigate', direction: 'w' },
      'Meta+ArrowRight': { type: 'navigate', direction: 'e' },
      'Meta+ArrowUp': { type: 'navigate_vertical', direction: 'up' },
      'Meta+ArrowDown': { type: 'navigate_vertical', direction: 'down' },

      // Utilities
      g: { type: 'select_center' },
      '?': { type: 'show_help' },
    },

    // ========================================================================
    // Selected mode: hex cell focused, can spawn/open/kill
    // ========================================================================
    selected: {
      // Navigation (same as grid)
      h: { type: 'navigate', direction: 'w' },
      l: { type: 'navigate', direction: 'e' },
      k: { type: 'navigate_vertical', direction: 'up' },
      j: { type: 'navigate_vertical', direction: 'down' },
      'Shift+H': { type: 'navigate', direction: 'nw' },
      'Shift+L': { type: 'navigate', direction: 'sw' },

      ArrowLeft: { type: 'navigate', direction: 'w' },
      ArrowRight: { type: 'navigate', direction: 'e' },
      ArrowUp: { type: 'navigate_vertical', direction: 'up' },
      ArrowDown: { type: 'navigate_vertical', direction: 'down' },
      'Shift+ArrowUp': { type: 'navigate', direction: 'ne' },
      'Shift+ArrowDown': { type: 'navigate', direction: 'se' },
      'Shift+ArrowLeft': { type: 'navigate', direction: 'nw' },
      'Shift+ArrowRight': { type: 'navigate', direction: 'sw' },

      // Cmd+arrows - prevent browser back/forward navigation
      'Meta+ArrowLeft': { type: 'navigate', direction: 'w' },
      'Meta+ArrowRight': { type: 'navigate', direction: 'e' },
      'Meta+ArrowUp': { type: 'navigate_vertical', direction: 'up' },
      'Meta+ArrowDown': { type: 'navigate_vertical', direction: 'down' },

      // Cell actions
      Enter: { type: 'open_panel' },
      t: { type: 'spawn', cellType: 'terminal' },
      o: { type: 'spawn', cellType: 'orchestrator' },
      w: { type: 'spawn', cellType: 'worker' },

      // Shift+X to initiate/confirm kill
      'Shift+X': { type: 'kill' },

      // Escape clears selection (also cancels pending kill)
      Escape: { type: 'clear_selection' },

      // Utilities
      g: { type: 'select_center' },
      '?': { type: 'show_help' },
    },

    // ========================================================================
    // Terminal mode: panel open, most keys go to terminal
    // ========================================================================
    terminal: {
      // Cmd+Escape closes panel
      'Meta+Escape': { type: 'close_panel' },

      // Cmd+hjkl for navigation while panel open
      'Meta+h': { type: 'navigate', direction: 'w' },
      'Meta+l': { type: 'navigate', direction: 'e' },
      'Meta+k': { type: 'navigate_vertical', direction: 'up' },
      'Meta+j': { type: 'navigate_vertical', direction: 'down' },

      // Cmd+arrows as alternative
      'Meta+ArrowLeft': { type: 'navigate', direction: 'w' },
      'Meta+ArrowRight': { type: 'navigate', direction: 'e' },
      'Meta+ArrowUp': { type: 'navigate_vertical', direction: 'up' },
      'Meta+ArrowDown': { type: 'navigate_vertical', direction: 'down' },

      // Help
      'Meta+?': { type: 'show_help' },
    },
  },
};
