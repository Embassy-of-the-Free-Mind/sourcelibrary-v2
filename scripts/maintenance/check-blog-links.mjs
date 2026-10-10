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
 * It also follows hard-coded quotation shortlinks (/q/<code>) wherever they
 * appear under src/ — the About page and the blog lab components cite pages
 * too. A shortlink encodes a book id and a page number, so it never changes,
 * but the book behind it can be hidden by a later sweep (rights review, a
 * duplicate merge, a broken-text hold), and then the reader lands on a 404.
 * Three such links were live for days in October 2026 (#6307).
 *
 * Usage:
 *   node scripts/maintenance/check-blog-links.mjs --all
 *   node scripts/maintenance/check-blog-links.mjs src/app/blog/foo/page.tsx [...]
 *
 * Options:
 *   --all                 Check every src/app/blog/⋆⋆/page.tsx, plus the
 *                         shortlinks in every source file under src/
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

const SRC_DIR = 'src';
const SOURCE_FILE = /\.(tsx?|mdx?)$/;

function allSourceFiles(dir = SRC_DIR, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'generated') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) allSourceFiles(p, out);
    else if (SOURCE_FILE.test(entry)) out.push(p);
  }
  return out;
}

const files = ALL ? [...new Set([...allBlogPages(), ...allSourceFiles()])] : args;
if (files.length === 0) {
  console.log('No files to check.');
  process.exit(ALL ? 2 : 0);
}

// Only literal string hrefs are checkable statically; template-literal hrefs
// (href={`/book/${id}`}) are skipped. Author links are excluded — the author
// page renders a shell for any name, so there's no not-found marker to detect.
const LINK_RE = /href="(\/(?:book|gallery\/image|collections)\/[^"]+)"/g;
// Shortlinks are matched anywhere in the file, not only in an href: posts
// print the link as visible text and components keep it in a data object.
// 15–26 base62 characters is every code src/lib/shortlinks.ts can produce.
const SHORTLINK_RE = /(?:https?:\/\/sourcelibrary\.org)?\/q\/([0-9A-Za-z]{15,26})(?![0-9A-Za-z])/g;
const isBlogPage = (file) => file.replace(/\\/g, '/').includes(`${BLOG_DIR}/`);

const links = new Map(); // path -> Set<sourceFile>
for (const file of files) {
  let src;
  try {
    src = readFileSync(file, 'utf8');
  } catch {
    console.error(`Cannot read ${file} — skipping`);
    continue;
  }
  // Deep links are checked in blog posts only (the original scope); shortlinks
  // in every file handed in.
  const found = [
    ...(isBlogPage(file) ? [...src.matchAll(LINK_RE)].map(m => m[1]) : []),
    ...[...src.matchAll(SHORTLINK_RE)].map(m => `/q/${m[1]}`),
  ];
  for (const path of found) {
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
const NOT_FOUND_BODY = '<title>Page Not Found</title>';
const NEXT_REDIRECT = /NEXT_REDIRECT;replace;([^;]+);30[78]/;

async function fetchBody(url, redirectsLeft = 3) {
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(25000),
    headers: { 'User-Agent': 'sourcelibrary-blog-link-check' },
  });
  // A hidden or missing book answers a real 404 (the shortlink's 302 lands on
  // it); the soft-404 title check below covers the routes that answer 200.
  if (res.status === 404) return NOT_FOUND_BODY;
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
  console.log('A /q/ link 404s when its book was hidden: find the visible copy, locate the passage');
  console.log('by text, check the page image, and mint the new code with encodeShortlink().');
  console.log('See .claude/handoffs/2026-07-04-link-integrity-visibility-drift.md for the playbook.');
  process.exit(1);
}

console.log(`\n✓ All ${links.size} links resolve.`);
