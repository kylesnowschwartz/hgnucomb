import { useRef, useState, useEffect, useCallback } from 'react';
import {
  ScriptPlayer,
  buildDemoScript,
  type ScriptEvent,
} from '@protocol/script';
import type {
  Message,
  SpawnPayload,
  TaskAssignPayload,
  TaskProgressPayload,
  TaskCompletePayload,
  TaskFailPayload,
} from '@protocol/types';
import './ControlPanel.css';

/**
 * Format an event into a human-readable summary.
 */
function formatEventSummary(event: Message): string {
  switch (event.type) {
    case 'agent.spawn': {
      const p = event.payload as SpawnPayload;
      return p.agentId;
    }
    case 'agent.status': {
      const p = event.payload as { agentId: string; status: string };
      return `${p.agentId} ${p.status}`;
    }
    case 'agent.despawn': {
      const p = event.payload as { agentId: string };
      return p.agentId;
    }
    case 'task.assign': {
      const p = event.payload as TaskAssignPayload;
      return `${p.taskId} \u2192 ${p.agentId}`;
    }
    case 'task.progress': {
      const p = event.payload as TaskProgressPayload;
      return `${p.taskId} ${Math.round(p.progress * 100)}%`;
    }
    case 'task.complete': {
      const p = event.payload as TaskCompletePayload;
      return p.taskId;
    }
    case 'task.fail': {
      const p = event.payload as TaskFailPayload;
      return `${p.taskId} (error)`;
    }
    default:
      return '';
  }
}

/**
 * Floating control panel with event log and playback controls.
 * Manages its own ScriptPlayer instance.
 */
export function ControlPanel() {
  const [events, setEvents] = useState<Message[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const playerRef = useRef<ScriptPlayer | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [events]);

  const handlePlay = useCallback(() => {
    if (isPlaying) return;

    // Build fresh script each time (resets message IDs)
    const freshScript: ScriptEvent[] = buildDemoScript(2000);
    const player = new ScriptPlayer(freshScript);
    playerRef.current = player;

    setEvents([]);
    setIsPlaying(true);

    player.subscribe((event) => {
      setEvents((prev) => [...prev, event]);
    });

    player.play().then(() => {
      setIsPlaying(false);
    });
  }, [isPlaying]);

  const handleStop = useCallback(() => {
    if (playerRef.current) {
      playerRef.current.stop();
    }
    setEvents([]);
    setIsPlaying(false);
  }, []);

  return (
    <div className="control-panel">
      <div className="control-panel__log" ref={logRef}>
        {events.length === 0 ? (
          <div className="control-panel__log--empty">
            No events yet. Click Play to start.
          </div>
        ) : (
          events.map((event, index) => (
            <div key={event.id} className="control-panel__event">
              <span className="control-panel__event-seq">
                #{index + 1}
              </span>
              <span className="control-panel__event-type">
                {event.type}
              </span>
              <span className="control-panel__event-summary">
                {formatEventSummary(event)}
              </span>
            </div>
          ))
        )}
      </div>
      <div className="control-panel__controls">
        <button
          className="control-panel__btn control-panel__btn--play"
          onClick={handlePlay}
          disabled={isPlaying}
        >
          {'\u25B6'} Play
        </button>
        <button
          className="control-panel__btn control-panel__btn--stop"
          onClick={handleStop}
          disabled={!isPlaying}
        >
          {'\u25A0'} Stop
        </button>
      </div>
    </div>
  );
}
