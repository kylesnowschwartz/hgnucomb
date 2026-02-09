import { describe, it, expect } from 'vitest';
import { serializeKey } from './types';
import { getNeighborInDirection, getVerticalDirection, ALL_DIRECTIONS } from './directions';
import { KEYMAPS, DEFAULT_KEYMAP_ID } from './keymaps';
import type { HexCoordinate } from '@shared/types';

// =============================================================================
// serializeKey
// =============================================================================

describe('serializeKey', () => {
  function mockKeyEvent(key: string, modifiers: Partial<{
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
  }> = {}): KeyboardEvent {
    return {
      key,
      metaKey: modifiers.metaKey ?? false,
      ctrlKey: modifiers.ctrlKey ?? false,
      altKey: modifiers.altKey ?? false,
      shiftKey: modifiers.shiftKey ?? false,
    } as KeyboardEvent;
  }

  it('serializes plain letter keys', () => {
    expect(serializeKey(mockKeyEvent('h'))).toBe('h');
    expect(serializeKey(mockKeyEvent('j'))).toBe('j');
    expect(serializeKey(mockKeyEvent('k'))).toBe('k');
    expect(serializeKey(mockKeyEvent('l'))).toBe('l');
  });

  it('serializes special keys', () => {
    expect(serializeKey(mockKeyEvent('Escape'))).toBe('Escape');
    expect(serializeKey(mockKeyEvent('Enter'))).toBe('Enter');
    expect(serializeKey(mockKeyEvent('ArrowUp'))).toBe('ArrowUp');
    expect(serializeKey(mockKeyEvent('ArrowDown'))).toBe('ArrowDown');
  });

  it('includes Shift modifier', () => {
    expect(serializeKey(mockKeyEvent('k', { shiftKey: true }))).toBe('Shift+k');
    expect(serializeKey(mockKeyEvent('X', { shiftKey: true }))).toBe('Shift+X');
  });

  it('returns empty string for pure modifier key presses', () => {
    expect(serializeKey(mockKeyEvent('Meta', { metaKey: true }), true)).toBe('');
    expect(serializeKey(mockKeyEvent('Shift', { shiftKey: true }))).toBe('');
    expect(serializeKey(mockKeyEvent('Control', { ctrlKey: true }))).toBe('');
    expect(serializeKey(mockKeyEvent('Alt', { altKey: true }))).toBe('');
  });

  it('serializes Meta modifier via tracked state', () => {
    expect(serializeKey(mockKeyEvent('h', { metaKey: true }), true)).toBe('Meta+h');
    expect(serializeKey(mockKeyEvent('Escape', { metaKey: true }), true)).toBe('Meta+Escape');
  });

  it('does not include Meta when tracked state says false', () => {
    expect(serializeKey(mockKeyEvent('h'), false)).toBe('h');
  });

  it('preserves Shift alongside Meta', () => {
    expect(serializeKey(
      mockKeyEvent('K', { metaKey: true, shiftKey: true }), true
    )).toBe('Meta+Shift+K');
  });

  it('handles ? key', () => {
    expect(serializeKey(mockKeyEvent('?'))).toBe('?');
    expect(serializeKey(mockKeyEvent('?'), true)).toBe('Meta+?');
  });

  it('includes Ctrl modifier from event', () => {
    expect(serializeKey(mockKeyEvent('c', { ctrlKey: true }))).toBe('Ctrl+c');
  });

  it('includes Alt modifier from event', () => {
    expect(serializeKey(mockKeyEvent('x', { altKey: true }))).toBe('Alt+x');
  });
});

// =============================================================================
// getNeighborInDirection
// =============================================================================

describe('getNeighborInDirection', () => {
  const origin: HexCoordinate = { q: 0, r: 0 };

  it('returns correct neighbor for all 6 directions from origin', () => {
    // Based on HEX_NEIGHBORS: [E, NE, NW, W, SW, SE]
    // E:  { q: +1, r: 0 }
    // NE: { q: +1, r: -1 }
    // NW: { q: 0, r: -1 }
    // W:  { q: -1, r: 0 }
    // SW: { q: -1, r: +1 }
    // SE: { q: 0, r: +1 }

    expect(getNeighborInDirection(origin, 'e')).toEqual({ q: 1, r: 0 });
    expect(getNeighborInDirection(origin, 'ne')).toEqual({ q: 1, r: -1 });
    expect(getNeighborInDirection(origin, 'nw')).toEqual({ q: 0, r: -1 });
    expect(getNeighborInDirection(origin, 'w')).toEqual({ q: -1, r: 0 });
    expect(getNeighborInDirection(origin, 'sw')).toEqual({ q: -1, r: 1 });
    expect(getNeighborInDirection(origin, 'se')).toEqual({ q: 0, r: 1 });
  });

  it('works from non-origin hex', () => {
    const hex: HexCoordinate = { q: 3, r: -2 };

    expect(getNeighborInDirection(hex, 'e')).toEqual({ q: 4, r: -2 });
    expect(getNeighborInDirection(hex, 'w')).toEqual({ q: 2, r: -2 });
    expect(getNeighborInDirection(hex, 'ne')).toEqual({ q: 4, r: -3 });
    expect(getNeighborInDirection(hex, 'sw')).toEqual({ q: 2, r: -1 });
  });

  it('inverse directions cancel out', () => {
    const start: HexCoordinate = { q: 5, r: 7 };

    // E then W returns to start
    const afterE = getNeighborInDirection(start, 'e');
    const backW = getNeighborInDirection(afterE, 'w');
    expect(backW).toEqual(start);

    // NE then SW returns to start
    const afterNE = getNeighborInDirection(start, 'ne');
    const backSW = getNeighborInDirection(afterNE, 'sw');
    expect(backSW).toEqual(start);

    // NW then SE returns to start
    const afterNW = getNeighborInDirection(start, 'nw');
    const backSE = getNeighborInDirection(afterNW, 'se');
    expect(backSE).toEqual(start);
  });

  it('ALL_DIRECTIONS contains exactly 6 unique directions', () => {
    expect(ALL_DIRECTIONS).toHaveLength(6);
    expect(new Set(ALL_DIRECTIONS).size).toBe(6);
  });
});

// =============================================================================
// getVerticalDirection - Row Parity Zigzag Algorithm
// =============================================================================

describe('getVerticalDirection', () => {
  // The zigzag algorithm uses row (r) parity to determine which diagonal
  // keeps you in the same visual column when moving up/down.
  //
  // Even rows (r % 2 === 0): go "right-leaning" (NE for up, SE for down)
  // Odd rows (r % 2 !== 0): go "left-leaning" (NW for up, SW for down)

  describe('up direction', () => {
    it('returns NE from even row (r=0)', () => {
      expect(getVerticalDirection({ q: 0, r: 0 }, 'up')).toBe('ne');
      expect(getVerticalDirection({ q: 5, r: 0 }, 'up')).toBe('ne');
    });

    it('returns NW from odd row (r=1)', () => {
      expect(getVerticalDirection({ q: 0, r: 1 }, 'up')).toBe('nw');
      expect(getVerticalDirection({ q: 5, r: 1 }, 'up')).toBe('nw');
    });

    it('returns NE from even row (r=2)', () => {
      expect(getVerticalDirection({ q: 0, r: 2 }, 'up')).toBe('ne');
    });

    it('returns NW from odd row (r=3)', () => {
      expect(getVerticalDirection({ q: 0, r: 3 }, 'up')).toBe('nw');
    });

    it('handles negative even rows', () => {
      expect(getVerticalDirection({ q: 0, r: -2 }, 'up')).toBe('ne');
      expect(getVerticalDirection({ q: 0, r: -4 }, 'up')).toBe('ne');
    });

    it('handles negative odd rows', () => {
      expect(getVerticalDirection({ q: 0, r: -1 }, 'up')).toBe('nw');
      expect(getVerticalDirection({ q: 0, r: -3 }, 'up')).toBe('nw');
    });
  });

  describe('down direction', () => {
    it('returns SE from even row (r=0)', () => {
      expect(getVerticalDirection({ q: 0, r: 0 }, 'down')).toBe('se');
      expect(getVerticalDirection({ q: 5, r: 0 }, 'down')).toBe('se');
    });

    it('returns SW from odd row (r=1)', () => {
      expect(getVerticalDirection({ q: 0, r: 1 }, 'down')).toBe('sw');
      expect(getVerticalDirection({ q: 5, r: 1 }, 'down')).toBe('sw');
    });

    it('returns SE from even row (r=2)', () => {
      expect(getVerticalDirection({ q: 0, r: 2 }, 'down')).toBe('se');
    });

    it('returns SW from odd row (r=3)', () => {
      expect(getVerticalDirection({ q: 0, r: 3 }, 'down')).toBe('sw');
    });
  });

  describe('zigzag property - staying in same visual column', () => {
    it('moving up twice from r=0 should zigzag NE then NW', () => {
      const start: HexCoordinate = { q: 2, r: 0 };

      // From even row, go NE
      const dir1 = getVerticalDirection(start, 'up');
      expect(dir1).toBe('ne');
      const after1 = getNeighborInDirection(start, dir1);
      expect(after1).toEqual({ q: 3, r: -1 }); // Now at odd row

      // From odd row, go NW
      const dir2 = getVerticalDirection(after1, 'up');
      expect(dir2).toBe('nw');
      const after2 = getNeighborInDirection(after1, dir2);
      expect(after2).toEqual({ q: 3, r: -2 }); // Now at even row

      // The q stayed at 3 after zigzag, and we moved up by 2 rows
      // This is the desired "visual column" preservation
    });

    it('moving down twice from r=0 should zigzag SE then SW', () => {
      const start: HexCoordinate = { q: 2, r: 0 };

      // From even row, go SE
      const dir1 = getVerticalDirection(start, 'down');
      expect(dir1).toBe('se');
      const after1 = getNeighborInDirection(start, dir1);
      expect(after1).toEqual({ q: 2, r: 1 }); // Now at odd row

      // From odd row, go SW
      const dir2 = getVerticalDirection(after1, 'down');
      expect(dir2).toBe('sw');
      const after2 = getNeighborInDirection(after1, dir2);
      expect(after2).toEqual({ q: 1, r: 2 }); // Now at even row
    });

    it('up then down returns to same hex (zigzag is reversible)', () => {
      const start: HexCoordinate = { q: 4, r: 0 };

      // Go up
      const upDir = getVerticalDirection(start, 'up');
      const afterUp = getNeighborInDirection(start, upDir);

      // Go down from new position
      const downDir = getVerticalDirection(afterUp, 'down');
      const afterDown = getNeighborInDirection(afterUp, downDir);

      expect(afterDown).toEqual(start);
    });
  });
});

// =============================================================================
// KEYMAPS (static verification - no store needed)
// =============================================================================

describe('KEYMAPS', () => {
  it('has vim as default keymap', () => {
    expect(DEFAULT_KEYMAP_ID).toBe('vim');
    expect(KEYMAPS['vim']).toBeDefined();
  });

  it('includes vim and arrows keymaps', () => {
    expect(Object.keys(KEYMAPS)).toContain('vim');
    expect(Object.keys(KEYMAPS)).toContain('arrows');
  });

  describe('vim keymap', () => {
    const vim = KEYMAPS['vim'];

    it('has bindings for all three modes', () => {
      expect(vim.bindings.grid).toBeDefined();
      expect(vim.bindings.selected).toBeDefined();
      expect(vim.bindings.terminal).toBeDefined();
    });

    it('has hjkl for navigation', () => {
      expect(vim.bindings.grid['h']).toEqual({ type: 'navigate', direction: 'w' });
      expect(vim.bindings.grid['l']).toEqual({ type: 'navigate', direction: 'e' });
    });

    it('has vertical navigation for k/j (zigzag)', () => {
      expect(vim.bindings.grid['k']).toEqual({ type: 'navigate_vertical', direction: 'up' });
      expect(vim.bindings.grid['j']).toEqual({ type: 'navigate_vertical', direction: 'down' });
    });

    it('has Shift+K/J for diagonals', () => {
      expect(vim.bindings.grid['Shift+K']).toEqual({ type: 'navigate', direction: 'ne' });
      expect(vim.bindings.grid['Shift+J']).toEqual({ type: 'navigate', direction: 'se' });
    });

    it('has Shift+H/L for other diagonals', () => {
      expect(vim.bindings.grid['Shift+H']).toEqual({ type: 'navigate', direction: 'nw' });
      expect(vim.bindings.grid['Shift+L']).toEqual({ type: 'navigate', direction: 'sw' });
    });

    it('terminal mode has Meta+Escape to close', () => {
      expect(vim.bindings.terminal['Meta+Escape']).toEqual({ type: 'close_panel' });
    });

    it('selected mode has spawn actions', () => {
      expect(vim.bindings.selected['t']).toEqual({ type: 'spawn', cellType: 'terminal' });
      expect(vim.bindings.selected['o']).toEqual({ type: 'spawn', cellType: 'orchestrator' });
      expect(vim.bindings.selected['w']).toEqual({ type: 'spawn', cellType: 'worker' });
    });

    it('selected mode has kill action', () => {
      expect(vim.bindings.selected['x']).toEqual({ type: 'kill' });
    });

    it('has g for go to origin', () => {
      expect(vim.bindings.grid['g']).toEqual({ type: 'select_center' });
      expect(vim.bindings.selected['g']).toEqual({ type: 'select_center' });
    });

    it('has ? for show help in all modes', () => {
      expect(vim.bindings.grid['?']).toEqual({ type: 'show_help' });
      expect(vim.bindings.selected['?']).toEqual({ type: 'show_help' });
      expect(vim.bindings.terminal['Meta+?']).toEqual({ type: 'show_help' });
    });

    it('terminal mode has Meta+hjkl for navigation', () => {
      expect(vim.bindings.terminal['Meta+h']).toEqual({ type: 'navigate', direction: 'w' });
      expect(vim.bindings.terminal['Meta+l']).toEqual({ type: 'navigate', direction: 'e' });
      expect(vim.bindings.terminal['Meta+k']).toEqual({ type: 'navigate_vertical', direction: 'up' });
      expect(vim.bindings.terminal['Meta+j']).toEqual({ type: 'navigate_vertical', direction: 'down' });
    });

    it('terminal mode has Meta+Enter to open panel', () => {
      expect(vim.bindings.terminal['Meta+Enter']).toEqual({ type: 'open_panel' });
    });

    it('terminal mode has Meta+x to kill', () => {
      expect(vim.bindings.terminal['Meta+x']).toEqual({ type: 'kill' });
    });

    it('terminal mode has Meta+g for origin and Meta+m for meta panel', () => {
      expect(vim.bindings.terminal['Meta+g']).toEqual({ type: 'select_center' });
      expect(vim.bindings.terminal['Meta+m']).toEqual({ type: 'toggle_meta_panel' });
    });

    it('terminal mode has Meta+Shift diagonal navigation', () => {
      expect(vim.bindings.terminal['Meta+Shift+K']).toEqual({ type: 'navigate', direction: 'ne' });
      expect(vim.bindings.terminal['Meta+Shift+J']).toEqual({ type: 'navigate', direction: 'se' });
      expect(vim.bindings.terminal['Meta+Shift+H']).toEqual({ type: 'navigate', direction: 'nw' });
      expect(vim.bindings.terminal['Meta+Shift+L']).toEqual({ type: 'navigate', direction: 'sw' });
    });
  });

  describe.each(['vim', 'arrows'])('%s keymap navigation parity', (keymapId) => {
    const keymap = KEYMAPS[keymapId];
    const navActionTypes = ['navigate', 'navigate_vertical'];

    it('selected mode includes every navigation binding from grid mode', () => {
      const gridNavBindings = Object.entries(keymap.bindings.grid)
        .filter(([, action]) => navActionTypes.includes(action.type));

      // Sanity: grid mode must have at least some nav bindings
      expect(gridNavBindings.length).toBeGreaterThan(0);

      for (const [combo, action] of gridNavBindings) {
        expect(keymap.bindings.selected[combo]).toEqual(action);
      }
    });
  });

  describe.each(['vim', 'arrows'])('%s keymap terminal-mode parity', (keymapId) => {
    const keymap = KEYMAPS[keymapId];

    it('terminal mode has Meta+ equivalent for every non-nav selected-mode action', () => {
      // For every action in selected mode that is NOT navigation (which uses
      // plain keys), there should be a Meta+ equivalent in terminal mode.
      // Exceptions: Escape (can't Meta+Escape to clear_selection in terminal,
      // because Meta+Escape means close_panel), and plain key spawns/kill.
      const selectedBindings = Object.entries(keymap.bindings.selected);
      const terminalBindings = keymap.bindings.terminal;

      // Actions that need Meta+ equivalents in terminal mode
      const actionsNeeded = ['open_panel', 'kill', 'select_center', 'toggle_meta_panel', 'show_help'];

      for (const actionType of actionsNeeded) {
        const selectedEntry = selectedBindings.find(([, a]) => a.type === actionType);
        if (!selectedEntry) continue;

        // Find Meta+ version in terminal mode
        const hasTerminalBinding = Object.entries(terminalBindings).some(
          ([, a]) => a.type === actionType
        );
        expect(hasTerminalBinding).toBe(true);
      }
    });

    it('terminal mode has Meta+Enter for open_panel', () => {
      expect(keymap.bindings.terminal['Meta+Enter']).toEqual({ type: 'open_panel' });
    });

    it('terminal mode has Meta+x for kill', () => {
      expect(keymap.bindings.terminal['Meta+x']).toEqual({ type: 'kill' });
    });

    it('terminal mode has Meta+g for select_center', () => {
      expect(keymap.bindings.terminal['Meta+g']).toEqual({ type: 'select_center' });
    });

    it('terminal mode has Meta+m for toggle_meta_panel', () => {
      expect(keymap.bindings.terminal['Meta+m']).toEqual({ type: 'toggle_meta_panel' });
    });
  });

  describe('arrows keymap', () => {
    const arrows = KEYMAPS['arrows'];

    it('has arrow keys for navigation', () => {
      expect(arrows.bindings.grid['ArrowLeft']).toEqual({ type: 'navigate', direction: 'w' });
      expect(arrows.bindings.grid['ArrowRight']).toEqual({ type: 'navigate', direction: 'e' });
      expect(arrows.bindings.grid['ArrowUp']).toEqual({ type: 'navigate_vertical', direction: 'up' });
      expect(arrows.bindings.grid['ArrowDown']).toEqual({ type: 'navigate_vertical', direction: 'down' });
    });

    it('has Shift+arrows for diagonals', () => {
      expect(arrows.bindings.grid['Shift+ArrowUp']).toEqual({ type: 'navigate', direction: 'ne' });
      expect(arrows.bindings.grid['Shift+ArrowDown']).toEqual({ type: 'navigate', direction: 'se' });
      expect(arrows.bindings.grid['Shift+ArrowLeft']).toEqual({ type: 'navigate', direction: 'nw' });
      expect(arrows.bindings.grid['Shift+ArrowRight']).toEqual({ type: 'navigate', direction: 'sw' });
    });
  });
});
