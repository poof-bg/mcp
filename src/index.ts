#!/usr/bin/env node

import dotenv from 'dotenv';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer, configSchema } from './mcp.js';

dotenv.config();

async function main() {
  const apiKey = process.env.POOF_API_KEY;
  if (!apiKey) {
    console.error(
      'POOF_API_KEY is required. Get an API key at https://dash.poof.bg and set it in the environment.'
    );
    process.exit(1);
  }

  const config = configSchema.parse({
    poofApiKey: apiKey,
    debug: process.env.DEBUG === 'true',
  });

  const { server } = createMcpServer({ ...config, transport: 'stdio' });
  const transport = new StdioServerTransport();

  await server.connect(transport);
}

/**
 * True when this file is the entry point (`node dist/index.js`, `npx @poof-bg/mcp`,
 * a global install). Both sides are resolved through realpath so the check also
 * holds when the bin is invoked through the symlink npm creates in node_modules/.bin,
 * and file URLs are compared via the URL helpers so it works on Windows too.
 */
export function isMainModule(argv1: string | undefined = process.argv[1]): boolean {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

// Stdio is the default transport. The Streamable HTTP transport lives in
// worker.ts (Cloudflare Worker, run with `wrangler dev`/`wrangler deploy`).
// RUN_STDIO=true forces stdio when this module is imported rather than executed.
if (process.env.RUN_STDIO || isMainModule()) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export function createSandboxServer() {
  return createMcpServer({
    poofApiKey: process.env.POOF_API_KEY || 'sandbox-only',
    debug: false,
  }).server;
}

export default function () {
  return createSandboxServer();
}
