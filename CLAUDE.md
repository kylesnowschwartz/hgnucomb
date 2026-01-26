# term-canvas

Spatial terminal multiplexer: a 2D navigable canvas where terminals and agents exist as positionable, interactive units.

## Stack

Early stages, still up for debate, but starting ground is:

Electron + React + Konva.js + xterm.js + node-pty

## Documentation

All planning docs and research live in `.agent-history/`:

- `context-packet-20260124-term-canvas.md` - Project goals, constraints, milestones
- `PLAN-hybrid-mvp.md` - Current MVP plan (fake events + hex grid visualization)
- `research-index.md` - Index of all research with quick answers

## Current Focus

Hybrid MVP: Build fake event emitter + hex UI to validate the spatial visualization concept before wiring to real agents.

## Reference Code

`.cloned-sources/` contains upstream repos for patterns:
- `terminal-mcp` - xterm.js + node-pty integration
- `ccswarm` - WebSocket + JSON-RPC 2.0 agent protocol
- `claude-swarm` - MCP + YAML config agent protocol

## Research-Backed Implementation

All implementation work MUST follow this sequence:

### 1. Source the Reference Code
Before writing any code that uses a library or framework:
- Check if the library exists in `.cloned-sources/`
- If NOT present, use the sc-repo-documentation-expert sub-agent to clone the official repo first:

### 2. Research Patterns
With reference code available:
- Search `.cloned-sources/<library>/` for real usage patterns
- Find examples that match what we're building
- Document findings in `.agent-history/research-*.md` if non-trivial

### 3. Plan
- Draft implementation plan based on verified patterns from source
- Get user approval before coding (per CDP-001)

### 4. Implement
- Write code that follows patterns found in reference repos
- Cite the source file when using a non-obvious pattern

**Rationale**: LLM training data goes stale. Upstream repos contain current, working code. Copy from reality, not memory.
