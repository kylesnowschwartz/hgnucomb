/**
 * TerminalSession wraps Bun.Terminal to provide a PTY interface.
 *
 * Unlike terminal-mcp, we don't use xterm headless here - the browser
 * handles all terminal emulation and rendering. This is just a pipe.
 */

import { resolve } from "path";

// Default cwd is repo root (parent of server directory)
const DEFAULT_CWD = resolve(process.cwd(), "..");

const decoder = new TextDecoder();

export interface TerminalSessionOptions {
  cols?: number;
  rows?: number;
  shell?: string;
  /** Arguments to pass to the shell */
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

// Ring buffer size for output replay on reconnect
const MAX_BUFFER_CHUNKS = 1000;

export class TerminalSession {
  private proc: ReturnType<typeof Bun.spawn>;
  private disposed = false;
  private dataListeners: Array<(data: string) => void> = [];
  private exitListeners: Array<(code: number) => void> = [];

  /** Ring buffer of terminal output for replay on reconnect */
  private outputBuffer: string[] = [];

  readonly cols: number;
  readonly rows: number;

  constructor(options: TerminalSessionOptions = {}) {
    this.cols = options.cols ?? 80;
    this.rows = options.rows ?? 24;
    const shell = options.shell ?? process.env.SHELL ?? "bash";

    // Verify required CLIs exist before attempting to spawn
    if (shell === "claude") {
      if (!Bun.which("claude")) {
        throw new Error(
          "Claude CLI not found. Install: npm i -g @anthropic-ai/claude-code"
        );
      }
    }

    if (shell === "claude-chill") {
      if (!Bun.which("claude-chill")) {
        throw new Error(
          "claude-chill not found. Install: cargo install --git https://github.com/davidbeesley/claude-chill"
        );
      }
      // claude-chill wraps claude, so verify claude exists too
      if (!Bun.which("claude")) {
        throw new Error(
          "Claude CLI not found (required by claude-chill). Install: npm i -g @anthropic-ai/claude-code"
        );
      }
    }

    this.proc = Bun.spawn([shell, ...(options.args ?? [])], {
      cwd: options.cwd ?? DEFAULT_CWD,
      env: {
        ...process.env,
        ...options.env,
        TERM: "xterm-256color",
        COLUMNS: String(this.cols),
        LINES: String(this.rows),
      } as Record<string, string>,
      terminal: {
        cols: this.cols,
        rows: this.rows,
        data: (_terminal, data) => {
          if (this.disposed) return;

          const str = decoder.decode(data);

          // Buffer output for replay on reconnect
          this.outputBuffer.push(str);
          if (this.outputBuffer.length > MAX_BUFFER_CHUNKS) {
            this.outputBuffer.shift();
          }

          for (const listener of this.dataListeners) {
            listener(str);
          }
        },
      },
    });

    // Monitor process exit via the exited promise
    this.proc.exited.then((exitCode) => {
      this.disposed = true;
      this.proc.terminal?.close();
      for (const listener of this.exitListeners) {
        listener(exitCode);
      }
    });
  }

  get pid(): number {
    return this.proc.pid;
  }

  onData(listener: (data: string) => void): void {
    this.dataListeners.push(listener);
  }

  onExit(listener: (code: number) => void): void {
    this.exitListeners.push(listener);
  }

  write(data: string): void {
    if (this.disposed) {
      throw new Error("Terminal session has been disposed");
    }
    this.proc.terminal!.write(data);
  }

  resize(cols: number, rows: number): void {
    if (this.disposed) {
      throw new Error("Terminal session has been disposed");
    }
    this.proc.terminal!.resize(cols, rows);
  }

  isActive(): boolean {
    return !this.disposed;
  }

  /**
   * Get buffered output for replay on reconnect.
   * Returns copy of buffer (caller can join with '' to get full output).
   */
  getBuffer(): string[] {
    return [...this.outputBuffer];
  }

  /**
   * Clear output buffer (e.g., after successful replay).
   */
  clearBuffer(): void {
    this.outputBuffer = [];
  }

  dispose(): void {
    if (!this.disposed) {
      this.disposed = true;
      this.proc.terminal?.close();
      this.proc.kill("SIGKILL");
    }
  }
}
