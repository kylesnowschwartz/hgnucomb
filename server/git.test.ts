/**
 * Tests for git helper functions.
 *
 * These tests focus on:
 * 1. Argument handling (spaces in commit messages, etc.)
 * 2. Error propagation (actual errors, not undefined)
 * 3. Path construction consistency
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as childProcess from "child_process";
import {
  gitExecWithError,
  gitExec,
  getWorktreePath,
  getBranchName,
  WORKTREES_DIR,
  BRANCH_PREFIX,
} from "./git.js";

// Mock child_process
vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));

const mockExecFileSync = vi.mocked(childProcess.execFileSync);

describe("git helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Suppress console.warn in tests
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("gitExecWithError", () => {
    it("returns ok result on success", () => {
      mockExecFileSync.mockReturnValue("output text\n");

      const result = gitExecWithError(["status"], "/some/path");

      expect(result).toEqual({ ok: true, output: "output text" });
    });

    it("trims output whitespace", () => {
      mockExecFileSync.mockReturnValue("  trimmed  \n\n");

      const result = gitExecWithError(["status"], "/some/path");

      expect(result).toEqual({ ok: true, output: "trimmed" });
    });

    it("returns error result on failure with stderr", () => {
      const error = new Error("Command failed") as Error & { stderr: Buffer };
      error.stderr = Buffer.from("fatal: not a git repository");
      mockExecFileSync.mockImplementation(() => { throw error; });

      const result = gitExecWithError(["status"], "/some/path");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("fatal: not a git repository");
      }
    });

    it("falls back to message if no stderr", () => {
      const error = new Error("Command failed");
      mockExecFileSync.mockImplementation(() => { throw error; });

      const result = gitExecWithError(["status"], "/some/path");

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("Command failed");
      }
    });

    it("passes arguments as array to execFileSync (not shell-concatenated)", () => {
      mockExecFileSync.mockReturnValue("");

      gitExecWithError(["merge", "branch-name", "-m", "Message with spaces"], "/cwd");

      // Verify execFileSync was called with arguments as array
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "git",
        ["merge", "branch-name", "-m", "Message with spaces"],
        expect.objectContaining({ cwd: "/cwd" })
      );
    });

    it("handles arguments with special characters", () => {
      mockExecFileSync.mockReturnValue("");

      gitExecWithError(["commit", "-m", "Fix: handle $VARIABLE and `backticks`"], "/cwd");

      expect(mockExecFileSync).toHaveBeenCalledWith(
        "git",
        ["commit", "-m", "Fix: handle $VARIABLE and `backticks`"],
        expect.any(Object)
      );
    });
  });

  describe("gitExec", () => {
    it("returns output on success", () => {
      mockExecFileSync.mockReturnValue("success\n");

      const result = gitExec(["status"], "/path");

      expect(result).toBe("success");
    });

    it("returns null on error", () => {
      mockExecFileSync.mockImplementation(() => { throw new Error("fail"); });

      const result = gitExec(["status"], "/path");

      expect(result).toBeNull();
    });
  });

  describe("path constants", () => {
    it("WORKTREES_DIR is consistent", () => {
      expect(WORKTREES_DIR).toBe(".worktrees");
    });

    it("BRANCH_PREFIX is consistent", () => {
      expect(BRANCH_PREFIX).toBe("hgnucomb");
    });
  });

  describe("getWorktreePath", () => {
    it("constructs path with WORKTREES_DIR", () => {
      const path = getWorktreePath("/repo", "agent-123");

      expect(path).toBe("/repo/.worktrees/agent-123");
    });

    it("handles agent IDs with special characters", () => {
      const path = getWorktreePath("/repo", "agent-1234567890-abc");

      expect(path).toBe("/repo/.worktrees/agent-1234567890-abc");
    });
  });

  describe("getBranchName", () => {
    it("constructs branch name with BRANCH_PREFIX", () => {
      const branch = getBranchName("agent-123");

      expect(branch).toBe("hgnucomb/agent-123");
    });
  });

  describe("path consistency", () => {
    it("getWorktreePath uses WORKTREES_DIR constant", () => {
      const path = getWorktreePath("/repo", "test");

      expect(path).toContain(WORKTREES_DIR);
    });

    it("getBranchName uses BRANCH_PREFIX constant", () => {
      const branch = getBranchName("test");

      expect(branch.startsWith(BRANCH_PREFIX)).toBe(true);
    });
  });
});

describe("error message propagation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("error includes actual content, never undefined", () => {
    const error = new Error("git error") as Error & { stderr: Buffer };
    error.stderr = Buffer.from("actual error message");
    mockExecFileSync.mockImplementation(() => { throw error; });

    const result = gitExecWithError(["merge", "branch"], "/cwd");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toBe("undefined");
      expect(result.error).not.toBeUndefined();
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it("empty stderr falls back to error message", () => {
    const error = new Error("fallback message") as Error & { stderr: Buffer };
    error.stderr = Buffer.from("");
    mockExecFileSync.mockImplementation(() => { throw error; });

    const result = gitExecWithError(["merge", "branch"], "/cwd");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("fallback message");
    }
  });
});
