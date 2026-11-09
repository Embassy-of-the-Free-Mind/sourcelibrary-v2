import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// Protocol 2026-07-28 on /api/mcp (#8443). Claude Code and claude.ai open with
// `server/discover` under MCP-Protocol-Version 2026-07-28; the v1 SDK answered
// that with a 400, about 1 in 10 Claude connector calls. These pin that the
// modern era is served and that the 2025-era handshake still is.

vi.mock('@/lib/api-auth', () => ({
  withApiAuth: (h: (req: unknown, ctx: unknown, identity: unknown) => Promise<Response>) =>
    (req: unknown) => h(req, {}, { kind: 'anon' }),
}));

const MODERN = '2026-07-28';
const envelope = {
  'io.modelcontextprotocol/protocolVersion': MODERN,
  'io.modelcontextprotocol/clientInfo': { name: 'protocol-test', version: '1.0.0' },
  'io.modelcontextprotocol/clientCapabilities': {},
};

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://sourcelibrary.org/api/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function modern(id: number, method: string, params: Record<string, unknown> = {}, name?: string) {
  const headers: Record<string, string> = { 'mcp-protocol-version': MODERN, 'mcp-method': method };
  if (name) headers['mcp-name'] = name;
  return post({ jsonrpc: '2.0', id, method, params: { ...params, _meta: envelope } }, headers);
}

async function route() {
  const { POST } = await import('@/app/api/mcp/route');
  return POST as unknown as (r: NextRequest) => Promise<Response>;
}

describe('MCP protocol 2026-07-28', () => {
  beforeEach(() => vi.resetModules());

  it('answers server/discover with 2026-07-28 among the supported versions', async () => {
    const res = await (await route())(modern(1, 'server/discover'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.supportedVersions).toContain(MODERN);
    expect(body.result.capabilities.tools).toBeDefined();
    expect(body.result.capabilities.extensions?.['io.modelcontextprotocol/ui']).toBeDefined();
    expect(body.result.instructions).toMatch(/^Source Library: rare historical books/);
  });

  it('lists the same tools on both eras', async () => {
    const call = await route();
    const modernRes = await call(modern(2, 'tools/list'));
    expect(modernRes.status).toBe(200);
    const modernTools = (await modernRes.json()).result.tools;

    const legacyRes = await call(post(
      { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} },
      { 'mcp-protocol-version': '2025-11-25' },
    ));
    expect(legacyRes.status).toBe(200);
    const legacyTools = (await legacyRes.json()).result.tools;

    expect(modernTools.length).toBeGreaterThan(0);
    expect(modernTools).toEqual(legacyTools);
  });

  it('still completes the 2025-era initialize handshake at 2025-11-25 and 2025-06-18', async () => {
    const call = await route();
    for (const protocolVersion of ['2025-11-25', '2025-06-18']) {
      const res = await call(post({
        jsonrpc: '2.0', id: 4, method: 'initialize',
        params: { protocolVersion, capabilities: {}, clientInfo: { name: 'protocol-test', version: '1.0.0' } },
      }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.result.protocolVersion).toBe(protocolVersion);
      expect(body.result.serverInfo.name).toBe('source-library');
    }
  });

  it('keeps the refusal reason on a modern request the SDK rejects', async () => {
    // Header and envelope disagree: the spec's HeaderMismatch, a 400.
    const res = await (await route())(post(
      { jsonrpc: '2.0', id: 5, method: 'tools/list', params: { _meta: envelope } },
      { 'mcp-protocol-version': '2025-11-25', 'mcp-method': 'tools/list' },
    ));
    expect(res.status).toBe(400);
    expect(res.headers.get('x-sl-error-reason')).toMatch(/method=tools\/list \| proto=2025-11-25/);
  });
});
