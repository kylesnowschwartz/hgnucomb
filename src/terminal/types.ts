/**
 * Client-side terminal protocol types.
 *
 * These mirror server/protocol.ts but are duplicated because the server
 * is a separate package. Keeping them in sync is a manual process.
 */

import type { AgentSnapshot } from '@shared/context.ts';

// ============================================================================
// Connection State
// ============================================================================

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting';

// ============================================================================
// Session Info
// ============================================================================

export interface TerminalSessionInfo {
  sessionId: string;
  cols: number;
  rows: number;
}

export interface TerminalSessionConfig {
  cols?: number;
  rows?: number;
  shell?: string;
  cwd?: string;
  env?: Record<string, string>;
  /** Agent info for context generation (orchestrators only) */
  agentSnapshot?: AgentSnapshot;
  /** All agents on grid for context generation */
  allAgents?: AgentSnapshot[];
  /** Initial prompt passed as CLI arg to Claude */
  initialPrompt?: string;
  /** Task assignment for worker agents */
  task?: string;
  /** Instructions (prompt) for worker agents - sent as initial prompt */
  instructions?: string;
  taskDetails?: string;
  /** Parent agent ID for workers spawned by orchestrators */
  parentId?: string;
  /** Parent hex for context generation */
  parentHex?: HexCoordinate;
}

// ============================================================================
// Callback Types
// ============================================================================

export type DataHandler = (data: string) => void;
export type ExitHandler = (exitCode: number) => void;
export type ConnectionHandler = (state: ConnectionState) => void;

// ============================================================================
// Request Types (Client -> Server)
// ============================================================================

export interface CreateRequest {
  type: 'terminal.create';
  requestId: string;
  payload: {
    cols?: number;
    rows?: number;
    shell?: string;
    cwd?: string;
    env?: Record<string, string>;
    /** Agent info for context generation (orchestrators only) */
    agentSnapshot?: AgentSnapshot;
    /** All agents on grid for context generation */
    allAgents?: AgentSnapshot[];
    /** Initial prompt passed as CLI arg to Claude */
    initialPrompt?: string;
    /** Task assignment for worker agents */
    task?: string;
    /** Instructions (prompt) for worker agents - sent as initial prompt */
    instructions?: string;
    taskDetails?: string;
    /** Parent agent ID for workers spawned by orchestrators */
    parentId?: string;
    /** Parent hex for context generation */
    parentHex?: HexCoordinate;
  };
}

export interface WriteRequest {
  type: 'terminal.write';
  requestId?: string;
  payload: {
    sessionId: string;
    data: string;
  };
}

export interface ResizeRequest {
  type: 'terminal.resize';
  requestId?: string;
  payload: {
    sessionId: string;
    cols: number;
    rows: number;
  };
}

export interface DisposeRequest {
  type: 'terminal.dispose';
  requestId: string;
  payload: {
    sessionId: string;
  };
}

export type ClientMessage =
  | CreateRequest
  | WriteRequest
  | ResizeRequest
  | DisposeRequest;

// ============================================================================
// Response Types (Server -> Client)
// ============================================================================

export interface CreatedMessage {
  type: 'terminal.created';
  requestId: string;
  payload: {
    sessionId: string;
    cols: number;
    rows: number;
  };
}

export interface DataMessage {
  type: 'terminal.data';
  payload: {
    sessionId: string;
    data: string;
  };
}

export interface ExitMessage {
  type: 'terminal.exit';
  payload: {
    sessionId: string;
    exitCode: number;
  };
}

export interface DisposedMessage {
  type: 'terminal.disposed';
  requestId: string;
  payload: {
    sessionId: string;
  };
}

export interface ErrorMessage {
  type: 'terminal.error';
  requestId?: string;
  payload: {
    message: string;
    sessionId?: string;
  };
}

export type ServerMessage =
  | CreatedMessage
  | DataMessage
  | ExitMessage
  | DisposedMessage
  | ErrorMessage;

// ============================================================================
// MCP Message Types (browser <-> server routing)
// ============================================================================

import type { HexCoordinate } from '@shared/types.ts';
import type { CellType, AgentStatus } from '@shared/context.ts';

/**
 * MCP spawn request - routed from MCP server via WS server.
 */
export interface McpSpawnRequest {
  type: 'mcp.spawn';
  requestId: string;
  payload: {
    callerId: string;
    q?: number;
    r?: number;
    cellType: CellType;
    task?: string;
    instructions?: string;
    taskDetails?: string;
  };
}

/**
 * MCP get grid state request - routed from MCP server via WS server.
 */
export interface McpGetGridRequest {
  type: 'mcp.getGrid';
  requestId: string;
  payload: {
    callerId: string;
    maxDistance?: number;
  };
}

/**
 * MCP spawn response - sent from browser to MCP server via WS server.
 */
export interface McpSpawnResponse {
  type: 'mcp.spawn.result';
  requestId: string;
  payload: {
    success: boolean;
    agentId?: string;
    hex?: HexCoordinate;
    error?: string;
  };
}

/**
 * Agent info in grid state response.
 */
export interface McpGridAgent {
  agentId: string;
  cellType: CellType;
  hex: HexCoordinate;
  status: AgentStatus;
  distance: number;
}

/**
 * MCP get grid response - sent from browser to MCP server via WS server.
 */
export interface McpGetGridResponse {
  type: 'mcp.getGrid.result';
  requestId: string;
  payload: {
    success: boolean;
    agents?: McpGridAgent[];
    error?: string;
  };
}

// ============================================================================
// MCP Broadcast Types (Phase 5.1)
// ============================================================================

/**
 * MCP broadcast request - routed from MCP server via WS server.
 */
export interface McpBroadcastRequest {
  type: 'mcp.broadcast';
  requestId: string;
  payload: {
    callerId: string;
    radius: number;
    broadcastType: string;
    broadcastPayload: unknown;
  };
}

/**
 * MCP broadcast response - sent from browser to MCP server via WS server.
 */
export interface McpBroadcastResponse {
  type: 'mcp.broadcast.result';
  requestId: string;
  payload: {
    success: boolean;
    delivered: number;
    recipients: string[];
    error?: string;
  };
}

/**
 * MCP broadcast delivery - sent to recipient agents.
 */
export interface McpBroadcastDelivery {
  type: 'mcp.broadcast.delivery';
  payload: {
    senderId: string;
    senderHex: HexCoordinate;
    broadcastType: string;
    broadcastPayload: unknown;
  };
}

// ============================================================================
// MCP Status Types (Phase 5.2)
// ============================================================================

/**
 * Detailed agent status - 7-state model for fine-grained observability.
 */
export type DetailedStatus =
  | 'idle'
  | 'working'
  | 'waiting_input'
  | 'waiting_permission'
  | 'done'
  | 'stuck'
  | 'error';

/**
 * MCP report_status request - routed from MCP server via WS server.
 */
export interface McpReportStatusRequest {
  type: 'mcp.reportStatus';
  requestId: string;
  payload: {
    callerId: string;
    state: DetailedStatus;
    message?: string;
  };
}

/**
 * MCP report_status response - sent from browser to MCP server via WS server.
 */
export interface McpReportStatusResponse {
  type: 'mcp.reportStatus.result';
  requestId: string;
  payload: {
    success: boolean;
    error?: string;
  };
}

/**
 * Status update notification - broadcast to browser clients.
 */
export interface McpStatusUpdateNotification {
  type: 'mcp.statusUpdate';
  payload: {
    agentId: string;
    state: DetailedStatus;
    message?: string;
  };
}

// ============================================================================
// Bilateral Communication Types (Task Assignment & Results)
// ============================================================================

/**
 * Message stored in agent inbox - results from workers or broadcasts.
 */
export interface AgentMessage {
  id: string;
  from: string;
  type: 'result' | 'broadcast';
  payload: unknown;
  timestamp: string;
}

/**
 * MCP report_result request - worker reports task completion to parent.
 */
export interface McpReportResultRequest {
  type: 'mcp.reportResult';
  requestId: string;
  payload: {
    callerId: string;
    parentId: string;
    result: unknown;
    success: boolean;
    message?: string;
  };
}

/**
 * MCP report_result response - sent back to worker.
 */
export interface McpReportResultResponse {
  type: 'mcp.reportResult.result';
  requestId: string;
  payload: {
    success: boolean;
    error?: string;
  };
}

/**
 * MCP get_messages request - agent polls its inbox.
 */
export interface McpGetMessagesRequest {
  type: 'mcp.getMessages';
  requestId: string;
  payload: {
    callerId: string;
    since?: string;
  };
}

/**
 * MCP get_messages response - messages from inbox.
 */
export interface McpGetMessagesResponse {
  type: 'mcp.getMessages.result';
  requestId: string;
  payload: {
    success: boolean;
    messages?: AgentMessage[];
    error?: string;
  };
}

// ============================================================================
// Inbox Push Notification Types
// ============================================================================

/**
 * Inbox notification - sent to MCP server to wake pending get_messages(wait=true).
 * This is sent FROM server TO MCP client when new messages arrive.
 */
export interface McpInboxNotification {
  type: 'mcp.inbox.notification';
  payload: {
    agentId: string;
    messageCount: number;
    latestTimestamp: string;
  };
}

/**
 * Inbox updated message - sent FROM browser TO server when messages are added.
 * Server routes this to the recipient's MCP connection.
 */
export interface InboxUpdatedMessage {
  type: 'inbox.updated';
  payload: {
    agentId: string;
    messageCount: number;
    latestTimestamp: string;
  };
}

// ============================================================================
// Worker Status Types (Two-Phase Coordination)
// ============================================================================

/**
 * MCP get_worker_status request - orchestrator checks a worker's status.
 */
export interface McpGetWorkerStatusRequest {
  type: 'mcp.getWorkerStatus';
  requestId: string;
  payload: {
    callerId: string;
    workerId: string;
  };
}

/**
 * MCP get_worker_status response - returns worker's detailed status.
 */
export interface McpGetWorkerStatusResponse {
  type: 'mcp.getWorkerStatus.result';
  requestId: string;
  payload: {
    success: boolean;
    status?: DetailedStatus;
    message?: string;
    error?: string;
  };
}

export type McpRequest = McpSpawnRequest | McpGetGridRequest | McpBroadcastRequest | McpReportStatusRequest | McpReportResultRequest | McpGetMessagesRequest | McpGetWorkerStatusRequest;
export type McpResponse = McpSpawnResponse | McpGetGridResponse | McpBroadcastResponse | McpReportStatusResponse | McpReportResultResponse | McpGetMessagesResponse | McpGetWorkerStatusResponse;
export type McpNotification = McpBroadcastDelivery | McpStatusUpdateNotification | McpInboxNotification;
