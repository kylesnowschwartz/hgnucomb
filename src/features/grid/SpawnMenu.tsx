/**
 * SpawnMenu - floating action bar for spawning agents on selected hex.
 *
 * Appears when an empty hex is selected. Provides explicit Terminal/Orchestrator buttons
 * instead of relying on modifier keys (shift+click) which are non-discoverable.
 * Draggable so user can move it out of the way.
 */

import type { HexCoordinate, CellType } from '@shared/types';
import { useDraggable } from './useDraggable';
import './SpawnMenu.css';

interface SpawnMenuProps {
  selectedHex: HexCoordinate;
  onSpawn: (cellType: CellType) => void;
  onCancel: () => void;
}

export function SpawnMenu({ selectedHex, onSpawn, onCancel }: SpawnMenuProps) {
  // Start near bottom center - user can drag to reposition
  const { handleMouseDown, style: dragStyle } = useDraggable({
    initialX: Math.max(0, (window.innerWidth - 280) / 2),
    initialY: window.innerHeight - 120,
  });

  return (
    <div className="spawn-menu" style={dragStyle}>
      <div className="spawn-menu__header" onMouseDown={handleMouseDown}>
        <span className="spawn-menu__label">
          Spawn at ({selectedHex.q}, {selectedHex.r})
        </span>
      </div>
      <div className="spawn-menu__buttons">
        <button
          className="spawn-menu__btn spawn-menu__btn--terminal"
          onClick={() => onSpawn('terminal')}
        >
          Terminal
        </button>
        <button
          className="spawn-menu__btn spawn-menu__btn--orchestrator"
          onClick={() => onSpawn('orchestrator')}
        >
          Orchestrator
        </button>
        <button
          className="spawn-menu__btn spawn-menu__btn--cancel"
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
