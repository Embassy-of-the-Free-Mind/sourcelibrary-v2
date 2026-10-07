// Follow-ups from the by-eye recheck (#5689), approved by Derek 2026-10-04.
// DRY unless APPLY=1. Every write bumps updated_at (catalog sync) and leaves a sweep_log row
// with the before/after values and the recheck reading it rests on.
//
//   1. Metadata errors read from title pages/colophons (recheck rows cl 52, 117, 216, 282).
//      Identity fields are recomputed with computeIdentityFields, the one definition.
//   2. cl 181: the 1659 scan becomes the collection keeper over a typed e-text rendered as images.
//      Membership only: the e-text leaves collections that hold the scan; highlights swap to the scan.
//   3. Highlights: undo 2026-10-03 highlight swaps for pairs the recheck rejected. A rejected
//      copy that was highlighted goes back to its original position.
//
//   APPLY=1 BACKUP=<collection-dupes-backup.json> node --env-file=... 8-followups-2026-10-04.mjs
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeIdentityFields } from '../../lib/identity-fields.mjs';
import { recordSweepActions } from '../../lib/sweep-log.mjs';

const APPLY = process.env.APPLY === '1';
const SWEEP = 'collection-copy-followups-2026-10-04';
const here = path.dirname(fileURLToPath(import.meta.url));
const recheck = fs.readFileSync(path.join(here, '../collection-copies-2026-10-03.recheck.jsonl'), 'utf8')
  .split('\n').filter(Boolean).map((l) => JSON.parse(l));
const byCluster = new Map(recheck.map((r) => [r.cluster_no, r]));

const FIXES = [
  { cl: 52, id: '6ff1a28b-f7cd-4fcd-8d08-77d2f7818be1', set: { published: '1555', year: 1555 },
    why: 're-cut title + colophon of the second edition (Basel: Oporinus, 1555); record said 1543' },
  { cl: 117, id: '6952b10077f38f6761bc2c1b',
    set: { published: '1491', year: 1491, place_published: 'Venice', publisher: 'Pietro Cremonese, detto Veronese' },
    why: "colophon: 'impresso in Vinegia per Pietro Cremonese dito Veronese ... M.cccc.Lxxxxi'; record said Florence 1481" },
  { cl: 216, id: '69b3016378de5de2306d4fce',
    set: { title: 'Respublica sive Status Regni Scotiae et Hiberniae', display_title: 'The Republic of Scotland and Ireland', published: '1630', year: 1630 },
    why: "engraved title 'STATUS REGNI SCOTIAE ET HIBERNIAE' (plate dated 1627), colophon 'Anno cIɔ Iɔc xxx'; record said Regni Poloniae 1627" },
  { cl: 282, id: '6a0a4e9a7cd8e1e3d0f4964a',
    set: { title: '皇極經世書 卷一下 (Huangji Jingshi Shu, juan 1, lower) — Shao Yong Neo-Confucian cosmic numerology, Siku Quanshu' },
    why: "first leaf '欽定四庫全書 子部 皇極經世書卷一下'; record said 'juan slice 1 of 24'" },
];
const DEE = { cl: 181, scan: '69593025a41e40e9146a4acd', etext: '6952d08877f38f6761bc5560' };

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore'); const books = db.collection('books'); const cols = db.collection('collections');
const sweep = [];

// 1. metadata
for (const f of FIXES) {
  if (!byCluster.has(f.cl)) throw new Error(`no recheck row for cl ${f.cl}`);
  const b = await books.findOne({ id: f.id });
  const before = Object.fromEntries(Object.keys(f.set).map((k) => [k, b[k] ?? null]));
  const ident = computeIdentityFields({ ...b, ...f.set });
  console.log(`cl ${f.cl} ${f.id}`, JSON.stringify(before), '->', JSON.stringify(f.set), '| edition_key ->', ident.edition_key);
  if (APPLY) await books.updateOne({ id: f.id }, { $set: { ...f.set, ...ident }, $currentDate: { updated_at: true } });
  sweep.push({ sweep: SWEEP, book_id: f.id, action: 'metadata-corrected-from-scan', detail: { cluster_no: f.cl, before, after: f.set, edition_key: ident.edition_key, evidence: f.why, recheck: 'collection-copies-2026-10-03.recheck.jsonl', issue: 5689 } });
}

// 2. Dee keeper swap (membership only)
const scan = await books.findOne({ id: DEE.scan }, { projection: { collections: 1 } });
const etext = await books.findOne({ id: DEE.etext }, { projection: { collections: 1 } });
const shared = (etext.collections || []).filter((s) => (scan.collections || []).includes(s));
console.log(`cl 181: e-text leaves ${shared.length} collections that hold the scan:`, shared.join(','));
if (APPLY && shared.length) await books.updateOne({ id: DEE.etext }, { $pull: { collections: { $in: shared } }, $currentDate: { updated_at: true } });
if (shared.length) sweep.push({ sweep: SWEEP, book_id: DEE.etext, action: 'removed-from-collections', detail: { cluster_no: 181, collections: shared, keeper: DEE.scan, evidence: 'recheck: keeper was a typed e-text rendered as images; the copy is the 1659 printing; Derek approved making the scan the keeper', issue: 5689 } });
for (const col of await cols.find({ 'highlighted_books.book_id': DEE.etext }, { projection: { slug: 1, highlighted_books: 1 } }).toArray()) {
  const hasScan = col.highlighted_books.some((h) => h.book_id === DEE.scan);
  const out = hasScan ? col.highlighted_books.filter((h) => h.book_id !== DEE.etext)
    : col.highlighted_books.map((h) => (h.book_id === DEE.etext ? { ...h, book_id: DEE.scan } : h));
  console.log(`cl 181 highlight ${col.slug}: ${hasScan ? 'drop e-text' : 'e-text -> scan'}`);
  if (APPLY) await cols.updateOne({ slug: col.slug }, { $set: { highlighted_books: out }, $currentDate: { updated_at: true } });
}

// 3. undo highlight swaps for rejected pairs
const backup = JSON.parse(fs.readFileSync(process.env.BACKUP, 'utf8'));
const rejected = recheck.filter((r) => r.verdict !== 'same_printing');
for (const [slug, orig] of Object.entries(backup.collections)) {
  for (const r of rejected) {
    const i = orig.findIndex((h) => h.book_id === r.copy_id);
    if (i < 0) continue;
    const col = await cols.findOne({ slug }, { projection: { highlighted_books: 1 } });
    let cur = col.highlighted_books;
    if (cur.some((h) => h.book_id === r.copy_id)) continue;
    const keeperWasThere = orig.some((h) => h.book_id === r.keeper_id);
    const j = cur.findIndex((h) => h.book_id === r.keeper_id);
    cur = cur.slice();
    if (!keeperWasThere && j >= 0) cur[j] = orig[i]; else cur.splice(Math.min(i, cur.length), 0, orig[i]);
    console.log(`highlight ${slug}: restore copy ${r.copy_id} (cl ${r.cluster_no}, ${r.verdict})${!keeperWasThere && j >= 0 ? ' in place of keeper' : ''}`);
    if (APPLY) await cols.updateOne({ slug }, { $set: { highlighted_books: cur }, $currentDate: { updated_at: true } });
    sweep.push({ sweep: SWEEP, book_id: r.copy_id, action: 'highlight-restored', detail: { collection: slug, cluster_no: r.cluster_no, recheck_verdict: r.verdict, issue: 5689 } });
  }
}

if (APPLY) await recordSweepActions(db, sweep);
console.log(`${APPLY ? 'APPLIED' : 'DRY'}: ${sweep.length} sweep rows`);
await c.close();
