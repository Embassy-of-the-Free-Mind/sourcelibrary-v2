/**
 * The channel rule for OCR (#7075): only gemini-3.1-flash-lite is sent to the paid Gemini API.
 * Every other Gemini model reads through the agy CLI lane on the subscription, and a book whose
 * CLI lane has no quota waits; it never falls through to the API.
 *
 * Derek, 2026-10-08; DECIDED 2026-10-10 ("Only via the CLI lane, no API"). Before #7075 the
 * orchestrator sent every book the router answered flash for to the Batch API on
 * gemini-3-flash-preview: 502 jobs, 4,106 pages, $10.50 between 2026-10-08 and 2026-10-21.
 *
 * Three layers:
 *  1. the helpers in scripts/lib/ocr-routing.mjs refuse every non-lite model;
 *  2. the router's API answer is always lite, over a grid of books and both OCR_LITE_ONLY modes;
 *  3. a static sweep: every OCR submitter under scripts/ that can reach the API calls the guard,
 *     and the orchestrator's submit functions check the model before they select or upload pages.
 * Each layer has a negative control that shows it can fail.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  API_OCR_MODELS, isApiOcrModel, assertApiOcrModel, ocrLaneForBook, apiOcrModelForBook,
  CLI_FLASH_OCR_HOLD, FLASH_OCR_FROM, OCR_MODEL_LITE, OCR_MODEL_FLASH,
} from '../../scripts/lib/ocr-routing.mjs';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const NON_LITE = [
  'gemini-3-flash-preview', 'gemini-3-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite',
  'gemini-3.8-flash', 'gemini-3.8-flash-low', 'gemini-3.1-pro-preview', 'gemini-2.5-flash',
];

describe('the helpers refuse every Gemini model but flash-lite', () => {
  it('flash-lite is the only API model', () => {
    expect([...API_OCR_MODELS]).toEqual(['gemini-3.1-flash-lite']);
    expect(OCR_MODEL_LITE).toBe('gemini-3.1-flash-lite');
    expect(isApiOcrModel(OCR_MODEL_LITE)).toBe(true);
    expect(assertApiOcrModel(OCR_MODEL_LITE, 'test')).toBe(OCR_MODEL_LITE);
  });

  it('NEGATIVE CONTROL: every other model is refused, the router\'s flash first', () => {
    for (const m of [OCR_MODEL_FLASH, ...NON_LITE, '', undefined]) {
      expect([m, isApiOcrModel(m)]).toEqual([m, false]);
      expect(() => assertApiOcrModel(m, 'test')).toThrow(/refusing to send .* to the paid Gemini API/);
    }
  });

  it('the CLI queue is a pipeline hold with a reason, an issue and a release condition', () => {
    expect(CLI_FLASH_OCR_HOLD.reason).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(CLI_FLASH_OCR_HOLD.issue).toBe(7075);
    expect(CLI_FLASH_OCR_HOLD.release).toMatch(/cli-ocr\.mjs/);
  });
});

describe('the router never answers a non-lite model for the API', () => {
  const families = ['Latin', 'English', 'German', 'Greek', 'Persian', 'Sanskrit', 'Pali', 'Arabic', "Ge'ez",
    'Chinese', 'Classical Chinese', 'Japanese', 'Tibetan', 'Syriac', 'Hebrew', 'Russian', '', 'Unknown'];
  const old = new Date('2026-01-01T00:00:00Z');
  const fresh = new Date('2026-12-01T00:00:00Z');
  const books = families.flatMap((language) => [
    { language, visible: true, created_at: old },
    { language, visible: false, created_at: old },
    { language, visible: false, created_at: fresh },
    { language, visible: true, created_at: old, image_source: { provider: 'bph' } },
  ]);

  for (const liteOnly of [true, false]) {
    it(`OCR_LITE_ONLY=${liteOnly}: channel 'api' always carries flash-lite; every other model is 'cli'`, () => {
      let cli = 0;
      for (const book of books) {
        const lane = ocrLaneForBook(book, { liteOnly });
        if (lane.channel === 'api') expect([book, lane.model]).toEqual([book, OCR_MODEL_LITE]);
        else { cli++; expect([book, lane.model]).not.toEqual([book, OCR_MODEL_LITE]); }
        expect(apiOcrModelForBook(book, { liteOnly })).toBe(lane.channel === 'api' ? OCR_MODEL_LITE : null);
      }
      expect(cli).toBeGreaterThan(0); // the grid does reach the Flash branch
    });
  }

  it('the Flash-routed scripts go to the CLI lane, Chinese print among them (#6101)', () => {
    expect(FLASH_OCR_FROM.zho).toBeInstanceOf(Date);
    for (const language of ['Greek', 'Persian', 'Arabic', 'Chinese', 'Classical Chinese']) {
      expect([language, ocrLaneForBook({ language, visible: true }, { liteOnly: true }).channel]).toEqual([language, 'cli']);
    }
    expect(ocrLaneForBook({ language: 'Latin', visible: true }, { liteOnly: true })).toEqual({ channel: 'api', model: OCR_MODEL_LITE });
  });
});

// ── Static sweep ──────────────────────────────────────────────────────────────────────────────
// An OCR submitter is a script that can reach the Gemini API (or queue a Lambda job that does)
// and either takes its model from the router or names a non-lite model in an OCR job. Each must
// call the guard. scripts/eval is left out on purpose: an eval's model IS the experiment, and the
// spend rule governs it at dispatch, not this test.
const SWEPT = ['scripts/workers', 'scripts/batch', 'scripts/migration', 'scripts/maintenance', 'scripts/lib', 'scripts/import'];
const API_CALL = /batchGenerateContent|:generateContent|createBatchJob\w*\(|collection\('jobs'\)\.insertOne/;
const USES_ROUTER = /ocr-routing\.mjs'/;
const NON_LITE_LITERAL = /['"`]gemini-(?:3-flash|3\.\d-flash(?!-lite)|3\.\d-pro|3-pro)[\w.-]*['"`]/;
const OCR_JOB = /type:\s*'ocr'/;
const GUARDED = /\b(assertApiOcrModel|apiOcrModelForBook|isApiOcrModel)\b/;

function unguardedOcrSubmitter(src: string): boolean {
  const submits = API_CALL.test(src) && (USES_ROUTER.test(src) || (NON_LITE_LITERAL.test(src) && OCR_JOB.test(src)));
  return submits && !GUARDED.test(src);
}

const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.(mjs|js)$/.test(e.name) ? [path.join(d, e.name)] : []));

describe('every OCR submitter under scripts/ checks the model before the API', () => {
  const files = SWEPT.flatMap((d) => walk(path.join(ROOT, d)))
    .map((f) => path.relative(ROOT, f))
    .filter((f) => f !== 'scripts/lib/ocr-routing.mjs');

  it('finds the known submitters (the sweep is not empty)', () => {
    const submitters = files.filter((f) => { const s = read(f); return API_CALL.test(s) && (USES_ROUTER.test(s) || (NON_LITE_LITERAL.test(s) && OCR_JOB.test(s))); });
    for (const f of ['scripts/workers/pipeline-orchestrator.mjs', 'scripts/batch/bulk-reocr-local.mjs', 'scripts/batch/realtime-ocr.mjs']) expect(submitters).toContain(f);
    expect(submitters.length).toBeGreaterThanOrEqual(8);
  });

  it('none is unguarded', () => {
    expect(files.filter((f) => unguardedOcrSubmitter(read(f)))).toEqual([]);
  });

  it('NEGATIVE CONTROL: a submitter with its guard stripped is caught', () => {
    for (const f of ['scripts/batch/bulk-reocr-local.mjs', 'scripts/batch/realtime-reocr-efm.mjs']) {
      const stripped = read(f).replace(/\b(assertApiOcrModel|apiOcrModelForBook|isApiOcrModel)\b/g, 'removedGuard');
      expect([f, unguardedOcrSubmitter(stripped)]).toEqual([f, true]);
    }
  });
});

describe('the orchestrator checks the model in both submit paths', () => {
  const orch = read('scripts/workers/pipeline-orchestrator.mjs');
  const body = (name: string) => { const i = orch.indexOf(`async function ${name}(`); return orch.slice(i, orch.indexOf('\nasync function ', i + 10)); };

  it('per-book and pooled submits route a non-lite model to the CLI lane before any upload', () => {
    for (const fn of ['submitOcrDirectlyUnderLease', 'submitCrossBookOcrBatchesUnderLease']) {
      const b = body(fn);
      const gate = b.indexOf('if (!isApiOcrModel(ocrModel))');
      expect([fn, gate > 0]).toEqual([fn, true]);
      expect([fn, b.slice(gate, gate + 400).includes('routeBookToCliOcrLane(')]).toEqual([fn, true]);
      expect([fn, gate < b.indexOf('createBatchJob')]).toEqual([fn, true]);
    }
  });

  it('every OCR batch creation passes its model through assertApiOcrModel', () => {
    const calls = orch.match(/createBatchJob(?:FromFile|Inline)\(([^,]+),/g) ?? [];
    const ocrCalls = calls.filter((c) => /ocrModel/.test(c));
    expect(ocrCalls.length).toBe(3);
    for (const c of ocrCalls) expect(c).toMatch(/createBatchJob(?:FromFile|Inline)\(assertApiOcrModel\(ocrModel,/);
  });

  it('the CLI lane holds the book with CLI_FLASH_OCR_HOLD and writes nothing under --dry-run', () => {
    const b = body('routeBookToCliOcrLane');
    expect(b).toContain('holdBook(db, book.id, {');
    expect(b).toContain('...CLI_FLASH_OCR_HOLD');
    expect(b.indexOf('if (DRY_RUN)')).toBeLessThan(b.indexOf('holdBook('));
  });
});
