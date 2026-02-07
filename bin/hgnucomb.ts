#!/usr/bin/env bun
/**
 * hgnucomb CLI entry point.
 *
 * This is the compiled binary entry point - always production mode.
 * Dev mode uses server/index.ts directly via `just dev`.
 *
 * Asset resolution: binary finds dist/ and hgnucomb-mcp relative to itself
 * via process.execPath, so it works from any CWD.
 */

import { dirname, join } from "path";

// ---------------------------------------------------------------------------
// Prerequisites
// ---------------------------------------------------------------------------

if (!Bun.which("git")) {
  console.error("Error: git is required but not found in PATH.");
  process.exit(1);
}

if (!Bun.which("claude")) {
  console.warn(
    "Warning: claude CLI not found. Agent features will be disabled.\n" +
    "Install: npm i -g @anthropic-ai/claude-code"
  );
}

// ---------------------------------------------------------------------------
// Configuration (resolve relative to the binary, not CWD)
// ---------------------------------------------------------------------------

const BIN_DIR = dirname(process.execPath);
const PORT = parseInt(process.env.PORT ?? "3000", 10);

// Binary is always production mode
process.env.NODE_ENV = "production";
process.env.PORT = String(PORT);

// Locate assets relative to the binary itself
if (!process.env.HGNUCOMB_DIST_DIR) {
  process.env.HGNUCOMB_DIST_DIR = join(BIN_DIR, "dist");
}
if (!process.env.HGNUCOMB_MCP_BIN) {
  process.env.HGNUCOMB_MCP_BIN = join(BIN_DIR, "hgnucomb-mcp");
}

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

await import("../server/index.ts");

console.log(`hgnucomb running at http://localhost:${PORT}`);

// Open browser (macOS)
if (process.platform === "darwin") {
  Bun.spawn(["open", `http://localhost:${PORT}`], {
    stdout: "ignore",
    stderr: "ignore",
  });
}
