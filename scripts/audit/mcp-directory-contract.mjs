#!/usr/bin/env node
/**
 * MCP directory contract audit — the guard against being de-listed a second time.
 *
 * The Source Library connector was publicly listed in the Anthropic directory in
 * late April 2026, silently DE-LISTED in mid-May, and was not republished until
 * 2026-08-04 (approved 2026-07-31 as a community connector). Nobody told us why;
 * the two defects found and fixed in the meantime were:
 *
 *   1. Tool titles lived only in the deprecated `annotations.title`, so the
 *      top-level `Tool.title` field the directory validator reads was null
 *      (PR #2618).
 *   2. The server ADVERTISED OAuth via `.well-known/*` but never enforced it —
 *      unauthenticated `initialize` returned 200 and tokens were never validated.
 *      That advertise-but-don't-enforce hybrid reads as broken OAuth (PR #2621).
 *
 * Both are invisible from inside the codebase: the app works perfectly with either
 * defect present. Only a client speaking MCP over the wire can see them, which is
 * why this is a live audit rather than a unit test. Per
 * `.claude/docs/invariants/tests-that-are-not-guards.md`, a test that greps source
 * catches deletion and nothing else — and "the title moved back under annotations"
 * is not a deletion.
 *
 * That same invariant demands a negative control, so this file ships one:
 *
 *   node scripts/audit/mcp-directory-contract.mjs --self-test
 *
 * runs every shape predicate against deliberately broken fixtures and fails if a
 * predicate PASSES something it is supposed to catch. It needs no network, so CI
 * runs it on every PR; the live audit runs nightly.
 *
 * Live run:  node scripts/audit/mcp-directory-contract.mjs [baseUrl]
 *
 * The base URL is a real parameter, and a **Vercel preview URL works** — unlike
 * the tenant-lockdown audit, nothing here keys on the production hostname, so a
 * branch can be checked before it merges rather than the morning after:
 *
 *   npm run audit:mcp -- https://sourcelibrary-v2-git-<branch>-…vercel.app
 *
 * Do that on any PR touching src/app/api/mcp/**. Verified against a preview on
 * 2026-08-05: 14/14, identical to production.
 *
 * Exits 1 on any failure. Workflow: .github/workflows/mcp-directory-contract.yml
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const SELF_TEST = process.argv.includes('--self-test');
const BASE = (process.argv.find((a) => a.startsWith('http')) || process.env.MCP_AUDIT_BASE || 'https://sourcelibrary.org').replace(/\/$/, '');
const MCP_URL = `${BASE}/api/mcp`;

/**
 * The tool names the directory listing was reviewed against. ADDING a tool is
 * safe and needs no re-review — both listings store a pointer to /api/mcp, not a
 * snapshot, and clients call tools/list on connect. RENAMING or REMOVING one is
 * the single genuinely breaking change: it silently breaks saved Claude Projects
 * and any client holding the old name. So a missing name fails, and an extra name
 * only reports.
 */
const MANIFEST = JSON.parse(readFileSync(join(__dirname, 'mcp-directory-contract.tools.json'), 'utf8'));

// Advertising OAuth without enforcing it is what defect (2) was. These must NOT
// return 200 while `initialize` is open. If the connector ever does gate per user,
// rewrite this audit alongside — the failure mode then inverts.
const OAUTH_PATHS = [
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-authorization-server',
  '/oauth/authorize',
  '/oauth/token',
];

// A directory submission needs a reachable privacy policy and developer docs.
// /privacy-policy is a 404 — the live path is /privacy, and that has bitten before.
const REQUIRED_PAGES = ['/privacy', '/developers'];

const UA = 'Mozilla/5.0 (compatible; SourceLibrary-DirectoryContract/1.0)';

// ---------------------------------------------------------------------- predicates
//
// Each returns { ok, detail }. They take a parsed tools array so that the live
// audit and the self-test exercise the SAME code — a self-test against a
// reimplementation would prove nothing.

const PREDICATES = {
  topLevelTitle: (tools) => {
    // The validator reads the TOP-LEVEL title. annotations.title is the deprecated
    // location and its presence proves nothing, so this must not look at it.
    const bad = tools.filter((t) => typeof t.title !== 'string' || !t.title.trim());
    return { ok: bad.length === 0, detail: bad.length ? `missing on: ${bad.map((t) => t.name).join(', ')}` : `${tools.length}/${tools.length}` };
  },

  description: (tools) => {
    const bad = tools.filter((t) => typeof t.description !== 'string' || t.description.trim().length < 20);
    return { ok: bad.length === 0, detail: bad.length ? `too short/absent on: ${bad.map((t) => t.name).join(', ')}` : `${tools.length}/${tools.length}` };
  },

  inputSchema: (tools) => {
    const bad = tools.filter((t) => !t.inputSchema || t.inputSchema.type !== 'object');
    return { ok: bad.length === 0, detail: bad.length ? `bad on: ${bad.map((t) => t.name).join(', ')}` : `${tools.length}/${tools.length}` };
  },

  readOnlyHint: (tools) => {
    // A write tool claiming readOnlyHint:true is worse than one with no hint at
    // all — it tells a client the call is safe to make speculatively.
    const bad = tools.filter((t) => {
      const expected = MANIFEST.tools.find((m) => m.name === t.name);
      return expected ? t.annotations?.readOnlyHint !== expected.readOnly : false;
    });
    return { ok: bad.length === 0, detail: bad.length ? `wrong on: ${bad.map((t) => t.name).join(', ')}` : `${MANIFEST.tools.length} checked` };
  },

  noToolRemoved: (tools) => {
    const live = new Set(tools.map((t) => t.name));
    const missing = MANIFEST.tools.map((t) => t.name).filter((n) => !live.has(n));
    return {
      ok: missing.length === 0,
      detail: missing.length ? `GONE: ${missing.join(', ')} — this breaks saved Claude Projects` : `${MANIFEST.tools.length} present`,
    };
  },
};

const results = [];
function record(ok, name, detail) {
  results.push({ ok, name, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// --------------------------------------------------------------------- self-test
//
// A green audit is worthless until each predicate has been shown to go red. These
// fixtures are mutations of the real captured shape, one defect each.

function goodTool(name, readOnly) {
  return {
    name,
    title: 'A Title',
    description: 'A description long enough to be substantive for the validator.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { title: 'A Title', readOnlyHint: readOnly },
  };
}

function selfTest() {
  const base = MANIFEST.tools.map((t) => goodTool(t.name, t.readOnly));
  const writeTool = MANIFEST.tools.find((t) => !t.readOnly).name;

  const cases = [
    ['topLevelTitle', 'accepts a healthy set', base, true],
    ['topLevelTitle', 'catches title absent', base.map((t, i) => (i === 0 ? { ...t, title: undefined } : t)), false],
    ['topLevelTitle', 'catches title empty/whitespace', base.map((t, i) => (i === 0 ? { ...t, title: '  ' } : t)), false],
    // The exact 2026-05 de-list shape: title present, but ONLY under annotations.
    ['topLevelTitle', 'catches title only under annotations (the 2026-05 defect)', base.map((t) => ({ ...t, title: undefined, annotations: { ...t.annotations, title: 'Looks Fine' } })), false],
    ['description', 'accepts a healthy set', base, true],
    ['description', 'catches a stub description', base.map((t, i) => (i === 0 ? { ...t, description: 'todo' } : t)), false],
    ['inputSchema', 'accepts a healthy set', base, true],
    ['inputSchema', 'catches a missing inputSchema', base.map((t, i) => (i === 0 ? { ...t, inputSchema: undefined } : t)), false],
    ['readOnlyHint', 'accepts a healthy set', base, true],
    ['readOnlyHint', 'catches a write tool claiming readOnlyHint:true', base.map((t) => (t.name === writeTool ? { ...t, annotations: { ...t.annotations, readOnlyHint: true } } : t)), false],
    ['noToolRemoved', 'accepts a healthy set', base, true],
    ['noToolRemoved', 'catches a removed tool', base.slice(1), false],
    ['noToolRemoved', 'catches a renamed tool', base.map((t, i) => (i === 0 ? { ...t, name: `${t.name}_v2` } : t)), false],
    ['noToolRemoved', 'allows an added tool', [...base, goodTool('brand_new_tool', true)], true],
  ];

  for (const [key, label, fixture, expectOk] of cases) {
    const got = PREDICATES[key](fixture).ok;
    record(got === expectOk, `self-test: ${key} ${label}`, got === expectOk ? '' : `predicate returned ok=${got}, expected ${expectOk}`);
  }
}

// -------------------------------------------------------------------- live audit

async function rpc(method, params) {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'User-Agent': UA },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) }),
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // Streamable HTTP may answer as SSE; take the first data: frame.
    const frame = text.split('\n').find((l) => l.startsWith('data:'));
    if (frame) body = JSON.parse(frame.slice(5).trim());
  }
  return { status: res.status, body, raw: text };
}

async function statusOf(path) {
  const res = await fetch(`${BASE}${path}`, { method: 'GET', headers: { 'User-Agent': UA }, redirect: 'manual' });
  return res.status;
}

async function liveAudit() {
  const init = await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'directory-contract-audit', version: '1.0' },
  });
  const serverInfo = init.body?.result?.serverInfo;
  record(
    init.status === 200 && !!serverInfo,
    'initialize answers unauthenticated',
    `HTTP ${init.status}${serverInfo ? `, ${serverInfo.name} ${serverInfo.version}` : `, body: ${init.raw.slice(0, 160)}`}`
  );

  // Two independent listings exist (see .claude/docs/mcp-registry-publish.md); the
  // registry one is driven by server.json. It silently drifted to 4.3.2 while the
  // route served 4.4.0, so pin them together.
  const serverJson = JSON.parse(readFileSync(join(REPO_ROOT, 'server.json'), 'utf8'));
  record(
    serverInfo ? serverJson.version === serverInfo.version : false,
    'server.json version matches the live server',
    `server.json ${serverJson.version} vs live ${serverInfo?.version ?? '?'}`
  );

  const list = await rpc('tools/list');
  const tools = list.body?.result?.tools;
  record(
    list.status === 200 && Array.isArray(tools) && tools.length > 0,
    'tools/list answers unauthenticated',
    `HTTP ${list.status}, ${Array.isArray(tools) ? tools.length : 0} tools`
  );

  if (Array.isArray(tools)) {
    const checks = [
      ['topLevelTitle', 'every tool carries a non-empty top-level Tool.title'],
      ['description', 'every tool carries a substantive description'],
      ['inputSchema', 'every tool carries an object inputSchema'],
      ['readOnlyHint', 'readOnlyHint matches the manifest for every known tool'],
      ['noToolRemoved', 'no manifest tool has been renamed or removed'],
    ];
    for (const [key, label] of checks) {
      const { ok, detail } = PREDICATES[key](tools);
      record(ok, label, detail);
    }

    const extra = tools.map((t) => t.name).filter((n) => !MANIFEST.tools.some((t) => t.name === n));
    if (extra.length) {
      console.log(`NOTE  new tools not in the manifest: ${extra.join(', ')} — additive and safe; add them to mcp-directory-contract.tools.json`);
    }
  }

  for (const path of OAUTH_PATHS) {
    const status = await statusOf(path);
    record(
      status !== 200,
      `no OAuth advertisement at ${path}`,
      `HTTP ${status}${status === 200 ? ' — advertising OAuth while initialize is open is the hybrid that de-listed us' : ''}`
    );
  }

  for (const path of REQUIRED_PAGES) {
    const status = await statusOf(path);
    record(status === 200, `${path} is reachable`, `HTTP ${status}`);
  }
}

// ------------------------------------------------------------------------ verdict

if (SELF_TEST) {
  console.log('Negative controls for every shape predicate (no network):\n');
  selfTest();
} else {
  await liveAudit();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${SELF_TEST ? ' (self-test)' : ` against ${BASE}`}`);
if (failed.length) {
  console.log(`\nFAILED: ${failed.map((f) => f.name).join('; ')}`);
  process.exit(1);
}
