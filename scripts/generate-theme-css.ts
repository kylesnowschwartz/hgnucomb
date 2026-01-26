#!/usr/bin/env tsx
/**
 * Generates CSS custom properties from the active TypeScript theme.
 * Run: npx tsx scripts/generate-theme-css.ts
 *
 * Single source of truth: src/theme/catppuccin-*.ts
 * Output: src/generated/theme.css
 */

import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Change this import to switch themes
import { palette } from '../src/theme/catppuccin-mocha';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '../src/generated/theme.css');

function toKebabCase(str: string): string {
  // Convert camelCase to kebab-case, but keep numbers attached (subtext1 stays subtext1)
  return str.replace(/([A-Z])/g, '-$1').toLowerCase();
}

function generateCSS(): string {
  const lines: string[] = [
    '/**',
    ' * AUTO-GENERATED - Do not edit directly',
    ' * Source: scripts/generate-theme-css.ts',
    ' * Theme: catppuccin-mocha',
    ' */',
    '',
    ':root {',
  ];

  for (const [key, value] of Object.entries(palette)) {
    const cssVar = `--ctp-${toKebabCase(key)}`;
    lines.push(`  ${cssVar}: ${value};`);
  }

  lines.push('}', '');

  return lines.join('\n');
}

// Ensure output directory exists
mkdirSync(dirname(OUTPUT_PATH), { recursive: true });

// Write CSS
const css = generateCSS();
writeFileSync(OUTPUT_PATH, css);

console.log(`Generated: ${OUTPUT_PATH}`);
