/**
 * Arrow-keys only keymap.
 *
 * No vim-style hjkl - pure arrow navigation.
 * Up/down move vertically (zigzag), Shift for diagonals.
 */

import type { Keymap } from '../types';

export const arrowsKeymap: Keymap = {
  id: 'arrows',
  name: 'Arrows',
  description: 'Arrow keys only, Shift for diagonals',

  bindings: {
    // ========================================================================
    // Grid mode
    // ========================================================================
    grid: {
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

      // Cmd+Escape is the global toggle
      'Meta+Escape': { type: 'close_panel' },

      g: { type: 'select_center' },
      m: { type: 'toggle_meta_panel' },
      '?': { type: 'show_help' },
    },

    // ========================================================================
    // Selected mode
    // ========================================================================
    selected: {
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

      Enter: { type: 'open_panel' },
      t: { type: 'spawn', cellType: 'terminal' },
      o: { type: 'spawn', cellType: 'orchestrator' },
      w: { type: 'spawn', cellType: 'worker' },
      x: { type: 'kill' },

      Escape: { type: 'clear_selection' },
      'Meta+Escape': { type: 'close_panel' },
      g: { type: 'select_center' },
      m: { type: 'toggle_meta_panel' },
      '?': { type: 'show_help' },
    },

    // ========================================================================
    // Terminal mode
    // ========================================================================
    terminal: {
      // Cmd+Escape closes panel
      'Meta+Escape': { type: 'close_panel' },

      'Meta+ArrowLeft': { type: 'navigate', direction: 'w' },
      'Meta+ArrowRight': { type: 'navigate', direction: 'e' },
      'Meta+ArrowUp': { type: 'navigate_vertical', direction: 'up' },
      'Meta+ArrowDown': { type: 'navigate_vertical', direction: 'down' },

      'Meta+?': { type: 'show_help' },
    },
  },
};
