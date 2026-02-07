/**
 * MCP config generation for worktree agents.
 *
 * Claude Code searches for .mcp.json from CWD upward. When an agent spawns
 * in a worktree (its own git root), Claude won't find the parent repo's config.
 *
 * Solution: Generate .mcp.json with absolute paths and write it to the worktree.
 * This follows the claude-swarm pattern of per-instance MCP config generation.
 *
 * ## Dev vs Prod
 *
 * - Dev: `bun server/mcp.ts` (Bun runs TypeScript directly)
 * - Prod: `HGNUCOMB_MCP_BIN=/path/to/hgnucomb-mcp` points to compiled binary
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
 * Reference: .cloned-sources/gastown/internal/config/env.go
 */

import { writeFileSync } from "fs";
import { join } from "path";
import type { CellType } from "@shared/types.ts";

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
 * @param gitRoot - The main repository root (not the worktree)
 * @param agentId - Unique agent identifier
 * @param cellType - Type of agent (orchestrator has full tools, worker has limited)
 * @param wsUrl - WebSocket URL for hgnucomb server
 * @returns MCP config object ready for serialization
 */
export function generateMcpConfig(
  gitRoot: string,
  agentId: string,
  cellType: CellType,
  wsUrl: string = "ws://localhost:3001"
): GeneratedMcpConfig {
  const serverDir = join(gitRoot, "server");

  // Prod: use compiled binary if HGNUCOMB_MCP_BIN is set
  // Dev: use bun to run TypeScript directly (no tsx needed)
  const mcpBin = process.env.HGNUCOMB_MCP_BIN;
  const command = mcpBin ?? "bun";
  const args = mcpBin ? [] : [join(serverDir, "mcp.ts")];

  return {
    mcpServers: {
      hgnucomb: {
        command,
        args,
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
 * Write MCP config to a worktree directory.
 *
 * @param worktreePath - The worktree root where .mcp.json will be written
 * @param config - Generated MCP config
 */
export function writeMcpConfig(
  worktreePath: string,
  config: GeneratedMcpConfig
): void {
  const configPath = join(worktreePath, ".mcp.json");
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
}
