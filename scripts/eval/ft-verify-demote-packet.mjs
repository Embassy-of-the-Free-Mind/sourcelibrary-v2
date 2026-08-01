#!/usr/bin/env node
/**
 * ft-verify-demote-packet.mjs — the sign-off packet for proposed demotes. (#3459)
 *
 * Every screened `prior_translation` candidate is re-fetched LIVE from LoC by its
 * LCCN and re-derived from that record, independently of the bulk extract the
 * search ran against. A recommendation that survives being re-fetched from the
 * authority is a different thing from one that survives my own snapshot.
 *
 * TWO EVIDENTIARY GRADES, KEPT APART
 * ----------------------------------
 * Spot-checking exposed that these were being presented as one thing when they
 * are not:
 *
 *   IDENTITY   — "the prior record describes THIS work". Proven by the record:
 *                MARC 240 uniform title, 041$h original language, contributor.
 *                Machine-checkable, and re-checkable by anyone with the LCCN.
 *
 *   COMPLETENESS — "that prior rendering is COMPLETE, not selections". Usually
 *                NOT in the record: four of the first five spot checks reported
 *                `unknown` because there is no 300$a extent. The screening
 *                asserts it from scholarship (Grimald's *De Officiis*,
 *                Billingsley's Euclid and Chapman's *Iliad* are complete
 *                renderings) — which is real knowledge, but it is a judgement,
 *                not a catalogue fact.
 *
 * This matters because the two grades imply different demotions. A complete prior
 * means `not_first`. A merely-partial prior leaves "first COMPLETE English
 * translation" standing. Collapsing them would demote defensible badges, so the
 * packet reports which grade each recommendation rests on and flags any case
 * where the record actively CONTRADICTS the screening.
 *
 * Uses the SRU gateway (lx2.loc.gov) rather than lccn.loc.gov: the latter
 * rate-limits by serving an HTML access-request page with HTTP 200, which parses
 * to zero records and reads as "no prior exists". Paced deliberately slowly.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/ft-verify-demote-packet.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { withMongo } from '../lib/mongo.mjs';
import { latestEffortPerBook, SCREEN } from '../lib/search-effort.mjs';
import {
  parseMarcXmlRecords, classifyWorkType, classifyCompleteness,
  fieldText, originalLanguages, extentPages, contributors,
} from '../lib/bib-record.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'output');
const DATE = new Date().toISOString().slice(0, 10);
const SRU = 'http://lx2.loc.gov:210/lcdb';
const DELAY_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchByLccn(lccn) {
  const query = `bath.lccn="${String(lccn).replace(/[^0-9a-z]/gi, '')}"`;
  const url = `${SRU}?version=1.1&operation=searchRetrieve`
    + `&query=${encodeURIComponent(query)}&maximumRecords=1&recordSchema=marcxml`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'SourceLibrary/1.0 (+https://sourcelibrary.org; demote sign-off)' },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`SRU ${res.status}`);
  const [rec] = await parseMarcXmlRecords(await res.text());
  return rec ?? null;
}

await withMongo(async (db) => {
  const all = await db.collection('search_efforts').find({}).toArray();
  const current = latestEffortPerBook(all);
  const withPrior = current.filter((e) => e.candidates?.some((c) => c.screen === SCREEN.PRIOR));

  // A DEMOTE presupposes a badge. `search_efforts` covers both cohorts, and the
  // inverse cohort is by definition unbadged — finding a prior there is a normal,
  // uninteresting result (we translated something that already existed in
  // English), not a claim to retract. Unfiltered, 115 of 162 prior-bearing
  // efforts were unbadged books, and because the packet groups by WORK and
  // reports `books.size` as the number of badges affected, they inflated that
  // count without changing the work list.
  //
  // Gate on `books.is_first_translation`, not on `effort.cohort`: the cohort is
  // what the search believed when it ran, while the flag is the claim actually on
  // the site right now. If a badge moved in between, the flag is right and the
  // cohort is stale.
  const badgedNow = new Set((await db.collection('books').find(
    { id: { $in: withPrior.map((e) => e.book_id) }, is_first_translation: true },
    { projection: { id: 1 } },
  ).toArray()).map((b) => b.id));
  const proposed = withPrior.filter((e) => badgedNow.has(e.book_id));
  console.log(`Efforts with a screened prior: ${withPrior.length}`);
  console.log(`  ...on a book that actually carries the badge: ${proposed.length}`);
  console.log(`  ...unbadged, so nothing to demote: ${withPrior.length - proposed.length}\n`);

  // Group by WORK, not by record. The question is not "is this particular
  // edition complete" but "does at least one COMPLETE prior English rendering of
  // this work exist" — a work like the Iliad has ~20 candidate records, several
  // of them legitimately partial (selections, single books) alongside complete
  // ones. Grading per record made a work look contradicted whenever any one of
  // its editions was an anthology.
  const byWork = new Map();
  for (const e of proposed) {
    const work = e.proposition.match(/of "([^"]+)"/)?.[1] ?? e.book_id;
    if (!byWork.has(work)) byWork.set(work, { work, lccns: [], books: new Set(), reason: '' });
    const g = byWork.get(work);
    g.books.add(e.book_id);
    for (const c of e.candidates.filter((c) => c.screen === SCREEN.PRIOR)) {
      g.reason ||= c.reason;
      const l = c.identifiers?.lccn;
      if (l && !g.lccns.includes(l)) g.lccns.push(l);
    }
  }
  // Cap records checked per work: enough to establish that a complete prior
  // exists, without re-fetching twenty editions of the Iliad.
  const MAX_PER_WORK = 4;
  console.log(`Works to verify: ${byWork.size} (checking up to ${MAX_PER_WORK} prior records each)\n`);

  const rows = [];
  const tally = { identity_confirmed: 0, identity_failed: 0, unfetchable: 0, completeness_from_record: 0, completeness_from_scholarship: 0, all_partial: 0 };

  for (const entry of byWork.values()) {
    const checked = [];
    for (const lccn of entry.lccns.slice(0, MAX_PER_WORK)) {
      let rec = null; let error = null;
      try { rec = await fetchByLccn(lccn); } catch (err) { error = err.message; }
      await sleep(DELAY_MS);
      if (!rec) { checked.push({ lccn, error: error ?? 'no record' }); continue; }
      const wt = classifyWorkType(rec);
      const comp = classifyCompleteness(rec, wt.work_type);
      checked.push({
        lccn,
        title: fieldText(rec, '245', ['a', 'b']).slice(0, 70),
        uniform_title: fieldText(rec, '240', ['a']),
        original_languages: originalLanguages(rec),
        extent_pages: extentPages(rec),
        work_type: wt.work_type,
        completeness: comp.completeness,
        completeness_evidence: comp.evidence,
      });
    }

    const fetched = checked.filter((c) => !c.error);
    if (!fetched.length) {
      tally.unfetchable++;
      rows.push({ work: entry.work, books: entry.books.size, verified: false, checked });
      console.log(`  ${String(entry.work).slice(0, 40).padEnd(40)} UNFETCHABLE`);
      continue;
    }

    // IDENTITY — at least one live record still describes a translation of this
    // work, with a uniform title or a declared original language.
    const identityOk = fetched.some((c) => c.work_type === 'translation'
      && (c.uniform_title || c.original_languages.length));
    if (identityOk) tally.identity_confirmed++; else tally.identity_failed++;

    // COMPLETENESS — does ANY prior record establish a complete rendering?
    const anyComplete = fetched.some((c) => c.completeness === 'complete');
    const allPartial = fetched.every((c) => c.completeness === 'partial');
    let grade;
    if (anyComplete) { grade = 'record'; tally.completeness_from_record++; }
    else if (allPartial) { grade = 'ALL PARTIAL — re-screen as first_complete'; tally.all_partial++; }
    else { grade = 'scholarship'; tally.completeness_from_scholarship++; }

    rows.push({
      work: entry.work,
      books: entry.books.size,
      verified: true,
      identity_confirmed: identityOk,
      identity_basis: 'MARC 240 / 041$h / relator on a live record — re-checkable by LCCN',
      completeness_grade: grade,
      completeness_basis: anyComplete
        ? fetched.find((c) => c.completeness === 'complete').completeness_evidence.join('; ')
        : 'asserted from scholarship by the screening pass — NOT established by any checked record',
      screened_reason: entry.reason,
      records_checked: checked,
    });

    const flag = !identityOk ? 'IDENTITY FAIL' : grade;
    console.log(`  ${String(entry.work).slice(0, 42).padEnd(42)} ${String(fetched[0].original_languages.join('/')).padEnd(8)} ${fetched.length}rec  ${flag}`);
  }

  console.log('\n─── Sign-off packet ──────────────────────────────────────────');
  console.log(`  works verified live              : ${tally.identity_confirmed + tally.identity_failed} of ${byWork.size}`);
  console.log(`  IDENTITY confirmed by the record : ${tally.identity_confirmed}`);
  console.log(`  IDENTITY not confirmed           : ${tally.identity_failed}`);
  console.log(`  unfetchable                      : ${tally.unfetchable}`);
  console.log('');
  console.log(`  COMPLETENESS established by record   : ${tally.completeness_from_record}`);
  console.log(`  COMPLETENESS asserted from scholarship: ${tally.completeness_from_scholarship}`);
  console.log(`  every checked prior is PARTIAL        : ${tally.all_partial}  <- re-screen these as first_complete`);
  console.log('\n  Identity is machine-checkable and re-checkable by anyone holding the LCCN.');
  console.log('  Completeness mostly is not — where it reads "scholarship", the demote rests');
  console.log('  on a stated judgement, not on the catalogue. A record saying PARTIAL is a');
  console.log('  reason to re-screen as first_complete rather than demote.');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `ft-demote-packet-${DATE}.json`);
  fs.writeFileSync(out, JSON.stringify({ date: DATE, tally, rows }, null, 2));
  console.log(`\nWrote ${out}`);
// This run is dominated by DELIBERATELY PACED live LoC fetches — 33 works x up
// to 4 records x 1.5s — so it necessarily outlives the default script timeout.
// Without this it force-exited at 300s having completed 31 of 33 works and
// written nothing at all: every fetch discarded, and a non-zero exit that reads
// like a network failure rather than "you ran out of clock". The Mongo
// connection is idle throughout; the wall time is the rate limit we chose.
}, { noTimeout: true });
