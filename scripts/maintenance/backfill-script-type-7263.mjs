#!/usr/bin/env node
/**
 * Fill a missing `pages.script_type` from the `<script>` tag in the page's CURRENT `ocr.data` (#7263).
 *
 * PRIOR ART: scripts/maintenance/backfill-script-type-4195.mjs — the same lift, run once on
 * 2026-10-02 (3.73M pages, 28,560 sweep_log rows). It does not fit a second pass: it fills only
 * `$exists: false` (not null / ""), it walks only tagged pages so it cannot measure field-vs-tag
 * agreement or report conflicts, and its sweep_log rows hold a page COUNT per book, so a fill cannot
 * be found or reverted page by page. The parser is the shared one (extractScriptType in
 * scripts/lib/ocr-result-parse.mjs); this adds the census, per-page revert rows, and --revert.
 *
 * Why again: the router splits print from manuscript by `pages.script_type` (job router-next-7263).
 * Writers that compose their own envelope and never call liftOcrTags (the paddle-zh lane writes
 * `<script>handwritten</script>` on SKQS manuscript volumes) left the tag in the text and the field
 * empty after 2026-10-02.
 *
 * THE RULE (scriptTypeFill below; pinned by tests/unit/backfill-script-type-7263.test.ts):
 *   - only pages whose `script_type` is missing / null / "" — an existing value is never
 *     overwritten; a value that disagrees with the tag is reported as a conflict;
 *   - value = the FIRST `<script>` tag of the current `ocr.data`, trimmed and lower-cased, only if
 *     it is exactly printed | handwritten | mixed; anything else is left unset and counted.
 *
 * What it writes, and what it does not:
 *   - `$set: { script_type }`, with the write filter repeating "field still empty" and the read's
 *     `ocr.updated_at`, so a page a live writer touched meanwhile is skipped (counted as raced).
 *   - NOT `updated_at` (as 4195): bumping it makes sync-pages-content re-upsert the whole page to
 *     Supabase for one small field.
 *   - Provenance is a ROW, not a column (field-sprawl.md): one sweep_log row per book per chunk,
 *     action `script-type-filled-from-ocr-tag`, detail `{ issue, page_ids, id_types, values, prev }` — the exact
 *     pages and values, so `--revert` can unset exactly those (and only where the value is unchanged).
 *
 * Walks `_id` one BSON type at a time (string, then ObjectId — see 4195 for why) with a checkpoint,
 * sleeps between chunks, and runs every query with maxTimeMS. Run on Hetzner, not the laptop.
 *
 * Usage (node --env-file=/root/sourcelibrary/.env.production.local …):
 *   scripts/maintenance/backfill-script-type-7263.mjs                 # dry run: census over all pages
 *   scripts/maintenance/backfill-script-type-7263.mjs --apply [--max-writes=1000] [--verify]   # walk all pages
 *   scripts/maintenance/backfill-script-type-7263.mjs --apply --from=<dry run's candidates.jsonl> [--max-writes=N]
 *                    walk only the dry run's fill candidates, each re-read and re-judged at write time
 *   scripts/maintenance/backfill-script-type-7263.mjs --revert        # unset every fill this sweep logged
 *     --out=DIR        census / conflicts / checkpoint dir (default $JOB_SCRATCH or scripts/output)
 *     --chunk=N        pages per read (default 5000)   --sleep-ms=N  pause between chunks (default 150)
 *     --reset          ignore the checkpoint            --verify      hash every written doc before/after
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ObjectId } from 'mongodb';

export const SWEEP = 'backfill-script-type-7263';
export const ACTION = 'script-type-filled-from-ocr-tag';
export const VALID = new Set(['printed', 'handwritten', 'mixed']);
const TAG_RE = /<script>([\s\S]*?)<\/script>/i;

/** The page's field as a census bucket. */
export function fieldState(v) {
  if (v === undefined) return 'missing';
  if (v === null) return 'null';
  if (v === '') return 'empty';
  return VALID.has(v) ? v : 'other';
}

/** The first `<script>` tag of the text as a census bucket: a valid value, 'no-ocr', 'no-tag' or 'junk'. */
export function tagState(ocrText) {
  if (typeof ocrText !== 'string' || ocrText.length === 0) return { state: 'no-ocr' };
  const m = ocrText.match(TAG_RE);
  if (!m) return { state: 'no-tag' };
  const raw = m[1].trim().toLowerCase();
  return VALID.has(raw) ? { state: raw } : { state: 'junk', raw: raw.slice(0, 40) };
}

/**
 * The rule. Returns { fill: value } when the page gets a value, else { skip: reason }; a page whose
 * existing value disagrees with its tag also carries `conflict: true` (reported, never changed).
 */
export function scriptTypeFill(page) {
  const field = fieldState(page?.script_type);
  const tag = tagState(page?.ocr?.data);
  const empty = field === 'missing' || field === 'null' || field === 'empty';
  if (!empty) {
    const conflict = VALID.has(tag.state) && tag.state !== field;
    return { skip: 'has-value', field, tag: tag.state, ...(conflict ? { conflict: true } : {}) };
  }
  if (VALID.has(tag.state)) return { fill: tag.state, field, tag: tag.state };
  return { skip: `tag-${tag.state}`, field, tag: tag.state, ...(tag.raw !== undefined ? { raw: tag.raw } : {}) };
}

/** Write filter: the field is still empty and the OCR is the one we read. */
export function writeFilter(page) {
  return {
    _id: page._id,
    $or: [{ script_type: { $exists: false } }, { script_type: null }, { script_type: '' }],
    'ocr.updated_at': page.ocr?.updated_at ?? { $exists: false },
  };
}

/** Stable hash of a doc with `script_type` removed — "nothing else changed". */
export function restHash(doc) {
  const { script_type, ...rest } = doc; // eslint-disable-line no-unused-vars
  const canon = (v) => {
    if (v instanceof Date) return { $date: v.toISOString() };
    if (v && typeof v === 'object' && v._bsontype) return String(v);
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
    return v;
  };
  return crypto.createHash('sha1').update(JSON.stringify(canon(rest))).digest('hex');
}

const inc = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
const PHASES = ['string', 'objectId'];

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
  const CHUNK = Number(opt('chunk', 5000));
  const SLEEP = Number(opt('sleep-ms', 150));
  const OUT = opt('out', process.env.JOB_SCRATCH || 'scripts/output');
  const mode = REVERT ? 'revert' : APPLY ? 'apply' : 'dry';
  fs.mkdirSync(OUT, { recursive: true });
  const CHECKPOINT = path.join(OUT, `${SWEEP}.${mode}.checkpoint.json`);
  const CONFLICTS = path.join(OUT, `${SWEEP}.${mode}.conflicts.jsonl`);
  const VERIFY_LOG = path.join(OUT, `${SWEEP}.verify.jsonl`);

  // 12 h process ceiling (the 300 s default cut earlier sweeps); per-query maxTimeMS below.
  const { client, db } = await getScriptClient({ timeoutMs: 12 * 3600_000, socketTimeoutMs: 600_000 });
  const pages = db.collection('pages');
  try {
    if (REVERT) {
      let unset = 0; let kept = 0;
      const cur = db.collection('sweep_log').find({ sweep: SWEEP, action: ACTION });
      for await (const row of cur) {
        const ops = row.detail.page_ids.map((id, i) => ({ updateOne: {
          filter: { _id: row.detail.id_types[i] === 'objectId' ? new ObjectId(id) : id, script_type: row.detail.values[i] },
          // back to exactly what was there: absent, null or "".
          update: row.detail.prev[i] === 'null' ? { $set: { script_type: null } }
            : row.detail.prev[i] === 'empty' ? { $set: { script_type: '' } } : { $unset: { script_type: '' } } } }));
        const res = ops.length ? await pages.bulkWrite(ops, { ordered: false }) : { modifiedCount: 0 };
        unset += res.modifiedCount; kept += ops.length - res.modifiedCount;
      }
      console.log(JSON.stringify({ mode, unset, left_because_value_changed: kept }));
      return;
    }

    const fresh = () => ({ phase: 0, last_id: null, scanned: 0, cells: {}, would_fill: {}, fill_by_lang: {}, fill_by_pipeline: {},
      skipped: {}, junk_values: {}, conflicts: 0, written: 0, raced: 0, verified: { ok: 0, changed: 0 }, books: {}, started_at: new Date().toISOString(), ms: 0 });
    const cp = (!flag('reset') && fs.existsSync(CHECKPOINT)) ? JSON.parse(fs.readFileSync(CHECKPOINT, 'utf8')) : fresh();
    if (cp.scanned === 0 && fs.existsSync(CONFLICTS)) fs.truncateSync(CONFLICTS, 0);
    const save = () => fs.writeFileSync(CHECKPOINT, JSON.stringify(cp));
    console.log(`${SWEEP} — ${mode.toUpperCase()} — phase ${PHASES[cp.phase] ?? 'done'}, after ${cp.last_id ?? 'start'} (${cp.scanned} scanned)`);

    // --from: walk the dry run's candidate list instead of every page (the census already ran);
    // each batch is re-read by _id and the rule re-applied to the page's current OCR.
    const FROM = opt('from', null);
    const candidates = FROM ? fs.readFileSync(FROM, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : null;
    const CANDIDATES = path.join(OUT, `${SWEEP}.dry.candidates.jsonl`);
    if (!APPLY && cp.scanned === 0 && fs.existsSync(CANDIDATES)) fs.truncateSync(CANDIDATES, 0);
    cp.offset ??= 0;
    const project = { $project: { _id: 1, book_id: 1, page_number: 1, script_type: 1, 'ocr.updated_at': 1, 'ocr.language': 1, 'ocr.pipeline': 1, 'ocr.source': 1,
      has_ocr: { $gt: [{ $strLenCP: { $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, '$ocr.data', ''] } }, 0] },
      tag: { $regexFind: { input: { $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, '$ocr.data', ''] }, regex: TAG_RE.source, options: 'i' } } } };

    let t0 = Date.now(); let writesThisRun = 0;
    while (FROM ? cp.offset < candidates.length : cp.phase < PHASES.length) {
      const phase = FROM ? 'from' : PHASES[cp.phase];
      let docs;
      if (FROM) {
        const n = MAX_WRITES ? Math.min(CHUNK, MAX_WRITES - writesThisRun) : CHUNK;
        const batch = candidates.slice(cp.offset, cp.offset + n);
        const ids = batch.map((c) => (c.t === 'objectId' ? new ObjectId(c.id) : c.id));
        docs = await pages.aggregate([{ $match: { _id: { $in: ids } } }, project], { maxTimeMS: 600_000 }).toArray();
        cp.offset += batch.length;
      } else {
        const idMatch = cp.last_id == null ? { $type: phase }
          : { $type: phase, $gt: phase === 'objectId' ? new ObjectId(cp.last_id) : cp.last_id };
        // The tag is cut out server-side: only a few short fields per page cross the wire.
        docs = await pages.aggregate([{ $match: { _id: idMatch } }, { $sort: { _id: 1 } }, { $limit: CHUNK }, project],
          { maxTimeMS: 600_000 }).toArray();
        if (docs.length === 0) { cp.phase++; cp.last_id = null; save(); continue; }
      }

      const ops = []; const logged = {}; const conflictLines = []; const candidateLines = [];
      for (const d of docs) {
        // Rebuild a minimal ocr.data from the server-side match so the rule runs on exactly what it would see.
        const text = d.tag ? `<script>${d.tag.captures[0]}</script>` : d.has_ocr ? 'x' : '';
        const r = scriptTypeFill({ script_type: d.script_type, ocr: { data: text } });
        const lang = d.ocr?.language || '(none)';
        inc(cp.cells, `${r.field}|${r.tag}`);
        if (r.conflict) {
          cp.conflicts++;
          conflictLines.push(JSON.stringify({ page_id: String(d._id), book_id: d.book_id, page_number: d.page_number, field: r.field, tag: r.tag, language: lang, pipeline: d.ocr?.pipeline ?? d.ocr?.source ?? null }));
        }
        if (r.skip) { inc(cp.skipped, r.skip); if (r.raw !== undefined && (r.raw in cp.junk_values || Object.keys(cp.junk_values).length < 80)) inc(cp.junk_values, r.raw); continue; }
        inc(cp.would_fill, r.fill);
        cp.fill_by_lang[lang] ??= {}; inc(cp.fill_by_lang[lang], r.fill);
        inc(cp.fill_by_pipeline, `${d.ocr?.pipeline ?? d.ocr?.source ?? '(none)'}|${r.fill}`);
        inc(cp.books, d.book_id ?? '(none)');
        if (!APPLY) candidateLines.push(JSON.stringify({ id: String(d._id), t: d._id instanceof ObjectId ? 'objectId' : 'string' }));
        if (APPLY && (!MAX_WRITES || writesThisRun + ops.length < MAX_WRITES)) {
          ops.push({ d, value: r.fill, op: { updateOne: { filter: writeFilter(d), update: { $set: { script_type: r.fill } } } } });
        }
      }
      if (conflictLines.length) fs.appendFileSync(CONFLICTS, conflictLines.join('\n') + '\n');
      if (candidateLines.length) fs.appendFileSync(CANDIDATES, candidateLines.join('\n') + '\n');

      if (ops.length) {
        const ids = ops.map((o) => o.d._id);
        const before = VERIFY ? new Map((await pages.find({ _id: { $in: ids } }, { maxTimeMS: 600_000 }).toArray()).map((x) => [String(x._id), restHash(x)])) : null;
        const res = await pages.bulkWrite(ops.map((o) => o.op), { ordered: false });
        cp.written += res.modifiedCount; cp.raced += ops.length - res.matchedCount; writesThisRun += res.modifiedCount;
        // Which ones landed: re-read the field (bulkWrite does not say per op).
        const landed = new Map((await pages.find({ _id: { $in: ids } }, { projection: VERIFY ? undefined : { script_type: 1 }, maxTimeMS: 600_000 }).toArray()).map((x) => [String(x._id), x]));
        for (const o of ops) {
          const now = landed.get(String(o.d._id));
          if (now?.script_type !== o.value) continue;
          const b = o.d.book_id ?? '(none)';
          logged[b] ??= { page_ids: [], id_types: [], values: [], prev: [] };
          logged[b].prev.push(fieldState(o.d.script_type));
          logged[b].page_ids.push(String(o.d._id)); logged[b].id_types.push(o.d._id instanceof ObjectId ? 'objectId' : 'string'); logged[b].values.push(o.value);
          if (VERIFY) {
            const ok = before.get(String(o.d._id)) === restHash(now);
            cp.verified[ok ? 'ok' : 'changed']++;
            if (!ok) fs.appendFileSync(VERIFY_LOG, JSON.stringify({ page_id: String(o.d._id), book_id: b }) + '\n');
          }
        }
        await recordSweepActions(db, Object.entries(logged).map(([book_id, det]) => ({ sweep: SWEEP, book_id, action: ACTION, detail: { issue: 7263, ...det } })));
      }

      cp.scanned += docs.length;
      if (!FROM) cp.last_id = String(docs[docs.length - 1]._id);
      const now = Date.now(); cp.ms += now - t0; t0 = now;
      save();
      if (cp.scanned % (CHUNK * 40) < docs.length) {
        console.log(`  [${phase}] ${cp.scanned} scanned (${Math.round(cp.scanned / (cp.ms / 1000))}/s) · fill ${JSON.stringify(cp.would_fill)} · conflicts ${cp.conflicts}${APPLY ? ` · written ${cp.written} · raced ${cp.raced}` : ''}`);
      }
      if (APPLY && MAX_WRITES && writesThisRun >= MAX_WRITES) break;
      if (SLEEP) await new Promise((r) => setTimeout(r, SLEEP));
    }

    const { books, ...summary } = cp;
    summary.complete = FROM ? cp.offset >= candidates.length : cp.phase >= PHASES.length;
    summary.books_with_fills = Object.keys(books).length;
    summary.wall_s = Math.round(cp.ms / 1000);
    fs.writeFileSync(path.join(OUT, `${SWEEP}.${mode}.summary.json`), JSON.stringify(summary, null, 2));
    fs.writeFileSync(path.join(OUT, `${SWEEP}.${mode}.books.json`), JSON.stringify(books));
    console.log(JSON.stringify({ mode, complete: summary.complete, scanned: cp.scanned, would_fill: cp.would_fill, skipped: cp.skipped, conflicts: cp.conflicts,
      ...(APPLY ? { written: cp.written, raced: cp.raced, verified: cp.verified } : {}), books_with_fills: summary.books_with_fills, wall_s: summary.wall_s }, null, 2));
  } finally {
    await client.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
