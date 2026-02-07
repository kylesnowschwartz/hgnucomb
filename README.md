# hgnucomb

Spatial process supervisor for Claude Code agents -- spawn, monitor, steer, and merge AI work from a hex-grid HUD.

<!-- TODO: add demo GIF -->

## Prerequisites

- Node.js 20+
- pnpm
- Claude Code CLI (`claude`) with API key configured
- `just` command runner

## Quick Start

```bash
git clone git@github.com:kylesnowschwartz/hgnucomb.git
cd hgnucomb
just install        # pnpm install in root + server/
just dev            # starts frontend (5173) + server (3001)
```

Open http://localhost:5173.

## First Steps

1. Navigate the hex grid with `hjkl` or arrow keys
2. Select an empty cell, press `o` to spawn an orchestrator
3. Press `Enter` to open its terminal panel
4. Give the orchestrator a task -- it will spawn workers and coordinate their work
5. Workers commit to isolated branches; the orchestrator merges results through a staging workflow with your approval before anything lands on main

## Key Concepts

- **Orchestrators** -- Claude agents with MCP tools that spawn and coordinate workers. Each gets an isolated git worktree.
- **Workers** -- task-focused agents spawned by orchestrators. They do the work, report results back, and their branches get merged through staging.
- **Terminals** -- plain shell sessions on the grid. No agent, just a PTY.
- **Worktree isolation** -- every agent gets its own git worktree. No file conflicts between agents.
- **Staging merge workflow** -- worker changes merge into the orchestrator's staging branch first. You review, then approve the merge to main. Human in the loop.

## Keyboard Shortcuts

Default keymap is Vim-style. Arrow keys also work.

### Grid / Selected Mode

| Key | Action |
|-----|--------|
| `hjkl` / arrows | Navigate hex grid |
| `Shift+H/J/K/L` | Diagonal movement |
| `t` | Spawn terminal at selected cell |
| `o` | Spawn orchestrator at selected cell |
| `w` | Spawn worker at selected cell |
| `Enter` | Open terminal panel for selected cell |
| `Shift+X` | Kill agent (press twice to confirm) |
| `Escape` | Close panel / clear selection |
| `g` | Jump to center |
| `?` | Help |

### Terminal Panel Focused

| Key | Action |
|-----|--------|
| `Cmd+Escape` | Close terminal panel |
| `Cmd+hjkl` | Navigate grid while panel stays open |

## Architecture

React 19 + Vite frontend, Node.js + node-pty + WebSocket server. Konva.js renders the hex grid, xterm.js renders terminals. Zustand for state. MCP SDK for agent coordination.

See `CLAUDE.md` for full architecture documentation.
