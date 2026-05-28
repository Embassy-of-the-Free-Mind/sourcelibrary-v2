#!/usr/bin/env node
/**
 * Backfill author_held_count + author_held_sample_slug on index_catalog_entries.
 *
 * For each distinct (author, author_normalized) identity in the catalog:
 *   1. Surname-search SL books in Mongo (uses the same regex pattern as
 *      backfill-catalog-ustc-sl-links.mjs so behaviour is consistent).
 *   2. Gemini-verify the identity: is the Index entry author the same person
 *      as the SL books? Catches surname collisions (Stephanus the Henri vs
 *      Stephanus the Robert; Cellarius the Reformer vs Cellarius the
 *      astronomer; Faber the Lefèvre vs Faber the Marburg).
 *   3. If verified, count visible+ocr'd SL books by that author and write
 *      the count + sample_slug to every entry with that identity.
 *   4. If NOT verified (different people), still write count=0 explicitly so
 *      we don't recompute on every run.
 *
 * Cache is per (author_normalized → author-snippet). Cost: ~one Gemini call
 * per distinct identity (a few thousand at most) at $0.0001/call.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/backfill-catalog-author-held.mjs            # dry-run
 *   node scripts/backfill-catalog-author-held.mjs --apply
 *   node scripts/backfill-catalog-author-held.mjs --apply --limit 100   # smoke test
 *
 * Idempotent. Re-runnable. Skips entries that already have author_held_count
 * unless --force.
 */
import { MongoClient } from 'mongodb';

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : 0;
const concArg = process.argv.indexOf('--concurrency');
const CONCURRENCY = Math.max(1, concArg > -1 ? Number(process.argv[concArg + 1]) : 8);

const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = APPLY ? process.env.SUPABASE_SERVICE_ROLE_KEY : process.env.SUPABASE_ANON_KEY;
if (!SUPA_URL || !SUPA_KEY) { console.error('SUPABASE_* missing'); process.exit(1); }
const H = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' };

const GEMINI_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_KEY) { console.error('GEMINI_API_KEY missing'); process.exit(1); }
const VERIFY_MODEL = 'gemini-3.1-flash-lite';

async function supa(method, path, body) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const opts = { method, headers: H };
      if (body !== undefined) opts.body = JSON.stringify(body);
      const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, opts);
      if (!r.ok) {
        const text = (await r.text()).slice(0, 400);
        if (r.status >= 500 && attempt < 4) { await new Promise(r => setTimeout(r, 1000 * 2 ** attempt)); continue; }
        throw new Error(`${method} ${path} → ${r.status}: ${text}`);
      }
      return r.status === 204 ? null : r.json();
    } catch (e) {
      if (attempt === 4 || !/ETIMEDOUT|ECONNRESET|fetch failed/i.test(String(e))) throw e;
      await new Promise(r => setTimeout(r, 2000 * 2 ** attempt));
    }
  }
}

// ─── Gemini identity verifier ────────────────────────────────────────────

const VERIFY_PROMPT = `You decide whether a list of Source Library books are by THE SAME PERSON as an entry on a historical Index of prohibited books.

INPUT:
  - Index entry: an author name as it appears in a 16th-17th c. printed Index, plus a sample title and condemnation year for disambiguation.
  - Candidate SL books: title, author string, year — a few examples from the surname-matched set.

Decide whether the SL books overall represent the same person as the Index entry. Beware:
  - Latin name inversions ("Iordanus Brunus" ↔ "Bruno, Giordano") — same person
  - Latinizations / toponyms ("Erasmus Roterodamus" ↔ "Desiderius Erasmus") — same person
  - Long-s OCR errors ("Brandeburgenfis" → "Brandeburgensis") — same person
  - Family-name collisions: Stephanus = Estienne family (Henri ≠ Robert ≠ Charles ≠ Paul are DIFFERENT people)
  - Surname collisions across centuries (Cellarius 1564 Reformer ≠ Cellarius 1660 astronomer)
  - "Faber" — could be Lefèvre d'Étaples, or Johann Faber of Heilbronn, or others — DIFFERENT people

If the SL books represent a MIX of people (e.g. multiple Estiennes), respond same_person:false with reasoning.

Output JSON only:
{ "same_person": true | false, "confidence": "high"|"medium"|"low", "reasoning": "short" }`;

const verifyCache = new Map();
let verifyCalls = 0;
let verifyCost = 0;

async function geminiVerify(entry, books) {
  const cacheKey = JSON.stringify({
    a: entry.author, n: entry.author_normalized,
    bk: books.slice(0, 3).map(b => [b.author, b.title?.slice(0, 40), b.year]),
  });
  if (verifyCache.has(cacheKey)) return verifyCache.get(cacheKey);

  const userContent = `Index entry:
  - Author (as printed): ${entry.author}
  - Sample title: ${(entry.title || '').slice(0, 80)}
  - Condemnation year: ${entry.condemnation_year || 'unknown'}

Candidate SL books (sample of ${books.length}):
${books.slice(0, 5).map(b => `  - "${(b.title || '').slice(0, 70)}" — ${b.author || '?'} (${b.year || '?'})`).join('\n')}`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: userContent }] }],
    systemInstruction: { parts: [{ text: VERIFY_PROMPT }] },
    generationConfig: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 256 },
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${VERIFY_MODEL}:generateContent?key=${GEMINI_KEY}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
      if (r.status === 429 || r.status === 503) { await new Promise(res => setTimeout(res, 1000 * 2 ** attempt)); continue; }
      if (!r.ok) throw new Error(`Gemini ${r.status}`);
      const data = await r.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('no text');
      const parsed = JSON.parse(text);
      const usage = data.usageMetadata || {};
      verifyCost += (usage.promptTokenCount || 0) / 1e6 * 0.10 + (usage.candidatesTokenCount || 0) / 1e6 * 0.40;
      verifyCalls++;
      verifyCache.set(cacheKey, parsed);
      return parsed;
    } catch (e) {
      if (attempt === 2) {
        const fallback = { same_person: false, confidence: 'low', reasoning: `verify failed: ${String(e).slice(0, 80)}` };
        verifyCache.set(cacheKey, fallback);
        return fallback;
      }
      await new Promise(res => setTimeout(res, 1000));
    }
  }
}

// ─── SL surname lookup (Mongo) ───────────────────────────────────────────

function fixLongS(s) { return (s || '').replace(/f/g, 's').replace(/F/g, 'S'); }

// Latin/Vernacular alias map — surname → additional surnames to also try.
// Covers the top-fragmented identities surfaced by the audit. Conservative:
// only include cases where the alias is unambiguous in scholarly use.
// Lowercase keys + values.
const SURNAME_ALIASES = {
  roterodamus: ['erasmus'],
  erasmus:     ['roterodamus'],
  'erasmus roterodamus': ['erasmus', 'roterodamus'],
  molinaeus:   ['molineus', 'molinae', 'moulin', 'dumoulin'],
  molinæus:    ['molinaeus', 'molineus', 'moulin'],
  molineus:    ['molinaeus', 'moulin'],
  faber:       ['fabri', 'lefevre', 'lefèvre', 'stapulensis'],
  stapulensis: ['faber', 'lefevre', 'lefèvre'],
  zuingerus:   ['zwinger', 'zuinger'],
  zwingerus:   ['zwinger', 'zuinger'],
  // Greek Patristic
  chrysoftomus: ['chrysostomus'],
  // Italian / Latin
  giorgio:     ['zorzi'],
  zorzi:       ['giorgio'],
};

const slCache = new Map();
async function slBooksBySurname(db, s) {
  if (!s) return [];
  if (slCache.has(s)) return slCache.get(s);
  const lower = s.toLowerCase();
  const variants = new Set([lower]);
  const corrected = fixLongS(lower);
  if (corrected !== lower) variants.add(corrected);
  for (const alias of (SURNAME_ALIASES[lower] || [])) variants.add(alias.toLowerCase());

  const variantList = [...variants];
  const re = new RegExp(`(^|[^a-z])(${variantList.map(v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'i');
  const books = await db.collection('books').find(
    {
      $or: [{ author: re }, { author_normalized: re }, { canonical_author_normalized: re }],
      visible: { $ne: false },
      pages_count: { $gt: 0 },
      resource_type: { $nin: ['artwork', 'emblem', 'image', 'illustration', 'manuscript-fragment'] },
    },
    { projection: { _id: 1, id: 1, slug: 1, title: 1, author: 1, year: 1 } },
  ).limit(80).toArray();
  slCache.set(s, books);
  return books;
}

// ─── Main loop ───────────────────────────────────────────────────────────

// Cluster key: (author_normalized + raw_author). Sub-grouping by raw_author
// is essential for Latin-family names where the same surname covers
// different individuals (Stephanus, Henricus ≠ Stephanus, Robertus; the
// existing author_normalized collapses them but they're different people).
function clusterKey(r) {
  return `${r.author_normalized}::${(r.author || '').trim().toLowerCase()}`;
}

async function fetchDistinctIdentities() {
  const byKey = new Map(); // key → { entry, count, surname, alreadyDone }
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const path = `index_catalog_entries?select=id,author,author_normalized,title,condemnation_year,author_held_count&author_normalized=not.is.null&author_normalized=neq.&order=id&limit=${PAGE}&offset=${offset}`;
    const rows = await supa('GET', path);
    if (!rows.length) break;
    for (const r of rows) {
      const sn = r.author_normalized;
      if (!sn || sn.length < 3) continue;
      const k = clusterKey(r);
      const alreadyDone = !FORCE && r.author_held_count !== null;
      const cur = byKey.get(k);
      if (!cur) byKey.set(k, { entry: r, count: 1, surname: sn, alreadyDone });
      else {
        cur.count++;
        // Prefer the entry with a non-trivial title for better verifier context
        if ((cur.entry.title?.length || 0) < (r.title?.length || 0)) cur.entry = r;
        if (!alreadyDone) cur.alreadyDone = false;
      }
    }
    if (rows.length < PAGE) break;
    offset += rows.length;
  }
  return byKey;
}

async function main() {
  console.log(`author_held backfill — mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}${FORCE ? ' (force)' : ''}${LIMIT ? ` (limit ${LIMIT})` : ''}`);

  const mc = new MongoClient(process.env.MONGODB_URI);
  await mc.connect();
  const db = mc.db('bookstore');

  console.log('\nScanning distinct identities…');
  const identities = await fetchDistinctIdentities();
  const todo = [...identities.entries()].filter(([, v]) => !v.alreadyDone).sort((a, b) => b[1].count - a[1].count);
  console.log(`Found ${identities.size} distinct author_normalized keys; ${todo.length} need processing.`);

  const work = LIMIT ? todo.slice(0, LIMIT) : todo;

  let nVerified = 0;
  let nRejected = 0;
  let nNoBooks = 0;
  let totalEntriesUpdated = 0;
  let nDone = 0;
  const samples = [];

  const startedAt = Date.now();
  const queue = [...work];

  async function worker() {
    while (queue.length) {
      const item = queue.shift();
      if (!item) break;
      const [key, { entry, count, surname }] = item;

      const books = await slBooksBySurname(db, surname);

      let authorHeldCount = 0;
      let sampleSlug = null;
      let sampleId = null;
      let verdict = 'no-sl-books';

      if (books.length > 0) {
        const v = await geminiVerify(entry, books);
        if (v.same_person) {
          const sorted = [...books].sort((a, b) => (b.year ? 1 : 0) - (a.year ? 1 : 0) || (b.title?.length || 0) - (a.title?.length || 0));
          authorHeldCount = books.length;
          sampleSlug = sorted[0].slug || null;
          sampleId = String(sorted[0]._id);
          verdict = `held=${authorHeldCount}`;
          nVerified++;
        } else {
          verdict = `rejected (${v.reasoning?.slice(0, 50)})`;
          nRejected++;
        }
      } else {
        nNoBooks++;
      }

      if (samples.length < 15) {
        samples.push({ key, count, books: books.length, verdict, sampleSlug });
      }

      if (APPLY) {
        const rawAuthor = entry.author;
        let path;
        if (rawAuthor === null || rawAuthor === undefined) {
          path = `index_catalog_entries?author_normalized=eq.${encodeURIComponent(surname)}&author=is.null`;
        } else {
          path = `index_catalog_entries?author_normalized=eq.${encodeURIComponent(surname)}&author=eq.${encodeURIComponent(rawAuthor)}`;
        }
        try {
          await supa('PATCH', path, {
            author_held_count: authorHeldCount,
            author_held_sample_slug: sampleSlug,
            author_held_sample_id: sampleId,
          });
          totalEntriesUpdated += count;
        } catch (e) {
          console.error(`\nPATCH failed for ${key}: ${String(e).slice(0, 200)}`);
        }
      }

      nDone++;
      if (nDone % 25 === 0 || nDone === work.length) {
        const pct = (nDone / work.length * 100).toFixed(1);
        const elapsed = (Date.now() - startedAt) / 1000;
        const rate = nDone / elapsed;
        const eta = (work.length - nDone) / rate;
        process.stdout.write(`\r  ${nDone}/${work.length} (${pct}%)  verified=${nVerified}  rejected=${nRejected}  no-books=${nNoBooks}  Gemini=${verifyCalls}  $${verifyCost.toFixed(3)}  eta=${eta.toFixed(0)}s   `);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  console.log();

  console.log('\n─── samples ───');
  for (const s of samples) {
    console.log(`  ${s.key.padEnd(28)} ${String(s.count).padStart(5)} entries  ${String(s.books).padStart(3)} SL books  →  ${s.verdict}${s.sampleSlug ? ` (${s.sampleSlug})` : ''}`);
  }

  console.log('\n─── summary ───');
  console.log(`  identities processed     : ${work.length}`);
  console.log(`  verified author-held     : ${nVerified}`);
  console.log(`  rejected (diff person)   : ${nRejected}`);
  console.log(`  no SL books at all       : ${nNoBooks}`);
  console.log(`  Gemini calls / cost      : ${verifyCalls} / $${verifyCost.toFixed(4)}`);
  console.log(`  total entries updated    : ${APPLY ? totalEntriesUpdated : '(dry-run)'}`);

  await mc.close();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
