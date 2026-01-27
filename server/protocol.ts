/**
 * WebSocket message protocol for terminal sessions.
 *
 * Client -> Server: requests with optional requestId for correlation
 * Server -> Client: responses (with requestId) or streaming data (no requestId)
 */

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
