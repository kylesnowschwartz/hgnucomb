#!/bin/bash
# ensure-report-result.sh
#
# Stop hook for hgnucomb workers.
# Blocks exit until worker calls report_result to notify parent orchestrator.
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

# Check if report_result was called in the transcript
# The transcript is JSONL; MCP tool calls appear as {"type":"tool_use","name":"mcp__hgnucomb__report_result",...}
if grep -q '"name":"mcp__hgnucomb__report_result"' "$transcript_path" 2>/dev/null; then
  exit 0
fi

# Block: worker must report result before exiting
# JSON to STDOUT, exit 0 (per JSON API contract)
cat <<EOF
{"decision": "block", "reason": "Worker must call mcp__hgnucomb__report_result(parentId=\"${HGNUCOMB_PARENT_ID}\") before exiting. Your parent orchestrator is waiting for your result."}
EOF
exit 0
