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
    const { selectedHex, selectHex, selectedAgentId, selectAgent, clearSelection } =
      useUIStore.getState();
    const { getAllAgents } = useAgentStore.getState();

    switch (action.type) {
      case 'navigate':
      case 'navigate_vertical': {
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
        clearSelection();
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
        optionsRef.current.onKill?.(selectedHex);
        break;
      }

      case 'show_help':
        optionsRef.current.onShowHelp?.();
        break;
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Get current mode
      const mode = useUIStore.getState().getMode();

      // In terminal mode, only intercept modified keys (Cmd+...)
      // Let everything else flow through to the terminal
      if (mode === 'terminal' && !e.metaKey) {
        return;
      }

      // Serialize the key event
      const combo = serializeKey(e);
      if (!combo) return; // Pure modifier key press

      // Look up in active keymap
      const keymap = useKeyboardStore.getState().getActiveKeymap();
      const bindings = keymap.bindings[mode];
      const action = bindings[combo];

      if (action) {
        e.preventDefault();
        e.stopPropagation();
        executeAction(action);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [executeAction]);
}
