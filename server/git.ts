/**
 * Git helper functions for worktree and merge operations.
 * Extracted for testability.
 */

import { execFileSync } from "child_process";
import { join } from "path";

// ============================================================================
// Types
// ============================================================================

export type GitResult = { ok: true; output: string } | { ok: false; error: string };

export interface DiffStats {
  files: number;
  insertions: number;
  deletions: number;
}

export interface WorkerDiff {
  diff: string;
  stats: DiffStats;
}

// ============================================================================
// Low-level Git Execution
// ============================================================================

/**
 * Execute git command and return result with error information.
 * Uses execFileSync to properly handle arguments with spaces.
 */
export function gitExecWithError(args: string[], cwd: string): GitResult {
  try {
    const result = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { ok: true, output: result.trim() };
  } catch (err: unknown) {
    const stderr = (err as { stderr?: Buffer | string })?.stderr?.toString().trim() ?? "";
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Git] Command failed: git ${args.join(" ")} in ${cwd}`);
    console.warn(`[Git] Error: ${msg}`);
    if (stderr) console.warn(`[Git] Stderr: ${stderr}`);
    return { ok: false, error: stderr || msg };
  }
}

/**
 * Execute git command safely, returning null on error.
 * Convenience wrapper for simple cases.
 */
export function gitExec(args: string[], cwd: string): string | null {
  const result = gitExecWithError(args, cwd);
  return result.ok ? result.output : null;
}

/**
 * Get the root directory of the git repository.
 */
export function getGitRoot(dir: string): string | null {
  return gitExec(["rev-parse", "--show-toplevel"], dir);
}

// ============================================================================
// Path Constants
// ============================================================================

/** Directory name for agent worktrees */
export const WORKTREES_DIR = ".worktrees";

/** Branch prefix for agent branches */
export const BRANCH_PREFIX = "hgnucomb";

/**
 * Get the worktree path for an agent.
 */
export function getWorktreePath(gitRoot: string, agentId: string): string {
  return join(gitRoot, WORKTREES_DIR, agentId);
}

/**
 * Get the branch name for an agent.
 */
export function getBranchName(agentId: string): string {
  return `${BRANCH_PREFIX}/${agentId}`;
}

// ============================================================================
// Worker Inspection Functions
// ============================================================================

/**
 * Get diff between main and a worker branch.
 * Returns { diff, stats } or null on error.
 */
export function getWorkerDiff(gitRoot: string, workerId: string): WorkerDiff | null {
  const branchName = getBranchName(workerId);

  // Get the diff
  const diff = gitExec(["diff", `main...${branchName}`, "--"], gitRoot);
  if (diff === null) {
    console.warn(`[Git] Failed to get diff for ${branchName}`);
    return null;
  }

  // Get stats: number of files changed, insertions, deletions
  const statsOutput = gitExec(["diff", `main...${branchName}`, "--stat"], gitRoot);
  if (statsOutput === null) {
    console.warn(`[Git] Failed to get diff stats for ${branchName}`);
    return { diff, stats: { files: 0, insertions: 0, deletions: 0 } };
  }

  // Parse stats from output like: "file1.ts | 5 ++", "file2.ts | 3 --"
  // Last line is usually a summary like: "2 files changed, 8 insertions(+), 0 deletions(-)"
  const lines = statsOutput.split("\n");
  const summary = lines[lines.length - 2] || "";
  const statsRegex = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/;
  const match = summary.match(statsRegex);

  const files = match ? parseInt(match[1]) || 0 : 0;
  const insertions = match ? parseInt(match[2]) || 0 : 0;
  const deletions = match ? parseInt(match[3]) || 0 : 0;

  return {
    diff,
    stats: { files, insertions, deletions },
  };
}

/**
 * Get list of files changed by a worker since branching from main.
 * Returns raw git diff --stat output for orchestrator to interpret.
 */
export function listWorkerFiles(gitRoot: string, workerId: string): string | null {
  const branchName = getBranchName(workerId);
  const output = gitExec(["diff", `main...${branchName}`, "--stat"], gitRoot);
  if (output === null) {
    console.warn(`[Git] Failed to get diff stat for worker ${workerId}`);
    return null;
  }
  return output;
}

/**
 * Get list of commits made by a worker since branching from main.
 * Returns raw git log output for orchestrator to interpret.
 */
export function listWorkerCommits(gitRoot: string, workerId: string): string | null {
  const branchName = getBranchName(workerId);
  const output = gitExec(["log", `main..${branchName}`, "--oneline", "--stat"], gitRoot);
  if (output === null) {
    console.warn(`[Git] Failed to get log for worker ${workerId}`);
    return null;
  }
  return output;
}

// ============================================================================
// Merge Functions
// ============================================================================

export interface MergeConflictResult {
  canMerge: boolean;
  output: string;
}

/**
 * Check if merging a worker branch into orchestrator's staging would cause conflicts.
 * Does a dry-run merge and aborts, returning raw git output.
 */
export function checkMergeConflicts(gitRoot: string, orchestratorId: string, workerId: string): MergeConflictResult | null {
  const workerBranch = getBranchName(workerId);
  const stagingPath = getWorktreePath(gitRoot, orchestratorId);

  // Verify staging worktree exists
  const currentBranch = gitExec(["rev-parse", "--abbrev-ref", "HEAD"], stagingPath);
  if (currentBranch === null) {
    return {
      canMerge: false,
      output: `Staging worktree not found at ${stagingPath}`,
    };
  }

  // Check if staging worktree has uncommitted changes
  const status = gitExec(["status", "--porcelain"], stagingPath);
  if (status === null) {
    return null;
  }
  if (status.trim()) {
    return {
      canMerge: false,
      output: `Cannot check merge: staging has uncommitted changes:\n${status}`,
    };
  }

  // Try dry-run merge (--no-commit keeps changes staged but not committed)
  const mergeResult = gitExec(["merge", "--no-commit", "--no-ff", workerBranch], stagingPath);

  // Capture status regardless of merge result
  const mergeStatus = gitExec(["status"], stagingPath) ?? "";

  // Clean up: abort if conflicts, reset if clean merge left staged changes
  gitExec(["merge", "--abort"], stagingPath);
  gitExec(["reset", "--hard", "HEAD"], stagingPath);

  if (mergeResult === null) {
    // Merge failed - likely has conflicts
    return {
      canMerge: false,
      output: `Merge would have conflicts:\n${mergeStatus}`,
    };
  }

  // Merge succeeded (no conflicts)
  return {
    canMerge: true,
    output: `Merge would succeed cleanly:\n${mergeStatus}`,
  };
}

/**
 * Merge worker branch into orchestrator's staging worktree.
 * Regular merge (preserves worker commit history).
 */
export function mergeWorkerToStaging(gitRoot: string, orchestratorId: string, workerId: string): string | null {
  const workerBranch = getBranchName(workerId);
  const stagingPath = getWorktreePath(gitRoot, orchestratorId);

  // Verify staging worktree exists
  const currentBranch = gitExec(["rev-parse", "--abbrev-ref", "HEAD"], stagingPath);
  if (currentBranch === null) {
    console.warn(`[Git] Staging worktree not found at ${stagingPath}`);
    return null;
  }

  // Regular merge (preserves history)
  const mergeResult = gitExecWithError(["merge", workerBranch, "-m", `Merge worker ${workerId}`], stagingPath);
  if (!mergeResult.ok) {
    const status = gitExec(["status"], stagingPath) ?? "";
    console.warn(`[Git] Merge failed: ${workerBranch} into staging`);
    return `Merge failed (${mergeResult.error}):\n${status}`;
  }

  const log = gitExec(["log", "--oneline", "-5"], stagingPath) ?? "";
  console.log(`[Git] Merged ${workerBranch} into staging (${orchestratorId})`);
  return `Merge successful:\n${log}`;
}

/**
 * Merge orchestrator's staging branch into main.
 * Regular merge (preserves history from staging).
 */
export function mergeStagingToMain(gitRoot: string, orchestratorId: string): string | null {
  const stagingBranch = getBranchName(orchestratorId);

  // Ensure we're on main branch
  const currentBranch = gitExec(["rev-parse", "--abbrev-ref", "HEAD"], gitRoot);
  if (currentBranch !== "main") {
    console.warn(`[Git] Not on main branch, switching...`);
    const switchResult = gitExec(["checkout", "main"], gitRoot);
    if (switchResult === null) {
      return "Failed to switch to main branch";
    }
  }

  // Check for uncommitted changes in main
  const status = gitExec(["status", "--porcelain"], gitRoot);
  if (status && status.trim()) {
    return `Cannot merge: main has uncommitted changes:\n${status}`;
  }

  // Regular merge (preserves staging history)
  const mergeResult = gitExecWithError(["merge", stagingBranch, "-m", `Merge staging from ${orchestratorId}`], gitRoot);
  if (!mergeResult.ok) {
    const mergeStatus = gitExec(["status"], gitRoot) ?? "";
    console.warn(`[Git] Merge failed: ${stagingBranch} into main`);
    return `Merge failed (${mergeResult.error}):\n${mergeStatus}`;
  }

  const log = gitExec(["log", "--oneline", "-5"], gitRoot) ?? "";
  console.log(`[Git] Merged staging (${orchestratorId}) into main`);
  return `Merge successful:\n${log}`;
}
