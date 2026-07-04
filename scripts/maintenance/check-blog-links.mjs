#!/usr/bin/env node
/**
 * Blog deep-link checker — catches soft-404s in hardcoded blog links.
 *
 * Blog posts hardcode /book/, /gallery/image/ and /collections/ hrefs, and
 * those rot silently: books get deleted (copyright cleanups), slugs change,
 * ids get typo'd. Because Next.js soft-404s (HTTP 200 with a "… Not Found"
 * body), status-code checks are useless — this script fetches each link and
 * greps the rendered <title> for the not-found markers instead. See issue
 * #2959 (51 dead links across 9 posts) and the cannabis-essay incident
 * (PRs #2584/#2587) for why this exists.
 *
 * Usage:
 *   node scripts/maintenance/check-blog-links.mjs --all
 *   node scripts/maintenance/check-blog-links.mjs src/app/blog/foo/page.tsx [...]
 *
 * Options:
 *   --all                 Check every src/app/blog/⋆⋆/page.tsx
 *   --base-url <url>      Target site (default https://sourcelibrary.org)
 *   --concurrency <n>     Parallel fetches (default 8)
 *
 * Exit codes: 0 = all links resolve (network warnings don't fail),
 *             1 = at least one broken link, 2 = usage error.
 *
 * No dependencies — safe to run in CI on fork PRs (no secrets needed).
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const args = process.argv.slice(2);
const getOpt = (name, dflt) => {
  const i = args.indexOf(name);
  if (i === -1) return dflt;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const BASE_URL = (getOpt('--base-url', 'https://sourcelibrary.org')).replace(/\/$/, '');
const CONCURRENCY = parseInt(getOpt('--concurrency', '8'), 10);
const ALL = args.includes('--all');
if (ALL) args.splice(args.indexOf('--all'), 1);

const BLOG_DIR = 'src/app/blog';

function allBlogPages(dir = BLOG_DIR, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) allBlogPages(p, out);
    else if (entry === 'page.tsx') out.push(p);
  }
  return out;
}

const files = ALL ? allBlogPages() : args;
if (files.length === 0) {
  console.log('No files to check.');
  process.exit(ALL ? 2 : 0);
}

// Only literal string hrefs are checkable statically; template-literal hrefs
// (href={`/book/${id}`}) are skipped. Author links are excluded — the author
// page renders a shell for any name, so there's no not-found marker to detect.
const LINK_RE = /href="(\/(?:book|gallery\/image|collections)\/[^"]+)"/g;

const links = new Map(); // path -> Set<sourceFile>
for (const file of files) {
  let src;
  try {
    src = readFileSync(file, 'utf8');
  } catch {
    console.error(`Cannot read ${file} — skipping`);
    continue;
  }
  for (const m of src.matchAll(LINK_RE)) {
    const path = m[1];
    if (!links.has(path)) links.set(path, new Set());
    links.get(path).add(file);
  }
}

console.log(`Checking ${links.size} unique links from ${files.length} file(s) against ${BASE_URL}\n`);
if (links.size === 0) process.exit(0);

// Soft-404 markers rendered into <title> by the dynamic routes.
const NOT_FOUND = /<title>[^<]*(Book Not Found|Page Not Found|Image Not Found|Collection Not Found)/i;
// Streamed server redirect (routes with a loading.tsx boundary emit the
// redirect as an in-body instruction with HTTP 200 — follow it once).
const NEXT_REDIRECT = /NEXT_REDIRECT;replace;([^;]+);30[78]/;

async function fetchBody(url, redirectsLeft = 3) {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(25000),
    headers: { 'User-Agent': 'sourcelibrary-blog-link-check' },
  });
  const body = await res.text();
  const streamed = body.match(NEXT_REDIRECT);
  if (streamed && redirectsLeft > 0) {
    return fetchBody(new URL(streamed[1], BASE_URL).href, redirectsLeft - 1);
  }
  return body;
}

async function checkLink(path) {
  const url = `${BASE_URL}${path}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const body = await fetchBody(url);
      if (!body) throw new Error('empty body');
      return NOT_FOUND.test(body) ? 'broken' : 'ok';
    } catch (err) {
      if (attempt === 1) return `error: ${err.message || err}`;
      await new Promise(r => setTimeout(r, 1500));
    }
  }
}

const paths = [...links.keys()];
const broken = [];
const warnings = [];
let done = 0;

await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, paths.length) }, async () => {
    while (paths.length > 0) {
      const path = paths.shift();
      const result = await checkLink(path);
      done++;
      if (result === 'broken') broken.push(path);
      else if (result !== 'ok') warnings.push(`${path} (${result})`);
      if (done % 50 === 0) console.log(`  …${done}/${links.size}`);
    }
  })
);

if (warnings.length > 0) {
  console.log(`\n⚠ ${warnings.length} link(s) could not be checked (network):`);
  for (const w of warnings) console.log(`  ${w}`);
}

if (broken.length > 0) {
  console.log(`\n✗ ${broken.length} BROKEN link(s):\n`);
  for (const path of broken.sort()) {
    console.log(`  ${BASE_URL}${path}`);
    for (const f of links.get(path)) console.log(`    in ${f}`);
  }
  console.log('\nFix by relinking to a held edition, or unlink (keep the title as plain text).');
  console.log('See .claude/handoffs/2026-07-04-link-integrity-visibility-drift.md for the playbook.');
  process.exit(1);
}

console.log(`\n✓ All ${links.size} links resolve.`);
