/**
 * Theme exports
 *
 * Available: Catppuccin Latte (light), Catppuccin Mocha (dark)
 * Currently using: Mocha
 */
export * from './catppuccin-mocha';

// Named exports for explicit theme selection
export * as latte from './catppuccin-latte';
export * as mocha from './catppuccin-mocha';

// Re-export current theme as default
export { palette as defaultPalette } from './catppuccin-mocha';
