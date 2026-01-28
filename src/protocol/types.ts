/**
 * Event Protocol Types for hgnucomb
 *
 * Defines the message contract between the event hub and UI components.
 * Adapted from ccswarm patterns for hub-spoke agent coordination.
 *
 * @see .agent-history/context-packet-task1-event-protocol.md
 */

import type { HexCoordinate } from '@shared/types';

// ============================================================================
// Message Type Discriminant
// ============================================================================

/**
 * All valid message types in the protocol.
 * Uses dot notation for namespacing: agent.* for agent lifecycle, task.* for work.
 */
export type MessageType =
  | 'agent.spawn'
  | 'agent.status'
  | 'agent.despawn'
  | 'task.assign'
  | 'task.progress'
  | 'task.complete'
  | 'task.fail';

// ============================================================================
// Agent Payloads
// ============================================================================

/** Role classification for agents */
export type AgentRole = 'orchestrator' | 'worker' | 'specialist';

/** Cell type determines behavior: terminal = shell, orchestrator = Claude agent (full tools), worker = Claude agent (limited tools) */
export type CellType = 'terminal' | 'orchestrator' | 'worker';

/** Agent operational status */
export type AgentStatus = 'idle' | 'working' | 'blocked' | 'offline';

/**
 * Payload for agent.spawn events.
 * Sent when a new agent joins the system.
 */
export interface SpawnPayload {
  /** Unique identifier for this agent */
  agentId: string;
  /** Agent's role in the system */
  role: AgentRole;
  /** System prompt or description of the agent's purpose */
  systemPrompt: string;
  /** Initial position on the hex grid */
  hex: HexCoordinate;
  /** Agent IDs this agent can communicate with */
  connections: string[];
}

/**
 * Payload for agent.status events.
 * Sent when an agent's status changes.
 */
export interface StatusPayload {
  /** ID of the agent reporting status */
  agentId: string;
  /** Current operational status */
  status: AgentStatus;
  /** Optional message explaining the status */
  message?: string;
}

/**
 * Payload for agent.despawn events.
 * Sent when an agent leaves the system.
 */
export interface DespawnPayload {
  /** ID of the departing agent */
  agentId: string;
  /** Reason for despawning */
  reason: 'completed' | 'error' | 'timeout' | 'manual';
}

// ============================================================================
// Task Payloads
// ============================================================================

/**
 * Payload for task.assign events.
 * Sent when a task is assigned to an agent.
 */
export interface TaskAssignPayload {
  /** Unique identifier for the task */
  taskId: string;
  /** ID of the agent receiving the task */
  agentId: string;
  /** Human-readable task description */
  description: string;
  /** Optional structured task data */
  data?: Record<string, unknown>;
}

/**
 * Payload for task.progress events.
 * Sent by agents to report incremental progress.
 */
export interface TaskProgressPayload {
  /** ID of the task being worked on */
  taskId: string;
  /** Progress from 0.0 (not started) to 1.0 (complete) */
  progress: number;
  /** Human-readable status message */
  message: string;
}

/**
 * Payload for task.complete events.
 * Sent when an agent successfully finishes a task.
 */
export interface TaskCompletePayload {
  /** ID of the completed task */
  taskId: string;
  /** Optional result data */
  result?: Record<string, unknown>;
}

/**
 * Payload for task.fail events.
 * Sent when an agent cannot complete a task.
 */
export interface TaskFailPayload {
  /** ID of the failed task */
  taskId: string;
  /** Error description */
  error: string;
}

// ============================================================================
// Message Envelope
// ============================================================================

/** Maps message types to their payload types */
export interface PayloadMap {
  'agent.spawn': SpawnPayload;
  'agent.status': StatusPayload;
  'agent.despawn': DespawnPayload;
  'task.assign': TaskAssignPayload;
  'task.progress': TaskProgressPayload;
  'task.complete': TaskCompletePayload;
  'task.fail': TaskFailPayload;
}

/**
 * Message envelope that wraps all protocol messages.
 * All messages route through the hub - no direct agent-to-agent messaging.
 *
 * @typeParam T - The message type discriminant
 */
export interface Message<T extends MessageType = MessageType> {
  /** Unique message identifier (e.g., "evt-001") */
  id: string;
  /** Message type discriminant */
  type: T;
  /** Sender identifier ("hub" for hub-originated messages) */
  from: string;
  /** Recipient identifier ("broadcast" for all agents, or specific agentId) */
  to: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Type-safe payload based on message type */
  payload: PayloadMap[T];
}

// ============================================================================
// Factory Helpers
// ============================================================================

let messageCounter = 0;

/**
 * Create a new message with auto-generated ID and timestamp.
 */
export function createMessage<T extends MessageType>(
  type: T,
  from: string,
  to: string,
  payload: PayloadMap[T]
): Message<T> {
  messageCounter++;
  return {
    id: `evt-${String(messageCounter).padStart(3, '0')}`,
    type,
    from,
    to,
    timestamp: new Date().toISOString(),
    payload,
  };
}

/**
 * Reset message counter (useful for testing).
 */
export function resetMessageCounter(): void {
  messageCounter = 0;
}
