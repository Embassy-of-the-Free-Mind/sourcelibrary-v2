/**
 * #7075: the only Gemini model that may run on the PAID API is gemini-3.1-flash-lite (Derek, 2026-10-08). OCR enforces it
 * (#8525); this pins the same for every paid TRANSLATION door. Three `channel: batch` rows of the routing table name
 * gemini-3-flash-preview (bph, tibetan, flash-measured), and pages were written with it on the paid API on 2026-11-06,
 * 11-07 and 11-10. The guard makes those books wait for the CLI lane; the table rows are untouched (#8283).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { LITE_MODEL, paidApiModelAllowed, translateModelRefusal, TRANSLATE_NOT_ON_API } from '../../scripts/lib/ocr-lite-gate.mjs';
import { getTranslateModelForBook } from '../../scripts/lib/translate-core.mjs';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('translateModelRefusal: positive control (refused on the paid API)', () => {
  it.each(['gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-3.1-pro-preview', 'gemini-3.8-flash'])('%s is refused', (model) => {
    expect(paidApiModelAllowed(model)).toBe(false);
    const r = translateModelRefusal(model);
    expect(r?.error).toBe(TRANSLATE_NOT_ON_API);
    expect(r?.message).toContain('scripts/batch/cli-translate-lane.mjs');
    expect(r?.message).toContain(model);
  });
});

describe('translateModelRefusal: negative control', () => {
  it('Flash-Lite is allowed on the paid API', () => {
    expect(paidApiModelAllowed(LITE_MODEL)).toBe(true);
    expect(translateModelRefusal('gemini-3.1-flash-lite')).toBeNull();
  });
  it('a cli-channel reader is never the paid API', () => {
    expect(translateModelRefusal('gemini-3.8-flash+agy-cli', 'cli')).toBeNull();
    expect(translateModelRefusal('claude-opus-5-5', 'cli')).toBeNull();
    expect(translateModelRefusal('gemini-3-flash-preview', 'cli')).toBeNull();
  });
});

describe('the routing table: which books the guard parks', () => {
  it('a BPH book routes to gemini-3-flash-preview (refused), a Latin book to Flash-Lite (allowed)', () => {
    // Pinned on the model, not on a routing row: the rows move to agy (PR #8596), the gate must hold regardless.
    expect(translateModelRefusal('gemini-3-flash-preview')).not.toBeNull();
    expect(translateModelRefusal(getTranslateModelForBook({ language: 'Latin' }))).toBeNull();
  });
});

describe('every paid translation door asks the gate before it spends', () => {
  const API_DOORS = [
    'src/app/api/jobs/queue-books/route.ts',
  ];
  // The two batch-translate-async routes got the same refusal in #8548 (inline, LITE_MODEL); pinned on that form.
  const API_DOORS_8548 = [
    'src/app/api/books/[id]/batch-translate-async/route.ts',
    'src/app/api/[tenant]/books/[id]/batch-translate-async/route.ts',
  ];
  it.each(API_DOORS_8548)('%s refuses a non-lite model with a 409 (#8548)', (rel) => {
    const src = read(rel);
    expect(src).toMatch(/if \(model !== API_TRANSLATE_MODEL\)/);
    expect(src).toMatch(/status: 409/);
  });
  const OTHER_DOORS = [
    'src/workers/translation-processor-logic.ts',
    'scripts/workers/translate-worker.mjs',
    'scripts/batch/realtime-translate.mjs',
    'scripts/lib/translate-batch-chained.mjs',
    'scripts/lib/translate-batch-seam.mjs',
  ];
  it.each(API_DOORS)('%s refuses with a 409 and the error code', (rel) => {
    const src = read(rel);
    expect(src).toContain('translateModelRefusal(');
    expect(src).toMatch(/NextResponse\.json\(notOnApi, \{ status: 409 \}\)/);
  });
  it.each(OTHER_DOORS)('%s imports and calls the gate', (rel) => {
    const src = read(rel);
    expect(src).toMatch(/ocr-lite-gate\.mjs/);
    expect(src).toMatch(/translateModelRefusal\)?\(/);
  });
  it('the Phase-4 hand-off does not fall back to the (also paid) realtime lane on this refusal', () => {
    expect(read('scripts/lib/translate-batch-chained.mjs')).toMatch(/\|translate_model_not_on_api\)/);
  });
});
