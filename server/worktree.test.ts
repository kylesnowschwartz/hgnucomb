/**
 * Tests for agent workspace isolation (worktree.ts).
 *
 * Tests:
 * 1. Non-git fallback -- all agent types use project dir directly
 * 2. Git worktree -- mocked since we can't create real worktrees in CI
 * 3. Cleanup behavior
 *
 * MCP config is written to $TMPDIR (not .mcp.json in workspace).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, existsSync, rmSync, readFileSync } from "fs";
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

/** Get the expected temp MCP config path for an agent. */
function mcpConfigTempPath(agentId: string): string {
  return join(tmpdir(), `hgnucomb-mcp-${agentId}.json`);
}

describe("createWorktree - non-git fallback (all agent types use project dir)", () => {
  let targetDir: string;
  let fakeToolDir: string;

  beforeEach(() => {
    targetDir = makeTempDir("target");
    fakeToolDir = makeTempDir("tooldir");
    mkdirSync(join(fakeToolDir, "server", "dist"), { recursive: true });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanDir(targetDir);
    cleanDir(fakeToolDir);
    vi.restoreAllMocks();
  });

  it.each(["worker", "orchestrator"] as const)(
    "uses project directory directly for non-git %s",
    (cellType) => {
      const agentId = `test-${cellType}-${Date.now()}`;
      try {
        const result = createWorktree(targetDir, agentId, cellType, "ws://localhost:3001", fakeToolDir);

        expect(result.success).toBe(true);
        expect(result.worktreePath).toBe(targetDir);
        expect(result.branchName).toBeUndefined();
      } finally {
        rmSync(mcpConfigTempPath(agentId), { force: true });
      }
    }
  );

  it.each(["worker", "orchestrator"] as const)(
    "does not create a temp session dir for non-git %s",
    (cellType) => {
      const agentId = `test-no-session-${cellType}-${Date.now()}`;
      try {
        createWorktree(targetDir, agentId, cellType, "ws://localhost:3001", fakeToolDir);

        const sessionDir = join(tmpdir(), `hgnucomb-agent-${agentId}`);
        expect(existsSync(sessionDir)).toBe(false);
      } finally {
        rmSync(mcpConfigTempPath(agentId), { force: true });
      }
    }
  );

  it("writes MCP config to temp file for non-git worker", () => {
    const agentId = `test-mcp-worker-${Date.now()}`;
    try {
      const result = createWorktree(targetDir, agentId, "worker", "ws://localhost:3001", fakeToolDir);

      expect(result.mcpConfigPath).toBe(mcpConfigTempPath(agentId));
      expect(existsSync(result.mcpConfigPath!)).toBe(true);

      const config = JSON.parse(readFileSync(result.mcpConfigPath!, "utf8"));
      expect(config.mcpServers.hgnucomb).toBeDefined();
      expect(config.mcpServers.hgnucomb.command).toBe("node");
      expect(config.mcpServers.hgnucomb.args[0]).toContain("server/dist/mcp.js");
    } finally {
      rmSync(mcpConfigTempPath(agentId), { force: true });
    }
  });

  it("MCP config uses toolDir for mcp.js path, not targetDir", () => {
    const agentId = `test-tooldir-worker-${Date.now()}`;
    try {
      const result = createWorktree(targetDir, agentId, "worker", "ws://localhost:3001", fakeToolDir);

      const config = JSON.parse(readFileSync(result.mcpConfigPath!, "utf8"));
      const mcpPath = config.mcpServers.hgnucomb.args[0];

      expect(mcpPath).toContain(fakeToolDir);
      expect(mcpPath).not.toContain(targetDir);
    } finally {
      rmSync(mcpConfigTempPath(agentId), { force: true });
    }
  });

  it("sets agent env vars in MCP config", () => {
    const agentId = `test-env-worker-${Date.now()}`;
    try {
      const result = createWorktree(targetDir, agentId, "worker", "ws://localhost:9999", fakeToolDir);

      const config = JSON.parse(readFileSync(result.mcpConfigPath!, "utf8"));
      const env = config.mcpServers.hgnucomb.env;

      expect(env.HGNUCOMB_AGENT_ID).toBe(agentId);
      expect(env.HGNUCOMB_CELL_TYPE).toBe("worker");
      expect(env.HGNUCOMB_WS_URL).toBe("ws://localhost:9999");
    } finally {
      rmSync(mcpConfigTempPath(agentId), { force: true });
    }
  });

  it("writes MCP config to temp for non-git orchestrator", () => {
    const agentId = `test-mcp-orch-${Date.now()}`;
    try {
      const result = createWorktree(targetDir, agentId, "orchestrator", "ws://localhost:3001", fakeToolDir);

      expect(result.mcpConfigPath).toBe(mcpConfigTempPath(agentId));
      expect(existsSync(result.mcpConfigPath!)).toBe(true);

      const config = JSON.parse(readFileSync(result.mcpConfigPath!, "utf8"));
      expect(config.mcpServers.hgnucomb.env.HGNUCOMB_CELL_TYPE).toBe("orchestrator");
    } finally {
      rmSync(mcpConfigTempPath(agentId), { force: true });
    }
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

describe("removeWorktree - stale session directory cleanup", () => {
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

  it("removes stale session directory if one exists from old version", () => {
    // Simulate a leftover session dir from the old createSessionDir approach
    mkdirSync(sessionDir, { recursive: true });
    expect(existsSync(sessionDir)).toBe(true);

    const result = removeWorktree("/nonexistent", agentId);

    expect(result.success).toBe(true);
    expect(existsSync(sessionDir)).toBe(false);
  });

  it("succeeds when no session directory exists", () => {
    expect(existsSync(sessionDir)).toBe(false);

    const result = removeWorktree("/nonexistent", agentId);

    expect(result.success).toBe(true);
  });

  it("succeeds when targetDir is not a git repo", () => {
    const dir = makeTempDir("no-git-no-session");
    try {
      const result = removeWorktree(dir, "nonexistent-agent");
      expect(result.success).toBe(true);
    } finally {
      cleanDir(dir);
    }
  });
});
