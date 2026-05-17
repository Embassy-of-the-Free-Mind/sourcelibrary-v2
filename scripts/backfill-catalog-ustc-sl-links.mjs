#!/usr/bin/env node
/**
 * Backfill ustc_sn + sl_book_id on index_catalog_entries via TWO passes.
 *
 * Pass 1 (Supabase): catalog entry → USTC edition → SL book if USTC-linked.
 *   This gives us ustc_sn for every entry that matches a known USTC edition,
 *   plus sl_book_id when ustc_editions.source_library_id is set (populated
 *   by Phase 1/2 reconciliation in #1847; ~60% of current banned-books).
 *
 * Pass 2 (Mongo): catalog entry → SL book direct, by author+title fuzzy
 *   match. Catches the ~40% of held banned books that haven't been linked
 *   to USTC yet. Only fills sl_book_id where Pass 1 left it null.
 *
 * Re-runnable; only fills entries where ustc_sn IS NULL (unless --force).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/backfill-catalog-ustc-sl-links.mjs --index-id roman-1564-tridentine        # dry-run
 *   node scripts/backfill-catalog-ustc-sl-links.mjs --index-id roman-1564-tridentine --apply
 *   node scripts/backfill-catalog-ustc-sl-links.mjs --all --apply                            # every index
 */
import { MongoClient } from 'mongodb';

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const ALL = process.argv.includes('--all');
const INDEX_ID = arg('--index-id');
const CONCURRENCY = Math.max(1, Number(arg('--concurrency', 4)));

if (!INDEX_ID && !ALL) { console.error('Specify --index-id <id> or --all'); process.exit(1); }

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = APPLY ? process.env.SUPABASE_SERVICE_ROLE_KEY : process.env.SUPABASE_ANON_KEY;
if (!SUPA_KEY) { console.error('SUPABASE_*_KEY missing'); process.exit(1); }
const headers = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' };

async function supa(method, path, body) {
  const opts = { method, headers };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, opts);
  if (!r.ok) throw new Error(`Supabase ${method} ${path} → ${r.status}: ${(await r.text()).slice(0, 400)}`);
  return r.status === 204 ? null : r.json();
}

// ─── Token utilities (shared with banned-books-via-ustc.mjs) ───────────────

const STOP = new Set([
  'libri','liber','libro','tres','duo','sive','seu','oder','over','quam','est',
  'das','ist','und','von','dans','dell','della','dello','this','that','sopra',
  'opera','omnia','tomus','editio','epistola','epistolae','tractatus','dialogo',
  'oeuvres','works','traite','schriften','memoires','schrift','dialogus',
]);
function norm(s) {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9\s,'-]/g, ' ').replace(/\s+/g, ' ').trim();
}
function titleTokens(t) {
  return norm(t).split(/\s+/).filter(w => w.length >= 5 && !STOP.has(w));
}

// Replicate the long-s normalisation (OCR commonly mis-reads ſ as f)
function fixLongS(s) { return (s || '').replace(/f/g, 's').replace(/F/g, 'S'); }

// ─── USTC fetch cache (per surname) ───────────────────────────────────────

const ustcCache = new Map();
async function ustcEditionsBySurname(s) {
  if (!s) return [];
  if (ustcCache.has(s)) return ustcCache.get(s);
  const variants = [s];
  // Try OCR-corrected surname too: "Brandeburgenfis" → "Brandeburgensis"
  const corrected = fixLongS(s);
  if (corrected !== s) variants.push(corrected);

  const editions = [];
  for (const v of variants) {
    const enc = encodeURIComponent(v);
    let offset = 0;
    while (true) {
      const path = `ustc_editions?author_1=ilike.${enc}*&select=sn,source_library_id,title,author_1,year&limit=1000&offset=${offset}`;
      try {
        const r = await supa('GET', path);
        editions.push(...r);
        if (r.length < 1000 || offset >= 4000) break;
        offset += 1000;
      } catch (e) {
        if (String(e).includes('57014')) break; // timeout — surname too common, bail
        throw e;
      }
    }
  }
  ustcCache.set(s, editions);
  return editions;
}

// ─── Catalog entry → best USTC match ──────────────────────────────────────

function scoreMatch(entryTitle, ustcTitle) {
  const tokens = titleTokens(entryTitle);
  if (tokens.length === 0) return 0;
  const ustcNorm = norm(ustcTitle);
  let hits = 0;
  for (const t of tokens) if (ustcNorm.includes(t)) hits++;
  return hits;
}

async function fetchCatalogEntries(indexId) {
  const entries = [];
  let offset = 0;
  while (true) {
    const filter = FORCE ? '' : '&ustc_sn=is.null';
    const r = await supa('GET',
      `index_catalog_entries?index_id=eq.${indexId}${filter}&author_normalized=not.is.null&select=id,title,author,author_normalized,condemnation_year,scope&order=id&limit=1000&offset=${offset}`);
    entries.push(...r);
    if (r.length < 1000) break;
    offset += 1000;
  }
  return entries;
}

// ─── Pass 2: direct Mongo SL match (catches SL books not USTC-linked yet) ──

let mongoClient = null;
async function getMongo() {
  if (mongoClient) return mongoClient;
  mongoClient = new MongoClient(process.env.MONGODB_URI);
  await mongoClient.connect();
  return mongoClient;
}

// Fetch SL books in our domain whose author surname-normalises to `s`.
// Cache per surname to avoid repeated Mongo queries.
const slCache = new Map();
async function slBooksBySurname(s) {
  if (!s) return [];
  if (slCache.has(s)) return slCache.get(s);
  const mc = await getMongo();
  const db = mc.db('bookstore');
  const variants = [s];
  const corrected = fixLongS(s);
  if (corrected !== s) variants.push(corrected);
  const re = new RegExp(`(^|[^a-z])(${variants.map(v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'i');
  const books = await db.collection('books').find(
    { $or: [{ author: re }, { author_normalized: re }, { canonical_author_normalized: re }],
      visible: { $ne: false },
      resource_type: { $nin: ['artwork', 'emblem', 'image', 'illustration', 'manuscript-fragment'] } },
    { projection: { _id: 1, id: 1, slug: 1, title: 1, author: 1, year: 1 } }
  ).limit(80).toArray();
  slCache.set(s, books);
  return books;
}

async function findSlBookFor(entry) {
  const eds = await slBooksBySurname(entry.author_normalized);
  if (!eds.length) return null;
  let best = null;
  for (const b of eds) {
    if (entry.scope === 'opera_omnia') {
      // For opera_omnia, surname match is enough. Prefer SL books with reasonable year proximity.
      const proximity = entry.condemnation_year && b.year ? Math.abs(entry.condemnation_year - b.year) : 9999;
      if (!best || proximity < best.proximity) best = { book: b, score: 1, proximity, reason: 'opera_omnia' };
      continue;
    }
    const score = scoreMatch(entry.title, b.title);
    if (score < 2) continue;
    if (entry.condemnation_year && b.year && Math.abs(entry.condemnation_year - b.year) > 100) continue;
    if (best && best.score >= score) continue;
    best = { book: b, score, reason: `${score}-token-overlap` };
  }
  return best;
}

async function backfillIndex(indexId) {
  console.log(`\n━━━ ${indexId} ━━━`);
  const entries = await fetchCatalogEntries(indexId);
  console.log(`Entries needing linkage: ${entries.length}`);
  if (!entries.length) return { matched: 0, withSl: 0, total: 0 };

  const startedAt = Date.now();
  let matched = 0;
  let withSl = 0;
  const ops = []; // { id, ustc_sn, sl_book_id, confidence }
  const samples = [];

  // Process in parallel (concurrency on surname-fetch + scoring)
  const queue = [...entries];
  async function worker() {
    while (queue.length) {
      const e = queue.shift();
      const sn = e.author_normalized;
      if (!sn || sn.length < 3) continue;
      const editions = await ustcEditionsBySurname(sn);
      if (!editions.length) continue;

      let best = null;
      for (const u of editions) {
        const score = scoreMatch(e.title, u.title);
        // For opera_omnia, surname match is sufficient
        if (e.scope === 'opera_omnia') {
          if (!best || (best.score < 99)) best = { u, score: 99, reason: 'opera_omnia' };
          continue;
        }
        if (score < 2) continue; // need ≥2 distinctive token overlap
        if (best && best.score >= score) continue;
        // Year proximity (±50y) if both have years
        if (e.condemnation_year && u.year && Math.abs(e.condemnation_year - u.year) > 60) continue;
        best = { u, score, reason: `${score}-token-overlap` };
      }
      if (!best) {
        // Pass 2 fallback: no USTC match but maybe we have an SL book directly
        const slMatch = await findSlBookFor(e);
        if (!slMatch) continue;
        matched++;
        withSl++;
        ops.push({
          id: e.id,
          sl_book_id: String(slMatch.book._id),
          sl_book_slug: slMatch.book.slug || null,
          match_confidence: slMatch.score >= 4 ? 'high' : slMatch.score >= 3 ? 'medium' : 'low',
          match_method: 'ocr_then_mongo_direct',
        });
        if (samples.length < 5) samples.push({
          entry: `"${(e.title || '').slice(0, 40)}" by ${e.author}`,
          ustc: '(no USTC match)',
          reason: `direct-SL: ${slMatch.reason}`,
          sl: `HELD: ${slMatch.book.slug || slMatch.book.id}`,
        });
        continue;
      }
      matched++;
      if (best.u.source_library_id) withSl++;

      const confidence =
        best.reason === 'opera_omnia' ? 'medium' :
        best.score >= 4 ? 'high' :
        best.score >= 3 ? 'medium' : 'low';

      // Pass 2: if USTC didn't carry an SL link, try direct Mongo SL match
      let slBookId = best.u.source_library_id || null;
      let slBookSlug = null;
      let directHit = false;
      if (!slBookId) {
        const slMatch = await findSlBookFor(e);
        if (slMatch) {
          slBookId = String(slMatch.book._id);
          slBookSlug = slMatch.book.slug || null;
          directHit = true;
          withSl++;
        }
      }

      ops.push({
        id: e.id,
        ustc_sn: best.u.sn,
        sl_book_id: slBookId,
        sl_book_slug: slBookSlug,
        match_confidence: confidence,
        match_method: directHit ? 'ocr_then_ustc_join+mongo_fallback' : 'ocr_then_ustc_join',
      });
      if (samples.length < 5) {
        samples.push({
          entry: `"${(e.title || '').slice(0,40)}" by ${e.author}`,
          ustc: `USTC ${best.u.sn} "${(best.u.title || '').slice(0,40)}" (${best.u.year})`,
          reason: best.reason,
          sl: best.u.source_library_id ? 'HELD' : '—',
        });
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`Match rate: ${matched}/${entries.length} (${(matched/entries.length*100).toFixed(1)}%)`);
  console.log(`With sl_book_id: ${withSl}`);
  console.log(`Elapsed: ${((Date.now()-startedAt)/1000).toFixed(1)}s, USTC fetches cached: ${ustcCache.size}, SL fetches cached: ${slCache.size}\n`);
  console.log(`Sample matches:`);
  for (const s of samples) {
    console.log(`  [${s.sl}] ${s.entry}`);
    console.log(`        → ${s.ustc} (${s.reason})`);
  }

  if (!APPLY) {
    console.log(`\n(dry run — pass --apply to write ${ops.length} updates)`);
    return { matched, withSl, total: entries.length };
  }

  // Patch in chunks. PostgREST doesn't support bulk by-id PATCH, so iterate.
  console.log(`\nWriting ${ops.length} updates…`);
  let written = 0;
  for (const op of ops) {
    const { id, ...patch } = op;
    await supa('PATCH', `index_catalog_entries?id=eq.${id}`, patch);
    written++;
    if (written % 100 === 0) process.stdout.write(`\r  ${written}/${ops.length}`);
  }
  console.log(`\n  ${written} entries updated.`);
  return { matched, withSl, total: entries.length };
}

async function main() {
  console.log(`Catalog → USTC backfill\nMode: ${APPLY ? 'APPLY' : 'DRY-RUN'}${FORCE ? ' --force' : ''}`);

  let indexIds = [];
  if (ALL) {
    const cats = await supa('GET', 'index_catalogs?select=id&order=id');
    indexIds = cats.map(c => c.id);
    console.log(`All indices: ${indexIds.join(', ')}`);
  } else {
    indexIds = [INDEX_ID];
  }

  const totals = { matched: 0, withSl: 0, total: 0 };
  for (const id of indexIds) {
    const r = await backfillIndex(id);
    totals.matched += r.matched;
    totals.withSl += r.withSl;
    totals.total += r.total;
  }
  console.log(`\n━━━ Summary ━━━`);
  console.log(`Indices processed: ${indexIds.length}`);
  console.log(`Total entries    : ${totals.total}`);
  console.log(`Matched (USTC or SL): ${totals.matched} (${(totals.matched/Math.max(totals.total,1)*100).toFixed(1)}%)`);
  console.log(`Linked to SL book   : ${totals.withSl}`);

  if (mongoClient) await mongoClient.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
