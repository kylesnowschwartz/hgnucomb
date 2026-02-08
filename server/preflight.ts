/**
 * Startup prerequisite checks.
 *
 * Verifies node version, git availability, and optionally claude CLI
 * before the server starts listening. Fails fast with actionable errors.
 */

import { execFileSync } from "child_process";

const MIN_NODE_MAJOR = 20;

/**
 * Run startup prerequisite checks. Exits process on hard failures.
 */
export function runPreflight(): void {
  // Node.js version (free check - no subprocess)
  const nodeMajor = parseInt(process.version.slice(1), 10);
  if (nodeMajor < MIN_NODE_MAJOR) {
    console.error(`[Preflight] FAIL: Node.js ${process.version} is too old (need v${MIN_NODE_MAJOR}+)`);
    console.error("  Install: nvm install 20  (or fnm install 20)");
    process.exit(1);
  }

  // Git (required for worktree isolation and merge operations)
  let gitVersion = "unknown";
  try {
    const raw = execFileSync("git", ["--version"], { encoding: "utf8", stdio: "pipe" });
    // "git version 2.50.1" -> "2.50.1"
    gitVersion = raw.trim().replace(/^git version\s*/, "");
  } catch {
    console.error("[Preflight] FAIL: git not found");
    console.error("  Install: brew install git (macOS) / apt install git (Linux)");
    console.error("  Required for: agent worktree isolation and merge operations");
    process.exit(1);
  }

  // Claude CLI (optional - only needed for orchestrator/worker agents)
  let claudeFound = false;
  try {
    execFileSync("which", ["claude"], { stdio: "pipe" });
    claudeFound = true;
  } catch {
    console.warn("[Preflight] WARN: claude CLI not found");
    console.warn("  Install: npm i -g @anthropic-ai/claude-code");
    console.warn("  Impact: Agent spawning (orchestrator/worker) will not work. Terminal cells OK.");
  }

  console.log(
    `[Preflight] OK: node ${process.version}, git ${gitVersion}, claude ${claudeFound ? "found" : "not found"}`
  );
}
