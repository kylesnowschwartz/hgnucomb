/**
 * Agent workspace isolation.
 *
 * Two strategies depending on whether the target directory is a git repo:
 *
 * 1. **Git worktree** (preferred): Each agent gets a worktree at
 *    {gitRoot}/.worktrees/{agentId}/ with its own branch. Full git isolation --
 *    agents can commit, diff, and merge without conflicts.
 *
 * 2. **Direct directory** (non-git fallback): All agent types work directly in
 *    the target directory. Without git there's no worktree isolation to offer,
 *    and a temp dir would be useless (empty, no project files). MCP communication
 *    still works; git-dependent tools (diff, merge) fail gracefully at call time.
 *
 * Both paths produce a WorktreeResult with a workspace directory. The caller
 * doesn't need to know which strategy was used.
 */

import { execFileSync } from "child_process";
import { existsSync, mkdirSync, rmSync, symlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { generateMcpConfig, writeMcpConfigToTemp } from "./mcp-config.js";
import type { CellType } from "../shared/types.ts";

/**
 * Execute git command and return stdout as string.
 * Returns null on any error (missing git, not a repo, etc).
 */
function gitExec(args: string[], cwd: string): string | null {
  try {
    const result = execFileSync("git", args, {
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
  /** Path to MCP config file in $TMPDIR (for --mcp-config CLI flag) */
  mcpConfigPath?: string;
  error?: string;
}

/**
 * Create an isolated workspace for an agent.
 *
 * In a git repo: creates a worktree at {gitRoot}/.worktrees/{agentId}/
 * Outside a git repo: uses targetDir directly (no isolation, no temp dirs)
 *
 * All paths write MCP config to $TMPDIR, passed to Claude CLI via --mcp-config.
 *
 * @param targetDir - Directory to create workspace in (usually project root)
 * @param agentId - Unique agent identifier
 * @param cellType - Agent type (orchestrator has full tools, worker has limited)
 * @param wsUrl - WebSocket URL for MCP server to connect back to
 * @param toolDir - Where hgnucomb is installed (for MCP binary and plugin paths)
 * @returns Result with workspace path or error
 */
export function createWorktree(targetDir: string, agentId: string, cellType: CellType = "orchestrator", wsUrl: string = "ws://localhost:3001", toolDir?: string): WorktreeResult {
  const gitRoot = getGitRoot(targetDir);

  if (!gitRoot) {
    // No git repo: all agent types work directly in the target directory.
    // A temp dir would be useless (empty, no project files). Git-dependent
    // MCP tools (diff, merge) fail gracefully at call time.
    let mcpConfigPath: string | undefined;
    if (toolDir) {
      const mcpConfig = generateMcpConfig(toolDir, agentId, cellType, wsUrl);
      mcpConfigPath = writeMcpConfigToTemp(agentId, mcpConfig);
      console.log(`[Worktree] Non-git ${cellType} ${agentId}: using project dir directly, MCP config at ${mcpConfigPath}`);
    }
    return { success: true, worktreePath: targetDir, mcpConfigPath };
  }

  return createGitWorktree(gitRoot, agentId, cellType, wsUrl, toolDir);
}

/**
 * Git path: create a worktree with its own branch for the agent.
 */
function createGitWorktree(gitRoot: string, agentId: string, cellType: CellType, wsUrl: string, toolDir?: string): WorktreeResult {
  // Create .worktrees directory if needed
  const worktreesDir = join(gitRoot, ".worktrees");
  const worktreePath = join(worktreesDir, agentId);

  // Check if worktree already exists (reconnect/retry scenario).
  // Must still generate temp MCP config since $TMPDIR is ephemeral.
  if (existsSync(worktreePath)) {
    console.log(`[Worktree] Already exists: ${worktreePath}`);
    let mcpConfigPath: string | undefined;
    if (toolDir) {
      const mcpConfig = generateMcpConfig(toolDir, agentId, cellType, wsUrl);
      mcpConfigPath = writeMcpConfigToTemp(agentId, mcpConfig);
    }
    return {
      success: true,
      worktreePath,
      mcpConfigPath,
      branchName: `hgnucomb/${agentId}`,
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

  // Generate MCP config and write to temp file (passed via --mcp-config CLI flag).
  // MCP server paths always use toolDir (hgnucomb's install dir), NOT the project's gitRoot.
  const mcpConfig = generateMcpConfig(toolDir ?? gitRoot, agentId, cellType, wsUrl);
  if (!toolDir) {
    console.warn(`[Worktree] No toolDir provided for ${agentId}, falling back to gitRoot for MCP paths. This may fail if project != hgnucomb.`);
  }
  const mcpConfigPath = writeMcpConfigToTemp(agentId, mcpConfig);
  console.log(`[Worktree] MCP config for ${cellType} ${agentId} at ${mcpConfigPath}`);

  // Symlink project-specific directories from the PROJECT's gitRoot.
  // Agents inherit the project's .claude (CLAUDE.md, settings) and .beads-lite
  // (task tracking) so they operate with the right project context.
  const projectDirs = [".claude", ".beads-lite"];
  for (const dir of projectDirs) {
    const sourceDir = join(gitRoot, dir);
    if (existsSync(sourceDir)) {
      const targetDir = join(worktreePath, dir);
      try {
        symlinkSync(sourceDir, targetDir);
        console.log(`[Worktree] Symlinked ${dir}/ (from project)`);
      } catch (err) {
        console.warn(`[Worktree] Failed to symlink ${dir}/: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Symlink hgnucomb-specific reference material from the install dir (toolDir).
  // These are hgnucomb's own research docs and cloned upstream repos -- they don't
  // exist in arbitrary user projects and aren't relevant outside hgnucomb development.
  const hgnucombRoot = toolDir ?? gitRoot;
  const hgnucombDirs = [".agent-history", ".cloned-sources"];
  for (const dir of hgnucombDirs) {
    const sourceDir = join(hgnucombRoot, dir);
    if (existsSync(sourceDir)) {
      const targetDir = join(worktreePath, dir);
      try {
        symlinkSync(sourceDir, targetDir);
        console.log(`[Worktree] Symlinked ${dir}/ (from hgnucomb)`);
      } catch (err) {
        console.warn(`[Worktree] Failed to symlink ${dir}/: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Symlink project node_modules so agents can run typecheck/lint/test/build
  // without a separate install step. These come from the PROJECT's gitRoot,
  // not toolDir -- agents need the project's deps, not hgnucomb's.
  // READ-ONLY: agents must not run pnpm install/add/remove in worktrees.
  const depDirs = ["node_modules", join("server", "node_modules")];
  for (const dir of depDirs) {
    const sourceDir = join(gitRoot, dir);
    if (existsSync(sourceDir)) {
      const targetDir = join(worktreePath, dir);
      // server/ subdir may not exist yet in the worktree
      const parentDir = join(worktreePath, dir, "..");
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
      }
      try {
        symlinkSync(sourceDir, targetDir);
        console.log(`[Worktree] Symlinked ${dir}/ (from project)`);
      } catch (err) {
        console.warn(`[Worktree] Failed to symlink ${dir}/: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  console.log(`[Worktree] Created: ${worktreePath} on branch ${branchName}`);
  return { success: true, worktreePath, branchName, mcpConfigPath };
}

/**
 * Remove an agent's workspace (worktree or stale session directory).
 *
 * @param targetDir - Original target directory (to find git root)
 * @param agentId - Agent identifier
 * @returns Result with success status
 */
export function removeWorktree(targetDir: string, agentId: string): WorktreeResult {
  // Clean up stale session dirs from older versions that used temp directories
  const sessionDir = join(tmpdir(), `hgnucomb-agent-${agentId}`);
  if (existsSync(sessionDir)) {
    try {
      rmSync(sessionDir, { recursive: true, force: true });
      console.log(`[Session] Removed session dir: ${sessionDir}`);
    } catch (err) {
      console.warn(`[Session] Failed to remove session dir: ${err instanceof Error ? err.message : String(err)}`);
    }
    // Don't return early -- the agent might also have a worktree if the
    // project dir changed mid-session (unlikely but defensive)
  }

  const gitRoot = getGitRoot(targetDir);
  if (!gitRoot) {
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
