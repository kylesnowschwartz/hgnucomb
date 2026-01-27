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

export type McpRequest = McpSpawnRequest | McpGetGridRequest;
export type McpResponse = McpSpawnResponse | McpGetGridResponse;
