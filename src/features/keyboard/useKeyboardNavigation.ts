/**
 * Keyboard navigation hook.
 *
 * Routes keydown events through the active keymap based on current input mode.
 * Returns action handlers for the UI to execute.
 */

import { useEffect, useCallback, useRef } from 'react';
import { useUIStore } from '@features/controls/uiStore';
import { useAgentStore } from '@features/agents/agentStore';
import { useKeyboardStore } from './keyboardStore';
import { serializeKey, type KeyAction } from './types';
import { getNeighborInDirection, getVerticalDirection } from './directions';
import { isFocusInTextEntry } from './focusGuards';
import { initModifierTracking, isMetaDown } from './modifierState';
import type { CellType, HexCoordinate } from '@shared/types';

interface UseKeyboardNavigationOptions {
  /** Called when help modal should open */
  onShowHelp?: () => void;
  /** Called when spawn is requested for a cell type */
  onSpawn?: (cellType: CellType, hex: HexCoordinate) => void;
  /** Called when kill is requested at a hex */
  onKill?: (hex: HexCoordinate) => void;
  /** Called when navigation should pan the viewport (edge-nudge) */
  onPanToHex?: (hex: HexCoordinate) => void;
  /** Called when viewport should center on a hex (force-center) */
  onCenterOnHex?: (hex: HexCoordinate) => void;
}

/**
 * Hook that handles keyboard navigation.
 *
 * Listens for keydown events and executes actions based on:
 * 1. Current input mode (grid/selected/terminal)
 * 2. Active keymap bindings
 */
export function useKeyboardNavigation(options: UseKeyboardNavigationOptions = {}) {
  // Refs to avoid stale closures in event handler
  const optionsRef = useRef(options);

  // Update ref in effect to avoid assignment during render
  useEffect(() => {
    optionsRef.current = options;
  });

  const executeAction = useCallback((action: KeyAction) => {
    const { selectedHex, selectHex, selectedAgentId, selectAgent, clearSelection, killConfirmationActive, setKillConfirmationActive } =
      useUIStore.getState();
    const { getAllAgents } = useAgentStore.getState();

    switch (action.type) {
      case 'navigate':
      case 'navigate_vertical': {
        // Cancel kill confirmation when navigating away
        if (killConfirmationActive) {
          setKillConfirmationActive(false);
        }

        // Get current position (selected hex or origin)
        const current = selectedHex ?? { q: 0, r: 0 };

        // Compute actual direction
        const direction =
          action.type === 'navigate_vertical'
            ? getVerticalDirection(current, action.direction)
            : action.direction;

        const next = getNeighborInDirection(current, direction);
        selectHex(next);

        // Pan viewport if needed
        optionsRef.current.onPanToHex?.(next);
        break;
      }

      case 'select_center':
        selectHex({ q: 0, r: 0 });
        optionsRef.current.onCenterOnHex?.({ q: 0, r: 0 });
        break;

      case 'clear_selection':
        setKillConfirmationActive(false);
        // If panel is open, close it first; otherwise clear hex selection
        if (selectedAgentId) {
          selectAgent(null);
        } else {
          clearSelection();
        }
        break;

      case 'open_panel': {
        if (!selectedHex) break;
        const agents = getAllAgents();
        const agentAtHex = agents.find(
          (a) => a.hex.q === selectedHex.q && a.hex.r === selectedHex.r
        );
        if (agentAtHex) {
          const alreadyOpen = selectedAgentId === agentAtHex.id;
          selectAgent(agentAtHex.id);
          if (alreadyOpen) {
            // Panel already showing this agent -- just refocus the terminal.
            // New panels auto-focus via TerminalPanel's mount effect.
            requestAnimationFrame(() => {
              const el = document.querySelector('.terminal-panel textarea');
              if (el instanceof HTMLElement) el.focus();
            });
          }
        }
        break;
      }

      case 'close_panel':
        selectAgent(null);
        break;

      case 'spawn': {
        if (!selectedHex) break;
        // Check if cell is empty
        const agents = getAllAgents();
        const agentAtHex = agents.find(
          (a) => a.hex.q === selectedHex.q && a.hex.r === selectedHex.r
        );
        if (!agentAtHex) {
          optionsRef.current.onSpawn?.(action.cellType, selectedHex);
        }
        break;
      }

      case 'kill': {
        if (!selectedHex) break;
        // Check if there's an agent at the selected hex
        const agents = getAllAgents();
        const agentAtHex = agents.find(
          (a) => a.hex.q === selectedHex.q && a.hex.r === selectedHex.r
        );
        if (!agentAtHex) break; // No agent to kill

        // Toggle: first press initiates confirmation, second press confirms
        if (!killConfirmationActive) {
          setKillConfirmationActive(true);
        } else {
          setKillConfirmationActive(false);
          optionsRef.current.onKill?.(selectedHex);
        }
        break;
      }

      case 'confirm_kill': {
        if (!killConfirmationActive || !selectedHex) break;
        setKillConfirmationActive(false);
        optionsRef.current.onKill?.(selectedHex);
        break;
      }

      case 'toggle_meta_panel':
        useUIStore.getState().toggleMetaPanel();
        break;

      case 'show_help':
        optionsRef.current.onShowHelp?.();
        break;
    }
  }, []);

  useEffect(() => {
    // Start explicit modifier tracking (blur/visibilitychange resets).
    // Fixes macOS Cmd+Tab stickiness where e.metaKey stays true.
    const cleanupModifiers = initModifierTracking();

    const handleKeyDown = (e: KeyboardEvent) => {
      // Use tracked Meta state instead of e.metaKey.
      // The browser's metaKey property is unreliable on macOS after Cmd+Tab.
      const meta = isMetaDown();

      // Check if focus is in the terminal panel
      const terminalPanel = document.querySelector('.terminal-panel');
      const focusIsInTerminal = terminalPanel?.contains(document.activeElement);

      // Check if focus is in a text input (e.g., ProjectWidget, contenteditable)
      const focusIsInInput = isFocusInTextEntry();

      // TERMINAL FOCUSED: Let terminal handle ALL non-Meta keys.
      // Meta+ keys fall through to keymap lookup (Cmd+hjkl, Cmd+Escape, etc.)
      if (focusIsInTerminal && !meta) {
        return;
      }

      // INPUT FOCUSED: Let the input handle all keys so users can actually type.
      // Skip this guard when focus is in the terminal panel -- xterm's textarea
      // IS a <textarea>, but it's already handled by the terminal guard above.
      if (focusIsInInput && !focusIsInTerminal) {
        return;
      }

      // Determine mode from uiStore (single source of truth).
      // Override: when panel is open but focus is on the grid (not in terminal),
      // use 'selected' so plain hjkl still navigates instead of being dead.
      const uiMode = useUIStore.getState().getMode();
      const mode = (uiMode === 'terminal' && !focusIsInTerminal) ? 'selected' : uiMode;

      // Serialize the key event (pass tracked meta to avoid stale e.metaKey)
      const combo = serializeKey(e, meta);
      if (!combo) return; // Pure modifier key press

      // Look up in active keymap
      const keymap = useKeyboardStore.getState().getActiveKeymap();
      const bindings = keymap.bindings[mode];
      let action: KeyAction | undefined = bindings[combo];

      // Handle kill confirmation: if active, Enter confirms
      // (x already maps to 'kill' which handles both initiate and confirm)
      const { killConfirmationActive: isKillPending } = useUIStore.getState();
      if (isKillPending && combo === 'Enter') {
        action = { type: 'confirm_kill' };
      }

      // If we have an action binding, handle it and prevent browser behavior
      if (action) {
        e.preventDefault();
        e.stopPropagation();
        executeAction(action);
        return;
      }

      // No action bound - decide if we should prevent default browser behavior
      // Allow essential editing shortcuts to pass through (copy/paste/undo/find)
      const isEditingShortcut =
        (meta || e.ctrlKey) &&
        (e.key === 'c' || // copy
          e.key === 'v' || // paste
          e.key === 'x' || // cut
          e.key === 'a' || // select all
          e.key === 'z' || // undo/redo
          e.key === 'f' || // find
          e.key === 'r'); // reload (dev convenience)

      // Block problematic browser shortcuts (bookmark, address bar, search, new tab, etc.)
      // while allowing essential editing to work
      if ((meta || e.ctrlKey) && !isEditingShortcut) {
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      cleanupModifiers();
    };
  }, [executeAction]);
}
