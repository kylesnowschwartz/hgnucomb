/**
 * ActionBar - Contextual keyboard hints near selected hex.
 *
 * Shows available actions based on cell state:
 * - Empty cell: spawn hints (T/O/W)
 * - Occupied cell: action hints (Enter/X)
 *
 * Positioned below the selected hex with a 300ms fade-in delay.
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { useUIStore } from '@features/controls/uiStore';
import { useAgentStore } from '@features/agents/agentStore';
import { useViewportStore } from './viewportStore';
import { hexToPixel } from '@shared/types';
import './ActionBar.css';

interface ActionHint {
  key: string;
  label: string;
}

export function ActionBar() {
  const selectedHex = useUIStore((s) => s.selectedHex);
  const selectedAgentId = useUIStore((s) => s.selectedAgentId);
  const getAllAgents = useAgentStore((s) => s.getAllAgents);

  // Get viewport state from store
  const scale = useViewportStore((s) => s.scale);
  const position = useViewportStore((s) => s.position);
  const hexSize = useViewportStore((s) => s.hexSize);

  // Fade-in delay - show after 300ms of selection
  const [delayedHexKey, setDelayedHexKey] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Current hex key
  const hexKey = selectedHex ? `${selectedHex.q},${selectedHex.r}` : null;

  useEffect(() => {
    // Clear any existing timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!hexKey) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Resetting state on unmount is valid
      setDelayedHexKey(null);
      return;
    }

    // Delay before showing
    timerRef.current = setTimeout(() => {
      setDelayedHexKey(hexKey);
    }, 300);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [hexKey]);

  // Visible when delayed key matches current key
  const isVisible = hexKey !== null && delayedHexKey === hexKey;

  // Determine if selected hex is occupied
  const agentAtHex = useMemo(() => {
    if (!selectedHex) return null;
    const agents = getAllAgents();
    return agents.find(
      (a) => a.hex.q === selectedHex.q && a.hex.r === selectedHex.r
    );
  }, [selectedHex, getAllAgents]);

  // Don't show if no selection
  if (!selectedHex) return null;

  // Don't show if terminal panel is open (mode = terminal)
  if (selectedAgentId) return null;

  // Don't show until fade-in delay
  if (!isVisible) return null;

  // Calculate screen position
  const worldPos = hexToPixel(selectedHex, hexSize);
  const screenX = worldPos.x * scale + position.x;
  const screenY = worldPos.y * scale + position.y + hexSize * scale + 10; // Below hex

  // Hints based on cell state
  const hints: ActionHint[] = agentAtHex
    ? [
        { key: 'Enter', label: 'open' },
        { key: 'X', label: 'kill' },
      ]
    : [
        { key: 't', label: 'terminal' },
        { key: 'o', label: 'orchestrator' },
        { key: 'w', label: 'worker' },
      ];

  return (
    <div
      className="action-bar"
      style={{
        left: screenX,
        top: screenY,
        transform: 'translateX(-50%)',
      }}
    >
      {hints.map((hint) => (
        <span key={hint.key} className="action-bar__hint">
          <kbd className="action-bar__key">{hint.key}</kbd>
          <span className="action-bar__label">{hint.label}</span>
        </span>
      ))}
    </div>
  );
}
