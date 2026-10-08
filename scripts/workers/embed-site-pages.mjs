#!/usr/bin/env node
/**
 * Index the site's own writing into `site_pages` so search can find it (#1180).
 *
 * PRIOR ART: scripts/workers/embed-gemini.mjs and scripts/lib/embed-book-pages.mjs
 * embed BOOK pages keyed by page_id; image-embeddings-cron.mjs embeds gallery
 * captions. Nothing indexes the blog, collection intros or editorial pages —
 * this reuses their composer pieces (embedTexts, EMBED_MODEL, usage metering)
 * rather than re-typing them.
 *
 * Sources (#5945: the page list is derived, never hand-kept — a hand list let
 * /research/quality, /review and /about/faq go unindexed and kept two paths
 * that had become redirects):
 *   page, blog  — every static route in src/app (a page.tsx with no dynamic
 *                 segment) plus every path in sitemap chunk 0 and the
 *                 /languages/<x> pages of chunk 1, crawled. A path is indexed
 *                 only if it is public and indexable: robots.txt allows it, it
 *                 answers 200 without redirecting, and it carries no `noindex`.
 *                 <main> text; a page with little server-rendered prose is
 *                 indexed by its title and meta description.
 *   feature     — tools (/identify, /ngrams…) from src/lib/site-features.json:
 *                 meta description + the names a reader would type. Its names
 *                 are added to the crawled page of the same URL when there is one.
 *   collection  — Mongo `collections` (same filter as the unified-search
 *                 collections lane): name, subtitle, description, expanded_description.
 *                 Read from the store, not crawled — the rendered page is mostly book cards.
 *   author      — Mongo `authors` with at least one live book (the sitemap's
 *                 own rule). Names only, no embedding: an author page has no
 *                 prose of its own.
 *
 * Each page also stores the NAMES it answers to (title, URL words, aliases) in
 * `names` / `name_tokens` on its first chunk, for the navigational match in
 * /api/search/unified (scripts/lib/site-nav-names.mjs).
 *
 * Each page is cut into ~1,600-char chunks; a chunk is re-embedded only when its
 * sha256 changes, so a daily run costs nearly nothing. Rows for chunks/pages
 * that no longer exist are deleted (this is a derived index, rebuilt from the
 * sources above) — unless that would remove more than 20% of one page type,
 * which means that source failed, not that the site shrank. The guard is per
 * type because 6,800 author rows would otherwise hide a failed blog crawl.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/workers/embed-site-pages.mjs [--dry-run] [--only=blog|page|collection|author] [--operator]
 *   --operator     explicit operator run: bypasses the spend dial (a full build is ~$0.05)
 *   --list         print every page with the names it answers to
 *   --force-prune  delete stale rows even past the 20% guard (after reading the stale list in a --dry-run)
 *
 * Env: MONGODB_URI, SUPABASE_DB_URL, GEMINI_API_KEY. SITE_BASE (default https://sourcelibrary.org).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { MongoClient } from 'mongodb';
import { embedTexts, EMBED_MODEL } from '../lib/page-embedding-text.mjs';
import { assertStoreVector } from '../lib/vector-truth.mjs';
import { newEmbedUsage, logEmbeddingUsage, estimateUsd } from '../lib/embedding-usage.mjs';
import { budgetAllowsDispatchScoped } from '../lib/spend-guard.mjs';
import { isPaused } from '../lib/pause.mjs';
import { classifyVariant } from '../lib/variant-shape.mjs';
import { navTokens, pathNames, distinctNames, nameTokens } from '../lib/site-nav-names.mjs';
import SITE_FEATURES from '../../src/lib/site-features.json' with { type: 'json' };

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const OPERATOR = args.includes('--operator');
const FORCE_PRUNE = args.includes('--force-prune');
const ONLY = args.find((a) => a.startsWith('--only='))?.slice(7) || null;
const SITE_BASE = (process.env.SITE_BASE || 'https://sourcelibrary.org').replace(/\/$/, '');
const UA = 'SourceLibrary-SiteIndexer/1.0 (+https://sourcelibrary.org)';
const CHUNK_CHARS = 1600;
const MAX_CHUNKS_PER_PAGE = 12;
const MAX_PRUNE_FRACTION = 0.2;
/** A handful of pages may always leave a type (five features retired at once is not a failed crawl). */
const MIN_PRUNE_ALARM = 5;
const CRAWL_CONCURRENCY = 2;
const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/app');
/**
 * Not destinations for a main-site search: localized twins of English pages (the
 * site lane is English-only; the search page hides it on /es), and the staff
 * areas, whose only public page is a sign-in form.
 */
const NOT_INDEXED_PREFIXES = ['/es', '/platform', '/auth'];
/** Above this share of link text a page is a listing (book cards, an index of posts), not prose. */
const LISTING_LINK_SHARE = 0.5;
const MAX_AUTHOR_NAMES = 12;

// ── Text extraction ────────────────────────────────────────────────

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

/**
 * Readable text of a rendered page: the <main> element when there is one, else
 * the body. Scripts (including the RSC payload), styles, SVG, nav, header and
 * footer are removed; block-level tags become paragraph breaks.
 */
export function extractMainText(html) {
  const main = html.match(/<main[\s>][\s\S]*<\/main>/i)?.[0]
    ?? html.match(/<body[\s>][\s\S]*<\/body>/i)?.[0]
    ?? html;
  // Titles stack site suffixes ("How We Measure OCR Quality - Research Notes | Source Library"): strip until none is left.
  let title = decodeEntities(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '').trim();
  for (let prev = ''; prev !== title;) {
    prev = title;
    title = title.replace(/\s*[|—–-]\s*(Source Library(?: Research)?|Research Notes)\s*$/i, '').trim();
  }
  const text = main
    .replace(/<(script|style|svg|noscript|nav|header|footer|template)[\s>][\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|blockquote|section|article|tr|figcaption)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const paragraphs = decodeEntities(text)
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);
  // How much of the readable text sits inside links: book cards and indexes are nearly all link.
  const linkChars = [...main.replace(/<(script|style|svg|noscript|nav|header|footer|template)[\s>][\s\S]*?<\/\1>/gi, ' ')
    .matchAll(/<a[\s>][\s\S]*?<\/a>/gi)]
    .reduce((n, m) => n + decodeEntities(m[0].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().length, 0);
  const textChars = paragraphs.reduce((n, p) => n + p.length, 0);
  return { title, text: paragraphs.join('\n\n'), linkShare: textChars ? Math.min(1, linkChars / textChars) : 0 };
}

/** What the <head> says about a page: its meta description, whether it asks not to be indexed, and its first <h1>. */
export function extractHead(html) {
  const meta = (name) => {
    const tag = html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]*>`, 'i'))?.[0] || '';
    return decodeEntities(tag.match(/content=["']([^"']*)["']/i)?.[1] || '').trim();
  };
  const h1 = decodeEntities((html.match(/<h1[\s>][\s\S]*?<\/h1>/i)?.[0] || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  return { description: meta('description'), noindex: /noindex/i.test(meta('robots')), h1 };
}

/** A page with no <title> of its own inherits the site's ("Source Library — Ancient Texts…"). */
const isSiteDefaultTitle = (title) => !title || /^source library\b/i.test(title);

/** `/browse/authors` → "Browse Authors": the last resort when a page has neither a title nor an <h1>. */
export function titleFromPath(p) {
  return p.split('/').filter(Boolean).map((s) => s.replace(/[-_]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase())).join(' ');
}

/** Paragraph-respecting chunks of ≤ CHUNK_CHARS (a single long paragraph is hard-cut). */
export function chunkText(text, size = CHUNK_CHARS) {
  const chunks = [];
  let cur = '';
  for (const para of text.split(/\n\n/)) {
    const pieces = para.length > size ? para.match(new RegExp(`[\\s\\S]{1,${size}}`, 'g')) : [para];
    for (const piece of pieces) {
      if (cur && cur.length + piece.length + 2 > size) { chunks.push(cur); cur = ''; }
      cur = cur ? `${cur}\n\n${piece}` : piece;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ── Sources ────────────────────────────────────────────────────────

async function fetchOnce(p) {
  const res = await fetch(SITE_BASE + p, { headers: { 'User-Agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(30000) });
  if (!res.ok) return { status: res.status, html: null };
  return { status: res.status, html: await res.text() };
}

/** One retry on a 5xx or a timeout: the category pages answer 500 now and then (three of 30 on 2026-10-06). */
async function fetchHtml(p) {
  try {
    const first = await fetchOnce(p);
    if (first.status < 500) return first;
  } catch { /* retried below */ }
  await new Promise((r) => setTimeout(r, 3000));
  return fetchOnce(p);
}

/** Static routes: every page.tsx under src/app with no dynamic segment. Route groups `(x)` are not part of the URL. */
export function manifestPaths(appDir = APP_DIR) {
  const out = [];
  const walk = (dir, url) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isFile() && /^page\.(tsx|ts|jsx|js|mdx)$/.test(e.name)) out.push(url || '/');
      if (!e.isDirectory() || /^[[_@]/.test(e.name) || e.name === 'api') continue;
      walk(path.join(dir, e.name), /^\(.*\)$/.test(e.name) ? url : `${url}/${e.name}`);
    }
  };
  walk(appDir, '');
  return [...new Set(out)];
}

/** Disallow rules of the `User-agent: *` group, as tests on a path. `*` is a wildcard, `$` an end anchor. */
export function robotsDisallow(robotsTxt) {
  const rules = [];
  let inStar = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const [, key, value] = line.match(/^([a-z-]+)\s*:\s*(.*)$/i) || [];
    if (!key) continue;
    if (/^user-agent$/i.test(key)) inStar = value === '*';
    else if (inStar && /^disallow$/i.test(key) && value) {
      const body = value.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\?\$$/, '$');
      rules.push(new RegExp(`^${body}`));
    }
  }
  // `Disallow: /beta/` closes the section: /beta itself is not a place to send a visitor either.
  return (p) => rules.some((re) => re.test(p) || re.test(`${p}/`));
}

async function sitemapPaths(chunk, keep) {
  const { html: xml } = await fetchHtml(`/sitemap/${chunk}.xml`);
  if (!xml) throw new Error(`could not read /sitemap/${chunk}.xml — refusing to index the site from a partial list`);
  return [...xml.matchAll(/<loc>https?:\/\/[^/<]+([^<]*)<\/loc>/g)].map((m) => m[1] || '/').filter(keep);
}

/** Every path worth trying: the route manifest, sitemap chunk 0, and the language pages. Not yet checked for access. */
async function candidatePaths() {
  const { html: robots } = await fetchHtml('/robots.txt');
  if (!robots) throw new Error('could not read /robots.txt — refusing to guess which pages are public');
  const disallowed = robotsDisallow(robots);
  const all = new Set([
    ...manifestPaths(),
    ...await sitemapPaths(0, () => true),
    ...await sitemapPaths(1, (p) => p.startsWith('/languages/')),
  ]);
  all.delete('/'); // the homepage is where the visitor already is
  const paths = [...all].filter((p) => !NOT_INDEXED_PREFIXES.some((pre) => p === pre || p.startsWith(`${pre}/`))).sort();
  return { paths: paths.filter((p) => !disallowed(p)), disallowed: paths.filter(disallowed).length };
}

/**
 * Crawl candidate paths and keep the public, indexable ones. `notPublic` counts
 * what was left out on purpose (a redirect, a sign-in wall, `noindex`);
 * `skipped` lists what failed and should be looked at.
 */
async function crawlPages(paths, skipped, notPublic) {
  const out = [];
  const crawlOne = async (p) => {
    let status, html;
    try { ({ status, html } = await fetchHtml(p)); } catch (err) { skipped.push(`${p} (${err.message})`); return; }
    if (status >= 300 && status < 400) { notPublic.redirect++; return; }
    if (!html) { skipped.push(`${p} (HTTP ${status})`); return; }
    const head = extractHead(html);
    if (head.noindex) { notPublic.noindex++; return; }
    const main = extractMainText(html);
    const title = isSiteDefaultTitle(main.title) ? (head.h1 || titleFromPath(p)) : main.title;
    // A tool renders little prose on the server, and a listing (a language's
    // books, a category) renders other pages' titles: both are indexed by what
    // the page says about itself, not by what happens to be on it today.
    const listing = main.linkShare > LISTING_LINK_SHARE;
    const text = main.text.length >= 200 && !listing
      ? main.text
      : [head.description, listing ? '' : main.text].filter(Boolean).join('\n\n') || title;
    out.push({
      url: p, page_type: p.startsWith('/blog/') ? 'blog' : 'page', title, tenant_id: null, text,
      names: [title, ...pathNames(p)], weight: 0,
    });
  };
  const queue = [...paths];
  await Promise.all(Array.from({ length: CRAWL_CONCURRENCY }, async () => {
    for (let p = queue.shift(); p !== undefined; p = queue.shift()) await crawlOne(p);
  }));
  return out.sort((a, b) => a.url.localeCompare(b.url));
}

async function collectionPages(db) {
  const cols = await db.collection('collections').find(
    { visible: { $ne: false }, book_count: { $gt: 0 } },
    { projection: { slug: 1, name: 1, subtitle: 1, description: 1, expanded_description: 1, tenantId: 1 } },
  ).toArray();
  // A collection with no intro yet is still a place a visitor can name.
  return cols.filter((c) => c.slug && c.name).map((c) => ({
    url: `/collections/${c.slug}`,
    page_type: 'collection',
    title: c.name,
    tenant_id: c.tenantId || null,
    text: [c.subtitle, c.description, c.expanded_description].filter(Boolean).join('\n\n') || c.name,
    names: [c.name, ...pathNames(`/${c.slug}`)],
    weight: c.book_count || 0,
  }));
}

/**
 * Author pages: the /author/<id> URLs the sitemap lists (authors that live
 * books point at, minus merged tombstones — getAuthors in src/app/sitemap.ts).
 * Read from the sitemap rather than recomputed: the query behind it scans every
 * live book and ran past 60 s from a worker on 2026-10-06. Names are the
 * canonical name and the catalogue forms in `variants[]` that are safe to match
 * on — never `aliases[]`, which holds Wikidata nicknames that can name a
 * different person (author-identity.md), and never a one-word variant, which
 * can be a bare forename ("Johannes"). `weight` is `authors.book_count`, a
 * build snapshot: good enough to order equal matches, never shown.
 */
async function authorPages(db) {
  const ids = (await sitemapPaths(1, (p) => p.startsWith('/author/'))).map((p) => decodeURIComponent(p.slice('/author/'.length)));
  if (ids.length === 0) console.log('sitemap chunk 1 lists no author pages — its query probably timed out; author rows are left as they are');
  const authors = await db.collection('authors').find(
    { _id: { $in: ids }, merged_into: { $exists: false } },
    { projection: { canonical_name: 1, variants: 1, book_count: 1 } },
  ).toArray();
  return authors.filter((a) => a.canonical_name).map((a) => {
    const variants = (a.variants || [])
      .filter((v) => classifyVariant(v).matchable && navTokens(v).length > 1)
      .slice(0, MAX_AUTHOR_NAMES);
    return {
      url: `/author/${encodeURIComponent(a._id)}`,
      page_type: 'author',
      title: a.canonical_name,
      tenant_id: null,
      text: `Books by ${a.canonical_name} in the library.`,
      names: [a.canonical_name, ...variants],
      weight: a.book_count || 0,
      noEmbedding: true,
    };
  });
}

/**
 * Tools (/identify, /ngrams, …) from src/lib/site-features.json — the same
 * registry the search page's "go here" card matches exactly. Tool pages are
 * mostly interactive UI with little server-rendered prose, so the page's own
 * meta description plus the names a reader would use is what gets embedded.
 */
export function featurePages() {
  return SITE_FEATURES.map((f) => ({
    url: f.href,
    page_type: 'feature',
    title: f.title,
    tenant_id: null,
    text: `${f.description}\n\nAlso known as: ${f.aliases.join(', ')}.`,
    names: [f.title, ...f.aliases, ...pathNames(f.href)],
    weight: 0,
  }));
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  const { MONGODB_URI, SUPABASE_DB_URL } = process.env;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!MONGODB_URI || !SUPABASE_DB_URL || (!apiKey && !DRY_RUN)) {
    console.error('Missing MONGODB_URI, SUPABASE_DB_URL or GEMINI_API_KEY');
    process.exit(1);
  }
  const mongo = new MongoClient(MONGODB_URI);
  await mongo.connect();
  const db = mongo.db(process.env.MONGODB_DB || 'bookstore');

  if (!DRY_RUN) {
    // Pause, then dial (#5492). An --operator run bypasses both, as with the dial.
    if (!OPERATOR) {
      const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
      if (control?.paused || isPaused(control, 'embeddings')) {
        console.log(`[embed-site-pages] ${control?.paused ? 'Pipeline' : 'embeddings step'} paused — exiting.`);
        await mongo.close();
        process.exit(0);
      }
    }
    const gate = await budgetAllowsDispatchScoped(db, 'embed-site-pages', { bypass: OPERATOR });
    if (!gate.allowed) { await mongo.close(); process.exit(0); }
  }

  const skipped = [];
  const notPublic = { disallowed: 0, redirect: 0, noindex: 0 };
  const wants = (type) => !ONLY || ONLY === type;
  const pages = [];
  if (wants('blog') || wants('page')) {
    const found = await candidatePaths();
    notPublic.disallowed = found.disallowed;
    const paths = found.paths.filter((p) => wants(p.startsWith('/blog/') ? 'blog' : 'page'));
    pages.push(...await crawlPages(paths, skipped, notPublic));
  }
  if (wants('collection')) pages.push(...await collectionPages(db));
  if (wants('author')) pages.push(...await authorPages(db));
  if (wants('page')) {
    // A tool that is also a crawled page (/census, /developers) keeps one
    // entry: its prose, with the feature's names appended.
    const byUrl = new Map(pages.map((p) => [p.url, p]));
    for (const f of featurePages()) {
      const crawled = byUrl.get(f.url);
      if (crawled) { crawled.text += `\n\n${f.text}`; crawled.names.push(...f.names); }
      else pages.push(f);
    }
  }

  // One row set per URL. A collection that also has a bespoke static route
  // (/collections/mycology) stays a collection: the store's intro, the crawled names.
  const byUrl = new Map();
  for (const p of pages) {
    const prev = byUrl.get(p.url);
    if (!prev) { byUrl.set(p.url, p); continue; }
    const [keep, drop] = p.page_type === 'collection' ? [p, prev] : [prev, p];
    keep.names.push(...drop.names);
    byUrl.set(p.url, keep);
  }
  pages.splice(0, pages.length, ...byUrl.values());

  const rows = [];
  for (const p of pages) {
    const names = distinctNames(p.names);
    const chunks = chunkText(p.text).slice(0, MAX_CHUNKS_PER_PAGE);
    chunks.forEach((chunk, i) => rows.push({
      id: `${p.url}#${i}`, url: p.url, chunk: i, page_type: p.page_type, title: p.title,
      text: chunk, tenant_id: p.tenant_id, content_hash: sha(`${p.title}\n${chunk}`),
      // The names live on the first chunk only: one row per page answers to them.
      names: i === 0 ? names : [], name_tokens: i === 0 ? nameTokens(names) : [], weight: i === 0 ? p.weight : 0,
      noEmbedding: !!p.noEmbedding,
    }));
  }
  const byType = pages.reduce((acc, p) => ({ ...acc, [p.page_type]: (acc[p.page_type] || 0) + 1 }), {});
  console.log(`pages: ${pages.length} ${JSON.stringify(byType)} → ${rows.length} chunks`);
  console.log(`left out on purpose: ${JSON.stringify(notPublic)} (robots.txt disallow / redirect or sign-in wall / noindex)`);
  if (skipped.length) console.log(`skipped ${skipped.length}:\n  ${skipped.join('\n  ')}`);
  if (args.includes('--list')) console.log(pages.filter((p) => !p.noEmbedding).map((p) => `  ${p.page_type.padEnd(10)} ${p.url}  |  ${distinctNames(p.names).join(' · ')}`).join('\n'));

  const client = new pg.Client({ connectionString: SUPABASE_DB_URL });
  await client.connect();
  try {
    // --only=page also owns the feature rows: a feature shares its URL's row with the crawled page.
    const types = ONLY ? (ONLY === 'page' ? ['page', 'feature'] : [ONLY]) : null;
    const { rows: existing } = await client.query(
      `SELECT id, page_type, content_hash, names, weight FROM site_pages ${types ? 'WHERE page_type = ANY($1)' : ''}`, types ? [types] : [],
    );
    const have = new Map(existing.map((r) => [r.id, r]));
    const changedText = (r) => have.get(r.id)?.content_hash !== r.content_hash || have.get(r.id)?.page_type !== r.page_type;
    const todo = rows.filter((r) => !r.noEmbedding && changedText(r));
    const plain = rows.filter((r) => r.noEmbedding && changedText(r));
    // Same text, different names or weight: no model call, just the columns.
    const renamed = rows.filter((r) => !changedText(r)
      && (JSON.stringify(have.get(r.id).names) !== JSON.stringify(r.names) || have.get(r.id).weight !== r.weight));
    const keep = new Set(rows.map((r) => r.id));
    // A page that failed to load today is not a page that is gone: its rows stay.
    const failed = new Set(skipped.map((line) => line.split(' ')[0]));
    const stale = existing.filter((r) => !keep.has(r.id) && !failed.has(r.id.slice(0, r.id.lastIndexOf('#'))));
    const chars = todo.reduce((n, r) => n + r.title.length + r.text.length, 0);
    console.log(`existing ${existing.length}; to embed ${todo.length} (~$${estimateUsd(chars).toFixed(4)}); to write without embedding ${plain.length}; names/weight only ${renamed.length}; stale ${stale.length}`);

    if (stale.length) console.log(`stale pages: ${[...new Set(stale.map((r) => r.id.slice(0, r.id.lastIndexOf('#'))))].join(' ')}`);

    if (DRY_RUN) return;

    const upsert = (r, vector, model) => client.query(
      `INSERT INTO site_pages (id, url, chunk, page_type, title, text, tenant_id, content_hash, embedding, embedding_model, names, name_tokens, weight, indexed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now())
       ON CONFLICT (id) DO UPDATE SET url = EXCLUDED.url, chunk = EXCLUDED.chunk, page_type = EXCLUDED.page_type,
         title = EXCLUDED.title, text = EXCLUDED.text, tenant_id = EXCLUDED.tenant_id, content_hash = EXCLUDED.content_hash,
         embedding = EXCLUDED.embedding, embedding_model = EXCLUDED.embedding_model,
         names = EXCLUDED.names, name_tokens = EXCLUDED.name_tokens, weight = EXCLUDED.weight, indexed_at = now()`,
      [r.id, r.url, r.chunk, r.page_type, r.title, r.text, r.tenant_id, r.content_hash,
        vector ? JSON.stringify(vector) : null, vector ? model : null, r.names, r.name_tokens, r.weight],
    );

    const usage = newEmbedUsage();
    let written = 0;
    for (let i = 0; i < todo.length; i += 50) {
      const batch = todo.slice(i, i + 50);
      const vectors = await embedTexts(batch.map((r) => `${r.title}\n\n${r.text}`), apiKey, { usage });
      for (let j = 0; j < batch.length; j++) {
        assertStoreVector(vectors[j], { model: vectors.model }); // #6175: the label is the writer's, never a default
        await upsert(batch[j], vectors[j], vectors.model);
        written++;
      }
    }
    await logEmbeddingUsage(usage, { model: EMBED_MODEL, endpoint: 'embed-site-pages', db });
    for (const r of plain) await upsert(r, null);
    for (const r of renamed) {
      await client.query('UPDATE site_pages SET names = $2, name_tokens = $3, weight = $4 WHERE id = $1', [r.id, r.names, r.name_tokens, r.weight]);
    }

    // Prune per page type: each type has its own source, and a source that
    // failed shows up as that type losing a large share of its rows.
    let pruned = 0;
    for (const type of new Set(stale.map((r) => r.page_type))) {
      const gone = stale.filter((r) => r.page_type === type).map((r) => r.id);
      const had = existing.filter((r) => r.page_type === type).length;
      if (!FORCE_PRUNE && gone.length > MIN_PRUNE_ALARM && gone.length / had > MAX_PRUNE_FRACTION) {
        console.log(`NOT pruning ${gone.length} of ${had} '${type}' rows (> ${MAX_PRUNE_FRACTION * 100}%) — that source probably failed; check the skipped list. If the stale pages above really are gone, re-run with --force-prune.`);
        continue;
      }
      const { rowCount } = await client.query('DELETE FROM site_pages WHERE id = ANY($1)', [gone]);
      pruned += rowCount;
    }
    const { rows: [{ n }] } = await client.query('SELECT count(*)::int AS n FROM site_pages');
    console.log(`embedded ${written}, written without embedding ${plain.length}, renamed ${renamed.length}, pruned ${pruned}; site_pages now holds ${n} rows`);
  } finally {
    await client.end();
    await mongo.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
