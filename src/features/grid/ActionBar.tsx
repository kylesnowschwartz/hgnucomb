/**
 * ActionBar - Contextual keyboard hints near selected hex.
 *
 * Shows available actions based on cell state:
 * - Empty cell: spawn hints (T/O/W)
 * - Occupied cell: action hints (Enter/X) - only when terminal closed
 *
 * Positioned below the selected hex with a fade-in delay.
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
  const pendingKill = useUIStore((s) => s.pendingKill);
  const getAllAgents = useAgentStore((s) => s.getAllAgents);

  // Get viewport state from store
  const scale = useViewportStore((s) => s.scale);
  const position = useViewportStore((s) => s.position);
  const hexSize = useViewportStore((s) => s.hexSize);

  const isTerminalOpen = !!selectedAgentId;

  // Check if selected hex is occupied
  const agentAtHex = useMemo(() => {
    if (!selectedHex) return null;
    const agents = getAllAgents();
    return agents.find(
      (a) => a.hex.q === selectedHex.q && a.hex.r === selectedHex.r
    );
  }, [selectedHex, getAllAgents]);

  // Show kill confirmation if pending
  const showKillConfirmation = !!pendingKill;

  // Kill confirmation always shows (it's anchored to pendingKill hex, not mouse position).
  // Otherwise: show for selected hex when terminal is closed, or for empty cells.
  const shouldShow = showKillConfirmation || (selectedHex && (!isTerminalOpen || !agentAtHex));

  // Fade-in delay
  const [delayedHexKey, setDelayedHexKey] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Use pendingKill for stability during kill confirmation (mouse hover changes selectedHex)
  const stableHex = pendingKill || selectedHex;
  const hexKey = stableHex ? `${stableHex.q},${stableHex.r}` : null;

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!hexKey) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Resetting state on unmount is valid
      setDelayedHexKey(null);
      return;
    }

    // Short delay to avoid flicker during rapid movement
    timerRef.current = setTimeout(() => {
      setDelayedHexKey(hexKey);
    }, 150);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [hexKey]);

  const isVisible = hexKey !== null && delayedHexKey === hexKey;

  if (!shouldShow || !isVisible) return null;

  // Determine which hex to use for positioning (pending kill or selected)
  const displayHex = pendingKill || selectedHex;
  if (!displayHex) return null;

  // Calculate screen position
  const worldPos = hexToPixel(displayHex, hexSize);
  const screenX = worldPos.x * scale + position.x;
  const screenY = worldPos.y * scale + position.y + hexSize * scale + 10;

  // Hints based on state
  let hints: ActionHint[];
  if (showKillConfirmation) {
    hints = [
      { key: 'x', label: 'confirm' },
      { key: 'Enter', label: 'confirm' },
      { key: 'Esc', label: 'cancel' },
    ];
  } else {
    hints = agentAtHex
      ? [
          { key: 'Enter', label: 'open' },
          { key: 'x', label: 'kill' },
        ]
      : [
          { key: 't', label: 'terminal' },
          { key: 'o', label: 'orchestrator' },
          { key: 'w', label: 'worker' },
        ];
  }

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
