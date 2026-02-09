/**
 * Keyboard navigation types.
 *
 * Defines actions, bindings, and keymaps for the three-mode input system.
 */

// ============================================================================
// Input Modes
// ============================================================================

/**
 * Input modes derived from UI state (not stored separately).
 * - grid: Default. No selection, navigating the canvas.
 * - selected: A hex cell is focused (yellow border).
 * - terminal: A terminal panel is open and focused.
 */
export type InputMode = 'grid' | 'selected' | 'terminal';

// ============================================================================
// Actions
// ============================================================================

/**
 * All possible keyboard actions.
 */
export type KeyAction =
  // Navigation
  | { type: 'navigate'; direction: HexDirection }
  | { type: 'navigate_vertical'; direction: 'up' | 'down' } // Zigzag vertical movement
  | { type: 'select_center' }     // Go to origin (0,0)
  | { type: 'clear_selection' }   // Escape selection

  // Cell actions
  | { type: 'open_panel' }        // Enter: open terminal panel
  | { type: 'close_panel' }       // Cmd+Escape: close panel
  | { type: 'spawn'; cellType: 'terminal' | 'orchestrator' | 'worker' }
  | { type: 'kill' }              // Kill agent at selected cell (x to initiate, x again to confirm)
  | { type: 'confirm_kill' }      // Confirm pending kill (Enter when kill pending)

  // UI
  | { type: 'toggle_meta_panel' }
  | { type: 'show_help' };

/**
 * Hex directions for navigation.
 * Matches HEX_NEIGHBORS order: E, NE, NW, W, SW, SE
 */
export type HexDirection = 'e' | 'ne' | 'nw' | 'w' | 'sw' | 'se';

// ============================================================================
// Key Bindings
// ============================================================================

/**
 * Serialized key combination for lookup.
 * Format: "key" or "modifier+key" (e.g., "h", "Shift+k", "Meta+Escape")
 */
export type KeyCombo = string;

/**
 * Serialize a KeyboardEvent to a KeyCombo string.
 *
 * @param meta - Override for Meta modifier state. When provided, used instead
 *   of e.metaKey. Pass the tracked value from modifierState.ts to avoid the
 *   macOS Cmd+Tab stickiness bug where e.metaKey reports true after the key
 *   was released in another window.
 */
export function serializeKey(e: KeyboardEvent, meta?: boolean): KeyCombo {
  const parts: string[] = [];

  // Modifiers in consistent order
  if (meta ?? e.metaKey) parts.push('Meta');
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  // Normalize key name
  const key = e.key;
  // Don't duplicate modifier keys in the key part
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(key)) {
    return ''; // Pure modifier press, ignore
  }

  parts.push(key);
  return parts.join('+');
}

// ============================================================================
// Keymap
// ============================================================================

/**
 * A keymap defines bindings for each input mode.
 */
export interface Keymap {
  id: string;
  name: string;
  description: string;
  bindings: {
    grid: Record<KeyCombo, KeyAction>;
    selected: Record<KeyCombo, KeyAction>;
    terminal: Record<KeyCombo, KeyAction>;
  };
}
