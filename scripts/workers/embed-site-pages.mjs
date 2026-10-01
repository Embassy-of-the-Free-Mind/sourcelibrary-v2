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
 * Sources:
 *   blog        — every /blog/<slug> in the live sitemap (the sitemap reads the
 *                 same `posts` array the blog index renders), crawled, <main> text
 *   page        — the editorial pages in STATIC_PAGES below, crawled
 *   collection  — Mongo `collections` (same filter as the unified-search
 *                 collections lane): name, subtitle, description, expanded_description.
 *                 Read from the store, not crawled — the rendered page is mostly book cards.
 *
 * Each page is cut into ~1,600-char chunks; a chunk is re-embedded only when its
 * sha256 changes, so a weekly run costs nearly nothing. Rows for chunks/pages
 * that no longer exist are deleted (this is a derived index, rebuilt from the
 * sources above) — unless that would remove more than 20% of the table, which
 * means the crawl failed, not that the site shrank.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/workers/embed-site-pages.mjs [--dry-run] [--only=blog|page|collection] [--operator]
 *   --operator  explicit operator run: bypasses the spend dial (a full build is ~$0.05)
 *
 * Env: MONGODB_URI, SUPABASE_DB_URL, GEMINI_API_KEY. SITE_BASE (default https://sourcelibrary.org).
 */
import crypto from 'node:crypto';
import pg from 'pg';
import { MongoClient } from 'mongodb';
import { embedTexts, EMBED_MODEL } from '../lib/page-embedding-text.mjs';
import { newEmbedUsage, logEmbeddingUsage, estimateUsd } from '../lib/embedding-usage.mjs';
import { budgetAllowsDispatchScoped } from '../lib/spend-guard.mjs';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const OPERATOR = args.includes('--operator');
const ONLY = args.find((a) => a.startsWith('--only='))?.slice(7) || null;
const SITE_BASE = (process.env.SITE_BASE || 'https://sourcelibrary.org').replace(/\/$/, '');
const UA = 'SourceLibrary-SiteIndexer/1.0 (+https://sourcelibrary.org)';
const CHUNK_CHARS = 1600;
const MAX_CHUNKS_PER_PAGE = 12;
const MAX_PRUNE_FRACTION = 0.2;

/** Editorial pages worth finding by meaning. A path that does not return 200 is reported, not silently dropped. */
const STATIC_PAGES = [
  '/about', '/about/progress', '/vision', '/census', '/developers', '/connect', '/timeline',
  '/support', '/support/business', '/libraries', '/curated', '/for-libraries', '/for-researchers',
  '/licensing', '/volunteers', '/ficino-society', '/press', '/podcast', '/talks', '/give',
  '/contribute', '/data', '/dataset',
];

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
  const title = decodeEntities(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '').replace(/\s*[|—–-]\s*(Source Library|Research Notes)\s*$/i, '').trim();
  const text = main
    .replace(/<(script|style|svg|noscript|nav|header|footer|template)[\s>][\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|blockquote|section|article|tr|figcaption)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  const paragraphs = decodeEntities(text)
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);
  return { title, text: paragraphs.join('\n\n') };
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

async function fetchHtml(path) {
  const res = await fetch(SITE_BASE + path, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) return { status: res.status, html: null };
  return { status: res.status, html: await res.text() };
}

async function blogPaths() {
  const { html: xml } = await fetchHtml('/sitemap/0.xml');
  if (!xml) throw new Error('could not read /sitemap/0.xml — refusing to index the blog from nothing');
  return [...xml.matchAll(/<loc>[^<]*?(\/blog\/[^<]+)<\/loc>/g)].map((m) => m[1]);
}

async function crawlPages(paths, pageType, skipped) {
  const out = [];
  for (const path of paths) {
    const { status, html } = await fetchHtml(path);
    if (!html) { skipped.push(`${path} (HTTP ${status})`); continue; }
    const { title, text } = extractMainText(html);
    if (text.length < 200) { skipped.push(`${path} (only ${text.length} chars of text)`); continue; }
    out.push({ url: path, page_type: pageType, title: title || path, tenant_id: null, text });
  }
  return out;
}

async function collectionPages(db) {
  const cols = await db.collection('collections').find(
    { visible: { $ne: false }, book_count: { $gt: 0 } },
    { projection: { slug: 1, name: 1, subtitle: 1, description: 1, expanded_description: 1, tenantId: 1 } },
  ).toArray();
  return cols.filter((c) => c.slug && c.name).map((c) => ({
    url: `/collections/${c.slug}`,
    page_type: 'collection',
    title: c.name,
    tenant_id: c.tenantId || null,
    text: [c.subtitle, c.description, c.expanded_description].filter(Boolean).join('\n\n'),
  })).filter((p) => p.text.length > 0);
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
    const gate = await budgetAllowsDispatchScoped(db, 'embed-site-pages', { bypass: OPERATOR });
    if (!gate.allowed) { await mongo.close(); process.exit(0); }
  }

  const skipped = [];
  const pages = [];
  if (!ONLY || ONLY === 'blog') pages.push(...await crawlPages(await blogPaths(), 'blog', skipped));
  if (!ONLY || ONLY === 'page') pages.push(...await crawlPages(STATIC_PAGES, 'page', skipped));
  if (!ONLY || ONLY === 'collection') pages.push(...await collectionPages(db));

  const rows = [];
  for (const p of pages) {
    const chunks = chunkText(p.text).slice(0, MAX_CHUNKS_PER_PAGE);
    chunks.forEach((chunk, i) => rows.push({
      id: `${p.url}#${i}`, url: p.url, chunk: i, page_type: p.page_type, title: p.title,
      text: chunk, tenant_id: p.tenant_id, content_hash: sha(`${p.title}\n${chunk}`),
    }));
  }
  const byType = pages.reduce((acc, p) => ({ ...acc, [p.page_type]: (acc[p.page_type] || 0) + 1 }), {});
  console.log(`pages: ${pages.length} ${JSON.stringify(byType)} → ${rows.length} chunks`);
  if (skipped.length) console.log(`skipped ${skipped.length}:\n  ${skipped.join('\n  ')}`);

  const client = new pg.Client({ connectionString: SUPABASE_DB_URL });
  await client.connect();
  try {
    const typeFilter = ONLY ? 'WHERE page_type = $1' : '';
    const { rows: existing } = await client.query(`SELECT id, content_hash FROM site_pages ${typeFilter}`, ONLY ? [ONLY] : []);
    const have = new Map(existing.map((r) => [r.id, r.content_hash]));
    const todo = rows.filter((r) => have.get(r.id) !== r.content_hash);
    const keep = new Set(rows.map((r) => r.id));
    const stale = existing.filter((r) => !keep.has(r.id)).map((r) => r.id);
    const chars = todo.reduce((n, r) => n + r.title.length + r.text.length, 0);
    console.log(`existing ${existing.length}; to embed ${todo.length} (~$${estimateUsd(chars).toFixed(4)}); stale ${stale.length}`);

    if (DRY_RUN) return;

    const usage = newEmbedUsage();
    let written = 0;
    for (let i = 0; i < todo.length; i += 50) {
      const batch = todo.slice(i, i + 50);
      const vectors = await embedTexts(batch.map((r) => `${r.title}\n\n${r.text}`), apiKey, { usage });
      for (let j = 0; j < batch.length; j++) {
        const r = batch[j];
        await client.query(
          `INSERT INTO site_pages (id, url, chunk, page_type, title, text, tenant_id, content_hash, embedding, embedding_model, indexed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
           ON CONFLICT (id) DO UPDATE SET url = EXCLUDED.url, chunk = EXCLUDED.chunk, page_type = EXCLUDED.page_type,
             title = EXCLUDED.title, text = EXCLUDED.text, tenant_id = EXCLUDED.tenant_id, content_hash = EXCLUDED.content_hash,
             embedding = EXCLUDED.embedding, embedding_model = EXCLUDED.embedding_model, indexed_at = now()`,
          [r.id, r.url, r.chunk, r.page_type, r.title, r.text, r.tenant_id, r.content_hash, JSON.stringify(vectors[j]), EMBED_MODEL],
        );
        written++;
      }
    }
    await logEmbeddingUsage(usage, { model: EMBED_MODEL, endpoint: 'embed-site-pages', db });

    let pruned = 0;
    if (stale.length) {
      if (existing.length > 0 && stale.length / existing.length > MAX_PRUNE_FRACTION) {
        console.log(`NOT pruning ${stale.length} of ${existing.length} rows (> ${MAX_PRUNE_FRACTION * 100}%) — the crawl probably failed; check the skipped list.`);
      } else {
        ({ rowCount: pruned } = await client.query('DELETE FROM site_pages WHERE id = ANY($1)', [stale]));
      }
    }
    const { rows: [{ n }] } = await client.query('SELECT count(*)::int AS n FROM site_pages');
    console.log(`embedded ${written}, pruned ${pruned}; site_pages now holds ${n} rows`);
  } finally {
    await client.end();
    await mongo.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
