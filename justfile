# Development recipes for hgnucomb

# Start frontend and server in parallel
dev:
    pnpm dev:all

# Install all dependencies
install:
    pnpm install
    cd server && pnpm install

# Run typecheck, lint, and tests
test:
    pnpm typecheck
    pnpm lint
    pnpm test

# Pre-commit check: lint, typecheck, tests, then build
check:
    just test
    just build

# Build for production
build:
    pnpm build
    cd server && pnpm build

# Kill orphaned dev processes
kill:
    -lsof -ti:3001 | xargs kill 2>/dev/null
    -lsof -ti:5173 | xargs kill 2>/dev/null
    -pkill -f "tsx --watch" 2>/dev/null
    @echo "Cleaned up dev processes"

# Kill prod processes
kill-prod:
    -lsof -ti:3002 | xargs kill 2>/dev/null
    -lsof -ti:5174 | xargs kill 2>/dev/null
    @echo "Cleaned up prod processes"

# Build prod bundle (with prod server URL baked in)
build-prod:
    VITE_WS_URL=ws://localhost:3002 pnpm build
    cd server && pnpm build

# Run frozen prod instance on alternate ports (3002/5174)
# Code changes won't affect this instance - must rebuild to update
prod: build-prod
    @echo "Starting frozen prod on ports 3002 (server) / 5174 (UI)..."
    @echo "Code changes will NOT hot reload. Run 'just build-prod' to update."
    (export PORT=3002; cd server && pnpm start) &
    pnpm preview --port 5174
