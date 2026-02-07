/**
 * Image storage for drag-and-drop terminal image paste.
 * Saves images to agent worktrees or session scratchpads.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Save a base64-encoded image for a terminal session.
 *
 * Storage strategy:
 * - Claude agents (orchestrator/worker): Save to agent's worktree in images/ subdirectory
 * - Plain terminals: Save to session-specific scratchpad
 *
 * @param agentId - Agent ID if this is a Claude agent session, undefined for plain terminals
 * @param sessionId - Session ID for scratchpad isolation
 * @param filename - Original filename from browser
 * @param base64Data - Base64-encoded image data (with data: prefix)
 * @returns Absolute path to the saved image file
 */
export function saveImageForSession(
  agentId: string | undefined,
  sessionId: string,
  filename: string,
  base64Data: string
): string {
  // Extract base64 content (remove data:image/png;base64, prefix if present)
  const base64Content = base64Data.includes(',')
    ? base64Data.split(',')[1]
    : base64Data;
  const buffer = Buffer.from(base64Content, 'base64');

  // Determine save location based on agent context
  let savePath: string;

  if (agentId) {
    // Claude agent - save to worktree
    const repoRoot = resolve(process.cwd());
    const worktreePath = join(repoRoot, '.worktrees', agentId);
    const imagesDir = join(worktreePath, 'images');

    if (!existsSync(imagesDir)) {
      mkdirSync(imagesDir, { recursive: true });
    }

    const timestamp = Date.now();
    const safeName = sanitizeFilename(`${timestamp}-${filename}`);
    savePath = join(imagesDir, safeName);
  } else {
    // Plain terminal - save to scratchpad
    const scratchpadRoot = process.env.SCRATCHPAD_DIR || '/tmp/hgnucomb-scratchpad';
    const sessionDir = join(scratchpadRoot, sessionId);

    if (!existsSync(sessionDir)) {
      mkdirSync(sessionDir, { recursive: true });
    }

    const timestamp = Date.now();
    const safeName = sanitizeFilename(`${timestamp}-${filename}`);
    savePath = join(sessionDir, safeName);
  }

  writeFileSync(savePath, buffer);
  return savePath;
}

/**
 * Sanitize a filename to remove potentially problematic characters.
 * Allows: alphanumeric, dots, hyphens, underscores
 */
function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9.-]/g, '_');
}
