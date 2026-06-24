#!/usr/bin/env node
/**
 * Entity-first work-held matcher: set index_catalog_entries.sl_book_id by
 * matching an entry to a HELD book BY THE SAME ENTITY (author_entity_id), so
 * the "banned book we hold" chip lights up on the exact work.
 *
 * Precise because it's entity-scoped — no surname collisions, no ±year guard
 * needed (identity is already established by author_entity_id, set by
 * backfill-catalog-author-entity.mjs). For each entry with author_entity_id and
 * no sl_book_id:
 *   • opera_omnia / author-only title → link a representative collected-works
 *     volume by that entity (prefer "opera/omnia" in the title), else the
 *     longest/most-complete book.
 *   • single_work / expurgated → link the entity's book whose title shares ≥2
 *     distinctive tokens with the entry title (best overlap wins).
 *
 * Idempotent — only fills sl_book_id IS NULL. Run after the author-entity
 * backfill.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/backfill-catalog-work-held-entity.mjs            # dry-run
 *   node scripts/backfill-catalog-work-held-entity.mjs --apply
 */
import { MongoClient } from 'mongodb';

const APPLY = process.argv.includes('--apply');
const concArg = process.argv.indexOf('--concurrency');
const CONCURRENCY = Math.max(1, concArg > -1 ? Number(process.argv[concArg + 1]) : 4);

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = APPLY ? process.env.SUPABASE_SERVICE_ROLE_KEY : process.env.SUPABASE_ANON_KEY;
if (!SUPA_URL || !SUPA_KEY) { console.error('SUPABASE_* missing'); process.exit(1); }
const H = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' };

async function supa(method, path, body) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const opts = { method, headers: H };
      if (body !== undefined) opts.body = JSON.stringify(body);
      const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, opts);
      if (!r.ok) {
        const text = (await r.text()).slice(0, 300);
        if ((r.status >= 500 || r.status === 409) && attempt < 4) { await new Promise(res => setTimeout(res, 800 * 2 ** attempt)); continue; }
        throw new Error(`${method} ${path} → ${r.status}: ${text}`);
      }
      return r.status === 204 ? null : r.json();
    } catch (e) {
      if (attempt === 4 || !/ETIMEDOUT|ECONNRESET|fetch failed|self-signed/i.test(String(e))) throw e;
      await new Promise(res => setTimeout(res, 1500 * 2 ** attempt));
    }
  }
}

const STOP = new Set([
  'libri', 'liber', 'libro', 'tres', 'duo', 'sive', 'seu', 'oder', 'over', 'quam', 'est',
  'das', 'ist', 'und', 'von', 'dans', 'dell', 'della', 'dello', 'this', 'that', 'sopra',
  'opera', 'omnia', 'tomus', 'editio', 'epistola', 'epistolae', 'tractatus', 'dialogo',
  'oeuvres', 'works', 'traite', 'schriften', 'memoires', 'schrift', 'dialogus',
]);
const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const titleTokens = (t) => norm(t).split(/\s+/).filter(w => w.length >= 5 && !STOP.has(w));
function overlap(entryTitle, bookTitle) {
  const toks = titleTokens(entryTitle);
  if (!toks.length) return 0;
  const bt = norm(bookTitle);
  let n = 0; for (const t of toks) if (bt.includes(t)) n++;
  return n;
}

let mc;
const booksCache = new Map();
async function entityBooks(entityId) {
  if (booksCache.has(entityId)) return booksCache.get(entityId);
  const db = mc.db('bookstore');
  const books = await db.collection('books').find(
    { author_entity_id: entityId, visible: { $ne: false }, pages_count: { $gt: 0 },
      resource_type: { $nin: ['artwork', 'emblem', 'image', 'illustration', 'manuscript-fragment'] } },
    { projection: { _id: 1, slug: 1, title: 1, year: 1, pages_count: 1 } }).toArray();
  booksCache.set(entityId, books);
  return books;
}

// Junk/placeholder books that slipped into the books collection.
const isJunk = (b) => !b.title || /check-only|^\s*test\b|placeholder|untitled/i.test(b.title);

function pickBook(entry, books) {
  const pool = books.filter(b => !isJunk(b));
  if (!pool.length) return null;
  const isOpera = entry.scope === 'opera_omnia' || norm(entry.title) === norm(entry.author_string || '') || !titleTokens(entry.title).length;
  if (isOpera) {
    // Only link an "all works banned" entry to a genuine collected-works volume
    // we hold (the Pico-opera-omnia pattern). Never an arbitrary "largest" book
    // — for opera_omnia the author-held signal already conveys "we hold him".
    const operas = pool.filter(b => /\b(opera|omnia|opuscula)\b/i.test(b.title || ''));
    if (!operas.length) return null;
    const best = [...operas].sort((a, b) => (b.pages_count || 0) - (a.pages_count || 0))[0];
    return { book: best, reason: 'opera_omnia→collected-works' };
  }
  let best = null;
  for (const b of pool) {
    const score = overlap(entry.title, b.title);
    if (score < 2) continue;
    if (!best || score > best.score) best = { book: b, score, reason: `${score}-token-overlap` };
  }
  return best;
}

async function main() {
  console.log(`entity-first work-held — mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  mc = new MongoClient(process.env.MONGODB_URI);
  await mc.connect();

  // entries with an entity but no work link yet
  const entries = [];
  let offset = 0;
  while (true) {
    const rows = await supa('GET',
      `index_catalog_entries?select=id,title,author,scope,author_entity_id&author_entity_id=not.is.null&sl_book_id=is.null&order=id&limit=1000&offset=${offset}`);
    entries.push(...rows);
    if (rows.length < 1000) break;
    offset += rows.length;
  }
  console.log(`${entries.length} entity-linked entries lack a work link.`);

  let linked = 0, done = 0;
  const samples = [];
  const queue = [...entries];
  async function worker() {
    while (queue.length) {
      const e = queue.shift(); if (!e) break;
      done++;
      const books = await entityBooks(e.author_entity_id);
      const m = pickBook({ ...e, author_string: e.author }, books);
      if (m) {
        linked++;
        if (samples.length < 15) samples.push({ t: (e.title || '').slice(0, 36), b: m.book.slug, r: m.reason });
        if (APPLY) {
          await supa('PATCH', `index_catalog_entries?id=eq.${e.id}`, {
            sl_book_id: String(m.book._id), sl_book_slug: m.book.slug || null,
            match_method: 'entity_title_match', match_confidence: m.reason.startsWith('opera') ? 'medium' : 'high',
          });
        }
      }
      if (done % 200 === 0) process.stdout.write(`\r  ${done}/${entries.length} linked=${linked}   `);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  console.log();
  console.log('\nsamples:');
  for (const s of samples) console.log(`  "${s.t}" → ${s.b} (${s.r})`);
  console.log(`\n${APPLY ? 'Linked' : 'Would link'} ${linked} entries to a held work by the same entity.`);
  await mc.close();
}
main().catch(e => { console.error('Fatal:', e); process.exit(1); });
