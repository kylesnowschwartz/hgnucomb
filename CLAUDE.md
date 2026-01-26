# hgnucomb

Spatial terminal multiplexer: a 2D navigable canvas where terminals and agents exist as positionable, interactive units.

## Stack

**Decided and working:**
- React 19 + Vite (frontend)
- Konva.js via react-konva (hex grid canvas)
- xterm.js + WebGL addon (terminal rendering)
- Zustand (state management)
- Node.js + node-pty + WebSocket (terminal server)

**Not using:** Electron/Tauri (pure browser + local server for now)

## Theme System

Using [Catppuccin Mocha](https://catppuccin.com/) - dark theme with pastel accents.

**Single source of truth:** TypeScript theme files generate CSS at build time.

**Structure:**
```
src/theme/
  catppuccin-mocha.ts   # Current theme (dark)
  catppuccin-latte.ts   # Light theme (available)
  index.ts              # Barrel exports
scripts/
  generate-theme-css.ts # Generates CSS from TS
src/generated/
  theme.css             # Auto-generated (gitignored)
```

**Build-time generation:**
```bash
pnpm theme              # Generate CSS manually
pnpm dev / pnpm build   # Auto-runs theme generation
```

**To switch themes:**
1. Edit `scripts/generate-theme-css.ts` - change the import to latte or mocha
2. Update imports in `HexGrid.tsx` and `TerminalPanel.tsx`
3. Run `pnpm theme` (or restart dev server)

**TypeScript imports:**
```ts
import { palette, ui, xtermTheme, agentColors, hexGrid } from '@theme/catppuccin-mocha';
```

**CSS custom properties:** Use `--ctp-<colorname>` variables in CSS files.

**Agent colors:** orchestrator=blue, worker=green, specialist=mauve

**Reference:** `.cloned-sources/catppuccin-palette/` contains the official palette repo

## Architecture

```
Browser (localhost:5173)          Server (localhost:3001)
┌─────────────────────────┐       ┌─────────────────────────┐
│ App.tsx                 │       │ WebSocket Server        │
│   ├── HexGrid           │       │   └── TerminalManager   │
│   ├── ControlPanel      │  WS   │       └── Sessions[]    │
│   └── TerminalPanel ◄───┼───────┼───► node-pty processes  │
│                         │       │                         │
│ Stores:                 │       └─────────────────────────┘
│   agentStore (agents)   │
│   terminalStore (PTY)   │
│   uiStore (selection)   │
└─────────────────────────┘
```

## Key Patterns

**Terminal data flow:**
- App.tsx subscribes to `bridge.onData()` → stores in buffer (always, even when panel closed)
- TerminalPanel subscribes to `bridge.onData()` → writes to xterm (only when mounted)
- Closing panel keeps PTY running; reopening replays buffer

**Agent-session mapping:**
- `terminalStore.agentToSession: Map<agentId, sessionId>`
- Click agent → check for existing session → create or reuse

**Hex grid clicks:**
- `uiStore.selectedAgentId` drives which terminal is shown
- HexGrid sets selection, App.tsx reacts to open panel

## Running

```bash
just dev-all    # Start both UI and server
just kill       # Clean up orphaned processes
```

## Task Tracking

```bash
bl ready              # What can I work on now?
bl list --tree        # Full dependency tree
bl create "title"     # New task
bl close <id>         # Complete task
```

Context packets live in `.agent-history/tasks/{complete,in-progress,waiting}/`

## Current Status

MVP complete. Next steps TBD:
- Real agent orchestration (connect to actual Claude instances)
- Multi-agent communication protocol
- Session persistence across page reloads

## Reference Code

`.cloned-sources/` contains upstream repos (gitignored):
- `terminal-mcp` - xterm.js + node-pty patterns
- `ghostty-web` - Alternative terminal renderer (tried, reverted - too early)
- `catppuccin-palette` - Official Catppuccin color palette (MIT License)

## Research-Backed Implementation

All implementation work MUST follow this sequence:

### 1. Source the Reference Code
Before writing any code that uses a library or framework:
- Check if the library exists in `.cloned-sources/`
- If NOT present, use the `sc-repo-documentation-expert` agent to clone the official repo first

### 2. Research Patterns
With reference code available:
- Search `.cloned-sources/<library>/` for real usage patterns
- Find examples that match what we're building
- Document findings in `.agent-history/research-*.md` if non-trivial

### 3. Plan
- Draft implementation plan based on verified patterns from source
- Get user approval before coding

### 4. Implement
- Write code that follows patterns found in reference repos
- Cite the source file when using a non-obvious pattern

**Rationale**: LLM training data goes stale. Upstream repos contain current, working code. Copy from reality, not memory.
