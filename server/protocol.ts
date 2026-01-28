/**
 * WebSocket message protocol for terminal sessions.
 *
 * Client -> Server: requests with optional requestId for correlation
 * Server -> Client: responses (with requestId) or streaming data (no requestId)
 */

// ============================================================================
// Agent snapshot types (for context generation)
// ============================================================================

export interface HexCoordinate {
  q: number;
  r: number;
}

export type CellType = "terminal" | "orchestrator" | "worker";
export type AgentStatus = "idle" | "working" | "blocked" | "offline";

/**
 * Minimal agent info sent from client when creating a session.
 */
export interface AgentSnapshot {
  agentId: string;
  cellType: CellType;
  hex: HexCoordinate;
  status: AgentStatus;
  connections: string[];
}

// ============================================================================
// Request types (Client -> Server)
// ============================================================================

export interface CreateRequest {
  type: "terminal.create";
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
  type: "terminal.write";
  requestId?: string;
  payload: {
    sessionId: string;
    data: string;
  };
}

export interface ResizeRequest {
  type: "terminal.resize";
  requestId?: string;
  payload: {
    sessionId: string;
    cols: number;
    rows: number;
  };
}

export interface DisposeRequest {
  type: "terminal.dispose";
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
// Response types (Server -> Client)
// ============================================================================

export interface CreatedMessage {
  type: "terminal.created";
  requestId: string;
  payload: {
    sessionId: string;
    cols: number;
    rows: number;
  };
}

export interface DataMessage {
  type: "terminal.data";
  payload: {
    sessionId: string;
    data: string;
  };
}

export interface ExitMessage {
  type: "terminal.exit";
  payload: {
    sessionId: string;
    exitCode: number;
  };
}

export interface DisposedMessage {
  type: "terminal.disposed";
  requestId: string;
  payload: {
    sessionId: string;
  };
}

export interface ErrorMessage {
  type: "terminal.error";
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
// Type guards
// ============================================================================

export function isClientMessage(msg: unknown): msg is ClientMessage {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return (
    typeof m.type === "string" &&
    m.type.startsWith("terminal.") &&
    typeof m.payload === "object"
  );
}

// ============================================================================
// MCP Message Types
// ============================================================================

/**
 * MCP client registration - identifies a WebSocket client as an MCP server.
 */
export interface McpRegisterRequest {
  type: "mcp.register";
  payload: {
    agentId: string;
  };
}

/**
 * MCP spawn request - orchestrator requests spawning a new agent.
 */
export interface McpSpawnRequest {
  type: "mcp.spawn";
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
 * MCP get grid state request - query agents on the grid.
 */
export interface McpGetGridRequest {
  type: "mcp.getGrid";
  requestId: string;
  payload: {
    callerId: string;
    maxDistance?: number;
  };
}

/**
 * MCP spawn response - sent back to MCP server.
 */
export interface McpSpawnResponse {
  type: "mcp.spawn.result";
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
 * MCP get grid response - sent back to MCP server.
 */
export interface McpGetGridResponse {
  type: "mcp.getGrid.result";
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
 * MCP broadcast request - agent sends message to nearby agents within radius.
 */
export interface McpBroadcastRequest {
  type: "mcp.broadcast";
  requestId: string;
  payload: {
    callerId: string;
    radius: number;
    broadcastType: string;
    broadcastPayload: unknown;
  };
}

/**
 * MCP broadcast response - sent back to MCP server.
 */
export interface McpBroadcastResponse {
  type: "mcp.broadcast.result";
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
  type: "mcp.broadcast.delivery";
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
  | "idle"           // At prompt, waiting for command
  | "working"        // Actively executing
  | "waiting_input"  // Needs user to type something
  | "waiting_permission" // Needs Y/N approval
  | "done"           // Finished assigned task
  | "stuck"          // Explicitly requested help
  | "error";         // Critical failure

/**
 * MCP report_status request - agent reports its current state.
 */
export interface McpReportStatusRequest {
  type: "mcp.reportStatus";
  requestId: string;
  payload: {
    callerId: string;
    state: DetailedStatus;
    message?: string;
  };
}

/**
 * MCP report_status response - sent back to MCP server.
 */
export interface McpReportStatusResponse {
  type: "mcp.reportStatus.result";
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
  type: "mcp.statusUpdate";
  payload: {
    agentId: string;
    state: DetailedStatus;
    message?: string;
  };
}

export type McpRequest =
  | McpRegisterRequest
  | McpSpawnRequest
  | McpGetGridRequest
  | McpBroadcastRequest
  | McpReportStatusRequest
  | McpReportResultRequest
  | McpGetMessagesRequest;

export type McpResponse =
  | McpSpawnResponse
  | McpGetGridResponse
  | McpBroadcastResponse
  | McpReportStatusResponse
  | McpReportResultResponse
  | McpGetMessagesResponse;

export type McpNotification =
  | McpBroadcastDelivery
  | McpStatusUpdateNotification;

// ============================================================================
// Bilateral Communication Types (Task Assignment & Results)
// ============================================================================

/**
 * Task assignment - included in context JSON when spawning workers.
 */
export interface TaskAssignment {
  taskId: string;
  description: string;
  details?: string;
  assignedBy: string;
}

/**
 * Message stored in agent inbox - results from workers or broadcasts.
 */
export interface AgentMessage {
  id: string;
  from: string;
  type: "result" | "broadcast";
  payload: unknown;
  timestamp: string;
}

/**
 * MCP report_result request - worker reports task completion to parent.
 */
export interface McpReportResultRequest {
  type: "mcp.reportResult";
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
  type: "mcp.reportResult.result";
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
  type: "mcp.getMessages";
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
  type: "mcp.getMessages.result";
  requestId: string;
  payload: {
    success: boolean;
    messages?: AgentMessage[];
    error?: string;
  };
}

/**
 * Type guard for MCP messages (from MCP server or browser client).
 */
export function isMcpMessage(msg: unknown): msg is McpRequest | McpResponse | McpNotification {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return typeof m.type === "string" && m.type.startsWith("mcp.");
}
