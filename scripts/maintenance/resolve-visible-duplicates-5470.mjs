#!/usr/bin/env node
// PRIOR ART: scripts/audit/keeper-choice-triage.mjs (recommends keepers for both-visible clusters,
// never writes — its buckets informed the review); src/app/api/admin/duplicates/route.ts POST (the
// hide convention used here: setPublication hidden/duplicate + duplicateOf, from:['public']);
// scripts/maintenance/duplicate-integrity-check.mjs (validates the duplicate_of graph afterwards).
// None applies a reviewed verdict file with write-time guards, or repairs a false edition_key.
//
// resolve-visible-duplicates-5470 — apply the reviewed verdicts for the 231 edition_key groups with
// more than one visible copy (#5470 step 4). Verdicts: scripts/output/retire-warehouse/verdicts/*.jsonl
// (one line per group, produced by a read-only review that opened page images where ambiguous).
//
// HIDES (CONFIRMED_DUPLICATE, PARTIAL) go through the publication writer as hidden/duplicate with
// duplicate_of = keeper — reversible, the corpus convention. Every hide is RE-CHECKED at write time
// and skipped (listed for a human) unless all hold:
//   - keeper and copy are both public right now;
//   - keeper's READABLE translated pages (page_number > 0) >= the copy's — negative page numbers are
//     parked originals readers never see and inflated the review-time counts on BPH records;
//   - the copy does not carry is_first_translation while the keeper lacks it;
//   - the copy is not a BPH record hidden behind a non-BPH keeper (partner reading rooms);
//   - the group is not on the human-review list below.
// KEY FIXES (FALSE_GROUP, PARTIAL) change title / display_title / year / published only where the
// current value still equals the reviewed `from`, never on BPH records (a catalogue sync can revert
// them), and recompute the identity fields with computeIdentityFields() in the same write so the
// stored key never drifts. A title change on a book with no display_title first copies the old title
// into display_title, so what readers see does not change.
//
//   node --env-file=.env.production.local scripts/maintenance/resolve-visible-duplicates-5470.mjs [--limit=20] [--apply]

import fs from 'fs';
import { MongoClient } from 'mongodb';
import { setPublication } from '../lib/publication.mjs';
import { computeIdentityFields } from '../lib/identity-fields.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const APPLY = process.argv.includes('--apply');
const LIMIT = parseInt((process.argv.find((a) => a.startsWith('--limit=')) || '--limit=0').slice(8), 10) || 0;
const DIR = 'scripts/output/retire-warehouse';
const LOG = `${DIR}/dup-resolve-${APPLY ? 'apply' : 'dryrun'}${LIMIT ? `-${LIMIT}` : ''}.jsonl`;
const BY = 'script:resolve-visible-duplicates-5470';
const SWEEP = 'retire-warehouse-5470-dups';

// Groups the reviewers sent to a human even where a verdict exists (see the #5470 table).
const HUMAN = new Map(Object.entries({
  13: 'member is a different work (Aldine Latin grammar) mis-catalogued as Didone; author/year wrong too',
  44: 'copy has a second work bound in (Manuzio, Lettere volgari)', 66: 'copy has a second work bound in (Lead, Ark of Faith)',
  106: 'BPH record is a bound volume with Responsio Fluddana; IA copy has a Zenodo DOI',
  127: 'IA copy also holds Schelling Einleitung (1799), no other copy has it', 147: '1957 3rd edition — rights',
  208: 'copy to hide carries contemporary manuscript marginalia', 212: 'match rests on metadata only (sparse OCR)',
  216: 'copy to hide carries the BPH catalogue UBN', 222: 'copy to hide carries the BPH catalogue UBN',
  224: 'keeper forced by translation count is a degraded microfilm', 227: 'facsimile album vs original',
  10: 'same text, different issues (dedication vs disputation) — judgement call',
}));

function readable(db, id) {
  return db.collection('pages').aggregate([
    { $match: { book_id: id, page_number: { $gt: 0 } } },
    { $group: { _id: null, tr: { $sum: { $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$translation.data', ''] } }, 20] }, 1, 0] } } } },
  ]).toArray().then((r) => r[0]?.tr ?? 0);
}

async function main() {
  const verdicts = fs.readdirSync(`${DIR}/verdicts`).filter((f) => f.endsWith('.jsonl')).sort()
    .flatMap((f) => fs.readFileSync(`${DIR}/verdicts/${f}`, 'utf8').trim().split('\n').map((l) => JSON.parse(l)))
    .sort((a, b) => a.group - b.group);
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const B = db.collection('books');
  const log = fs.createWriteStream(LOG, { flags: 'a' });
  const proj = { id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, visible: 1, is_first_translation: 1, 'image_source.provider': 1, edition_key: 1, edition_key_quality: 1, normalized_title: 1, normalized_author: 1 };
  const tally = { hidden: 0, hide_skipped: 0, fixed: 0, fix_skipped: 0, human: 0 };
  let actions = 0;

  for (const v of verdicts) {
    if (LIMIT && actions >= LIMIT) break;
    const base = { group: v.group, key: v.key, verdict: v.verdict };
    if (v.verdict === 'UNSURE' || HUMAN.has(String(v.group))) {
      tally.human++;
      log.write(JSON.stringify({ ...base, outcome: 'human', why: HUMAN.get(String(v.group)) || v.evidence }) + '\n');
      continue;
    }
    // --- hides
    if ((v.verdict === 'CONFIRMED_DUPLICATE' || v.verdict === 'PARTIAL') && v.keeper && v.hide?.length) {
      const keeper = await B.findOne({ id: v.keeper }, { projection: proj });
      const kTr = keeper ? await readable(db, keeper.id) : -1;
      for (const hid of v.hide) {
        actions++;
        const copy = await B.findOne({ id: hid }, { projection: proj });
        const rec = { ...base, action: 'hide', book_id: hid, keeper: v.keeper, apply: APPLY };
        let skip = null;
        if (!keeper || keeper.visible !== true) skip = 'keeper missing or not public';
        else if (!copy || copy.visible !== true) skip = 'copy missing or not public';
        else {
          const cTr = await readable(db, hid);
          rec.readable_translated = { keeper: kTr, copy: cTr };
          if (cTr > kTr) skip = `copy has more readable translated pages (${cTr} > ${kTr})`;
          else if (copy.is_first_translation && !keeper.is_first_translation) skip = 'copy carries the first-translation badge, keeper does not';
          else if (copy.image_source?.provider === 'bph' && keeper.image_source?.provider !== 'bph') skip = 'BPH copy behind a non-BPH keeper';
        }
        if (skip) { tally.hide_skipped++; rec.outcome = 'skipped'; rec.why = skip; log.write(JSON.stringify(rec) + '\n'); continue; }
        rec.before = { visible: copy.visible };
        if (APPLY) {
          const r = await setPublication(db, hid, { state: 'hidden', reason: 'duplicate', duplicateOf: v.keeper, by: BY, issue: 5470, from: ['public'], note: `same edition as ${v.keeper} (#5470 group ${v.group}): ${String(v.evidence).slice(0, 300)}` });
          rec.result = r.status;
          await recordSweepAction(db, { sweep: SWEEP, book_id: hid, action: 'hidden-as-duplicate', detail: { kept: v.keeper, group: v.group, read_from_image: !!v.read_from_image, status: r.status } });
        }
        rec.outcome = APPLY ? 'hidden' : 'would_hide';
        tally.hidden++;
        log.write(JSON.stringify(rec) + '\n');
      }
    }
    // --- key fixes
    if ((v.verdict === 'FALSE_GROUP' || v.verdict === 'PARTIAL') && v.fix?.length) {
      const byBook = new Map();
      for (const f of v.fix) { if (!byBook.has(f.book_id)) byBook.set(f.book_id, []); byBook.get(f.book_id).push(f); }
      for (const [bid, fixes] of byBook) {
        actions++;
        const book = await B.findOne({ id: bid }, { projection: proj });
        const rec = { ...base, action: 'fix_key', book_id: bid, fixes, apply: APPLY };
        let skip = null;
        if (!book) skip = 'book not found';
        else if (book.image_source?.provider === 'bph') skip = 'BPH record — catalogue sync may revert; fix in bph_works';
        else {
          for (const f of fixes) {
            if (!['title', 'display_title', 'year', 'published'].includes(f.field)) { skip = `field ${f.field} not allowed`; break; }
            const cur = book[f.field] ?? null;
            if (String(cur ?? '') !== String(f.from ?? '') && !(f.field === 'year' && Number(cur) === Number(f.from))) { skip = `${f.field} changed since review (now ${JSON.stringify(cur)})`; break; }
          }
        }
        if (skip) { tally.fix_skipped++; rec.outcome = 'skipped'; rec.why = skip; log.write(JSON.stringify(rec) + '\n'); continue; }
        const set = {};
        for (const f of fixes) set[f.field] = f.field === 'year' ? Number(f.to) : f.to;
        if (set.title && !book.display_title && !set.display_title) set.display_title = book.title;
        const next = { ...book, ...set };
        const id = computeIdentityFields(next);
        for (const [k, val] of Object.entries(id)) set[k] = val;
        rec.before = Object.fromEntries(Object.keys(set).map((k) => [k, book[k] ?? null]));
        rec.after = set;
        if (APPLY) {
          await B.updateOne({ id: bid }, { $set: { ...set, updated_at: new Date() } });
          await recordSweepAction(db, { sweep: SWEEP, book_id: bid, action: 'edition-key-fix', detail: { group: v.group, before: rec.before, after: set, why: fixes.map((f) => f.why).join(' | ').slice(0, 500) } });
        }
        rec.outcome = APPLY ? 'fixed' : 'would_fix';
        tally.fixed++;
        log.write(JSON.stringify(rec) + '\n');
      }
    }
  }
  console.log(`[dups] ${APPLY ? 'APPLY' : 'DRY RUN'} ${JSON.stringify(tally)} log=${LOG}`);
  await new Promise((r) => log.end(r));
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
