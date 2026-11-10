/**
 * #8519: the paid Flash-Lite Batch lane may read a book only in a cell whose bound route is Flash-Lite, and every page a
 * Batch OCR job writes carries `ocr.lane` and `ocr.pipeline`.
 *
 * Measured: in the 7 days to 2026-11-11 the Batch API wrote ~15.8K Flash-Lite OCR pages with neither stamp, 6,298 of them
 * through src/app/api/books/[id]/batch-ocr-async after the orchestrator had closed (2026-11-06), in Latin, French, Italian
 * and Spanish books whose router cell reads fresh with agy. Each one became re-read work.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { liteReadAllowed, batchOcrStamps, BATCH_OCR_LANE, OCR_ROUTING_TABLE, OCR_MODEL_LITE } from '../../scripts/lib/ocr-routing.mjs';
import * as gate from '../../scripts/lib/ocr-lite-gate.mjs';

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const ROUTES = ['src/app/api/books/[id]/batch-ocr-async/route.ts', 'src/app/api/[tenant]/books/[id]/batch-ocr-async/route.ts'];

describe('liteReadAllowed: the router cell decides', () => {
  it('refuses the week\'s cases: Latin, French, Italian, Spanish, German print', () => {
    for (const language of ['Latin', 'French', 'Italian', 'Spanish', 'German', 'lat', 'Latin, Greek']) {
      for (const script_type of [undefined, 'printed']) {
        const g = liteReadAllowed({ language, script_type });
        expect([language, script_type, g.ok]).toEqual([language, script_type, false]);
        expect(g.why).toMatch(/#8519/);
      }
    }
    // The Latin and French first-read cells bind an agy route: the refusal names it, so the caller knows the lane.
    expect(liteReadAllowed({ language: 'Latin', script_type: 'printed' })).toMatchObject({ cell: 'latin-blank/print', route: expect.stringMatching(/agy/) });
    expect(liteReadAllowed({ language: 'French' })).toMatchObject({ cell: 'french-blank/print', route: expect.stringMatching(/agy/) });
  });

  it('refuses a book with no cell, no language, or a manuscript the cell table does not cover', () => {
    for (const book of [{ language: '' }, {}, { language: 'Klingon' }, { language: 'Hebrew' }, { language: 'Latin', script_type: 'handwritten' }]) {
      expect(liteReadAllowed(book).ok).toBe(false);
    }
  });

  it('allows a cell that binds the route `lite` itself (sanskrit-lite/print, a keep)', () => {
    const row = OCR_ROUTING_TABLE.router_cells.find((r: { cell: string }) => r.cell === 'sanskrit-lite/print');
    expect(row?.route).toBe('lite');
    expect(liteReadAllowed({ language: 'Sanskrit', script_type: 'printed' })).toMatchObject({ ok: true, cell: 'sanskrit-lite/print' });
  });

  it('a lite DRAFT a corrector rewrites is not a Flash-Lite route', () => {
    const table = { router_cells: [{ cell: 'latin-blank/print', decision: 'keep', route: 'lite>agy-flash-low' }] };
    expect(liteReadAllowed({ language: 'Latin', script_type: 'printed' }, table).ok).toBe(false);
  });

  it('negative control: the same book is allowed when its cell binds lite', () => {
    const table = { router_cells: [{ cell: 'latin-blank/print', decision: 'keep', route: 'lite' }] };
    expect(liteReadAllowed({ language: 'Latin', script_type: 'printed' }, table).ok).toBe(true);
    expect(liteReadAllowed({ language: 'Latin' }, table).ok).toBe(true); // unknown script asks print after unknown
  });
});

describe('batchOcrStamps: lane and pipeline on every Batch OCR write', () => {
  it('names the channel and the submitter', () => {
    expect(batchOcrStamps({ submitted_by: 'scripts/workers/pipeline-orchestrator.mjs' })).toEqual({ 'ocr.lane': BATCH_OCR_LANE, 'ocr.pipeline': 'orchestrator-ocr' });
    expect(batchOcrStamps({ submitted_by: 'scripts/workers/pipeline-orchestrator.mjs', ocr_source: 'pipeline_preview' })['ocr.pipeline']).toBe('orchestrator-preview-ocr');
    expect(batchOcrStamps({ submitted_by: ROUTES[0] })['ocr.pipeline']).toBe('api-batch-ocr-async');
    expect(batchOcrStamps({ submitted_by: ROUTES[1] })['ocr.pipeline']).toBe('api-tenant-batch-ocr-async');
    expect(batchOcrStamps({ provenance: { call_site: 'scripts/batch/submit-batch-ocr.mjs' } })['ocr.pipeline']).toBe('submit-batch-ocr');
  });

  it('never writes an empty or missing value, even for a job with no record of its submitter', () => {
    for (const job of [{}, null, undefined, { submitted_by: '' }]) {
      const s = batchOcrStamps(job);
      expect(s['ocr.lane']).toBe(BATCH_OCR_LANE);
      expect(s['ocr.pipeline']).toMatch(/\S/);
    }
  });
});

describe('the Next-safe module the routes import', () => {
  it('names the same lite model, and imports nothing that reaches translate-core', () => {
    expect(gate.LITE_MODEL).toBe(OCR_MODEL_LITE);
    expect(read('scripts/lib/ocr-lite-gate.mjs').match(/^import .*$/gm)).toEqual(["import { toLanguageCodes, codeFamily } from './language-normalize.mjs';"]);
    expect(read('scripts/lib/language-normalize.mjs')).not.toMatch(/^import /m);
  });
  it('needs the table passed, and agrees with the ocr-routing default', () => {
    expect(() => gate.liteReadAllowed({ language: 'Latin' }, undefined)).toThrow(/routing table/);
    for (const language of ['Latin', 'Sanskrit', 'Italian']) expect(gate.liteReadAllowed({ language }, OCR_ROUTING_TABLE)).toEqual(liteReadAllowed({ language }));
  });
  for (const rel of ROUTES) it(`${rel} imports the gate, not ocr-routing.mjs`, () => {
    const src = read(rel);
    expect(src).toMatch(/scripts\/lib\/ocr-lite-gate\.mjs'/);
    expect(src).not.toMatch(/scripts\/lib\/ocr-routing\.mjs'/);
  });
});

describe('the writers call them', () => {
  for (const rel of ROUTES) {
    it(`${rel}: gates before it selects pages, and stamps what it collects`, () => {
      const src = read(rel);
      const post = src.slice(src.indexOf('export const POST'), src.indexOf('export const GET'));
      const gate = post.indexOf('liteReadAllowed(book, OCR_ROUTING_TABLE)');
      expect(gate).toBeGreaterThan(0);
      expect(post.indexOf("collection('pages')")).toBeGreaterThan(gate);
      expect(post).toMatch(/model !== OCR_MODEL_LITE/);
      const get = src.slice(src.indexOf('export const GET'));
      expect(get).toMatch(/\.\.\.batchOcrStamps\(jobDoc\)/);
    });
  }

  it('batch-collector stamps its OCR $set', () => {
    const src = read('scripts/workers/batch-collector.mjs');
    const set = src.slice(src.indexOf("'ocr.data': text,"), src.indexOf("'ocr.data': text,") + 3000);
    expect(set).toMatch(/\.\.\.batchOcrStamps\(job\)/);
  });
});
