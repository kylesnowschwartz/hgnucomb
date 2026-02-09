/**
 * esbuild config for bundling server entry points.
 *
 * Produces two standalone ESM bundles in server/dist/:
 *   - index.js  (WebSocket server, static file serving)
 *   - mcp.js    (MCP server, spawned per-agent by Claude CLI)
 *
 * Both inline all dependencies (ws, zod, @modelcontextprotocol/sdk, shared/)
 * except node-pty which is a native addon and must be resolved at runtime.
 *
 * The createRequire banner is necessary because node-pty uses require()
 * internally, and our output format is ESM.
 */

import esbuild from "esbuild";

await esbuild.build({
  entryPoints: ["server/index.ts", "server/mcp.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outdir: "server/dist",
  external: ["node-pty"],
  sourcemap: true,
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
});
