# Development recipes for hgnucomb

# Start frontend and server in parallel (Vite HMR + bun --watch)
dev:
    pnpm dev:all

# Install all dependencies
install:
    pnpm install
    cd server && bun install

# Pre-commit gate: lint, typecheck, test, verify builds
check:
    pnpm typecheck
    pnpm lint
    pnpm test
    pnpm build
    cd server && bun run build

# Compile standalone binaries and run
# Produces build/ directory with everything needed to distribute:
#   build/hgnucomb      - server binary
#   build/hgnucomb-mcp  - agent MCP bridge binary
#   build/dist/         - frontend assets
run:
    pnpm build
    mkdir -p build
    cp -r dist build/dist
    NODE_ENV=production bun build --compile bin/hgnucomb.ts --outfile build/hgnucomb
    bun build --compile server/mcp.ts --outfile build/hgnucomb-mcp
    @echo "Starting hgnucomb on port 3002..."
    PORT=3002 ./build/hgnucomb

# Kill all hgnucomb processes (dev + binary)
kill:
    -lsof -ti:3001 | xargs kill 2>/dev/null
    -lsof -ti:3002 | xargs kill 2>/dev/null
    -lsof -ti:5173 | xargs kill 2>/dev/null
    -pkill -f "bun --watch" 2>/dev/null
    @echo "Cleaned up hgnucomb processes"

# Remove all agent worktrees
clean-worktrees:
    rm -rf .worktrees/*
    git worktree prune
    @echo "Cleaned up agent worktrees"
