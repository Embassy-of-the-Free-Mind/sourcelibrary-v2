#!/usr/bin/env node
/**
 * provenance-grades.mjs — for each page and field (`ocr`, `translation`), HOW WELL do we know what
 * wrote the text? One grade per page × field, the evidence it rests on, and the month the text was
 * written. READ-ONLY: it has no write path; the full build that stores the grades in a new
 * collection is a separate change, started after the dry-run counts are read (sourcelibrary-v3 #201).
 *
 * PRIOR ART: scripts/audit/provenance-coverage.mjs — the daily audit of NEW writes, grouped by
 *   writer; it never looks at pre-2026-09-28 pages and returns missing/marker lists, not a grade.
 *   scripts/audit/provenance-ledger.mjs — the ai-partners percentages: whole-sample rates, no
 *   per-page grade, and its "full record" requires a Gemini or specialist engine, so a batch_api page
 *   with model + prompt + job, an ia_djvu page and an Esukhia import all land in one "no engine"
 *   bucket. The 2026-11-05 census (prov-by-month.mjs, on the job box) counted engine/inferred/
 *   not-recorded by month but read only `engine.schema`, so every specialist engine block (BDRC,
 *   Paddle, LightOnOCR) counted as not recorded, and its call-log probe swallowed query errors
 *   (`.catch(() => [])`). Reused here, not re-derived: missingProvenance(), inferHistoricalGeneration()
 *   and isNotRecorded() from scripts/lib/write-provenance.mjs; the batch-job window (created_at − 1 h …
 *   completed_at + 3 d) and the batch_jobs id/job_name/gemini_job_name lookup from provenance-ledger.
 *
 * ── Grades, in order of precedence ───────────────────────────────────────────
 *
 *   recorded          an engine block on the page (gemini-engine/1, or a specialist engine object).
 *                     evidence.missing / evidence.markers carry missingProvenance()'s gaps, so a block
 *                     with holes is visible, not hidden inside the grade.
 *   human             a person's text: source manual / manual-backfill / volunteer-correction, or
 *                     `edited_by` on the field — unless the correction block says the assistant drafted
 *                     it (correction.drafted_by 'assistant': a Claude draft applied by a model second
 *                     reader; graded recorded_on_page, rule correction-block, since the page names both). Never graded inferred (#201: "do not grade a person's
 *                     text as inferred"). Ranked above recorded_on_page so a hand edit of a batch page
 *                     is not credited to the batch job.
 *   recorded_on_page  no engine block, but the page itself names the writer: a Gemini source with
 *                     model + prompt_version + batch_job_id (the batch_api shape); the Archive's OCR
 *                     engine version (ia_djvu: ia.module_version / model `ia-ocr/<v>`); or a non-Gemini
 *                     engine named on the page (model + a string engine or a pipeline label, e.g. mineru);
 *                     or an assistant-drafted correction block (see human).
 *                     Settings are still inferred: evidence.settings_rule names the dated rule, if any.
 *   imported          a named edition, no model involved: text_edition / text_source on the field
 *                     (esukhia-derge-*, sefaria, …) or a corpus import source (corpus, wikisource).
 *   inferred          a Gemini source whose settings a dated rule in provenance-history.json covers
 *                     (inferHistoricalGeneration). corroborated: true when an independent record names
 *                     the page or its job, of this field's type, inside the time window, with the same
 *                     model as the page (the rules carry no model id; the page's `model` is the claim
 *                     being checked): a batch_jobs row (by the page's batch_job_id), a Mongo gemini_usage
 *                     row (page_ids contains the page, or batch_job_id = the page's job), or a Supabase
 *                     gemini_usage row (batch_job_id = the page's job; Supabase rows carry no page ids).
 *   not_recorded      none of the above; evidence.reason says why (no source, a relocation sweep, a
 *                     rule-ambiguous window, no rule for the date).
 *
 * A page with no text in the field gets no row (translation text = `data` or `text`).
 * The month written is updated_at, else generated_at, else edited_at ('none' if all are absent).
 *
 * ── Dry run ──────────────────────────────────────────────────────────────────
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/audit/provenance-grades.mjs \
 *     --sample=60000            pages drawn with $sample (unseeded WiredTiger random cursor; the drawn
 *                               _ids are written to --ids-out so the same draw can be re-graded)
 *     --ids-in=FILE             grade these page _ids instead of drawing (one per line)
 *     --ids-out=FILE            write the drawn _ids
 *     --json=FILE               full result (counts, controls, examples, sizing)
 *     --examples=20             page ids listed per grade
 *     --scan-test=200000        pages read sequentially to time a full-build scan (0 = skip)
 *     --no-supabase             skip the Supabase gemini_usage join (then corroboration is partial: says so)
 *
 * Exit 0 = measured. Exit 2 = could not measure: a query failed or timed out, the sample came back
 * smaller than asked, or a positive control failed (a probe that cannot find a known record cannot
 * be trusted to report "not_recorded" or "corroborated: false"). A short sample is not a result.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { missingProvenance, inferHistoricalGeneration, isNotRecorded } from '../lib/write-provenance.mjs';

export const GRADES = ['recorded', 'human', 'recorded_on_page', 'imported', 'inferred', 'not_recorded'];
export const GRADER_VERSION = 'provenance-grade/1';

const GEMINI = new Set(['ai', 'batch_api', 'pipeline_preview', 'batch_api_recovery', 'realtime_api_sequential', 'AI generated']);
const HUMAN = new Set(['manual', 'manual-backfill', 'volunteer-correction']);
const CORPUS_IMPORT = new Set(['corpus', 'wikisource']);
// Sweeps that moved or rewrote text that was already on some page (data-provenance.md, "Repair sweeps write here too").
const RELOCATION = /^(spread-split|ia-ocr-repair|reocr-contamination-repair-\d+|ai-repair-sync|leaf-shift-repair-\d+)$/;
const H = 3600e3, D = 86400e3;

const nonEmpty = (v) => typeof v === 'string' && v.length > 0;
const toDate = (v) => (v instanceof Date ? v : v ? new Date(v) : null);
const valid = (d) => d instanceof Date && !Number.isNaN(d.getTime());

/** Does the field hold text? `has` overrides when the caller stripped the bodies server-side. */
export function hasText(field, sub, has) {
  if (typeof has === 'boolean') return has;
  if (!sub || typeof sub !== 'object') return false;
  return nonEmpty(sub.data) || (field === 'translation' && nonEmpty(sub.text));
}

export function writtenAt(sub) {
  for (const k of ['updated_at', 'generated_at', 'edited_at']) { const d = toDate(sub?.[k]); if (valid(d)) return { at: d, clock: k }; }
  return { at: null, clock: null };
}

export const monthOf = (sub) => { const { at } = writtenAt(sub); return at ? at.toISOString().slice(0, 7) : 'none'; };

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] != null && o[k] !== '').map((k) => [k, o[k]]));

/**
 * Grade one field of one page. Pure: no I/O. Returns null when the field holds no text.
 * Corroboration is added by corroborate(), which needs fetched records.
 * @param {'ocr'|'translation'} field
 * @param {object} sub   the page's ocr / translation subdocument (text bodies may be stripped)
 * @param {{ has?: boolean }} [opts]
 */
export function gradeField(field, sub, opts = {}) {
  if (!hasText(field, sub, opts.has)) return null;
  const s = sub;
  const src = s.source ?? null;
  const month = monthOf(s);
  const { clock } = writtenAt(s);
  const base = { field, month, clock, source: src };
  const e = s.engine;

  if (e && typeof e === 'object' && !isNotRecorded(e)) {
    const { missing, markers } = missingProvenance(field, s);
    return { ...base, grade: 'recorded', evidence: { fields: ['engine'], engine: e.schema || e.name || null, model: e.model ?? s.model ?? null, call_site: e.call_site ?? null, api: e.api ?? null, missing, markers, ...(s.edited_by ? { edited_by: s.edited_by } : {}) } };
  }

  if (HUMAN.has(src) || nonEmpty(s.edited_by)) {
    // A `volunteer-correction` drafted by the assistant and applied by a model second reader is not a
    // person's text: the page names the model and the run in its correction block (#6418, #6679).
    const k = s.correction;
    if (k && typeof k === 'object' && k.drafted_by === 'assistant') {
      return { ...base, grade: 'recorded_on_page', evidence: { rule: 'correction-block', fields: ['correction.drafted_by', 'correction.assistant_model', 'correction.second_reader', 'edited_by'], assistant_model: k.assistant_model ?? null, second_reader: k.second_reader ?? null, correction_id: k.id ?? null, revision_id: k.revision_id ?? null, edited_by: s.edited_by ?? null } };
    }
    return { ...base, grade: 'human', evidence: { fields: ['source', 'edited_by'].filter((k) => s[k] != null), ...pick(s, ['edited_by', 'edited_at', 'model']), ...(s.correction?.id ? { correction_id: s.correction.id } : {}) } };
  }

  const settings = () => { const inf = inferHistoricalGeneration(field, { ...s, engine: undefined }); return inf.status === 'inferred' ? inf.rule : null; };

  if (GEMINI.has(src) && nonEmpty(s.model) && s.prompt_version != null && s.prompt_version !== '' && nonEmpty(s.batch_job_id)) {
    return { ...base, grade: 'recorded_on_page', evidence: { rule: 'model+prompt_version+batch_job_id', fields: ['model', 'prompt_version', 'batch_job_id'], ...pick(s, ['model', 'prompt_version', 'batch_job_id', 'prompt_id', 'prompt_hash']), settings_rule: settings() } };
  }
  if (src === 'ia_djvu' && (nonEmpty(s.ia?.module_version) || /^ia-ocr\//.test(s.model || ''))) {
    return { ...base, grade: 'recorded_on_page', evidence: { rule: 'ia-ocr-engine-version', fields: ['model', 'ia.engine', 'ia.module_version'].filter((k) => (k === 'model' ? s.model : s.ia?.[k.slice(3)])), model: s.model ?? null, ia_engine: s.ia?.engine ?? null, module_version: s.ia?.module_version ?? null, item: s.ia?.item ?? null } };
  }

  const edition = s.text_edition || s.text_source;
  if ((edition && typeof edition === 'object') || CORPUS_IMPORT.has(src)) {
    return { ...base, grade: 'imported', evidence: { fields: ['text_edition', 'text_source', 'source'].filter((k) => s[k] != null), source: src, edition: edition?.name ?? null, repo: edition?.repo ?? edition?.url ?? null, commit: edition?.commit ?? edition?.version ?? null } };
  }

  if (src && !GEMINI.has(src) && !RELOCATION.test(src) && nonEmpty(s.model) && (nonEmpty(e) || nonEmpty(s.pipeline))) {
    return { ...base, grade: 'recorded_on_page', evidence: { rule: 'engine-named-on-page', fields: ['model', nonEmpty(e) ? 'engine' : 'pipeline'], model: s.model, engine: nonEmpty(e) ? e : null, pipeline: s.pipeline ?? null } };
  }

  if (src && RELOCATION.test(src)) return { ...base, grade: 'not_recorded', evidence: { reason: `relocated or rewritten by sweep '${src}', not read from this page`, ...pick(s, ['model']) } };

  if (GEMINI.has(src)) {
    const inf = inferHistoricalGeneration(field, { ...s, engine: undefined });
    if (inf.status === 'inferred') return { ...base, grade: 'inferred', evidence: { rule: inf.rule, fields: ['source', clock, ...(s.code_version ? ['code_version'] : [])], ...pick(s, ['model', 'prompt_version', 'batch_job_id']) } };
    return { ...base, grade: 'not_recorded', evidence: { reason: inf.reason, ...pick(s, ['model', 'prompt_version']) } };
  }

  return { ...base, grade: 'not_recorded', evidence: { reason: src ? `source '${src}': no engine, no named edition, no dated rule` : 'no source on the field', ...pick(s, ['model', 'prompt_version']) } };
}

const TYPE_RE = { ocr: /^ocr$|^spread-ocr$/, translation: /^translat(e|ion)$/ };

/**
 * Corroborate a Gemini page against independent records. Pure: records are passed in.
 * @param {'ocr'|'translation'} field
 * @param {object} sub
 * @param {string[]} pageKeys  the page's `id` and String(_id)
 * @param {{ jobs: Map<string,object>, usage: object[], usageByJob: Map<string,object[]> }} recs
 *   jobs: batch_jobs rows keyed by id / job_name / gemini_job_name / String(_id)
 *   usage: Mongo gemini_usage rows of this page's book (page_ids, type, model, timestamp, batch_job_id)
 *   usageByJob: gemini_usage rows (Mongo or Supabase) keyed by batch_job_id
 * @returns {{ corroborated: boolean, by: object|null, contradictions: string[], looked: string[] }}
 */
export function corroborate(field, sub, pageKeys, recs) {
  const { at: t } = writtenAt(sub);
  const model = sub?.model || null;
  const typeOk = (x) => TYPE_RE[field].test(String(x || ''));
  const contradictions = [];
  const looked = [];
  const modelOk = (m, what) => { if (!m || !model || m === model) return true; contradictions.push(`${what} model ${m} ≠ page model ${model}`); return false; };
  if (!t) return { corroborated: false, by: null, contradictions: ['no write date on the page'], looked };
  const jid = sub?.batch_job_id || null;

  if (jid) {
    looked.push('batch_jobs');
    const job = recs.jobs?.get(jid);
    if (job && typeOk(job.type)) {
      const start = toDate(job.created_at), end = toDate(job.completed_at) || toDate(job.updated_at);
      const inWin = valid(start) && t >= new Date(+start - H) && (!valid(end) || t <= new Date(+end + 3 * D));
      if (!inWin) contradictions.push('page written outside its batch job window');
      else if (modelOk(job.model, 'batch job')) return { corroborated: true, by: { record: 'batch_jobs', id: job.id ?? String(job._id), model: job.model ?? null, at: start }, contradictions, looked };
    }
    looked.push('gemini_usage by batch_job_id');
    for (const u of recs.usageByJob?.get(jid) || []) {
      if (!typeOk(u.type)) continue;
      const ut = toDate(u.timestamp);
      if (!valid(ut) || ut < new Date(+t - 30 * D) || ut > new Date(+t + 3 * D)) continue;
      if (modelOk(u.model, 'gemini_usage')) return { corroborated: true, by: { record: u.store === 'supabase' ? 'gemini_usage(supabase)' : 'gemini_usage(mongo)', id: u.id ?? String(u._id), model: u.model ?? null, at: ut, via: 'batch_job_id' }, contradictions, looked };
    }
  }

  looked.push('gemini_usage page_ids');
  const keys = new Set(pageKeys.filter(Boolean).map(String));
  let best = null;
  for (const u of recs.usage || []) {
    if (!typeOk(u.type) || !Array.isArray(u.page_ids) || !u.page_ids.some((p) => keys.has(String(p)))) continue;
    const ut = toDate(u.timestamp);
    if (!valid(ut) || ut < new Date(+t - 3 * D) || ut > new Date(+t + D)) continue;
    if (!modelOk(u.model, 'gemini_usage')) continue;
    if (!best || Math.abs(ut - t) < Math.abs(toDate(best.timestamp) - t)) best = u;
  }
  if (best) return { corroborated: true, by: { record: 'gemini_usage(mongo)', id: best.id ?? String(best._id), model: best.model ?? null, at: toDate(best.timestamp), via: 'page_ids', endpoint: best.endpoint ?? null }, contradictions, looked };
  return { corroborated: false, by: null, contradictions, looked };
}

/** The row the full build would store (shape only; this script never writes it). */
export function gradeRow(page, g, c) {
  return {
    page_id: page.id || String(page._id), book_id: page.book_id ?? null, field: g.field, grade: g.grade,
    ...(c ? { corroborated: c.corroborated, corroborated_by: c.by } : {}),
    month: g.month, source: g.source, evidence: g.evidence, grader: GRADER_VERSION, graded_at: new Date(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
/**
 * The page record without the text: bodies replaced server-side by has-text flags (egress, #5189).
 * Pass `has_ocr` / `has_tr` to gradeField as `{ has }`. Shared with provenance-grade-summary.mjs.
 */
const _sub = (f) => ({ $let: { vars: { s: `$${f}` }, in: { $cond: [{ $eq: [{ $type: '$$s' }, 'object'] }, { $arrayToObject: { $filter: { input: { $objectToArray: '$$s' }, cond: { $not: { $in: ['$$this.k', ['data', 'text']] } } } } }, null] } } });
const _str = (p) => ({ $gt: [{ $strLenCP: { $cond: [{ $eq: [{ $type: p }, 'string'] }, p, ''] } }, 0] });
export const RECORD_PROJECT = { $project: { id: 1, book_id: 1, ocr: _sub('ocr'), translation: _sub('translation'), has_ocr: _str('$ocr.data'), has_tr: { $or: [_str('$translation.data'), _str('$translation.text')] } } };

/** The grades checked against the call log (inferred, and recorded_on_page from a Gemini source). */
export const needsCorroboration = (g) => g.grade === 'inferred' || (g.grade === 'recorded_on_page' && GEMINI.has(g.source));

async function main() {
  const arg = (k, d) => { const m = process.argv.find((a) => a.startsWith(`--${k}=`)); return m ? m.slice(k.length + 3) : d; };
  const SAMPLE = Number(arg('sample', 60000));
  const IDS_IN = arg('ids-in', null), IDS_OUT = arg('ids-out', null), JSON_OUT = arg('json', null);
  const EX_N = Number(arg('examples', 20));
  const SCAN_TEST = Number(arg('scan-test', 200000));
  const NO_SB = process.argv.includes('--no-supabase');
  if (process.argv.includes('--apply')) { console.error('--apply: no write path in this script (sourcelibrary-v3 #201: the full build is a separate change)'); return 2; }
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set'); return 2; }
  const { MongoClient, ObjectId, BSON } = await import('mongodb');
  const client = await MongoClient.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000, socketTimeoutMS: 600000 });
  const db = client.db('bookstore');
  const out = { measured_at: new Date().toISOString(), grader: GRADER_VERSION, sample_asked: SAMPLE };
  const T0 = Date.now();
  const lap = (k) => { out.timings ??= {}; out.timings[k] = Math.round((Date.now() - T0) / 1000); };
  try {
    const project = RECORD_PROJECT;
    const pages = db.collection('pages');

    let rows;
    if (IDS_IN) {
      const ids = readFileSync(IDS_IN, 'utf8').split('\n').map((x) => x.trim()).filter(Boolean);
      rows = [];
      for (let i = 0; i < ids.length; i += 5000) rows.push(...await pages.aggregate([{ $match: { _id: { $in: ids.slice(i, i + 5000).flatMap((x) => (/^[0-9a-f]{24}$/.test(x) ? [new ObjectId(x), x] : [x])) } } }, project], { maxTimeMS: 300000 }).toArray());
      out.sample_method = `--ids-in ${IDS_IN} (${ids.length} ids)`;
      if (rows.length < ids.length) throw new Error(`ids-in: ${rows.length} of ${ids.length} pages found`);
    } else {
      rows = await pages.aggregate([{ $sample: { size: SAMPLE } }, project], { allowDiskUse: true, maxTimeMS: 900000 }).toArray();
      out.sample_method = '$sample (WiredTiger random cursor, unseeded); the drawn _ids are kept with --ids-out';
      const seen = new Set();
      rows = rows.filter((r) => !seen.has(String(r._id)) && seen.add(String(r._id)));
      if (rows.length < SAMPLE) throw new Error(`sample short: ${rows.length} of ${SAMPLE} pages (a short sample is not a result)`);
    }
    if (IDS_OUT) writeFileSync(IDS_OUT, rows.map((r) => String(r._id)).join('\n') + '\n');
    out.sample = rows.length;
    lap('sample');
    console.log(`sample: ${rows.length} pages (${out.sample_method})`);

    // grade
    const graded = [];
    let noRow = 0; const noRowBy = { ocr: 0, translation: 0 };
    for (const p of rows) {
      let any = false;
      for (const [f, has] of [['ocr', p.has_ocr], ['translation', p.has_tr]]) {
        const g = gradeField(f, p[f], { has });
        if (!g) { noRowBy[f]++; continue; }
        any = true; graded.push({ p, g });
      }
      if (!any) noRow++;
    }
    out.no_row = { pages_with_no_row: noRow, ocr_no_text: noRowBy.ocr, translation_no_text: noRowBy.translation };

    // records for Gemini pages (inferred + recorded_on_page from a Gemini source)
    const needs = graded.filter(({ g }) => needsCorroboration(g));
    const jobIds = [...new Set(needs.map(({ p, g }) => p[g.field]?.batch_job_id).filter(Boolean))];
    const jobs = new Map();
    for (let i = 0; i < jobIds.length; i += 2000) {
      const chunk = jobIds.slice(i, i + 2000);
      const oids = chunk.filter((x) => /^[0-9a-f]{24}$/.test(x)).map((x) => new ObjectId(x));
      for (const j of await db.collection('batch_jobs').find({ $or: [{ id: { $in: chunk } }, { job_name: { $in: chunk } }, { gemini_job_name: { $in: chunk } }, ...(oids.length ? [{ _id: { $in: oids } }] : [])] }, { projection: { id: 1, job_name: 1, gemini_job_name: 1, type: 1, model: 1, created_at: 1, completed_at: 1, updated_at: 1 } }).maxTimeMS(300000).toArray())
        for (const k of [j.id, j.job_name, j.gemini_job_name, String(j._id)]) if (k) jobs.set(k, j);
    }
    lap('batch_jobs');
    const usageByJob = new Map();
    const addByJob = (u) => { if (u.batch_job_id) (usageByJob.get(u.batch_job_id) ?? usageByJob.set(u.batch_job_id, []).get(u.batch_job_id)).push(u); };
    // Mongo gemini_usage by job id: no index on batch_job_id, so read per book (index book_id+timestamp) below and key both ways.
    const byBook = new Map();
    for (const { p, g } of needs) {
      const { at } = writtenAt(p[g.field]); if (!at || !p.book_id) continue;
      const w = byBook.get(p.book_id) ?? byBook.set(p.book_id, { min: at, max: at }).get(p.book_id);
      if (at < w.min) w.min = at; if (at > w.max) w.max = at;
    }
    const usageOfBook = new Map();
    const books = [...byBook.entries()];
    const proj = { id: 1, type: 1, model: 1, mode: 1, timestamp: 1, batch_job_id: 1, endpoint: 1, page_ids: 1 };
    let next = 0, usageRows = 0;
    const worker = async () => {
      while (next < books.length) {
        const [b, w] = books[next++];
        const rs = await db.collection('gemini_usage').find({ book_id: b, timestamp: { $gte: new Date(+w.min - 30 * D), $lte: new Date(+w.max + 3 * D) }, type: { $in: ['ocr', 'spread-ocr', 'translation', 'translate'] } }, { projection: proj }).maxTimeMS(120000).toArray();
        usageRows += rs.length;
        usageOfBook.set(b, rs);
        for (const u of rs) addByJob(u);
      }
    };
    const tu = Date.now();
    await Promise.all(Array.from({ length: 8 }, worker));
    out.usage_read = { books: books.length, wall_secs: (Date.now() - tu) / 1000, concurrency: 8 };
    lap('gemini_usage_mongo');
    out.records = { batch_job_ids: jobIds.length, batch_jobs_found: jobIds.filter((k) => jobs.has(k)).length, books_read_for_usage: books.length, mongo_usage_rows: usageRows };

    // Supabase gemini_usage: rows carry batch_job_id but no page ids; paginate (supabase-js caps at 1,000 rows).
    let sb = null;
    if (!NO_SB) {
      const { createClient } = await import('@supabase/supabase-js');
      const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) throw new Error('Supabase URL / service key not set (pass --no-supabase to grade without it, and say so)');
      sb = createClient(url, key);
      let sbRows = 0;
      for (let i = 0; i < jobIds.length; i += 100) {
        const chunk = jobIds.slice(i, i + 100);
        for (let from = 0; ; from += 1000) {
          const { data, error } = await sb.from('gemini_usage').select('id,timestamp,type,mode,model,batch_job_id,endpoint').in('batch_job_id', chunk).order('id').range(from, from + 999);
          if (error) throw new Error(`supabase gemini_usage: ${error.message}`);
          for (const u of data) addByJob({ ...u, store: 'supabase' });
          sbRows += data.length;
          if (data.length < 1000) break;
        }
      }
      out.records.supabase_usage_rows = sbRows;
    } else out.records.supabase_usage_rows = 'skipped (--no-supabase)';
    lap('gemini_usage_supabase');

    for (const x of needs) {
      const { p, g } = x;
      x.c = corroborate(g.field, p[g.field], [p.id, String(p._id)], { jobs, usage: usageOfBook.get(p.book_id) || [], usageByJob });
    }

    // ── positive controls ────────────────────────────────────────────────────
    const controls = await positiveControls({ db, sb, jobs: null });
    out.controls = controls;
    lap('controls');
    out.usage_coverage = await usageCoverage(db, sb);
    lap('usage_coverage');

    // ── counts ───────────────────────────────────────────────────────────────
    const counts = {}; // field → month → grade → n ; plus corroborated
    const bump = (f, m, k) => { const a = ((counts[f] ??= {})[m] ??= {}); a[k] = (a[k] || 0) + 1; };
    const detail = {};
    const dbump = (k) => { detail[k] = (detail[k] || 0) + 1; };
    for (const x of graded) {
      const { g } = x;
      bump(g.field, g.month, g.grade);
      bump(g.field, g.month, 'n');
      if (x.c) { bump(g.field, g.month, `${g.grade}:corroborated`); if (x.c.corroborated) bump(g.field, g.month, `${g.grade}:corroborated_true`); }
      dbump(`${g.field}|${g.grade}|${g.grade === 'inferred' ? g.evidence.rule : g.grade === 'recorded_on_page' ? g.evidence.rule : g.grade === 'not_recorded' ? String(g.evidence.reason).replace(/ at \d{4}-.*$/, '').replace(/'[^']*'/, "'…'").slice(0, 90) : g.grade === 'recorded' ? (g.evidence.missing.length ? 'engine with gaps' : g.evidence.markers.length ? 'engine with not_recorded markers' : 'engine complete') : g.source}`);
      if (x.c?.by) dbump(`${g.field}|${g.grade}|corroborated by ${x.c.by.record}${x.c.by.via ? ` via ${x.c.by.via}` : ''}`);
      if (x.c?.contradictions?.length) for (const k of x.c.contradictions) dbump(`${g.field}|${g.grade}|contradiction: ${k.replace(/model \S+ ≠ page model \S+/, 'model ≠ page model')}`);
      if (g.grade === 'recorded' && g.evidence.edited_by) dbump(`${g.field}|recorded|also carries edited_by`);
    }
    out.counts = counts;
    out.detail = detail;

    // census-comparable columns on the same sample (prov-by-month.mjs definitions)
    const census = {};
    for (const x of graded) {
      const s = x.p[x.g.field];
      const m = x.g.month;
      const r = ((census[x.g.field] ??= {})[m] ??= { n: 0, engine_schema: 0, inferred: 0, notRecorded: 0, batchJob: 0 });
      r.n++;
      const inf = inferHistoricalGeneration(x.g.field, { source: s.source, updated_at: s.updated_at, code_version: s.code_version, engine: s.engine?.schema ? { schema: s.engine.schema } : undefined });
      if (s.engine?.schema) r.engine_schema++; else if (inf.status === 'inferred') r.inferred++; else r.notRecorded++;
      if (s.batch_job_id) r.batchJob++;
    }
    out.census_columns = census;

    // examples: EX_N page ids per grade, deterministic shuffle by hash of page id
    const h = (s) => createHash('sha256').update(s).digest('hex');
    const examples = {};
    for (const grade of GRADES) {
      const xs = graded.filter((x) => x.g.grade === grade).sort((a, b) => (h(`${a.p._id}|${a.g.field}`) < h(`${b.p._id}|${b.g.field}`) ? -1 : 1));
      examples[grade] = xs.slice(0, EX_N).map((x) => ({ page_id: x.p.id || String(x.p._id), _id: String(x.p._id), field: x.g.field, month: x.g.month, source: x.g.source, why: x.g.evidence.rule || x.g.evidence.reason || x.g.evidence.edition || x.g.evidence.engine || x.g.evidence.edited_by || null, ...(x.c ? { corroborated: x.c.corroborated } : {}) }));
    }
    out.examples = examples;

    // sizing: average BSON size of the rows this sample would store, scaled to the collection
    const sampleRows = graded.map((x) => gradeRow(x.p, x.g, x.c));
    out.example_rows = Object.fromEntries(GRADES.map((g) => [g, sampleRows.find((r) => r.grade === g) ?? null]));
    const bytes = sampleRows.reduce((n, r) => n + BSON.calculateObjectSize({ _id: new ObjectId(), ...r }), 0);
    const est = await pages.estimatedDocumentCount();
    const scale = est / rows.length;
    // A slimmer row: what the page itself does not already say (rule or reason, the corroborating record's id).
    const slim = (r) => ({ _id: new ObjectId(), page_id: r.page_id, book_id: r.book_id, field: r.field, grade: r.grade, month: r.month, why: r.evidence.rule || r.evidence.reason?.slice(0, 40) || r.evidence.edition || r.evidence.engine || null, ...(r.corroborated_by ? { by: `${r.corroborated_by.record}:${r.corroborated_by.id}` } : r.corroborated === false ? { by: null } : {}) });
    const slimBytes = sampleRows.reduce((n, r) => n + BSON.calculateObjectSize(slim(r)), 0);
    out.sizing = { pages_estimated: est, avg_row_bytes_slim: Math.round(slimBytes / sampleRows.length), data_bytes_full_estimate_slim: Math.round(slimBytes * (est / rows.length)), rows_in_sample: sampleRows.length, rows_full_estimate: Math.round(sampleRows.length * scale), avg_row_bytes: Math.round(bytes / sampleRows.length), data_bytes_full_estimate: Math.round(bytes * scale) };

    // Full-build run time. A full build cannot hold the call log in memory, so it goes book by book: the
    // book's pages (index book_id), the book's gemini_usage rows (index book_id+timestamp), batch_jobs read
    // once. Timed here on real books from this sample.
    const nBooks = await db.collection('books').estimatedDocumentCount();
    out.sizing.books_estimated = nBooks;
    out.sizing.usage_secs_per_book = +(out.usage_read.wall_secs * out.usage_read.concurrency / Math.max(1, out.usage_read.books)).toFixed(3);
    out.sizing.index_bytes_assumed = Math.round(out.sizing.rows_full_estimate * 2 * 40); // assumption: two indexes ({page_id, field} unique, {book_id}) at ~40 B/entry
    if (SCAN_TEST > 0) {
      const testBooks = [...new Set(rows.map((r) => r.book_id).filter(Boolean))].sort((x, y) => (h(x) < h(y) ? -1 : 1));
      const t = Date.now(); let n = 0, nb = 0;
      for (const b of testBooks) {
        for await (const _ of pages.aggregate([{ $match: { book_id: b } }, project], { maxTimeMS: 300000 }).batchSize(2000)) n++;
        nb++;
        if (n >= SCAN_TEST) break;
      }
      const secs = (Date.now() - t) / 1000;
      out.sizing.scan_test = { books: nb, pages: n, secs, pages_per_sec: Math.round(n / secs), method: 'all pages of whole books, record projected without text, one book at a time' };
      const pagesH = est / (n / secs) / 3600;
      const usageH = (nBooks * out.sizing.usage_secs_per_book) / 8 / 3600;
      out.sizing.full_build_hours = { pages_read_one_stream: +pagesH.toFixed(1), usage_reads_8_parallel: +usageH.toFixed(1), note: 'batch_jobs is read once (142K rows); page reads can run 4–8 books in parallel, dividing the first figure' };
    }
    lap('done');

    if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(out, null, 1));
    printReport(out);
    if (!controls.every((c) => c.pass)) { console.error('a positive control FAILED: corroboration and not_recorded counts cannot be trusted'); await client.close(); return 2; }
  } catch (e) {
    console.error(`could not measure: ${e.message}`);
    if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ ...out, error: e.message }, null, 1));
    await client.close();
    return 2;
  }
  await client.close();
  return 0;
}

/**
 * Before trusting "not_recorded" or "corroborated: false": show the probes find what is known to exist.
 *  1. a page with a gemini-engine/1 block (newest translation write) grades `recorded`;
 *  2. a Mongo gemini_usage OCR row naming a page is found by the same per-book read + corroborate();
 *  3. a batch_jobs OCR row is found by the page-side lookup and corroborates a page of that job;
 *  4. a Supabase gemini_usage row with a batch_job_id is found by the paginated .in() read.
 */
async function positiveControls({ db, sb }) {
  const res = [];
  const pages = db.collection('pages');
  // 1
  const rec = await pages.find({ 'translation.updated_at': { $gte: new Date(Date.now() - 2 * D) }, 'translation.engine.schema': 'gemini-engine/1' }, { projection: { id: 1, translation: 1 } }).sort({ 'translation.updated_at': -1 }).limit(1).maxTimeMS(120000).toArray();
  const g1 = rec[0] && gradeField('translation', rec[0].translation);
  res.push({ control: 'known recorded page grades recorded', page: rec[0]?.id ?? null, got: g1?.grade ?? null, pass: g1?.grade === 'recorded' });
  // 2
  const u = await db.collection('gemini_usage').find({ type: 'ocr', timestamp: { $gte: new Date('2026-06-15'), $lt: new Date('2026-06-16') }, 'page_ids.0': { $exists: true }, book_id: { $type: 'string' } }, { projection: { page_ids: 1, book_id: 1, model: 1, timestamp: 1, type: 1 } }).limit(1).maxTimeMS(120000).toArray();
  if (u[0]) {
    const pid = u[0].page_ids[0];
    const pg = await pages.findOne({ $or: [{ id: pid }, ...(/^[0-9a-f]{24}$/.test(pid) ? [{ _id: new (await import('mongodb')).ObjectId(pid) }] : [])] }, { projection: { id: 1, book_id: 1, 'ocr.model': 1, 'ocr.updated_at': 1, 'ocr.source': 1 } });
    const fake = { ...(pg?.ocr || {}), model: u[0].model, updated_at: u[0].timestamp }; // the page's clock may have moved on since; pin it to the call
    const rows = await db.collection('gemini_usage').find({ book_id: u[0].book_id, timestamp: { $gte: new Date(+u[0].timestamp - 30 * D), $lte: new Date(+u[0].timestamp + 3 * D) }, type: { $in: ['ocr', 'spread-ocr', 'translation', 'translate'] } }, { projection: { page_ids: 1, type: 1, model: 1, timestamp: 1, batch_job_id: 1 } }).maxTimeMS(120000).toArray();
    const c = corroborate('ocr', fake, [pg?.id, pg ? String(pg._id) : pid], { jobs: new Map(), usage: rows, usageByJob: new Map() });
    res.push({ control: 'known gemini_usage row (page_ids) is found', usage_id: String(u[0]._id), page: pid, got: c.by?.record ?? null, pass: c.corroborated && String(c.by.id) === String(u[0]._id) });
  } else res.push({ control: 'known gemini_usage row (page_ids) is found', got: 'no control row on 2026-06-15', pass: false });
  // 3
  const j = await db.collection('batch_jobs').find({ type: 'ocr', created_at: { $gte: new Date('2026-04-12'), $lt: new Date('2026-04-13') }, model: { $type: 'string' } }, { projection: { id: 1, model: 1, created_at: 1, completed_at: 1, updated_at: 1, type: 1, job_name: 1, gemini_job_name: 1 } }).limit(1).maxTimeMS(120000).toArray();
  if (j[0]) {
    // ocr.batch_job_id is unindexed, so the page side is synthetic: the job's id, its model, written at its completion.
    const s = { batch_job_id: j[0].id, model: j[0].model, updated_at: j[0].completed_at || j[0].created_at };
    const found = await db.collection('batch_jobs').find({ $or: [{ id: { $in: [j[0].id] } }, { job_name: { $in: [j[0].id] } }, { gemini_job_name: { $in: [j[0].id] } }] }, { projection: { id: 1, job_name: 1, gemini_job_name: 1, type: 1, model: 1, created_at: 1, completed_at: 1, updated_at: 1 } }).maxTimeMS(120000).toArray();
    const jobs = new Map(); for (const x of found) for (const k of [x.id, x.job_name, x.gemini_job_name]) if (k) jobs.set(k, x);
    const c = corroborate('ocr', s, [], { jobs, usage: [], usageByJob: new Map() });
    res.push({ control: 'known batch_jobs row is found and corroborates a page of that job', job: j[0].id, page: '(synthetic: job id + job model + completed_at)', got: c.by?.record ?? null, pass: c.corroborated && c.by.record === 'batch_jobs' });
  } else res.push({ control: 'known batch_jobs row is found', got: 'no control job on 2026-04-12', pass: false });
  // 4
  if (sb) {
    const { data, error } = await sb.from('gemini_usage').select('id,batch_job_id,type,model,timestamp').not('batch_job_id', 'is', null).in('type', ['ocr', 'translation']).order('timestamp', { ascending: true }).limit(1);
    if (error || !data?.[0]) res.push({ control: 'known Supabase gemini_usage row is found by batch_job_id', got: error?.message ?? 'no Supabase row with a batch_job_id', pass: false });
    else {
      const r = data[0];
      const { data: d2, error: e2 } = await sb.from('gemini_usage').select('id,timestamp,type,model,batch_job_id').in('batch_job_id', [r.batch_job_id]).order('id').range(0, 999);
      const byJob = new Map([[r.batch_job_id, (d2 || []).map((x) => ({ ...x, store: 'supabase' }))]]);
      const c = corroborate(r.type === 'ocr' ? 'ocr' : 'translation', { batch_job_id: r.batch_job_id, model: r.model, updated_at: r.timestamp }, [], { jobs: new Map(), usage: [], usageByJob: byJob });
      res.push({ control: 'known Supabase gemini_usage row is found by batch_job_id', usage_id: r.id, got: c.by?.record ?? e2?.message ?? null, pass: !e2 && c.corroborated && c.by.record === 'gemini_usage(supabase)' });
    }
  } else res.push({ control: 'Supabase gemini_usage', got: 'skipped (--no-supabase)', pass: true });
  return res;
}

/**
 * How much call log is there to corroborate against, month by month? Mongo gemini_usage rows of
 * the two types (index type+timestamp), and the days with none; Supabase rows (which name jobs, not pages).
 * A low corroboration rate in a month with no log is absence of the instrument, not evidence against the rule.
 */
async function usageCoverage(db, sb) {
  const g = db.collection('gemini_usage');
  const cov = {};
  for (let d = new Date('2026-01-01T00:00:00Z'); d < new Date('2026-10-01T00:00:00Z'); d = new Date(+d + D)) {
    const m = d.toISOString().slice(0, 7);
    for (const [f, types] of [['ocr', ['ocr', 'spread-ocr']], ['translation', ['translation', 'translate']]]) {
      const n = await g.countDocuments({ type: { $in: types }, timestamp: { $gte: d, $lt: new Date(+d + D) } }, { maxTimeMS: 120000 });
      const c = ((cov[f] ??= {})[m] ??= { mongo_rows: 0, days: 0, days_with_rows: 0 });
      c.mongo_rows += n; c.days++; if (n > 0) c.days_with_rows++;
    }
  }
  if (sb) {
    for (const f of ['ocr', 'translation']) for (const m of Object.keys(cov[f])) {
      const from = `${m}-01T00:00:00Z`, to = new Date(new Date(from).setUTCMonth(new Date(from).getUTCMonth() + 1)).toISOString();
      const { count, error } = await sb.from('gemini_usage').select('id', { count: 'exact', head: true }).in('type', f === 'ocr' ? ['ocr', 'spread-ocr'] : ['translation', 'translate']).gte('timestamp', from).lt('timestamp', to);
      if (error) throw new Error(`supabase coverage: ${error.message}`);
      cov[f][m].supabase_rows = count;
    }
  }
  return cov;
}

function printReport(out) {
  const pct = (n, d) => (d ? `${((100 * n) / d).toFixed(1)}%` : '—');
  console.log(`\nprovenance grades — ${out.measured_at}, ${out.sample} pages\n`);
  console.log('positive controls:'); for (const c of out.controls) console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.control}  (${c.got})`);
  for (const f of ['ocr', 'translation']) {
    const ms = Object.keys(out.counts[f] || {}).sort();
    console.log(`\n${f}: month      n   recorded human rec_on_page imported inferred (corr) not_rec | rec_on_page corr`);
    for (const m of ms) {
      const r = out.counts[f][m];
      const g = (k) => r[k] || 0;
      console.log(`  ${m.padEnd(8)} ${String(r.n).padStart(6)} ${String(g('recorded')).padStart(9)} ${String(g('human')).padStart(5)} ${String(g('recorded_on_page')).padStart(11)} ${String(g('imported')).padStart(8)} ${String(g('inferred')).padStart(8)} (${g('inferred:corroborated_true')}) ${String(g('not_recorded')).padStart(7)} | ${g('recorded_on_page:corroborated_true')}/${g('recorded_on_page:corroborated')}`);
    }
  }
  console.log('\ncall-log coverage (rows of this type; days of the month with any):');
  for (const f of ['ocr', 'translation']) for (const [m, c] of Object.entries(out.usage_coverage?.[f] || {})) console.log(`  ${f.padEnd(11)} ${m}  mongo ${String(c.mongo_rows).padStart(8)} (${c.days_with_rows}/${c.days} days)  supabase ${c.supabase_rows ?? '—'}`);
  console.log('\ndetail:'); for (const [k, v] of Object.entries(out.detail).sort()) console.log(`  ${String(v).padStart(6)}  ${k}`);
  console.log(`\nno row: ${out.no_row.pages_with_no_row} pages (${pct(out.no_row.pages_with_no_row, out.sample)}) have no text in either field; ocr without text ${out.no_row.ocr_no_text}, translation without text ${out.no_row.translation_no_text}`);
  console.log(`records: ${JSON.stringify(out.records)}`);
  console.log(`sizing: ${JSON.stringify(out.sizing)}`);
  console.log(`timings (s since start): ${JSON.stringify(out.timings)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main());
