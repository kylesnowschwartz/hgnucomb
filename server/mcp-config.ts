/**
 * MCP config generation for worktree agents.
 *
 * Claude Code searches for .mcp.json from CWD upward. When an agent spawns
 * in a worktree (its own git root), Claude won't find the parent repo's config.
 *
 * Solution: Generate MCP config with absolute paths, write to $TMPDIR, and pass
 * the path to Claude CLI via --mcp-config flag. Each agent gets its own config.
 *
 * ## Future: Per-Agent Settings
 *
 * When we need per-agent prompts, permissions, or tool restrictions, use:
 *
 *   CLAUDE_CONFIG_DIR=/path/to/agent-config claude
 *
 * This env var tells Claude Code where to find its settings directory.
 * Each agent gets its own config dir with:
 *   - settings.json (permissions, allowed tools)
 *   - CLAUDE.md (agent-specific system prompt)
 *   - .mcp.json (can move MCP config here too)
 *
 * See CLAUDE_CONFIG_DIR in Claude Code docs for details.
 */

import { writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { CellType } from "../shared/types.ts";

export interface GeneratedMcpConfig {
  mcpServers: {
    hgnucomb: {
      command: string;
      args: string[];
      env: Record<string, string>;
    };
  };
}

/**
 * Generate MCP config with absolute paths for a worktree agent.
 *
 * @param toolDir - Where hgnucomb itself lives (NOT the agent's project).
 *   The MCP server binary and script always live in hgnucomb's own tree,
 *   regardless of which project the agent is working in.
 * @param agentId - Unique agent identifier
 * @param cellType - Type of agent (orchestrator has full tools, worker has limited)
 * @param wsUrl - WebSocket URL for hgnucomb server
 * @returns MCP config object ready for serialization
 */
export function generateMcpConfig(
  toolDir: string,
  agentId: string,
  cellType: CellType,
  wsUrl: string = "ws://localhost:3001"
): GeneratedMcpConfig {
  // Use the pre-bundled MCP server (no tsx at runtime)
  const mcpServerPath = join(toolDir, "server", "dist", "mcp.js");

  return {
    mcpServers: {
      hgnucomb: {
        command: "node",
        args: [mcpServerPath],
        env: {
          HGNUCOMB_AGENT_ID: agentId,
          HGNUCOMB_CELL_TYPE: cellType,
          HGNUCOMB_WS_URL: wsUrl,
        },
      },
    },
  };
}

/**
 * Write MCP config to a temp file and return the path.
 *
 * The config is written to $TMPDIR/hgnucomb-mcp-{agentId}.json and passed
 * to Claude CLI via --mcp-config flag. This avoids polluting the agent's
 * working directory with .mcp.json files.
 *
 * @param agentId - Unique agent identifier (used in filename)
 * @param config - Generated MCP config
 * @returns Absolute path to the temp config file
 */
export function writeMcpConfigToTemp(
  agentId: string,
  config: GeneratedMcpConfig
): string {
  const configPath = join(tmpdir(), `hgnucomb-mcp-${agentId}.json`);
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  return configPath;
}

/**
 * Remove an agent's temp MCP config file.
 * Safe to call even if the file doesn't exist.
 */
export function cleanupMcpConfig(agentId: string): void {
  const configPath = join(tmpdir(), `hgnucomb-mcp-${agentId}.json`);
  rmSync(configPath, { force: true });
}
