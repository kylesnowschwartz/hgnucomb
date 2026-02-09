/**
 * Tests for agent workspace isolation (worktree.ts).
 *
 * Tests the two isolation strategies:
 * 1. Session directory (non-git fallback) -- uses real temp dirs
 * 2. Git worktree -- mocked since we can't create real worktrees in CI
 * 3. Cleanup behavior for both strategies
 *
 * The session dir tests use real filesystem operations (mkdirSync, existsSync)
 * because that's what we're actually verifying. Git operations are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, existsSync, rmSync, readFileSync, lstatSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createWorktree, removeWorktree, getGitRoot } from "./worktree.js";

// Unique prefix per test run to avoid collisions with parallel tests
const TEST_PREFIX = `worktree-test-${Date.now()}`;

/** Create a real temp directory for testing. */
function makeTempDir(suffix: string): string {
  const dir = join(tmpdir(), `${TEST_PREFIX}-${suffix}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Clean up a directory, ignoring errors. */
function cleanDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Best effort
  }
}

describe("createWorktree - session directory fallback", () => {
  const agentId = `test-agent-${Date.now()}`;
  const sessionDir = join(tmpdir(), `hgnucomb-agent-${agentId}`);
  let targetDir: string;
  let fakeToolDir: string;

  beforeEach(() => {
    // Create a real non-git directory as the target
    targetDir = makeTempDir("target");
    // Create a fake toolDir with the expected server/dist structure
    fakeToolDir = makeTempDir("tooldir");
    mkdirSync(join(fakeToolDir, "server", "dist"), { recursive: true });
    // Suppress console output in tests
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanDir(sessionDir);
    cleanDir(targetDir);
    cleanDir(fakeToolDir);
    vi.restoreAllMocks();
  });

  it("creates session dir in tmpdir when target is not a git repo", () => {
    const result = createWorktree(targetDir, agentId, "orchestrator", "ws://localhost:3001", fakeToolDir);

    expect(result.success).toBe(true);
    expect(result.isSessionDir).toBe(true);
    expect(result.worktreePath).toBe(sessionDir);
    expect(existsSync(sessionDir)).toBe(true);
  });

  it("writes .mcp.json in the session directory", () => {
    createWorktree(targetDir, agentId, "orchestrator", "ws://localhost:3001", fakeToolDir);

    const mcpConfigPath = join(sessionDir, ".mcp.json");
    expect(existsSync(mcpConfigPath)).toBe(true);

    const config = JSON.parse(readFileSync(mcpConfigPath, "utf8"));
    expect(config.mcpServers.hgnucomb).toBeDefined();
    expect(config.mcpServers.hgnucomb.command).toBe("node");
    expect(config.mcpServers.hgnucomb.args[0]).toContain("server/dist/mcp.js");
  });

  it("MCP config uses toolDir for mcp.js path, not targetDir", () => {
    createWorktree(targetDir, agentId, "orchestrator", "ws://localhost:3001", fakeToolDir);

    const config = JSON.parse(readFileSync(join(sessionDir, ".mcp.json"), "utf8"));
    const mcpPath = config.mcpServers.hgnucomb.args[0];

    // Must point to toolDir (hgnucomb install), not targetDir (user project)
    expect(mcpPath).toContain(fakeToolDir);
    expect(mcpPath).not.toContain(targetDir);
  });

  it("sets agent env vars in MCP config", () => {
    createWorktree(targetDir, agentId, "worker", "ws://localhost:9999", fakeToolDir);

    const config = JSON.parse(readFileSync(join(sessionDir, ".mcp.json"), "utf8"));
    const env = config.mcpServers.hgnucomb.env;

    expect(env.HGNUCOMB_AGENT_ID).toBe(agentId);
    expect(env.HGNUCOMB_CELL_TYPE).toBe("worker");
    expect(env.HGNUCOMB_WS_URL).toBe("ws://localhost:9999");
  });

  it("symlinks .claude from targetDir if it exists", () => {
    // Create a .claude dir in the target
    const claudeDir = join(targetDir, ".claude");
    mkdirSync(claudeDir);

    createWorktree(targetDir, agentId, "orchestrator", "ws://localhost:3001", fakeToolDir);

    const symlinkPath = join(sessionDir, ".claude");
    expect(existsSync(symlinkPath)).toBe(true);
    expect(lstatSync(symlinkPath).isSymbolicLink()).toBe(true);
  });

  it("symlinks .beads-lite from targetDir if it exists", () => {
    const beadsDir = join(targetDir, ".beads-lite");
    mkdirSync(beadsDir);

    createWorktree(targetDir, agentId, "orchestrator", "ws://localhost:3001", fakeToolDir);

    const symlinkPath = join(sessionDir, ".beads-lite");
    expect(existsSync(symlinkPath)).toBe(true);
    expect(lstatSync(symlinkPath).isSymbolicLink()).toBe(true);
  });

  it("skips symlinks when project dirs do not exist", () => {
    // targetDir has no .claude or .beads-lite
    createWorktree(targetDir, agentId, "orchestrator", "ws://localhost:3001", fakeToolDir);

    expect(existsSync(join(sessionDir, ".claude"))).toBe(false);
    expect(existsSync(join(sessionDir, ".beads-lite"))).toBe(false);
  });

  it("returns no branchName for session dirs", () => {
    const result = createWorktree(targetDir, agentId, "orchestrator", "ws://localhost:3001", fakeToolDir);

    expect(result.branchName).toBeUndefined();
  });
});

describe("createWorktree - git repo detection", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getGitRoot returns null for non-git directory", () => {
    const dir = makeTempDir("not-git");
    try {
      expect(getGitRoot(dir)).toBeNull();
    } finally {
      cleanDir(dir);
    }
  });

  it("getGitRoot returns path for actual git repo", () => {
    // Use the hgnucomb repo itself as test subject
    const root = getGitRoot(process.cwd());
    expect(root).not.toBeNull();
    expect(typeof root).toBe("string");
  });
});

describe("removeWorktree - session directory cleanup", () => {
  const agentId = `cleanup-agent-${Date.now()}`;
  const sessionDir = join(tmpdir(), `hgnucomb-agent-${agentId}`);

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanDir(sessionDir);
    vi.restoreAllMocks();
  });

  it("removes session directory when it exists", () => {
    // Create the session dir manually (simulating createWorktree)
    mkdirSync(sessionDir, { recursive: true });
    expect(existsSync(sessionDir)).toBe(true);

    const result = removeWorktree("/nonexistent", agentId);

    expect(result.success).toBe(true);
    expect(existsSync(sessionDir)).toBe(false);
  });

  it("succeeds when session directory does not exist", () => {
    expect(existsSync(sessionDir)).toBe(false);

    const result = removeWorktree("/nonexistent", agentId);

    expect(result.success).toBe(true);
  });

  it("succeeds when targetDir is not a git repo and no session dir", () => {
    const dir = makeTempDir("no-git-no-session");
    try {
      const result = removeWorktree(dir, "nonexistent-agent");
      expect(result.success).toBe(true);
    } finally {
      cleanDir(dir);
    }
  });
});

describe("createWorktree + removeWorktree round-trip", () => {
  const agentId = `roundtrip-agent-${Date.now()}`;
  const sessionDir = join(tmpdir(), `hgnucomb-agent-${agentId}`);
  let targetDir: string;
  let fakeToolDir: string;

  beforeEach(() => {
    targetDir = makeTempDir("roundtrip-target");
    fakeToolDir = makeTempDir("roundtrip-tooldir");
    mkdirSync(join(fakeToolDir, "server", "dist"), { recursive: true });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanDir(sessionDir);
    cleanDir(targetDir);
    cleanDir(fakeToolDir);
    vi.restoreAllMocks();
  });

  it("create then remove leaves no artifacts", () => {
    // Create
    const createResult = createWorktree(targetDir, agentId, "worker", "ws://localhost:3001", fakeToolDir);
    expect(createResult.success).toBe(true);
    expect(existsSync(sessionDir)).toBe(true);
    expect(existsSync(join(sessionDir, ".mcp.json"))).toBe(true);

    // Remove
    const removeResult = removeWorktree(targetDir, agentId);
    expect(removeResult.success).toBe(true);
    expect(existsSync(sessionDir)).toBe(false);
  });
});
