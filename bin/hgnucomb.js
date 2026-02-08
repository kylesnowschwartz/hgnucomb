#!/usr/bin/env node

/**
 * CLI entry point for hgnucomb.
 *
 * Starts the server (which serves the built frontend from dist/ if present)
 * and opens the browser. One command, one process.
 */

import { spawn } from "child_process";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DIST_DIR = resolve(ROOT, "dist");
const SERVER_DIR = resolve(ROOT, "server");
const PORT = process.env.PORT ?? "3001";

// If no dist/, the server will still start but won't serve a frontend.
// Warn the user so they know what to do.
if (!existsSync(DIST_DIR)) {
  console.warn("[hgnucomb] No dist/ found. Run 'pnpm build' first for the full UI.");
  console.warn("[hgnucomb] Starting server in WebSocket-only mode...\n");
}

// Start the server - it handles preflight, static serving, and WebSocket
const server = spawn("npx", ["tsx", "index.ts"], {
  cwd: SERVER_DIR,
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

// Open browser after a short delay to let the server bind
const url = `http://localhost:${PORT}`;
setTimeout(() => {
  // Only open if dist/ exists (otherwise there's nothing to show in browser)
  if (!existsSync(DIST_DIR)) return;

  const platform = process.platform;
  const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
  spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
  console.log(`[hgnucomb] Opened ${url}`);
}, 1500);
