/**
 * AgentDetailsWidget - Observability panel for the selected hex cell agent.
 *
 * Shows agent type, status, task, workers (for orchestrators), and git info.
 * Lives in MetaPanel, updates based on uiStore.selectedAgentId.
 */

import { useState, useEffect } from 'react';
import { useAgentStore, type AgentState } from '@features/agents/agentStore';
import { useUIStore } from '@features/controls/uiStore';
import { TERMINAL_STATUSES } from '@shared/types';
import type { DetailedStatus } from '@shared/types';
import { palette } from '@theme/catppuccin-mocha';
import './AgentDetailsWidget.css';

// ============================================================================
// Status display config
// ============================================================================

const STATUS_ICONS: Record<DetailedStatus, string> = {
  pending: '\u25CB',           // open circle
  idle: '\u25CB',              // open circle
  working: '\u22EF',           // midline horizontal ellipsis
  waiting_input: '?',
  waiting_permission: '!',
  stuck: '\u2717',             // ballot X
  done: '\u2713',              // check mark
  error: '\u2717',             // ballot X
  cancelled: '\u2014',         // em dash
};

const STATUS_COLORS: Record<DetailedStatus, string> = {
  pending: palette.overlay0,
  idle: palette.overlay0,
  working: palette.blue,
  waiting_input: palette.yellow,
  waiting_permission: palette.peach,
  stuck: palette.red,
  done: palette.green,
  error: palette.red,
  cancelled: palette.overlay0,
};

const STATUS_LABELS: Record<DetailedStatus, string> = {
  pending: 'pending',
  idle: 'idle',
  working: 'working',
  waiting_input: 'waiting for input',
  waiting_permission: 'waiting for permission',
  stuck: 'stuck',
  done: 'done',
  error: 'error',
  cancelled: 'cancelled',
};

const TYPE_DOT_CLASS: Record<string, string> = {
  terminal: 'agent-details__type-dot--terminal',
  orchestrator: 'agent-details__type-dot--orchestrator',
  worker: 'agent-details__type-dot--worker',
};

// ============================================================================
// Helpers
// ============================================================================

/** Truncate agent ID for display: "agent-1738...b2c4" */
function truncateId(id: string): string {
  if (id.length <= 20) return id;
  return `${id.slice(0, 10)}...${id.slice(-4)}`;
}

/** Format elapsed time: "12m 34s" / "1h 23m" */
function formatElapsed(createdAt: number, now: number): string {
  const elapsed = Math.max(0, now - createdAt);
  const seconds = Math.floor(elapsed / 1000) % 60;
  const minutes = Math.floor(elapsed / 60000) % 60;
  const hours = Math.floor(elapsed / 3600000);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

/** Format relative time since last activity: "3s ago" / "2m ago" / "idle" */
function formatLastActive(lastActivityAt: number, now: number): string {
  if (!lastActivityAt) return 'no data';
  const elapsed = Math.max(0, now - lastActivityAt);
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return 'idle';
}

// ============================================================================
// Component
// ============================================================================

export function AgentDetailsWidget() {
  const selectedAgentId = useUIStore((s) => s.selectedAgentId);
  const selectedHex = useUIStore((s) => s.selectedHex);
  const hoveredHex = useUIStore((s) => s.hoveredHex);
  const agents = useAgentStore((s) => s.agents);

  // Live tick for elapsed time (1 second)
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Find agent to display: selected agent (panel open) > agent at selected hex > agent at hovered hex
  let agent: AgentState | undefined;
  if (selectedAgentId) {
    agent = agents.get(selectedAgentId);
  } else {
    const hex = selectedHex ?? hoveredHex;
    if (hex) {
      agent = Array.from(agents.values()).find(
        (a) => a.hex.q === hex.q && a.hex.r === hex.r
      );
    }
  }

  if (!agent) {
    return (
      <div className="agent-details">
        <div className="agent-details__empty">Select an agent</div>
      </div>
    );
  }

  // Find child agents (workers spawned by this agent)
  const children: AgentState[] = [];
  for (const a of agents.values()) {
    if (a.parentId === agent.id) {
      children.push(a);
    }
  }

  const doneCount = children.filter((c) =>
    TERMINAL_STATUSES.has(c.detailedStatus)
  ).length;

  return (
    <div className="agent-details">
      {/* Header: type dot + name + ID */}
      <div className="agent-details__header">
        <span className={`agent-details__type-dot ${TYPE_DOT_CLASS[agent.cellType] ?? ''}`} />
        <span className="agent-details__type-name">{agent.cellType}</span>
        <span className="agent-details__id">{truncateId(agent.id)}</span>
      </div>

      {/* Status */}
      <div className="agent-details__row">
        <span className="agent-details__label">Status:</span>
        <span className="agent-details__status">
          <span
            className="agent-details__status-dot"
            style={{ background: STATUS_COLORS[agent.detailedStatus] }}
          />
          <span className="agent-details__value">
            {STATUS_LABELS[agent.detailedStatus]}
          </span>
        </span>
      </div>

      {/* Status message (from report_status) */}
      {agent.statusMessage && (
        <div className="agent-details__row">
          <span className="agent-details__label">Message:</span>
          <span className="agent-details__value">{agent.statusMessage}</span>
        </div>
      )}

      {/* Task */}
      {agent.task && (
        <div className="agent-details__row">
          <span className="agent-details__label">Task:</span>
          <span className="agent-details__task">{agent.task}</span>
        </div>
      )}

      {/* Elapsed time (live-updating) */}
      {agent.createdAt && (
        <div className="agent-details__row">
          <span className="agent-details__label">Elapsed:</span>
          <span className="agent-details__value">
            {formatElapsed(agent.createdAt, now)}
          </span>
        </div>
      )}

      {/* Last active (from PTY activity) */}
      {agent.lastActivityAt != null && agent.lastActivityAt > 0 && (
        <div className="agent-details__row">
          <span className="agent-details__label">Active:</span>
          <span className="agent-details__value">
            {formatLastActive(agent.lastActivityAt, now)}
          </span>
        </div>
      )}

      {/* Workers section (orchestrators with children) */}
      {children.length > 0 && (
        <div className="agent-details__section">
          <div className="agent-details__section-header">
            <span>Workers</span>
            <span className="agent-details__section-summary">
              {doneCount}/{children.length} done
            </span>
          </div>
          {children.map((child) => (
            <div key={child.id} className="agent-details__worker">
              <span
                className="agent-details__worker-status"
                style={{ color: STATUS_COLORS[child.detailedStatus] }}
              >
                {STATUS_ICONS[child.detailedStatus]}
              </span>
              <span className="agent-details__worker-id">
                {truncateId(child.id)}
              </span>
              {child.createdAt && (
                <span className="agent-details__worker-task">
                  {formatElapsed(child.createdAt, now)}
                </span>
              )}
              {child.task && (
                <span className="agent-details__worker-task">{child.task}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Git section (from server agent.activity broadcast) */}
      {agent.gitCommitCount != null && agent.gitCommitCount > 0 && (
        <div className="agent-details__section">
          <div className="agent-details__section-header">
            <span>Git</span>
            <span className="agent-details__section-summary">
              {agent.gitCommitCount} commit{agent.gitCommitCount !== 1 ? 's' : ''}
            </span>
          </div>
          {agent.gitRecentCommits?.map((msg, i) => (
            <div key={i} className="agent-details__commit">{msg}</div>
          ))}
        </div>
      )}
    </div>
  );
}
