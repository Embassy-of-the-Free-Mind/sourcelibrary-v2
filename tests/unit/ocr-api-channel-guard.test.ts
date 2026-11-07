/**
 * The channel rule for OCR (#7075), as of 2026-11-06: NO model is sent to the paid Gemini API for OCR.
 * Every book reads through the agy CLI lane on the subscription, a book the router labels flash-lite
 * included (cli-ocr-lane.mjs CLI_MODEL_FOR maps lite and Flash to gemini-3.8-flash-low), and a book whose
 * lane has no quota waits; it never falls through to the API.
 *
 * Derek, 2026-10-08 (only lite on the API), DECIDED 2026-10-10 ("Only via the CLI lane, no API"), then
 * 2026-11-06: "no one should use lite", "everything on agy", "its just better and cheaper". Before #7075
 * the orchestrator sent every book the router answered flash for to the Batch API: 502 jobs, 4,106 pages,
 * $10.50 between 2026-10-08 and 2026-10-21. On 2026-11-06 seven hand-picked imports released to the queue
 * were headed for paid lite, because lite was still an API model.
 *
 * Three layers:
 *  1. the helpers in scripts/lib/ocr-routing.mjs refuse every model;
 *  2. the router never answers an API channel, over a grid of books and both OCR_LITE_ONLY modes, and the
 *     CLI lane has a reader for every model the router can name;
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
import { CLI_MODEL_FOR } from '../../scripts/batch/cli-ocr-lane.mjs';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const MODELS = [
  OCR_MODEL_LITE, OCR_MODEL_FLASH,
  'gemini-3-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite',
  'gemini-3.8-flash', 'gemini-3.8-flash-low', 'gemini-3.1-pro-preview', 'gemini-2.5-flash',
];

describe('the helpers refuse every model for the paid API', () => {
  it('the API model set is empty: flash-lite is refused like the rest', () => {
    expect([...API_OCR_MODELS]).toEqual([]);
    expect(OCR_MODEL_LITE).toBe('gemini-3.1-flash-lite');
    for (const m of [...MODELS, '', undefined]) {
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

describe('the router never answers the API channel, and the CLI lane can read every routed model', () => {
  const families = ['Latin', 'English', 'German', 'French', 'Spanish', 'Greek', 'Persian', 'Sanskrit', 'Pali', 'Arabic', "Ge'ez",
    'Chinese', 'Classical Chinese', 'Japanese', 'Tibetan', 'Syriac', 'Hebrew', 'Russian', '', 'Unknown'];
  const old = new Date('2026-01-01T00:00:00Z');
  const fresh = new Date('2026-12-01T00:00:00Z');
  const books = families.flatMap((language) => [
    { language, visible: true, created_at: old },
    { language, visible: false, created_at: old },
    { language, visible: false, hidden: true, created_at: fresh },
    { language, visible: true, created_at: old, image_source: { provider: 'bph' } },
  ]);

  for (const liteOnly of [true, false]) {
    it(`OCR_LITE_ONLY=${liteOnly}: every book is 'cli', and its model has an agy reader`, () => {
      let lite = 0;
      for (const book of books) {
        const lane = ocrLaneForBook(book, { liteOnly });
        expect([book, lane.channel]).toEqual([book, 'cli']);
        expect(apiOcrModelForBook(book, { liteOnly })).toBeNull();
        expect([book, lane.model, CLI_MODEL_FOR[lane.model]]).toEqual([book, lane.model, 'gemini-3.8-flash-low']);
        if (lane.model === OCR_MODEL_LITE) lite++;
      }
      // The 2026-11-06 case: a hidden new Latin import is on the agy lane, not paid lite.
      expect(ocrLaneForBook({ language: 'Latin', visible: false, hidden: true, created_at: fresh }, { liteOnly })).toEqual({ channel: 'cli', model: OCR_MODEL_LITE });
      if (liteOnly) expect(lite).toBeGreaterThan(0); // the grid reaches the lite-labelled tier
    });
  }

  it('NEGATIVE CONTROL: a routed model with no agy reader would wait, and the map names it', () => {
    expect(CLI_MODEL_FOR['gemini-3.1-pro-preview']).toBeUndefined();
  });

  it('the Flash-routed scripts go to the CLI lane, Chinese print among them (#6101)', () => {
    expect(FLASH_OCR_FROM.zho).toBeInstanceOf(Date);
    for (const language of ['Greek', 'Persian', 'Arabic', 'Chinese', 'Classical Chinese', 'Latin']) {
      expect([language, ocrLaneForBook({ language, visible: true }, { liteOnly: true }).channel]).toEqual([language, 'cli']);
    }
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
