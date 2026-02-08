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

# Build and run production on port 3002 (single process)
# Frozen instance - code changes won't hot reload
run:
    pnpm build
    cd server && pnpm build
    @echo "Starting frozen prod on port 3002 (server + UI)..."
    @echo "Code changes will NOT hot reload. Run 'just run' to rebuild."
    cd server && PORT=3002 pnpm start

# Kill all hgnucomb processes (dev + prod)
kill:
    -lsof -ti:3001 | xargs kill 2>/dev/null
    -lsof -ti:3002 | xargs kill 2>/dev/null
    -lsof -ti:5173 | xargs kill 2>/dev/null
    -pkill -f "tsx --watch" 2>/dev/null
    @echo "Cleaned up hgnucomb processes"

# Remove all agent worktrees
clean-worktrees:
    rm -rf .worktrees/*
    git worktree prune
    @echo "Cleaned up agent worktrees"
