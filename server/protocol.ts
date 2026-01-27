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

export type CellType = "terminal" | "orchestrator";
export type AgentStatus = "idle" | "active" | "paused" | "terminated";

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

export type McpRequest = McpRegisterRequest | McpSpawnRequest | McpGetGridRequest;
export type McpResponse = McpSpawnResponse | McpGetGridResponse;

/**
 * Type guard for MCP messages (from MCP server or browser client).
 */
export function isMcpMessage(msg: unknown): msg is McpRequest | McpResponse {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as Record<string, unknown>;
  return typeof m.type === "string" && m.type.startsWith("mcp.");
}
