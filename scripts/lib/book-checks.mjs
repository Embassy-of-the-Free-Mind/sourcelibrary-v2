/**
 * PRIOR ART: scripts/lib/sweep-log.mjs `recordSweepAction()` — the row-not-column pattern this follows, but a sweep
 * row records what a JOB did, with free-form detail; a check row is a verdict, and a verdict without its method,
 * reader and the text it read is the thing #6174 exists to stop. books.quality_assessment is the curation/importance
 * score (gemini-lite), not accuracy, and books.hidden_reason records only failures. Neither can hold a pass.
 *
 * book_checks — one row per book per QA read, append-only (#6174). The ONLY writer is recordBookCheck(); it refuses a
 * row that does not say:
 *   - which instrument: method_id + method_version, which must match the `version:` line of
 *     scripts/eval/methods/<method_id>.md (the registry; a check of an unregistered method is not recorded);
 *   - which pages were read: pages_read, page numbers;
 *   - who read them, and how: reader { kind: model | human | detector, model | role, image_opened: true | false |
 *     'unrecorded' } — a model's verdict must never read as a person's, nor a text-only read as an image read;
 *   - the verdict: show | caveat | fix;
 *   - where the evidence is: evidence_path (repo-relative, `ops:<path>` for the private ops repo, or `box:<host>:<path>`
 *     for a cron lane that cannot commit: the file has a lifetime, so such a row carries the record itself in page_notes);
 *   - the text it read: text_provenance, one entry per page read, with the OCR and translation model ids at read
 *     time. Text no model made (a typed e-text such as Esukhia's Derge) is `source:<label>`. A model id may be null
 *     only with an unknown_reason. A later re-OCR makes the check stale BY CONSTRUCTION
 *     (compare *_updated_at with the page's), so a verdict is never silently carried over onto new text.
 *   - which run: run_id, the run's own id (a results dir, a hide reason). Required, because {book_id, method_id, run_id}
 *     is the write-once key: with an optional run_id every later run-less check would collide with the first.
 *   - who could see it: exposure, one { page_number, exposure } per page read, exposure = served | withheld |
 *     no_english | hidden at check time (scripts/lib/review-vocabulary.mjs; pageExposure() reads it live). A rate
 *     quoted from rows that mix hidden books with served ones is the #6203 "invented" problem; 'unrecorded' is for a
 *     backfill of a run that kept no record. Rows written before 2026-10-12 have no exposure field.
 * Optional: frame, classes, note, verdict_source, api_usd, subscription_usd_eq, reader_warning (#8069: false = shown on
 * /book/<id>/checks and kept for measurement, but derives no warning and no "checked" line for readers; absent = the
 * row counts, as every row before it did), page_notes (#7896: the reader's own
 * words for every page read — see pageNoteProblems), and page_findings (#6199): the serious
 * findings per page — [{ page_number, wrong_page?, errors: [{ stage: ocr | translation | other, class?, problem? }] }],
 * one entry per page WITH a serious finding, so `[]` says every page read was free of them and an absent field says
 * the run kept no per-page record. The reader's page-level warning is built from it (src/lib/book-warnings.ts).
 * An error may carry `kind` (review-vocabulary KINDS: confabulation, recitation, wrong_leaf, carry_over …); without
 * one, its class's default kind applies (kindOfClass).
 *
 * Not a field on `books` (.claude/docs/invariants/field-sprawl.md). There is no delete here and a verdict is never
 * rewritten: a correction is a new row. {book_id, method_id, run_id} is unique, so re-running a backfill or a writer
 * cannot double a run. The one addition to an existing row is attachPageFindings(), which fills page_findings from the
 * row's own evidence file when the row has none, and never replaces one.
 *
 *   import { recordBookCheck, pageProvenance, pageExposure, ensureBookCheckIndexes } from '../lib/book-checks.mjs';
 *   const text_provenance = await pageProvenance(db, bookId, [12, 13, 14]);   // live read, at check time
 *   const exposure = await pageExposure(db, bookId, [12, 13, 14]);            // served | withheld | no_english | hidden
 *   await recordBookCheck(db, { book_id, checked_at, method_id: 'shelf-overview', method_version: '1', ... });
 *
 * A lane or job that read pages against their images and holds verdicts per page: recordPageVerdicts() (#8069).
 */
import { readFileSync, existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exposureProblems, kindProblems, pageExposure as livePageExposure } from './review-vocabulary.mjs';
import { contentHash } from './write-provenance.mjs';

export const COLLECTION = 'book_checks';
export const VERDICTS = ['show', 'caveat', 'fix'];
export const READER_KINDS = ['model', 'human', 'detector'];
export const FINDING_STAGES = ['ocr', 'translation', 'other'];
export const METHODS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'eval', 'methods');

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The registry entry's header: `id:` and `version:` lines of the front matter of scripts/eval/methods/<id>.md. */
export function readMethod(methodId, dir = METHODS_DIR) {
  if (typeof methodId !== 'string' || !ID.test(methodId)) throw new TypeError(`method_id must be kebab-case, got ${JSON.stringify(methodId)}`);
  const file = join(dir, `${methodId}.md`);
  if (!existsSync(file)) throw new Error(`method ${methodId} is not in the registry (${file} missing)`);
  const text = readFileSync(file, 'utf8');
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) throw new Error(`${file}: no front matter`);
  const header = Object.fromEntries(m[1].split('\n').map((l) => l.match(/^([a-z_]+):\s*(.*)$/)).filter(Boolean).map(([, k, v]) => [k, v.replace(/^"(.*)"$/, '$1')]));
  if (header.id !== methodId) throw new Error(`${file}: id ${header.id} ≠ file name`);
  if (!header.version) throw new Error(`${file}: no version line`);
  return header;
}

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const nonEmpty = (x) => typeof x === 'string' && x.trim().length > 0;

/**
 * The row recordBookCheck() would write, or a thrown error naming every missing piece. Pure apart from reading the
 * registry file, so tests and dry runs use it without Mongo.
 */
export function buildBookCheck(input = {}, { methodsDir = METHODS_DIR } = {}) {
  const p = [];
  const {
    book_id, checked_at, method_id, method_version, run_id, frame, pages_read, reader, verdict, verdict_source,
    classes, note, evidence_path, text_provenance, api_usd, subscription_usd_eq, page_findings, page_notes, exposure, reader_warning,
  } = input;
  if (!nonEmpty(book_id)) p.push('book_id');
  const at = checked_at instanceof Date ? checked_at : (nonEmpty(checked_at) ? new Date(checked_at) : null);
  if (!at || Number.isNaN(at.getTime())) p.push('checked_at (a date)');
  if (!nonEmpty(method_id)) p.push('method_id');
  if (!nonEmpty(run_id)) p.push('run_id');
  if (method_version === undefined || method_version === null || String(method_version).trim() === '') p.push('method_version');
  if (nonEmpty(method_id) && method_version != null) {
    try {
      const m = readMethod(method_id, methodsDir);
      if (String(m.version) !== String(method_version)) p.push(`method_version ${method_version} ≠ registry version ${m.version} of ${method_id}`);
    } catch (e) { p.push(e.message); }
  }
  if (!Array.isArray(pages_read) || pages_read.length === 0 || !pages_read.every(isNum)) p.push('pages_read (non-empty list of page numbers)');
  if (!reader || typeof reader !== 'object') p.push('reader');
  else {
    if (!READER_KINDS.includes(reader.kind)) p.push(`reader.kind (${READER_KINDS.join(' | ')})`);
    if (!nonEmpty(reader.model) && !nonEmpty(reader.role)) p.push('reader.model or reader.role');
    if (![true, false, 'unrecorded'].includes(reader.image_opened)) p.push("reader.image_opened (true | false | 'unrecorded')");
  }
  if (!VERDICTS.includes(verdict)) p.push(`verdict (${VERDICTS.join(' | ')})`);
  if (!nonEmpty(evidence_path)) p.push('evidence_path');
  if (!Array.isArray(text_provenance) || text_provenance.length === 0) p.push('text_provenance (one entry per page read)');
  else {
    const seen = new Set(text_provenance.map((t) => t?.page_number));
    if (Array.isArray(pages_read)) for (const n of pages_read) if (!seen.has(n)) p.push(`text_provenance for page ${n}`);
    for (const t of text_provenance) {
      if (!t || !isNum(t.page_number)) { p.push('text_provenance[].page_number'); continue; }
      for (const k of ['ocr_model', 'translation_model']) {
        if (!(k in t)) p.push(`text_provenance p.${t.page_number}: ${k}`);
        else if (t[k] === null && !nonEmpty(t.unknown_reason)) p.push(`text_provenance p.${t.page_number}: ${k} is null without unknown_reason`);
        else if (t[k] !== null && !nonEmpty(t[k])) p.push(`text_provenance p.${t.page_number}: ${k} must be a model id or null`);
      }
    }
  }
  p.push(...exposureProblems(exposure, pages_read).map((x) => (x.startsWith('exposure') ? x : `exposure: ${x}`)));
  if (verdict_source !== undefined && !nonEmpty(verdict_source)) p.push('verdict_source, when given, is a non-empty string');
  for (const [k, v] of [['api_usd', api_usd], ['subscription_usd_eq', subscription_usd_eq]]) if (v !== undefined && v !== null && !(isNum(v) && v >= 0)) p.push(`${k} must be a number ≥ 0`);
  if (classes !== undefined && !(Array.isArray(classes) && classes.every(nonEmpty))) p.push('classes must be a list of strings');
  if (page_findings !== undefined) p.push(...pageFindingProblems(page_findings, pages_read));
  if (page_notes !== undefined) p.push(...pageNoteProblems(page_notes, pages_read));
  if (reader_warning !== undefined && reader_warning !== false) p.push('reader_warning is false or absent');
  if (p.length) throw new TypeError(`book_checks row refused (${book_id ?? '?'}, ${method_id ?? '?'}): missing or bad ${p.join('; ')}`);

  return {
    book_id, checked_at: at, method_id, method_version: String(method_version),
    run_id,
    ...(frame !== undefined ? { frame } : {}),
    pages_read: [...pages_read],
    reader: { kind: reader.kind, ...(reader.model ? { model: reader.model } : {}), ...(reader.role ? { role: reader.role } : {}), image_opened: reader.image_opened },
    verdict,
    ...(verdict_source ? { verdict_source } : {}),
    ...(classes ? { classes: [...new Set(classes)] } : {}),
    ...(nonEmpty(note) ? { note } : {}),
    ...(page_findings !== undefined ? { page_findings } : {}),
    ...(page_notes !== undefined ? { page_notes } : {}),
    ...(reader_warning === false ? { reader_warning } : {}),
    exposure: exposure.map((e) => ({ page_number: e.page_number, exposure: e.exposure })),
    evidence_path,
    text_provenance,
    ...(isNum(api_usd) ? { api_usd } : {}),
    ...(isNum(subscription_usd_eq) ? { subscription_usd_eq } : {}),
    recorded_at: new Date(),
    recorded_by: basename(process.argv[1] || 'unknown'),
  };
}

/** What is wrong with a page_findings value, as a list of strings (empty = valid). */
export function pageFindingProblems(findings, pagesRead) {
  if (!Array.isArray(findings)) return ['page_findings must be a list'];
  const p = [];
  const read = new Set(Array.isArray(pagesRead) ? pagesRead : []);
  const seen = new Set();
  for (const f of findings) {
    if (!f || !isNum(f.page_number)) { p.push('page_findings[].page_number'); continue; }
    const at = `page_findings p.${f.page_number}`;
    if (!read.has(f.page_number)) p.push(`${at}: not in pages_read`);
    if (seen.has(f.page_number)) p.push(`${at}: listed twice`);
    seen.add(f.page_number);
    if (f.wrong_page !== undefined && f.wrong_page !== true) p.push(`${at}: wrong_page is true or absent`);
    if (!Array.isArray(f.errors)) { p.push(`${at}: errors must be a list`); continue; }
    if (!f.errors.length && f.wrong_page !== true) p.push(`${at}: an entry needs a serious error or wrong_page (a clean page has no entry)`);
    for (const e of f.errors) {
      if (!e || !FINDING_STAGES.includes(e.stage)) p.push(`${at}: errors[].stage (${FINDING_STAGES.join(' | ')})`);
      else for (const k of ['class', 'problem']) if (e[k] !== undefined && !nonEmpty(e[k])) p.push(`${at}: errors[].${k}, when given, is a non-empty string`);
      if (e) p.push(...kindProblems(e.kind, `${at}: errors[].kind`));
    }
  }
  return p;
}

export const NOTE_SEVERITIES = ['cosmetic', 'misleads', 'wrong_text'];
export const PAGE_OUTCOMES = ['clean', 'minor', 'serious'];

/**
 * What is wrong with a page_notes value (#7896), as a list of strings (empty = valid). page_notes is the qualitative
 * record: one entry per page read, clean pages included — the reader's own note on the page and every defect it named,
 * minor ones too — { page_number, note?, fidelity?, accepted?, outcome?, verdict?, defects: [{ severity, what, class?, quote? }] }.
 * outcome (clean | minor | serious) and verdict (the method's own word for the page) are what a page-level reader of this
 * collection counts (#6557); recordPageVerdicts() always writes them.
 */
export function pageNoteProblems(notes, pagesRead) {
  if (!Array.isArray(notes)) return ['page_notes must be a list'];
  const p = [];
  const read = new Set(Array.isArray(pagesRead) ? pagesRead : []);
  const seen = new Set();
  for (const n of notes) {
    if (!n || !isNum(n.page_number)) { p.push('page_notes[].page_number'); continue; }
    const at = `page_notes p.${n.page_number}`;
    if (!read.has(n.page_number)) p.push(`${at}: not in pages_read`);
    if (seen.has(n.page_number)) p.push(`${at}: listed twice`);
    seen.add(n.page_number);
    if (n.note !== undefined && !nonEmpty(n.note)) p.push(`${at}: note, when given, is a non-empty string`);
    if (n.fidelity !== undefined && !(isNum(n.fidelity) && n.fidelity >= 1 && n.fidelity <= 5)) p.push(`${at}: fidelity is 1–5`);
    if (n.accepted !== undefined && typeof n.accepted !== 'boolean') p.push(`${at}: accepted is a boolean`);
    if (n.outcome !== undefined && !PAGE_OUTCOMES.includes(n.outcome)) p.push(`${at}: outcome (${PAGE_OUTCOMES.join(' | ')})`);
    if (n.verdict !== undefined && !nonEmpty(n.verdict)) p.push(`${at}: verdict, when given, is a non-empty string`);
    if (!Array.isArray(n.defects)) { p.push(`${at}: defects must be a list ([] for none)`); continue; }
    for (const d of n.defects) {
      if (!d || !NOTE_SEVERITIES.includes(d.severity)) p.push(`${at}: defects[].severity (${NOTE_SEVERITIES.join(' | ')})`);
      if (!d || !nonEmpty(d.what)) p.push(`${at}: defects[].what`);
      else for (const k of ['class', 'quote']) if (d[k] !== undefined && !nonEmpty(d[k])) p.push(`${at}: defects[].${k}, when given, is a non-empty string`);
    }
  }
  return p;
}

/**
 * Fill page_findings on a row that has none, from the same evidence the row already cites. Write-once: the filter
 * requires the field to be absent, so a second call changes nothing and a row's findings are never replaced.
 * Returns { attached: boolean }.
 */
export async function attachPageFindings(db, { book_id, method_id, run_id, pages_read, page_findings }) {
  if (!db || typeof db.collection !== 'function') throw new TypeError('attachPageFindings: first argument must be a connected Mongo db handle');
  const bad = [!nonEmpty(book_id) && 'book_id', !nonEmpty(method_id) && 'method_id', !nonEmpty(run_id) && 'run_id', ...pageFindingProblems(page_findings, pages_read)].filter(Boolean);
  if (bad.length) throw new TypeError(`page_findings refused (${book_id ?? '?'}, ${method_id ?? '?'}): ${bad.join('; ')}`);
  const r = await db.collection(COLLECTION).updateOne(
    { book_id, method_id, run_id, pages_read, page_findings: { $exists: false } },
    { $set: { page_findings, page_findings_attached_at: new Date(), page_findings_attached_by: basename(process.argv[1] || 'unknown') } },
  );
  return { attached: r.modifiedCount === 1 };
}

/**
 * Append one check. Returns { inserted: true, row } or, when this run already holds a row for the book
 * (same book_id, method_id, run_id), { inserted: false, row } — a rerun never doubles a run, never overwrites it.
 */
export async function recordBookCheck(db, input, opts) {
  if (!db || typeof db.collection !== 'function') throw new TypeError('recordBookCheck: first argument must be a connected Mongo db handle');
  const row = buildBookCheck(input, opts);
  try {
    await db.collection(COLLECTION).insertOne(row);
    return { inserted: true, row };
  } catch (e) {
    if (e?.code === 11000) return { inserted: false, row };
    throw e;
  }
}

/** Idempotent. The read path is {book_id, checked_at}; the unique key makes a run's rows write-once. */
export async function ensureBookCheckIndexes(db) {
  const c = db.collection(COLLECTION);
  await c.createIndex({ book_id: 1, checked_at: -1 }, { name: 'book_checked_at' });
  await c.createIndex({ book_id: 1, method_id: 1, run_id: 1 }, { name: 'book_method_run_unique', unique: true });
}

/**
 * The text provenance of pages as they are NOW — call it at check time, from the same process that reads the pages,
 * so what is recorded is what the reader saw. One indexed query ({book_id, page_number}); no page text leaves Atlas.
 * A page record that is missing yields null model ids with unknown_reason, so the row still says so explicitly.
 */
export { pageExposure } from './review-vocabulary.mjs';

export async function pageProvenance(db, bookId, pageNumbers) {
  const rows = await db.collection('pages').find({ book_id: bookId, page_number: { $in: pageNumbers } }, {
    projection: { _id: 0, id: 1, page_number: 1, 'ocr.model': 1, 'ocr.source': 1, 'ocr.updated_at': 1, 'ocr.prompt_version': 1,
      'translation.model': 1, 'translation.source': 1, 'translation.updated_at': 1, 'translation.content_hash': 1 },
  }).toArray();
  const by = new Map(rows.map((r) => [r.page_number, r]));
  return pageNumbers.map((n) => {
    const r = by.get(n);
    if (!r) return { page_number: n, ocr_model: null, translation_model: null, unknown_reason: 'no page record at check time', source: 'live' };
    return provenanceFromPage(r, 'live');
  });
}

/** One provenance entry from a `pages` record (projection as in pageProvenance). */
export function provenanceFromPage(r, source) {
  const e = {
    page_number: r.page_number, page_id: r.id ?? null,
    ocr_model: r.ocr?.model ?? (r.ocr?.source ? `source:${r.ocr.source}` : null), ocr_source: r.ocr?.source ?? null, ocr_prompt_version: r.ocr?.prompt_version ?? null,
    ocr_updated_at: r.ocr?.updated_at ?? null,
    translation_model: r.translation?.model ?? null, translation_source: r.translation?.source ?? null,
    translation_updated_at: r.translation?.updated_at ?? null, translation_content_hash: r.translation?.content_hash ?? null,
    source,
  };
  const missing = [!e.ocr_model && 'no ocr.model on the page', !e.translation_model && 'no translation.model on the page'].filter(Boolean);
  if (missing.length) e.unknown_reason = missing.join('; ');
  return e;
}

const WORST = (verdicts) => VERDICTS.filter((v) => verdicts.includes(v)).pop();
const PAGE_RECORD = { _id: 0, id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1, 'ocr.updated_at': 1, 'ocr.prompt_version': 1,
  'translation.data': 1, 'translation.model': 1, 'translation.source': 1, 'translation.updated_at': 1, 'translation.content_hash': 1 };

/**
 * One provenance entry for a page a verdict judged, with the hashes of the text it judged (contentHash, comparable with
 * translation.content_hash). `judged` = { ocr, translation }, the text the reader was given. Where that differs from the
 * page now, the page is changed_since_check, so the row is stale by construction and the current model ids are not
 * credited with it. Without `judged` (a backfill that kept only verdicts) the page's stamps decide, and when they cannot
 * vouch for the text the hashes are null: unknown, not a match.
 */
export function judgedProvenance(page, judged, checkedAt) {
  const base = provenanceFromPage(page, 'live');
  const at = new Date(checkedAt);
  const live = { ocr: page.ocr?.data ?? '', translation: page.translation?.data ?? '' };
  const changed = judged
    ? (judged.ocr ?? '') !== live.ocr || (judged.translation ?? '') !== live.translation
    : [page.ocr?.updated_at, page.translation?.updated_at].some((d) => d && new Date(d) > at);
  const text = judged ?? (changed ? null : live);
  const hashes = { ocr_hash: text ? contentHash(text.ocr ?? '') : null, translation_hash: text ? contentHash(text.translation ?? '') : null, hash_of: judged ? 'judged text' : changed ? 'unknown' : 'page text, unchanged since the check' };
  if (!changed) return { ...base, ...hashes, changed_since_check: false };
  return { page_number: page.page_number, page_id: page.id ?? null, ocr_model: null, translation_model: null, source: 'live', ...hashes, changed_since_check: true,
    unknown_reason: `text rewritten since the check (ocr ${new Date(page.ocr?.updated_at ?? 0).toISOString()}, translation ${new Date(page.translation?.updated_at ?? 0).toISOString()})` };
}

/**
 * The shared recorder for a lane or job that read pages against their images (#8069): page verdicts in, one book_checks
 * row per book per run out, clean pages kept. Every page gets a page_notes entry and a provenance entry with the hash of
 * the text judged; `frame.selection` says how the pages were chosen; a job that picked its own pages says `picked`.
 * A row can reach readers (src/lib/book-warnings.ts), so `reader_warning` is REQUIRED here: true means this method's
 * findings warn readers and its clean reads say "checked", false means they are kept but derive nothing. Choose it in
 * the method file. Write-once like every check.
 *
 *   input: { method_id, method_version, run_id, checked_at, selection: 'random' | 'picked', stages: ['ocr', 'translation'],
 *            reader, evidence_path, reader_warning, frame?, exposure?: 'live' | 'unrecorded', note?,
 *            verdicts: [{ page_id, outcome, page_verdict: show|caveat|fix, verdict?, note?, wrong_page?,
 *                         errors?: [{ stage, class?, kind?, problem? }], defects?: [...], judged?: { ocr, translation } }] }
 *   returns { rows, inserted, already, failed: [{ book_id|page_id, error }] }. It never throws for a bad page or a failed
 *   write: the caller gets the failure and must report it. With { apply: false } nothing is written.
 */
export async function recordPageVerdicts(db, input, { apply = true, methodsDir } = {}) {
  const { method_id, method_version, run_id, checked_at, selection, stages, reader, evidence_path, reader_warning, frame = {}, exposure = 'live', note, verdicts } = input;
  if (!['random', 'picked'].includes(selection)) throw new TypeError(`recordPageVerdicts: selection must be random or picked, got ${JSON.stringify(selection)}`);
  if (typeof reader_warning !== 'boolean') throw new TypeError('recordPageVerdicts: reader_warning must be chosen, true or false');
  if (!Array.isArray(stages) || !stages.length || !stages.every((x) => FINDING_STAGES.includes(x))) throw new TypeError(`recordPageVerdicts: stages (${FINDING_STAGES.join(' | ')})`);
  const out = { rows: [], inserted: 0, already: 0, failed: [] };
  const ids = [...new Set(verdicts.map((v) => v.page_id))];
  const pages = new Map((await db.collection('pages').find({ id: { $in: ids } }, { projection: PAGE_RECORD }).toArray()).map((p) => [p.id, p]));
  const books = new Map();
  for (const v of verdicts) {
    const page = pages.get(v.page_id);
    if (!page) { out.failed.push({ page_id: v.page_id, error: 'no page record' }); continue; }
    const hasFinding = v.wrong_page === true || (v.errors ?? []).length > 0;
    if (!PAGE_OUTCOMES.includes(v.outcome) || !VERDICTS.includes(v.page_verdict) || hasFinding !== (v.outcome === 'serious')) {
      out.failed.push({ page_id: v.page_id, error: `outcome ${v.outcome}, verdict ${v.page_verdict}, finding ${hasFinding}: a serious page and only a serious page has a finding` });
      continue;
    }
    if (!books.has(page.book_id)) books.set(page.book_id, new Map());
    books.get(page.book_id).set(page.page_number, { v, page });
  }
  for (const [book_id, byPage] of books) {
    try {
      const entries = [...byPage.values()].sort((a, b) => a.page.page_number - b.page.page_number);
      const pages_read = entries.map((e) => e.page.page_number);
      const row = {
        book_id, checked_at, method_id, method_version, run_id, pages_read, reader, evidence_path, note,
        frame: { ...frame, selection, stages },
        verdict: WORST(entries.map((e) => e.v.page_verdict)), verdict_source: 'rule',
        page_findings: entries.filter((e) => e.v.outcome === 'serious').map(({ v, page }) => ({ page_number: page.page_number, ...(v.wrong_page ? { wrong_page: true } : {}), errors: v.errors ?? [] })),
        page_notes: entries.map(({ v, page }) => ({ page_number: page.page_number, ...(v.note?.trim() ? { note: v.note.trim() } : {}), outcome: v.outcome, ...(v.verdict ? { verdict: v.verdict } : {}), defects: v.defects ?? [] })),
        text_provenance: entries.map(({ v, page }) => judgedProvenance(page, v.judged, checked_at)),
        exposure: exposure === 'live' ? await livePageExposure(db, book_id, pages_read) : pages_read.map((page_number) => ({ page_number, exposure: 'unrecorded' })),
        ...(reader_warning ? {} : { reader_warning: false }),
      };
      if (!apply) { out.rows.push(buildBookCheck(row, { methodsDir })); continue; }
      const r = await recordBookCheck(db, row, { methodsDir });
      out.rows.push(r.row);
      if (r.inserted) out.inserted++; else out.already++;
    } catch (e) { out.failed.push({ book_id, error: e.message }); }
  }
  return out;
}
