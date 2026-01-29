#!/bin/bash
# verify-completion.sh
#
# Stop hook for orchestrators.
# Blocks exit unless:
#   1. All spawned workers have been awaited
#   2. All awaited workers have been merged or discarded
#   3. If any workers were merged, merge_staging_to_main was called
#
# Exit codes:
#   0 - Always (JSON output to stdout per JSON API contract)

set -euo pipefail

input=$(cat)
session_id=$(echo "$input" | jq -r '.session_id')
transcript_path=$(echo "$input" | jq -r '.transcript_path')

# Only orchestrators (orchestrators have NO HGNUCOMB_PARENT_ID)
if [ -n "${HGNUCOMB_PARENT_ID:-}" ]; then
  exit 0
fi

STATE_FILE="/tmp/hgnucomb-orch-${session_id}.json"

# No state file = no workers spawned, allow exit
if [ ! -f "$STATE_FILE" ]; then
  exit 0
fi

state=$(cat "$STATE_FILE")
spawned=$(echo "$state" | jq -r '.spawned | length')
awaited=$(echo "$state" | jq -r '.awaited | length')
merged=$(echo "$state" | jq -r '.merged | length')
discarded=$(echo "$state" | jq -r '.discarded | length')
handled=$((merged + discarded))

# No workers spawned, allow exit
if [ "$spawned" -eq 0 ]; then
  exit 0
fi

# Check: all spawned workers awaited?
if [ "$awaited" -lt "$spawned" ]; then
  spawned_list=$(echo "$state" | jq -r '.spawned | join(", ")')
  awaited_list=$(echo "$state" | jq -r '.awaited | join(", ")')
  cat <<EOF
{"decision": "block", "reason": "Not all workers awaited. Spawned: [$spawned_list], Awaited: [$awaited_list]. Call mcp__hgnucomb__await_worker for remaining workers."}
EOF
  exit 0
fi

# Check: all awaited workers handled (merged or discarded)?
if [ "$handled" -lt "$awaited" ]; then
  awaited_list=$(echo "$state" | jq -r '.awaited | join(", ")')
  merged_list=$(echo "$state" | jq -r '.merged | join(", ")')
  discarded_list=$(echo "$state" | jq -r '.discarded | join(", ")')
  cat <<EOF
{"decision": "block", "reason": "Not all workers handled. Awaited: [$awaited_list], Merged: [$merged_list], Discarded: [$discarded_list]. Merge or cleanup remaining workers."}
EOF
  exit 0
fi

# Check: if any merged, was merge_staging_to_main called?
if [ "$merged" -gt 0 ]; then
  if ! grep -q '"name":"mcp__hgnucomb__merge_staging_to_main"' "$transcript_path" 2>/dev/null; then
    merged_list=$(echo "$state" | jq -r '.merged | join(", ")')
    cat <<EOF
{"decision": "block", "reason": "Workers [$merged_list] were merged to staging but merge_staging_to_main was not called. Get human approval and merge to main."}
EOF
    exit 0
  fi
fi

# All checks passed
exit 0
