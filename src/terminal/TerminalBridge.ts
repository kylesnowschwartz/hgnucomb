/**
 * TerminalBridge interface - abstraction over terminal transport.
 *
 * This interface hides WebSocket details so we can swap to Tauri IPC
 * in the future without changing frontend code. All implementations
 * must provide the same behavior contract.
 */

import type {
  ConnectionState,
  TerminalSessionInfo,
  TerminalSessionConfig,
  DataHandler,
  ExitHandler,
  ConnectionHandler,
  McpRequest,
  McpResponse,
} from './types.ts';

export interface TerminalBridge {
  /**
   * Current connection state.
   * Implementations should update this synchronously before calling handlers.
   */
  readonly connectionState: ConnectionState;

  /**
   * Connect to the terminal backend.
   * Resolves when connected, rejects on failure after retries exhausted.
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the terminal backend.
   * Disposes all active sessions and cleans up resources.
   */
  disconnect(): Promise<void>;

  /**
   * Subscribe to connection state changes.
   * @returns Unsubscribe function
   */
  onConnectionChange(handler: ConnectionHandler): () => void;

  /**
   * Create a new terminal session.
   * @param config Optional configuration (cols, rows, shell, cwd)
   * @returns Session info including the assigned sessionId
   */
  createSession(config?: TerminalSessionConfig): Promise<TerminalSessionInfo>;

  /**
   * Dispose a terminal session.
   * Kills the underlying process and cleans up resources.
   */
  disposeSession(sessionId: string): Promise<void>;

  /**
   * Get all active session IDs.
   */
  getSessionIds(): string[];

  /**
   * Write data to a terminal session.
   * Fire-and-forget - no confirmation of delivery.
   */
  write(sessionId: string, data: string): void;

  /**
   * Resize a terminal session.
   * Fire-and-forget - no confirmation of delivery.
   */
  resize(sessionId: string, cols: number, rows: number): void;

  /**
   * Subscribe to data events from a terminal session.
   * @returns Unsubscribe function
   */
  onData(sessionId: string, handler: DataHandler): () => void;

  /**
   * Subscribe to exit events from a terminal session.
   * Called when the underlying process exits.
   * @returns Unsubscribe function
   */
  onExit(sessionId: string, handler: ExitHandler): () => void;

  /**
   * Subscribe to incoming MCP requests from orchestrator agents.
   * @returns Unsubscribe function
   */
  onMcpRequest(handler: (request: McpRequest) => void): () => void;

  /**
   * Send an MCP response back to the requesting agent.
   */
  sendMcpResponse(response: McpResponse): void;
}
