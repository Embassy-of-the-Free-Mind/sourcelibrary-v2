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
 *   - where the evidence is: evidence_path (repo-relative, or `ops:<path>` for the private ops repo);
 *   - the text it read: text_provenance, one entry per page read, with the OCR and translation model ids at read
 *     time. A model id may be null only with an unknown_reason. A later re-OCR makes the check stale BY CONSTRUCTION
 *     (compare *_updated_at with the page's), so a verdict is never silently carried over onto new text.
 * Optional: run_id, frame, classes, note, verdict_source, api_usd, subscription_usd_eq.
 *
 * Not a field on `books` (.claude/docs/invariants/field-sprawl.md). There is no update or delete here: a correction
 * is a new row. {book_id, method_id, run_id} is unique, so re-running a backfill or a writer cannot double a run.
 *
 *   import { recordBookCheck, pageProvenance, ensureBookCheckIndexes } from '../lib/book-checks.mjs';
 *   const text_provenance = await pageProvenance(db, bookId, [12, 13, 14]);   // live read, at check time
 *   await recordBookCheck(db, { book_id, checked_at, method_id: 'shelf-overview', method_version: '1', ... });
 */
import { readFileSync, existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const COLLECTION = 'book_checks';
export const VERDICTS = ['show', 'caveat', 'fix'];
export const READER_KINDS = ['model', 'human', 'detector'];
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
    classes, note, evidence_path, text_provenance, api_usd, subscription_usd_eq,
  } = input;
  if (!nonEmpty(book_id)) p.push('book_id');
  const at = checked_at instanceof Date ? checked_at : (nonEmpty(checked_at) ? new Date(checked_at) : null);
  if (!at || Number.isNaN(at.getTime())) p.push('checked_at (a date)');
  if (!nonEmpty(method_id)) p.push('method_id');
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
  if (verdict_source !== undefined && !nonEmpty(verdict_source)) p.push('verdict_source, when given, is a non-empty string');
  for (const [k, v] of [['api_usd', api_usd], ['subscription_usd_eq', subscription_usd_eq]]) if (v !== undefined && v !== null && !(isNum(v) && v >= 0)) p.push(`${k} must be a number ≥ 0`);
  if (classes !== undefined && !(Array.isArray(classes) && classes.every(nonEmpty))) p.push('classes must be a list of strings');
  if (p.length) throw new TypeError(`book_checks row refused (${book_id ?? '?'}, ${method_id ?? '?'}): missing or bad ${p.join('; ')}`);

  return {
    book_id, checked_at: at, method_id, method_version: String(method_version),
    run_id: run_id ?? null,
    ...(frame !== undefined ? { frame } : {}),
    pages_read: [...pages_read],
    reader: { kind: reader.kind, ...(reader.model ? { model: reader.model } : {}), ...(reader.role ? { role: reader.role } : {}), image_opened: reader.image_opened },
    verdict,
    ...(verdict_source ? { verdict_source } : {}),
    ...(classes ? { classes: [...new Set(classes)] } : {}),
    ...(nonEmpty(note) ? { note } : {}),
    evidence_path,
    text_provenance,
    ...(isNum(api_usd) ? { api_usd } : {}),
    ...(isNum(subscription_usd_eq) ? { subscription_usd_eq } : {}),
    recorded_at: new Date(),
    recorded_by: basename(process.argv[1] || 'unknown'),
  };
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
    ocr_model: r.ocr?.model ?? null, ocr_source: r.ocr?.source ?? null, ocr_prompt_version: r.ocr?.prompt_version ?? null,
    ocr_updated_at: r.ocr?.updated_at ?? null,
    translation_model: r.translation?.model ?? null, translation_source: r.translation?.source ?? null,
    translation_updated_at: r.translation?.updated_at ?? null, translation_content_hash: r.translation?.content_hash ?? null,
    source,
  };
  const missing = [!e.ocr_model && 'no ocr.model on the page', !e.translation_model && 'no translation.model on the page'].filter(Boolean);
  if (missing.length) e.unknown_reason = missing.join('; ');
  return e;
}
