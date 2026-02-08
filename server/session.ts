/**
 * TerminalSession wraps node-pty to provide a simple PTY interface.
 *
 * Unlike terminal-mcp, we don't use xterm headless here - the browser
 * handles all terminal emulation and rendering. This is just a pipe.
 */

import * as pty from "node-pty";
import { execSync } from "child_process";
import { resolve } from "path";

// Default cwd is repo root (parent of server directory)
const DEFAULT_CWD = resolve(process.cwd(), "..");

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
  private ptyProcess: pty.IPty;
  private disposed = false;
  private dataListeners: Array<(data: string) => void> = [];
  private exitListeners: Array<(code: number) => void> = [];

  /** Ring buffer of terminal output for replay on reconnect */
  private outputBuffer: string[] = [];

  readonly cols: number;
  readonly rows: number;
  private cwd: string;

  constructor(options: TerminalSessionOptions = {}) {
    this.cols = options.cols ?? 80;
    this.rows = options.rows ?? 24;
    this.cwd = options.cwd ?? DEFAULT_CWD;
    const shell = options.shell ?? process.env.SHELL ?? "bash";

    // Verify Claude CLI exists before attempting to spawn
    if (shell === "claude") {
      try {
        execSync("which claude", { stdio: "ignore" });
      } catch {
        throw new Error(
          "Claude CLI not found. Install: npm i -g @anthropic-ai/claude-code"
        );
      }
    }

    this.ptyProcess = pty.spawn(shell, options.args ?? [], {
      name: "xterm-256color",
      cols: this.cols,
      rows: this.rows,
      cwd: this.cwd,
      // Set COLUMNS/LINES env vars - some programs read these instead of querying TTY
      env: {
        ...process.env,
        ...options.env,
        COLUMNS: String(this.cols),
        LINES: String(this.rows),
      } as Record<string, string>,
    });

    this.ptyProcess.onData((data) => {
      if (!this.disposed) {
        // Buffer output for replay on reconnect
        this.outputBuffer.push(data);
        if (this.outputBuffer.length > MAX_BUFFER_CHUNKS) {
          this.outputBuffer.shift();
        }

        for (const listener of this.dataListeners) {
          listener(data);
        }
      }
    });

    this.ptyProcess.onExit(({ exitCode }) => {
      this.disposed = true;
      for (const listener of this.exitListeners) {
        listener(exitCode);
      }
    });
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
    this.ptyProcess.write(data);
  }

  resize(cols: number, rows: number): void {
    if (this.disposed) {
      throw new Error("Terminal session has been disposed");
    }
    this.ptyProcess.resize(cols, rows);
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

  /**
   * Respawn the PTY with a different shell (used when converting agent to terminal).
   * Kills the current process and starts a new shell as a regular terminal.
   */
  respawn(shell: string = process.env.SHELL ?? "bash"): void {
    if (this.disposed) {
      throw new Error("Cannot respawn disposed terminal session");
    }

    // Kill the current PTY process
    this.ptyProcess.kill();

    // Start a new PTY with the specified shell
    this.ptyProcess = pty.spawn(shell, [], {
      name: "xterm-256color",
      cols: this.cols,
      rows: this.rows,
      cwd: this.cwd,
      env: {
        ...process.env,
        COLUMNS: String(this.cols),
        LINES: String(this.rows),
      } as Record<string, string>,
    });

    // Fresh shell gets a fresh buffer
    this.outputBuffer = [];
    this.disposed = false;

    // Re-attach data listeners to the new process
    this.ptyProcess.onData((data) => {
      if (!this.disposed) {
        this.outputBuffer.push(data);
        if (this.outputBuffer.length > MAX_BUFFER_CHUNKS) {
          this.outputBuffer.shift();
        }

        for (const listener of this.dataListeners) {
          listener(data);
        }
      }
    });

    // Re-attach exit listeners so cleanup runs when the converted terminal exits
    this.ptyProcess.onExit(({ exitCode }) => {
      this.disposed = true;
      for (const listener of this.exitListeners) {
        listener(exitCode);
      }
    });
  }

  dispose(): void {
    if (!this.disposed) {
      this.disposed = true;
      this.ptyProcess.kill();
    }
  }
}
