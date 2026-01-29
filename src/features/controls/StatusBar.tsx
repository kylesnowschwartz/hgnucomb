/**
 * StatusBar - Bottom bar showing input mode, hints, and position.
 *
 * Displays:
 * - Current mode indicator (GRID/SELECTED/TERMINAL)
 * - Mode-specific keyboard hints
 * - Selected hex coordinates
 * - Active keymap name
 */

import { useMemo } from 'react';
import { useUIStore } from './uiStore';
import { useKeyboardStore } from '@features/keyboard';
import type { InputMode } from '@features/keyboard';
import './StatusBar.css';

const MODE_LABELS: Record<InputMode, string> = {
  grid: 'GRID',
  selected: 'SELECTED',
  terminal: 'TERMINAL',
};

const MODE_HINTS: Record<InputMode, string> = {
  grid: 'hjkl navigate | Shift+hjkl diagonals | g origin | ? help',
  selected: 'hjkl nav | Enter open | t/o/w spawn | X kill | Esc clear',
  terminal: 'Cmd+Esc close | Cmd+hjkl navigate',
};

export function StatusBar() {
  const mode = useUIStore((s) => s.getMode());
  const selectedHex = useUIStore((s) => s.selectedHex);
  const keymap = useKeyboardStore((s) => s.getActiveKeymap());

  const hexLabel = useMemo(() => {
    if (!selectedHex) return null;
    return `(${selectedHex.q}, ${selectedHex.r})`;
  }, [selectedHex]);

  return (
    <div className="status-bar">
      <div className="status-bar__left">
        <span className={`status-bar__mode status-bar__mode--${mode}`}>
          {MODE_LABELS[mode]}
        </span>
        <span className="status-bar__hints">{MODE_HINTS[mode]}</span>
      </div>

      <div className="status-bar__right">
        {hexLabel && <span className="status-bar__position">{hexLabel}</span>}
        <span className="status-bar__keymap">{keymap.name}</span>
      </div>
    </div>
  );
}
