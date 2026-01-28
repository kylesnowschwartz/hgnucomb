# hgnucomb

Spatial terminal multiplexer: a 2D navigable canvas where terminals and Claude agents exist as positionable, interactive units with MCP-based coordination.

## Stack

- **Frontend:** React 19 + Vite, Konva.js (hex grid), xterm.js + WebGL (terminals), Zustand (state)
- **Server:** Node.js + node-pty + WebSocket (terminal management), MCP SDK (agent coordination)
- **Runtime:** Browser (localhost:5173) + local server (localhost:3001) - no Electron/Tauri

## Quick Start

```bash
just dev-all    # Start UI + server (or: pnpm dev:all)
just kill       # Clean up orphaned processes
just tasks      # Check beads-lite task queue
```

## Architecture

```
Browser (localhost:5173)              Server (localhost:3001)
┌───────────────────────────┐         ┌─────────────────────────────┐
│ App.tsx                   │         │ index.ts (WebSocket)        │
│   ├── HexGrid.tsx         │   WS    │   └── TerminalManager       │
│   ├── TerminalPanel.tsx ◄─┼─────────┼───────► node-pty sessions   │
│   ├── EventLog.tsx        │         │                             │
│   └── ControlPanel.tsx    │         │ mcp.ts (MCP Server)         │
│                           │         │   ├── spawn_agent           │
│ Stores (src/state/):      │         │   ├── get_grid_state        │
│   agentStore    (agents)  │         │   ├── broadcast             │
│   terminalStore (PTY)     │         │   └── report_status         │
│   eventLogStore (events)  │         │                             │
│   uiStore       (UI)      │         │ worktree.ts (git isolation) │
└───────────────────────────┘         └─────────────────────────────┘
```

## Directory Structure

```
src/
  state/          # Zustand stores (agentStore, terminalStore, eventLogStore, uiStore)
  ui/             # React components (HexGrid, TerminalPanel, EventLog, ControlPanel)
  terminal/       # Terminal bridge abstraction (WebSocket now, Tauri later)
  protocol/       # Event types and script playback
  shared/         # Shared types between client/server (hex utils, context schema)
  theme/          # Catppuccin theme definitions (mocha/latte)

server/
  index.ts        # WebSocket server entry point
  manager.ts      # TerminalManager - session lifecycle
  session.ts      # Individual PTY session wrapper
  mcp.ts          # MCP server (spawn_agent, get_grid_state, broadcast, report_status)
  worktree.ts     # Git worktree creation/cleanup for agent isolation
  context.ts      # Context JSON generation for spawned agents
  mcp-config.ts   # Dynamic .mcp.json generation for worktrees

.agent-history/   # AI-generated docs (plans, research, context packets)
.cloned-sources/  # Upstream repos for reference (gitignored)
```

## Cell Types

**Terminal (click empty cell):** Basic shell - spawns your default shell
**Orchestrator (shift+click):** Claude agent - spawns `claude` CLI with MCP tools and isolated git worktree

Orchestrators receive:
- `HGNUCOMB_AGENT_ID` - unique identifier
- `HGNUCOMB_CONTEXT` - path to context JSON (grid state, nearby agents)
- Isolated git worktree in `.hgnucomb/agents/<id>/`
- MCP config with access to `spawn_agent`, `get_grid_state`, `broadcast`, `report_status`

Workers receive (when spawned by an orchestrator):
- `HGNUCOMB_AGENT_ID` - unique identifier
- `HGNUCOMB_PARENT_ID` - parent orchestrator's agent ID (use this with `report_result`)
- `HGNUCOMB_CONTEXT` - path to context JSON (includes task and parent info)
- Isolated git worktree in `.hgnucomb/agents/<id>/`
- MCP config with access to `report_status`, `report_result`

## MCP Tools (server/mcp.ts)

Agents interact with the grid via MCP:

| Tool | Purpose |
|------|---------|
| `get_identity` | Get your own agent ID, cell type, parent ID, hex coordinates |
| `spawn_agent` | Create child agent at hex coordinates |
| `get_grid_state` | Query grid: all agents, or filtered by distance |
| `broadcast` | Send message to agents within radius |
| `report_status` | Update agent's displayed status badge |
| `report_result` | Send task result to parent orchestrator (workers) |
| `get_messages` | Check inbox for messages from children/peers |

## Key Patterns

**Terminal data flow:**
- App.tsx subscribes to `bridge.onData()` → stores in buffer (persists when panel closed)
- TerminalPanel writes to xterm only when mounted
- Closing panel keeps PTY alive; reopening replays buffer

**Agent isolation:**
- Each orchestrator gets its own git worktree (prevents file conflicts)
- Worktrees created on spawn, cleaned up on terminal dispose
- MCP config generated with absolute paths for worktree context

**Spatial coordination:**
- Hex grid uses axial coordinates (q, r)
- `get_grid_state` supports `maxDistance` filter for nearby agents
- `broadcast` sends to agents within specified radius
- Parent-child relationships tracked and visualized as edges

## Theme System

Using [Catppuccin Mocha](https://catppuccin.com/) - dark theme with pastel accents.

```
src/theme/
  catppuccin-mocha.ts   # Current theme
  catppuccin-latte.ts   # Light alternative
scripts/
  generate-theme-css.ts # TS → CSS at build time
```

```bash
pnpm theme    # Regenerate CSS manually
```

TypeScript: `import { palette, ui, hexGrid } from '@theme/catppuccin-mocha'`
CSS: Use `--ctp-<colorname>` custom properties

## Task Tracking

```bash
bl ready              # What can I work on now?
bl list --tree        # Full dependency tree
bl create "title"     # New task
bl close <id>         # Complete task
```

## Current Status

**Complete (Phases 1-5):**
- Hex grid with pan/zoom and click-to-spawn
- Terminal vs orchestrator cell types
- Claude CLI integration with identity env vars
- MCP server (spawn, query, broadcast, status)
- Git worktree isolation per orchestrator
- Event log panel for system events
- Status badges on hex cells

**Remaining:**
- Sparse checkout support for worktrees
- Session persistence across page reloads
- Production hardening (error handling, reconnection)

## Reference Code

`.cloned-sources/` contains upstream repos (gitignored):

| Repo | Purpose |
|------|---------|
| `terminal-mcp` | xterm.js + node-pty patterns |
| `mcp-sdk` | MCP TypeScript SDK |
| `ccswarm`, `claude-swarm`, `swarm` | Multi-agent orchestration patterns |
| `voicetree` | Tree-based agent coordination |
| `claudio`, `gastown` | Git worktree isolation patterns |
| `catppuccin-palette` | Official color palette |
| `konva` | Canvas library internals |

## Research Documents

`.agent-history/` contains 14 research docs. Key ones:

- `research-multi-agent-orchestration-*.md` - Agent coordination patterns
- `research-adversarial-patterns-*.md` - Patterns from production users
- `research-protocol-comparison-*.md` - IPC/protocol options
- `research-terminal-mcp-*.md` - xterm.js integration patterns
- `research-index.md` - Index of all research

## Development Process

1. **Check tasks:** `bl ready` before starting work
2. **Source reference code:** Check `.cloned-sources/` first, clone if missing
3. **Research patterns:** Document non-trivial findings in `.agent-history/research-*.md`
4. **Plan:** Get approval before significant changes
5. **Implement:** Follow patterns from reference repos
6. **Close tasks:** `bl close <id>` when done
