# Development recipes for hgnucomb

# Start frontend and server in parallel (Vite HMR + tsx --watch)
dev:
    pnpm dev:all

# Install all dependencies
install:
    pnpm install
    cd server && pnpm install

# Pre-commit gate: lint, typecheck, test, verify builds
check:
    pnpm typecheck
    pnpm lint
    pnpm test
    pnpm build
    cd server && pnpm build

# Build and run production on alternate ports (3002/5174)
# Frozen instance - code changes won't hot reload
run:
    VITE_WS_URL=ws://localhost:3002 pnpm build
    cd server && pnpm build
    @echo "Starting frozen prod on ports 3002 (server) / 5174 (UI)..."
    @echo "Code changes will NOT hot reload. Run 'just run' to rebuild."
    (export PORT=3002; cd server && pnpm start) &
    pnpm preview --port 5174

# Kill all hgnucomb processes (dev + prod)
kill:
    -lsof -ti:3001 | xargs kill 2>/dev/null
    -lsof -ti:3002 | xargs kill 2>/dev/null
    -lsof -ti:5173 | xargs kill 2>/dev/null
    -lsof -ti:5174 | xargs kill 2>/dev/null
    -pkill -f "tsx --watch" 2>/dev/null
    @echo "Cleaned up hgnucomb processes"

# Remove all agent worktrees
clean-worktrees:
    rm -rf .worktrees/*
    git worktree prune
    @echo "Cleaned up agent worktrees"
