/**
 * Image storage for drag-and-drop terminal image paste.
 * Saves images to agent worktrees or session scratchpads.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import type { TerminalSession } from './session.ts';

/**
 * Save a base64-encoded image for a terminal session.
 *
 * Storage strategy:
 * - Claude agents (orchestrator/worker): Save to agent's worktree in images/ subdirectory
 * - Plain terminals: Save to session-specific scratchpad
 *
 * @param session - The terminal session context
 * @param filename - Original filename from browser
 * @param base64Data - Base64-encoded image data (with data: prefix)
 * @returns Absolute path to the saved image file
 */
export function saveImageForSession(
  session: TerminalSession,
  filename: string,
  base64Data: string
): string {
  // Extract base64 content (remove data:image/png;base64, prefix if present)
  const base64Content = base64Data.includes(',')
    ? base64Data.split(',')[1]
    : base64Data;
  const buffer = Buffer.from(base64Content, 'base64');

  // Determine save location based on agent context
  const agentId = session.env?.HGNUCOMB_AGENT_ID;
  let savePath: string;

  if (agentId) {
    // Claude agent - save to worktree
    // Worktree path is derived from agent ID (see worktree.ts)
    const repoRoot = resolve(process.cwd());
    const worktreePath = join(repoRoot, '.worktrees', agentId);
    const imagesDir = join(worktreePath, 'images');

    // Create images directory if it doesn't exist
    if (!existsSync(imagesDir)) {
      mkdirSync(imagesDir, { recursive: true });
    }

    // Generate safe filename with timestamp to avoid collisions
    const timestamp = Date.now();
    const safeName = sanitizeFilename(`${timestamp}-${filename}`);
    savePath = join(imagesDir, safeName);
  } else {
    // Plain terminal - save to scratchpad
    // Use session ID to isolate images per session
    const scratchpadRoot = process.env.SCRATCHPAD_DIR || '/tmp/hgnucomb-scratchpad';
    const sessionDir = join(scratchpadRoot, session.sessionId);

    // Create session directory if it doesn't exist
    if (!existsSync(sessionDir)) {
      mkdirSync(sessionDir, { recursive: true });
    }

    const timestamp = Date.now();
    const safeName = sanitizeFilename(`${timestamp}-${filename}`);
    savePath = join(sessionDir, safeName);
  }

  // Write the image file
  writeFileSync(savePath, buffer);

  return savePath;
}

/**
 * Sanitize a filename to remove potentially problematic characters.
 * Allows: alphanumeric, dots, hyphens, underscores
 * Replaces everything else with underscores.
 */
function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9.-]/g, '_');
}
