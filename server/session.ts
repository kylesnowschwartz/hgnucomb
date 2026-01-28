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

export class TerminalSession {
  private ptyProcess: pty.IPty;
  private disposed = false;
  private dataListeners: Array<(data: string) => void> = [];
  private exitListeners: Array<(code: number) => void> = [];

  readonly cols: number;
  readonly rows: number;

  constructor(options: TerminalSessionOptions = {}) {
    this.cols = options.cols ?? 80;
    this.rows = options.rows ?? 24;
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
      cwd: options.cwd ?? DEFAULT_CWD,
      env: { ...process.env, ...options.env } as Record<string, string>,
    });

    this.ptyProcess.onData((data) => {
      if (!this.disposed) {
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

  dispose(): void {
    if (!this.disposed) {
      this.disposed = true;
      this.ptyProcess.kill();
    }
  }
}
