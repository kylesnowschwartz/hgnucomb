#!/bin/bash
# capture-transcript-path.sh
#
# SessionStart hook: captures transcript_path from Claude Code stdin JSON.
# Writes to {worktree}/.hgnucomb-transcript-path for server-side discovery.
#
# The server polls for this file to start tailing the JSONL transcript,
# enabling real-time tool activity, todo progress, and context % in the HUD.

set -euo pipefail

# Non-interactive only (stdin must be piped JSON, not a terminal)
if [ -t 0 ]; then exit 0; fi

input=$(cat)
if [ -z "$input" ]; then exit 0; fi

transcript_path=$(echo "$input" | jq -r '.transcript_path // empty')
if [ -z "$transcript_path" ] || [ -z "${HGNUCOMB_WORKTREE:-}" ]; then exit 0; fi

echo "$transcript_path" >"${HGNUCOMB_WORKTREE}/.hgnucomb-transcript-path"
exit 0
