/**
 * Estimator rows carry provenance (#6740): the prompt and engine that produced an observation are part of a route's
 * identity. This runs the validator over EVERY committed estimator row file, so an unlabelled row fails CI, and pins
 * the rules that make the label mean something (a legacy row names its source; a route key ignores the CLI version).
 */
import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
// @ts-expect-error — plain ESM module without types
import * as P from '../../scripts/eval/estimator/provenance.mjs';

const ROOT = path.resolve(__dirname, '../..');
const DIR = 'scripts/eval/estimator';

const measured = (over: Record<string, unknown> = {}) => ({
  schema: 'estimator-provenance/1', engine: 'gemini-3.8-flash-low', prompt_id: '6a9', prompt_version: '19.1', prompt_hash: '9d8f959e00000000',
  sent_hash: 'abc0000000000000', read_mode: 'image', access: 'cli', cli_name: 'agy', cli_version: '1.4.6', job_id: 'j1', code_version: 'f72e97d5a',
  call_site: 'scripts/batch/cli-ocr.mjs', instrument: { class: 'mechanical', model: 'n/a', prompt_hash: 'n/a' }, ...over,
});

describe('every committed estimator row file', () => {
  const files = execFileSync('git', ['ls-files', `${DIR}/**/*.jsonl`, `${DIR}/*.jsonl`, `${DIR}/**/*.jsonl.gz`], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean);
  it('finds the row files', () => {
    expect(files).toContain(`${DIR}/ocr/failure-observations.jsonl`);
    expect(files.length).toBeGreaterThan(5);
  });
  for (const f of files) {
    it(`${f}: every row carries provenance`, () => {
      const r = P.validateFile(path.join(ROOT, f));
      expect(r.rows).toBeGreaterThan(0);
    });
  }
});

describe('validateRow', () => {
  it('passes a measured row and returns its route key', () => {
    expect(P.validateRow({ provenance: measured() }).key).toBe('gemini-3.8-flash-low | 6a9@19.1 | image');
  });
  it('throws on a row with no provenance at all', () => {
    expect(() => P.validateRow({ engine: 'gemini-3.1-flash-lite', k: 1, n: 20 })).toThrow(/no `provenance`/);
  });
  it('throws on a legacy row that does not say what its source states', () => {
    expect(() => P.validateRow({ provenance: 'legacy-not-recorded' })).toThrow(/provenance_stated/);
    expect(() => P.validateRow({ provenance: 'legacy-not-recorded', provenance_stated: { source: 'x.md' } })).toThrow(/prompt/);
  });
  it('throws on a model-judged legacy row without the judge statement', () => {
    const st = { source: 'x.md', prompt: 'the file does not state the prompt' };
    expect(() => P.validateRow({ provenance: 'legacy-not-recorded', provenance_stated: st, judge: 'opus' })).toThrow(/judge/);
    expect(P.validateRow({ provenance: 'legacy-not-recorded', provenance_stated: st, judge: 'mechanical' }).legacy).toBe(true);
  });
  it('throws on a missing field, never defaults it', () => {
    const p = measured(); delete (p as Record<string, unknown>).prompt_version;
    expect(() => P.validateRow({ provenance: p })).toThrow(/prompt_version/);
    expect(() => P.validateRow({ provenance: measured({ job_id: undefined }) })).toThrow(/job_id/);
  });
  it('allows a distribution in a covariate slot, never in a key slot', () => {
    const dist = { distinct: 2, top: [['a', 3], ['b', 1]] };
    expect(() => P.validateRow({ provenance: measured({ code_version: dist }) })).not.toThrow();
    expect(() => P.validateRow({ provenance: measured({ prompt_version: dist }) })).toThrow(/prompt_version/);
  });
  it('requires n/a CLI fields on an API read, and an instrument', () => {
    expect(() => P.validateRow({ provenance: measured({ access: 'api' }) })).toThrow(/cli_/);
    expect(() => P.validateRow({ provenance: measured({ instrument: undefined }) })).toThrow(/instrument/);
    expect(() => P.validateRow({ provenance: measured({ instrument: { class: 'model-judge', model: 'claude-opus-5-5', prompt_hash: 'n/a' } }) })).toThrow(/judge prompt/);
  });
});

describe('provenanceFromRaw reads the page record', () => {
  const gem = (over: Record<string, unknown> = {}) => ({ src: 'ai', model: 'gemini-3.8-flash-low', schema: 'gemini-engine/1', ename: 'gemini', api: 'cli', cli: 'agy', cliv: '1.4.6',
    pid: '6a9', pv: '19.1', ph: '9d8f', img: true, draft: false, txt: false, cs: 'scripts/batch/cli-ocr.mjs', ...over });
  it('keys a CLI read on engine x prompt x read mode, with the CLI version as a covariate', () => {
    const a = P.provenanceFromRaw(gem(), 'ocr', { jobs: ['j1'] });
    const b = P.provenanceFromRaw(gem({ cliv: '1.5.0' }), 'ocr', { jobs: ['j2'] });
    expect(P.routeKey(a)).toBe(P.routeKey(b));
    expect(a.cli_version).not.toBe(b.cli_version);
    expect(P.routeKey(P.provenanceFromRaw(gem({ pv: '16' }), 'ocr'))).not.toBe(P.routeKey(a));
  });
  it('a correct-mode read is its own route', () => {
    expect(P.provenanceFromRaw(gem({ draft: true }), 'ocr').read_mode).toBe('image+draft');
  });
  it('a page with no engine block is NOT recorded, even with a prompt_version label', () => {
    const p = P.provenanceFromRaw({ src: 'batch_api', model: 'gemini-3-flash-preview', tpv: '12' }, 'ocr');
    expect(p.prompt_version).toBe('label:12');
    expect(P.promptRecorded(p)).toBe(false);
  });
  it('the Archive text and a line recognizer take no prompt (n/a, not not_recorded)', () => {
    expect(P.provenanceFromRaw({ src: 'ia_djvu', model: 'ia-ocr/0.0.18', iae: 'ABBYY FineReader 8.0' }, 'ocr')).toMatchObject({ engine: 'ia-ocr', prompt_id: 'n/a', access: 'archive' });
    expect(P.provenanceFromRaw({ src: 'kraken', model: 'kraken/omnisyr', ename: 'kraken' }, 'ocr').prompt_id).toBe('n/a');
    expect(P.provenanceFromRaw({ src: 'paddle', model: 'PaddleOCR-VL-1.6-0.9B', ename: 'PaddleOCR-VL' }, 'ocr').prompt_id).toBe('not_recorded');
  });
  it('mergeProvenance refuses to pool two routes', () => {
    expect(() => P.mergeProvenance([P.provenanceFromRaw(gem(), 'ocr'), P.provenanceFromRaw(gem({ pv: '16' }), 'ocr')])).toThrow(/not one route/);
  });
});

describe('the legacy registry', () => {
  const reg = P.LEGACY_REGISTRY();
  it('every entry names its source and what it states about the prompt', () => {
    for (const [table, entries] of Object.entries(reg)) {
      if (table.startsWith('_')) continue;
      for (const [k, e] of Object.entries(entries as Record<string, unknown>)) {
        if (k === '_match') continue;
        const st = e as Record<string, unknown>;
        expect(typeof st.source === 'string' && st.source.length > 0, `${table} ${k} source`).toBe(true);
        expect(typeof st.prompt === 'string' && st.prompt.length > 0, `${table} ${k} prompt`).toBe(true);
      }
    }
  });
  it('an unregistered source throws instead of being labelled', () => {
    expect(() => P.legacyStated('failure-observations', 'no such experiment')).toThrow(/no entry/);
  });
});

describe('the Python twin agrees', () => {
  const py = spawnSync('python3', ['--version']);
  it.skipIf(py.status !== 0)('validate_row passes and fails the same rows as validateRow', () => {
    const cases = [
      { provenance: measured() },
      { provenance: measured({ access: 'api' }) },
      { provenance: measured({ prompt_version: { distinct: 2, top: [['a', 1]] } }) },
      { provenance: 'legacy-not-recorded', provenance_stated: { source: 'x.md', prompt: 'p' } },
      { provenance: 'legacy-not-recorded', provenance_stated: { source: 'x.md', prompt: 'p' }, judge: 'opus' },
      { k: 1 },
    ];
    const js = cases.map((c) => { try { P.validateRow(c); return true; } catch { return false; } });
    const script = `import json,sys\nsys.path.insert(0, ${JSON.stringify(path.join(ROOT, DIR))})\nimport provenance as p\nout=[]\nfor c in json.load(sys.stdin):\n    try:\n        p.validate_row(c); out.append(True)\n    except p.ProvenanceError:\n        out.append(False)\nprint(json.dumps(out))`;
    const r = spawnSync('python3', ['-c', script], { input: JSON.stringify(cases), encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual(js);
    expect(js).toEqual([true, false, false, true, false, false]);
  });
});

it('provenance-schema.json is the one constant source for both readers', () => {
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, DIR, 'provenance-schema.json'), 'utf8'));
  expect(spec.key_fields).toEqual(['engine', 'prompt_id', 'prompt_version', 'read_mode']);
  expect(spec.key_fields).not.toContain('cli_version');
});

describe('the Archive-text ingest records an engine block (#6740)', async () => {
  // @ts-expect-error — plain ESM module without types
  const { iaEngine } = await import('../../scripts/lib/ia-ocr-meta.mjs');
  const meta = { engine: 'ABBYY FineReader 11.0', version: '0.0.21', converter: 'abbyy-to-hocr 1.1.37' };
  const run = 'ia-ocr-ingest/2026-10-26T00:00:00/gex45@f72e97d5a';
  const src = 'https://archive.org/download/x/x_djvu.xml#leaf=7';
  it('names the engine, the run and the file, and says the engine takes no prompt', () => {
    const e = iaEngine(meta, { run, sourceUrl: src, leaf: 7 });
    expect(e).toMatchObject({ name: 'ABBYY FineReader 11.0', version: '0.0.21', model: 'ia-ocr', run, input: { source_url: src, leaf: 7 } });
    expect(e.prompt.status).toBe('n/a');
  });
  it('an item that does not name its engine says not_recorded, never a guess', () => {
    expect(iaEngine({}, { run, sourceUrl: src, leaf: 1 }).name).toBe('not_recorded');
  });
  it('throws without the run or the source file', () => {
    expect(() => iaEngine(meta, { sourceUrl: src })).toThrow(/run/);
    expect(() => iaEngine(meta, { run })).toThrow(/sourceUrl/);
  });
  it('the estimator reads such a page as the Archive route with the ingest run as its job', () => {
    const ocr = { source: 'ia_djvu', model: 'ia-ocr/0.0.21', engine: iaEngine(meta, { run, sourceUrl: src, leaf: 7 }), ia: { engine: meta.engine, ingest_run: run } };
    const p = P.provenanceFromRaw(P.rawFromSub(ocr), 'ocr', P.covariatesFromSub(ocr));
    expect(p).toMatchObject({ engine: 'ia-ocr', prompt_id: 'n/a', read_mode: 'image', access: 'archive', job_id: run });
  });
});
