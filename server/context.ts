/**
 * Context generation for orchestrator agents.
 *
 * When an orchestrator spawns, we generate a JSON file describing the grid state.
 * The path is passed via HGNUCOMB_CONTEXT env var.
 */

import { writeFileSync, unlinkSync, existsSync } from "node:fs";

// ============================================================================
// Orchestration system prompt - injected via --append-system-prompt
// ============================================================================

/**
 * System prompt appended to orchestrators to establish coordination patterns.
 *
 * CRITICAL DISAMBIGUATION:
 * - mcp__hgnucomb__spawn_agent = NEW Claude process, isolated worktree, parallel
 * - Claude's Task tool = subagent in YOUR process, shared context, sequential
 *
 * Orchestrators MUST use hgnucomb MCP tools for worker coordination.
 */
export const ORCHESTRATOR_SYSTEM_PROMPT = `
<hgnucomb_role>
You are an hgnucomb orchestrator. You coordinate work by spawning workers, merging their changes through staging, and getting human approval before merging to main.
The User has full TTY access and can interact with you while workers run.
</hgnucomb_role>

<mcp_tools>
Coordination:
- mcp__hgnucomb__spawn_agent(task): Create worker in isolated worktree. Returns agentId immediately.
- mcp__hgnucomb__check_workers(): Non-blocking batch status of ALL your workers. Returns immediately.
- mcp__hgnucomb__get_messages(fromAgent): Get result messages from your inbox. Use after worker is done.
- mcp__hgnucomb__get_worker_status(workerId): Check one worker's status without blocking.
- mcp__hgnucomb__await_worker(workerId): BLOCKS until worker completes. Use only for single-worker workflows.
- mcp__hgnucomb__kill_worker(workerId): Forcibly terminate a stuck worker.

Review:
- mcp__hgnucomb__get_worker_diff(workerId): Full diff of worker's changes vs main.
- mcp__hgnucomb__list_worker_files(workerId): Files changed by worker (git diff --stat).
- mcp__hgnucomb__list_worker_commits(workerId): Commits made by worker (git log).

Merge:
- mcp__hgnucomb__check_merge_conflicts(workerId): Dry-run merge to detect conflicts BEFORE merging.
- mcp__hgnucomb__merge_worker_to_staging(workerId): Merge worker branch into your staging worktree.
- mcp__hgnucomb__merge_staging_to_main(): Merge staging to main (REQUIRES human approval first).
- mcp__hgnucomb__cleanup_worker_worktree(workerId): Delete worker's worktree and branch.

Status:
- mcp__hgnucomb__report_status(state): Update your UI badge (working/done/error).
- mcp__hgnucomb__get_identity(): Get your agentId, cell type, coordinates.
</mcp_tools>

<workflow>
PHASE 1 - SPAWN: Create workers for parallel tasks
  mcp__hgnucomb__spawn_agent(task="...") -> agentId1
  mcp__hgnucomb__spawn_agent(task="...") -> agentId2
  Tell the user: "Spawned N workers. I'll check on them when you ask, or you can
  tell me to do other things while they work."

PHASE 2 - MONITOR: Stay interactive while workers run
  When user asks to check progress (or you want to check):
    mcp__hgnucomb__check_workers() -> batch status of all workers
  If all done, proceed to Phase 3.
  If some still working, report progress and continue chatting with the user.
  For any done workers, collect their results:
    mcp__hgnucomb__get_messages(fromAgent=workerId) -> result payload

PHASE 3 - REVIEW: Examine each worker's changes
  For each completed worker:
    mcp__hgnucomb__list_worker_files(workerId) -> see what changed
    mcp__hgnucomb__list_worker_commits(workerId) -> see commit history
    mcp__hgnucomb__get_worker_diff(workerId) -> full diff if needed

PHASE 4 - MERGE TO STAGING: Integrate changes into your worktree
  For each worker whose changes look good:
    mcp__hgnucomb__check_merge_conflicts(workerId) -> detect issues before merge
    mcp__hgnucomb__merge_worker_to_staging(workerId) -> merge into your worktree
  If conflicts occur:
    - Read the conflicted files in your worktree
    - Resolve manually: edit files, git add, git commit
    - Or abort: git merge --abort
    - Or discard worker: mcp__hgnucomb__cleanup_worker_worktree(workerId)

PHASE 5 - HUMAN APPROVAL: Get explicit approval before merging
  Output a clear summary of all changes in staging.
  Call AskUserQuestion to ask: "Merge these N commits to main?" with commit list.
  You MUST call AskUserQuestion BEFORE merge_staging_to_main - the merge will be
  blocked by a PreToolUse hook if you skip this step.

PHASE 6 - MERGE TO MAIN: After human approval
  mcp__hgnucomb__merge_staging_to_main() -> promotes staging to main
  mcp__hgnucomb__cleanup_worker_worktree(workerId) -> for each worker
  mcp__hgnucomb__report_status(state="done")
</workflow>

<rules>
- NEVER call mcp__hgnucomb__merge_staging_to_main() without explicit human approval.
- ALWAYS call mcp__hgnucomb__cleanup_worker_worktree() after merge or rejection.
- Call mcp__hgnucomb__report_status("done") only after ALL workers handled and staging merged.
- Prefer check_workers() over await_worker() to stay responsive to the user.
- Use await_worker() only when you have exactly one worker and nothing else to do.
</rules>
`.trim();

/**
 * System prompt appended to workers to establish execution patterns.
 *
 * Workers execute tasks and report results to parent orchestrator.
 * They MUST run tests/lint for verification, never ask for manual QA.
 */
export const WORKER_SYSTEM_PROMPT = `
<hgnucomb_role>
You are an hgnucomb worker. Execute your assigned task autonomously.
The User has fully TTY access to communicate with you when collaboration is needed.
</hgnucomb_role>

<environment>
- HGNUCOMB_PARENT_ID: Your parent orchestrator's agent ID. Use this for mcp__hgnucomb__report_result.
</environment>

<mcp_tools>
- mcp__hgnucomb__report_result: Send result to parent orchestrator's inbox.
- mcp__hgnucomb__report_status: Update your UI badge (working/done/error).
</mcp_tools>

<execution_protocol>
1. Execute the task. Make reasonable assumptions.
2. Verify by running tests and linters.
3. Call mcp__hgnucomb__report_result(parentId=HGNUCOMB_PARENT_ID, result="...", success=true).
4. Call mcp__hgnucomb__report_status(state="done").
</execution_protocol>

<rules>
- Run actual tests for verification.
- Create tests if none exist.
</rules>
`.trim();
import type { AgentSnapshot, HexCoordinate } from "../shared/types.ts";
import { hexDistance } from "../shared/types.ts";
import type {
  ContextAgent,
  ContextConnection,
  ContextTask,
  ContextParent,
  HgnucombContext,
} from "../shared/context.ts";

// ============================================================================
// Context generation
// ============================================================================

const DEFAULT_MAX_DISTANCE = 3;

/**
 * Task assignment options for worker agents.
 */
export interface TaskAssignmentOptions {
  task: string;
  taskDetails?: string;
  assignedBy: string;
  parentHex?: HexCoordinate;
}

/**
 * Generate context JSON for an orchestrator or worker agent.
 *
 * @param self - The spawning agent's snapshot
 * @param allAgents - All agents on the grid
 * @param maxDistance - Maximum hex distance for nearby agents (default 3)
 * @param taskAssignment - Optional task assignment for worker agents
 * @returns Context JSON object
 */
export function generateContext(
  self: AgentSnapshot,
  allAgents: AgentSnapshot[],
  maxDistance: number = DEFAULT_MAX_DISTANCE,
  taskAssignment?: TaskAssignmentOptions
): HgnucombContext {
  // Filter and transform nearby agents (excluding self)
  const nearbyAgents: ContextAgent[] = allAgents
    .filter((a) => a.agentId !== self.agentId)
    .map((a) => ({
      agentId: a.agentId,
      cellType: a.cellType,
      hex: a.hex,
      status: a.status,
      distance: hexDistance(self.hex, a.hex),
      // Mark parent if this agent is in our connections list
      ...(self.connections.includes(a.agentId) ? { isParent: true } : {}),
    }))
    .filter((a) => a.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance);

  // Build connections from nearby agents
  const connections: ContextConnection[] = [];
  for (const agent of nearbyAgents) {
    if (agent.isParent) {
      connections.push({
        from: agent.agentId,
        to: self.agentId,
        type: "parent-child",
      });
    }
  }

  // Build task info if assigned
  const task: ContextTask | null = taskAssignment
    ? {
        taskId: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        description: taskAssignment.task,
        details: taskAssignment.taskDetails,
        assignedBy: taskAssignment.assignedBy,
      }
    : null;

  // Build parent info if this is a worker with a task
  const parent: ContextParent | null = taskAssignment
    ? {
        agentId: taskAssignment.assignedBy,
        hex: taskAssignment.parentHex,
      }
    : null;

  return {
    jsonrpc: "2.0",
    context: {
      self: {
        agentId: self.agentId,
        cellType: self.cellType,
        hex: self.hex,
        status: self.status,
      },
      grid: {
        agents: nearbyAgents,
        connections,
      },
      task,
      parent,
      capabilities: {
        canSpawn: self.cellType === "orchestrator",
        canMessage: true,
        maxChildren: 5,
      },
    },
  };
}

/**
 * Write context JSON to a temp file.
 *
 * @param agentId - Agent ID for filename
 * @param context - Context object to write
 * @returns Path to the written file
 */
export function writeContextFile(
  agentId: string,
  context: HgnucombContext
): string {
  const path = `/tmp/hgnucomb-context-${agentId}.json`;
  writeFileSync(path, JSON.stringify(context, null, 2));
  console.log(`[Context] Wrote ${path}`);
  return path;
}

/**
 * Delete context file when agent terminates.
 *
 * @param agentId - Agent ID for filename
 */
export function cleanupContextFile(agentId: string): void {
  const path = `/tmp/hgnucomb-context-${agentId}.json`;
  if (existsSync(path)) {
    unlinkSync(path);
    console.log(`[Context] Cleaned up ${path}`);
  }
}

