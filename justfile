# Development recipes for hgnucomb

# Start frontend and server in parallel (Vite HMR + tsx --watch)
dev:
    rm -rf dist
    (while ! curl -s http://localhost:5173 > /dev/null 2>&1; do sleep 0.3; done && open http://localhost:5173) &
    pnpm dev:all

# Install all dependencies
install:
    pnpm install

# Build everything (frontend + server bundles)
build:
    pnpm build

# Pre-commit gate: lint, typecheck, test, verify builds
check:
    pnpm typecheck
    pnpm lint
    pnpm test
    pnpm build

# Build and run production (single process, default port 3002)
# Identical to `npx hgnucomb` -- no special flags needed
run:
    just build
    @echo "Starting frozen prod (server + UI)..."
    @echo "Code changes will NOT hot reload. Run 'just run' to rebuild."
    node bin/hgnucomb.js

# Kill all hgnucomb processes (dev + prod)
kill:
    -lsof -ti:3001 | xargs kill 2>/dev/null
    -lsof -ti:3002 | xargs kill 2>/dev/null
    -lsof -ti:5173 | xargs kill 2>/dev/null
    -pkill -f "tsx --watch" 2>/dev/null
    @echo "Cleaned up hgnucomb processes"
    @if [ -d .worktrees ] && [ "$$(ls -A .worktrees 2>/dev/null)" ]; then \
        echo "Tip: orphaned worktrees remain. Run 'hgnucomb cleanup' to remove them."; \
    fi

# Remove all agent worktrees (delegates to the CLI cleanup command)
clean-worktrees:
    node bin/hgnucomb.js cleanup

# Bump version in package.json (patch, minor, or major)
bump level="patch":
    #!/usr/bin/env bash
    set -euo pipefail
    current=$(node -p "require('./package.json').version")
    IFS='.' read -r major minor patch <<< "$current"
    case "{{level}}" in
        patch) patch=$((patch + 1)) ;;
        minor) minor=$((minor + 1)); patch=0 ;;
        major) major=$((major + 1)); minor=0; patch=0 ;;
        *) echo "Usage: just bump [patch|minor|major]"; exit 1 ;;
    esac
    new="${major}.${minor}.${patch}"
    npm version "$new" --no-git-tag-version > /dev/null
    echo "Bumped $current -> $new"

# Tag current version, push, create GitHub release, and publish to npm
release:
    #!/usr/bin/env bash
    set -euo pipefail
    version=$(node -p "require('./package.json').version")
    tag="v${version}"
    if git tag -l "$tag" | grep -q "$tag"; then
        echo "Tag $tag already exists. Bump version first: just bump [patch|minor|major]"
        exit 1
    fi
    echo "Running checks..."
    just check
    echo ""
    echo "Tagging $tag..."
    git tag -a "$tag" -m "$tag"
    echo "Pushing main + tags..."
    git push origin main --tags
    echo "Creating GitHub release..."
    gh release create "$tag" --generate-notes --latest
    echo "Publishing to npm..."
    npm publish
    echo "Released $tag"
