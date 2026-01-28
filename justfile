# Development recipes for hgnucomb

# Start the Vite dev server (frontend)
dev:
    pnpm dev

# Start the WebSocket terminal server
server:
    cd server && pnpm dev

# Start both frontend and server in parallel
dev-all:
    pnpm dev:all

# Install all dependencies
install:
    pnpm install
    cd server && pnpm install

# Run linter
lint:
    pnpm lint

# Run tests
test:
    pnpm test

# Run tests in watch mode
test-watch:
    pnpm test:watch

# Build for production
build:
    pnpm build
    cd server && pnpm build

# Show project structure
tree:
    eza --tree --level 3 --git-ignore

# Check beads-lite tasks
tasks:
    bl ready

# List all tasks
tasks-all:
    bl list --tree

# Kill orphaned dev processes
kill:
    -lsof -ti:3001 | xargs kill 2>/dev/null
    -lsof -ti:5173 | xargs kill 2>/dev/null
    -pkill -f "tsx --watch" 2>/dev/null
    @echo "Cleaned up dev processes"
