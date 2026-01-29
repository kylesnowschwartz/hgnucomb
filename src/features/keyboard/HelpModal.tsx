/**
 * HelpModal - Keyboard shortcut reference.
 *
 * Shows all keybindings organized by mode.
 */

import { useKeyboardStore } from './keyboardStore';
import type { KeyAction, InputMode } from './types';
import './HelpModal.css';

interface HelpModalProps {
  onClose: () => void;
}

const MODE_ORDER: InputMode[] = ['grid', 'selected', 'terminal'];
const MODE_LABELS: Record<InputMode, string> = {
  grid: 'Grid Mode',
  selected: 'Selected Mode',
  terminal: 'Terminal Mode',
};

function formatAction(action: KeyAction): string {
  switch (action.type) {
    case 'navigate':
      return `Move ${action.direction.toUpperCase()}`;
    case 'navigate_vertical':
      return action.direction === 'up' ? 'Move up (zigzag)' : 'Move down (zigzag)';
    case 'select_center':
      return 'Go to origin';
    case 'clear_selection':
      return 'Clear selection';
    case 'open_panel':
      return 'Open terminal panel';
    case 'close_panel':
      return 'Close panel';
    case 'spawn':
      return `Spawn ${action.cellType}`;
    case 'kill':
      return 'Initiate kill / Confirm kill';
    case 'confirm_kill':
      return 'Confirm kill';
    case 'cancel_kill':
      return 'Cancel kill / Clear selection';
    case 'show_help':
      return 'Show this help';
  }
}

export function HelpModal({ onClose }: HelpModalProps) {
  const keymap = useKeyboardStore((s) => s.getActiveKeymap());
  const keymaps = useKeyboardStore((s) => s.getAvailableKeymaps());
  const setActiveKeymap = useKeyboardStore((s) => s.setActiveKeymap);

  return (
    <div className="help-modal__backdrop" onClick={onClose}>
      <div className="help-modal" onClick={(e) => e.stopPropagation()}>
        <div className="help-modal__header">
          <h2 className="help-modal__title">Keyboard Shortcuts</h2>
          <button className="help-modal__close" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="help-modal__keymap-selector">
          <label className="help-modal__label">Keymap:</label>
          <select
            className="help-modal__select"
            value={keymap.id}
            onChange={(e) => setActiveKeymap(e.target.value)}
          >
            {keymaps.map((km) => (
              <option key={km.id} value={km.id}>
                {km.name}
              </option>
            ))}
          </select>
          <span className="help-modal__description">{keymap.description}</span>
        </div>

        <div className="help-modal__content">
          {MODE_ORDER.map((mode) => {
            const bindings = keymap.bindings[mode];
            const entries = Object.entries(bindings);
            if (entries.length === 0) return null;

            return (
              <div key={mode} className="help-modal__section">
                <h3 className="help-modal__mode-title">{MODE_LABELS[mode]}</h3>
                <div className="help-modal__bindings">
                  {entries.map(([combo, action]) => (
                    <div key={combo} className="help-modal__binding">
                      <kbd className="help-modal__key">{combo}</kbd>
                      <span className="help-modal__action">{formatAction(action)}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
