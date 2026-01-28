/**
 * Git worktree management for orchestrator agents.
 *
 * Each orchestrator gets its own worktree in {repo}/.worktrees/{agentId}/
 * This provides branch isolation so agents don't step on each other's changes.
 *
 * Graceful degradation: non-git repos skip worktree, use normal CWD.
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { generateMcpConfig, writeMcpConfig } from "./mcp-config.js";
import type { CellType } from "./protocol.js";

/**
 * Execute git command and return stdout as string.
 * Returns null on any error (missing git, not a repo, etc).
 */
function gitExec(args: string[], cwd: string): string | null {
  try {
    const result = execSync(`git ${args.join(" ")}`, {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.trim();
  } catch {
    return null;
  }
}

/**
 * Check if a directory is inside a git repository.
 */
export function isGitRepo(dir: string): boolean {
  return gitExec(["rev-parse", "--git-dir"], dir) !== null;
}

/**
 * Get the root directory of the git repository.
 */
export function getGitRoot(dir: string): string | null {
  return gitExec(["rev-parse", "--show-toplevel"], dir);
}

/**
 * Check if a branch exists locally.
 */
function branchExists(branchName: string, cwd: string): boolean {
  const result = gitExec(["rev-parse", "--verify", "--quiet", branchName], cwd);
  return result !== null;
}

/**
 * Generate a unique branch name, adding suffix if collision.
 */
function generateBranchName(agentId: string, cwd: string): string {
  const baseName = `hgnucomb/${agentId}`;
  if (!branchExists(baseName, cwd)) {
    return baseName;
  }
  // Collision - add incrementing suffix
  for (let i = 2; i <= 10; i++) {
    const name = `${baseName}-${i}`;
    if (!branchExists(name, cwd)) {
      return name;
    }
  }
  // Give up and use timestamp
  return `${baseName}-${Date.now()}`;
}

export interface WorktreeResult {
  success: boolean;
  worktreePath?: string;
  branchName?: string;
  error?: string;
}

/**
 * Create a git worktree for an orchestrator or worker agent.
 *
 * Location: {gitRoot}/.worktrees/{agentId}/
 * Branch: hgnucomb/{agentId}
 *
 * @param targetDir - Directory to create worktree for (usually project root)
 * @param agentId - Unique agent identifier
 * @param cellType - Agent type (orchestrator has full tools, worker has limited)
 * @returns Result with worktree path or error
 */
export function createWorktree(targetDir: string, agentId: string, cellType: CellType = "orchestrator"): WorktreeResult {
  // Check if git repo
  const gitRoot = getGitRoot(targetDir);
  if (!gitRoot) {
    console.log(`[Worktree] Not a git repo: ${targetDir}, skipping worktree`);
    return { success: true, worktreePath: targetDir }; // Graceful degradation
  }

  // Create .worktrees directory if needed
  const worktreesDir = join(gitRoot, ".worktrees");
  const worktreePath = join(worktreesDir, agentId);

  // Check if worktree already exists
  if (existsSync(worktreePath)) {
    console.log(`[Worktree] Already exists: ${worktreePath}`);
    return {
      success: true,
      worktreePath,
      branchName: `hgnucomb/${agentId}`, // Assume branch name matches
    };
  }

  try {
    mkdirSync(worktreesDir, { recursive: true });
  } catch (err) {
    return {
      success: false,
      error: `Failed to create worktrees directory: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Generate branch name (handles collisions)
  const branchName = generateBranchName(agentId, gitRoot);

  // Create worktree with new branch from HEAD
  const result = gitExec(
    ["worktree", "add", worktreePath, "-b", branchName],
    gitRoot
  );

  if (result === null) {
    // Try without -b if branch somehow exists
    const fallbackResult = gitExec(
      ["worktree", "add", worktreePath, branchName],
      gitRoot
    );
    if (fallbackResult === null) {
      return {
        success: false,
        error: `Failed to create worktree for ${agentId}`,
      };
    }
  }

  // Generate .mcp.json with absolute paths for this worktree
  // Claude Code searches from CWD upward - worktree is its own git root,
  // so we must provide the config directly rather than relying on parent repo
  const mcpConfig = generateMcpConfig(gitRoot, agentId, cellType);
  writeMcpConfig(worktreePath, mcpConfig);
  console.log(`[Worktree] Generated .mcp.json with absolute paths for ${cellType}`);

  console.log(`[Worktree] Created: ${worktreePath} on branch ${branchName}`);
  return { success: true, worktreePath, branchName };
}

/**
 * Remove a git worktree and its branch.
 *
 * @param targetDir - Original target directory (to find git root)
 * @param agentId - Agent identifier
 * @returns Result with success status
 */
export function removeWorktree(targetDir: string, agentId: string): WorktreeResult {
  const gitRoot = getGitRoot(targetDir);
  if (!gitRoot) {
    // Not a git repo - nothing to clean up
    return { success: true };
  }

  const worktreePath = join(gitRoot, ".worktrees", agentId);

  // Check if worktree exists
  if (!existsSync(worktreePath)) {
    console.log(`[Worktree] Already removed: ${worktreePath}`);
    return { success: true };
  }

  // Remove worktree (--force to handle uncommitted changes)
  const removeResult = gitExec(
    ["worktree", "remove", "--force", worktreePath],
    gitRoot
  );

  if (removeResult === null) {
    // Try manual removal if git command fails
    console.warn(`[Worktree] git worktree remove failed, trying manual cleanup`);
    try {
      rmSync(worktreePath, { recursive: true, force: true });
    } catch (err) {
      console.error(`[Worktree] Manual cleanup failed:`, err);
    }
  }

  // Delete the branch
  const branchName = `hgnucomb/${agentId}`;
  const branchResult = gitExec(["branch", "-D", branchName], gitRoot);
  if (branchResult === null) {
    // Branch might have a different name or already deleted
    console.warn(`[Worktree] Failed to delete branch ${branchName}, may not exist`);
  }

  // Prune worktree references
  gitExec(["worktree", "prune"], gitRoot);

  console.log(`[Worktree] Removed: ${worktreePath}`);
  return { success: true };
}

/**
 * List all hgnucomb worktrees in a git repository.
 */
export function listWorktrees(targetDir: string): string[] {
  const gitRoot = getGitRoot(targetDir);
  if (!gitRoot) return [];

  const worktreesDir = join(gitRoot, ".worktrees");
  if (!existsSync(worktreesDir)) return [];

  const result = gitExec(["worktree", "list", "--porcelain"], gitRoot);
  if (!result) return [];

  // Parse porcelain output - look for worktrees in our .worktrees dir
  const worktrees: string[] = [];
  const lines = result.split("\n");
  for (const line of lines) {
    if (line.startsWith("worktree ") && line.includes(".worktrees/")) {
      const path = line.replace("worktree ", "");
      worktrees.push(path);
    }
  }

  return worktrees;
}
