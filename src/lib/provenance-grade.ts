/**
 * provenance-grade.ts — the provenance grade of a page's ocr / translation, computed where it is read
 * (sourcelibrary-v3 #201: no per-page grade table; the dataset export grades on read).
 *
 * PRIOR ART: scripts/audit/provenance-grades.mjs — the grader (PR #210). This file is its TypeScript
 * twin for src/ routes: gradeField(), corroborate(), writtenAt(), monthOf() and hasText() are the same
 * functions, line for line. The .mjs cannot be imported by a route: it reaches
 * provenance-history.json through import.meta.url, which a Next bundle does not resolve (the TS twin
 * of that reader is inferHistoricalGeneration() in src/lib/write-provenance.ts). Parity on the real
 * page fixtures: tests/unit/provenance-grade-parity.test.ts. Read the .mjs header for what each
 * grade means; change the two together.
 *
 * The records corroboration reads — the same in the export and in the weekly summary
 * (scripts/audit/provenance-grade-summary.mjs), so a page's grade on read agrees with the count it
 * contributed:
 *   - the page's batch job, keyed id / job_name / gemini_job_name / _id. Read first by the books in
 *     the response (index book_id+status), then, for job ids still missing — one batch job can cover
 *     many books and is filed under one of them — by `id` / `_id`. Page batch_job_ids match `id`
 *     (97%) or `_id` (3%), never job_name (8,245 distinct ids, 2026-11-13). The `id` lookup runs
 *     only when batch_jobs_id_idx (scripts/maintenance/ensure-indexes.mjs) is live: without it, it
 *     is a 142K-row scan, measured 4.95 s cold on a 62-page book. Until then a page whose job was not
 *     found by book reads `corroborated: null` (not checked) — never `false`.
 *   - Mongo gemini_usage rows of the page's book in the time window (index book_id+timestamp).
 *   - NOT Supabase gemini_usage: its rows name jobs, never pages, it has no index on batch_job_id,
 *     and in the 60,000-page dry run it corroborated 0 pages (every batch page was corroborated by its
 *     batch_jobs row first).
 */
import { ObjectId, type Db } from 'mongodb';
import { missingProvenance, inferHistoricalGeneration, isNotRecorded } from './write-provenance';

export const GRADES = ['recorded', 'human', 'recorded_on_page', 'imported', 'inferred', 'not_recorded'] as const;
export type Grade = (typeof GRADES)[number];
export const GRADER_VERSION = 'provenance-grade/1';
export type Field = 'ocr' | 'translation';

type Sub = Record<string, any>;
type Rec = Record<string, any>;

const GEMINI = new Set(['ai', 'batch_api', 'pipeline_preview', 'batch_api_recovery', 'realtime_api_sequential', 'AI generated']);
const HUMAN = new Set(['manual', 'manual-backfill', 'volunteer-correction']);
const CORPUS_IMPORT = new Set(['corpus', 'wikisource']);
const RELOCATION = /^(spread-split|ia-ocr-repair|reocr-contamination-repair-\d+|ai-repair-sync|leaf-shift-repair-\d+)$/;
const H = 3600e3, D = 86400e3;

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const toDate = (v: unknown): Date | null => (v instanceof Date ? v : v ? new Date(v as string) : null);
const valid = (d: Date | null): d is Date => d instanceof Date && !Number.isNaN(d.getTime());

export function hasText(field: Field, sub: unknown, has?: boolean): boolean {
  if (typeof has === 'boolean') return has;
  if (!sub || typeof sub !== 'object') return false;
  const s = sub as Sub;
  return nonEmpty(s.data) || (field === 'translation' && nonEmpty(s.text));
}

export function writtenAt(sub: unknown): { at: Date | null; clock: string | null } {
  for (const k of ['updated_at', 'generated_at', 'edited_at']) { const d = toDate((sub as Sub | null)?.[k]); if (valid(d)) return { at: d, clock: k }; }
  return { at: null, clock: null };
}

export const monthOf = (sub: unknown): string => { const { at } = writtenAt(sub); return at ? at.toISOString().slice(0, 7) : 'none'; };

const pick = (o: Sub | null | undefined, keys: string[]) => Object.fromEntries(keys.filter((k) => o?.[k] != null && o[k] !== '').map((k) => [k, o![k]]));

export interface FieldGrade {
  field: Field; month: string; clock: string | null; source: string | null; grade: Grade;
  evidence: Record<string, any>;
}

/** Twin of gradeField() in scripts/audit/provenance-grades.mjs. Pure; null when the field holds no text. */
export function gradeField(field: Field, sub: unknown, opts: { has?: boolean } = {}): FieldGrade | null {
  if (!hasText(field, sub, opts.has)) return null;
  const s = sub as Sub;
  const src: string | null = s.source ?? null;
  const month = monthOf(s);
  const { clock } = writtenAt(s);
  const base = { field, month, clock, source: src };
  const e = s.engine;

  if (e && typeof e === 'object' && !isNotRecorded(e)) {
    const { missing, markers } = missingProvenance(field, s);
    return { ...base, grade: 'recorded', evidence: { fields: ['engine'], engine: e.schema || e.name || null, model: e.model ?? s.model ?? null, call_site: e.call_site ?? null, api: e.api ?? null, missing, markers, ...(s.edited_by ? { edited_by: s.edited_by } : {}) } };
  }

  if (HUMAN.has(src as string) || nonEmpty(s.edited_by)) {
    const k = s.correction;
    if (k && typeof k === 'object' && k.drafted_by === 'assistant') {
      return { ...base, grade: 'recorded_on_page', evidence: { rule: 'correction-block', fields: ['correction.drafted_by', 'correction.assistant_model', 'correction.second_reader', 'edited_by'], assistant_model: k.assistant_model ?? null, second_reader: k.second_reader ?? null, correction_id: k.id ?? null, revision_id: k.revision_id ?? null, edited_by: s.edited_by ?? null } };
    }
    return { ...base, grade: 'human', evidence: { fields: ['source', 'edited_by'].filter((x) => s[x] != null), ...pick(s, ['edited_by', 'edited_at', 'model']), ...(s.correction?.id ? { correction_id: s.correction.id } : {}) } };
  }

  const settings = () => { const inf = inferHistoricalGeneration(field, { ...s, engine: undefined }); return inf.status === 'inferred' ? inf.rule : null; };

  if (GEMINI.has(src as string) && nonEmpty(s.model) && s.prompt_version != null && s.prompt_version !== '' && nonEmpty(s.batch_job_id)) {
    return { ...base, grade: 'recorded_on_page', evidence: { rule: 'model+prompt_version+batch_job_id', fields: ['model', 'prompt_version', 'batch_job_id'], ...pick(s, ['model', 'prompt_version', 'batch_job_id', 'prompt_id', 'prompt_hash']), settings_rule: settings() } };
  }
  if (src === 'ia_djvu' && (nonEmpty(s.ia?.module_version) || /^ia-ocr\//.test(s.model || ''))) {
    return { ...base, grade: 'recorded_on_page', evidence: { rule: 'ia-ocr-engine-version', fields: ['model', 'ia.engine', 'ia.module_version'].filter((k) => (k === 'model' ? s.model : s.ia?.[k.slice(3)])), model: s.model ?? null, ia_engine: s.ia?.engine ?? null, module_version: s.ia?.module_version ?? null, item: s.ia?.item ?? null } };
  }

  const edition = s.text_edition || s.text_source;
  if ((edition && typeof edition === 'object') || CORPUS_IMPORT.has(src as string)) {
    return { ...base, grade: 'imported', evidence: { fields: ['text_edition', 'text_source', 'source'].filter((k) => s[k] != null), source: src, edition: edition?.name ?? null, repo: edition?.repo ?? edition?.url ?? null, commit: edition?.commit ?? edition?.version ?? null } };
  }

  if (src && !GEMINI.has(src) && !RELOCATION.test(src) && nonEmpty(s.model) && (nonEmpty(e) || nonEmpty(s.pipeline))) {
    return { ...base, grade: 'recorded_on_page', evidence: { rule: 'engine-named-on-page', fields: ['model', nonEmpty(e) ? 'engine' : 'pipeline'], model: s.model, engine: nonEmpty(e) ? e : null, pipeline: s.pipeline ?? null } };
  }

  if (src && RELOCATION.test(src)) return { ...base, grade: 'not_recorded', evidence: { reason: `relocated or rewritten by sweep '${src}', not read from this page`, ...pick(s, ['model']) } };

  if (GEMINI.has(src as string)) {
    const inf = inferHistoricalGeneration(field, { ...s, engine: undefined });
    if (inf.status === 'inferred') return { ...base, grade: 'inferred', evidence: { rule: inf.rule, fields: ['source', clock, ...(s.code_version ? ['code_version'] : [])], ...pick(s, ['model', 'prompt_version', 'batch_job_id']) } };
    return { ...base, grade: 'not_recorded', evidence: { reason: (inf as { reason?: string }).reason, ...pick(s, ['model', 'prompt_version']) } };
  }

  return { ...base, grade: 'not_recorded', evidence: { reason: src ? `source '${src}': no engine, no named edition, no dated rule` : 'no source on the field', ...pick(s, ['model', 'prompt_version']) } };
}

const TYPE_RE: Record<Field, RegExp> = { ocr: /^ocr$|^spread-ocr$/, translation: /^translat(e|ion)$/ };

export interface Records { jobs?: Map<string, Rec>; usage?: Rec[]; usageByJob?: Map<string, Rec[]> }
export interface Corroboration { corroborated: boolean; by: Record<string, any> | null; contradictions: string[]; looked: string[] }

/** Twin of corroborate() in scripts/audit/provenance-grades.mjs. Pure: records are passed in. */
export function corroborate(field: Field, sub: unknown, pageKeys: (string | null | undefined)[], recs: Records): Corroboration {
  const s = (sub || {}) as Sub;
  const { at: t } = writtenAt(sub);
  const model: string | null = s.model || null;
  const typeOk = (x: unknown) => TYPE_RE[field].test(String(x || ''));
  const contradictions: string[] = [];
  const looked: string[] = [];
  const modelOk = (m: unknown, what: string) => { if (!m || !model || m === model) return true; contradictions.push(`${what} model ${m} ≠ page model ${model}`); return false; };
  if (!t) return { corroborated: false, by: null, contradictions: ['no write date on the page'], looked };
  const jid: string | null = s.batch_job_id || null;

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
  let best: Rec | null = null;
  for (const u of recs.usage || []) {
    if (!typeOk(u.type) || !Array.isArray(u.page_ids) || !u.page_ids.some((p: unknown) => keys.has(String(p)))) continue;
    const ut = toDate(u.timestamp);
    if (!valid(ut) || ut < new Date(+t - 3 * D) || ut > new Date(+t + D)) continue;
    if (!modelOk(u.model, 'gemini_usage')) continue;
    if (!best || Math.abs(+ut - +t) < Math.abs(+toDate(best.timestamp)! - +t)) best = u;
  }
  if (best) return { corroborated: true, by: { record: 'gemini_usage(mongo)', id: best.id ?? String(best._id), model: best.model ?? null, at: toDate(best.timestamp), via: 'page_ids', endpoint: best.endpoint ?? null }, contradictions, looked };
  return { corroborated: false, by: null, contradictions, looked };
}

/** Which grades are checked against the call log: the same set the dry run and the summary check. */
export const needsCorroboration = (g: FieldGrade): boolean => g.grade === 'inferred' || (g.grade === 'recorded_on_page' && GEMINI.has(g.source as string));

/** The ocr / translation sub-fields the grader reads (text bodies excluded). For a Mongo projection. */
export const GRADE_SUBFIELDS = ['source', 'model', 'prompt_version', 'prompt_id', 'prompt_hash', 'batch_job_id', 'engine', 'updated_at', 'generated_at', 'edited_at', 'edited_by', 'correction', 'ia', 'text_edition', 'text_source', 'pipeline', 'code_version', 'content_hash', 'source_url'];

/** What the dataset export shows per field: the grade, the month written, and the ids it rests on. */
export interface ExportGrade {
  grade: Grade;
  month: string;
  /** null when the grade is not one checked against the call log (recorded, human, imported, …). */
  corroborated: boolean | null;
  /** The independent record that corroborates the page: batch_jobs or gemini_usage, by id. */
  corroborated_by: { record: string; id: string } | null;
  /** The dated rule (inferred), the on-page rule (recorded_on_page), or why not recorded. */
  basis: string | null;
  /** The page fields the grade rests on. */
  evidence_fields: string[];
  grader: string;
}

export function exportGrade(g: FieldGrade, c: Corroboration | null): ExportGrade {
  const ev = g.evidence;
  return {
    grade: g.grade,
    month: g.month,
    corroborated: c ? c.corroborated : null,
    corroborated_by: c?.by ? { record: c.by.record, id: String(c.by.id) } : null,
    basis: ev.rule ?? ev.reason ?? (g.grade === 'imported' ? ev.edition ?? ev.source ?? null : g.grade === 'recorded' ? ev.engine ?? null : null),
    evidence_fields: Array.isArray(ev.fields) ? ev.fields.filter(Boolean) : [],
    grader: GRADER_VERSION,
  };
}

// Is batch_jobs.id indexed? Read from the live index list, remembered for 10 minutes per process.
let idIndex: { at: number; ok: boolean } | null = null;
async function jobIdIndexed(db: Db): Promise<boolean> {
  if (idIndex && Date.now() - idIndex.at < 600e3) return idIndex.ok;
  const ix = await db.collection('batch_jobs').indexes();
  idIndex = { at: Date.now(), ok: ix.some((i) => Object.keys(i.key)[0] === 'id') };
  return idIndex.ok;
}

type PageLike = { _id?: unknown; id?: string; book_id?: string; ocr?: Sub | null; translation?: Sub | null };

/**
 * Grade every page × field in `pages` (one export response), reading the call log once per BOOK:
 * batch_jobs for all books at once (index book_id+status; then by id for jobs filed elsewhere) and
 * one gemini_usage query per book that has a page to corroborate (index book_id+timestamp). `has` says which fields the row
 * carries text for (the export grades only the text it serves). `skipCallLog` grades without the
 * call log (corroborated: null), for when the read failed.
 */
export async function gradePages(
  db: Db,
  pages: PageLike[],
  has: (p: PageLike, field: Field) => boolean,
  { concurrency = 6, maxTimeMS = 8000, skipCallLog = false, jobIdLookup }: { concurrency?: number; maxTimeMS?: number; skipCallLog?: boolean; jobIdLookup?: boolean } = {},
): Promise<{ grades: Map<PageLike, Partial<Record<Field, ExportGrade>>>; books_read: number; usage_rows: number }> {
  const graded: { p: PageLike; g: FieldGrade }[] = [];
  for (const p of pages) for (const f of ['ocr', 'translation'] as const) {
    const g = gradeField(f, p[f], { has: has(p, f) });
    if (g) graded.push({ p, g });
  }
  const needs = graded.filter((x) => needsCorroboration(x.g));
  const window = new Map<string, { min: Date; max: Date }>();
  for (const { p, g } of needs) {
    const { at } = writtenAt(p[g.field]); if (!at || !p.book_id) continue;
    const w = window.get(p.book_id) ?? window.set(p.book_id, { min: at, max: at }).get(p.book_id)!;
    if (at < w.min) w.min = at; if (at > w.max) w.max = at;
  }
  const jobs = new Map<string, Rec>();
  const unresolvedJobs = new Set<string>();
  const usageOfBook = new Map<string, Rec[]>();
  const usageByJobOfBook = new Map<string, Map<string, Rec[]>>();
  let usageRows = 0;
  const bookIds = [...window.keys()];
  if (bookIds.length && !skipCallLog) {
    const withJob = needs.filter((x) => x.p.book_id && x.p[x.g.field]?.batch_job_id);
    if (withJob.length) {
      const projection = { id: 1, job_name: 1, gemini_job_name: 1, type: 1, model: 1, created_at: 1, completed_at: 1, updated_at: 1, book_id: 1 };
      const add = (rows: Rec[]) => { for (const j of rows) for (const k of [j.id, j.job_name, j.gemini_job_name, String(j._id)]) if (k) jobs.set(k, j); };
      add(await db.collection('batch_jobs').find({ book_id: { $in: [...new Set(withJob.map((x) => x.p.book_id as string))] } }, { projection, maxTimeMS }).toArray());
      const missing = [...new Set(withJob.map((x) => String(x.p[x.g.field]!.batch_job_id)))].filter((k) => !jobs.has(k));
      if (missing.length && !(jobIdLookup ?? await jobIdIndexed(db))) for (const k of missing) unresolvedJobs.add(k);
      else if (missing.length) {
        const oids = missing.filter((k) => /^[0-9a-f]{24}$/.test(k)).map((k) => new ObjectId(k));
        add(await db.collection('batch_jobs').find({ $or: [{ id: { $in: missing } }, ...(oids.length ? [{ _id: { $in: oids } }] : [])] }, { projection, maxTimeMS }).toArray());
      }
    }
    let next = 0;
    const worker = async () => {
      while (next < bookIds.length) {
        const b = bookIds[next++];
        const w = window.get(b)!;
        const rs = await db.collection('gemini_usage').find(
          { book_id: b, timestamp: { $gte: new Date(+w.min - 30 * D), $lte: new Date(+w.max + 3 * D) }, type: { $in: ['ocr', 'spread-ocr', 'translation', 'translate'] } },
          { projection: { id: 1, type: 1, model: 1, mode: 1, timestamp: 1, batch_job_id: 1, endpoint: 1, page_ids: 1 }, maxTimeMS },
        ).toArray();
        usageRows += rs.length;
        usageOfBook.set(b, rs);
        const byJob = new Map<string, Rec[]>();
        for (const u of rs) if (u.batch_job_id) (byJob.get(u.batch_job_id) ?? byJob.set(u.batch_job_id, []).get(u.batch_job_id)!).push(u);
        usageByJobOfBook.set(b, byJob);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, bookIds.length) }, worker));
  }
  const grades = new Map<PageLike, Partial<Record<Field, ExportGrade>>>();
  for (const { p, g } of graded) {
    const b = p.book_id as string;
    let c = needsCorroboration(g) && !skipCallLog
      ? corroborate(g.field, p[g.field], [p.id, String(p._id)], { jobs, usage: usageOfBook.get(b) ?? [], usageByJob: usageByJobOfBook.get(b) ?? new Map() })
      : null;
    if (c && !c.corroborated && unresolvedJobs.has(String(p[g.field]?.batch_job_id))) c = null; // its job was not looked up: unknown, not false
    const row = grades.get(p) ?? grades.set(p, {}).get(p)!;
    row[g.field] = exportGrade(g, c);
  }
  return { grades, books_read: bookIds.length, usage_rows: usageRows };
}
