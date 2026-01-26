/**
 * TerminalSessionManager handles multiple terminal sessions.
 *
 * Generates sequential IDs (term-001, term-002, ...) and provides
 * lifecycle management for all sessions.
 */

import { TerminalSession, TerminalSessionOptions } from "./session.js";

export class TerminalSessionManager {
  private sessions = new Map<string, TerminalSession>();
  private counter = 0;

  private generateId(): string {
    this.counter++;
    return `term-${String(this.counter).padStart(3, "0")}`;
  }

  create(options: TerminalSessionOptions = {}): { session: TerminalSession; sessionId: string } {
    const sessionId = this.generateId();
    const session = new TerminalSession(options);
    this.sessions.set(sessionId, session);
    return { session, sessionId };
  }

  get(sessionId: string): TerminalSession | undefined {
    return this.sessions.get(sessionId);
  }

  dispose(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.dispose();
      this.sessions.delete(sessionId);
      return true;
    }
    return false;
  }

  disposeAll(): void {
    for (const [sessionId, session] of this.sessions) {
      session.dispose();
      this.sessions.delete(sessionId);
    }
  }

  getSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  size(): number {
    return this.sessions.size;
  }
}
