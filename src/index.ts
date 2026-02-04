#!/usr/bin/env node

import dotenv from 'dotenv';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer, configSchema } from './mcp.js';

dotenv.config();

async function main() {
  const config = configSchema.parse({
    poofApiKey: process.env.POOF_API_KEY,
    debug: process.env.DEBUG === 'true',
  });

  if (!config.poofApiKey) {
    console.error('Error: POOF_API_KEY environment variable is required. Get your API key at https://dash.poof.bg');
    process.exit(1);
  }

  const server = createMcpServer(config);
  const transport = new StdioServerTransport();

  await server.server.connect(transport);
  console.error('Poof MCP Server running in stdio mode');
}

if (process.env.RUN_STDIO) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export function createSandboxServer() {
  const server = createMcpServer({
    poofApiKey: 'sandbox-test-key',
    debug: false,
  });

  return server.server;
}

export default function () {
  return createSandboxServer();
}
