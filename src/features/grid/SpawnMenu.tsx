/**
 * SpawnMenu - floating action bar for spawning agents on selected hex.
 *
 * Appears when an empty hex is selected. Provides explicit Terminal/Orchestrator buttons
 * instead of relying on modifier keys (shift+click) which are non-discoverable.
 */

import type { HexCoordinate, CellType } from '@shared/types';
import './SpawnMenu.css';

interface SpawnMenuProps {
  selectedHex: HexCoordinate;
  onSpawn: (cellType: CellType) => void;
  onCancel: () => void;
}

export function SpawnMenu({ selectedHex, onSpawn, onCancel }: SpawnMenuProps) {
  return (
    <div className="spawn-menu">
      <div className="spawn-menu__label">
        Spawn at ({selectedHex.q}, {selectedHex.r})
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
