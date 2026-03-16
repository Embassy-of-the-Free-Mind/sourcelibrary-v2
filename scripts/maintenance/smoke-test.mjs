#!/usr/bin/env node
/**
 * Smoke test: hit every page route and report failures.
 *
 * Usage:
 *   node scripts/maintenance/smoke-test.mjs [base-url]
 *
 * Default base URL: latest Vercel preview for current branch.
 * Example: node scripts/maintenance/smoke-test.mjs https://sourcelibrary-v2-abc123.vercel.app
 *
 * What it checks:
 *   - Every static page route returns 200 (or 302 for auth-gated pages)
 *   - No 500 errors (server-side rendering crashes)
 *   - Response time under 10s
 *
 * What it skips:
 *   - Dynamic routes like /book/[slug] (needs real data)
 *   - Auth-gated pages (302 is OK)
 *   - Admin pages (may require auth)
 */

import { execSync } from 'child_process';
import { readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

// ── Discover routes from filesystem ──

function findPages(dir, routes = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry.startsWith('_') || entry === 'node_modules') continue;
    if (statSync(full).isDirectory()) {
      findPages(full, routes);
    } else if (entry === 'page.tsx' || entry === 'page.ts') {
      const rel = relative('src/app', dir);
      const route = '/' + rel.replace(/\\/g, '/');
      routes.push(route);
    }
  }
  return routes;
}

const allRoutes = findPages('src/app');

// Filter out dynamic routes (contain [param])
const staticRoutes = allRoutes.filter(r => !r.includes('['));

// Known sample dynamic routes to test with real data
const sampleDynamicRoutes = [
  '/collections/alchemy',
  '/collections/hermetica',
  '/search?q=paracelsus',
  '/gallery',
  '/data',
  '/data?admin=true',
];

const routes = [...staticRoutes, ...sampleDynamicRoutes];

// ── Resolve base URL ──

let baseUrl = process.argv[2];

if (!baseUrl) {
  // Try to get the latest Vercel preview URL
  try {
    const branch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
    console.log(`Branch: ${branch}`);

    // Use vercel CLI to get latest deployment
    const out = execSync(`vercel ls --scope=sourcelibrary-v2 2>/dev/null | head -5`, {
      encoding: 'utf8',
      timeout: 10000
    }).trim();
    console.log('Recent deployments:', out);
  } catch {
    // fallback
  }

  if (!baseUrl) {
    console.error('Usage: node scripts/maintenance/smoke-test.mjs <base-url>');
    console.error('Example: node scripts/maintenance/smoke-test.mjs https://sourcelibrary-v2-git-dev-prototype.vercel.app');
    process.exit(1);
  }
}

baseUrl = baseUrl.replace(/\/$/, '');

// ── Run tests ──

const CONCURRENCY = 5;
const TIMEOUT = 10000;

const results = { pass: 0, fail: 0, skip: 0, errors: [] };

async function testRoute(route) {
  const url = `${baseUrl}${route}`;
  const start = Date.now();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);

    const res = await fetch(url, {
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'User-Agent': 'SourceLibrary-SmokeTest/1.0' },
    });
    clearTimeout(timer);

    const elapsed = Date.now() - start;
    const status = res.status;

    if (status === 200) {
      // Check for React error boundaries in the HTML
      const text = await res.text();
      if (text.includes('Application error') || text.includes('Internal Server Error')) {
        results.fail++;
        results.errors.push({ route, status, elapsed, error: 'Error boundary triggered' });
        console.log(`  FAIL  ${status}  ${elapsed}ms  ${route}  (error boundary)`);
      } else {
        results.pass++;
        if (elapsed > 3000) {
          console.log(`  SLOW  ${status}  ${elapsed}ms  ${route}`);
        }
      }
    } else if (status === 302 || status === 307 || status === 308) {
      // Redirects are OK (auth pages, etc.)
      results.skip++;
    } else if (status >= 500) {
      results.fail++;
      results.errors.push({ route, status, elapsed, error: `HTTP ${status}` });
      console.log(`  FAIL  ${status}  ${elapsed}ms  ${route}`);
    } else if (status === 404) {
      results.fail++;
      results.errors.push({ route, status, elapsed, error: 'Not found' });
      console.log(`  FAIL  ${status}  ${elapsed}ms  ${route}`);
    } else {
      results.skip++;
    }
  } catch (err) {
    results.fail++;
    const elapsed = Date.now() - start;
    const msg = err.name === 'AbortError' ? 'Timeout (>10s)' : err.message;
    results.errors.push({ route, status: 0, elapsed, error: msg });
    console.log(`  FAIL  ---  ${elapsed}ms  ${route}  (${msg})`);
  }
}

async function runBatch(routes, concurrency) {
  for (let i = 0; i < routes.length; i += concurrency) {
    const batch = routes.slice(i, i + concurrency);
    await Promise.all(batch.map(testRoute));
  }
}

console.log(`\nSmoke testing ${routes.length} routes against ${baseUrl}\n`);

await runBatch(routes, CONCURRENCY);

console.log(`\n${'─'.repeat(50)}`);
console.log(`  Pass: ${results.pass}  |  Fail: ${results.fail}  |  Skip: ${results.skip}`);

if (results.errors.length > 0) {
  console.log(`\nFailed routes:`);
  for (const e of results.errors) {
    console.log(`  ${e.route} → ${e.error}`);
  }
  process.exit(1);
}

console.log('\nAll routes healthy.');
