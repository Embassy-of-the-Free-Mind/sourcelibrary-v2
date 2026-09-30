import { describe, it, expect } from 'vitest';
import * as mjs from '../../scripts/lib/write-provenance.mjs';
import * as ts from '@/lib/write-provenance';

/**
 * The provenance builder (#4613): what every Gemini writer of pages.ocr / pages.translation
 * stamps, and the checker the standing audit runs. Three properties are pinned:
 *
 *   1. It records what was SENT, fills the model's published defaults for what was not, and
 *      NAMES the defaults — an unset temperature is 1.0 with `defaulted: ['temperature']`,
 *      not silence; an unknown model is `null` with a `not_recorded` source, never a guess.
 *   2. The prompt is identified by the hash of the exact text sent, separately from the
 *      stored template's hash.
 *   3. A writer cannot produce a partial record: the builder throws, and the checker flags
 *      a block with any required field removed (this is the "prove it red" step).
 *
 * And the .mjs and .ts twins agree on all of it.
 */

const FIXED = { code_version: 'abc1234', host: 'test-host', at: new Date('2026-09-28T12:00:00Z') };

const ocrArgs = () => ({
  call_site: 'scripts/batch/realtime-ocr.mjs',
  api: 'realtime' as const,
  model: 'gemini-3.1-flash-lite',
  prompt: { id: '6a98b8a0', name: 'Standard OCR', version: 16, hash: '0203c2641e253ffbf17772ae1b30bf16', text: 'Transcribe this page. **Source language:** Detect it.' },
  generationConfig: { temperature: 0.1, maxOutputTokens: 16384, thinkingConfig: { thinkingBudget: 0 } },
  run: { ...FIXED, job_id: 'run-1' },
  input: mjs.imageInput({ url: 'https://images.sourcelibrary.org/archived/b1/3.jpg', mime: 'image/jpeg', bytes: 123456 }),
});

describe('geminiEngine records what was sent and names what was defaulted', () => {
  it('explicit settings are recorded verbatim, defaults are named', () => {
    const e = mjs.geminiEngine(ocrArgs());
    expect(e.schema).toBe('gemini-engine/1');
    expect(e.name).toBe('gemini');
    expect(e.call_site).toBe('scripts/batch/realtime-ocr.mjs');
    expect(e.generation.temperature).toBe(0.1);
    expect(e.generation.max_output_tokens).toBe(16384);
    expect(e.generation.thinking_budget).toBe(0);
    expect(e.generation.sent).toEqual({ temperature: 0.1, maxOutputTokens: 16384, thinkingConfig: { thinkingBudget: 0 } });
    // topP/topK were not sent: the model's published defaults, and SAID to be defaults.
    expect(e.generation.top_p).toBe(0.95);
    expect(e.generation.top_k).toBe(64);
    expect(e.generation.defaulted).toEqual(['top_p', 'top_k', 'media_resolution']);
    expect(e.generation.defaults_source).toMatch(/^GET \/v1beta\/models\/gemini-3\.1-flash-lite 2026-/);
    expect(e.model_version).toBe('3.1-flash-lite-05-2026');
  });

  it('an unset temperature is the model default 1.0, named — the Lambda-at-1.0 lesson (#4581)', () => {
    const e = mjs.geminiEngine({ ...ocrArgs(), generationConfig: { maxOutputTokens: 4096, thinkingConfig: { thinkingBudget: 0 } } });
    expect(e.generation.temperature).toBe(1);
    expect(e.generation.defaulted).toContain('temperature');
  });

  it('thinking left to the model is recorded as the model default, not as zero', () => {
    const e = mjs.geminiEngine({ ...ocrArgs(), generationConfig: {} });
    expect(e.generation.thinking_budget).toBeNull();
    expect(e.generation.thinking).toBe('model_default_dynamic');
    expect(e.generation.defaulted).toContain('thinking');
  });

  it('an unknown model gets null and a not_recorded source — never a guessed number', () => {
    const e = mjs.geminiEngine({ ...ocrArgs(), model: 'gemini-9-ultra', generationConfig: { maxOutputTokens: 100 } });
    expect(e.generation.temperature).toBeNull();
    expect(e.generation.top_p).toBeNull();
    expect(e.generation.defaults_source).toMatch(/^not_recorded/);
    expect(e.model_version).toBeNull();
    expect(e.model_version_source).toBe('not_recorded');
  });

  it('the served model version comes from the response when the API returned it', () => {
    const e = mjs.geminiEngine({ ...ocrArgs(), response: { modelVersion: 'gemini-3.1-flash-lite-002' } });
    expect(e.model_version).toBe('gemini-3.1-flash-lite-002');
    expect(e.model_version_source).toBe('response');
  });
});

describe('the prompt is identified by the text sent', () => {
  it('sent_hash is the hash of the exact prompt string and differs from the template hash', () => {
    const a = ocrArgs();
    const e = mjs.geminiEngine(a);
    expect(e.prompt.sent_hash).toBe(mjs.contentHash(a.prompt.text));
    expect(e.prompt.sent_hash).toMatch(/^[0-9a-f]{16}$/);
    expect(e.prompt.hash).toBe('0203c2641e253ffbf17772ae1b30bf16');
    expect(e.prompt.sent_hash).not.toBe(e.prompt.hash);
    expect(e.prompt.version).toBe('16');
    expect(e.prompt.sent_chars).toBe(a.prompt.text.length);
    // A different prefix on the same template is a different prompt.
    const e2 = mjs.geminiEngine({ ...a, prompt: { ...a.prompt, text: 'SPREAD PREFIX\n' + a.prompt.text } });
    expect(e2.prompt.sent_hash).not.toBe(e.prompt.sent_hash);
    expect(e2.prompt.hash).toBe(e.prompt.hash);
  });
});

describe('a translation records which OCR text it translated', () => {
  it('translationInput carries the source text hash, length and context', () => {
    const ocr = '<page-type>text</page-type>\nLorem ipsum';
    const i = mjs.translationInput({ ocrText: ocr, ocrUpdatedAt: new Date('2026-09-01'), context: { previous_translation: true, prev_ocr: true, next_ocr: false, block: { pages: 5, index: 2 } } });
    expect(i.source_text_hash).toBe(mjs.contentHash(ocr));
    expect(i.source_text_chars).toBe(ocr.length);
    expect(i.source_field).toBe('ocr');
    expect(i.context?.block).toEqual({ pages: 5, index: 2 });
  });
});

describe('a writer cannot store a partial record', () => {
  it('the builder refuses a missing call_site, generationConfig, input, run or prompt', () => {
    const a = ocrArgs();
    expect(() => mjs.geminiEngine({ ...a, call_site: undefined as unknown as string })).toThrow(/call_site/);
    expect(() => mjs.geminiEngine({ ...a, generationConfig: undefined as unknown as Record<string, unknown> })).toThrow(/generationConfig/);
    expect(() => mjs.geminiEngine({ ...a, input: undefined as unknown as ReturnType<typeof mjs.imageInput> })).toThrow(/input/);
    expect(() => mjs.geminiEngine({ ...a, run: { host: 'h' } })).toThrow(/code_version/);
    expect(() => mjs.geminiEngine({ ...a, prompt: { id: 'x', version: 1 } })).toThrow(/prompt\.text/);
    expect(() => mjs.geminiEngine({ ...a, api: 'lambda' as unknown as 'realtime' })).toThrow(/api/);
  });

  it('ocrProvenance / translationProvenance validate before returning the fields to spread', () => {
    const e = mjs.geminiEngine(ocrArgs());
    const f = mjs.ocrProvenance('some text', e);
    expect(f.content_hash).toBe(mjs.contentHash('some text'));
    expect(f.engine).toBe(e);
    // a translation needs a source_text_hash input, an image is not enough
    expect(() => mjs.translationProvenance('english', e)).toThrow(/source_text_hash/);
  });
});

describe('the checker (missingProvenance) — proven red', () => {
  const page = (over: Record<string, unknown> = {}) => ({
    data: 'text', source: 'ai', updated_at: new Date(), content_hash: mjs.contentHash('text'), engine: mjs.geminiEngine(ocrArgs()), ...over,
  });

  it('a complete Gemini record passes with no missing fields and no markers', () => {
    expect(mjs.missingProvenance('ocr', page())).toEqual({ missing: [], markers: [] });
  });

  it.each([
    ['engine.generation', (p: Record<string, unknown>) => { delete (p.engine as Record<string, unknown>).generation; }, 'ocr.engine.generation'],
    ['engine.generation.temperature', (p: Record<string, unknown>) => { delete ((p.engine as Record<string, unknown>).generation as Record<string, unknown>).temperature; }, 'ocr.engine.generation.temperature'],
    ['engine.run.host', (p: Record<string, unknown>) => { delete ((p.engine as Record<string, unknown>).run as Record<string, unknown>).host; }, 'ocr.engine.run.host'],
    ['engine.call_site', (p: Record<string, unknown>) => { delete (p.engine as Record<string, unknown>).call_site; }, 'ocr.engine.call_site'],
    ['engine.prompt.sent_hash', (p: Record<string, unknown>) => { delete ((p.engine as Record<string, unknown>).prompt as Record<string, unknown>).sent_hash; }, 'ocr.engine.prompt.sent_hash'],
    ['engine.input.image_url', (p: Record<string, unknown>) => { delete ((p.engine as Record<string, unknown>).input as Record<string, unknown>).image_url; }, 'ocr.engine.input.image_url'],
    ['content_hash', (p: Record<string, unknown>) => { delete p.content_hash; }, 'ocr.content_hash'],
    ['engine (whole block)', (p: Record<string, unknown>) => { delete p.engine; }, 'ocr.engine'],
  ])('removing %s from a Gemini page is MISSING', (_label, mutate, expected) => {
    const p = JSON.parse(JSON.stringify(page()));
    p.updated_at = new Date();
    mutate(p);
    expect(mjs.missingProvenance('ocr', p).missing).toContain(expected);
  });

  it('a temperature that is null WITH a not_recorded source is a marker, null WITHOUT one is missing', () => {
    const p = JSON.parse(JSON.stringify(page()));
    p.updated_at = new Date();
    p.engine.generation.temperature = null;
    expect(mjs.missingProvenance('ocr', p).missing).toContain('ocr.engine.generation.temperature');
    p.engine.generation.defaults_source = 'not_recorded: no MODEL_DEFAULTS row for x';
    const r = mjs.missingProvenance('ocr', p);
    expect(r.missing).toEqual([]);
    expect(r.markers).toContain('ocr.engine.generation.temperature');
  });

  it('a restore of pre-#4613 text carries an explicit engine marker — a marker, not a gap', () => {
    const p = { data: 't', source: 'ai', updated_at: new Date(), content_hash: mjs.contentHash('t'), engine: mjs.notRecorded('restored from a page_revisions row written before #4613') };
    expect(mjs.missingProvenance('translation', p)).toEqual({ missing: [], markers: ['translation.engine'] });
    expect(ts.missingProvenance('translation', p)).toEqual({ missing: [], markers: ['translation.engine'] });
  });

  it('a translation must carry the OCR text hash it was made from', () => {
    const e = mjs.geminiEngine({ ...ocrArgs(), call_site: 'scripts/workers/translate-worker.mjs', input: mjs.translationInput({ ocrText: 'lorem' }) });
    const ok = { data: 'english', source: 'ai', updated_at: new Date(), content_hash: mjs.contentHash('english'), engine: e };
    expect(mjs.missingProvenance('translation', ok).missing).toEqual([]);
    const bad = JSON.parse(JSON.stringify(ok)); bad.updated_at = new Date(); delete bad.engine.input.source_text_hash;
    expect(mjs.missingProvenance('translation', bad).missing).toContain('translation.engine.input.source_text_hash');
  });

  it('a legacy batch job (submitted before #4613) collects into markers, not gaps', () => {
    const job = { id: 'job-1', model: 'gemini-3.1-flash-lite', prompt_id: 'p', prompt_name: 'Standard OCR', prompt_version: '16', prompt_hash: 'h', code_version: 'd45e716', created_at: new Date('2026-09-27') };
    const e = mjs.engineFromBatchJob(job, { input: mjs.imageInput({ url: 'https://x/1.jpg' }), collected_by: 'scripts/workers/batch-collector.mjs' });
    const r = mjs.missingProvenance('ocr', { data: 't', source: 'batch_api', updated_at: new Date(), content_hash: mjs.contentHash('t'), engine: e });
    expect(r.missing).toEqual([]);
    expect(r.markers).toEqual(expect.arrayContaining(['ocr.engine.prompt.sent_hash', 'ocr.engine.generation', 'ocr.engine.run.host']));
    expect(e.run.batch_job_id).toBe('job-1');
    expect(e.generation).toEqual({ status: 'not_recorded', reason: expect.stringContaining('before #4613') });
  });

  it('a batch job with stored provenance completes into a full record', () => {
    const prov = mjs.batchJobProvenance({ call_site: 'scripts/workers/pipeline-orchestrator.mjs', model: 'gemini-3.1-flash-lite', prompt: ocrArgs().prompt, generationConfig: { temperature: 0.1, maxOutputTokens: 16384, thinkingConfig: { thinkingBudget: 0 } }, run: FIXED });
    expect(prov).not.toHaveProperty('input');
    expect(prov.run.submitted_at).toEqual(FIXED.at);
    const e = mjs.engineFromBatchJob({ id: 'job-2', provenance: prov }, { input: mjs.imageInput({ url: 'https://x/2.jpg', resized_to_px: 1500 }), collected_by: 'scripts/workers/batch-collector.mjs' });
    const r = mjs.missingProvenance('ocr', { data: 't', source: 'pipeline_preview', updated_at: new Date(), content_hash: mjs.contentHash('t'), engine: e });
    expect(r).toEqual({ missing: [], markers: [] });
    expect(e.run.batch_job_id).toBe('job-2');
    expect(e.run.collected_by).toBe('scripts/workers/batch-collector.mjs');
    expect(e.input).toEqual({ image_url: 'https://x/2.jpg', resized_to_px: 1500 });
  });

  it('a cross-book job: the page-level sent hash and the job-level resize both land on the page', () => {
    const prov = mjs.batchJobProvenance({ call_site: 'scripts/workers/pipeline-orchestrator.mjs', model: 'gemini-3.1-flash-lite', prompt: { ...ocrArgs().prompt, text: 'BASE' }, generationConfig: { temperature: 0.1 }, run: FIXED, image_resized_to_px: 1500 });
    expect(prov.image_resized_to_px).toBe(1500);
    const perPage = mjs.contentHash('BASE\n\n**Document context:** "Title" by Author.');
    const e = mjs.engineFromBatchJob({ id: 'job-3', provenance: prov }, { input: mjs.imageInput({ url: 'https://x/3.jpg' }), collected_by: 'c', prompt_sent_hash: perPage, prompt_sent_chars: 45 });
    expect(e.prompt.sent_hash).toBe(perPage);
    expect(e.prompt.sent_chars).toBe(45);
    expect(e.prompt.hash).toBe(prov.prompt.hash);
    expect(e.input).toEqual({ image_url: 'https://x/3.jpg', resized_to_px: 1500 });
    expect(e).not.toHaveProperty('image_resized_to_px');
    // no per-page hash → the job-level one stands
    const e2 = mjs.engineFromBatchJob({ id: 'job-3', provenance: prov }, { input: mjs.imageInput({ url: 'https://x/3.jpg' }), collected_by: 'c' });
    expect(e2.prompt.sent_hash).toBe(mjs.contentHash('BASE'));
    expect(mjs.missingProvenance('ocr', { data: 't', source: 'batch_api', updated_at: new Date(), content_hash: mjs.contentHash('t'), engine: e })).toEqual({ missing: [], markers: [] });
  });

  it('specialist and archive sources have their own required set; human text needs only the hash', () => {
    expect(mjs.missingProvenance('ocr', { data: 't', source: 'kraken', updated_at: new Date(), content_hash: mjs.contentHash('t'), engine: { name: 'kraken', model: 'sophro-mhiro', run: 'r' } }).missing).toEqual([]);
    expect(mjs.missingProvenance('ocr', { data: 't', source: 'kraken', updated_at: new Date(), engine: { name: 'kraken', model: 'sophro-mhiro' } }).missing).toEqual(['ocr.content_hash', 'ocr.engine.run']);
    // MinerU (ladder tier 3) is a specialist engine too: the pre-2026-09-30 worker stamped a bare
    // string under `engine`, which is a gap, not a block.
    expect(mjs.missingProvenance('ocr', { data: 't', source: 'mineru', updated_at: new Date(), content_hash: mjs.contentHash('t'), engine: { name: 'mineru', model: 'mineru-pipeline', run: { id: 'r' } } }).missing).toEqual([]);
    expect(mjs.missingProvenance('ocr', { data: 't', source: 'mineru', updated_at: new Date(), content_hash: mjs.contentHash('t'), engine: 'mineru pipeline backend (PP-OCR + PDF-Extract-Kit)' }).missing).toEqual(['ocr.engine']);
    expect(ts.missingProvenance('ocr', { data: 't', source: 'mineru', updated_at: new Date(), content_hash: mjs.contentHash('t'), engine: { name: 'mineru', model: 'mineru-pipeline' } }).missing).toEqual(['ocr.engine.run']);
    expect(mjs.missingProvenance('ocr', { data: 't', source: 'ia_djvu', updated_at: new Date(), content_hash: mjs.contentHash('t'), source_url: 'u', ia: { item: 'i', ingest_run: 'r' } }).missing).toEqual([]);
    expect(mjs.missingProvenance('ocr', { data: 't', source: 'ia_djvu', updated_at: new Date(), content_hash: mjs.contentHash('t'), source_url: 'u', ia: { item: 'i' } }).missing).toEqual(['ocr.ia.ingest_run']);
    expect(mjs.missingProvenance('translation', { data: 't', source: 'manual', updated_at: new Date(), content_hash: mjs.contentHash('t') }).missing).toEqual([]);
  });
});

describe('the .mjs and .ts twins agree', () => {
  const strip = (e: unknown) => JSON.parse(JSON.stringify(e, (k, v) => (k === 'recorded_by' ? undefined : v)));

  it('same engine block for the same input', () => {
    const a = ocrArgs();
    expect(strip(ts.geminiEngine(a))).toEqual(strip(mjs.geminiEngine(a)));
    const noTemp = { ...a, generationConfig: { maxOutputTokens: 4096 } };
    expect(strip(ts.geminiEngine(noTemp))).toEqual(strip(mjs.geminiEngine(noTemp)));
    const unknown = { ...a, model: 'gemini-9-ultra' };
    expect(strip(ts.geminiEngine(unknown))).toEqual(strip(mjs.geminiEngine(unknown)));
  });

  it('same content hash, same inputs, same legacy-job block', () => {
    expect(ts.contentHash('abc')).toBe(mjs.contentHash('abc'));
    expect(ts.translationInput({ ocrText: 'x' })).toEqual(mjs.translationInput({ ocrText: 'x' }));
    const job = { id: 'j', model: 'gemini-3-flash-preview', prompt_version: '16', created_at: new Date('2026-09-27') };
    const now = new Date('2026-09-28');
    expect(strip(ts.engineFromBatchJob(job, { input: ts.imageInput({ url: 'u' }), collected_by: 'c', now })))
      .toEqual(strip(mjs.engineFromBatchJob(job, { input: mjs.imageInput({ url: 'u' }), collected_by: 'c', now })));
  });

  it('same checker verdicts', () => {
    const e = mjs.geminiEngine(ocrArgs());
    const good = { data: 't', source: 'ai', updated_at: new Date(), content_hash: mjs.contentHash('t'), engine: e };
    expect(ts.missingProvenance('ocr', good)).toEqual(mjs.missingProvenance('ocr', good));
    const bad = JSON.parse(JSON.stringify(good)); bad.updated_at = new Date(); delete bad.engine.run.code_version; delete bad.engine.generation.sent;
    expect(ts.missingProvenance('ocr', bad)).toEqual(mjs.missingProvenance('ocr', bad));
    expect(ts.missingProvenance('ocr', bad).missing).toEqual(['ocr.engine.generation.sent', 'ocr.engine.run.code_version']);
  });

  it('the model default tables are identical', () => {
    expect(ts.MODEL_DEFAULTS).toEqual(mjs.MODEL_DEFAULTS);
  });
});

describe('inferHistoricalGeneration — what pre-#4613 rows can be said to have run under', () => {
  const row = (source: string, when: string, extra: Record<string, unknown> = {}) => ({ data: 't', source, updated_at: new Date(when), ...extra });

  it('a row with an observed block is observed, not inferred', () => {
    expect(mjs.inferHistoricalGeneration('ocr', { ...row('ai', '2026-09-28T17:00:00Z'), engine: mjs.geminiEngine(ocrArgs()) })).toEqual({ status: 'observed' });
  });

  it('batch OCR since 2026-02-19: 0.1 / 16384 / thinking off, labelled inferred with its git basis', () => {
    const r = mjs.inferHistoricalGeneration('ocr', row('batch_api', '2026-08-15'));
    expect(r.status).toBe('inferred');
    expect(r.rule).toBe('batch-ocr');
    expect(r.generation).toEqual({ temperature: 0.1, max_output_tokens: 16384, thinking_budget: 0 });
    expect(r.basis[0]).toMatch(/^5e1f1d3d6 2026-02-21/);
    expect(mjs.inferHistoricalGeneration('ocr', row('pipeline_preview', '2026-09-10')).rule).toBe('batch-ocr');
  });

  it('an `ai` OCR row is Lambda (temperature 1, thinking on) when code_version was stamped, realtime (0.1, off) when not — only after 2026-06-01', () => {
    const lambda = mjs.inferHistoricalGeneration('ocr', row('ai', '2026-08-15', { code_version: 'abc1234' }));
    expect(lambda.rule).toBe('lambda-ocr-thinking-on');
    expect(lambda.generation.temperature).toBe(1);
    expect(lambda.generation.thinking).toBe('model_default_dynamic');
    const lambdaOff = mjs.inferHistoricalGeneration('ocr', row('ai', '2026-09-10', { code_version: 'abc1234' }));
    expect(lambdaOff.rule).toBe('lambda-ocr-thinking-off');
    expect(lambdaOff.generation.thinking_budget).toBe(0);
    const script = mjs.inferHistoricalGeneration('ocr', row('ai', '2026-08-15'));
    expect(script.rule).toBe('realtime-ocr-script');
    expect(script.generation).toEqual({ temperature: 0.1, max_output_tokens: 16384, thinking_budget: 0 });
    // the cap became a flag on 2026-09-15: temperature and thinking still inferred, the cap is not
    const flagged = mjs.inferHistoricalGeneration('ocr', row('ai', '2026-09-20'));
    expect(flagged.rule).toBe('realtime-ocr-script-flagged-cap');
    expect(flagged.generation.max_output_tokens).toBeNull();
    // before code_version existed the two writers are indistinguishable: not_recorded, never a guess
    const early = mjs.inferHistoricalGeneration('ocr', row('ai', '2026-05-01'));
    expect(early.status).toBe('not_recorded');
    expect(early.reason).toMatch(/ambiguous/);
  });

  it('translation `ai` rows: thinking on until 2026-09-04 then off; temperature never inferred (worker 1 vs script 0.2)', () => {
    const early = mjs.inferHistoricalGeneration('translation', row('ai', '2026-06-01'));
    expect(early.rule).toBe('translation-ai-before-cap');
    expect(early.generation.temperature).toBeNull();
    expect(early.generation.thinking).toBe('model_default_dynamic');
    const mid = mjs.inferHistoricalGeneration('translation', row('ai', '2026-08-20'));
    expect(mid.rule).toBe('translation-ai-cap-thinking-on');
    const late = mjs.inferHistoricalGeneration('translation', row('ai', '2026-09-20'));
    expect(late.rule).toBe('translation-ai-thinking-off');
    expect(late.generation.thinking_budget).toBe(0);
    expect(late.generation.temperature).toBeNull();
    expect(mjs.inferHistoricalGeneration('translation', row('batch_api', '2026-07-01')).generation).toEqual({ temperature: 0.1, max_output_tokens: 16384, thinking_budget: 0 });
  });

  it('boundaries are half-open [from, to): the day thinking turned off belongs to the new rule', () => {
    expect(mjs.inferHistoricalGeneration('ocr', row('ai', '2026-09-03T00:00:00Z', { code_version: 'x' })).rule).toBe('lambda-ocr-thinking-off');
    expect(mjs.inferHistoricalGeneration('ocr', row('ai', '2026-09-02T23:59:59Z', { code_version: 'x' })).rule).toBe('lambda-ocr-thinking-on');
    // after the floor, a row with no block is a writer that forgot, not history
    const after = mjs.inferHistoricalGeneration('ocr', row('batch_api', '2026-09-28T16:21:00Z'));
    expect(after.status).toBe('not_recorded');
  });

  it('every rule in the table has a dated git basis and a writer, and generation is null only when the writer is ambiguous', () => {
    for (const r of mjs.provenanceHistory().rules) {
      expect(r.basis.length, r.id).toBeGreaterThan(0);
      expect(r.basis.join(' '), r.id).toMatch(/\b[0-9a-f]{9}\b 2026-\d\d-\d\d/);
      expect(r.writer, r.id).toBeTruthy();
      if (r.generation === null) expect(r.writer, r.id).toMatch(/ambiguous/);
    }
  });
});
