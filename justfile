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

# Tag current version, push, and create GitHub release
release:
    #!/usr/bin/env bash
    set -euo pipefail
    version=$(node -p "require('./package.json').version")
    tag="v${version}"
    if git tag -l "$tag" | grep -q "$tag"; then
        echo "Tag $tag already exists. Bump version first: just bump [patch|minor|major]"
        exit 1
    fi
    echo "Tagging $tag..."
    git tag -a "$tag" -m "$tag"
    echo "Pushing main + tags..."
    git push origin main --tags
    echo "Creating GitHub release..."
    gh release create "$tag" --generate-notes --latest
    echo "Released $tag"
