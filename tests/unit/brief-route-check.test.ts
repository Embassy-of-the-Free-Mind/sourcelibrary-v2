// brief-route-check.sh (#7701): an OCR/translation brief that writes must name its router cell and k/n.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve(__dirname, '../../scripts/workers/brief-route-check.sh');
const check = (brief: string) => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'brief-')), 'brief.md');
  fs.writeFileSync(f, brief);
  const r = spawnSync('bash', [SCRIPT, f], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout.trim() };
};
const WRITE = '\n# Task\nOCR the visible books with cli-ocr-lane.mjs run --apply.\n';

describe('brief-route-check.sh', () => {
  it('refuses an OCR write brief with no Route line', () => {
    const r = check('Lands: #1\nPR: yes\n' + WRITE);
    expect(r.code).toBe(8);
    expect(r.out).toMatch(/^REFUSED: .*names no router cell/);
  });
  it('accepts a measured k/n', () => {
    expect(check('Lands: #1\nRoute: German print, lite text → lite>agy-flash-low 28/30\n' + WRITE)).toEqual({ code: 0, out: 'ok: German print, lite text → lite>agy-flash-low 28/30' });
  });
  it('accepts an untested cell that is tested first', () => {
    expect(check('Route: untested → cell test (30 pages, blind Opus judge)\n' + WRITE).code).toBe(0);
  });
  it('accepts none with a reason, refuses a bare none or a model name', () => {
    expect(check('Route: none — eval only, no production writes\n' + WRITE).code).toBe(0);
    expect(check('Route: none\n' + WRITE).code).toBe(8);
    expect(check('Route: agy flash\n' + WRITE).code).toBe(8);
    expect(check('Route: untested\n' + WRITE).code).toBe(8);
  });
  it('ignores a Route line below the header and briefs that write no OCR or translation', () => {
    expect(check('Lands: #1\n' + '\n'.repeat(20) + 'Route: x 1/2\n' + WRITE).code).toBe(8);
    expect(check('Lands: #1\n# Task\nFix the gallery CSS and open a PR.\n')).toEqual({ code: 0, out: 'skip: not an OCR/translation write brief' });
    expect(check('Lands: #1\n# Task\nSummarise the OCR eval results; read only.\n').code).toBe(0);
  });
});
