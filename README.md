# hgnucomb

A spatial terminal multiplexer. Your terminals live on a hex grid -- navigate between them like an RTS, build spatial memory of your workspace, and optionally let AI agents coordinate across it.

![hgnucomb demo](https://raw.githubusercontent.com/kylesnowschwartz/hgnucomb/main/docs/demo.gif)

## Why

Terminal multiplexers give you tabs and panes. That's a 1D mental model for an inherently multi-dimensional workflow. You have a dev server *over there*, tests *next to it*, a database shell *nearby*, and your editor *in the center*. You know where things are spatially -- your tools just don't.

hgnucomb puts your terminals on a 2D hex grid. Navigate with vim keys. Build a layout that mirrors how you think about your project. "The API server is up and to the left, the tests are to the right." That spatial memory persists across context switches in a way that "tab 4" never will.

And when you're ready for AI agents, they live on the same grid -- spawn them, watch them work, merge their code safely through a staging workflow with human approval.

## Quick Start

```bash
npx hgnucomb
```

That's it. Starts the server, opens the browser, you're on the grid.

### Prerequisites

- Node.js 20+ (with C++ build tools for node-pty -- Xcode CLI on macOS, `build-essential` on Linux)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`claude`) -- only needed for AI agents

### Development

```bash
git clone git@github.com:kylesnowschwartz/hgnucomb.git
cd hgnucomb
just install    # pnpm install
just dev        # frontend :5173 + server :3001
```

## The Grid

Navigate with `hjkl` or arrow keys. Press `t` on any empty cell to spawn a terminal. Press `Enter` to open it. Press `Cmd+Escape` to close the panel and return to the grid. Your terminal keeps running in the background -- reopen it anytime.

That's it. Spatial terminals.

You build a layout once. You remember where things are. Navigating between "the server" and "the tests" becomes muscle memory, not tab-hunting.

## AI Agents (Optional)

With Claude Code installed, the grid becomes a process supervisor for AI agents.

Press `o` to spawn an **orchestrator** -- a Claude agent with MCP tools and its own git worktree. Give it a task:

> "Add a /health endpoint. Spawn one worker to implement it and another to write the test."

Workers appear on the grid as new hex cells, connected to the orchestrator by edges. Status badges cycle in real time: spawning -> working -> done.

### The Merge Safety Net

```
worker A ──commit──> worktree A ─┐
                                 ├── merge ──> orchestrator staging ──> you review ──> main
worker B ──commit──> worktree B ─┘
```

Every agent gets its own git worktree. Workers never touch main. The orchestrator merges into a staging branch. You review the diff. You approve. Then it lands.

**What this gives you over Claude Code's built-in team mode:**

- **Git worktree isolation** -- three agents editing the same file? No conflicts until you merge.
- **Staged merge workflow** -- human in the loop before main. Always.
- **Visual process control** -- see every agent with live status badges. Spawn, monitor, kill.
- **Scoped capabilities** -- orchestrators get spawn/merge tools, workers get report-only tools. Enforced at the MCP level.

## Key Concepts

| Concept | What it is |
|---------|-----------|
| **Terminal** | Plain shell session on the grid. No agent, just a PTY. The foundation. |
| **Orchestrator** | Claude agent with MCP tools (spawn, merge, broadcast). Gets its own git worktree. |
| **Worker** | Task-focused agent spawned by an orchestrator. Reports results back. |
| **Worktree isolation** | Every agent gets `git worktree add`. Parallel edits are safe. |
| **Staging merge** | Worker -> orchestrator staging -> human approval -> main. |

## Keyboard Shortcuts

Vim-style by default. Arrow keys also work.

### Grid

| Key | Action |
|-----|--------|
| `hjkl` / arrows | Move selection |
| `Shift+H/J/K/L` | Diagonal movement |
| `t` | Spawn terminal |
| `o` | Spawn orchestrator |
| `w` | Spawn worker |
| `Enter` | Open terminal panel |
| `x` | Kill (press twice) |
| `Escape` | Close panel / deselect |
| `g` | Jump to center |
| `?` | Help overlay |

### Terminal Panel

| Key | Action |
|-----|--------|
| `Cmd+Escape` | Close panel |
| `Cmd+Arrows` | Navigate grid with panel open |

## Architecture

React 19 + Vite frontend. Node.js + node-pty + WebSocket server. Konva.js renders the hex grid, xterm.js renders terminals, Zustand manages state, MCP SDK coordinates agents.

See [CLAUDE.md](CLAUDE.md) for the full architecture reference.

## Status

v0.1.0 -- working prototype. Usable for real work, rough around some edges.

**What's shipped:**
- Hex grid with pan/zoom, vim-style keyboard navigation (hjkl + diagonals)
- Three cell types: terminal, orchestrator, worker -- each with distinct visuals
- Git worktree isolation per agent (parallel edits without conflicts)
- 18 MCP tools for agent coordination (spawn, merge, broadcast, status, cleanup, kill, etc.)
- Staged merge workflow: worker -> orchestrator staging -> human approval -> main
- Merge conflict detection with resolution options
- Non-blocking multi-worker coordination (`check_workers`) and blocking single-worker (`await_worker`)
- Live status badges with pulse animations and elapsed time
- Parent-child edge visualization between orchestrators and workers
- Agent telemetry pipeline (transcript watcher, JSONL parsing, HUD observability)
- Worker commit enforcement via Claude Code plugin hooks
- Session reconnection with exponential backoff
- Configurable model per agent (opus/sonnet/haiku)
- Non-git workspace fallback for projects outside git repos
- PWA standalone mode for clean keyboard capture
- Prerequisite checks on startup (node, git, claude)

**What's next:**
- Audio notifications on agent completion
- Agent timeout and cancellation
- Worker type specialization (typed archetypes with different capabilities)
- Sparse checkout support for large repos
- Server-side terminal state tracking
