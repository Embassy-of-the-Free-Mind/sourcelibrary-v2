// brief-route-check.sh (#7701): an OCR/translation brief that writes must name its router cell and k/n.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve(__dirname, '../../scripts/workers/brief-route-check.sh');
const check = (brief: string, landings = '') => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-'));
  const f = path.join(dir, 'brief.md');
  fs.writeFileSync(f, brief);
  fs.writeFileSync(path.join(dir, 'landings.txt'), landings);
  const r = spawnSync('bash', [SCRIPT, f], { encoding: 'utf8', env: { ...process.env, JOB_LANDINGS: path.join(dir, 'landings.txt') } });
  return { code: r.status, out: r.stdout.trim() };
};
/** PATH shims that fail the way macOS's date and paste do: no -d, and paste wants a file operand. */
const bsdShims = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bsd-'));
  fs.writeFileSync(path.join(dir, 'date'), '#!/bin/sh\nfor a in "$@"; do case "$a" in -d) echo "date: illegal option -- d" >&2; exit 1 ;; -v-48H) exec /usr/bin/env -i PATH=/usr/bin:/bin date -u -d "48 hours ago" +%FT%TZ ;; esac; done\nexec /usr/bin/env -i PATH=/usr/bin:/bin date "$@"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'paste'), '#!/bin/sh\nlast=""; for a in "$@"; do last="$a"; done\n[ "$last" = "-" ] || { echo "usage: paste [-s] [-d delimiters] file ..." >&2; exit 1; }\nexec /usr/bin/env -i PATH=/usr/bin:/bin paste "$@"\n', { mode: 0o755 });
  return dir;
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
  it('warns, never refuses, when the Lands issue had a job land in the last 48 h and the brief has no Moves line', () => {
    const iso = (h: number) => new Date(Date.now() - h * 3600_000).toISOString().replace(/\.\d+Z$/, 'Z');
    const line = (h: number, n: number) => `${iso(h)} | main | read-surface-${n} | ok https://x/pull/1 [#${n} from Lands header; PR: yes]\n`;
    const r = check('Lands: #7830\nPR: yes\n# Task\nFix the gallery CSS.\n', line(5, 7830));
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^skip: .*\nwarn: #7830 had a job land in the last 48 h \(read-surface-7830 \(main, /);
    expect(check('Lands: #7830\nMoves: switch the default reader if B beats A\n# Task\nFix CSS.\n', line(5, 7830)).out).not.toMatch(/warn:/);
    expect(check('Lands: #7830\n# Task\nFix CSS.\n', line(60, 7830)).out).not.toMatch(/warn:/);
    expect(check('Lands: #7830\n# Task\nFix CSS.\n', line(5, 78301)).out).not.toMatch(/warn:/);
    expect(check('Lands: #1\nRoute: none\n' + WRITE, line(5, 1))).toMatchObject({ code: 8 });
  });
  it('the 48-hour landing check works on BSD date and paste too (it silently did nothing on macOS)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-'));
    const f = path.join(dir, 'brief.md');
    fs.writeFileSync(f, 'Lands: #7830\nPR: yes\n# Task\nFix the gallery CSS.\n');
    const iso = (h: number) => new Date(Date.now() - h * 3600_000).toISOString().replace(/\.\d+Z$/, 'Z');
    fs.writeFileSync(path.join(dir, 'l.txt'), `${iso(5)} | main | new-7830 | ok [#7830 from Lands header]\n${iso(60)} | main | old-7830 | ok [#7830 from Lands header]\n`);
    const r = spawnSync('bash', [SCRIPT, f], { encoding: 'utf8', env: { ...process.env, JOB_LANDINGS: path.join(dir, 'l.txt'), PATH: `${bsdShims()}:${process.env.PATH}` } });
    expect(r.stderr).toBe('');
    expect(r.stdout).toMatch(/warn: #7830 had a job land in the last 48 h \(new-7830/);
    expect(r.stdout).not.toMatch(/old-7830/);
  });
  it('warns, never refuses, when a brief reads pages against their images and has no Checks line', () => {
    const r = check('Lands: #none\nPR: no\n# Task\nRead 30 pages against the page image and report the rate.\n');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/\nwarn: this brief reads pages against their images and has no 'Checks:' line/);
    expect(check('# Task\nAn Opus judge reads the lane output.\n').out).toMatch(/Checks:/);
    expect(check('# Task\nA spot check of 10 pages.\n').out).toMatch(/Checks:/);
    expect(check('Checks: lane-spot-check\n# Task\nRead 30 pages against the page image.\n').out).not.toMatch(/warn:/);
    expect(check('Checks: none — candidate text only\n# Task\nRead by eye.\n').out).not.toMatch(/warn:/);
    expect(check('# Task\nFix the gallery CSS.\n').out).not.toMatch(/warn:/);
    // Beside a refusal it does not change the refusal.
    expect(check('# Task\nOCR the visible books with cli-ocr-lane.mjs run --apply, by eye.\n').code).toBe(8);
  });
});
