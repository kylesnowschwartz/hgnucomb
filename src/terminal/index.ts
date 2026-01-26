/**
 * Terminal bridge module - client-side terminal abstraction.
 */

export type {
  ConnectionState,
  TerminalSessionInfo,
  TerminalSessionConfig,
  DataHandler,
  ExitHandler,
  ConnectionHandler,
} from './types.ts';

export type { TerminalBridge } from './TerminalBridge.ts';

export { WebSocketBridge } from './WebSocketBridge.ts';
