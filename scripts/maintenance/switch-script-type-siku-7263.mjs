#!/usr/bin/env node
/**
 * Switch `pages.script_type` printed → handwritten on the Wenyuange Siku Quanshu pages whose own
 * OCR `<script>` tag says handwritten (#7263).
 *
 * PRIOR ART: scripts/maintenance/backfill-script-type-7263.mjs — the census that found these
 * 187,632 "printed field, handwritten tag" conflicts, and the conventions reused here (tag parser,
 * restHash, per-page sweep_log rows, --revert, chunk + pause). It does not fit: by its rule an
 * existing value is never overwritten, and its conflicts are reported, not changed. This is the
 * one deliberate overwrite (Derek, 2026-10-28, after an image check of 20 random Siku books).
 *
 * WHICH PAGES (siku-scope below; pinned by tests/unit/switch-script-type-siku-7263.test.ts):
 *   - the book is a Wenyuange Siku Quanshu volume: `ia_identifier` matches /^060\d{5}\.cn$/ (the
 *     CADAL range of the SKQS scans). NOT the paddle-zh lane as a whole: that lane also carries
 *     ~160 other CADAL books (`020…`/`021….cn`: 武備志, 元曲選, 三才圖會, the Li Zhuowu novels),
 *     which are Ming/Qing WOODBLOCK prints. The lane wrote `<script>handwritten</script>` on every
 *     page it read, so on those books the tag is wrong and the stored `printed` is right;
 *   - the page's field is exactly `printed`, and the FIRST `<script>` tag of its current
 *     `ocr.data` is exactly `handwritten` (trimmed, case-folded).
 *
 * What it writes: `$set: { script_type: 'handwritten' }` with the write filter repeating
 * `script_type: 'printed'` and the read's `ocr.updated_at` (a page a live writer touched meanwhile
 * is skipped and counted as raced). Not `updated_at` (as #7639). One sweep_log row per book per
 * chunk, action `script-type-switched-to-ocr-tag`, detail `{ issue, page_ids, id_types, values,
 * prev }`, so `--revert` puts back exactly `printed` on exactly these pages, and only where the
 * value is still `handwritten`.
 *
 * Usage (node --env-file=/root/sourcelibrary/.env.production.local …; run on Hetzner):
 *   scripts/maintenance/switch-script-type-siku-7263.mjs                    # dry run: count
 *   scripts/maintenance/switch-script-type-siku-7263.mjs --apply [--max-writes=1000] [--verify]
 *   scripts/maintenance/switch-script-type-siku-7263.mjs --revert
 *     --out=DIR  checkpoint / summary dir (default $JOB_SCRATCH or scripts/output)
 *     --books=N  Siku books per read (default 100)   --sleep-ms=N  pause between chunks (default 300)
 *     --reset    ignore the checkpoint               --verify      hash every written doc before/after
 *     --sample=N with --apply: write N pages drawn at random across the Siku books (the test write)
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ObjectId } from 'mongodb';
import { tagState, fieldState, restHash } from './backfill-script-type-7263.mjs';

export const SWEEP = 'switch-script-type-siku-7263';
export const ACTION = 'script-type-switched-to-ocr-tag';
export const SIKU_IA = /^060\d{5}\.cn$/;
const TAG_RE = /<script>([\s\S]*?)<\/script>/i;

/** Is this book a Wenyuange Siku Quanshu volume? */
export const isSikuBook = (book) => typeof book?.ia_identifier === 'string' && SIKU_IA.test(book.ia_identifier);

/** The rule, for a page of a Siku book: { switch: 'handwritten' } or { skip: reason }. */
export function sikuSwitch(page) {
  const field = fieldState(page?.script_type);
  const tag = tagState(page?.ocr?.data).state;
  if (field !== 'printed') return { skip: `field-${field}`, field, tag };
  if (tag !== 'handwritten') return { skip: `tag-${tag}`, field, tag };
  return { switch: 'handwritten', field, tag };
}

/** Write filter: still `printed`, and the OCR is the one we read. */
export function writeFilter(page) {
  return { _id: page._id, script_type: 'printed', 'ocr.updated_at': page.ocr?.updated_at ?? { $exists: false } };
}

/** Revert op for one logged page: back to `printed`, only where the value is still the one written. */
export function revertOp(row, i) {
  const id = row.detail.id_types[i] === 'objectId' ? new ObjectId(row.detail.page_ids[i]) : row.detail.page_ids[i];
  return { updateOne: { filter: { _id: id, script_type: row.detail.values[i] }, update: { $set: { script_type: row.detail.prev[i] } } } };
}

const inc = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };

async function main() {
  const { getScriptClient } = await import('../lib/mongo.mjs');
  const { recordSweepActions } = await import('../lib/sweep-log.mjs');
  const args = process.argv.slice(2);
  const flag = (n) => args.includes(`--${n}`);
  const opt = (n, d) => args.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;
  const APPLY = flag('apply');
  const REVERT = flag('revert');
  const VERIFY = flag('verify');
  const MAX_WRITES = Number(opt('max-writes', 0));
  const SAMPLE = Number(opt('sample', 0));
  const BOOKS = Number(opt('books', 100));
  const SLEEP = Number(opt('sleep-ms', 300));
  const OUT = opt('out', process.env.JOB_SCRATCH || 'scripts/output');
  const mode = REVERT ? 'revert' : APPLY ? (SAMPLE ? 'sample' : 'apply') : 'dry';
  fs.mkdirSync(OUT, { recursive: true });
  const CHECKPOINT = path.join(OUT, `${SWEEP}.${mode}.checkpoint.json`);
  const VERIFY_LOG = path.join(OUT, `${SWEEP}.verify.jsonl`);

  const { client, db } = await getScriptClient({ timeoutMs: 12 * 3600_000, socketTimeoutMs: 600_000 });
  const pages = db.collection('pages');
  try {
    if (REVERT) {
      let restored = 0; let kept = 0;
      for await (const row of db.collection('sweep_log').find({ sweep: SWEEP, action: ACTION }).batchSize(200)) {
        const ops = row.detail.page_ids.map((_, i) => revertOp(row, i));
        const res = ops.length ? await pages.bulkWrite(ops, { ordered: false }) : { modifiedCount: 0 };
        restored += res.modifiedCount; kept += ops.length - res.modifiedCount;
      }
      console.log(JSON.stringify({ mode, restored, left_because_value_changed: kept }));
      return;
    }

    // The Siku books, keyed by every value a page's book_id can hold (`_id` and, where it differs, `id`).
    const books = await db.collection('books').find({ ia_identifier: { $regex: SIKU_IA.source } },
      { projection: { _id: 1, id: 1, ia_identifier: 1 }, maxTimeMS: 600_000 }).toArray();
    const bookKeys = [...new Set(books.filter(isSikuBook).flatMap((b) => [String(b._id), ...(b.id ? [String(b.id)] : [])]))].sort();
    console.log(`${SWEEP} — ${mode.toUpperCase()} — ${books.length} Siku books (${bookKeys.length} book_id keys)`);

    const fresh = () => ({ offset: 0, scanned: 0, would_switch: 0, skipped: {}, by_pipeline: {}, written: 0, raced: 0,
      verified: { ok: 0, changed: 0 }, books_switched: {}, started_at: new Date().toISOString(), ms: 0 });
    const cp = (!flag('reset') && fs.existsSync(CHECKPOINT)) ? JSON.parse(fs.readFileSync(CHECKPOINT, 'utf8')) : fresh();
    const save = () => fs.writeFileSync(CHECKPOINT, JSON.stringify(cp));
    const project = { _id: 1, book_id: 1, script_type: 1, 'ocr.updated_at': 1, 'ocr.pipeline': 1, 'ocr.source': 1,
      tag: { $regexFind: { input: { $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, '$ocr.data', ''] }, regex: TAG_RE.source, options: 'i' } } };

    // --sample: one random draw of N candidate pages across all Siku books, written as a single chunk.
    let sampleIds = null;
    if (SAMPLE) {
      sampleIds = (await pages.aggregate([{ $match: { book_id: { $in: bookKeys }, script_type: 'printed' } },
        { $project: { _id: 1, tag: project.tag } }, { $match: { 'tag.captures.0': { $regex: '^\\s*handwritten\\s*$', $options: 'i' } } },
        { $sample: { size: SAMPLE } }], { maxTimeMS: 1_800_000, allowDiskUse: true }).toArray()).map((d) => d._id);
    }

    let t0 = Date.now(); let writesThisRun = 0;
    while (sampleIds ? cp.offset < 1 : cp.offset < bookKeys.length) {
      const match = sampleIds ? { _id: { $in: sampleIds } } : { book_id: { $in: bookKeys.slice(cp.offset, cp.offset + BOOKS) }, script_type: 'printed' };
      const docs = await pages.aggregate([{ $match: match }, { $project: project }], { maxTimeMS: 600_000 }).toArray();
      cp.offset += sampleIds ? 1 : BOOKS;

      const ops = [];
      for (const d of docs) {
        const r = sikuSwitch({ script_type: d.script_type, ocr: { data: d.tag ? `<script>${d.tag.captures[0]}</script>` : '' } });
        if (r.skip) { inc(cp.skipped, r.skip); continue; }
        cp.would_switch++; inc(cp.by_pipeline, d.ocr?.pipeline ?? d.ocr?.source ?? '(none)');
        if (APPLY && (!MAX_WRITES || writesThisRun + ops.length < MAX_WRITES)) {
          ops.push({ d, op: { updateOne: { filter: writeFilter(d), update: { $set: { script_type: 'handwritten' } } } } });
        }
      }

      if (ops.length) {
        const ids = ops.map((o) => o.d._id);
        const before = VERIFY ? new Map((await pages.find({ _id: { $in: ids } }, { maxTimeMS: 600_000 }).toArray()).map((x) => [String(x._id), restHash(x)])) : null;
        const res = await pages.bulkWrite(ops.map((o) => o.op), { ordered: false });
        cp.written += res.modifiedCount; cp.raced += ops.length - res.matchedCount; writesThisRun += res.modifiedCount;
        // Which ones landed: re-read the field (bulkWrite does not say per op).
        const landed = new Map((await pages.find({ _id: { $in: ids } }, { projection: VERIFY ? undefined : { script_type: 1 }, maxTimeMS: 600_000 }).toArray()).map((x) => [String(x._id), x]));
        const logged = {};
        for (const o of ops) {
          const now = landed.get(String(o.d._id));
          if (now?.script_type !== 'handwritten') continue;
          const b = o.d.book_id ?? '(none)';
          logged[b] ??= { page_ids: [], id_types: [], values: [], prev: [] };
          logged[b].page_ids.push(String(o.d._id)); logged[b].id_types.push(o.d._id instanceof ObjectId ? 'objectId' : 'string');
          logged[b].values.push('handwritten'); logged[b].prev.push('printed');
          inc(cp.books_switched, b);
          if (VERIFY) {
            const ok = before.get(String(o.d._id)) === restHash(now);
            cp.verified[ok ? 'ok' : 'changed']++;
            if (!ok) fs.appendFileSync(VERIFY_LOG, JSON.stringify({ page_id: String(o.d._id), book_id: b }) + '\n');
          }
        }
        await recordSweepActions(db, Object.entries(logged).map(([book_id, det]) => ({ sweep: SWEEP, book_id, action: ACTION, detail: { issue: 7263, ...det } })));
      }

      cp.scanned += docs.length;
      const now = Date.now(); cp.ms += now - t0; t0 = now;
      save();
      if (!sampleIds && (cp.offset / BOOKS) % 10 === 0) {
        console.log(`  ${Math.min(cp.offset, bookKeys.length)}/${bookKeys.length} book keys · ${cp.scanned} printed pages read · switch ${cp.would_switch}${APPLY ? ` · written ${cp.written} · raced ${cp.raced}` : ''}`);
      }
      if (APPLY && MAX_WRITES && writesThisRun >= MAX_WRITES) break;
      if (SLEEP) await new Promise((r) => setTimeout(r, SLEEP));
    }

    const { books_switched, ...summary } = cp;
    summary.complete = sampleIds ? true : cp.offset >= bookKeys.length;
    summary.siku_books = books.length;
    summary.books_switched = Object.keys(books_switched).length;
    summary.wall_s = Math.round(cp.ms / 1000);
    fs.writeFileSync(path.join(OUT, `${SWEEP}.${mode}.summary.json`), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await client.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
