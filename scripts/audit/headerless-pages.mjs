#!/usr/bin/env node
/**
 * Report public routes whose page renders no site header.
 *
 * A page "has a header" if page.tsx — or anything it imports, two levels
 * deep — references SiteHeader, ContentPageLayout, or ContentHeader.
 * Routes on the KNOWN_MINIMAL list are deliberately chromeless (immersive
 * readers, auth flows, bespoke-identity pages, internal tools) and are not
 * reported. Everything else without a header is a leak: a visitor landing
 * there (usually from a shared link) gets no nav, no search, no sign-in.
 *
 * Usage: node scripts/audit/headerless-pages.mjs [--strict]
 *   --strict  exit 1 if any unexpected headerless route is found (CI use)
 *
 * Context: issue #3179.
 */
import fs from 'node:fs';
import path from 'node:path';

const HDR = /SiteHeader|ContentPageLayout|ContentHeader/;

// Deliberately minimal routes (prefix match). Add here ONLY with a reason.
const KNOWN_MINIMAL = [
  '/[tenant]', // tenant surfaces have their own header policy
  '/adopt/certificate', // printable certificate
  '/auth', '/es/auth', '/login', '/unauthorized', // auth flows
  '/beta', // conversion landing page — chromeless by design
  '/book/[id]/page/[pageId]', // immersive reader
  '/book/[id]/capture', '/book/[id]/edition', '/book/[id]/guide',
  '/book/[id]/overview', '/book/[id]/pipeline', '/book/[id]/qa',
  '/book/[id]/search', '/book/[id]/split', '/book/[id]/summary', // internal book tools
  '/brand', '/design-options', '/prototype', // design sandboxes
  '/collections/jung-resonances', // BPH-tenant-gated (tenant lockdown)
  '/experiments', '/research', '/review', '/qa', '/scan',
  '/processing', '/traffic', '/taxonomy', '/fulldata', '/analytics',
  '/feedback', '/jobs', // internal/admin tools
  '/ficino-society', // bespoke standalone identity (own chrome)
  '/gallery/curate', '/gallery/review', // curation tools
  '/gallery/image/[id]', // immersive image viewer
  '/hieroglyphs', '/tablets', // data-less demos (corpus files absent)
  '/librarian/voice', // full-screen voice UI
  '/press-release', // redirect
  '/status', // bare terminal-style status page (statuspage convention)
];

const pages = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (/_archived|\/embed$|\/platform$|\/admin$|\/api$/.test(p)) continue;
      walk(p);
    } else if (e.name === 'page.tsx') pages.push(p);
  }
})('src/app');

function resolve(spec, fromFile) {
  const base = spec.startsWith('@/')
    ? path.join('src', spec.slice(2))
    : spec.startsWith('.')
      ? path.join(path.dirname(fromFile), spec)
      : null;
  if (!base) return null;
  for (const c of [base + '.tsx', base + '.ts', path.join(base, 'index.tsx')]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

function hasHeader(file, depth, seen) {
  if (depth > 2 || seen.has(file)) return false;
  seen.add(file);
  let src;
  try { src = fs.readFileSync(file, 'utf8'); } catch { return false; }
  if (HDR.test(src)) return true;
  for (const m of src.matchAll(/from ["']([^"']+)["']/g)) {
    const f = resolve(m[1], file);
    if (f && hasHeader(f, depth + 1, seen)) return true;
  }
  return false;
}

// Redirect-only pages (e.g. /browse/artists → /browse/artists/A) never render.
function isRedirectOnly(file) {
  const src = fs.readFileSync(file, 'utf8');
  return /\bredirect\(/.test(src) && !/return\s*\(/.test(src);
}

const missing = pages
  .map((p) => ({ p, route: p.replace(/^src\/app/, '').replace(/\/page\.tsx$/, '') || '/' }))
  .filter(({ p }) => !isRedirectOnly(p) && !hasHeader(p, 0, new Set()))
  .filter(({ route }) => !KNOWN_MINIMAL.some((k) => route === k || route.startsWith(k + '/')));

if (missing.length === 0) {
  console.log('All public routes render a site header (or are on the known-minimal list).');
} else {
  console.log(`${missing.length} public route(s) with NO site header:\n`);
  for (const { route } of missing) console.log('  ' + route);
  console.log('\nAdd <SiteHeader /> (or ContentHeader), or add to KNOWN_MINIMAL with a reason.');
  if (process.argv.includes('--strict')) process.exit(1);
}
