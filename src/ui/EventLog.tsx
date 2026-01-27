/**
 * EventLog - Unified timeline of broadcasts and lifecycle events.
 *
 * Shows a scrolling list with filtering by event type.
 */

import { useRef, useEffect, useState } from 'react';
import { useEventLogStore, type LogEvent } from '@state/eventLogStore';
import { useShallow } from 'zustand/shallow';
import { useDraggable } from '@hooks/useDraggable';
import { palette } from '@theme/catppuccin-mocha';
import './EventLog.css';

interface EventLogProps {
  /** Maximum height before scrolling */
  maxHeight?: number;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour12: false });
}

function formatEventSummary(event: LogEvent): string {
  switch (event.kind) {
    case 'broadcast':
      return `${event.senderId} => r=${event.radius} [${event.broadcastType}] (${event.recipientCount})`;
    case 'spawn':
      return `${event.agentId} spawned at (${event.hex.q},${event.hex.r}) [${event.cellType}]`;
    case 'kill':
      return `${event.agentId} killed`;
    case 'status_change':
      return `${event.agentId}: ${event.previousStatus ?? '?'} -> ${event.newStatus}${event.message ? ` "${event.message}"` : ''}`;
  }
}

function getEventColor(kind: LogEvent['kind']): string {
  switch (kind) {
    case 'broadcast':
      return palette.sapphire;
    case 'spawn':
      return palette.green;
    case 'kill':
      return palette.red;
    case 'status_change':
      return palette.yellow;
  }
}

function getEventIcon(kind: LogEvent['kind']): string {
  switch (kind) {
    case 'broadcast':
      return '\u2192'; // arrow
    case 'spawn':
      return '+';
    case 'kill':
      return '\u2715'; // x mark
    case 'status_change':
      return '\u25CF'; // filled circle
  }
}

export function EventLog({ maxHeight = 200 }: EventLogProps) {
  const events = useEventLogStore(useShallow((s) => s.events));
  const clear = useEventLogStore((s) => s.clear);

  const [showBroadcasts, setShowBroadcasts] = useState(true);
  const [showLifecycle, setShowLifecycle] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);

  // Draggable panel - starts bottom-left (maxHeight ~280px total including header)
  const { handleMouseDown, style: dragStyle } = useDraggable({
    initialX: 16,
    initialY: window.innerHeight - 280,
  });

  // Auto-scroll to bottom on new events
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [events.length]);

  // Filter events
  const filteredEvents = events.filter((e) => {
    if (e.kind === 'broadcast') return showBroadcasts;
    return showLifecycle; // spawn, kill, status_change
  });

  return (
    <div className="event-log" style={dragStyle}>
      <div className="event-log__header" onMouseDown={handleMouseDown}>
        <span className="event-log__title">Events</span>
        <div className="event-log__filters">
          <label className="event-log__filter">
            <input
              type="checkbox"
              checked={showBroadcasts}
              onChange={(e) => setShowBroadcasts(e.target.checked)}
            />
            <span style={{ color: palette.sapphire }}>Broadcasts</span>
          </label>
          <label className="event-log__filter">
            <input
              type="checkbox"
              checked={showLifecycle}
              onChange={(e) => setShowLifecycle(e.target.checked)}
            />
            <span style={{ color: palette.green }}>Lifecycle</span>
          </label>
          <button className="event-log__clear" onClick={clear}>
            Clear
          </button>
        </div>
      </div>
      <div
        className="event-log__list"
        ref={logRef}
        style={{ maxHeight }}
      >
        {filteredEvents.length === 0 ? (
          <div className="event-log__empty">No events yet</div>
        ) : (
          filteredEvents.map((event) => (
            <div key={event.id} className="event-log__item">
              <span
                className="event-log__icon"
                style={{ color: getEventColor(event.kind) }}
              >
                {getEventIcon(event.kind)}
              </span>
              <span className="event-log__time">{formatTime(event.timestamp)}</span>
              <span className="event-log__summary">{formatEventSummary(event)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
