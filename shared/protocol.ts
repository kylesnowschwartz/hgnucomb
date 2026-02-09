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

export type AgentModel = 'opus' | 'sonnet' | 'haiku';

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
  model?: AgentModel;
  /** Target project directory (where agents create worktrees and work) */
  projectDir?: string;
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
    model?: AgentModel;
    /** Target project directory (where agents create worktrees and work) */
    projectDir?: string;
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

export interface UploadImageRequest {
  type: 'terminal.uploadImage';
  requestId: string;
  payload: {
    sessionId: string;
    filename: string;
    data: string; // base64-encoded image data
    mimeType: string;
  };
}

// ============================================================================
// Project Validation (Client -> Server -> Client)
// ============================================================================

export interface ProjectValidateRequest {
  type: 'project.validate';
  requestId: string;
  payload: {
    path: string;
  };
}

export interface ProjectValidateResponse {
  type: 'project.validate.result';
  requestId: string;
  payload: {
    path: string;
    resolvedPath: string;
    exists: boolean;
    isGitRepo: boolean;
  };
}

/**
 * Server -> Client on initial connection.
 * Tells the browser where hgnucomb lives (toolDir) and the default project.
 */
export interface ServerInfoMessage {
  type: 'server.info';
  payload: {
    toolDir: string;
    defaultProjectDir: string;
  };
}

export type ClientMessage =
  | CreateRequest
  | WriteRequest
  | ResizeRequest
  | DisposeRequest
  | SessionsListRequest
  | SessionsClearRequest
  | UploadImageRequest
  | ProjectValidateRequest;

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

export interface UploadImageResponse {
  type: 'terminal.uploadImage.result';
  requestId: string;
  payload: {
    success: boolean;
    path?: string; // Absolute path to saved image
    error?: string;
  };
}

export interface CellConvertedMessage {
  type: 'cell.converted';
  payload: {
    sessionId: string;
    agentId: string;
    oldCellType: CellType;
    newCellType: CellType;
  };
}

export type ServerMessage =
  | CreatedMessage
  | DataMessage
  | ExitMessage
  | DisposedMessage
  | ErrorMessage
  | SessionsListResponse
  | SessionsClearResponse
  | UploadImageResponse
  | CellConvertedMessage
  | ProjectValidateResponse
  | ServerInfoMessage;

// ============================================================================
// Type Guards
// ============================================================================

export function isClientMessage(msg: unknown): msg is ClientMessage {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return (
    typeof m.type === 'string' &&
    (m.type.startsWith('terminal.') || m.type.startsWith('sessions.') || m.type.startsWith('project.')) &&
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
    model?: 'opus' | 'sonnet' | 'haiku';
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
// MCP Check Merge Conflicts Types
// ============================================================================

export interface McpCheckMergeConflictsRequest {
  type: 'mcp.checkMergeConflicts';
  requestId: string;
  payload: {
    callerId: string;
    workerId: string;
  };
}

export interface McpCheckMergeConflictsResponse {
  type: 'mcp.checkMergeConflicts.result';
  requestId: string;
  payload: {
    success: boolean;
    canMerge?: boolean;
    output?: string;  // Raw git output - orchestrator interprets
    error?: string;
  };
}

// ============================================================================
// MCP Staging Merge Types
// ============================================================================

// Merge worker branch into orchestrator's staging worktree
export interface McpMergeWorkerToStagingRequest {
  type: 'mcp.mergeWorkerToStaging';
  requestId: string;
  payload: {
    callerId: string;  // orchestrator's agent ID
    workerId: string;  // worker to merge
  };
}

export interface McpMergeWorkerToStagingResponse {
  type: 'mcp.mergeWorkerToStaging.result';
  requestId: string;
  payload: {
    success: boolean;
    output?: string;  // Raw git merge output
    error?: string;
  };
}

// Merge orchestrator's staging branch into main
export interface McpMergeStagingToMainRequest {
  type: 'mcp.mergeStagingToMain';
  requestId: string;
  payload: {
    callerId: string;  // orchestrator's agent ID (determines which staging branch)
  };
}

export interface McpMergeStagingToMainResponse {
  type: 'mcp.mergeStagingToMain.result';
  requestId: string;
  payload: {
    success: boolean;
    output?: string;  // Raw git merge output
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
    output?: string;  // Raw git diff --stat output
    error?: string;
  };
}

// ============================================================================
// MCP List Worker Commits Types
// ============================================================================

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
    output?: string;  // Raw git log output
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
    fromAgent?: string;  // Filter messages by sender agent ID
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

/**
 * Server -> Browser: sync inbox state for UI display.
 * The server is now the source of truth for inboxes.
 */
export interface InboxSyncMessage {
  type: 'inbox.sync';
  payload: {
    agentId: string;
    messages: AgentMessage[];
  };
}

// ============================================================================
// Agent Activity Broadcast (server -> browser, periodic)
// ============================================================================

/**
 * Periodic activity data for agent observability HUD.
 * Sent every 5 seconds for each Claude agent session.
 */
export interface AgentActivityMessage {
  type: 'agent.activity';
  payload: {
    agents: AgentActivityData[];
  };
}

export interface AgentActivityData {
  agentId: string;
  /** Session creation time (epoch ms) */
  createdAt: number;
  /** Last PTY output time (epoch ms), 0 if never */
  lastActivityAt: number;
  /** Number of commits on agent's worktree branch vs main */
  gitCommitCount: number;
  /** Recent commit messages (last 3, one-line) */
  gitRecentCommits: string[];
}

// ============================================================================
// Agent Removal Notification (server -> browser)
// ============================================================================

/**
 * Broadcast when an agent is cleaned up or killed.
 * All browser clients receive this to remove the agent from their UI.
 */
export interface AgentRemovedNotification {
  type: 'agent.removed';
  payload: {
    agentId: string;
    reason: 'cleanup' | 'kill';
    sessionId?: string;
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
  | McpCheckMergeConflictsRequest
  | McpMergeWorkerToStagingRequest
  | McpMergeStagingToMainRequest
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
  | McpCheckMergeConflictsResponse
  | McpMergeWorkerToStagingResponse
  | McpMergeStagingToMainResponse
  | McpCleanupWorkerWorktreeResponse
  | McpKillWorkerResponse;

export type McpNotification =
  | McpBroadcastDelivery
  | McpStatusUpdateNotification
  | McpInboxNotification;

export function isMcpMessage(
  msg: unknown
): msg is McpRequest | McpResponse | McpNotification | InboxUpdatedMessage | InboxSyncMessage | AgentRemovedNotification {
  if (typeof msg !== 'object' || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return (
    typeof m.type === 'string' &&
    (m.type.startsWith('mcp.') || m.type.startsWith('inbox.') || m.type === 'agent.removed')
  );
}
