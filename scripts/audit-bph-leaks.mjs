#!/usr/bin/env node
/**
 * BPH lockdown audit — crawls a tenant subdomain and reports any link
 * that escapes back to the main sourcelibrary.org site.
 *
 * Usage:
 *   node scripts/audit-bph-leaks.mjs                          # crawls https://bph.sourcelibrary.org
 *   node scripts/audit-bph-leaks.mjs https://bph.sourcelibrary.org
 *   BPH_AUDIT_DEPTH=3 BPH_AUDIT_MAX=100 node scripts/audit-bph-leaks.mjs
 *
 * Exits 0 when no leaks are found; non-zero when leaks are detected. Wire
 * into CI to keep the BPH subdomain pure.
 *
 * What "leak" means here:
 *   - An <a href> that resolves to sourcelibrary.org (or any apex/www host
 *     other than the tenant subdomain) is flagged. Visitors on the BPH
 *     subdomain must never have a one-click escape into the wider library.
 *   - An HTTP redirect (302/301) to a non-tenant host on the first hop is
 *     flagged. The /gallery → sourcelibrary.org bug we shipped early on
 *     was exactly this.
 *   - A 200 response whose body carries Next.js's `NEXT_HTTP_ERROR_FALLBACK`
 *     marker is flagged. That's the silent-failure mode that bit the Bhutan
 *     promotion: the route called notFound() inside a streaming Suspense
 *     boundary, so the response status was already 200 by the time Next.js
 *     decided to render the not-found UI. From outside, it looks like a
 *     working page; the only signal is the marker baked into the HTML.
 *
 * Out of scope (manual audit needed): verifying that every book.id rendered
 * on a page belongs to the tenant. Doable by parsing /book/<id> links and
 * checking each book's tenantId via the API; not implemented here to keep
 * the script offline-friendly.
 */

const TARGET = (process.argv[2] || 'https://bph.sourcelibrary.org').replace(/\/+$/, '');
const MAX_DEPTH = Number(process.env.BPH_AUDIT_DEPTH || 2);
const MAX_PAGES = Number(process.env.BPH_AUDIT_MAX || 60);

const targetUrl = new URL(TARGET);
const TENANT_HOST = targetUrl.host.toLowerCase();

// Hosts that are explicitly OK to link to from the tenant subdomain.
// Image CDNs, third-party DOI/IIIF endpoints, etc. live here.
const ALLOWED_EXTERNAL = new Set([
  'images.sourcelibrary.org',
  'doi.org',
  'creativecommons.org',
  'iconclass.org',
  'chineseiconography.org',
  'github.com',
  'twitter.com',
  'x.com',
  'mail.google.com',
]);

// Hosts that explicitly count as a leak — links here from a tenant subdomain
// dump the visitor out of the tenant context.
const LEAK_HOSTS = new Set([
  'sourcelibrary.org',
  'www.sourcelibrary.org',
]);

function classifyHref(href, fromUrl) {
  if (!href) return null;
  if (href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('#')) {
    return null;
  }
  let url;
  try {
    url = new URL(href, fromUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.host.toLowerCase();
  if (host === TENANT_HOST) return { url, kind: 'same-origin' };
  if (LEAK_HOSTS.has(host)) return { url, kind: 'leak' };
  if (ALLOWED_EXTERNAL.has(host)) return { url, kind: 'allowed-external' };
  return { url, kind: 'external' };
}

const ANCHOR_RE = /<a\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)')/gi;

function extractHrefs(html) {
  const out = [];
  let m;
  while ((m = ANCHOR_RE.exec(html)) !== null) {
    out.push(m[2] ?? m[3] ?? '');
  }
  return out;
}

const visited = new Set();
const queue = [];
const leaks = [];        // { fromUrl, href, resolved }
const redirectLeaks = []; // { fromUrl, redirectedTo }
const silentNotFounds = []; // { url } — 200 response carrying notFound() fallback
let pagesFetched = 0;

// Next.js stamps this digest into the streamed HTML when a server component
// inside a Suspense boundary throws notFound() after the response status was
// already committed. The body shows the not-found UI but the status stays 200,
// so a normal crawler thinks everything is fine.
const NEXT_NOTFOUND_MARKER = 'NEXT_HTTP_ERROR_FALLBACK;404';

// Seed paths to probe explicitly. The BPH UI doesn't render anchors for some
// of these (e.g. /gallery), so a pure link-crawler would miss the redirect bug.
// Visitors reach them by typing them, following SEO-indexed external links, or
// via legacy share URLs. If proxy.ts ever regresses to redirecting one of these
// off-subdomain, the audit fires.
const SEED_PATHS = [
  '/',
  '/gallery',
  '/gallery/image/anything',
  '/search',
  '/catalog',
  '/collections',
  '/browse',
  '/explore',
  '/artwork',
];
for (const p of SEED_PATHS) queue.push({ url: TARGET + p, depth: 0 });

async function fetchPage(url) {
  // manual: catch one-hop redirects to off-domain hosts (the gallery bug)
  const res = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'BPH-Lockdown-Audit/1.0' } });
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location');
    if (loc) {
      const classification = classifyHref(loc, url);
      if (classification?.kind === 'leak') {
        // Record and STOP — following the redirect would count every link on
        // the off-subdomain page as a fresh leak, drowning the real signal.
        redirectLeaks.push({ fromUrl: url, redirectedTo: classification.url.toString() });
        return { html: '', finalUrl: url, skipped: true };
      }
      // Same-origin or allowed-external redirect — follow once and crawl normally
      const followed = await fetch(classification?.url?.toString() || loc, {
        redirect: 'follow',
        headers: { 'User-Agent': 'BPH-Lockdown-Audit/1.0' },
      });
      return { html: await followed.text(), finalUrl: followed.url };
    }
  }
  return { html: await res.text(), finalUrl: res.url };
}

while (queue.length > 0 && pagesFetched < MAX_PAGES) {
  const { url, depth } = queue.shift();
  if (visited.has(url)) continue;
  visited.add(url);
  pagesFetched++;

  let page;
  try {
    page = await fetchPage(url);
  } catch (err) {
    process.stderr.write(`fetch failed: ${url} — ${err?.message || err}\n`);
    continue;
  }

  // Silent 200-body-with-404-inside check. Has to run on every page because
  // a route can render fine on the surface (real title, real meta tags) while
  // the actual page body is the not-found fallback skeleton. Skip pages we
  // didn't actually fetch (e.g. redirect leaks).
  if (!page.skipped && page.html && page.html.includes(NEXT_NOTFOUND_MARKER)) {
    silentNotFounds.push({ url: page.finalUrl || url });
  }

  const hrefs = extractHrefs(page.html);
  for (const href of hrefs) {
    const classified = classifyHref(href, page.finalUrl);
    if (!classified) continue;
    if (classified.kind === 'leak') {
      leaks.push({ fromUrl: url, href, resolved: classified.url.toString() });
    } else if (classified.kind === 'same-origin' && depth < MAX_DEPTH) {
      const next = classified.url.toString().split('#')[0];
      if (!visited.has(next)) queue.push({ url: next, depth: depth + 1 });
    }
  }
}

const totalLeaks = leaks.length + redirectLeaks.length;
const totalIssues = totalLeaks + silentNotFounds.length;
process.stdout.write(`\nBPH lockdown audit\n`);
process.stdout.write(`  base:           ${TARGET}\n`);
process.stdout.write(`  pages:          ${pagesFetched} (visited)\n`);
process.stdout.write(`  depth:          ${MAX_DEPTH}\n`);
process.stdout.write(`  leaks:          ${totalLeaks}\n`);
process.stdout.write(`  silent 404s:    ${silentNotFounds.length}\n`);

if (redirectLeaks.length > 0) {
  process.stdout.write(`\nRedirect leaks (${redirectLeaks.length}):\n`);
  for (const r of redirectLeaks.slice(0, 50)) {
    process.stdout.write(`  ${r.fromUrl}\n    → ${r.redirectedTo}\n`);
  }
}

if (leaks.length > 0) {
  // Group by resolved host to make the report scannable
  const byHost = new Map();
  for (const l of leaks) {
    const host = new URL(l.resolved).host;
    if (!byHost.has(host)) byHost.set(host, []);
    byHost.get(host).push(l);
  }
  process.stdout.write(`\nAnchor leaks (${leaks.length}):\n`);
  for (const [host, group] of byHost) {
    process.stdout.write(`  ${host}: ${group.length} link(s)\n`);
    for (const l of group.slice(0, 5)) {
      process.stdout.write(`    href="${l.href}"   from ${l.fromUrl}\n`);
    }
    if (group.length > 5) process.stdout.write(`    … and ${group.length - 5} more\n`);
  }
}

if (silentNotFounds.length > 0) {
  process.stdout.write(`\nSilent 404s (${silentNotFounds.length}):\n`);
  process.stdout.write(`  Pages that returned HTTP 200 but rendered Next.js's not-found fallback.\n`);
  process.stdout.write(`  Likely cause: a Suspense child called notFound() after streaming started.\n`);
  for (const s of silentNotFounds.slice(0, 50)) {
    process.stdout.write(`  ${s.url}\n`);
  }
  if (silentNotFounds.length > 50) {
    process.stdout.write(`  … and ${silentNotFounds.length - 50} more\n`);
  }
}

if (totalIssues === 0) {
  process.stdout.write(`\nNo issues detected. The subdomain stays inside ${TENANT_HOST}.\n`);
  process.exit(0);
} else {
  process.stdout.write(`\nIssues detected. Patch each before shipping.\n`);
  process.exit(1);
}
