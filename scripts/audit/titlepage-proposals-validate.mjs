#!/usr/bin/env node
/**
 * EXTERNAL VALIDATION of the title-page proposals.
 *
 * Everything upstream of this file is the system checking itself: the model
 * reads a page, and guards written by the same person who wrote the prompt
 * decide whether to keep the answer. That is not review, it is self-assessment,
 * and its blind spots are correlated with the thing it is assessing.
 *
 * So this asks an authority OUTSIDE the project two questions per proposal:
 *
 *   1. IS THIS A PERSON AT ALL?  Does the proposed name resolve to a human in
 *      Wikidata (P31 = Q5)? A model naming a plausible-sounding person who does
 *      not exist is the failure mode no internal guard can see — the quote is on
 *      the page, the quote contains the name, and the name is nobody.
 *
 *   2. COULD THEY HAVE WRITTEN IT?  Does their lifespan overlap the book's date?
 *      A 1610 imprint attributed to a man who died in 1450 is wrong regardless of
 *      how cleanly the page reads.
 *
 * ABSTAIN LOUDLY. "Not found in Wikidata" is NOT "does not exist" — the corpus is
 * full of minor printers, respondents and provincial physicians who are real and
 * unrecorded there, and treating absence as refutation would reject exactly the
 * obscure attributions this project exists to recover. Unresolved is reported as
 * its own bucket and never counted against a proposal.
 *
 * Read-only. Writes a report, changes nothing.
 *
 * Usage:
 *   node scripts/audit/titlepage-proposals-validate.mjs --n=200
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { MongoClient } from 'mongodb';

const N = Number((process.argv.find((a) => a.startsWith('--n=')) || '').split('=')[1] || 200);
const IN = 'scripts/output/titlepage-attribution-proposals.jsonl';
const OUT = 'scripts/output/titlepage-proposals-validation.json';

const rows = readFileSync(IN, 'utf8').trim().split('\n')
  .map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter((r) => r && r.proposed);

console.log(`proposals on file: ${rows.length}`);

// Sample deterministically across the file rather than taking the head — the
// head is whatever the cursor returned first and is not a random slice.
const step = Math.max(1, Math.floor(rows.length / N));
const sample = rows.filter((_, i) => i % step === 0).slice(0, N);
console.log(`validating a spread sample of ${sample.length}\n`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cache = new Map();

async function wikidataPerson(name) {
  if (cache.has(name)) return cache.get(name);
  const url = 'https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&uselang=en&limit=5&search='
    + encodeURIComponent(name);
  // ERROR IS NOT ABSENCE. The first run of this file recorded 184/200 as "not
  // found in Wikidata" and the real cause was Wikidata RATE-LIMITING us: the
  // catch below swallowed "You are making too many requests" into the same
  // bucket as a genuine miss, and the headline read as a fact about the corpus
  // when it was a fact about my request rate. Errors now get their own verdict
  // and the run backs off. A validator that converts its own failures into
  // negative findings is worse than none.
  let out = { found: false, human: false, qid: null, born: null, died: null, label: null, error: null };
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'SourceLibrary-attribution-validation/1.0 (contact: sourcelibrary.org)' } });
    if (r.status === 429 || r.status >= 500) { out.error = `http_${r.status}`; cache.delete(name); await sleep(5000); return out; }
    const body = await r.text();
    if (!body.trim().startsWith('{')) { out.error = 'throttled_or_html'; await sleep(5000); return out; }
    const j = JSON.parse(body);
    const hits = j?.search ?? [];
    for (const h of hits.slice(0, 3)) {
      const er = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${h.id}.json`, { headers: { 'User-Agent': 'SourceLibrary-attribution-validation/1.0' } });
      const ej = await er.json();
      const e = Object.values(ej.entities ?? {})[0];
      const isHuman = (e?.claims?.P31 ?? []).some((c) => c.mainsnak?.datavalue?.value?.id === 'Q5');
      if (!isHuman) continue;
      const yr = (p) => {
        const t = e?.claims?.[p]?.[0]?.mainsnak?.datavalue?.value?.time;
        if (!t) return null;
        const m = t.match(/^([+-])(\d{4})/);
        return m ? (m[1] === '-' ? -Number(m[2]) : Number(m[2])) : null;
      };
      out = { found: true, human: true, qid: h.id, label: e?.labels?.en?.value ?? h.label, born: yr('P569'), died: yr('P570') };
      break;
    }
    if (!out.found && hits.length) out = { ...out, found: true, human: false, qid: hits[0].id, label: hits[0].label };
  } catch (e) { out.error = e.message?.slice(0, 60) ?? 'unknown'; }
  cache.set(name, out);
  await sleep(1100); // Wikidata throttles hard; 200 names is ~4 min, and that is fine
  return out;
}

// The book's own year field beats scraping a 4-digit run out of the title, which
// matches shelfmarks, volume numbers and dates inside the work's own subject.
const mc = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await mc.connect();
const yearById = new Map();
for (const b of await mc.db('bookstore').collection('books')
  .find({ id: { $in: sample.map((r) => r.book_id) } }, { projection: { id: 1, year: 1, published: 1 } }).toArray()) {
  const y = Number(b.year) || Number(String(b.published ?? '').match(/\b(1[4-9]\d{2}|20\d{2})\b/)?.[1]);
  if (y) yearById.set(b.id, y);
}
await mc.close();
const yearOf = (r) => yearById.get(r.book_id) ?? null;

let human = 0, notHuman = 0, unresolved = 0, errored = 0, dateOk = 0, dateBad = 0, dateUnknown = 0;
const anachronisms = [];
const notPeople = [];
const out = [];

for (const [i, r] of sample.entries()) {
  const wd = await wikidataPerson(r.proposed);
  const year = yearOf(r);
  let dateVerdict = 'unknown';
  if (wd.human && year) {
    const b = wd.born, d = wd.died;
    // BIRTH SIDE ONLY. A book printed before its author was born is impossible.
    // The death side is NOT usable in this corpus and the project already knows
    // it: `author-date-window.mjs` refuses death-side exclusion because a 1925
    // Boethius is a reprint. The first version of this check flagged Ramon Llull
    // (d.1316) on a 1517 Ars Magna as an anachronism — a perfectly ordinary
    // posthumous printing, and precisely the kind of medieval author this
    // library exists to serve. A rule that rejects them is worse than no rule.
    if (b && year < b) dateVerdict = 'impossible';
    else if (b) dateVerdict = 'plausible';
  }
  if (wd.error) errored++;
  else if (wd.human) human++;
  else if (wd.found) { notHuman++; notPeople.push({ ...r, wd }); }
  else unresolved++;
  if (dateVerdict === 'plausible') dateOk++;
  else if (dateVerdict === 'impossible') { dateBad++; anachronisms.push({ title: r.title, proposed: r.proposed, year, born: wd.born, died: wd.died, quoted_line: r.quoted_line, page: r.page_number }); }
  else dateUnknown++;
  out.push({ book_id: r.book_id, proposed: r.proposed, page: r.page_number, page_type: r.page_type, quoted_line: r.quoted_line, wikidata: wd, book_year: year, date_verdict: dateVerdict });
  if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${sample.length}…`);
}

writeFileSync(OUT, JSON.stringify({ checked: sample.length, human, notHuman, unresolved, errored, dateOk, dateBad, dateUnknown, rows: out }, null, 1));

console.log('\n══ EXTERNAL VALIDATION (Wikidata) ══');
console.log(`  checked                         : ${sample.length}`);
console.log(`  resolves to a HUMAN             : ${human}  (${(100 * human / sample.length).toFixed(1)}%)`);
console.log(`  resolves, but not a person      : ${notHuman}`);
console.log(`  not found in Wikidata           : ${unresolved}  ← ABSTAIN, not a refutation`);
console.log(`\n  lifespan vs book date`);
console.log(`     plausible                    : ${dateOk}`);
console.log(`     IMPOSSIBLE                   : ${dateBad}`);
console.log(`     undeterminable               : ${dateUnknown}`);
if (anachronisms.length) {
  console.log('\n  anachronisms (a real defect — the page may name a later editor):');
  for (const a of anachronisms.slice(0, 12)) {
    console.log(`    ${String(a.proposed).slice(0, 28).padEnd(28)} b.${a.born ?? '?'} d.${a.died ?? '?'}  book ${a.year}`);
    console.log(`       ${String(a.title).slice(0, 66)}`);
    console.log(`       p${a.page} «${String(a.quoted_line).replace(/\s+/g, ' ').slice(0, 72)}»`);
  }
}
if (notPeople.length) {
  console.log('\n  proposed values Wikidata says are NOT people:');
  for (const p of notPeople.slice(0, 10)) console.log(`    ${String(p.proposed).slice(0, 34).padEnd(34)} → ${p.wd.label} (${p.wd.qid})`);
}
console.log(`\n  full report: ${OUT}`);
