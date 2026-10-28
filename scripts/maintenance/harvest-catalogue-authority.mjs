#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/backfill-iiif-manifests.mjs — the per-host-throttled manifest fetcher this copies its
// loop from; it stores whole manifests (raw JSON + page URLs, too heavy for 180K books) and parses no names.
// scripts/catalog-coverage/harvest-erara-catalog.mjs — OAI ListRecords over all of e-rara, keeping one role-less name.
/**
 * #7660 stage 0 — harvest the holding libraries' own author authority for books
 * with no author_id, one GET per book, no model.
 *
 *   BSB / MDZ   the IIIF manifest: Creator / Contributor with GND id and life dates
 *   e-rara      the METS record (OAI GetRecord): names with GND id and MARC role code
 *   SBB         the METS record: names with role code (GND only sometimes)
 *   Göttingen   the METS record: names with GND id and role code
 *
 * Writes ONE row per book to `catalogue_authority_harvest` (_id = book id): the
 * parsed names, VD16/17/18 numbers, the record URL, the book's catalogue author at
 * fetch time and an error, if any. Never writes to `books` or `authors`; the
 * minting step reads these rows. Nothing reads this collection on a schedule.
 *
 * WHICH BOOKS. Every book of e-rara, SBB and Göttingen (few books per string, and a
 * per-book record is what separates homonyms). BSB is held to 1 request a second,
 * so it is SAMPLED: two books per catalogue author string (strings with most books
 * first; the GNDs must agree before a string is keyed), then every placeholder book
 * (Unknown, [s.n.]…), then one book per single-book string. `--bsb-all` fetches all.
 *
 * Resumable: a book with a row and no error is skipped (`--refetch` overrides).
 *
 *   node --env-file=.env.production.local scripts/maintenance/harvest-catalogue-authority.mjs              # dry run: the work list
 *   node --env-file=.env.production.local scripts/maintenance/harvest-catalogue-authority.mjs --commit [--provider=erara] [--limit=N]
 */
import { MongoClient } from 'mongodb';
import { parseBsbManifest, parseMetsMods, authorOf, recordUrlFor } from '../lib/catalogue-authority.mjs';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const val = (k, d = null) => (args.find((a) => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=') || d;
const COMMIT = flag('--commit');
const REFETCH = flag('--refetch');
const BSB_ALL = flag('--bsb-all');
const LIMIT = Number(val('limit', 0));
const ONLY = val('provider');
const PROVIDERS = ['bsb', 'mdz', 'erara', 'e-rara', 'sbb', 'goettingen'].filter((p) => !ONLY || ONLY.split(',').includes(p));
const UA = 'SourceLibrary/1.0 (+https://sourcelibrary.org; catalogue authority harvest #7660)';
/** Minimum ms between requests per host, and workers per host. BSB is held to 1 req/s (Derek, 2026-10-28). */
const HOST_RULES = { 'api.digitale-sammlungen.de': [1000, 1], 'www.e-rara.ch': [250, 3], 'content.staatsbibliothek-berlin.de': [250, 3], 'gdz.sub.uni-goettingen.de': [250, 3] };
const PLACEHOLDER = /^\s*(?:unknown|\[?s\.\s?n\.?\]?|not known|not traceable|n\/?a|not available|anonym\w*(?: \w+)?|anon\.?|none|-+)?\s*$/i;

const mc = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 20 });
await mc.connect();
const db = mc.db('bookstore');
const harvest = db.collection('catalogue_authority_harvest');
if (COMMIT) await harvest.createIndex({ provider: 1 }).catch(() => {});

const done = new Set();
if (!REFETCH) for await (const r of harvest.find({ error: null }, { projection: { _id: 1 } })) done.add(r._id);

const books = await db.collection('books').find({
  author_id: { $in: [null, undefined] }, content_type: { $ne: 'artwork' }, resource_type: { $exists: false },
  'image_source.provider': { $in: PROVIDERS }, 'image_source.iiif_manifest': { $exists: true, $ne: null },
}, { projection: { id: 1, author: 1, 'image_source.provider': 1, 'image_source.iiif_manifest': 1 } }).toArray();

// ── work list ────────────────────────────────────────────────────────────────
const work = [];
const bsb = [];
for (const b of books) {
  const rec = recordUrlFor(b);
  if (!rec) continue;
  const item = { book_id: b.id ?? String(b._id), provider: b.image_source.provider, author: b.author ?? null, ...rec };
  if (done.has(item.book_id)) continue;
  if ((item.provider === 'bsb' || item.provider === 'mdz') && !BSB_ALL) bsb.push(item); else work.push(item);
}
if (bsb.length) {
  const byString = new Map();
  for (const it of bsb) {
    const k = PLACEHOLDER.test(it.author ?? '') ? '\u0000placeholder' : it.author;
    if (!byString.has(k)) byString.set(k, []);
    byString.get(k).push(it);
  }
  // Strings already sampled in an earlier run count toward their two.
  const sampled = new Map();
  if (!REFETCH) for await (const r of harvest.find({ provider: { $in: ['bsb', 'mdz'] }, error: null }, { projection: { catalogue_author: 1 } })) sampled.set(r.catalogue_author, (sampled.get(r.catalogue_author) || 0) + 1);
  const multi = [...byString.entries()].filter(([k, v]) => k !== '\u0000placeholder' && v.length + (sampled.get(k) || 0) >= 2).sort((a, b) => b[1].length - a[1].length);
  for (const [k, v] of multi) work.push(...v.slice(0, Math.max(0, 2 - (sampled.get(k) || 0))));
  work.push(...(byString.get('\u0000placeholder') || []));
  for (const [k, v] of byString) if (k !== '\u0000placeholder' && v.length + (sampled.get(k) || 0) < 2 && !(sampled.get(k))) work.push(v[0]);
}
const list = LIMIT ? work.slice(0, LIMIT) : work;
const byProv = {};
for (const w of list) byProv[w.provider] = (byProv[w.provider] || 0) + 1;
console.log(`books in scope ${books.length}; already harvested ${done.size}; to fetch ${list.length}`, byProv);
if (!COMMIT) { console.log('DRY RUN — add --commit.'); await mc.close(); process.exit(0); }

// ── fetch, per host ──────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function fetchText(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(45_000) });
      if (r.status === 429 || r.status >= 500) { await sleep(5000 * (attempt + 1)); if (attempt < 2) continue; }
      return { status: r.status, text: r.ok ? await r.text() : null };
    } catch (e) { if (attempt === 2) return { status: 0, text: null, error: e.name === 'TimeoutError' ? 'timeout' : e.message }; await sleep(3000); }
  }
  return { status: 0, text: null, error: 'retries exhausted' };
}

let ok = 0, failed = 0, authored = 0;
const started = Date.now();
async function one(it) {
  const r = await fetchText(it.url);
  let parsed = { names: [], ids: {} }, error = r.error || (r.text == null ? `HTTP ${r.status}` : null);
  if (!error) {
    try { parsed = it.kind === 'bsb-manifest' ? parseBsbManifest(JSON.parse(r.text)) : parseMetsMods(r.text); }
    catch (e) { error = `parse: ${e.message}`; }
  }
  const au = authorOf(parsed.names);
  await harvest.updateOne({ _id: it.book_id }, { $set: {
    book_id: it.book_id, provider: it.provider, url: it.url, kind: it.kind, catalogue_author: it.author,
    names: parsed.names, ids: parsed.ids, statement: parsed.statement ?? null,
    author: au.name, author_reason: au.reason, http_status: r.status, error, fetched_at: new Date(),
  } }, { upsert: true });
  if (error) failed++; else { ok++; if (au.name) authored++; }
  const n = ok + failed;
  if (n % 500 === 0) console.log(`${new Date().toISOString()} ${n}/${list.length} ok ${ok} failed ${failed} with-author ${authored} (${(n / ((Date.now() - started) / 1000)).toFixed(2)}/s)`);
}

const queues = new Map();
for (const it of list) {
  const host = new URL(it.url).host;
  if (!queues.has(host)) queues.set(host, []);
  queues.get(host).push(it);
}
await Promise.all([...queues.entries()].flatMap(([host, q]) => {
  const [gap, workers] = HOST_RULES[host] || [500, 1];
  let next = 0;
  return Array.from({ length: workers }, async () => {
    while (q.length) {
      const it = q.shift();
      const wait = next - Date.now();
      next = Math.max(Date.now(), next) + gap;
      if (wait > 0) await sleep(wait);
      await one(it);
    }
  });
}));
console.log(`DONE ${ok + failed}: ok ${ok}, failed ${failed}, record names one author ${authored}`);
await mc.close();
