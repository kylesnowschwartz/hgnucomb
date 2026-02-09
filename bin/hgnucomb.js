#!/usr/bin/env node

/**
 * CLI entry point for hgnucomb.
 *
 * Starts the server (which serves the built frontend from dist/ if present)
 * and opens the browser once the server is ready. One command, one process.
 */

import { spawn } from "child_process";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { get } from "http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DIST_DIR = resolve(ROOT, "dist");
const SERVER_BUNDLE = resolve(ROOT, "server", "dist", "index.js");
const PORT = process.env.PORT ?? "3001";

// Preflight: check that both bundles exist
if (!existsSync(SERVER_BUNDLE)) {
  console.error("[hgnucomb] Server bundle not found. Run 'pnpm build' first.");
  process.exit(1);
}

if (!existsSync(DIST_DIR)) {
  console.warn("[hgnucomb] No dist/ found. Run 'pnpm build' first for the full UI.");
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
        const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
        spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
        console.log(`[hgnucomb] Opened ${url}`);
      }
    }).on("error", () => {
      // Server not ready yet, keep polling
    });
  }, 300);
}
