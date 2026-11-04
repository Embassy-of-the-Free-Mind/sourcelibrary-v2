#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/golive-cadal-chinese-2026-08.mjs (flips by a gate, but it writes the legacy fields and
 * drops the hold, so it would start the paid lanes here), hold-pipeline-books.mjs --release-held (the pipeline's release:
 * --to ocr_complete queues paid transliteration and translation, per the #8053 report). This is setPublicationMany over
 * a stated list, with the hold kept.
 *
 * publish-held-chinese-8053 — Derek, 2026-11-04: "release." Evidence and reasoning: the report on #8053.
 *
 *   - 史記, 漢書, 後漢書, 三國志 under hold zh-histories-7546: public, English shown with the reader's standard
 *     unreviewed-AI label. EXCEPT the 表 volumes (史記 vols 8-12, 漢書 vols 5-11), which stay hidden: the OCR there is
 *     numeral loops or reversed lines and most pages have no English.
 *   - Printed books under hold paddle-print-6101 that have OCR, in the frame the report reviewed: public. A hidden_reason
 *     of rights, duplicate, superseded or broken images is never published here.
 *
 * pipeline_auto stays held, which no phase selects, so publishing queues nothing. bulk-ocr-new refuses held books since
 * #8082: that must be in production first, or a run could send the un-OCR'd pages to a paid read. This script does not
 * check that; the operator does (first run: release df9b7f675, Ready, 2026-11-04).
 *
 *   node --env-file=.env.production.local scripts/maintenance/publish-held-chinese-8053.mjs        dry run
 *   ... --apply
 */
import { MongoClient } from 'mongodb';
import { setPublicationMany, publicationFilter } from '../lib/publication.mjs';

const APPLY = process.argv.includes('--apply');
const BY = 'script:publish-held-chinese-8053';
const NOTE = 'Published with the pipeline hold kept; decided by Derek 2026-11-04 (#8053).';

const TABLE_VOLUMES = { 'kr:KR2a0001': [8, 9, 10, 11, 12], 'kr:KR2a0007': [5, 6, 7, 8, 9, 10, 11] };
const volumeOf = (title) => Number(String(title).match(/vol\. (\d+) of \d+/)?.[1] ?? 0);
export const isTableVolume = (b) => (TABLE_VOLUMES[b.work_id] ?? []).includes(volumeOf(b.title));

const PRINT_REASONS = [null, 'launch_curation', 'unprocessed'];

// Read by hand from the list and a screen of each book's first and last 8 pages of OCR, 2026-11-04. The review on #8053
// sampled 8 of these 156 and did not meet any of them. They stay hidden. The reasons are in the ops repo, not here:
// rights-screen/2026-11-04-chinese-imprints.md.
const NOT_NOW = {
  'ia:20230325_20230325_0540': 'imprint',
  'ia:20230325_20230325_0228': 'imprint',
  'ia:1_20240421_202404': 'imprint',
  'ia:3_20240421': 'imprint',
  'ia:2_20240421_20240421_0459': 'imprint',
  'ia:2_20250415_20250415_1355': 'imprint',
  'ia:20250416_20250416_1428': 'imprint',
  'ia:huayan': 'imprint',
  'ia:ch-374-07-01-001-2': 'imprint not read',
  'ia:20250719_20250719_1330': 'imprint not read',
  'ia:20220420_20220420_0816': 'imprint not read',
  'ia:20220419_20220419_1753': 'imprint not read',
  'ia:20210217_20210217_1959': 'imprint not read',
  'idp_dunhuang:DF289CD9596843CAB5B324525E5100CD': 'no statement on the record, no title',
  'idp_dunhuang:04675A72CA19422FB7DE0DDCE1BA4CF2': 'no statement on the record, no title',
  // The title names one thin work and the scan is ~2,400 pages: a 叢書 catalogued under its first title. Passed to #8053's sets job.
  'iiif:https://nrs.harvard.edu/urn-3:FHCL:23477511:MANIFEST': 'catalogue: 論語筆解, 2294 pages',
  'iiif:https://nrs.harvard.edu/urn-3:FHCL:25628890:MANIFEST': 'catalogue: 先進遺風 vol 2, 2403 pages',
  'iiif:https://nrs.harvard.edu/urn-3:FHCL:25593709:MANIFEST': 'catalogue: 井觀瑣言 vol 2, 2432 pages',
  'iiif:https://nrs.harvard.edu/urn-3:FHCL:25595543:MANIFEST': 'catalogue: 海內十洲記 vol 2, 2489 pages',
  'iiif:https://nrs.harvard.edu/urn-3:FHCL:25627121:MANIFEST': 'catalogue: 震澤長語 vol 2, 2439 pages',
  'iiif:https://nrs.harvard.edu/urn-3:FHCL:25591907:MANIFEST': 'catalogue: 雲烟過眼錄, 1204 pages',
};

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const books = db.collection('books');
const projection = { id: 1, title: 1, work_id: 1, source_fingerprint: 1, hidden_reason: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, language: 1, 'pipeline_auto.status': 1, 'pipeline_auto.hold.reason': 1 };

const histories = await books.find({ ...publicationFilter('not_public'), 'pipeline_auto.hold.reason': 'zh-histories-7546', work_id: { $in: ['kr:KR2a0001', 'kr:KR2a0007', 'kr:KR2a0009', 'kr:KR2a0012'] } }, { projection }).toArray();
const heldTables = histories.filter(isTableVolume);
// Filled in today from another edition by the sets job on #8053, after the review; it has no English yet and that job owns it.
const SETS_JOB_OWNS = ['6aeb1587964e8fcfbdb4f926'];
const open = histories.filter((b) => !isTableVolume(b) && !b.hidden_reason && !SETS_JOB_OWNS.includes(b.id));

const printed = (await books.find({ ...publicationFilter('not_public'), 'pipeline_auto.hold.reason': 'paddle-print-6101', language: /chinese/i, pages_count: { $gt: 0 }, pages_ocr: { $gt: 0 } }, { projection }).toArray())
  .filter((b) => PRINT_REASONS.includes(b.hidden_reason ?? null) && !NOT_NOW[b.source_fingerprint]);
const left = Object.keys(NOT_NOW).length - (await books.countDocuments({ source_fingerprint: { $in: Object.keys(NOT_NOW) }, ...publicationFilter('not_public') }));
if (left) console.log(`WARNING: ${left} NOT_NOW fingerprints not found among hidden books`);

const sum = (rows, k) => rows.reduce((s, b) => s + (b[k] ?? 0), 0);
const line = (label, rows) => console.log(`${label}: ${rows.length} volumes, ${sum(rows, 'pages_count')} pages, ${sum(rows, 'pages_ocr')} OCR, ${sum(rows, 'pages_translated')} English`);
line('histories to publish', open);
line('表 volumes kept hidden', heldTables);
line('printed to publish', printed);
for (const [k, n] of Object.entries(open.reduce((m, b) => ({ ...m, [b.work_id]: (m[b.work_id] ?? 0) + 1 }), {}))) console.log(`  ${k}: ${n}`);
const reasons = printed.reduce((m, b) => { const k = b.hidden_reason ?? 'none'; m[k] = (m[k] ?? 0) + 1; return m; }, {});
console.log('  printed by hidden_reason', reasons, 'with English', printed.filter((b) => (b.pages_translated ?? 0) > 0).length);
console.log('  any not held', [...open, ...printed].filter((b) => b.pipeline_auto?.status !== 'held').length);
console.log('printed titles:');
for (const b of printed) console.log(`  ${b.hidden_reason ?? '-'}\t${b.pages_ocr}/${b.pages_count}\t${b.pages_translated ?? 0}\t${String(b.title).slice(0, 44)}`);

if (APPLY) {
  const notHeld = [...open, ...printed].filter((b) => b.pipeline_auto?.status !== 'held');
  if (notHeld.length) { console.log('REFUSED: every book must be held', notHeld.length); await client.close(); process.exit(1); }
  const ids = [...open, ...printed].map((b) => b.id ?? String(b._id));
  const r = await setPublicationMany(db, ids, { state: 'public', by: BY, issue: 8053, note: NOTE, from: ['hidden', 'unpublished'] });
  console.log({ written: r.written.length, unchanged: r.unchanged.length, skipped: r.skipped.length, refused: r.refused, not_found: r.not_found, eviction: r.eviction?.ok ?? r.eviction });
  const stillHeld = await books.countDocuments({ id: { $in: r.written }, 'pipeline_auto.status': 'held' });
  console.log('written and still held', stillHeld);
}
await client.close();
