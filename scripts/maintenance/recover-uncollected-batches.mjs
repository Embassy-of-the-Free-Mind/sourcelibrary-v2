#!/usr/bin/env node
/**
 * Recover paid Gemini batch results that were never collected (#6276) — staged, never overwriting.
 *
 * PRIOR ART: scripts/audit/batch-recovery-count.mjs — the read-only count this acts on (same row
 * selection, reused probeBatchJob()). scripts/workers/batch-collector.mjs processOneJob() — the
 * live collect path; it does not fit because it OVERWRITES a page's current text (it saves a
 * revision first, then writes), and 3,738 of the 3,818 pages in these jobs were OCR'd again
 * later, so routing the rows back to it (endBatchJob's route_to_collection) would replace newer
 * text with a 23-day-old read. This script parses with the collector's own shared helpers and
 * gates (ocr-result-parse, truncated-response, ocr-loop-guard, blank-page-guard, tex-greek,
 * translate-core, write-provenance), and writes ONLY pages that still have no text of that kind.
 * scripts/batch/collect-batch-results.mjs — same overwrite shape, Vercel-era.
 *
 * Stages (each its own subcommand; nothing writes production until `apply --apply`):
 *   download   batches.get (free) + result file download / inline responses (free) for every
 *              named, uncollected cancelled/failed/expired row that Gemini says SUCCEEDED.
 *              → $OUT/results/<job>.jsonl + $OUT/manifest.jsonl (bytes, sha256, model, …)
 *   classify   read-only: every page in those results against what production holds NOW.
 *              → $OUT/classified.jsonl.gz + counts
 *   apply      writes class MISSING only (dry run unless --apply; --limit N; --only-ids=a,b).
 *              Every write is filtered on the page STILL having no text, carries provenance
 *              (ocr.source 'batch_recovery', engine, prompt_version, batch job, recovered_at,
 *              content hash), and a sweep_log row.
 *   mark       stamps the recovered batch_jobs rows `recovery` + results_collected (no status write),
 *              then meters each one (below).
 *   meter      closes out each recovered job's gemini_usage row from the result file's
 *              usageMetadata, summed per response, via completeBatchUsage() — what the collector
 *              does on collection (#4599). Idempotent: a job already metered is skipped. Writes
 *              the meter only (dry run unless --apply). `mark` ran before metering existed
 *              (2026-10-08), so its 283 rows were backfilled with `meter --apply`.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/recover-uncollected-batches.mjs download --out=$JOB_SCRATCH
 *   … classify --out=$JOB_SCRATCH
 *   … apply --out=$JOB_SCRATCH [--limit=20] [--apply]
 *   … mark --out=$JOB_SCRATCH [--apply]
 *   … meter --out=$JOB_SCRATCH [--apply]
 *
 * Undo: every page written here has ocr.source / translation.source 'batch_recovery' and
 * `recovery.run_id`; it had no text before, so undo is $unset of the written fields on those pages
 * (sweep_log rows list each page id).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { GoogleGenAI } from '@google/genai';
import { probeBatchJob } from '../workers/lib/batch-reconcile.mjs';
import { geminiKeys } from '../audit/paid-vs-got.mjs';
import { completeBatchUsage, calculateUsageCost } from '../workers/lib/supabase-usage-logger.mjs';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const args = process.argv.slice(2);
const cmd = args[0];
const arg = (k) => args.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const OUT = arg('out') || process.env.JOB_SCRATCH;
const DAYS = Number(arg('days') || 60);
if (!OUT) { console.error('--out=DIR required (use $JOB_SCRATCH, never the repo)'); process.exit(2); }

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const safeName = (jobName) => jobName.replace(/^batches\//, '');

/** The same selection as batch-recovery-count.mjs. */
async function uncollectedRows(db) {
  const since = new Date(Date.now() - DAYS * 86400e3);
  return db.collection('batch_jobs').find({
    created_at: { $gte: since },
    status: { $in: ['cancelled', 'failed', 'expired'] },
    results_collected: { $ne: true },
    $or: [{ job_name: { $exists: true, $nin: [null, ''] } }, { gemini_job_name: { $exists: true, $nin: [null, ''] } }],
  }).sort({ created_at: 1 }).toArray();
}

/** The one batch_jobs row behind a Gemini job name (some rows carry no `id`, so never key on it). */
async function rowForJob(db, name) {
  const rows = await db.collection('batch_jobs').find({ $or: [{ job_name: name }, { gemini_job_name: name }] }).toArray();
  if (rows.length !== 1) throw new Error(`${name}: ${rows.length} batch_jobs rows — expected exactly one`);
  return rows[0];
}

async function download(db) {
  const keys = geminiKeys();
  // usage-ok: batches.get + file download only — metadata/result reads, no generation, nothing billed.
  const clients = keys.map((apiKey) => new GoogleGenAI({ apiKey }));
  const rows = await uncollectedRows(db);
  fs.mkdirSync(path.join(OUT, 'results'), { recursive: true });
  const manifest = fs.createWriteStream(path.join(OUT, 'manifest.jsonl'));
  const tally = { rows: rows.length, succeeded: 0, downloaded: 0, failed: 0, not_succeeded: 0, unmeasurable: 0 };
  for (const r of rows) {
    const name = r.job_name || r.gemini_job_name;
    const probe = await probeBatchJob(name, clients, keys);
    if (probe.verdict !== 'exists') { tally.unmeasurable += probe.verdict === 'unmeasurable' ? 1 : 0; continue; }
    const j = probe.sdkJob;
    if (j.state !== 'JOB_STATE_SUCCEEDED') { tally.not_succeeded++; continue; }
    tally.succeeded++;
    const file = path.join(OUT, 'results', `${safeName(name)}.jsonl`);
    let body;
    try {
      if (j.dest?.fileName) {
        const resp = await fetch(`${GEMINI_API_BASE}/${j.dest.fileName}:download?alt=media`, {
          headers: { 'x-goog-api-key': keys[probe.keyIndex] }, signal: AbortSignal.timeout(300_000) });
        if (!resp.ok) throw new Error(`download ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
        body = Buffer.from(await resp.arrayBuffer());
      } else if (j.dest?.inlinedResponses?.length) {
        body = Buffer.from(j.dest.inlinedResponses.map((x) => JSON.stringify(x)).join('\n') + '\n');
      } else throw new Error('SUCCEEDED with no output attached');
    } catch (e) {
      tally.failed++;
      manifest.write(JSON.stringify({ job_id: r.id || String(r._id), job: name, error: String(e.message || e) }) + '\n');
      continue;
    }
    fs.writeFileSync(file, body);
    tally.downloaded++;
    manifest.write(JSON.stringify({
      job_id: r.id || String(r._id), job: name, type: r.type, status: r.status, book_id: r.book_id, book_ids: r.book_ids || [r.book_id],
      pages: r.page_count || r.page_ids?.length || 0, pages_per_request: r.pages_per_request || 1,
      model: r.model, prompt_version: r.prompt_version ?? null, language: r.language ?? null,
      created_at: r.created_at, output: j.dest?.fileName ? 'file' : 'inline', key_index: probe.keyIndex,
      responses: body.toString('utf8').trim().split('\n').filter(Boolean).length,
      bytes: body.length, sha256: sha256(body), file,
      reason: r.cancel_reason || r.end_reason || r.error || null,
    }) + '\n');
    if ((tally.downloaded + tally.failed) % 25 === 0) console.error(`  ${tally.downloaded + tally.failed}/${rows.length}`);
  }
  manifest.end();
  await new Promise((res) => manifest.on('finish', res));
  console.log(JSON.stringify(tally));
}

// ── classify ────────────────────────────────────────────────────────────────

const HALLUCINATION_LIMIT = 25_000; // batch-collector.mjs
/** A Gemini read is never written for these (Syriac → Kraken lane, Tibetan → BDRC/Yigdzin lane). */
const NO_GEMINI_SCRIPTS = /syriac|tibetan/i;
const PAGE_PROJECTION = {
  id: 1, book_id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1,
  enhanced_photo: 1, split_from_spread: 1, 'ocr.data': 1, 'ocr.source': 1, 'ocr.edited_by': 1,
  'ocr.content_hash': 1, 'ocr.updated_at': 1, 'translation.data': 1, 'translation.source': 1,
  'translation.edited_by': 1, translation_withheld: 1,
};

const readManifest = () => fs.readFileSync(path.join(OUT, 'manifest.jsonl'), 'utf8').trim().split('\n')
  .map((l) => JSON.parse(l)).filter((m) => !m.error);
const readResults = (m) => fs.readFileSync(m.file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

/**
 * One result line → [{ pageId, text } | { pageId, bad }], with the collector's own gates in the
 * collector's order (batch-collector.mjs processOneJob). Text gates that need the page
 * (loop, blank image, translation meta/leak/stray) run later in classifyPage.
 */
function parseLine(r, job, h) {
  const multi = (job.pages_per_request || 1) > 1 && job.type === 'ocr';
  const candidate = r.response?.candidates?.[0];
  if (multi) {
    if (r.error) return [{ bad: `error:${String(r.error?.status || r.error?.code || r.error).slice(0, 60)}` }];
    if (candidate?.finishReason === 'RECITATION') return [{ bad: 'RECITATION' }];
    const text = h.candidateText(candidate);
    if (!text) return [{ bad: `no-text:${candidate?.finishReason || 'no-candidate'}` }];
    const parsed = h.parseMultiPageOcr(text, { lenient: true });
    const out = parsed.map(([pageId, t]) => ({ pageId, text: t }));
    if (h.isTruncatedCandidate(candidate) && out.length) out[out.length - 1] = { pageId: out.at(-1).pageId, bad: h.truncationFailReason(candidate) };
    return out;
  }
  const pageId = r.metadata?.key;
  if (!pageId) return [{ bad: 'missing-metadata-key' }];
  if (candidate?.finishReason === 'RECITATION') return [{ pageId, bad: 'RECITATION' }];
  if (r.error) return [{ pageId, bad: `error:${String(r.error?.status || r.error?.code || r.error).slice(0, 60)}` }];
  const text = h.candidateText(candidate);
  if (!text) return [{ pageId, bad: `no-text:${candidate?.finishReason || 'no-candidate'}` }];
  if (h.isTruncatedCandidate(candidate)) return [{ pageId, bad: h.truncationFailReason(candidate) }];
  return [{ pageId, text, usage: r.response?.usageMetadata }];
}

async function loadHelpers() {
  const [parse, trunc, loop, blank, tex, longS, tc, integ, img, prov] = await Promise.all([
    import('../lib/ocr-result-parse.mjs'), import('../lib/truncated-response.mjs'), import('../lib/ocr-loop-guard.mjs'),
    import('../lib/blank-page-guard.mjs'), import('../lib/tex-greek.mjs'), import('../lib/ocr-long-s-retry.mjs'),
    import('../lib/translate-core.mjs'), import('../lib/page-integrity.mjs'), import('../lib/page-image-url.mjs'),
    import('../lib/write-provenance.mjs'),
  ]);
  return { ...parse, ...trunc, loopVerdict: loop.loopVerdict, loopGuardEnabled: loop.guardEnabled,
    shouldRefuseOcrWrite: blank.shouldRefuseOcrWrite, blankGuardEnabled: blank.guardEnabled,
    repairTexGreek: tex.repairTexGreek, texGreekRepairEnabled: tex.texGreekRepairEnabled,
    LONG_S_GLYPH_VARIANT: longS.LONG_S_GLYPH_VARIANT, foldLongS: longS.foldLongS,
    hidesPageInMeta: tc.hidesPageInMeta, strayScriptGate: tc.strayScriptGate, guardTranslationText: tc.guardTranslationText,
    refusableReasoningLeak: integ.refusableReasoningLeak, getPageSource: img.getPageSource, ...prov };
}

/** Final text exactly as the collector would write it (TeX-Greek repair, long-s fold, translation guards). */
async function finalText(db, h, job, page, text) {
  let t = text;
  if (h.texGreekRepairEnabled()) t = h.repairTexGreek(t).text;
  if (job.type === 'ocr') {
    if (job.prompt_variant === h.LONG_S_GLYPH_VARIANT) t = h.foldLongS(t);
    return { text: t };
  }
  if (h.hidesPageInMeta(t)) return { bad: 'hidden-in-meta' };
  if (h.refusableReasoningLeak(t)) return { bad: 'reasoning-leak' };
  const stray = await h.strayScriptGate(db, page, t, { language: job.language, dryRun: true });
  if (stray.refused) return { bad: 'stray-script' };
  return { text: h.guardTranslationText(stray.text) };
}

/**
 * The verdict for one parsed page result against production NOW. Class:
 *   MISSING  — no text of this kind; candidate to write
 *   HAS_NEWER — already has text of this kind; never overwritten
 *   SKIP:<reason> — anything the pipeline's gates or this brief exclude
 */
async function classifyPage(db, h, job, jobRow, item, page, book) {
  const field = job.type === 'ocr' ? 'ocr' : 'translation';
  if (item.bad) return { cls: 'SKIP', reason: `bad_result:${item.bad.replace(/:.*/, '')}`, detail: item.bad };
  if (!page) return { cls: 'SKIP', reason: 'page_missing' };
  if (!job.book_ids.includes(page.book_id)) return { cls: 'SKIP', reason: 'wrong_book' };
  if (!book) return { cls: 'SKIP', reason: 'book_missing' };
  if ((page.page_number ?? 0) <= 0) return { cls: 'SKIP', reason: 'soft_hidden' };
  if (book.pipeline_auto?.hold || book.pipeline_auto?.status === 'held') return { cls: 'SKIP', reason: 'book_held' };
  const langs = [book.language, book.original_language, ...(book.languages || [])].filter(Boolean).join(' ');
  if (NO_GEMINI_SCRIPTS.test(langs)) return { cls: 'SKIP', reason: 'script_never_from_gemini' };
  const sub = page[field] || {};
  if (sub.source === 'manual' || (sub.edited_by && sub.edited_by !== '')) return { cls: 'SKIP', reason: 'human_edited' };
  if (field === 'translation' && page.translation_withheld) return { cls: 'SKIP', reason: 'withheld' };
  if (typeof sub.data === 'string' && sub.data.trim()) return { cls: 'HAS_NEWER' };
  if (item.text.length > HALLUCINATION_LIMIT) return { cls: 'SKIP', reason: 'bad_result:over-hallucination-limit' };

  const src = (jobRow.page_sources || []).find((s) => s.page_id === page.id);
  if (field === 'ocr') {
    // Paired artifacts: the image Gemini read must still be this page's image.
    if (!src?.source_url) return { cls: 'SKIP', reason: 'no_sent_image_url' };
    const current = h.getPageSource(page);
    if (current !== src.source_url) return { cls: 'SKIP', reason: 'image_changed_since_read', detail: { sent: src.source_url, current } };
    if (h.loopGuardEnabled() && h.loopVerdict(item.text).refuse) return { cls: 'SKIP', reason: 'bad_result:repetition-loop' };
    if (h.blankGuardEnabled()) {
      const v = await h.shouldRefuseOcrWrite({ text: item.text, imageUrl: src.source_url }).catch(() => ({ refuse: false }));
      if (v.refuse) return { cls: 'SKIP', reason: 'bad_result:blank-page' };
    }
  } else {
    // A translation is written only onto the OCR it was made from.
    const cur = typeof page.ocr?.data === 'string' ? page.ocr.data : '';
    if (!cur.trim()) return { cls: 'SKIP', reason: 'stale:no_current_ocr' };
    if (!src?.source_text_hash) return { cls: 'SKIP', reason: 'stale:source_hash_not_recorded' };
    if (h.contentHash(cur) !== src.source_text_hash) return { cls: 'SKIP', reason: 'stale:ocr_changed_since_translated' };
  }
  const fin = await finalText(db, h, job, page, item.text);
  if (fin.bad) return { cls: 'SKIP', reason: `bad_result:${fin.bad}` };
  return { cls: 'MISSING', text: fin.text };
}

async function classify(db, { write = true } = {}) {
  const h = await loadHelpers();
  const manifest = readManifest();
  const jobRows = new Map();
  for (const m of manifest) jobRows.set(m.job, await rowForJob(db, m.job));
  const out = [];
  for (const m of manifest) {
    const jobRow = jobRows.get(m.job);
    const job = { ...m, prompt_variant: jobRow.prompt_variant };
    const items = readResults(m).flatMap((r) => parseLine(r, job, h));
    const ids = [...new Set(items.map((i) => i.pageId).filter(Boolean))];
    const pages = new Map((await db.collection('pages').find({ id: { $in: ids } }, { projection: PAGE_PROJECTION }).toArray()).map((p) => [p.id, p]));
    const bookIds = [...new Set([...pages.values()].map((p) => p.book_id))];
    const books = new Map((await db.collection('books').find({ id: { $in: bookIds } },
      { projection: { id: 1, title: 1, language: 1, original_language: 1, languages: 1, visible: 1, pipeline_auto: 1 } }).toArray()).map((b) => [b.id, b]));
    for (const item of items) {
      const page = item.pageId ? pages.get(item.pageId) : null;
      const book = page ? books.get(page.book_id) : null;
      const v = await classifyPage(db, h, job, jobRow, item, page, book);
      out.push({ job_id: m.job_id, job: m.job, type: m.type, month: String(m.created_at).slice(0, 7), page_id: item.pageId || null,
        book_id: page?.book_id || null, page_number: page?.page_number ?? null, ...v,
        ...(v.text ? { text_hash: h.contentHash(v.text), chars: v.text.length } : {}) });
    }
  }
  // A page read by more than one recovered job: keep one candidate (the latest job), the rest are duplicates.
  const seen = new Set();
  for (const r of [...out].reverse()) {
    if (r.cls !== 'MISSING') continue;
    const k = `${r.type}:${r.page_id}`;
    if (seen.has(k)) { r.cls = 'SKIP'; r.reason = 'duplicate_in_recovery'; delete r.text; } else seen.add(k);
  }
  if (write) fs.writeFileSync(path.join(OUT, 'classified.jsonl.gz'), zlib.gzipSync(out.map((r) => JSON.stringify(r)).join('\n') + '\n'));
  const counts = {};
  for (const r of out) {
    const k = `${r.type}\t${r.month}\t${r.cls}${r.reason ? `\t${r.reason}` : ''}`;
    counts[k] = (counts[k] || 0) + 1;
  }
  for (const [k, n] of Object.entries(counts).sort()) console.log(`${n}\t${k}`);
  return out;
}

// ── apply ───────────────────────────────────────────────────────────────────

const CALL_SITE = 'scripts/maintenance/recover-uncollected-batches.mjs';
const SWEEP = 'batch-recovery-6276';

/**
 * Write class MISSING (OCR only — translation results are applied only onto the OCR they were
 * made from, and the classify stage reports how many qualify). Re-classifies against production
 * at write time, so a page that gained text since `classify` is skipped, and the write filter
 * itself requires the page to still have no OCR. `--only-ids` is required to write: the ids are
 * the pages read against their images and passed; `--rejected=id:reason,…` are recorded as not
 * written.
 */
async function apply(db, { write }) {
  const only = (arg('only-ids') || '').split(',').filter(Boolean);
  const rejected = (arg('rejected') || '').split(',').filter(Boolean).map((s) => s.split(':'));
  if (write && !only.length) throw new Error('apply --apply needs --only-ids= (the pages read by eye and passed)');
  const h = await loadHelpers();
  const { liftOcrTags, parseDetectedImages } = await import('../lib/ocr-result-parse.mjs');
  const { recordSweepAction } = await import('../lib/sweep-log.mjs');
  const { syncBookTranslationCounters } = await import('../lib/translate-core.mjs');
  const { syncPageBatch } = await import('../workers/lib/supabase-page-writer.mjs');
  const runId = `${SWEEP}-${new Date().toISOString()}`;
  const fresh = await classify(db, { write: false });
  const cands = fresh.filter((r) => r.cls === 'MISSING' && r.type === 'ocr' && (!only.length || only.includes(r.page_id)));
  const limit = Number(arg('limit') || Infinity);
  const manifest = new Map(readManifest().map((m) => [m.job, m]));
  const jobRows = new Map();
  for (const name of new Set(cands.map((c) => c.job))) jobRows.set(name, await rowForJob(db, name));
  const touchedBooks = new Set();
  let written = 0;
  for (const c of cands.slice(0, limit)) {
    const job = jobRows.get(c.job);
    const m = manifest.get(c.job);
    const jobIdStr = job.id || String(job._id);
    const now = new Date();
    const src = (job.page_sources || []).find((s) => s.page_id === c.page_id);
    const engine = h.engineFromBatchJob(job, {
      batch_job_id: jobIdStr, collected_by: CALL_SITE, now,
      input: h.imageInput({ url: src.source_url }),
      prompt_sent_hash: src.prompt_sent_hash, prompt_sent_chars: src.prompt_sent_chars,
    });
    const prov = h.ocrProvenance(c.text, engine);
    const detectedImages = parseDetectedImages(c.text);
    const setObj = {
      'ocr.data': c.text,
      'ocr.has_warning': /<warning[\s>]/i.test(c.text),
      'ocr.updated_at': now,
      'ocr.model': job.model,
      'ocr.language': job.language,
      'ocr.source': job.ocr_source || 'batch_api',
      'ocr.prompt_version': job.prompt_version || 'v5.2026-02',
      'ocr.prompt_id': job.prompt_id,
      'ocr.prompt_hash': job.prompt_hash,
      'ocr.prompt_name': job.prompt_name,
      ...(job.prompt_variant ? { 'ocr.prompt_variant': job.prompt_variant } : {}),
      'ocr.batch_job_id': jobIdStr,
      'ocr.source_url': src.source_url,
      ...(job.code_version ? { 'ocr.code_version': job.code_version } : {}),
      'ocr.content_hash': prov.content_hash,
      'ocr.engine': prov.engine,
      ...liftOcrTags(c.text),
      ...(detectedImages.length ? { detected_images: detectedImages } : {}),
      updated_at: now,
    };
    const detail = { page_id: c.page_id, page_number: c.page_number, field: 'ocr', batch_job_id: jobIdStr, gemini_job: m.job,
      model: job.model, prompt_version: job.prompt_version ?? null, content_hash: prov.content_hash, chars: c.text.length,
      result_sha256: m.sha256, run_id: runId, issue: 6276, read_by_eye: 'passed' };
    if (!write) { console.log(`DRY ${c.book_id} p${c.page_number} ${c.page_id} ${c.text.length} chars`); continue; }
    const res = await db.collection('pages').updateOne(
      { id: c.page_id, book_id: c.book_id, $or: [{ 'ocr.data': { $exists: false } }, { 'ocr.data': { $in: [null, ''] } }],
        'ocr.source': { $ne: 'manual' } },
      { $set: setObj, $unset: { 'ocr.fail_count': '', 'ocr.fail_reason': '', 'ocr.fail_blocked': '', 'ocr.fail_blocked_at': '', 'ocr.fail_blocked_model': '' } },
    );
    const back = await db.collection('pages').findOne({ id: c.page_id }, { projection: { 'ocr.content_hash': 1 } });
    const ok = res.modifiedCount === 1 && back?.ocr?.content_hash === prov.content_hash;
    console.log(`${ok ? 'WROTE' : 'NOT WRITTEN'} ${c.book_id} p${c.page_number} ${c.page_id} modified=${res.modifiedCount} hash=${back?.ocr?.content_hash}`);
    if (!ok) continue;
    written++;
    touchedBooks.add(c.book_id);
    await recordSweepAction(db, { sweep: SWEEP, book_id: c.book_id, action: 'ocr-recovered-from-uncollected-batch', detail });
    syncPageBatch([{ pageId: c.page_id, mongoSet: setObj }]);
  }
  for (const [pageId, reason] of rejected) {
    const r = fresh.find((x) => x.page_id === pageId);
    if (write && r) await recordSweepAction(db, { sweep: SWEEP, book_id: r.book_id, action: 'not-written-failed-by-eye',
      detail: { page_id: pageId, page_number: r.page_number, gemini_job: r.job, reason, run_id: runId, issue: 6276 } });
  }
  for (const b of touchedBooks) console.log(`counters ${b}:`, JSON.stringify(await syncBookTranslationCounters(db, b)));
  console.log(`written ${written}/${cands.length} (run ${runId})`);
  await new Promise((r) => setTimeout(r, 3000)); // let the fire-and-forget Supabase sync land
}

// ── mark ────────────────────────────────────────────────────────────────────

/**
 * Close every downloaded row through markRecovered() (scripts/lib/end-batch-job.mjs): Gemini is
 * asked again, the held result's sha256 is re-checked on disk, and the row gets
 * results_collected + a `recovery` record of what happened to each page. Status is untouched.
 */
async function mark(db, { write }) {
  const { markRecovered } = await import('../lib/end-batch-job.mjs');
  const keys = geminiKeys();
  // usage-ok: batches.get only — metadata, nothing billed.
  const clients = keys.map((apiKey) => new GoogleGenAI({ apiKey }));
  const classified = zlib.gunzipSync(fs.readFileSync(path.join(OUT, 'classified.jsonl.gz'))).toString().trim().split('\n').map((l) => JSON.parse(l));
  const written = new Set((arg('written') || '').split(',').filter(Boolean));
  const byJob = new Map();
  for (const r of classified) {
    const e = byJob.get(r.job) || {};
    const k = written.has(r.page_id) && r.type === 'ocr' ? 'written' : r.cls === 'MISSING' ? 'missing_not_written' : r.cls === 'HAS_NEWER' ? 'has_newer' : `skip_${r.reason}`;
    e[k] = (e[k] || 0) + 1;
    byJob.set(r.job, e);
  }
  const tally = {};
  for (const m of readManifest()) {
    const row = await rowForJob(db, m.job);
    const onDisk = fs.readFileSync(m.file);
    if (sha256(onDisk) !== m.sha256) throw new Error(`${m.file}: sha256 changed since download`);
    const gemini = await probeBatchJob(m.job, clients, keys);
    const r = await markRecovered(db, row, {
      gemini, by: CALL_SITE, dryRun: !write,
      recovery: { issue: 6276, gemini_job: m.job, result_sha256: m.sha256, result_bytes: m.bytes, responses: m.responses,
        output: m.output, pages: byJob.get(m.job) || {}, label_was: row.status,
        note: 'Gemini SUCCEEDED; result downloaded and every page classified against production. Pages written only where none existed and the read passed by eye; see sweep_log batch-recovery-6276.' },
    });
    const k = `${r.action}${r.modified ? '' : write && r.action === 'marked' ? ' (not modified)' : ''}`;
    tally[k] = (tally[k] || 0) + 1;
    if (r.action === 'refused') console.log(`refused ${m.job_id} ${m.job}: ${r.why}`);
  }
  console.log(JSON.stringify(tally));
  await meter(db, { write });
}

// ── meter ───────────────────────────────────────────────────────────────────

/**
 * The Mongo gemini_usage rows for these jobs, in ONE query: `batch_job_id` is unindexed on a
 * multi-million-row collection, so the scan is bounded by `_id` time (as spend-guard.mjs selects)
 * from the day before the earliest job was created — a row about a job cannot predate the job.
 */
async function mongoUsageByJob(db, rows) {
  const since = new Date(Math.min(...rows.map((r) => new Date(r.created_at).getTime())) - 86400e3);
  const ids = rows.map((r) => r.id || String(r._id));
  const found = await db.collection('gemini_usage').find(
    { _id: { $gte: ObjectId.createFromTime(Math.floor(since.getTime() / 1000)) }, batch_job_id: { $in: ids } },
    { projection: { batch_job_id: 1, status: 1, input_tokens: 1, output_tokens: 1, cost_usd: 1 } }).toArray();
  const by = new Map();
  for (const r of found) by.set(r.batch_job_id, [...(by.get(r.batch_job_id) || []), { ...r, store: 'mongo' }]);
  return by;
}

/** Every Supabase gemini_usage row the job has. With the Mongo rows: both stores spend-guard sums. */
async function supabaseUsageRows(batchJobId) {
  const url = process.env.SUPABASE_URL || 'https://ykhxaecbbxaaqlujuzde.supabase.co';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY unset — cannot tell a metered job from an unmetered one');
  const resp = await fetch(`${url}/rest/v1/gemini_usage?batch_job_id=eq.${encodeURIComponent(batchJobId)}&select=id,status,input_tokens,output_tokens,cost_usd`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!resp.ok) throw new Error(`gemini_usage read ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  return resp.json();
}

/**
 * Close out each recovered job's usage row from its downloaded result (meterRecovered in
 * scripts/lib/end-batch-job.mjs → completeBatchUsage). Only rows marked recovered by THIS
 * script are metered, and nothing but the meter is written.
 */
async function meter(db, { write }) {
  const { meterRecovered } = await import('../lib/end-batch-job.mjs');
  const tally = { jobs: 0, responses: 0, errored: 0, input_tokens: 0, output_tokens: 0, est_usd: 0, rows_before: {} };
  const actions = {};
  const manifest = readManifest();
  const jobRows = new Map();
  for (const m of manifest) jobRows.set(m.job, await rowForJob(db, m.job));
  const mongoRows = await mongoUsageByJob(db, [...jobRows.values()]);
  for (const m of manifest) {
    const row = jobRows.get(m.job);
    if (row.recovery?.by !== CALL_SITE) { actions['not marked recovered'] = (actions['not marked recovered'] || 0) + 1; continue; }
    const onDisk = fs.readFileSync(m.file);
    if (sha256(onDisk) !== m.sha256) throw new Error(`${m.file}: sha256 changed since download`);
    const batchJobId = row.id || String(row._id);
    const existing = [...await supabaseUsageRows(batchJobId), ...(mongoRows.get(batchJobId) || [])];
    const before = existing.length ? existing.map((e) => `${e.store || 'supabase'}:${e.status}`).join('+') : 'none';
    tally.rows_before[before] = (tally.rows_before[before] || 0) + 1;
    const r = await meterRecovered(row, readResults(m), { existing, complete: (p) => completeBatchUsage(p, db), dryRun: !write });
    tally.jobs++;
    tally.responses += r.responded;
    tally.errored += r.errored;
    if (r.action === 'closed') {
      tally.input_tokens += r.params.input_tokens;
      tally.output_tokens += r.params.output_tokens;
      tally.est_usd += calculateUsageCost(r.params.model, r.params.input_tokens, r.params.output_tokens, true);
    }
    const k = `${r.action}: ${r.result ? `${r.why} → ${r.result}` : r.why}`;
    actions[k] = (actions[k] || 0) + 1;
    if (r.action === 'refused') console.log(`refused ${m.job}: ${r.why}`);
  }
  tally.est_usd = +tally.est_usd.toFixed(4);
  console.log(JSON.stringify({ write, ...tally, actions }, null, 1));
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30_000 });
  await client.connect();
  try {
    const db = client.db(process.env.MONGODB_DB || 'bookstore');
    if (cmd === 'download') await download(db);
    else if (cmd === 'classify') await classify(db);
    else if (cmd === 'apply') await apply(db, { write: args.includes('--apply') });
    else if (cmd === 'mark') await mark(db, { write: args.includes('--apply') });
    else if (cmd === 'meter') await meter(db, { write: args.includes('--apply') });
    else { console.error(`unknown command '${cmd}' (download | classify | apply | mark | meter)`); process.exitCode = 2; }
  } finally { await client.close().catch(() => {}); }
}
await main();
