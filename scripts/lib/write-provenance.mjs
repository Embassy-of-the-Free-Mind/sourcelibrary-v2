/**
 * PRIOR ART: scripts/lib/translate-core.mjs `contentHash` (moved here, re-exported there) —
 * hashes the OUTPUT only; scripts/lib/syriac-kraken-lane.mjs `ocrSetFields` and
 * scripts/maintenance/apply-reocr-verdicts.mjs `ENGINE_BLOCK` — the specialist-lane engine
 * blocks this generalises, each hard-wired to one model and one lane; scripts/workers/lib/
 * supabase-usage-logger.mjs — records what a call COST, not what it sent.
 *
 * ── What this is ─────────────────────────────────────────────────────────────
 *
 * The ONE builder every Gemini writer of `pages.ocr` and `pages.translation` goes through to
 * say what produced the text (#4613). A scholar citing a page, and anyone measuring quality,
 * needs to know: which engine and model, which prompt (by content, not a label), which
 * generation settings, which run, from which input, and when. Measured 2026-09-28 (issue
 * comment): no Gemini writer recorded temperature, thinking budget, max output tokens or
 * media resolution; realtime OCR recorded neither prompt text, run nor input image;
 * translations did not record which OCR text they were made from; `ocr.source: 'ai'` named
 * no call site. Two pages with identical `model` and `prompt_version` held materially
 * different text because the settings that produced them differed and nothing said so.
 *
 * The shape is the Yigdzin `engine` block (the Tibetan lane, the template Derek chose),
 * generalised to Gemini:
 *
 *   engine: {
 *     schema: 'gemini-engine/1', name: 'gemini', model, model_version, api: 'batch'|'realtime',
 *     call_site,                                  // the writer, repo-relative path
 *     prompt: { id, name, version, hash, sent_hash, sent_chars },
 *     generation: { temperature, top_p, top_k, max_output_tokens, thinking_budget,
 *                   media_resolution, sent, defaulted, defaults_source },
 *     run: { job_id | batch_job_id, code_version, host, at },
 *     input: { image_url, … } | { source_text_hash, … },
 *   }
 *   plus top-level `content_hash` (of the text written) and `updated_at`.
 *
 * ── Three rules, enforced here rather than remembered ────────────────────────
 *
 * 1. RECORD WHAT WAS SENT, NOT WHAT WAS MEANT. `generation` is built from the
 *    `generationConfig` object the call actually sent. A setting the request did not carry
 *    resolves to the model's published default (looked up from the models endpoint, see
 *    `MODEL_DEFAULTS`, with the date), and the block names it in `defaulted` so nobody
 *    mistakes a default for a choice. An unknown model gets `null` and a `not_recorded`
 *    source — never a guess. (Lambda OCR ran at temperature 1.0 for months because unset
 *    reads as "off" to a human; #4581.)
 *
 * 2. THE PROMPT IS IDENTIFIED BY THE TEXT SENT. `prompt.hash` is the stored template's
 *    hash from the `prompts` collection; `prompt.sent_hash` is the hash of the exact string
 *    that went over the wire, after substitution and any prefix. They differ on purpose.
 *    realtime-ocr.mjs stamped the constant label `v5.2026-02` while sending whatever the DB
 *    default prompt was (version 16 at the time of writing) — a label is not a record.
 *
 * 3. ABSENCE IS NEVER A VALUE. A field this builder cannot know is written as the explicit
 *    `not_recorded` marker (`{ status: 'not_recorded', reason }`, or the string for scalar
 *    slots), so a checker can tell "predates the writer" from "the writer forgot". The
 *    builder THROWS on a missing required input rather than emit a partial block: a
 *    provenance record that is sometimes complete is worse than none, because it is
 *    believed (memory: lesson_provenance_fields_documented_not_written).
 *
 * `missingProvenance()` is the checker — the standing audit
 * (scripts/audit/provenance-coverage.mjs) and the unit tests both run it, so a writer that
 * drifts fails in CI and in production the same way.
 *
 * TS twin: src/lib/write-provenance.ts. tests/unit/write-provenance.test.ts asserts they agree.
 */
import { createHash } from 'crypto';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export const ENGINE_SCHEMA = 'gemini-engine/1';
export const NOT_RECORDED = 'not_recorded';
export const RECORDED_BY = 'scripts/lib/write-provenance.mjs';

/** SHA-256 truncated to 16 hex (64 bits) — the repo's content hash since translate-core. */
export const contentHash = (t) => createHash('sha256').update(t || '').digest('hex').slice(0, 16);

const HEX16 = /^[0-9a-f]{16}$/;

/**
 * Published defaults per model, from `GET /v1beta/models/<id>` on the date given. A request
 * that omits a setting runs with these — so the block records them, labelled as defaults.
 * Add a row by running the GET, never from memory; a model with no row is recorded as
 * unknown, which is the honest value.
 */
export const MODEL_DEFAULTS = {
  'gemini-3.1-flash-lite': { temperature: 1, top_p: 0.95, top_k: 64, max_output_tokens: 65536, thinking: 'dynamic', version: '3.1-flash-lite-05-2026', looked_up: '2026-09-28' },
  'gemini-3-flash-preview': { temperature: 1, top_p: 0.95, top_k: 64, max_output_tokens: 65536, thinking: 'dynamic', version: '3-flash-preview-12-2025', looked_up: '2026-09-28' },
  'gemini-2.5-flash': { temperature: 1, top_p: 0.95, top_k: 64, max_output_tokens: 65536, thinking: 'dynamic', version: '001', looked_up: '2026-09-28' },
};

/** The `ocr.source` / `translation.source` values a Gemini engine block is REQUIRED on. */
export const GEMINI_SOURCES = new Set(['ai', 'batch_api', 'pipeline_preview']);

export const notRecorded = (reason) => ({ status: NOT_RECORDED, reason: String(reason || '') });
export const isNotRecorded = (v) => v === NOT_RECORDED || (v && typeof v === 'object' && v.status === NOT_RECORDED);

let _codeVersion;
/** Short git sha of the running checkout; `not_recorded` when there is no git and no Vercel env. */
export async function codeVersion() {
  if (_codeVersion) return _codeVersion;
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD']);
    _codeVersion = stdout.trim() || null;
  } catch { _codeVersion = null; }
  if (!_codeVersion) _codeVersion = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 9) || NOT_RECORDED;
  return _codeVersion;
}

export const host = () => os.hostname();

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * The `generation` block: effective values, the verbatim request, and which effective values
 * came from the model's defaults rather than the request.
 * @param {string} model
 * @param {object} generationConfig — EXACTLY the object sent (`{}` if the call sent none).
 */
export function normalizeGeneration(model, generationConfig) {
  if (!generationConfig || typeof generationConfig !== 'object' || Array.isArray(generationConfig)) {
    throw new Error('write-provenance: pass the generationConfig object the call sent ({} if none) — the record is of what was sent, not what was meant');
  }
  const sent = JSON.parse(JSON.stringify(generationConfig));
  const d = MODEL_DEFAULTS[model];
  const defaulted = [];
  const pick = (sentKey, outKey) => {
    const v = num(sent[sentKey]);
    if (v !== undefined) return v;
    defaulted.push(outKey);
    return d ? d[outKey] : null;
  };
  const out = {
    temperature: pick('temperature', 'temperature'),
    top_p: pick('topP', 'top_p'),
    top_k: pick('topK', 'top_k'),
    max_output_tokens: pick('maxOutputTokens', 'max_output_tokens'),
  };
  const tc = sent.thinkingConfig;
  if (tc && num(tc.thinkingBudget) !== undefined) {
    out.thinking_budget = tc.thinkingBudget;
  } else if (tc && typeof tc.thinkingLevel === 'string') {
    out.thinking_budget = null;
    out.thinking_level = tc.thinkingLevel;
  } else {
    defaulted.push('thinking');
    out.thinking_budget = null;
    out.thinking = d ? `model_default_${d.thinking}` : null;
  }
  if (typeof sent.mediaResolution === 'string') out.media_resolution = sent.mediaResolution;
  else { defaulted.push('media_resolution'); out.media_resolution = 'model_default'; }
  out.sent = sent;
  out.defaulted = defaulted;
  out.defaults_source = defaulted.length === 0
    ? 'none_needed'
    : d ? `GET /v1beta/models/${model} ${d.looked_up}` : `${NOT_RECORDED}: no MODEL_DEFAULTS row for ${model}`;
  return out;
}

function modelVersion(model, response) {
  const fromResponse = response?.modelVersion || response?.raw?.modelVersion;
  if (typeof fromResponse === 'string' && fromResponse) return { model_version: fromResponse, model_version_source: 'response' };
  const d = MODEL_DEFAULTS[model];
  if (d) return { model_version: d.version, model_version_source: `GET /v1beta/models/${model} ${d.looked_up}` };
  return { model_version: null, model_version_source: NOT_RECORDED };
}

function promptBlock(prompt) {
  if (!prompt || typeof prompt !== 'object') throw new Error('write-provenance: `prompt` is required ({ id, name, version, hash, text } — `text` is the exact string sent)');
  const hasText = typeof prompt.text === 'string' && prompt.text.length > 0;
  const sentHash = hasText ? contentHash(prompt.text) : prompt.sent_hash;
  if (!hasText && !(HEX16.test(sentHash || '') || sentHash === NOT_RECORDED)) {
    throw new Error('write-provenance: prompt.text (the exact string sent) or prompt.sent_hash is required');
  }
  return {
    id: prompt.id != null ? String(prompt.id) : null,
    name: prompt.name ?? null,
    version: prompt.version != null ? String(prompt.version) : NOT_RECORDED,
    hash: prompt.hash ?? prompt.content_hash ?? null,
    sent_hash: sentHash,
    sent_chars: hasText ? prompt.text.length : (num(prompt.sent_chars) ?? null),
  };
}

/** `input` for an OCR read: the image the model saw. */
export function imageInput({ url, mime, bytes, resized_to_px } = {}) {
  if (!url || typeof url !== 'string') throw new Error('write-provenance: imageInput needs the image url that was fetched');
  const out = { image_url: url };
  if (mime) out.image_mime = mime;
  if (num(bytes) !== undefined) out.image_bytes = bytes;
  if (num(resized_to_px) !== undefined) out.resized_to_px = resized_to_px;
  return out;
}

/**
 * `input` for a translation: WHICH text was translated. `source_text_hash` is the OCR
 * `content_hash` the translator read, so a later re-OCR can be seen to orphan the English.
 * `context` names what else was in the prompt (previous translation, adjacent OCR, block).
 */
export function translationInput({ ocrText, ocrUpdatedAt, sourceField = 'ocr', context } = {}) {
  if (typeof ocrText !== 'string') throw new Error('write-provenance: translationInput needs the source text that was translated');
  const out = { source_field: sourceField, source_text_hash: contentHash(ocrText), source_text_chars: ocrText.length };
  if (ocrUpdatedAt) out.source_updated_at = ocrUpdatedAt;
  if (context && typeof context === 'object') out.context = context;
  return out;
}

function runBlock(run) {
  if (!run || typeof run !== 'object') throw new Error('write-provenance: `run` is required ({ code_version, host, job_id | batch_job_id })');
  const out = { ...run };
  if (!out.code_version) throw new Error('write-provenance: run.code_version is required (await codeVersion())');
  if (!out.host) throw new Error('write-provenance: run.host is required (host())');
  if (!out.at) out.at = new Date();
  return out;
}

/**
 * Build the engine block for a Gemini call that produced text.
 * @param {object} a
 * @param {string} a.call_site  repo-relative path of the writer, e.g. 'scripts/batch/realtime-ocr.mjs'
 * @param {'realtime'|'batch'} a.api
 * @param {string} a.model      the model id requested
 * @param {object} a.prompt     { id, name, version, hash, text } — text is the EXACT string sent
 * @param {object} a.generationConfig  the object sent ({} if none)
 * @param {object} a.run        { code_version, host, job_id?, batch_job_id?, at? }
 * @param {object} a.input      imageInput(...) | translationInput(...) | notRecorded(reason)
 * @param {object} [a.response] the raw API response (for `modelVersion`) when available
 */
export function geminiEngine({ call_site, api, model, prompt, generationConfig, run, input, response } = {}) {
  if (!call_site || typeof call_site !== 'string') throw new Error('write-provenance: call_site is required — name the writer');
  if (api !== 'realtime' && api !== 'batch') throw new Error(`write-provenance: api must be 'realtime' or 'batch' (got ${api})`);
  if (!model || typeof model !== 'string') throw new Error('write-provenance: model is required');
  if (!input || typeof input !== 'object') throw new Error('write-provenance: input is required (imageInput / translationInput / notRecorded)');
  return {
    schema: ENGINE_SCHEMA,
    name: 'gemini',
    model,
    ...modelVersion(model, response),
    api,
    call_site,
    prompt: promptBlock(prompt),
    // A writer completing a job submitted before the settings were kept passes the marker.
    generation: isNotRecorded(generationConfig) ? generationConfig : normalizeGeneration(model, generationConfig),
    run: runBlock(run),
    input,
    recorded_by: RECORDED_BY,
  };
}

/**
 * The half of a batch job's provenance that is known at SUBMISSION — stored on the
 * `batch_jobs` row as `provenance`, so the collector can complete it per page without
 * re-deriving anything. `prompt.text` here is the exact request text (before any per-page
 * prefix; a per-page prefix is recorded by the collector as `prompt.page_prefix_hash`).
 */
export function batchJobProvenance({ call_site, model, prompt, generationConfig, run, image_resized_to_px } = {}) {
  const e = geminiEngine({ call_site, api: 'batch', model, prompt, generationConfig, run, input: notRecorded('completed by the collector per page') });
  delete e.input;
  e.run.submitted_at = e.run.at;
  if (num(image_resized_to_px) !== undefined) e.image_resized_to_px = image_resized_to_px; // the collector copies it into each page's input
  return e;
}

/**
 * Complete a batch job's provenance into a page's engine block at collection time.
 * A job submitted before #4613 carries no `provenance`; its block says so explicitly rather
 * than inventing settings — see rule 3.
 */
export function engineFromBatchJob(job, { batch_job_id, input, collected_by, response, prompt_sent_hash, prompt_sent_chars, now = new Date() } = {}) {
  if (!input || typeof input !== 'object') throw new Error('write-provenance: engineFromBatchJob needs the page input');
  const id = batch_job_id || job?.id || (job?._id && String(job._id)) || NOT_RECORDED;
  if (job?.provenance?.schema === ENGINE_SCHEMA) {
    const { image_resized_to_px, ...p } = job.provenance;
    const pageInput = (num(image_resized_to_px) !== undefined && input.image_url && !('resized_to_px' in input)) ? { ...input, resized_to_px: image_resized_to_px } : input;
    // A cross-book job sends a per-book prompt (document context appended): the page's own
    // sent hash, recorded on the job's page_sources at submit, wins over the job-level one.
    const prompt = HEX16.test(prompt_sent_hash || '') ? { ...p.prompt, sent_hash: prompt_sent_hash, sent_chars: num(prompt_sent_chars) ?? null } : p.prompt;
    return {
      ...p,
      prompt,
      ...(response?.modelVersion ? { model_version: response.modelVersion, model_version_source: 'response' } : {}),
      run: { ...p.run, batch_job_id: id, collected_by: collected_by || NOT_RECORDED, collected_at: now },
      input: pageInput,
    };
  }
  const model = job?.model || NOT_RECORDED;
  return {
    schema: ENGINE_SCHEMA,
    name: 'gemini',
    model,
    ...modelVersion(model, response),
    api: 'batch',
    call_site: job?.submitted_by || collected_by || NOT_RECORDED,
    prompt: {
      id: job?.prompt_id != null ? String(job.prompt_id) : null,
      name: job?.prompt_name ?? null,
      version: job?.prompt_version != null ? String(job.prompt_version) : NOT_RECORDED,
      hash: job?.prompt_hash ?? null,
      sent_hash: NOT_RECORDED,
      sent_chars: null,
    },
    generation: notRecorded(`batch job ${id} was submitted before #4613 recorded generation settings`),
    run: {
      batch_job_id: id,
      code_version: job?.code_version || NOT_RECORDED,
      host: NOT_RECORDED,
      submitted_at: job?.created_at ?? null,
      collected_by: collected_by || NOT_RECORDED,
      collected_at: now,
      at: now,
    },
    input,
    recorded_by: RECORDED_BY,
  };
}

/**
 * The fields a writer spreads into `ocr` / `translation` beside `data`:
 * `{ content_hash, engine }`. Validates the block first — a writer cannot store a partial one.
 */
export function ocrProvenance(text, engine) {
  const m = missingProvenance('ocr', { data: text, source: 'ai', updated_at: new Date(), content_hash: contentHash(text), engine });
  if (m.missing.length) throw new Error(`write-provenance: OCR engine block incomplete — ${m.missing.join(', ')}`);
  return { content_hash: contentHash(text), engine };
}
export function translationProvenance(text, engine) {
  const m = missingProvenance('translation', { data: text, source: 'ai', updated_at: new Date(), content_hash: contentHash(text), engine });
  if (m.missing.length) throw new Error(`write-provenance: translation engine block incomplete — ${m.missing.join(', ')}`);
  return { content_hash: contentHash(text), engine };
}

/**
 * The checker. Given a page's `ocr` or `translation` subdocument, which required
 * provenance fields are MISSING, and which carry an explicit `not_recorded` marker?
 * Missing fails; a marker passes the default audit and fails `--strict`.
 *
 * Rules by `source`:
 *   Gemini (`ai`, `batch_api`, `pipeline_preview`): content_hash, updated_at, a
 *     `gemini-engine/1` block with model, api, call_site, prompt.version, prompt.sent_hash,
 *     generation (temperature, max_output_tokens, thinking), run.code_version, run.host, input
 *     (image_url for OCR, source_text_hash for translation).
 *   `kraken` / `bdrc`: content_hash, updated_at, engine.name/model/run.
 *   `ia_djvu`: content_hash, updated_at, source_url, ia.item, ia.ingest_run.
 *   anything else (manual, corpus, source-column, …): content_hash and updated_at only.
 * @returns {{ missing: string[], markers: string[] }}
 */
export function missingProvenance(field, sub) {
  const missing = [];
  const markers = [];
  const mark = (path, v) => { if (isNotRecorded(v)) markers.push(path); };
  if (!sub || typeof sub !== 'object') return { missing: [`${field}`], markers };
  if (!HEX16.test(sub.content_hash || '')) missing.push(`${field}.content_hash`);
  if (!(sub.updated_at instanceof Date) && !(typeof sub.updated_at === 'string' && sub.updated_at)) missing.push(`${field}.updated_at`);
  const src = sub.source;
  const e = sub.engine;
  if (GEMINI_SOURCES.has(src)) {
    if (!e || typeof e !== 'object') { missing.push(`${field}.engine`); return { missing, markers }; }
    // A restore of pre-#4613 text says so explicitly: a marker, not a gap.
    if (isNotRecorded(e)) { markers.push(`${field}.engine`); return { missing, markers }; }
    if (e.schema !== ENGINE_SCHEMA) missing.push(`${field}.engine.schema`);
    if (e.name !== 'gemini') missing.push(`${field}.engine.name`);
    if (!e.model) missing.push(`${field}.engine.model`);
    if (e.api !== 'realtime' && e.api !== 'batch') missing.push(`${field}.engine.api`);
    if (!e.call_site || e.call_site === NOT_RECORDED) missing.push(`${field}.engine.call_site`);
    else mark(`${field}.engine.call_site`, e.call_site);
    if (!e.prompt || typeof e.prompt !== 'object') missing.push(`${field}.engine.prompt`);
    else {
      if (!e.prompt.version) missing.push(`${field}.engine.prompt.version`); else mark(`${field}.engine.prompt.version`, e.prompt.version);
      if (!(HEX16.test(e.prompt.sent_hash || '') || e.prompt.sent_hash === NOT_RECORDED)) missing.push(`${field}.engine.prompt.sent_hash`);
      else mark(`${field}.engine.prompt.sent_hash`, e.prompt.sent_hash);
    }
    const g = e.generation;
    if (!g || typeof g !== 'object') missing.push(`${field}.engine.generation`);
    else if (isNotRecorded(g)) markers.push(`${field}.engine.generation`);
    else {
      if (!('temperature' in g)) missing.push(`${field}.engine.generation.temperature`);
      else if (g.temperature === null && !String(g.defaults_source || '').startsWith(NOT_RECORDED)) missing.push(`${field}.engine.generation.temperature`);
      else if (g.temperature === null) markers.push(`${field}.engine.generation.temperature`);
      if (!('max_output_tokens' in g)) missing.push(`${field}.engine.generation.max_output_tokens`);
      if (!('thinking_budget' in g)) missing.push(`${field}.engine.generation.thinking_budget`);
      if (!g.sent || typeof g.sent !== 'object') missing.push(`${field}.engine.generation.sent`);
      if (!Array.isArray(g.defaulted)) missing.push(`${field}.engine.generation.defaulted`);
    }
    const r = e.run;
    if (!r || typeof r !== 'object') missing.push(`${field}.engine.run`);
    else {
      if (!r.code_version) missing.push(`${field}.engine.run.code_version`); else mark(`${field}.engine.run.code_version`, r.code_version);
      if (!r.host) missing.push(`${field}.engine.run.host`); else mark(`${field}.engine.run.host`, r.host);
      if (e.api === 'batch' && !r.batch_job_id) missing.push(`${field}.engine.run.batch_job_id`);
    }
    const i = e.input;
    if (!i || typeof i !== 'object') missing.push(`${field}.engine.input`);
    else if (isNotRecorded(i)) markers.push(`${field}.engine.input`);
    else if (field === 'ocr' && !i.image_url) missing.push(`${field}.engine.input.image_url`);
    else if (field === 'translation' && !HEX16.test(i.source_text_hash || '')) missing.push(`${field}.engine.input.source_text_hash`);
  } else if (src === 'kraken' || src === 'bdrc') {
    if (!e || typeof e !== 'object') missing.push(`${field}.engine`);
    else {
      if (!e.name) missing.push(`${field}.engine.name`);
      if (!e.model) missing.push(`${field}.engine.model`);
      if (!e.run) missing.push(`${field}.engine.run`);
    }
  } else if (src === 'ia_djvu') {
    if (!sub.source_url) missing.push(`${field}.source_url`);
    if (!sub.ia || typeof sub.ia !== 'object') missing.push(`${field}.ia`);
    else {
      if (!sub.ia.item) missing.push(`${field}.ia.item`);
      if (!sub.ia.ingest_run) missing.push(`${field}.ia.ingest_run`);
    }
  }
  return { missing, markers };
}

// ── Rows written before the writers went live ─────────────────────────────────
//
// Nothing was recorded on them, and nothing is backfilled (decided, #4613). But the settings
// were CONSTANTS in code, and git dates the constants, so for many rows the settings can be
// INFERRED from `source` + `updated_at` (+ whether `code_version` was stamped, which is what
// separates the Lambda `ai` writer from the realtime scripts after 2026-06-01). The table is
// scripts/lib/provenance-history.json; this reads it. The result is labelled `inferred` and
// names its rule and basis — a measurement that segments page_revisions by generation settings
// can use it, a reader can be shown it, and nobody can mistake it for an observation.
//
// A row the table cannot place (writer ambiguous, or before any dated constant) comes back
// `not_recorded` with the reason. Never write the returned value onto a page as `engine`.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

let _history;
export function provenanceHistory() {
  if (!_history) _history = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'provenance-history.json'), 'utf8'));
  return _history;
}

/**
 * @param {'ocr'|'translation'} field
 * @param {object} sub  the page's ocr / translation subdocument (source, updated_at, code_version, engine)
 * @returns {{ status: 'observed' } | { status: 'inferred', rule, writer, generation, basis, caveat } | { status: 'not_recorded', reason }}
 */
export function inferHistoricalGeneration(field, sub) {
  if (!sub || typeof sub !== 'object') return notRecorded('no subdocument');
  if (sub.engine?.schema === ENGINE_SCHEMA) return { status: 'observed' };
  const at = sub.updated_at instanceof Date ? sub.updated_at : (sub.updated_at ? new Date(sub.updated_at) : null);
  if (!at || Number.isNaN(at.getTime())) return notRecorded('no updated_at to place the row in time');
  const hasCodeVersion = typeof sub.code_version === 'string' && sub.code_version.length > 0;
  for (const r of provenanceHistory().rules) {
    if (r.field !== field) continue;
    const w = r.when || {};
    if (w.source && !w.source.includes(sub.source)) continue;
    if (w.code_version === 'present' && !hasCodeVersion) continue;
    if (w.code_version === 'absent' && hasCodeVersion) continue;
    if (w.from && at < new Date(w.from)) continue;
    if (w.to && at >= new Date(w.to)) continue;
    if (!r.generation) return notRecorded(`${r.id}: ${r.writer}`);
    return { status: 'inferred', rule: r.id, writer: r.writer, generation: r.generation, basis: r.basis, caveat: r.caveat ?? null };
  }
  return notRecorded(`no dated rule covers ${field} source=${sub.source ?? 'none'} at ${at.toISOString()}`);
}
