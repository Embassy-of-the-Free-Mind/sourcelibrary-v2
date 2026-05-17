import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';

// Static top-level routes (src/app/<slug>/page.tsx) need to be listed in
// NON_TENANT_PATHS, or the proxy treats them as unknown tenant slugs and
// 307-redirects to /. We've hit this three times in a row (/q, /for-libraries,
// /dmca) — this test fails loudly when the next page is added without the
// matching allowlist entry.

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const APP_DIR = path.join(PROJECT_ROOT, 'src/app');
const PROXY_PATH = path.join(PROJECT_ROOT, 'src/proxy.ts');

// Directories that are not user-facing routes or are intentionally handled
// elsewhere in the proxy (e.g. /embed/* and /api/* have their own branches).
const FRAMEWORK_DIRS = new Set([
  'api',
  'embed',
  '_archived',
]);

function extractNonTenantPaths(): Set<string> {
  const src = readFileSync(PROXY_PATH, 'utf8');
  const match = src.match(/const NON_TENANT_PATHS = new Set\(\[([\s\S]*?)\]\)/);
  if (!match) throw new Error('Could not locate NON_TENANT_PATHS in proxy.ts');
  return new Set([...match[1].matchAll(/'([^']+)'/g)].map(m => m[1]));
}

function findStaticTopLevelRoutes(): string[] {
  return readdirSync(APP_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(name => !name.startsWith('[')) // dynamic [param] routes
    .filter(name => !name.startsWith('_')) // private (_components etc.)
    .filter(name => !FRAMEWORK_DIRS.has(name))
    .filter(name => existsSync(path.join(APP_DIR, name, 'page.tsx'))
                 || existsSync(path.join(APP_DIR, name, 'route.ts')));
}

describe('proxy NON_TENANT_PATHS coverage', () => {
  it('every static top-level route in src/app/ is listed in NON_TENANT_PATHS', () => {
    const allowlist = extractNonTenantPaths();
    const routes = findStaticTopLevelRoutes();
    const missing = routes.filter(r => !allowlist.has(r));
    expect(missing, `Add these to NON_TENANT_PATHS in src/proxy.ts: ${missing.join(', ')}`).toEqual([]);
  });
});
