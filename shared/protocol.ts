/**
 * WebSocket message protocol for terminal sessions and MCP communication.
 *
 * Client -> Server: requests with optional requestId for correlation
 * Server -> Client: responses (with requestId) or streaming data (no requestId)
 */

import type {
  HexCoordinate,
  CellType,
  AgentStatus,
  DetailedStatus,
  AgentSnapshot,
  StoredAgentMetadata,
} from './types.ts';

// Re-export types needed by consumers
export type {
  HexCoordinate,
  CellType,
  AgentStatus,
  DetailedStatus,
  AgentSnapshot,
  StoredAgentMetadata,
};

// ============================================================================
// Client-side Connection State
// ============================================================================

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting';

// ============================================================================
// Session Types
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
  agentSnapshot?: AgentSnapshot;
  allAgents?: AgentSnapshot[];
  initialPrompt?: string;
  task?: string;
  instructions?: string;
  taskDetails?: string;
  parentId?: string;
  parentHex?: HexCoordinate;
}

/**
 * Session info returned from sessions.list - everything needed to restore state.
 */
export interface SessionInfo {
  sessionId: string;
  agent: StoredAgentMetadata | null;
  buffer: string[];
  cols: number;
  rows: number;
  exited: boolean;
}

// ============================================================================
// Callback Types (client-side)
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
    agentSnapshot?: AgentSnapshot;
    allAgents?: AgentSnapshot[];
    initialPrompt?: string;
    task?: string;
    instructions?: string;
    taskDetails?: string;
    parentId?: string;
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

export interface SessionsListRequest {
  type: 'sessions.list';
  requestId: string;
  payload: Record<string, never>;
}

export interface SessionsClearRequest {
  type: 'sessions.clear';
  requestId: string;
  payload: Record<string, never>;
}

export type ClientMessage =
  | CreateRequest
  | WriteRequest
  | ResizeRequest
  | DisposeRequest
  | SessionsListRequest
  | SessionsClearRequest;

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

export interface SessionsListResponse {
  type: 'sessions.list.result';
  requestId: string;
  payload: {
    sessions: SessionInfo[];
  };
}

export interface SessionsClearResponse {
  type: 'sessions.clear.result';
  requestId: string;
  payload: {
    cleared: number;
  };
}

export type ServerMessage =
  | CreatedMessage
  | DataMessage
  | ExitMessage
  | DisposedMessage
  | ErrorMessage
  | SessionsListResponse
  | SessionsClearResponse;

// ============================================================================
// Type Guards
// ============================================================================

export function isClientMessage(msg: unknown): msg is ClientMessage {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return (
    typeof m.type === 'string' &&
    (m.type.startsWith('terminal.') || m.type.startsWith('sessions.')) &&
    typeof m.payload === 'object'
  );
}

// ============================================================================
// MCP Registration
// ============================================================================

export interface McpRegisterRequest {
  type: 'mcp.register';
  payload: {
    agentId: string;
  };
}

// ============================================================================
// MCP Spawn Types
// ============================================================================

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

// ============================================================================
// MCP Grid State Types
// ============================================================================

export interface McpGetGridRequest {
  type: 'mcp.getGrid';
  requestId: string;
  payload: {
    callerId: string;
    maxDistance?: number;
  };
}

export interface McpGridAgent {
  agentId: string;
  cellType: CellType;
  hex: HexCoordinate;
  status: AgentStatus;
  distance: number;
}

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
// MCP Broadcast Types
// ============================================================================

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
// MCP Status Types
// ============================================================================

export interface McpReportStatusRequest {
  type: 'mcp.reportStatus';
  requestId: string;
  payload: {
    callerId: string;
    state: DetailedStatus;
    message?: string;
  };
}

export interface McpReportStatusResponse {
  type: 'mcp.reportStatus.result';
  requestId: string;
  payload: {
    success: boolean;
    error?: string;
  };
}

export interface McpStatusUpdateNotification {
  type: 'mcp.statusUpdate';
  payload: {
    agentId: string;
    state: DetailedStatus;
    message?: string;
  };
}

export interface McpGetWorkerStatusRequest {
  type: 'mcp.getWorkerStatus';
  requestId: string;
  payload: {
    callerId: string;
    workerId: string;
  };
}

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

// ============================================================================
// MCP Diff Types (Get Worker Changes)
// ============================================================================

export interface McpGetWorkerDiffRequest {
  type: 'mcp.getWorkerDiff';
  requestId: string;
  payload: {
    callerId: string;
    workerId: string;
  };
}

export interface McpGetWorkerDiffResponse {
  type: 'mcp.getWorkerDiff.result';
  requestId: string;
  payload: {
    success: boolean;
    diff?: string;
    stats?: {
      files: number;
      insertions: number;
      deletions: number;
    };
    error?: string;
  };
}

// ============================================================================
// MCP Merge Types (Merge Worker Changes)
// ============================================================================

export interface McpMergeWorkerChangesRequest {
  type: 'mcp.mergeWorkerChanges';
  requestId: string;
  payload: {
    callerId: string;
    workerId: string;
  };
}

export interface McpMergeWorkerChangesResponse {
  type: 'mcp.mergeWorkerChanges.result';
  requestId: string;
  payload: {
    success: boolean;
    commitHash?: string;
    filesChanged?: number;
    error?: string;
  };
}

// ============================================================================
// MCP Cleanup Worker Worktree Types
// ============================================================================

export interface McpCleanupWorkerWorktreeRequest {
  type: 'mcp.cleanupWorkerWorktree';
  requestId: string;
  payload: {
    callerId: string;
    workerId: string;
    force?: boolean;
  };
}

export interface McpCleanupWorkerWorktreeResponse {
  type: 'mcp.cleanupWorkerWorktree.result';
  requestId: string;
  payload: {
    success: boolean;
    message?: string;
    error?: string;
  };
}

// ============================================================================
// MCP Kill Worker Types
// ============================================================================

export interface McpKillWorkerRequest {
  type: 'mcp.killWorker';
  requestId: string;
  payload: {
    callerId: string;
    workerId: string;
    force?: boolean;
  };
}

export interface McpKillWorkerResponse {
  type: 'mcp.killWorker.result';
  requestId: string;
  payload: {
    success: boolean;
    terminated?: boolean;
    message?: string;
    error?: string;
  };
}

// ============================================================================
// MCP List Worker Files Types
// ============================================================================

export interface WorkerFileChange {
  path: string;
  status: 'A' | 'M' | 'D' | 'R' | 'C' | 'U';  // Added, Modified, Deleted, Renamed, Copied, Unmerged
  additions: number;
  deletions: number;
}

export interface McpListWorkerFilesRequest {
  type: 'mcp.listWorkerFiles';
  requestId: string;
  payload: {
    callerId: string;
    workerId: string;
  };
}

export interface McpListWorkerFilesResponse {
  type: 'mcp.listWorkerFiles.result';
  requestId: string;
  payload: {
    success: boolean;
    files?: WorkerFileChange[];
    summary?: {
      filesChanged: number;
      totalAdditions: number;
      totalDeletions: number;
    };
    error?: string;
  };
}

// ============================================================================
// MCP List Worker Commits Types
// ============================================================================

export interface WorkerCommit {
  hash: string;
  message: string;
  author: string;
  date: string;
  filesChanged: number;
}

export interface McpListWorkerCommitsRequest {
  type: 'mcp.listWorkerCommits';
  requestId: string;
  payload: {
    callerId: string;
    workerId: string;
  };
}

export interface McpListWorkerCommitsResponse {
  type: 'mcp.listWorkerCommits.result';
  requestId: string;
  payload: {
    success: boolean;
    commits?: WorkerCommit[];
    error?: string;
  };
}

// ============================================================================
// MCP Result Types (Worker -> Orchestrator)
// ============================================================================

export interface TaskAssignment {
  taskId: string;
  description: string;
  details?: string;
  assignedBy: string;
}

export interface AgentMessage {
  id: string;
  from: string;
  type: 'result' | 'broadcast';
  payload: unknown;
  timestamp: string;
}

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

export interface McpReportResultResponse {
  type: 'mcp.reportResult.result';
  requestId: string;
  payload: {
    success: boolean;
    error?: string;
  };
}

export interface McpGetMessagesRequest {
  type: 'mcp.getMessages';
  requestId: string;
  payload: {
    callerId: string;
    since?: string;
  };
}

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
// Inbox Notification Types
// ============================================================================

export interface McpInboxNotification {
  type: 'mcp.inbox.notification';
  payload: {
    agentId: string;
    messageCount: number;
    latestTimestamp: string;
  };
}

export interface InboxUpdatedMessage {
  type: 'inbox.updated';
  payload: {
    agentId: string;
    messageCount: number;
    latestTimestamp: string;
  };
}

// ============================================================================
// MCP Aggregate Types
// ============================================================================

export type McpRequest =
  | McpRegisterRequest
  | McpSpawnRequest
  | McpGetGridRequest
  | McpBroadcastRequest
  | McpReportStatusRequest
  | McpReportResultRequest
  | McpGetMessagesRequest
  | McpGetWorkerStatusRequest
  | McpGetWorkerDiffRequest
  | McpListWorkerFilesRequest
  | McpListWorkerCommitsRequest
  | McpMergeWorkerChangesRequest
  | McpCleanupWorkerWorktreeRequest
  | McpKillWorkerRequest;

export type McpResponse =
  | McpSpawnResponse
  | McpGetGridResponse
  | McpBroadcastResponse
  | McpReportStatusResponse
  | McpReportResultResponse
  | McpGetMessagesResponse
  | McpGetWorkerStatusResponse
  | McpGetWorkerDiffResponse
  | McpListWorkerFilesResponse
  | McpListWorkerCommitsResponse
  | McpMergeWorkerChangesResponse
  | McpCleanupWorkerWorktreeResponse
  | McpKillWorkerResponse;

export type McpNotification =
  | McpBroadcastDelivery
  | McpStatusUpdateNotification
  | McpInboxNotification;

export function isMcpMessage(
  msg: unknown
): msg is McpRequest | McpResponse | McpNotification | InboxUpdatedMessage {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return (
    typeof m.type === 'string' &&
    (m.type.startsWith('mcp.') || m.type === 'inbox.updated')
  );
}
