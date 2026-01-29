#!/bin/bash
# track-state.sh
#
# PostToolUse hook for orchestrators.
# Tracks worker lifecycle state in /tmp/hgnucomb-orch-${session_id}.json
#
# State schema:
#   spawned[]  - worker IDs created via spawn_agent
#   awaited[]  - worker IDs we've called await_worker on
#   merged[]   - worker IDs merged to staging
#   discarded[] - worker IDs cleaned up without merging
#   approvalRequested - true if AskUserQuestion was called
#
# Exit codes:
#   0 - Always (state tracking is observational, never blocks)

set -euo pipefail

input=$(cat)
tool_name=$(echo "$input" | jq -r '.tool_name')
tool_result=$(echo "$input" | jq -r '.tool_result // ""')
session_id=$(echo "$input" | jq -r '.session_id')

# Only orchestrators (orchestrators have NO HGNUCOMB_PARENT_ID)
if [ -n "${HGNUCOMB_PARENT_ID:-}" ]; then
  exit 0
fi

STATE_FILE="/tmp/hgnucomb-orch-${session_id}.json"

# Initialize state if missing
if [ ! -f "$STATE_FILE" ]; then
  echo '{"spawned":[],"awaited":[],"merged":[],"discarded":[],"approvalRequested":false}' >"$STATE_FILE"
fi

state=$(cat "$STATE_FILE")

case "$tool_name" in
mcp__hgnucomb__spawn_agent)
  # Extract agentId from tool_result JSON
  worker_id=$(echo "$tool_result" | jq -r '.agentId // empty' 2>/dev/null || true)
  if [ -n "$worker_id" ]; then
    state=$(echo "$state" | jq --arg id "$worker_id" '.spawned += [$id] | .spawned |= unique')
  fi
  ;;
mcp__hgnucomb__await_worker)
  worker_id=$(echo "$input" | jq -r '.tool_input.workerId // empty')
  if [ -n "$worker_id" ]; then
    state=$(echo "$state" | jq --arg id "$worker_id" '.awaited += [$id] | .awaited |= unique')
  fi
  ;;
mcp__hgnucomb__merge_worker_to_staging)
  worker_id=$(echo "$input" | jq -r '.tool_input.workerId // empty')
  if [ -n "$worker_id" ]; then
    state=$(echo "$state" | jq --arg id "$worker_id" '.merged += [$id] | .merged |= unique')
  fi
  ;;
mcp__hgnucomb__cleanup_worker_worktree)
  worker_id=$(echo "$input" | jq -r '.tool_input.workerId // empty')
  if [ -n "$worker_id" ]; then
    state=$(echo "$state" | jq --arg id "$worker_id" '.discarded += [$id] | .discarded |= unique')
  fi
  ;;
AskUserQuestion)
  state=$(echo "$state" | jq '.approvalRequested = true')
  ;;
esac

echo "$state" >"$STATE_FILE"
exit 0
