#!/usr/bin/env node
/**
 * Grounded author reconciliation (GitHub #2218 — step 2 of the #2179 rebuild).
 *
 * Anchors the unanchored authors in the `authors` collection to a Wikidata QID
 * (+ VIAF) using each author's OWN BOOKS as the disambiguator. The hard problem
 * is same-surname people: a name alone resolves "Hans Christian Andersen" to
 * "Jürgen Andersen". The fix is to judge against real authority records using
 * real evidence — the books — rather than guess from the name.
 *
 * Per unanchored author:
 *   1. Pull a few representative books (title / year / language).
 *   2. Search Wikidata for REAL candidate people for the name.
 *   3. flash-lite picks the matching candidate QID — or null — constrained to
 *      the real candidates, using the books + each candidate's dates/description.
 *   4. Life-date gate: reject if a book predates birth−5 or postdates death+50
 *      (catches a confident-but-wrong pick).
 *   5. Write wikidata_id (+ VIAF via P214) onto the author doc.
 * Finally, merge author docs that now share a wikidata_id / viaf_id.
 *
 * Precision rule: UNDER-MERGE before MIS-MERGE. null beats a wrong anchor.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/reconcile-authors-grounded.mjs --limit 20        # dry-run sample
 *   node scripts/maintenance/reconcile-authors-grounded.mjs --apply           # full, writes authors
 */
import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';

const APPLY = process.argv.includes('--apply');
const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i > -1 ? Number(process.argv[i + 1]) : Infinity; })();
const MODEL = 'gemini-3.1-flash-lite';
const UA = 'SourceLibrary-author-reconcile/1.0 (https://sourcelibrary.org; admin@sourcelibrary.org)';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const yearOf = (s) => { const m = String(s || '').match(/\b(\d{3,4})\b/); return m ? Number(m[1]) : null; };

// title-contaminated / bracketed strings can't be looked up by name; skip the
// search and leave them for a name-cleaning pass.
const MALFORMED = /[|\/\[\]]|\b(magia|arcana|oedipus|mundus|musurgia|aurora|monas|medicina|ars |arbor|kabbalah|portae|silentium|symbola|steganographia|hermetica|works|de occulta|de mysteriis)\b/i;

// Search Wikidata under a few name forms — many records are filed surname-first
// ("Manuzio, Aldo") or with honorifics ("Albertus, Magnus, Heiliger"), which the
// raw search misses. Try natural order + an honorific-stripped form, dedup by QID.
function nameVariants(name) {
  const out = new Set();
  const strip = (s) => s.replace(/\b(heiliger|heilige|saint|sankt|der heilige|pseudo|approximately|active|fl\.?|ca\.?|circa)\b/gi, '').replace(/\([^)]*\)/g, '').replace(/\s{2,}/g, ' ').trim();
  out.add(strip(name));
  if (name.includes(',')) {
    const parts = name.split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) out.add(strip(`${parts[1]} ${parts[0]}`)); // "Aldo Manuzio"
  }
  return [...out].filter(s => s.length > 1).slice(0, 3);
}
async function wbSearch(name) {
  const byQid = new Map();
  for (const v of nameVariants(name)) {
    const u = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(v)}&language=en&uselang=en&type=item&format=json&limit=7`;
    const r = await fetch(u, { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error(`wbsearch ${r.status}`);
    for (const s of ((await r.json()).search || [])) if (!byQid.has(s.id)) byQid.set(s.id, { qid: s.id, label: s.label, description: s.description || '' });
    if (byQid.size >= 8) break;
    await sleep(80);
  }
  return [...byQid.values()];
}

async function wbFacts(qid) {
  const u = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims|descriptions&languages=en&format=json`;
  const r = await fetch(u, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`wbget ${r.status}`);
  const e = (await r.json()).entities?.[qid];
  const claims = e?.claims || {};
  const instanceOf = (claims.P31 || []).map(c => c.mainsnak?.datavalue?.value?.id);
  const time = (p) => { const t = claims[p]?.[0]?.mainsnak?.datavalue?.value?.time; return t ? Number(String(t).replace(/^[+-]/, '').slice(0, 4)) : null; };
  return {
    isHuman: instanceOf.includes('Q5'),
    viaf: claims.P214?.[0]?.mainsnak?.datavalue?.value || null,
    birth: time('P569'),
    death: time('P570'),
    description: e?.descriptions?.en?.value || '',
  };
}

const mc = new MongoClient(process.env.MONGODB_URI); await mc.connect();
const db = mc.db('bookstore'); const authors = db.collection('authors'); const books = db.collection('books');
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
if (!GEMINI_KEY) { console.error('GEMINI_API_KEY not set'); process.exit(1); }
const model = new GoogleGenerativeAI(GEMINI_KEY).getGenerativeModel({ model: MODEL });

console.log(`grounded author reconciliation — ${APPLY ? 'APPLY' : 'DRY-RUN'}${Number.isFinite(LIMIT) ? ` (limit ${LIMIT})` : ''}\n`);

const targets = await authors.find(
  { viaf_id: null, wikidata_id: null },
  { projection: { canonical_name: 1, variants: 1, book_count: 1 } },
).sort({ book_count: -1 }).toArray();
const clean = targets.filter(t => !MALFORMED.test(t.canonical_name));
const queue = clean.slice(0, Number.isFinite(LIMIT) ? LIMIT : clean.length);
console.log(`unanchored authors: ${targets.length} | malformed skipped: ${targets.length - clean.length} | attempting: ${queue.length}\n`);

let anchored = 0, nulled = 0, gated = 0, errored = 0;
const decisions = [];
for (const t of queue) {
  try {
    const bks = await books.find({ author: { $in: t.variants }, visible: { $ne: false } },
      { projection: { _id: 0, title: 1, display_title: 1, year: 1, published: 1, language: 1 } }).limit(3).toArray();
    const evidence = bks.map(b => `"${(b.display_title || b.title || '').slice(0, 80)}"${b.year || b.published ? ` (${b.year || b.published})` : ''}${b.language ? ` [${b.language}]` : ''}`).join('; ') || '(no book metadata)';
    const cands = await wbSearch(t.canonical_name);
    await sleep(120);
    if (!cands.length) { nulled++; decisions.push(`  ∅ no-wikidata  "${t.canonical_name}"`); continue; }

    const prompt = `Identify which Wikidata person (if any) wrote the book(s) attributed to this author. Choose ONLY from the candidates; if none is clearly the same person, return null. Use the book title/year/language as evidence — an author's dates must be consistent with their books. Do NOT pick a same-surname different person.

AUTHOR (as recorded): ${JSON.stringify(t.canonical_name)}${t.variants.length > 1 ? `\nALSO RECORDED AS: ${t.variants.filter(v => v !== t.canonical_name).slice(0, 5).map(v => JSON.stringify(v)).join(', ')}` : ''}
THEIR BOOK(S): ${evidence}

CANDIDATES:
${cands.map((c, i) => `${i + 1}. ${c.qid} — ${c.label}${c.description ? ` — ${c.description}` : ''}`).join('\n')}

Return STRICT JSON: {"qid":"Q...."|null,"reason":"<≤12 words>"}`;
    const res = await model.generateContent({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } });
    const pick = JSON.parse(res.response.text());
    const chosen = pick.qid && cands.find(c => c.qid === pick.qid);
    if (!chosen) { nulled++; decisions.push(`  ∅ no-match     "${t.canonical_name}" — ${pick.reason || ''}`); continue; }

    // life-date gate against the real entity. ONLY the lower bound is valid here:
    // a book cannot predate its author's birth. The upper bound is meaningless —
    // this library re-hosts posthumous reprints / incunabula (Sacrobosco d.1256
    // printed 1480), so a late publication year is normal, not a mismatch.
    const facts = await wbFacts(chosen.qid); await sleep(120);
    const by = Math.min(...bks.map(b => yearOf(b.year ?? b.published)).filter(Boolean), Infinity);
    if (facts.birth && Number.isFinite(by) && by < facts.birth - 5) {
      gated++; decisions.push(`  ⚠ date-gate    "${t.canonical_name}" → ${chosen.label} (b${facts.birth}) vs book ${by} (predates birth)`); continue;
    }
    if (!facts.isHuman) { nulled++; decisions.push(`  ∅ not-human    "${t.canonical_name}" → ${chosen.label}`); continue; }

    anchored++;
    decisions.push(`  ✓ ${chosen.qid}${facts.viaf ? ' viaf' : '     '}  "${t.canonical_name}" → ${chosen.label} (${facts.birth ?? '?'}–${facts.death ?? '?'})`);
    if (APPLY) await authors.updateOne({ _id: t._id }, { $set: { wikidata_id: chosen.qid, viaf_id: facts.viaf, anchored_by: 'grounded-reconciliation', wikidata_birth_year: facts.birth ?? null, wikidata_death_year: facts.death ?? null } });
  } catch (e) { errored++; decisions.push(`  ! error        "${t.canonical_name}" — ${e.message}`); await sleep(400); }
}

console.log(decisions.join('\n'));
console.log(`\nanchored ${anchored} | null ${nulled} | date-gated ${gated} | errors ${errored}  (of ${queue.length})`);

// merge author docs that now share an authority id (only meaningful with --apply)
if (APPLY && anchored) {
  for (const field of ['wikidata_id', 'viaf_id']) {
    const groups = await authors.aggregate([
      { $match: { [field]: { $ne: null } } },
      { $group: { _id: `$${field}`, ids: { $push: '$_id' }, n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
    ]).toArray();
    for (const g of groups) {
      const docs = await authors.find({ _id: { $in: g.ids } }).sort({ book_count: -1 }).toArray();
      const [keep, ...fold] = docs;
      const merged = {
        variants: [...new Set([...keep.variants, ...fold.flatMap(d => d.variants)])],
        variant_slugs: [...new Set([...keep.variant_slugs, ...fold.flatMap(d => d.variant_slugs)])],
        entity_ids: [...new Set([...keep.entity_ids, ...fold.flatMap(d => d.entity_ids)])],
        book_count: docs.reduce((s, d) => s + d.book_count, 0),
        merged_from: fold.map(d => d.canonical_name),
      };
      await authors.updateOne({ _id: keep._id }, { $set: merged });
      await authors.deleteMany({ _id: { $in: fold.map(d => d._id) } });
      console.log(`  merged on ${field}=${g._id}: ${fold.map(d => `"${d.canonical_name}"`).join(', ')} → "${keep.canonical_name}"`);
    }
  }
  console.log(`\nauthors now: ${await authors.countDocuments()}`);
}
await mc.close();
