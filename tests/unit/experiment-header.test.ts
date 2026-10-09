/**
 * Experiment write-ups as data (#5939): the header schema, its reader and the CI lint.
 *
 * The header is what the index and the public pages read instead of a person
 * editing them; a header the reader mis-parses would silently put a superseded
 * result back on a page. These pin the parser, the validator, the round trip,
 * the builder leaving the header out of EXPERIMENTS.md, and the lint's
 * grandfathering of old files vs refusal of new ones.
 */
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it, expect, afterAll } from 'vitest';
import { parseHeader, validateHeader, readExperiment, serializeHeader, splitHeader } from '../../scripts/eval/lib/experiment-header.mjs';
import { lintExperiments } from '../../scripts/eval/experiments-lint.mjs';
import { buildExperiments } from '../../scripts/eval/build-experiments.mjs';

const dirs: string[] = [];
function tmp(files: Record<string, string>) {
  const d = mkdtempSync(join(tmpdir(), 'exp-header-'));
  for (const [n, t] of Object.entries(files)) writeFileSync(join(d, n), t);
  dirs.push(d);
  return d;
}
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const GOOD = {
  stage: 'translation', measure: 'judged_vs_reference', languages: ['sa', 'pi', 'lzh'], scripts: ['Deva', 'Hani'],
  canons: ['pali'], n_books: 68, n_pages: 68, verdict: 'Flash: fewer reversals # in all three: yes.', status: 'adopted',
  decision: 'Flash routes it (PR #5740)', superseded_by: null, issue: [5695, 5740],
};
const canons = new Set(['pali', 'derge-tengyur']);
const entry = (h: string, date = '2026-10-07') => `${h}<!-- PRIOR ART: none -->\n## ${date} · q (#1)\n\nbody\n`;

describe('experiment header', () => {
  it('round-trips through serializeHeader → parseHeader, with # and : inside quoted strings', () => {
    const text = serializeHeader(GOOD);
    expect(text.startsWith('---\nstage: translation\nmeasure: judged_vs_reference\n')).toBe(true);
    const { header } = splitHeader(text + 'body');
    expect(parseHeader(header!)).toEqual(GOOD);
    expect(validateHeader(GOOD, { canons })).toEqual([]);
  });

  it('reads plain, single-quoted and list values; refuses an unquoted value with ": "', () => {
    expect(parseHeader("stage: ocr\nverdict: 'it''s fine'\nissue: 12\nmeasure: [accuracy, agreement]\nlanguages: []\n"))
      .toEqual({ stage: 'ocr', verdict: "it's fine", issue: 12, measure: ['accuracy', 'agreement'], languages: [] });
    expect(() => parseHeader('verdict: Flash wins: by far\n')).toThrow(/quote/);
    expect(() => parseHeader('stage: ocr\nstage: image\n')).toThrow(/duplicate/);
  });

  it('flags bad enums, codes, canons and a superseded entry without its successor', () => {
    const p = validateHeader({ ...GOOD, stage: 'ocrx', measure: 'vibes', languages: ['Latin'], scripts: ['latin'], canons: ['narnia'], status: 'superseded', n_books: -1 }, { canons });
    for (const frag of ["stage 'ocrx'", "measure 'vibes'", "language 'Latin'", "script 'latin'", "canon 'narnia'", 'needs superseded_by', "'n_books'"]) {
      expect(p.some((x) => x.includes(frag))).toBe(true);
    }
    expect(validateHeader({ ...GOOD, status: 'superseded', superseded_by: 'gone.md' }, { exists: () => false })).toEqual(['superseded_by gone.md does not exist']);
    expect(validateHeader({ ...GOOD, foo: 1 }).some((x) => x.includes("unknown field 'foo'"))).toBe(true);
  });

  it('a file with no header has no problems; an unclosed one does', () => {
    expect(readExperiment('## 2026-10-01 · q\n').problems).toEqual([]);
    expect(readExperiment('---\nstage: ocr\n## 2026-10-01 · q\n').problems[0]).toMatch(/never closed/);
  });

  it('the builder leaves the header out of EXPERIMENTS.md and still checks the heading under it', () => {
    const d = tmp({ 'README.md': '# Log\n', '2026-10-07-x.md': entry(serializeHeader(GOOD)) });
    const { text, problems } = buildExperiments(d);
    expect(problems).toEqual([]);
    expect(text).not.toContain('judged_vs_reference');
    expect(text).toContain('## 2026-10-07 · q (#1)');
  });
});

describe('experiments-lint', () => {
  const files = {
    'README.md': '# Log\n',
    '2026-09-01-old.md': '## 2026-09-01 · old\n',
    '2026-10-07-new.md': entry(serializeHeader(GOOD)),
    '2026-10-07-bare.md': entry(''),
    '_note-x.md': '## note\n',
  };

  it('grandfathers headerless entries already on main, and checks every header present', () => {
    const { errors, grandfathered } = lintExperiments(tmp(files), { canons });
    expect(errors).toEqual([]);
    expect(grandfathered).toEqual(['2026-09-01-old.md', '2026-10-07-bare.md']);
  });

  it('refuses a NEW entry without a header (negative control: the same file passes when not new)', () => {
    const { errors } = lintExperiments(tmp(files), { canons, added: ['2026-10-07-bare.md'] });
    expect(errors).toEqual([expect.stringContaining('2026-10-07-bare.md: no header')]);
  });

  it('--strict refuses every headerless dated entry, never a note or series', () => {
    const { errors } = lintExperiments(tmp(files), { canons, strict: true });
    expect(errors.map((e) => e.split(':')[0]).sort()).toEqual(['2026-09-01-old.md', '2026-10-07-bare.md']);
  });

  it('refuses an invalid header on an old file', () => {
    const { errors } = lintExperiments(tmp({ ...files, '2026-09-01-old.md': entry('---\nstage: ocr\n---\n', '2026-09-01') }), { canons });
    expect(errors.some((e) => e.includes("'measure' is required"))).toBe(true);
  });
});
