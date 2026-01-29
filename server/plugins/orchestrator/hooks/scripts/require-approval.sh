#!/bin/bash
# require-approval.sh
#
# PreToolUse hook for orchestrators.
# Blocks merge_staging_to_main unless AskUserQuestion was called first.
#
# This ensures human approval before promoting changes to main.
#
# Exit codes:
#   0 - Always (JSON output to stdout per JSON API contract)

set -euo pipefail

input=$(cat)
session_id=$(echo "$input" | jq -r '.session_id')

# Only orchestrators (orchestrators have NO HGNUCOMB_PARENT_ID)
if [ -n "${HGNUCOMB_PARENT_ID:-}" ]; then
  exit 0
fi

STATE_FILE="/tmp/hgnucomb-orch-${session_id}.json"

if [ -f "$STATE_FILE" ]; then
  approved=$(jq -r '.approvalRequested' "$STATE_FILE")
  if [ "$approved" = "true" ]; then
    exit 0
  fi
fi

# Block: must get human approval first
cat <<EOF
{"decision": "block", "reason": "Must call AskUserQuestion to get human approval before merging to main."}
EOF
exit 0
