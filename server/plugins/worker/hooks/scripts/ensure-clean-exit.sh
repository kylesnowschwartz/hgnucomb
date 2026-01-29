#!/bin/bash
# ensure-clean-exit.sh
#
# Stop hook for hgnucomb workers.
# Blocks exit if:
#   1. Uncommitted changes exist in worktree
#   2. Worker hasn't called report_result to notify parent orchestrator
#
# Exit codes:
#   0 - All responses use exit 0 with JSON to stdout (per Claude Code JSON API contract)
#
# JSON API contract:
#   - exit 0 + stdout JSON = processed by Claude
#   - exit 2 + stderr = JSON ignored, falls back to text (WRONG for decisions)

set -euo pipefail

input=$(cat)
transcript_path=$(echo "$input" | jq -r '.transcript_path')

# Only applies to workers (workers have HGNUCOMB_PARENT_ID set)
if [ -z "${HGNUCOMB_PARENT_ID:-}" ]; then
  exit 0
fi

# Check 1: Uncommitted changes in worktree
# Workers have HGNUCOMB_WORKTREE set to their isolated git worktree
if [ -n "${HGNUCOMB_WORKTREE:-}" ]; then
  # Fail-open: if git fails, allow exit (|| true + check output)
  uncommitted=$(git -C "$HGNUCOMB_WORKTREE" status --porcelain 2>/dev/null || true)
  if [ -n "$uncommitted" ]; then
    # Escape newlines for JSON
    escaped_uncommitted=$(echo "$uncommitted" | sed ':a;N;$!ba;s/\n/\\n/g')
    cat <<EOF
{"decision": "block", "reason": "Uncommitted changes in worktree:\\n${escaped_uncommitted}\\n\\nCommit your work before exiting."}
EOF
    exit 0
  fi
fi

# Check 2: report_result must be called
# The transcript is JSONL; MCP tool calls appear as {"type":"tool_use","name":"mcp__hgnucomb__report_result",...}
# Using -E for extended regex to handle optional whitespace around colons
if grep -Eq '"name"\s*:\s*"mcp__hgnucomb__report_result"' "$transcript_path" 2>/dev/null; then
  exit 0
fi

# Block: worker must report result before exiting
# JSON to STDOUT, exit 0 (per JSON API contract)
cat <<EOF
{"decision": "block", "reason": "Worker must call mcp__hgnucomb__report_result(parentId=\"${HGNUCOMB_PARENT_ID}\") before exiting. Your parent orchestrator is waiting for your result."}
EOF
exit 0
