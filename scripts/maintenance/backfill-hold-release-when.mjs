#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/hold-pipeline-books.mjs (places and releases holds; never rewrites the
 * marker of a hold already placed); scripts/audit/pipeline-hold-drift.mjs (reads markers, writes none);
 * maya-mss-penn-6559.mjs (rewrites `release` on its own campaign's holds only). None backfills a field
 * across every reason.
 *
 * backfill-hold-release-when — give every existing hold a `release_when` (#7860 part A).
 *
 * WHY. From 2026-10-31 holdBook() refuses a hold without `release_when` ({ kind, ref, note }, see
 * scripts/lib/pipeline-hold.mjs). The 464,263 holds placed before then carry only a `release` sentence,
 * which the weekly scripts/audit/hold-release-check.mjs cannot test. This writes one condition per
 * reason from the MAP below, read from each reason's own release sentence on 2026-10-31. A reason the
 * map does not name gets kind 'issue' with the hold's own issue (or the number its reason ends in);
 * one with neither becomes a 'decision' keyed on the reason itself.
 *
 * WHAT IT WRITES. Only `pipeline_auto.hold.release_when` (a subfield of the existing marker, not a new
 * books field), and only where it is absent, so a second run writes 0 and a hold placed after the
 * refusal landed is never touched. `note` is the map's note, else the hold's own `release` sentence.
 * Each write is stamped `backfilled_by: SWEEP` and recorded as a `sweep_log` row per book
 * (field-sprawl.md: a sweep records a ROW). No status changes, no hold is placed or lifted.
 *
 * Usage (dry run by default):
 *   node --env-file=.env.production.local scripts/maintenance/backfill-hold-release-when.mjs           # the reason → release_when table
 *   … --apply                                                                                          # write it
 *   … --undo --apply                                                                                    # $unset every release_when this sweep wrote
 */
import { withMongo } from '../lib/mongo.mjs';
import { recordSweepActions } from '../lib/sweep-log.mjs';
import { normalizeReleaseWhen } from '../lib/pipeline-hold.mjs';

export const SWEEP = 'hold-release-when-7860';
const APPLY = process.argv.includes('--apply'), UNDO = process.argv.includes('--undo');
const BATCH = 5000;

const issue = (ref, note) => ({ kind: 'issue', ref, note });
const decision = (ref, note) => ({ kind: 'decision', ref, note });
const test = (ref, note) => ({ kind: 'test', ref, note });
const date = (ref, note) => ({ kind: 'date', ref, note });
const NOT_ACQUIRED = 'not acquired (#7860 group 1): a catalogue record without fetched pages; a reader request or a planned wave (#6553) releases it';
const UNFUNDED = 'unfunded (#7860 group 2): released in priced waves from the one queue (#7860 part C)';

/** reason → release_when, from each reason's release sentence (census 2026-10-31). `note: undefined` keeps the hold's own sentence. */
export const MAP = {
  // Group 1 — not acquired
  'manifest-only-lazy-pages': decision('manifest-only-lazy-pages release', NOT_ACQUIRED),
  'acquisition-wave-2026-10b': decision('acquisition-wave-2026-10b release', NOT_ACQUIRED),
  // Group 2 — unfunded: a priced decision releases them
  'acquisition-wave-2026-10-images-only': decision('acquisition-wave-2026-10-images-only', UNFUNDED),
  'scans-only-publish-7176': decision('scans-only-publish-7176', UNFUNDED),
  'scans-only-publish-7270': decision('scans-only-publish-7270', UNFUNDED),
  'paddle-zh-5600-ocr-only': decision('siku translation', UNFUNDED),
  'paddle-zh-6388-ocr-only': decision('siku translation', UNFUNDED),
  'paddle-zh-6388-excluded': decision('siku translation', undefined),
  'zh-histories-7546': decision('siku translation', undefined),
  'gpu-backlog-5660': decision('gpu-backlog-5660 translation', UNFUNDED),
  'warehouse-promotion-5470': decision('warehouse promotion', UNFUNDED),
  'paddle-print-6101': decision('paddle-print-6101 translation', undefined),
  'ndl-koten-lane-4925': decision('ndl koten re-translation', undefined),
  'mongol-kanjur-import-5664': decision('mongol kanjur ocr', undefined),
  'kangyur-import': decision('kangyur translation', undefined),
  'tengyur-import-5497': decision('tengyur translation', undefined),
  'glm-english-5660-ocr-only': decision('glm-english-5660-ocr-only', undefined),
  'nalanda-sanskrit-ocr-only': decision('nalanda-sanskrit-ocr-only', undefined),
  // Group 3 — awaits a decision
  'tibetan-retranslation-awaits-derek': decision('opus-tib-sa-6948', 'Tibetan + Sanskrit translation goes to Opus via claude -p (Derek 2026-10-24, job opus-tib-sa-6948); #7860 part B routes and releases'),
  'syriac-retranslation-awaits-derek': decision('syriac re-translation', 'Syriac re-translation approved ($45 cap, #4883); #7860 part B routes and releases'),
  'peiresc-awaits-derek-5811': decision('peiresc letters ocr', undefined),
  'plethon-folios-only': decision('plethon codex', undefined),
  'loagaeth-letter-grids-no-ocr': decision('loagaeth tables', undefined),
  'malayalam-palm-leaf-lane': decision('malayalam palm-leaf lane', undefined),
  'syriac-ocr-lane-trial': decision('syriac ocr route', undefined),
  // A named check releases them
  'ia-wrong-leaf-4790': test('scripts/audit/pipeline-hold-drift.mjs RELEASABLE (an ia_ocr_leaf_repair book_event newer than the hold)', undefined),
  'ocr-flash-cli-7075': test('scripts/batch/cli-ocr.mjs has read every unread page', undefined),
  'translate-cli-7075': test('scripts/batch/cli-translate-lane.mjs releases the book when every untranslated page is translated', undefined),
  'gpu-print-6871': test('scripts/workers/gpu-print-lane.mjs release (every planned page applied, skipped or rejected)', undefined),
  'specialist-ocr-lane-4523': test('a specialist OCR lane (Yigdzin / Kraken) has read the book', undefined),
  'gemini-ocr-tibetan-4523': test('every withheld gemini-ocr-tibetan-4523 page has a Yigdzin read passing the #4523 write rule', undefined),
  'tibetan-unverified-gemini-ocr-4523': test('the Yigdzin lane has read the book and the #4523 chained run has translated it', undefined),
  'same-edition-copy-unread': test('title pages of this copy and hold.detail.kept read by eye: not the same printing', undefined),
  'drebbel-creative-5811': test('every page has archived_photo', undefined),
  'cbeta-chan-5566': test('two pages read by eye match the fitted CBETA text (#5566)', undefined),
  'cbeta-chan-translate-5566': issue(5595, undefined),
  'barocci-reocr-7090': test('job barocci233-7090: every translatable page has English on the Opus re-read', undefined),
  // A date
  'bw-reread-7274': date('2026-11-02', undefined),
  'zh-flash-agy-7037': date('2026-10-24', undefined),
};

/** The condition for one (reason, issue) group: the map, else the hold's issue, else the number the reason ends in, else a decision keyed on the reason. */
export function releaseWhenFor(reason, holdIssue) {
  if (MAP[reason]) return MAP[reason];
  const n = Number.isInteger(holdIssue) && holdIssue > 0 ? holdIssue : Number(reason.match(/-(\d{3,5})$/)?.[1]) || null;
  return n ? issue(n, undefined) : decision(reason, undefined);
}

await withMongo(async (db) => {
  const B = db.collection('books');
  if (UNDO) {
    const f = { 'pipeline_auto.hold.release_when.backfilled_by': SWEEP };
    const n = await B.countDocuments(f);
    console.log(`${n} hold(s) carry a release_when written by ${SWEEP}${APPLY ? '' : ' (dry run; --apply to unset)'}`);
    if (APPLY && n) { const r = await B.updateMany(f, { $unset: { 'pipeline_auto.hold.release_when': '' } }); console.log(`unset ${r.modifiedCount}`); }
    return;
  }
  const groups = await B.aggregate([
    { $match: { 'pipeline_auto.hold': { $exists: true }, 'pipeline_auto.hold.release_when': { $exists: false } } },
    { $group: { _id: { reason: '$pipeline_auto.hold.reason', issue: '$pipeline_auto.hold.issue' }, n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ], { allowDiskUse: true }).toArray();
  const total = groups.reduce((s, g) => s + g.n, 0);
  console.log(`${total} hold(s) without release_when in ${groups.length} (reason, issue) group(s)${APPLY ? '' : ' — DRY RUN'}`);
  let written = 0, logged = 0;
  for (const g of groups) {
    const { reason, issue: holdIssue } = g._id;
    const rw = releaseWhenFor(reason, holdIssue);
    normalizeReleaseWhen(rw, 'x'); // a bad map entry throws here, before anything is written
    const src = MAP[reason] ? 'map' : 'default';
    console.log(`  ${String(g.n).padStart(7)}  ${reason}${holdIssue != null ? ` #${holdIssue}` : ''} → ${rw.kind}:${rw.ref} (${src})${rw.note ? ` — ${rw.note.slice(0, 80)}` : ''}`);
    if (!APPLY) continue;
    const match = { 'pipeline_auto.hold.reason': reason, 'pipeline_auto.hold.issue': holdIssue ?? null, 'pipeline_auto.hold.release_when': { $exists: false } };
    const cur = B.find(match, { projection: { _id: 0, id: 1 } }).batchSize(BATCH);
    let ids = [];
    const flush = async () => {
      if (!ids.length) return;
      const value = { kind: { $literal: rw.kind }, ref: { $literal: rw.ref }, note: rw.note != null ? { $literal: rw.note } : { $ifNull: ['$pipeline_auto.hold.release', null] }, backfilled_by: { $literal: SWEEP } };
      const r = await B.updateMany({ ...match, id: { $in: ids } }, [{ $set: { 'pipeline_auto.hold.release_when': value } }]);
      written += r.modifiedCount;
      const done = await B.find({ id: { $in: ids }, 'pipeline_auto.hold.release_when.backfilled_by': SWEEP }, { projection: { _id: 0, id: 1 } }).toArray();
      logged += await recordSweepActions(db, done.map((b) => ({ sweep: SWEEP, book_id: b.id, action: 'hold-release-when-set', detail: { reason, kind: rw.kind, ref: String(rw.ref) } })));
      ids = [];
    };
    for await (const b of cur) { ids.push(b.id); if (ids.length >= BATCH) await flush(); }
    await flush();
  }
  if (APPLY) console.log(`wrote release_when on ${written} hold(s); ${logged} sweep_log row(s) (sweep ${SWEEP}; undo: --undo --apply)`);
}, { noTimeout: true, socketTimeoutMs: 600_000 }); // the group-by reads all 464K holds; the apply runs ~100 batches
