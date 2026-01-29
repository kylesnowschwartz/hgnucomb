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
    const { selectedHex, selectHex, selectedAgentId, selectAgent, clearSelection, pendingKill, setPendingKill } =
      useUIStore.getState();
    const { getAllAgents } = useAgentStore.getState();

    switch (action.type) {
      case 'navigate':
      case 'navigate_vertical': {
        // Cancel any pending kill when navigating
        if (pendingKill) {
          setPendingKill(null);
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

        // If in terminal mode with panel open, switch to agent at new hex if occupied
        // Keep panel open when navigating to empty cells (user can close explicitly)
        if (selectedAgentId) {
          const agents = getAllAgents();
          const agentAtNext = agents.find(
            (a) => a.hex.q === next.q && a.hex.r === next.r
          );
          if (agentAtNext) {
            selectAgent(agentAtNext.id);
          }
          // Empty cell: keep current panel open, just move hex selection
        }

        // Pan viewport if needed
        optionsRef.current.onPanToHex?.(next);
        break;
      }

      case 'select_center':
        selectHex({ q: 0, r: 0 });
        optionsRef.current.onCenterOnHex?.({ q: 0, r: 0 });
        break;

      case 'clear_selection':
        setPendingKill(null); // Also cancel any pending kill
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
          selectAgent(agentAtHex.id);
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

        // If no pending kill, initiate confirmation. Otherwise, confirm.
        if (!pendingKill) {
          setPendingKill(selectedHex);
        } else {
          // Confirm - execute kill
          setPendingKill(null);
          optionsRef.current.onKill?.(selectedHex);
        }
        break;
      }

      case 'confirm_kill': {
        if (!pendingKill) break;
        setPendingKill(null);
        optionsRef.current.onKill?.(pendingKill);
        break;
      }

      case 'show_help':
        optionsRef.current.onShowHelp?.();
        break;
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if focus is in the terminal panel
      const terminalPanel = document.querySelector('.terminal-panel');
      const focusIsInTerminal = terminalPanel?.contains(document.activeElement);

      // Cmd+Esc is the global "escape hatch" - ALWAYS handled by app
      // This lets user unfocus/close terminal even when it has focus
      const isCmdEsc = e.metaKey && e.key === 'Escape';

      // TERMINAL FOCUSED: Let terminal handle ALL keys (acts like real terminal)
      // EXCEPT Cmd+Esc which is the global toggle
      if (focusIsInTerminal && !isCmdEsc) {
        return;
      }

      // APP FOCUSED: We handle all keys for grid navigation/controls
      // Determine mode based on UI state (not focus)
      const { selectedHex, selectedAgentId } = useUIStore.getState();
      let mode: 'grid' | 'selected' | 'terminal';
      if (selectedAgentId) {
        // Panel open but unfocused - use selected mode for grid interaction
        mode = selectedHex ? 'selected' : 'grid';
      } else if (selectedHex) {
        mode = 'selected';
      } else {
        mode = 'grid';
      }

      // Serialize the key event
      const combo = serializeKey(e);
      if (!combo) return; // Pure modifier key press

      // Look up in active keymap
      const keymap = useKeyboardStore.getState().getActiveKeymap();
      const bindings = keymap.bindings[mode];
      let action = bindings[combo];

      // Handle kill confirmation: if pendingKill is set, Enter or Shift+X confirms
      const pendingKill = useUIStore.getState().pendingKill;
      if (pendingKill && (combo === 'Enter' || combo === 'Shift+X')) {
        action = { type: 'confirm_kill' };
      }

      // Prevent browser keybinds when app has focus (Cmd+D, Cmd+L, Cmd+K, etc.)
      // Always preventDefault for Cmd/Ctrl combos to avoid browser behavior
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault();
      }

      if (!action) return;

      e.preventDefault();
      e.stopPropagation();
      executeAction(action);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [executeAction]);
}
