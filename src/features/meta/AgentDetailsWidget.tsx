/**
 * AgentDetailsWidget - Observability panel for the selected hex cell agent.
 *
 * Shows agent type, status, task, transcript telemetry (context %, current tool,
 * progress, recent tools), workers (for orchestrators), and git info.
 * Lives in MetaPanel, updates based on uiStore.selectedAgentId.
 */

import { useState, useEffect } from 'react';
import { useAgentStore, type AgentState } from '@features/agents/agentStore';
import { useUIStore } from '@features/controls/uiStore';
import { useShallow } from 'zustand/shallow';
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

/** Format tool duration: "2s" / "150ms" */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${Math.round(ms / 1000)}s`;
}

/** Context bar color by threshold */
function contextBarColor(percent: number): string {
  if (percent < 70) return palette.green;
  if (percent < 85) return palette.yellow;
  return palette.red;
}

// ============================================================================
// Component
// ============================================================================

export function AgentDetailsWidget() {
  const selectedAgentId = useUIStore((s) => s.selectedAgentId);
  const selectedHex = useUIStore((s) => s.selectedHex);
  const hoveredHex = useUIStore((s) => s.hoveredHex);

  // Determine which agent to display: selected > hex-selected > hovered
  const targetHex = selectedHex ?? hoveredHex;
  const agent = useAgentStore((s) => {
    if (selectedAgentId) return s.agents.get(selectedAgentId);
    if (targetHex) {
      for (const a of s.agents.values()) {
        if (a.hex.q === targetHex.q && a.hex.r === targetHex.r) return a;
      }
    }
    return undefined;
  });

  // Subscribe to children of the displayed agent (for worker list).
  // useShallow prevents re-render when unrelated agents change — only fires
  // when the children array contents change (by reference per element).
  const agentId = agent?.id;
  const children = useAgentStore(useShallow((s) => {
    if (!agentId) return [] as AgentState[];
    const result: AgentState[] = [];
    for (const a of s.agents.values()) {
      if (a.parentId === agentId) result.push(a);
    }
    return result;
  }));

  // Live tick for elapsed time (1 second)
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!agent) {
    return (
      <div className="agent-details">
        <div className="agent-details__empty">Select an agent</div>
      </div>
    );
  }

  const doneCount = children.filter((c) =>
    TERMINAL_STATUSES.has(c.detailedStatus)
  ).length;

  // Telemetry data (from transcript watcher via agent.activity broadcast)
  const telemetry = agent.telemetry;
  const todos = telemetry?.todos ?? [];
  const completedTodos = todos.filter((t) => t.status === 'completed').length;
  const recentTools = telemetry?.recentTools?.slice(0, 5) ?? [];

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

      {/* Context % bar (from transcript token usage) */}
      {telemetry?.contextPercent != null && (
        <div className="agent-details__row agent-details__context-row">
          <span className="agent-details__label">Context:</span>
          <div className="agent-details__context-bar-container">
            <div
              className="agent-details__context-bar-fill"
              style={{
                width: `${Math.min(100, telemetry.contextPercent)}%`,
                background: contextBarColor(telemetry.contextPercent),
              }}
            />
          </div>
          <span
            className="agent-details__context-percent"
            style={{ color: contextBarColor(telemetry.contextPercent) }}
          >
            {telemetry.contextPercent}%
          </span>
        </div>
      )}

      {/* Current tool (what the agent is doing right now) */}
      {telemetry?.currentTool && (
        <div className="agent-details__section">
          <div className="agent-details__section-header">
            <span>Current tool</span>
          </div>
          <div className="agent-details__tool-current">
            <span className="agent-details__tool-icon">{'\u22EF'}</span>
            <span className="agent-details__tool-name">{telemetry.currentTool.name}</span>
            {telemetry.currentTool.target && (
              <span className="agent-details__tool-target">{telemetry.currentTool.target}</span>
            )}
            <span className="agent-details__tool-elapsed">
              {formatDuration(now - telemetry.currentTool.startedMs)}
            </span>
          </div>
        </div>
      )}

      {/* Progress (todo list from transcript) */}
      {todos.length > 0 && (
        <div className="agent-details__section">
          <div className="agent-details__section-header">
            <span>Progress</span>
            <span className="agent-details__section-summary">
              {completedTodos}/{todos.length}
            </span>
          </div>
          {todos.map((todo, i) => (
            <div key={i} className="agent-details__todo">
              <span className="agent-details__todo-icon" style={{
                color: todo.status === 'completed' ? palette.green
                  : todo.status === 'in_progress' ? palette.blue
                  : palette.overlay0,
              }}>
                {todo.status === 'completed' ? '\u2713'
                  : todo.status === 'in_progress' ? '\u22EF'
                  : '\u25CB'}
              </span>
              <span className={`agent-details__todo-content${
                todo.status === 'completed' ? ' agent-details__todo-content--done' : ''
              }`}>
                {todo.content}
              </span>
            </div>
          ))}
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

      {/* Recent tools trail */}
      {recentTools.length > 0 && (
        <div className="agent-details__section">
          <div className="agent-details__section-header">
            <span>Recent tools</span>
          </div>
          {recentTools.map((tool, i) => (
            <div key={i} className="agent-details__tool-entry">
              <span
                className="agent-details__tool-icon"
                style={{ color: tool.status === 'error' ? palette.red : palette.green }}
              >
                {tool.status === 'error' ? '\u2717' : '\u2713'}
              </span>
              <span className="agent-details__tool-name">{tool.name}</span>
              {tool.target && (
                <span className="agent-details__tool-target">{tool.target}</span>
              )}
              <span className="agent-details__tool-duration">
                {formatDuration(tool.durationMs)}
              </span>
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
