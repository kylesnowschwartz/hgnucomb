/**
 * WebSocket implementation of TerminalBridge.
 *
 * Handles:
 * - Request/response correlation via requestId
 * - Per-session listener routing
 * - Exponential backoff reconnection
 * - Cleanup on disconnect
 */

import type { TerminalBridge } from './TerminalBridge.ts';
import type {
  ConnectionState,
  TerminalSessionInfo,
  TerminalSessionConfig,
  DataHandler,
  ExitHandler,
  ConnectionHandler,
  ClientMessage,
  ServerMessage,
  McpRequest,
  McpResponse,
  InboxUpdatedMessage,
  SessionInfo,
} from '@shared/protocol';

const DEFAULT_URL = import.meta.env.VITE_WS_URL ??
  `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
const REQUEST_TIMEOUT_MS = 10000;
const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;
const MAX_RECONNECT_ATTEMPTS = 10;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface SessionListeners {
  data: Set<DataHandler>;
  exit: Set<ExitHandler>;
}

export type McpRequestHandler = (request: McpRequest) => void;

export type NotificationHandler = (notification: unknown) => void;

export class WebSocketBridge implements TerminalBridge {
  private mcpRequestHandlers = new Set<McpRequestHandler>();
  private notificationListeners = new Set<NotificationHandler>();
  private ws: WebSocket | null = null;
  private url: string;
  private _connectionState: ConnectionState = 'disconnected';
  private connectionHandlers = new Set<ConnectionHandler>();
  private pendingRequests = new Map<string, PendingRequest>();
  private sessionListeners = new Map<string, SessionListeners>();
  private activeSessions = new Set<string>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private requestCounter = 0;
  private shouldReconnect = false;

  constructor(url: string = DEFAULT_URL) {
    this.url = url;
  }

  get connectionState(): ConnectionState {
    return this._connectionState;
  }

  private setConnectionState(state: ConnectionState): void {
    if (this._connectionState === state) return;
    this._connectionState = state;
    this.connectionHandlers.forEach((handler) => handler(state));
  }

  async connect(): Promise<void> {
    if (this._connectionState === 'connected') return;
    if (this._connectionState === 'connecting') {
      // Wait for existing connection attempt
      return new Promise((resolve, reject) => {
        const checkState = () => {
          if (this._connectionState === 'connected') {
            resolve();
          } else if (this._connectionState === 'disconnected') {
            reject(new Error('Connection failed'));
          } else {
            setTimeout(checkState, 100);
          }
        };
        checkState();
      });
    }

    this.shouldReconnect = true;
    return this.doConnect();
  }

  private doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.setConnectionState(
        this.reconnectAttempt > 0 ? 'reconnecting' : 'connecting'
      );

      try {
        this.ws = new WebSocket(this.url);
      } catch (err) {
        this.setConnectionState('disconnected');
        reject(err);
        return;
      }

      this.ws.onopen = () => {
        console.log('[WebSocketBridge] Connected');
        this.reconnectAttempt = 0;
        this.setConnectionState('connected');
        resolve();
      };

      this.ws.onclose = () => {
        console.log('[WebSocketBridge] Disconnected');
        this.ws = null;
        this.rejectAllPending(new Error('Connection closed'));

        if (this.shouldReconnect) {
          this.scheduleReconnect();
        } else {
          this.setConnectionState('disconnected');
        }
      };

      this.ws.onerror = (event) => {
        console.error('[WebSocketBridge] Error:', event);
        // onclose will be called after onerror, so we don't need to handle state here
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      // Timeout for initial connection
      setTimeout(() => {
        if (this._connectionState === 'connecting') {
          this.ws?.close();
          reject(new Error('Connection timeout'));
        }
      }, REQUEST_TIMEOUT_MS);
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      console.error('[WebSocketBridge] Max reconnect attempts reached');
      this.shouldReconnect = false;
      this.setConnectionState('disconnected');
      return;
    }

    const delay = Math.min(
      INITIAL_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempt),
      MAX_RECONNECT_DELAY_MS
    );

    console.log(
      `[WebSocketBridge] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt + 1}/${MAX_RECONNECT_ATTEMPTS})`
    );

    this.setConnectionState('reconnecting');
    this.reconnectAttempt++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.doConnect().catch(() => {
        // Error handled in doConnect, reconnect scheduled in onclose
      });
    }, delay);
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.rejectAllPending(new Error('Disconnected'));
    this.activeSessions.clear();
    this.sessionListeners.clear();
    this.setConnectionState('disconnected');
  }

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  onConnectionChange(handler: ConnectionHandler): () => void {
    this.connectionHandlers.add(handler);
    return () => {
      this.connectionHandlers.delete(handler);
    };
  }

  async createSession(config?: TerminalSessionConfig): Promise<TerminalSessionInfo> {
    const requestId = this.nextRequestId();
    const message: ClientMessage = {
      type: 'terminal.create',
      requestId,
      payload: {
        cols: config?.cols,
        rows: config?.rows,
        shell: config?.shell,
        cwd: config?.cwd,
        env: config?.env,
        agentSnapshot: config?.agentSnapshot,
        allAgents: config?.allAgents,
        initialPrompt: config?.initialPrompt,
        task: config?.task,
        instructions: config?.instructions,
        taskDetails: config?.taskDetails,
        parentId: config?.parentId,
        parentHex: config?.parentHex,
        model: config?.model,
      },
    };

    const result = await this.sendRequest<{ sessionId: string; cols: number; rows: number }>(
      requestId,
      message
    );

    this.activeSessions.add(result.sessionId);
    this.sessionListeners.set(result.sessionId, {
      data: new Set(),
      exit: new Set(),
    });

    return result;
  }

  async disposeSession(sessionId: string): Promise<void> {
    const requestId = this.nextRequestId();
    const message: ClientMessage = {
      type: 'terminal.dispose',
      requestId,
      payload: { sessionId },
    };

    await this.sendRequest(requestId, message);
    this.cleanupSession(sessionId);
  }

  private cleanupSession(sessionId: string): void {
    this.activeSessions.delete(sessionId);
    this.sessionListeners.delete(sessionId);
  }

  getSessionIds(): string[] {
    return Array.from(this.activeSessions);
  }

  /**
   * List all active sessions on the server (for reconnect/rehydration).
   * Returns session info including agent metadata and output buffers.
   */
  async listSessions(): Promise<SessionInfo[]> {
    const requestId = this.nextRequestId();
    const message: ClientMessage = {
      type: 'sessions.list',
      requestId,
      payload: {},
    };

    const result = await this.sendRequest<{ sessions: SessionInfo[] }>(requestId, message);
    return result.sessions;
  }

  /**
   * Clear all sessions on the server (user-initiated reset).
   * Kills all PTY processes and clears server state.
   */
  async clearSessions(): Promise<number> {
    const requestId = this.nextRequestId();
    const message: ClientMessage = {
      type: 'sessions.clear',
      requestId,
      payload: {},
    };

    const result = await this.sendRequest<{ cleared: number }>(requestId, message);

    // Clear local tracking
    this.activeSessions.clear();
    this.sessionListeners.clear();

    return result.cleared;
  }

  /**
   * Attach to an existing session (for reconnect).
   * Sets up local listeners without creating a new session.
   */
  attachSession(sessionId: string): void {
    this.activeSessions.add(sessionId);
    if (!this.sessionListeners.has(sessionId)) {
      this.sessionListeners.set(sessionId, {
        data: new Set(),
        exit: new Set(),
      });
    }
    console.log('[WebSocketBridge] Attached to existing session:', sessionId);
  }

  write(sessionId: string, data: string): void {
    const message: ClientMessage = {
      type: 'terminal.write',
      payload: { sessionId, data },
    };
    this.send(message);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const message: ClientMessage = {
      type: 'terminal.resize',
      payload: { sessionId, cols, rows },
    };
    this.send(message);
  }

  /**
   * Upload an image file to the server for a terminal session.
   * The image is saved to the agent's worktree or scratchpad, and the path
   * is automatically injected into the terminal stdin.
   *
   * @param sessionId - Target terminal session
   * @param params - Image upload parameters (filename, data, mimeType)
   * @returns Promise resolving to the absolute path where the image was saved
   */
  async uploadImage(sessionId: string, params: {
    filename: string;
    data: string;
    mimeType: string;
  }): Promise<string> {
    const requestId = this.nextRequestId();
    const message: ClientMessage = {
      type: 'terminal.uploadImage',
      requestId,
      payload: {
        sessionId,
        ...params,
      },
    };

    const result = await this.sendRequest<{ success: boolean; path?: string; error?: string }>(
      requestId,
      message
    );

    if (!result.success || !result.path) {
      throw new Error(result.error ?? 'Image upload failed');
    }

    return result.path;
  }

  onData(sessionId: string, handler: DataHandler): () => void {
    const listeners = this.sessionListeners.get(sessionId);
    if (!listeners) {
      // Session doesn't exist yet - create placeholder listeners
      this.sessionListeners.set(sessionId, {
        data: new Set([handler]),
        exit: new Set(),
      });
    } else {
      listeners.data.add(handler);
    }

    return () => {
      const l = this.sessionListeners.get(sessionId);
      l?.data.delete(handler);
    };
  }

  onExit(sessionId: string, handler: ExitHandler): () => void {
    const listeners = this.sessionListeners.get(sessionId);
    if (!listeners) {
      this.sessionListeners.set(sessionId, {
        data: new Set(),
        exit: new Set([handler]),
      });
    } else {
      listeners.exit.add(handler);
    }

    return () => {
      const l = this.sessionListeners.get(sessionId);
      l?.exit.delete(handler);
    };
  }

  // ============================================================================
  // MCP Message Handling
  // ============================================================================

  /**
   * Subscribe to incoming MCP requests from orchestrator agents.
   */
  onMcpRequest(handler: McpRequestHandler): () => void {
    this.mcpRequestHandlers.add(handler);
    return () => {
      this.mcpRequestHandlers.delete(handler);
    };
  }

  /**
   * Send an MCP response back to the requesting agent.
   */
  sendMcpResponse(response: McpResponse): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[WebSocketBridge] Cannot send MCP response: not connected');
      return;
    }
    this.ws.send(JSON.stringify(response));
  }

  /**
   * Send inbox notification to server, which routes to the agent's MCP server.
   * This wakes any pending get_messages(wait=true) call.
   */
  sendInboxNotification(payload: {
    agentId: string;
    messageCount: number;
    latestTimestamp: string;
  }): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[WebSocketBridge] Cannot send inbox notification: not connected');
      return;
    }
    const msg: InboxUpdatedMessage = { type: 'inbox.updated', payload };
    this.ws.send(JSON.stringify(msg));
  }

  /**
   * Subscribe to server notifications (agent removal, status updates, etc.)
   */
  onNotification(handler: NotificationHandler): () => void {
    this.notificationListeners.add(handler);
    return () => {
      this.notificationListeners.delete(handler);
    };
  }

  private nextRequestId(): string {
    return `req-${++this.requestCounter}-${Date.now()}`;
  }

  private send(message: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[WebSocketBridge] Cannot send: not connected');
      return;
    }
    this.ws.send(JSON.stringify(message));
  }

  private sendRequest<T>(requestId: string, message: ClientMessage): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Not connected'));
        return;
      }

      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request timeout: ${requestId}`));
      }, REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });

      this.ws.send(JSON.stringify(message));
    });
  }

  private handleMessage(raw: string): void {
    let msg: ServerMessage | McpRequest;
    try {
      msg = JSON.parse(raw);
    } catch {
      console.error('[WebSocketBridge] Invalid JSON:', raw);
      return;
    }

    // Route MCP requests to handlers
    if (
      msg.type === 'mcp.spawn' ||
      msg.type === 'mcp.getGrid' ||
      msg.type === 'mcp.broadcast' ||
      msg.type === 'mcp.reportStatus' ||
      msg.type === 'mcp.reportResult' ||
      msg.type === 'mcp.getMessages' ||
      msg.type === 'mcp.getWorkerStatus'
    ) {
      this.mcpRequestHandlers.forEach((handler) => handler(msg as McpRequest));
      return;
    }

    switch (msg.type) {
      case 'terminal.created': {
        const pending = this.pendingRequests.get(msg.requestId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(msg.requestId);
          pending.resolve(msg.payload);
        }
        break;
      }

      case 'terminal.disposed': {
        const pending = this.pendingRequests.get(msg.requestId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(msg.requestId);
          pending.resolve(msg.payload);
        }
        break;
      }

      case 'terminal.data': {
        const listeners = this.sessionListeners.get(msg.payload.sessionId);
        listeners?.data.forEach((handler) => handler(msg.payload.data));
        break;
      }

      case 'terminal.exit': {
        const listeners = this.sessionListeners.get(msg.payload.sessionId);
        listeners?.exit.forEach((handler) => handler(msg.payload.exitCode));
        this.cleanupSession(msg.payload.sessionId);
        break;
      }

      case 'cell.converted': {
        // Notify all listeners about cell type conversion (orchestrator/worker -> terminal)
        this.notificationListeners.forEach((handler) => handler(msg));
        break;
      }

      case 'terminal.error': {
        if (msg.requestId) {
          const pending = this.pendingRequests.get(msg.requestId);
          if (pending) {
            clearTimeout(pending.timeout);
            this.pendingRequests.delete(msg.requestId);
            pending.reject(new Error(msg.payload.message));
          }
        } else {
          console.error('[WebSocketBridge] Server error:', msg.payload.message);
        }
        break;
      }

      case 'sessions.list.result':
      case 'sessions.clear.result':
      case 'terminal.uploadImage.result': {
        const pending = this.pendingRequests.get(msg.requestId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(msg.requestId);
          pending.resolve(msg.payload);
        }
        break;
      }

      default: {
        // Handle server notifications (e.g., agent.removed, mcp.statusUpdate)
        const msgAny = msg as { type: string };
        if (msgAny.type === 'agent.removed' || msgAny.type === 'mcp.statusUpdate') {
          this.notificationListeners.forEach((handler) => handler(msg));
        }
        break;
      }
    }
  }
}
