/**
 * Preview OCR must PIN a model on the job it creates.
 *
 * INCIDENT (2026-08-27..30). `queuePreviewOcr` writes a `jobs` row with
 * `config: { page_ids, preview: true }` and no `model`. The OCR worker
 * (src/workers/ocr-processor-logic.ts) resolves the model as
 * `job.config.model || DEFAULT_MODEL`, and DEFAULT_MODEL is the FULL flash
 * model. So every newly imported book's 25-page preview ran on the expensive
 * model, never consulting `getModelForBook`.
 *
 * It cost nothing visible until the acquisition push imported 3,998 books in
 * one day: 110,646 preview pages for 4,450 Latin-script books — a language the
 * routing rule explicitly trusts to flash-lite — billed at the full-flash rate.
 *
 * The shape to guard is not "preview OCR is cheap" but "the job carries an
 * EXPLICIT model". A worker-side default that is also the most expensive option
 * turns every omission into a silent overspend, so the omission is the bug.
 *
 * These are source-level assertions on purpose: `queuePreviewOcr` reaches for a
 * live Mongo connection, and the failure being pinned is a missing field in the
 * inserted document, which is visible in the source without one.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { getModelForBook, DEFAULT_MODEL, DEFAULT_LITE_MODEL } from '../../src/lib/types/ai-models';

const root = path.join(__dirname, '..', '..');
const previewOcrSrc = readFileSync(path.join(root, 'src/lib/preview-ocr.ts'), 'utf8');
const workerSrc = readFileSync(path.join(root, 'src/workers/ocr-processor-logic.ts'), 'utf8');

describe('preview OCR pins an explicit model', () => {
  it('resolves the model through getModelForBook, not the worker default', () => {
    expect(previewOcrSrc).toContain('getModelForBook');
  });

  it('writes the resolved model into the job config', () => {
    // The inserted job document must carry `model`, or the worker falls back
    // to DEFAULT_MODEL for every preview job regardless of language.
    const config = previewOcrSrc.match(/config:\s*\{[^}]*\}/s);
    expect(config, 'preview-ocr.ts no longer has a recognisable job config block').not.toBeNull();
    expect(config![0]).toMatch(/\bmodel\b/);
  });

  it('the worker default it guards against is still the expensive model', () => {
    // If this ever stops being true the guard above is arguably optional —
    // but so is this test, and it should be revisited deliberately rather than
    // quietly diverging from the reason it exists.
    expect(workerSrc).toContain('job.config.model || DEFAULT_MODEL');
    expect(DEFAULT_MODEL).toBe('gemini-3-flash-preview');
  });
});

describe('the routing rule the preview path must honour', () => {
  it('sends Latin-script books to the cheap model', () => {
    // 4,450 of the books in the incident carried exactly this language.
    expect(getModelForBook({ language: 'latin' })).toBe(DEFAULT_LITE_MODEL);
    expect(getModelForBook({ language: 'German' })).toBe(DEFAULT_LITE_MODEL);
  });

  it('keeps the safe default for BPH, non-Latin scripts, and unknown language', () => {
    expect(getModelForBook({ image_source: { provider: 'bph' }, language: 'latin' })).toBe(DEFAULT_MODEL);
    expect(getModelForBook({ language: 'sanskrit' })).toBe(DEFAULT_MODEL);
    expect(getModelForBook({ language: null })).toBe(DEFAULT_MODEL);
    expect(getModelForBook(null)).toBe(DEFAULT_MODEL);
  });
});
