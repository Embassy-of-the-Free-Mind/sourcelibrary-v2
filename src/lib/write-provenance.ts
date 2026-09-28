/**
 * PRIOR ART: scripts/lib/write-provenance.mjs — this is its TypeScript twin for the src/
 * writers (src/lib/translate-write.ts, src/workers/*). Same shape, same rules, same checker;
 * tests/unit/write-provenance.test.ts asserts the two agree. Read the .mjs header for the why.
 *
 * The one builder every Gemini writer of `pages.ocr` / `pages.translation` goes through to
 * record what produced the text (#4613): engine + model, the prompt BY CONTENT, the generation
 * settings actually sent, the run, the input, and a content hash of the output.
 */
import { createHash } from 'crypto';
import os from 'os';

export const ENGINE_SCHEMA = 'gemini-engine/1';
export const NOT_RECORDED = 'not_recorded';
export const RECORDED_BY = 'src/lib/write-provenance.ts';

export const contentHash = (t: string | null | undefined): string =>
  createHash('sha256').update(t || '').digest('hex').slice(0, 16);

const HEX16 = /^[0-9a-f]{16}$/;

export interface ModelDefaults {
  temperature: number; top_p: number; top_k: number; max_output_tokens: number;
  thinking: string; version: string; looked_up: string;
}
/** From `GET /v1beta/models/<id>` on `looked_up`. Add a row by running the GET, never from memory. */
export const MODEL_DEFAULTS: Record<string, ModelDefaults> = {
  'gemini-3.1-flash-lite': { temperature: 1, top_p: 0.95, top_k: 64, max_output_tokens: 65536, thinking: 'dynamic', version: '3.1-flash-lite-05-2026', looked_up: '2026-09-28' },
  'gemini-3-flash-preview': { temperature: 1, top_p: 0.95, top_k: 64, max_output_tokens: 65536, thinking: 'dynamic', version: '3-flash-preview-12-2025', looked_up: '2026-09-28' },
  'gemini-2.5-flash': { temperature: 1, top_p: 0.95, top_k: 64, max_output_tokens: 65536, thinking: 'dynamic', version: '001', looked_up: '2026-09-28' },
};

export const GEMINI_SOURCES = new Set(['ai', 'batch_api', 'pipeline_preview']);

export interface NotRecorded { status: typeof NOT_RECORDED; reason: string }
export const notRecorded = (reason: string): NotRecorded => ({ status: NOT_RECORDED, reason: String(reason || '') });
export const isNotRecorded = (v: unknown): boolean =>
  v === NOT_RECORDED || (!!v && typeof v === 'object' && (v as { status?: string }).status === NOT_RECORDED);

/** On Vercel there is no git; the deploy sha is in the env. */
export function codeVersion(): string {
  return process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 9) || process.env.CODE_VERSION || NOT_RECORDED;
}
export const host = (): string => process.env.VERCEL_REGION ? `vercel:${process.env.VERCEL_REGION}` : os.hostname();

export interface GenerationBlock {
  temperature: number | null; top_p: number | null; top_k: number | null; max_output_tokens: number | null;
  thinking_budget: number | null; thinking_level?: string; thinking?: string | null; media_resolution: string;
  sent: Record<string, unknown>; defaulted: string[]; defaults_source: string;
}
export interface PromptBlock { id: string | null; name: string | null; version: string; hash: string | null; sent_hash: string; sent_chars: number | null }
export interface RunBlock { code_version: string; host: string; at: Date; job_id?: string; batch_job_id?: string; submitted_at?: Date | null; collected_by?: string; collected_at?: Date; [k: string]: unknown }
export interface ImageInput { image_url: string; image_mime?: string; image_bytes?: number; resized_to_px?: number }
export interface TranslationInput { source_field: string; source_text_hash: string; source_text_chars: number; source_updated_at?: Date; context?: Record<string, unknown> }
export interface GeminiEngine {
  schema: typeof ENGINE_SCHEMA; name: 'gemini'; model: string;
  model_version: string | null; model_version_source: string;
  api: 'realtime' | 'batch'; call_site: string;
  prompt: PromptBlock; generation: GenerationBlock | NotRecorded; run: RunBlock;
  input: ImageInput | TranslationInput | NotRecorded; recorded_by: string;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export function normalizeGeneration(model: string, generationConfig: Record<string, unknown>): GenerationBlock {
  if (!generationConfig || typeof generationConfig !== 'object' || Array.isArray(generationConfig)) {
    throw new Error('write-provenance: pass the generationConfig object the call sent ({} if none) — the record is of what was sent, not what was meant');
  }
  const sent = JSON.parse(JSON.stringify(generationConfig)) as Record<string, unknown>;
  const d = MODEL_DEFAULTS[model];
  const defaulted: string[] = [];
  const pick = (sentKey: string, outKey: keyof ModelDefaults): number | null => {
    const v = num(sent[sentKey]);
    if (v !== undefined) return v;
    defaulted.push(outKey);
    return d ? (d[outKey] as number) : null;
  };
  const out: GenerationBlock = {
    temperature: pick('temperature', 'temperature'),
    top_p: pick('topP', 'top_p'),
    top_k: pick('topK', 'top_k'),
    max_output_tokens: pick('maxOutputTokens', 'max_output_tokens'),
    thinking_budget: null,
    media_resolution: 'model_default',
    sent, defaulted, defaults_source: '',
  };
  const tc = sent.thinkingConfig as { thinkingBudget?: unknown; thinkingLevel?: unknown } | undefined;
  if (tc && num(tc.thinkingBudget) !== undefined) {
    out.thinking_budget = tc.thinkingBudget as number;
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
  out.defaults_source = defaulted.length === 0
    ? 'none_needed'
    : d ? `GET /v1beta/models/${model} ${d.looked_up}` : `${NOT_RECORDED}: no MODEL_DEFAULTS row for ${model}`;
  return out;
}

function modelVersion(model: string, response?: { modelVersion?: string; raw?: { modelVersion?: string } }) {
  const fromResponse = response?.modelVersion || response?.raw?.modelVersion;
  if (typeof fromResponse === 'string' && fromResponse) return { model_version: fromResponse, model_version_source: 'response' };
  const d = MODEL_DEFAULTS[model];
  if (d) return { model_version: d.version, model_version_source: `GET /v1beta/models/${model} ${d.looked_up}` };
  return { model_version: null, model_version_source: NOT_RECORDED };
}

export interface PromptArg { id?: string | null; name?: string | null; version?: string | number | null; hash?: string | null; content_hash?: string | null; text?: string; sent_hash?: string; sent_chars?: number }
function promptBlock(prompt: PromptArg | undefined): PromptBlock {
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
    sent_hash: sentHash as string,
    sent_chars: hasText ? (prompt.text as string).length : (num(prompt.sent_chars) ?? null),
  };
}

export function imageInput({ url, mime, bytes, resized_to_px }: { url: string; mime?: string; bytes?: number; resized_to_px?: number }): ImageInput {
  if (!url || typeof url !== 'string') throw new Error('write-provenance: imageInput needs the image url that was fetched');
  const out: ImageInput = { image_url: url };
  if (mime) out.image_mime = mime;
  if (num(bytes) !== undefined) out.image_bytes = bytes;
  if (num(resized_to_px) !== undefined) out.resized_to_px = resized_to_px;
  return out;
}

export function translationInput({ ocrText, ocrUpdatedAt, sourceField = 'ocr', context }: { ocrText: string; ocrUpdatedAt?: Date; sourceField?: string; context?: Record<string, unknown> }): TranslationInput {
  if (typeof ocrText !== 'string') throw new Error('write-provenance: translationInput needs the source text that was translated');
  const out: TranslationInput = { source_field: sourceField, source_text_hash: contentHash(ocrText), source_text_chars: ocrText.length };
  if (ocrUpdatedAt) out.source_updated_at = ocrUpdatedAt;
  if (context && typeof context === 'object') out.context = context;
  return out;
}

function runBlock(run: Partial<RunBlock> | undefined): RunBlock {
  if (!run || typeof run !== 'object') throw new Error('write-provenance: `run` is required ({ code_version, host, job_id | batch_job_id })');
  const out = { ...run } as RunBlock;
  if (!out.code_version) throw new Error('write-provenance: run.code_version is required (codeVersion())');
  if (!out.host) throw new Error('write-provenance: run.host is required (host())');
  if (!out.at) out.at = new Date();
  return out;
}

export interface GeminiEngineArgs {
  call_site: string; api: 'realtime' | 'batch'; model: string; prompt: PromptArg;
  generationConfig: Record<string, unknown> | NotRecorded; run: Partial<RunBlock>;
  input: ImageInput | TranslationInput | NotRecorded; response?: { modelVersion?: string; raw?: { modelVersion?: string } };
}
export function geminiEngine({ call_site, api, model, prompt, generationConfig, run, input, response }: GeminiEngineArgs): GeminiEngine {
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
    generation: isNotRecorded(generationConfig) ? (generationConfig as NotRecorded) : normalizeGeneration(model, generationConfig as Record<string, unknown>),
    run: runBlock(run),
    input,
    recorded_by: RECORDED_BY,
  };
}

export type BatchJobProvenance = Omit<GeminiEngine, 'input'> & { image_resized_to_px?: number };
export function batchJobProvenance({ call_site, model, prompt, generationConfig, run, image_resized_to_px }: Omit<GeminiEngineArgs, 'api' | 'input'> & { image_resized_to_px?: number }): BatchJobProvenance {
  const e = geminiEngine({ call_site, api: 'batch', model, prompt, generationConfig, run, input: notRecorded('completed by the collector per page') });
  const { input: _input, ...rest } = e;
  void _input;
  rest.run.submitted_at = rest.run.at;
  const out: BatchJobProvenance = rest;
  if (num(image_resized_to_px) !== undefined) out.image_resized_to_px = image_resized_to_px; // the collector copies it into each page's input
  return out;
}

export interface BatchJobLike {
  id?: string; _id?: unknown; model?: string; prompt_id?: string | null; prompt_name?: string | null;
  prompt_version?: string | number | null; prompt_hash?: string | null; code_version?: string;
  created_at?: Date; submitted_by?: string; provenance?: BatchJobProvenance;
}
export function engineFromBatchJob(job: BatchJobLike, { batch_job_id, input, collected_by, response, prompt_sent_hash, prompt_sent_chars, now = new Date() }: { batch_job_id?: string; input: ImageInput | TranslationInput | NotRecorded; collected_by?: string; response?: { modelVersion?: string }; prompt_sent_hash?: string; prompt_sent_chars?: number; now?: Date }): GeminiEngine {
  if (!input || typeof input !== 'object') throw new Error('write-provenance: engineFromBatchJob needs the page input');
  const id = batch_job_id || job?.id || (job?._id != null ? String(job._id) : undefined) || NOT_RECORDED;
  if (job?.provenance?.schema === ENGINE_SCHEMA) {
    const { image_resized_to_px, ...p } = job.provenance;
    const img = input as ImageInput;
    const pageInput = (num(image_resized_to_px) !== undefined && img.image_url && !('resized_to_px' in img)) ? { ...img, resized_to_px: image_resized_to_px as number } : input;
    // A cross-book job sends a per-book prompt (document context appended): the page's own
    // sent hash, recorded on the job's page_sources at submit, wins over the job-level one.
    const prompt = HEX16.test(prompt_sent_hash || '') ? { ...p.prompt, sent_hash: prompt_sent_hash as string, sent_chars: num(prompt_sent_chars) ?? null } : p.prompt;
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
    ...modelVersion(model),
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

export function ocrProvenance(text: string, engine: GeminiEngine): { content_hash: string; engine: GeminiEngine } {
  const m = missingProvenance('ocr', { data: text, source: 'ai', updated_at: new Date(), content_hash: contentHash(text), engine });
  if (m.missing.length) throw new Error(`write-provenance: OCR engine block incomplete — ${m.missing.join(', ')}`);
  return { content_hash: contentHash(text), engine };
}
export function translationProvenance(text: string, engine: GeminiEngine): { content_hash: string; engine: GeminiEngine } {
  const m = missingProvenance('translation', { data: text, source: 'ai', updated_at: new Date(), content_hash: contentHash(text), engine });
  if (m.missing.length) throw new Error(`write-provenance: translation engine block incomplete — ${m.missing.join(', ')}`);
  return { content_hash: contentHash(text), engine };
}

type AnyRecord = Record<string, unknown>;
const obj = (v: unknown): AnyRecord | null => (v && typeof v === 'object' ? (v as AnyRecord) : null);

/** The checker — see the .mjs twin for the rules by `source`. */
export function missingProvenance(field: 'ocr' | 'translation', sub: unknown): { missing: string[]; markers: string[] } {
  const missing: string[] = [];
  const markers: string[] = [];
  const mark = (path: string, v: unknown) => { if (isNotRecorded(v)) markers.push(path); };
  const s = obj(sub);
  if (!s) return { missing: [field], markers };
  if (!HEX16.test((s.content_hash as string) || '')) missing.push(`${field}.content_hash`);
  if (!(s.updated_at instanceof Date) && !(typeof s.updated_at === 'string' && s.updated_at)) missing.push(`${field}.updated_at`);
  const src = s.source as string | undefined;
  const e = obj(s.engine);
  if (src && GEMINI_SOURCES.has(src)) {
    if (!e) { missing.push(`${field}.engine`); return { missing, markers }; }
    // A restore of pre-#4613 text says so explicitly: a marker, not a gap.
    if (isNotRecorded(e)) { markers.push(`${field}.engine`); return { missing, markers }; }
    if (e.schema !== ENGINE_SCHEMA) missing.push(`${field}.engine.schema`);
    if (e.name !== 'gemini') missing.push(`${field}.engine.name`);
    if (!e.model) missing.push(`${field}.engine.model`);
    if (e.api !== 'realtime' && e.api !== 'batch') missing.push(`${field}.engine.api`);
    if (!e.call_site || e.call_site === NOT_RECORDED) missing.push(`${field}.engine.call_site`);
    else mark(`${field}.engine.call_site`, e.call_site);
    const p = obj(e.prompt);
    if (!p) missing.push(`${field}.engine.prompt`);
    else {
      if (!p.version) missing.push(`${field}.engine.prompt.version`); else mark(`${field}.engine.prompt.version`, p.version);
      if (!(HEX16.test((p.sent_hash as string) || '') || p.sent_hash === NOT_RECORDED)) missing.push(`${field}.engine.prompt.sent_hash`);
      else mark(`${field}.engine.prompt.sent_hash`, p.sent_hash);
    }
    const g = obj(e.generation);
    if (!g) missing.push(`${field}.engine.generation`);
    else if (isNotRecorded(g)) markers.push(`${field}.engine.generation`);
    else {
      if (!('temperature' in g)) missing.push(`${field}.engine.generation.temperature`);
      else if (g.temperature === null && !String(g.defaults_source || '').startsWith(NOT_RECORDED)) missing.push(`${field}.engine.generation.temperature`);
      else if (g.temperature === null) markers.push(`${field}.engine.generation.temperature`);
      if (!('max_output_tokens' in g)) missing.push(`${field}.engine.generation.max_output_tokens`);
      if (!('thinking_budget' in g)) missing.push(`${field}.engine.generation.thinking_budget`);
      if (!obj(g.sent)) missing.push(`${field}.engine.generation.sent`);
      if (!Array.isArray(g.defaulted)) missing.push(`${field}.engine.generation.defaulted`);
    }
    const r = obj(e.run);
    if (!r) missing.push(`${field}.engine.run`);
    else {
      if (!r.code_version) missing.push(`${field}.engine.run.code_version`); else mark(`${field}.engine.run.code_version`, r.code_version);
      if (!r.host) missing.push(`${field}.engine.run.host`); else mark(`${field}.engine.run.host`, r.host);
      if (e.api === 'batch' && !r.batch_job_id) missing.push(`${field}.engine.run.batch_job_id`);
    }
    const i = obj(e.input);
    if (!i) missing.push(`${field}.engine.input`);
    else if (isNotRecorded(i)) markers.push(`${field}.engine.input`);
    else if (field === 'ocr' && !i.image_url) missing.push(`${field}.engine.input.image_url`);
    else if (field === 'translation' && !HEX16.test((i.source_text_hash as string) || '')) missing.push(`${field}.engine.input.source_text_hash`);
  } else if (src === 'kraken' || src === 'bdrc') {
    if (!e) missing.push(`${field}.engine`);
    else {
      if (!e.name) missing.push(`${field}.engine.name`);
      if (!e.model) missing.push(`${field}.engine.model`);
      if (!e.run) missing.push(`${field}.engine.run`);
    }
  } else if (src === 'ia_djvu') {
    if (!s.source_url) missing.push(`${field}.source_url`);
    const ia = obj(s.ia);
    if (!ia) missing.push(`${field}.ia`);
    else {
      if (!ia.item) missing.push(`${field}.ia.item`);
      if (!ia.ingest_run) missing.push(`${field}.ia.ingest_run`);
    }
  }
  return { missing, markers };
}
