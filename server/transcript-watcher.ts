/**
 * TranscriptWatcher - real-time JSONL transcript tailing for agent telemetry.
 *
 * Per-agent lifecycle:
 *   1. startWatching(agentId, worktreePath) - polls for .hgnucomb-transcript-path
 *   2. Once found, tails the JSONL file incrementally (byte-offset reads)
 *   3. Parses tool_use, tool_result, TodoWrite, TaskCreate, TaskUpdate, usage
 *   4. getTelemetry(agentId) returns cached state for broadcast
 *   5. stopWatching(agentId) - cleans up timers and file handles
 *
 * Parses JSONL transcript format from Claude Code sessions.
 */

import { existsSync, readFileSync, statSync, createReadStream } from "fs";
import { createInterface } from "readline";
import { join, basename } from "path";

// ============================================================================
// Types
// ============================================================================

export interface ToolEntry {
  id: string;
  name: string;
  target?: string;
  status: "running" | "completed" | "error";
  startTime: number; // epoch ms
  endTime?: number;
  durationMs?: number;
}

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface AgentTelemetry {
  /** Currently running tool (null if idle between tool calls) */
  currentTool: {
    name: string;
    target?: string;
    startedMs: number;
  } | null;
  /** Last N completed tools (most recent first) */
  recentTools: Array<{
    name: string;
    target?: string;
    status: "completed" | "error";
    durationMs: number;
  }>;
  /** Current todo list from TodoWrite/TaskCreate/TaskUpdate */
  todos: TodoItem[];
  /** Derived context percentage (tokens / model context window) */
  contextPercent?: number;
}

// ============================================================================
// JSONL entry shapes (subset of what Claude Code writes)
// ============================================================================

interface ContentBlock {
  type: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  is_error?: boolean;
}

interface TranscriptEntry {
  type?: string;
  message?: {
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    content?: ContentBlock[];
  };
}

// ============================================================================
// Per-agent watcher state
// ============================================================================

interface WatcherState {
  agentId: string;
  worktreePath: string;
  /** Polls for .hgnucomb-transcript-path until found */
  discoveryTimer?: ReturnType<typeof setInterval>;
  /** Tails the JSONL file at interval */
  tailTimer?: ReturnType<typeof setInterval>;
  /** Byte offset for incremental reads */
  byteOffset: number;
  /** Path to the JSONL file (once discovered) */
  transcriptPath?: string;
  /** Running tools keyed by tool_use id */
  runningTools: Map<string, ToolEntry>;
  /** Completed tools (most recent last, capped) */
  completedTools: ToolEntry[];
  /** Current todo list */
  todos: TodoItem[];
  /** Task ID -> index in todos array (for TaskUpdate resolution) */
  taskIdToIndex: Map<string, number>;
  /** Latest context percentage */
  contextPercent?: number;
}

// ============================================================================
// Constants
// ============================================================================

const DISCOVERY_POLL_MS = 500;
const DISCOVERY_TIMEOUT_MS = 120_000; // 2 minutes
const TAIL_POLL_MS = 200;
const MAX_COMPLETED_TOOLS = 8;
const PATH_FILE = ".hgnucomb-transcript-path";

/** Model context window sizes (tokens). Conservative defaults. */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "claude-opus-4": 200_000,
  "claude-sonnet-4": 200_000,
  "claude-haiku-4": 200_000,
};
const DEFAULT_CONTEXT_WINDOW = 200_000;

// ============================================================================
// TranscriptWatcher
// ============================================================================

export class TranscriptWatcher {
  private watchers = new Map<string, WatcherState>();

  /**
   * Start watching for an agent's transcript.
   * Polls for the path file, then tails the JSONL.
   */
  startWatching(agentId: string, worktreePath: string): void {
    // Idempotent: stop existing watcher first
    if (this.watchers.has(agentId)) {
      this.stopWatching(agentId);
    }

    const state: WatcherState = {
      agentId,
      worktreePath,
      byteOffset: 0,
      runningTools: new Map(),
      completedTools: [],
      todos: [],
      taskIdToIndex: new Map(),
    };

    this.watchers.set(agentId, state);

    const startTime = Date.now();

    // Poll for the path file
    state.discoveryTimer = setInterval(() => {
      // Timeout: stop polling after DISCOVERY_TIMEOUT_MS
      if (Date.now() - startTime > DISCOVERY_TIMEOUT_MS) {
        if (state.discoveryTimer) {
          clearInterval(state.discoveryTimer);
          state.discoveryTimer = undefined;
        }
        console.log(
          `[TranscriptWatcher] Timed out waiting for transcript path: ${agentId}`
        );
        return;
      }

      const pathFile = join(worktreePath, PATH_FILE);
      if (!existsSync(pathFile)) return;

      // Read transcript path from the file
      try {
        const transcriptPath = readFileSync(pathFile, "utf8").trim();
        if (!transcriptPath) return;

        state.transcriptPath = transcriptPath;

        // Stop discovery polling
        if (state.discoveryTimer) {
          clearInterval(state.discoveryTimer);
          state.discoveryTimer = undefined;
        }

        console.log(
          `[TranscriptWatcher] Found transcript for ${agentId}: ${transcriptPath}`
        );

        // Start tailing
        this.startTailing(state);
      } catch {
        // File exists but can't read yet -- retry next poll
      }
    }, DISCOVERY_POLL_MS);
  }

  /**
   * Stop watching an agent's transcript. Cleans up all timers.
   */
  stopWatching(agentId: string): void {
    const state = this.watchers.get(agentId);
    if (!state) return;

    if (state.discoveryTimer) {
      clearInterval(state.discoveryTimer);
    }
    if (state.tailTimer) {
      clearInterval(state.tailTimer);
    }

    this.watchers.delete(agentId);
  }

  /**
   * Get current telemetry for an agent.
   * Returns undefined if agent isn't being watched or no data yet.
   */
  getTelemetry(agentId: string): AgentTelemetry | undefined {
    const state = this.watchers.get(agentId);
    if (!state || !state.transcriptPath) return undefined;

    // Current tool = most recently started tool that hasn't completed
    let currentTool: AgentTelemetry["currentTool"] = null;
    for (const tool of state.runningTools.values()) {
      if (
        !currentTool ||
        tool.startTime > currentTool.startedMs
      ) {
        currentTool = {
          name: tool.name,
          target: tool.target,
          startedMs: tool.startTime,
        };
      }
    }

    // Recent tools: reversed (most recent first), capped for display
    const recentTools = state.completedTools
      .slice(-MAX_COMPLETED_TOOLS)
      .reverse()
      .map((t) => ({
        name: t.name,
        target: t.target,
        status: t.status as "completed" | "error",
        durationMs: t.durationMs ?? 0,
      }));

    return {
      currentTool,
      recentTools,
      todos: [...state.todos],
      contextPercent: state.contextPercent,
    };
  }

  /**
   * Stop all watchers. Called on server shutdown.
   */
  dispose(): void {
    for (const agentId of this.watchers.keys()) {
      this.stopWatching(agentId);
    }
  }

  // ==========================================================================
  // Internal: tailing
  // ==========================================================================

  private startTailing(state: WatcherState): void {
    const { transcriptPath } = state;
    if (!transcriptPath) return;

    // Do an initial full read, then poll for new data
    this.tailOnce(state);

    state.tailTimer = setInterval(() => {
      this.tailOnce(state);
    }, TAIL_POLL_MS);
  }

  private tailOnce(state: WatcherState): void {
    const { transcriptPath } = state;
    if (!transcriptPath) return;

    try {
      const stat = statSync(transcriptPath);

      // Detect file truncation (context compaction or /clear).
      // When Claude Code compacts, the transcript file shrinks. Our stored
      // byteOffset now points past EOF, so we'd silently stop reading forever.
      // Reset offset to re-read from the start and clear stale tool state.
      if (stat.size < state.byteOffset) {
        console.log(
          `[TranscriptWatcher] Transcript truncated for ${state.agentId}: ` +
            `${state.byteOffset} → ${stat.size} bytes. Resetting watcher.`
        );
        state.byteOffset = 0;
        state.runningTools.clear();
        state.completedTools = [];
        // Keep todos -- task state persists across compaction
        // contextPercent will update from the next assistant message
      }

      if (stat.size <= state.byteOffset) return; // Caught up, no new data

      // Read new bytes from offset
      const stream = createReadStream(transcriptPath, {
        start: state.byteOffset,
      });
      const rl = createInterface({ input: stream, crlfDelay: Infinity });

      rl.on("line", (line) => {
        if (!line.trim()) return;
        try {
          const entry = JSON.parse(line) as TranscriptEntry;
          this.processEntry(state, entry);
        } catch {
          // Skip malformed lines
        }
      });

      rl.on("close", () => {
        state.byteOffset = stat.size;
      });
    } catch {
      // File may be momentarily unavailable -- retry next poll
    }
  }

  // ==========================================================================
  // Internal: JSONL parsing
  // ==========================================================================

  private processEntry(state: WatcherState, entry: TranscriptEntry): void {
    // Extract usage from assistant messages
    const usage = entry.message?.usage;
    if (usage) {
      const totalInput =
        (usage.input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0);
      const totalTokens = totalInput + (usage.output_tokens ?? 0);

      // Look up context window from model
      const model = entry.message?.model ?? "";
      let contextWindow = DEFAULT_CONTEXT_WINDOW;
      for (const [prefix, size] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
        if (model.startsWith(prefix)) {
          contextWindow = size;
          break;
        }
      }

      state.contextPercent = Math.round((totalTokens / contextWindow) * 100);
    }

    const content = entry.message?.content;
    if (!content || !Array.isArray(content)) return;

    const now = Date.now();

    for (const block of content) {
      // Tool use: register as running
      if (block.type === "tool_use" && block.id && block.name) {
        const toolEntry: ToolEntry = {
          id: block.id,
          name: block.name,
          target: extractTarget(block.name, block.input),
          status: "running",
          startTime: now,
        };

        // Special-case: TodoWrite replaces entire todo list
        if (block.name === "TodoWrite") {
          const input = block.input as { todos?: TodoItem[] };
          if (input?.todos && Array.isArray(input.todos)) {
            state.todos.length = 0;
            state.taskIdToIndex.clear();
            state.todos.push(
              ...input.todos.map((t) => ({
                content: t.content ?? "Untitled",
                status: normalizeTodoStatus(t.status) ?? "pending",
              }))
            );
          }
        } else if (block.name === "TaskCreate") {
          const input = block.input as Record<string, unknown>;
          const subject =
            typeof input?.subject === "string" ? input.subject : "";
          const description =
            typeof input?.description === "string" ? input.description : "";
          const taskContent = subject || description || "Untitled task";
          const status = normalizeTodoStatus(input?.status) ?? "pending";
          state.todos.push({ content: taskContent, status });

          // Track task ID for later TaskUpdate resolution
          const rawTaskId = input?.taskId;
          const taskId =
            typeof rawTaskId === "string" || typeof rawTaskId === "number"
              ? String(rawTaskId)
              : block.id;
          if (taskId) {
            state.taskIdToIndex.set(taskId, state.todos.length - 1);
          }
        } else if (block.name === "TaskUpdate") {
          const input = block.input as Record<string, unknown>;
          const index = resolveTaskIndex(
            input?.taskId,
            state.taskIdToIndex,
            state.todos
          );
          if (index !== null) {
            const status = normalizeTodoStatus(input?.status);
            if (status) {
              state.todos[index].status = status;
            }
            const subject =
              typeof input?.subject === "string" ? input.subject : "";
            const description =
              typeof input?.description === "string" ? input.description : "";
            const updatedContent = subject || description;
            if (updatedContent) {
              state.todos[index].content = updatedContent;
            }
          }
        } else {
          // Regular tool: track as running
          state.runningTools.set(block.id, toolEntry);
        }
      }

      // Tool result: match to running tool, mark completed
      if (block.type === "tool_result" && block.tool_use_id) {
        const tool = state.runningTools.get(block.tool_use_id);
        if (tool) {
          tool.status = block.is_error ? "error" : "completed";
          tool.endTime = now;
          tool.durationMs = now - tool.startTime;

          state.runningTools.delete(block.tool_use_id);
          state.completedTools.push(tool);

          // Cap completed tools to avoid unbounded growth
          if (state.completedTools.length > MAX_COMPLETED_TOOLS * 2) {
            state.completedTools = state.completedTools.slice(
              -MAX_COMPLETED_TOOLS
            );
          }
        }
      }
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract a human-readable target from a tool's input.
 * Shows what the tool is operating on (file, pattern, command).
 */
function extractTarget(
  toolName: string,
  input?: Record<string, unknown>
): string | undefined {
  if (!input) return undefined;

  switch (toolName) {
    case "Read":
    case "Write":
    case "Edit": {
      const filePath =
        (input.file_path as string) ?? (input.path as string);
      return filePath ? basename(filePath) : undefined;
    }
    case "Glob":
      return input.pattern as string;
    case "Grep":
      return input.pattern as string;
    case "Bash": {
      const cmd = input.command as string;
      if (!cmd) return undefined;
      return cmd.length > 40 ? cmd.slice(0, 37) + "..." : cmd;
    }
    case "Task":
      return (input.description as string) ?? undefined;
    case "WebFetch":
      return (input.url as string) ?? undefined;
    case "WebSearch":
      return (input.query as string) ?? undefined;
    default:
      return undefined;
  }
}

/**
 * Resolve a TaskUpdate's taskId to an index in the todos array.
 */
function resolveTaskIndex(
  taskId: unknown,
  taskIdToIndex: Map<string, number>,
  todos: TodoItem[]
): number | null {
  if (typeof taskId === "string" || typeof taskId === "number") {
    const key = String(taskId);
    const mapped = taskIdToIndex.get(key);
    if (typeof mapped === "number" && mapped < todos.length) {
      return mapped;
    }

    // Numeric IDs might be 1-based indices
    if (/^\d+$/.test(key)) {
      const numericIndex = Number.parseInt(key, 10) - 1;
      if (numericIndex >= 0 && numericIndex < todos.length) {
        return numericIndex;
      }
    }
  }

  return null;
}

/**
 * Normalize various task status strings to our three-state enum.
 */
function normalizeTodoStatus(
  status: unknown
): TodoItem["status"] | null {
  if (typeof status !== "string") return null;
  switch (status) {
    case "pending":
    case "not_started":
    case "open":
      return "pending";
    case "in_progress":
    case "running":
      return "in_progress";
    case "completed":
    case "complete":
    case "done":
      return "completed";
    default:
      return null;
  }
}
