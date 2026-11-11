/**
 * Stdio MCP server for the trigger test: the live tool list plus one arm's
 * instructions. Every call returns a stub, because the test only asks whether
 * the model reached for the connector.
 *
 * PRIOR ART: scripts/eval/mcp-latency-probe.mjs — it times the live server; this needs the instructions swapped per arm, so it cannot call production.
 */
import { readFileSync } from 'fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const [toolsFile, instructionsFile] = process.argv.slice(2);
const tools = JSON.parse(readFileSync(toolsFile, 'utf8'));
const server = new Server(
  { name: 'source-library', version: 'trigger-test' },
  { capabilities: { tools: {} }, instructions: readFileSync(instructionsFile, 'utf8').trim() },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async () => ({
  content: [{ type: 'text', text: '{"note":"test stub: no results"}' }],
}));
await server.connect(new StdioServerTransport());
