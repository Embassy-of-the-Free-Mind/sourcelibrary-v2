#!/usr/bin/env node
/**
 * Harvest triage  (issue #2357, stage 2) — the consumer half, decoupled from import.
 *
 * Reads `harvest_candidates`, fetches each candidate's IIIF manifest to recover
 * the real work TITLE / author / date / language / canvas count (the harvest
 * stage only has shelfmarks), then:
 *   - dedups against the Mongo catalog by ARK *and* normalized title+author
 *     (mirror of src/lib/dedup.ts)
 *   - scores domain relevance (weighted by the subject terms that surfaced it
 *     + a keyword pass over the recovered title)
 *   - suggests a decision: duplicates → skip; weak-subject → skip; else stays
 *     `pending` for curator review. Never auto-sets `import`.
 *
 * Continuous + resumable: only touches rows with dedup_status:'unchecked' unless
 * --reenrich. Import is a SEPARATE downstream step that draws from this ledger.
 *
 * NOTE: manifest fetches hit the original provider. Gallica/Harvard 429 datacenter
 * IPs — run from a residential IP or keep CONCURRENCY low. Polite + retried.
 *
 * Run:
 *   set -a; source .env.production.local; set +a
 *   node scripts/research/harvest-triage.mjs --limit 50        # DRY RUN
 *   node scripts/research/harvest-triage.mjs --commit          # write back to ledger
 *   node scripts/research/harvest-triage.mjs --reenrich --commit
 */

import { MongoClient } from 'mongodb';
import { arkOf } from './lib/harvest-store.mjs';

const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; contact@sourcelibrary.org)';
const CONCURRENCY = 4;
const argv = process.argv.slice(2);
const COMMIT = argv.includes('--commit');
const REENRICH = argv.includes('--reenrich');
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const LIMIT = flag('--limit') ? Number(flag('--limit')) : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── normalization: mirror of src/lib/dedup.ts (keep in sync) ────────────────
function normalizeTitle(title = '') {
  return title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/^(the|a|an|der|die|das|de|le|la|les|il|lo|gli|i|el|los|las)\s+/i, '')
    .replace(/\s*[\(\[:]?\s*(vol\.?\s*\d+|tomus?\s*\d+|part\.?\s*\d+|band\s*\d+|tome?\s*\d+)[\)\]]?\s*$/i, '')
    .replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}
function normalizeAuthor(author = '') {
  const cleaned = author.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\b(dr|prof|rev|saint|st|sir|fr|bp)\b\.?\s*/g, '')
    .replace(/\s*\([\d\s\-–,?.]+\)\s*/g, '')
    .replace(/,\s*[\d\s\-–?.]+$/, '')
    .replace(/[\[\]]/g, '')
    .replace(/\b(born|died|fl\.?|circa|ca?\.?)\s*\d{3,4}\b/g, '')
    .replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
  return cleaned.split(' ').filter((w) => w.length > 0).sort().join(' ');
}

// ── domain lexicon for keyword scoring over the recovered title ─────────────
const DOMAIN_TERMS = [
  'alchem', 'alchim', 'alchimi', 'chymic', 'spagyr', 'hermet', 'hermes', 'trismegist',
  'kabbal', 'cabal', 'qabal', 'zohar', 'sefirot', 'rosicruc', 'rose-croix', 'rosae crucis',
  'astrolog', 'astronom', 'magia', 'magie', 'magic', 'occult', 'paracels', 'lull', 'lulli',
  'philosoph', 'mercur', 'sulphur', 'lapis', 'elixir', 'transmut', 'cabbal', 'theosoph',
  'geomanc', 'géomanc', 'talisman', 'emblem', 'mystic', 'gnos',
];

// ── IIIF manifest parsing (v2 + v3) ─────────────────────────────────────────
function localized(v) {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(localized).filter(Boolean)[0] || null;
  if (typeof v === 'object') {
    // v3 language map { en: [...], none: [...] } or v2 { '@value': ... }
    if (v['@value']) return v['@value'];
    const vals = Object.values(v).flat();
    return vals.find((x) => typeof x === 'string') || null;
  }
  return null;
}
function metaValue(manifest, ...labels) {
  const md = manifest.metadata || [];
  for (const entry of md) {
    const label = (localized(entry.label) || '').toLowerCase();
    if (labels.some((l) => label.includes(l))) return localized(entry.value);
  }
  return null;
}
function parseManifest(m) {
  const label = localized(m.label);
  const canvases = m.items?.length // v3
    || m.sequences?.[0]?.canvases?.length // v2
    || null;
  return {
    title: label,
    author: metaValue(m, 'author', 'creator', 'auteur'),
    date: metaValue(m, 'date', 'datation', 'origin date'),
    language: metaValue(m, 'language', 'langue'),
    canvas_count: canvases,
  };
}

// ── per-host rate limiting (Gallica 429s aggressively even from residential IPs) ─
const HOST_MIN_INTERVAL = { 'gallica.bnf.fr': 2000 }; // ms between requests to a host
const DEFAULT_INTERVAL = 250;
const hostNext = new Map(); // host -> earliest next-request timestamp (chained)

async function hostGate(url) {
  let host = '';
  try { host = new URL(url).host; } catch { return; }
  const interval = HOST_MIN_INTERVAL[host] ?? DEFAULT_INTERVAL;
  const now = Date.now();
  const earliest = Math.max(now, hostNext.get(host) || 0);
  hostNext.set(host, earliest + interval);
  if (earliest > now) await sleep(earliest - now);
}

// Only 2 attempts: persistent Gallica 429s aren't worth a 5x retry storm
// (it exhausts local ephemeral ports → EADDRNOTAVAIL). Failures stay un-enriched
// and are re-tried on the next resume run.
async function fetchManifest(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await hostGate(url);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json,application/ld+json' }, redirect: 'follow' });
      if (res.ok) return await res.json();
      if (res.status === 429 || res.status === 503) { await sleep(2000 * (attempt + 1)); continue; }
      return null;
    } catch { await sleep(800 * (attempt + 1)); }
  }
  return null;
}

function subjectScore(candidate, recoveredTitle) {
  // weight: how many distinct domain queries surfaced it + keyword hits in title
  const qBoost = Math.min((candidate.subjects?.length || 0) * 0.25, 0.75);
  const t = (recoveredTitle || candidate.label || '').toLowerCase();
  const kw = DOMAIN_TERMS.some((term) => t.includes(term)) ? 0.4 : 0;
  return Math.min(1, qBoost + kw + 0.15); // floor 0.15: it came from a domain query at all
}

async function main() {
  console.log(`Harvest triage — ${COMMIT ? 'COMMIT' : 'DRY RUN'}${REENRICH ? ' (reenrich)' : ''}`);
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const candCol = db.collection('harvest_candidates');

  // catalog dedup keys (ARK + normalized title|author)
  const owned = await db.collection('books').find({},
    { projection: { _id: 1, title: 1, author: 1, normalized_title: 1, normalized_author: 1, iiif_manifest: 1, 'image_source.source_url': 1 } }).toArray();
  const ownedArk = new Map();   // ark -> book _id
  const ownedTA = new Map();    // "nt|na" -> book _id
  for (const b of owned) {
    for (const u of [b.iiif_manifest, b.image_source?.source_url]) { const a = arkOf(u || ''); if (a) ownedArk.set(a, b._id); }
    const nt = b.normalized_title || normalizeTitle(b.title || '');
    const na = b.normalized_author || normalizeAuthor(b.author || '');
    if (nt) ownedTA.set(`${nt}|${na}`, b._id);
  }
  console.log(`Catalog dedup keys: ${ownedArk.size} ARKs, ${ownedTA.size} title|author.`);

  // Resume by default: only rows not yet successfully triaged (no triaged_at).
  // Fetch-failures never set triaged_at, so a plain re-run retries them.
  // --reenrich forces all rows.
  const filter = REENRICH ? {} : { triaged_at: { $exists: false } };
  let cursor = candCol.find(filter);
  if (LIMIT) cursor = cursor.limit(LIMIT);
  const todo = await cursor.toArray();
  console.log(`Triaging ${todo.length} candidates${REENRICH ? '' : ' (resume — un-triaged only)'} (concurrency ${CONCURRENCY})…`);

  let done = 0, dupes = 0, weak = 0, enriched = 0, failed = 0;
  let pendingOps = [];
  async function flush() {
    if (!COMMIT || !pendingOps.length) { pendingOps = []; return; }
    try { await candCol.bulkWrite(pendingOps, { ordered: false }); }
    catch (e) { console.error(`\n  [warn] bulkWrite failed (${e.message}); ${pendingOps.length} updates dropped this batch, will retry on resume`); }
    pendingOps = [];
  }

  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const batch = todo.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (c) => {
      const m = await fetchManifest(c.manifest_url);
      const parsed = m ? parseManifest(m) : null;
      if (m) enriched++; else failed++;
      const title = parsed?.title || c.label;
      // dedup: ARK first (works even without a fetched title), then title|author
      let dedup_status = 'novel', matched = null;
      if (c.ark && ownedArk.has(c.ark)) { dedup_status = 'duplicate'; matched = ownedArk.get(c.ark); }
      else if (parsed?.title) {
        const key = `${normalizeTitle(title)}|${normalizeAuthor(parsed?.author || '')}`;
        if (ownedTA.has(key)) { dedup_status = 'duplicate'; matched = ownedTA.get(key); }
      }
      const score = subjectScore(c, title);
      if (dedup_status === 'duplicate') dupes++;
      let decision = c.decision, reason = c.reason;
      if (c.decision === 'pending') { // only auto-suggest on undecided rows
        if (dedup_status === 'duplicate') { decision = 'skip'; reason = `duplicate of ${matched}`; }
        else if (score < 0.4) { decision = 'skip'; reason = 'weak subject relevance'; weak++; }
      }
      // Mark done only if we got a usable result (fetched OR resolved as duplicate
      // by ARK). A pure fetch-failure leaves triaged_at unset so resume retries it.
      const resolved = m || dedup_status === 'duplicate';
      const update = {
        dedup_status, matched_book_id: matched, subject_score: score,
        title: parsed?.title || null, author: parsed?.author || null,
        date: parsed?.date || null, manifest_language: parsed?.language || null,
        canvas_count: parsed?.canvas_count ?? null, decision, reason,
        ...(resolved ? { triaged_at: new Date() } : {}),
      };
      pendingOps.push({ updateOne: { filter: { _id: c._id }, update: { $set: update } } });
      done++;
    }));
    if (pendingOps.length >= 100) await flush();
    process.stdout.write(`\r  ${done}/${todo.length}  (enriched ${enriched}, fetch-fail ${failed}, dup ${dupes}, weak ${weak})   `);
    await sleep(200);
  }
  await flush();
  process.stdout.write('\n');

  const summary = { triaged: done, enriched, fetch_failed: failed, duplicates: dupes, weak_subject: weak };
  console.log(COMMIT ? 'Wrote triage results to ledger.' : 'DRY RUN — no writes.', JSON.stringify(summary));
  if (COMMIT) {
    const pending = await candCol.countDocuments({ decision: 'pending' });
    const novel = await candCol.countDocuments({ dedup_status: 'novel' });
    console.log(`Ledger now: ${pending} pending for curator, ${novel} novel.`);
  }
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
