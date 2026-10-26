// PRIOR ART: scripts/lib/write-provenance.mjs — the `engine` block every page writer stores (gemini-engine/1) and
// `missingProvenance()`, its checker for PAGES. It says what produced one page's text; nothing reads it back out into
// estimator rows, which key a route on the engine name alone (#6740). scripts/audit/provenance-coverage.mjs — counts
// pages whose block is incomplete; it does not label a row or define a route. This module is the estimator-row half:
// it reads that block (or its absence) into a row, defines what a route IS for pooling, and throws on a row that
// does not say where it came from.
/**
 * Estimator-row provenance (#6740). Derek, 2026-10-26: "no data provenance on this? and the prompts used?" — reads
 * made under different prompts were pooled as one route (the v1 #4780 held-out miss was a prompt difference: no
 * context line), because every row file keyed on the engine name only.
 *
 * A row carries ONE of:
 *
 *   provenance: {                         // measured: read off the page / revision that the row counts
 *     schema: 'estimator-provenance/1',
 *     engine,                             // model id that produced the text ('gemini-3.8-flash-low', 'ia-ocr', 'human')
 *     prompt_id, prompt_version,          // which prompt (the `prompts` collection id + version)
 *     prompt_hash,                        // hash of the stored TEMPLATE
 *     sent_hash,                          // hash of the exact text sent, where the writer recorded it
 *     read_mode,                          // image | text | image+draft
 *     access,                             // api | cli | local | archive | human
 *     cli_name, cli_version,              // 'n/a' unless access is cli
 *     job_id, code_version,
 *     call_site,                          // the writer (not part of the key; it says which code to read)
 *     instrument: { class, model, prompt_hash },   // what MEASURED the row: mechanical stamp, reference scorer,
 *   }                                              // model judge (model + judge prompt hash), human
 *
 *   provenance: 'legacy-not-recorded',    // an experiment row written before rows carried provenance
 *   provenance_stated: { source, prompt, ... }      // what the experiment's own file says (its path + its words)
 *
 * Values: a string, `not_recorded` (the writer did not record it — explicit, never absent), `n/a` (the slot does not
 * apply: a prompt for Kraken, a CLI version for an API call). A row that pools many pages may carry a DISTRIBUTION
 * `{ distinct, top: [[value, pages], ...] }` in a covariate slot (sent_hash, job_id, code_version, cli_version,
 * prompt_hash, access); the KEY slots (engine, prompt_id, prompt_version, read_mode) must be single values.
 *
 * A route's identity for pooling is engine x prompt (id + version) x read_mode — `routeKey()`. CLI version, job and
 * code version are covariates, not part of the key.
 *
 * Python twin: scripts/eval/estimator/provenance.py (the build-table scripts). Both read the constants from
 * provenance-schema.json; tests/unit/estimator-provenance.test.ts runs this validator over every committed row file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SPEC = JSON.parse(fs.readFileSync(path.join(HERE, 'provenance-schema.json'), 'utf8'));
export const { SCHEMA, LEGACY, NOT_RECORDED, NA } = SPEC;
export const READ_MODES = new Set(SPEC.read_modes);
export const ACCESS = new Set(SPEC.access);
export const INSTRUMENTS = new Set(SPEC.instruments);
const KEY_FIELDS = SPEC.key_fields;
const COVARIATES = SPEC.covariate_fields;

export class ProvenanceError extends Error {}

// ---------------------------------------------------------------- reading a page's record
/**
 * The raw provenance of one stored text, in the flat shape the census $group emits (`mongoRawProvenance`) and that
 * `rawFromSub` builds from a fetched document. One shape, so the in-Mongo path and the in-JS path cannot disagree.
 */
export const RAW_KEYS = ['src', 'model', 'schema', 'ename', 'api', 'cli', 'cliv', 'pid', 'pv', 'ph', 'tpv', 'tpn', 'draft', 'img', 'txt', 'iae', 'cs', 'erun', 'erev'];

/** Mongo expressions for RAW_KEYS under `prefix` ('ocr', 'translation', or '' for a page_revisions document). */
export function mongoRawProvenance(prefix) {
  const p = (k) => `$${prefix ? `${prefix}.` : ''}${k}`;
  const has = (k) => ({ $ne: [{ $type: p(k) }, 'missing'] });
  return {
    src: p('source'), model: p('model'), schema: p('engine.schema'), ename: p('engine.name'), api: p('engine.api'),
    cli: p('engine.cli.name'), cliv: p('engine.cli.version'),
    pid: { $ifNull: [p('engine.prompt.id'), { $cond: [{ $eq: [{ $type: p('engine.prompt') }, 'object'] }, 'null', null] }] },
    pv: p('engine.prompt.version'), ph: p('engine.prompt.hash'),
    tpv: p('prompt_version'), tpn: p('prompt_name'),
    draft: { $or: [has('engine.input.draft'), has('engine.run.draft')] }, img: has('engine.input.image_url'), txt: has('engine.input.source_text_hash'),
    iae: p('ia.engine'), cs: { $ifNull: [p('engine.call_site'), null] },
    erun: { $cond: [{ $eq: [{ $type: p('engine.run') }, 'string'] }, p('engine.run'), null] },
    erev: { $ifNull: [p('engine.revision'), p('engine.version')] },
  };
}
/** Per-page covariates, collected as sets inside a group (job, code version, sent hash). */
export function mongoCovariateAccumulators(prefix) {
  const p = (k) => `$${prefix ? `${prefix}.` : ''}${k}`;
  return {
    jobs: { $addToSet: { $ifNull: [p('engine.run.job_id'), { $ifNull: [p('engine.run.batch_job_id'), { $ifNull: [p('ia.ingest_run'), p('batch_job_id')] }] }] } },
    codes: { $addToSet: p('engine.run.code_version') },
    sents: { $addToSet: p('engine.prompt.sent_hash') },
  };
}
/** RAW_KEYS from a fetched `ocr` / `translation` subdocument or a page_revisions document. */
export function rawFromSub(sub) {
  const e = sub?.engine && typeof sub.engine === 'object' ? sub.engine : null;
  const pr = e?.prompt && typeof e.prompt === 'object' ? e.prompt : null;
  return {
    src: sub?.source ?? null, model: sub?.model ?? null, schema: e?.schema ?? null, ename: e?.name ?? null, api: e?.api ?? null,
    cli: e?.cli?.name ?? null, cliv: e?.cli?.version ?? null, pid: pr ? (pr.id ?? 'null') : null, pv: pr?.version ?? null, ph: pr?.hash ?? null,
    tpv: sub?.prompt_version ?? null, tpn: sub?.prompt_name ?? null,
    draft: !!(e?.input?.draft || e?.run?.draft), img: !!e?.input?.image_url, txt: !!e?.input?.source_text_hash,
    iae: sub?.ia?.engine ?? null, cs: e?.call_site ?? null, erun: typeof e?.run === 'string' ? e.run : null, erev: e?.revision ?? e?.version ?? null,
  };
}
export function covariatesFromSub(sub) {
  const e = sub?.engine && typeof sub.engine === 'object' ? sub.engine : null;
  const run = e?.run && typeof e.run === 'object' ? e.run : {};
  return { jobs: [run.job_id ?? run.batch_job_id ?? sub?.ia?.ingest_run ?? sub?.batch_job_id].filter((x) => x != null),
    codes: [run.code_version].filter((x) => x != null), sents: [e?.prompt?.sent_hash].filter((x) => x != null) };
}

/** Specialist models that take a prompt (a VLM) vs ones that do not (a line recognizer): a missing prompt means
 *  `not_recorded` for the first, `n/a` for the second. */
const PROMPTED_LOCAL = /paddle|yigdzin|mineru|qwen|olmocr|dots|chandra|deepseek/i;
const HUMAN_SOURCE = /^(manual|manual-backfill|volunteer-correction|human)$/;
const s = (v) => (v == null || v === '' ? null : String(v));
const nr = (v) => s(v) ?? NOT_RECORDED;

/** `ia-ocr/0.0.18` -> `ia-ocr`, as route-census.mjs routeName does. */
const engineId = (m) => (/^ia-ocr\//.test(m ?? '') ? 'ia-ocr' : s(m));

/**
 * The provenance block (without `instrument`) for one raw record. `field` is 'ocr' | 'translation'.
 * Covariates are passed as arrays of observed values (or a distribution already built).
 */
export function provenanceFromRaw(raw, field, cov = {}) {
  const r = raw ?? {};
  const dist = (vals, dflt) => distribution(vals, dflt);
  const base = { schema: SCHEMA, call_site: nr(r.cs) };
  if (r.schema === 'gemini-engine/1') {
    const cli = r.api === 'cli';
    return { ...base, engine: nr(r.model),
      prompt_id: r.pid === 'null' || r.pid == null ? NOT_RECORDED : String(r.pid), prompt_version: nr(r.pv), prompt_hash: nr(r.ph),
      sent_hash: dist(cov.sents, NOT_RECORDED),
      read_mode: field === 'translation' ? (r.img ? 'text+image' : 'text') : r.draft ? 'image+draft' : r.img ? 'image' : r.txt ? 'text' : NOT_RECORDED,
      access: cli ? 'cli' : r.api ? 'api' : NOT_RECORDED, cli_name: cli ? nr(r.cli) : NA, cli_version: cli ? nr(r.cliv) : NA,
      job_id: dist(cov.jobs, NOT_RECORDED), code_version: dist(cov.codes, NOT_RECORDED) };
  }
  if (r.src === 'ia_djvu' || /^ia-ocr/.test(r.model ?? '')) {
    return { ...base, engine: 'ia-ocr', prompt_id: NA, prompt_version: NA, prompt_hash: NA, sent_hash: NA,
      read_mode: 'image', access: 'archive', cli_name: NA, cli_version: NA, archive_engine: nr(r.iae ?? r.model),
      job_id: dist(cov.jobs, NOT_RECORDED), code_version: NOT_RECORDED };
  }
  if (HUMAN_SOURCE.test(r.src ?? '') || r.model === 'human') {
    return { ...base, engine: 'human', prompt_id: NA, prompt_version: NA, prompt_hash: NA, sent_hash: NA, read_mode: field === 'ocr' ? 'image' : 'text',
      access: 'human', cli_name: NA, cli_version: NA, job_id: NA, code_version: NA };
  }
  if (r.ename && r.schema == null) {
    // a specialist engine block (Kraken, Yigdzin, PaddleOCR-VL, NDL): local weights, no gemini-engine/1 shape
    const prompted = PROMPTED_LOCAL.test(`${r.ename} ${r.model}`);
    return { ...base, engine: nr(r.model), prompt_id: prompted ? NOT_RECORDED : NA, prompt_version: prompted ? NOT_RECORDED : NA,
      prompt_hash: prompted ? NOT_RECORDED : NA, sent_hash: prompted ? NOT_RECORDED : NA, read_mode: field === 'ocr' ? 'image' : 'text',
      access: 'local', cli_name: NA, cli_version: NA, job_id: s(r.erun) ?? dist(cov.jobs, NOT_RECORDED), code_version: nr(r.erev) };
  }
  // No engine block: written before #4613, or by a writer that skips it. The top-level prompt fields are the only
  // record (a label, not a hash: write-provenance.mjs rule 2), so they fill the version and nothing else.
  return { ...base, engine: nr(engineId(r.model)), prompt_id: NOT_RECORDED, prompt_version: r.tpv != null ? `label:${r.tpv}` : NOT_RECORDED,
    prompt_hash: NOT_RECORDED, sent_hash: NOT_RECORDED, read_mode: NOT_RECORDED,
    access: r.src === 'batch_api' ? 'api' : NOT_RECORDED, cli_name: NOT_RECORDED, cli_version: NOT_RECORDED,
    job_id: dist(cov.jobs, NOT_RECORDED), code_version: NOT_RECORDED };
}

/** A covariate as a single value when it is one, else `{ distinct, top }`; `dflt` when nothing was observed. */
export function distribution(vals, dflt = NOT_RECORDED) {
  if (vals && typeof vals === 'object' && !Array.isArray(vals) && 'distinct' in vals) return vals;
  if (vals instanceof Map) vals = [...vals];
  const counts = new Map();
  for (const v of vals ?? []) {
    if (Array.isArray(v)) { if (v[0] != null) counts.set(String(v[0]), (counts.get(String(v[0])) ?? 0) + v[1]); }
    else if (v != null && v !== '') counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
  }
  if (counts.size === 0) return dflt;
  if (counts.size === 1) return [...counts.keys()][0];
  return { distinct: counts.size, top: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5) };
}

/** Merge several blocks with the same route key into one cell's block: covariates become distributions. */
export function mergeProvenance(blocks) {
  const [first] = blocks;
  if (!first) throw new ProvenanceError('mergeProvenance: no blocks');
  const out = { ...first };
  for (const k of KEY_FIELDS) {
    const vals = new Set(blocks.map((b) => b[k]));
    if (vals.size > 1) throw new ProvenanceError(`mergeProvenance: key field ${k} differs (${[...vals].join(', ')}) — not one route`);
  }
  for (const k of [...COVARIATES, 'call_site', 'archive_engine']) {
    if (!blocks.some((b) => k in b)) continue;
    const counts = new Map();
    for (const b of blocks) {
      const v = b[k], w = b._pages ?? 1;
      if (v && typeof v === 'object') for (const [x, n] of v.top) counts.set(x, (counts.get(x) ?? 0) + n);
      else counts.set(v, (counts.get(v) ?? 0) + w);
    }
    out[k] = counts.size === 1 ? [...counts.keys()][0] : { distinct: counts.size, top: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5) };
  }
  delete out._pages;
  return out;
}

// ---------------------------------------------------------------- identity
/** The pooling key: engine x prompt (id + version) x read mode. */
export function routeKey(p) {
  if (!p || typeof p !== 'object') throw new ProvenanceError('routeKey: needs a provenance block (a legacy row has no route key)');
  return `${p.engine} | ${p.prompt_id}@${p.prompt_version} | ${p.read_mode}`;
}
/** Is the prompt half of the key actually known? (`n/a` counts as known: the engine takes no prompt.) */
export const promptRecorded = (p) => p.prompt_version !== NOT_RECORDED && !String(p.prompt_version).startsWith('label:') && p.read_mode !== NOT_RECORDED;

// ---------------------------------------------------------------- validation
const isVal = (v) => typeof v === 'string' && v.length > 0;
const isDist = (v) => v && typeof v === 'object' && Number.isInteger(v.distinct) && v.distinct > 1 && Array.isArray(v.top) && v.top.length > 0;

/** Throws ProvenanceError naming the row and the field. `where` is a label for the message (file:line). */
export function validateRow(row, where = 'row') {
  const fail = (m) => { throw new ProvenanceError(`${where}: ${m}`); };
  if (!row || typeof row !== 'object') fail('not an object');
  const p = row.provenance;
  if (p === undefined) fail('no `provenance` field (a legacy row says provenance: "legacy-not-recorded" plus provenance_stated)');
  if (p === LEGACY) {
    const st = row.provenance_stated;
    if (!st || typeof st !== 'object') fail('legacy row without provenance_stated');
    for (const k of SPEC.legacy_required) if (!isVal(st[k])) fail(`provenance_stated.${k} missing (say what the experiment file states, or that it states nothing)`);
    if (row.judge && !SPEC.mechanical_judges.includes(row.judge) && !isVal(st.judge)) fail(`judged row (judge ${row.judge}) without provenance_stated.judge`);
    return { legacy: true };
  }
  if (typeof p !== 'object' || p === null) fail(`provenance must be an object or "${LEGACY}" (got ${JSON.stringify(p)})`);
  if (p.schema !== SCHEMA) fail(`provenance.schema must be ${SCHEMA}`);
  for (const k of KEY_FIELDS) if (!isVal(p[k])) fail(`provenance.${k} missing or not a single value`);
  for (const k of COVARIATES) if (!(isVal(p[k]) || isDist(p[k]))) fail(`provenance.${k} missing`);
  if (!READ_MODES.has(p.read_mode)) fail(`provenance.read_mode ${p.read_mode} not one of ${[...READ_MODES].join(', ')}`);
  const access = isDist(p.access) ? p.access.top.map(([v]) => v) : [p.access];
  for (const a of access) if (!ACCESS.has(a)) fail(`provenance.access ${a} not one of ${[...ACCESS].join(', ')}`);
  if (isVal(p.access) && p.access !== 'cli' && p.access !== NOT_RECORDED && (p.cli_name !== NA || p.cli_version !== NA)) fail(`provenance.cli_* must be "${NA}" when access is ${p.access}`);
  const ins = p.instrument;
  if (!ins || typeof ins !== 'object') fail('provenance.instrument missing (what measured this row)');
  if (!INSTRUMENTS.has(ins.class)) fail(`provenance.instrument.class ${ins.class} not one of ${[...INSTRUMENTS].join(', ')}`);
  if (!isVal(ins.model) || !isVal(ins.prompt_hash)) fail('provenance.instrument needs model and prompt_hash');
  if (ins.class === 'model-judge' && (ins.model === NA || ins.prompt_hash === NA)) fail('a model-judge instrument names its judge model and judge prompt hash');
  return { legacy: false, key: routeKey(p) };
}

/** Validate every row of a .jsonl file; returns counts. Lines starting with {"_doc" are file notes, not rows. */
export function validateFile(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  let rows = 0, legacy = 0;
  lines.forEach((l, i) => {
    if (!l.trim()) return;
    const row = JSON.parse(l);
    if (row._doc !== undefined && Object.keys(row).length === 1) return;
    const r = validateRow(row, `${file}:${i + 1}`);
    rows++; if (r.legacy) legacy++;
  });
  return { rows, legacy };
}

/** Label a legacy row explicitly. `stated` must say what the experiment file says (validated, never defaulted). */
export function labelLegacy(row, stated) {
  const out = { ...row, provenance: LEGACY, provenance_stated: stated };
  validateRow(out, 'labelLegacy');
  return out;
}

// ---------------------------------------------------------------- the legacy registry
let _legacy;
export const LEGACY_REGISTRY = () => (_legacy ??= JSON.parse(fs.readFileSync(path.join(HERE, 'provenance-legacy.json'), 'utf8')));
/**
 * What the experiment's own files state for a legacy row: `table` is a provenance-legacy.json table, `keys` the
 * candidate keys most specific first (e.g. ['xlref-t3|O', 'xlref-t3']). Throws when none is registered: a source
 * nobody has read gets no label, it gets an error (never a silent default).
 */
export function legacyStated(table, keys) {
  const t = LEGACY_REGISTRY()[table];
  if (!t) throw new ProvenanceError(`provenance-legacy.json has no table ${table}`);
  for (const k of [].concat(keys)) if (k != null && t[k] && k !== '_match') return t[k];
  throw new ProvenanceError(`provenance-legacy.json ${table}: no entry for ${[].concat(keys).join(' / ')} — read the experiment's files and add what they state`);
}
