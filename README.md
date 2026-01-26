# hgnucomb

Spatial terminal multiplexer: a 2D navigable canvas where terminals exist as positionable, interactive units.

## Quick Start

```bash
# Install dependencies
pnpm install
cd server && pnpm install && cd ..

# Run both UI and terminal server
just dev-all
# Or: pnpm dev:all
```

Open http://localhost:5173. Click Play to spawn agents, click an agent hex to open its terminal.

## Stack

- **Frontend**: React + Konva.js (hex grid) + xterm.js (terminal)
- **Backend**: Node.js WebSocket server + node-pty
- **State**: Zustand

## Project Status

MVP complete. Core functionality working:
- Hex grid with pan/zoom
- Agent visualization (spawn, status, connections)
- Click agent to open terminal panel
- Real PTY sessions via WebSocket
- Sessions persist when switching between agents

## Structure

```
src/
  ui/           # React components (HexGrid, TerminalPanel, ControlPanel)
  state/        # Zustand stores (agentStore, terminalStore, uiStore)
  terminal/     # WebSocket bridge abstraction
  protocol/     # Event types and script player
server/         # WebSocket terminal server
```

## License

MIT
