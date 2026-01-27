/**
 * MCP config generation for worktree agents.
 *
 * Claude Code searches for .mcp.json from CWD upward. When an agent spawns
 * in a worktree (its own git root), Claude won't find the parent repo's config.
 *
 * Solution: Generate .mcp.json with absolute paths and write it to the worktree.
 * This follows the claude-swarm pattern of per-instance MCP config generation.
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
 * @param wsUrl - WebSocket URL for hgnucomb server
 * @returns MCP config object ready for serialization
 */
export function generateMcpConfig(
  gitRoot: string,
  agentId: string,
  wsUrl: string = "ws://localhost:3001"
): GeneratedMcpConfig {
  // Absolute path to the MCP server script
  const mcpServerPath = join(gitRoot, "server", "dist", "mcp.js");

  return {
    mcpServers: {
      hgnucomb: {
        command: "node",
        args: [mcpServerPath],
        env: {
          HGNUCOMB_AGENT_ID: agentId,
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
