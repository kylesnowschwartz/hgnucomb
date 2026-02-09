/**
 * StatusBar - Bottom bar showing input mode, hints, and position.
 *
 * Displays:
 * - Current mode indicator (GRID/SELECTED/TERMINAL)
 * - Mode-specific keyboard hints
 * - Selected hex coordinates
 * - Active keymap name
 */

import { useMemo, useCallback } from 'react';
import { useUIStore } from './uiStore';
import { useKeyboardStore } from '@features/keyboard';
import { usePwaStore } from '@features/pwa';
import type { InputMode } from '@features/keyboard';
import './StatusBar.css';

const MODE_LABELS: Record<InputMode, string> = {
  grid: 'GRID',
  selected: 'SELECTED',
  terminal: 'TERMINAL',
};

const MODE_HINTS: Record<InputMode, string> = {
  grid: 'hjkl navigate | Shift+hjkl diagonals | g origin | ? help',
  selected: 'hjkl nav | Enter open | t/o/w spawn | X kill | Esc clear | Cmd+Esc close',
  terminal: 'Cmd+O orchestrator | Cmd+Esc close | Click outside for grid controls',
};

/** Hints shown in standalone mode (Cmd+T/W available) */
const PWA_MODE_HINTS: Record<InputMode, string> = {
  grid: 'hjkl navigate | Shift+hjkl diagonals | g origin | ? help',
  selected: 'hjkl nav | Enter open | t/o/w Cmd+T/W spawn | X kill | Esc clear',
  terminal: 'Cmd+T terminal | Cmd+W worker | Cmd+O orchestrator | Cmd+Esc close',
};

export function StatusBar() {
  const mode = useUIStore((s) => s.getMode());
  const hoveredHex = useUIStore((s) => s.hoveredHex);
  const selectedHex = useUIStore((s) => s.selectedHex);
  const keymap = useKeyboardStore((s) => s.getActiveKeymap());
  const isStandalone = usePwaStore((s) => s.isStandalone);
  const installPrompt = usePwaStore((s) => s.installPrompt);

  const hints = isStandalone ? PWA_MODE_HINTS : MODE_HINTS;

  // Show hovered hex coords (mouse tracking), fall back to selected hex (keyboard nav)
  const displayHex = hoveredHex || selectedHex;
  const hexLabel = useMemo(() => {
    if (!displayHex) return null;
    return `(${displayHex.q}, ${displayHex.r})`;
  }, [displayHex]);

  const handleInstall = useCallback(() => {
    usePwaStore.getState().promptInstall();
  }, []);

  return (
    <div className="status-bar">
      <div className="status-bar__left">
        {mode !== 'selected' && (
          <span className={`status-bar__mode status-bar__mode--${mode}`}>
            {MODE_LABELS[mode]}
          </span>
        )}
        <span className="status-bar__hints">{hints[mode]}</span>
      </div>

      <div className="status-bar__right">
        {installPrompt && (
          <button
            className="status-bar__install"
            onClick={handleInstall}
          >
            Install App
          </button>
        )}
        {hexLabel && <span className="status-bar__position">{hexLabel}</span>}
        <span className="status-bar__keymap">{keymap.name}</span>
      </div>
    </div>
  );
}
