#!/usr/bin/env node

/**
 * CLI entry point for hgnucomb.
 *
 * Usage:
 *   hgnucomb              Start the server and open the browser
 *   hgnucomb cleanup      Remove all agent worktrees and branches
 *   hgnucomb --help       Show usage
 *   hgnucomb --version    Show version
 */

import { spawn, execSync } from "child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { get } from "http";
import { createInterface } from "readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// --- Argument parsing (no dependencies) ---

const args = process.argv.slice(2);
const command = args.find((a) => !a.startsWith("-"));
const flags = new Set(args.filter((a) => a.startsWith("-")));

function getVersion() {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
  return pkg.version;
}

function getPort() {
  // --port / -p flag takes precedence over PORT env var
  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--port" || args[i] === "-p") && args[i + 1]) {
      return args[i + 1];
    }
  }
  return process.env.PORT ?? "3002";
}

function printHelp() {
  console.log(`hgnucomb v${getVersion()} - Spatial terminal multiplexer

Usage:
  hgnucomb                  Start the server and open the browser
  hgnucomb cleanup          Remove all agent worktrees and branches
  hgnucomb --help, -h       Show this help
  hgnucomb --version, -v    Show version

Options:
  --port, -p <port>         Server port (default: 3002, or PORT env var)

Environment:
  PORT                      Server port (overridden by --port flag)

Examples:
  hgnucomb                  Start in current directory
  hgnucomb -p 8080          Run on a custom port
  hgnucomb cleanup          Clean up leftover agent worktrees`);
}

// --- Commands ---

function confirm(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

function gitExec(args, cwd) {
  try {
    return execSync(["git", ...args].join(" "), {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function getGitRoot() {
  return gitExec(["rev-parse", "--show-toplevel"], process.cwd());
}

async function runCleanup() {
  const gitRoot = getGitRoot();
  if (!gitRoot) {
    console.log("Not in a git repository. Nothing to clean up.");
    process.exit(0);
  }

  const worktreesDir = join(gitRoot, ".worktrees");
  const hasWorktrees = existsSync(worktreesDir);

  // Find hgnucomb branches
  const branchOutput = gitExec(["branch", "--list", "hgnucomb/*"], gitRoot);
  const branches = branchOutput
    ? branchOutput
        .split("\n")
        .map((b) => b.replace(/^[*+\s]+/, "").trim())
        .filter(Boolean)
    : [];

  // Find worktree directories
  const worktrees = hasWorktrees ? readdirSync(worktreesDir) : [];

  if (worktrees.length === 0 && branches.length === 0) {
    console.log("Nothing to clean up. No worktrees or hgnucomb branches found.");
    process.exit(0);
  }

  // Show what will be removed
  console.log("This will remove:\n");
  if (worktrees.length > 0) {
    console.log(`  ${worktrees.length} worktree(s) in ${worktreesDir}/`);
    for (const w of worktrees) {
      console.log(`    - ${w}`);
    }
  }
  if (branches.length > 0) {
    console.log(`  ${branches.length} branch(es):`);
    for (const b of branches) {
      console.log(`    - ${b}`);
    }
  }
  console.log("");

  const answer = await confirm("Proceed? [y/N] ");
  if (answer !== "y" && answer !== "yes") {
    console.log("Aborted.");
    process.exit(0);
  }

  // Remove worktrees via git (handles internal bookkeeping)
  for (const w of worktrees) {
    const wPath = join(worktreesDir, w);
    const result = gitExec(["worktree", "remove", "--force", wPath], gitRoot);
    if (result === null) {
      // git command failed, remove manually
      try {
        rmSync(wPath, { recursive: true, force: true });
        console.log(`  Removed ${w} (manual)`);
      } catch (err) {
        console.error(`  Failed to remove ${w}: ${err.message}`);
      }
    } else {
      console.log(`  Removed worktree ${w}`);
    }
  }

  // Delete hgnucomb branches
  for (const b of branches) {
    gitExec(["branch", "-D", b], gitRoot);
    console.log(`  Deleted branch ${b}`);
  }

  // Prune stale worktree references
  gitExec(["worktree", "prune"], gitRoot);

  // Remove empty .worktrees directory
  if (hasWorktrees) {
    try {
      const remaining = readdirSync(worktreesDir);
      if (remaining.length === 0) {
        rmSync(worktreesDir, { recursive: true });
      }
    } catch {
      // Already gone, fine
    }
  }

  console.log("\nCleanup complete.");
}

function startServer() {
  const DIST_DIR = resolve(ROOT, "dist");
  const SERVER_BUNDLE = resolve(ROOT, "server", "dist", "index.js");
  const PORT = getPort();

  // Preflight: check that both bundles exist
  if (!existsSync(SERVER_BUNDLE)) {
    console.error("[hgnucomb] Server bundle not found. Run 'pnpm build' first.");
    process.exit(1);
  }

  if (!existsSync(DIST_DIR)) {
    console.warn(
      "[hgnucomb] No dist/ found. Run 'pnpm build' first for the full UI."
    );
    console.warn("[hgnucomb] Starting server in WebSocket-only mode...\n");
  }

  // Start the bundled server directly with node (no tsx at runtime)
  const server = spawn(process.execPath, [SERVER_BUNDLE], {
    env: { ...process.env, PORT },
    stdio: "inherit",
  });

  server.on("error", (err) => {
    console.error(`[hgnucomb] Failed to start server: ${err.message}`);
    process.exit(1);
  });

  server.on("exit", (code) => {
    process.exit(code ?? 0);
  });

  // Forward signals to the server process
  process.on("SIGINT", () => server.kill("SIGINT"));
  process.on("SIGTERM", () => server.kill("SIGTERM"));

  // Poll for server readiness, then open browser
  const url = `http://localhost:${PORT}`;
  if (existsSync(DIST_DIR)) {
    const poll = setInterval(() => {
      get(url, (res) => {
        if (res.statusCode) {
          clearInterval(poll);
          const platform = process.platform;
          const cmd =
            platform === "darwin"
              ? "open"
              : platform === "win32"
                ? "start"
                : "xdg-open";
          spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
          console.log(`[hgnucomb] Opened ${url}`);
        }
      }).on("error", () => {
        // Server not ready yet, keep polling
      });
    }, 300);
  }
}

// --- Dispatch ---

if (flags.has("--help") || flags.has("-h")) {
  printHelp();
} else if (flags.has("--version") || flags.has("-v")) {
  console.log(getVersion());
} else if (command === "cleanup") {
  await runCleanup();
} else if (command) {
  console.error(`Unknown command: ${command}`);
  console.error('Run "hgnucomb --help" for usage.');
  process.exit(1);
} else {
  startServer();
}
