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
import { buildExperiments, buildIndex } from '../../scripts/eval/build-experiments.mjs';

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

  // #7263: a judged OCR/translation result must reach the router table, or say why not.
  const judged = { stage: 'ocr', measure: ['accuracy', 'judged'], verdict: 'x', status: 'informational' };
  const routerCells = new Set(['latin-lite', 'german-lite']);
  const one = (h: object) => ({ '2026-10-28-route.md': entry(serializeHeader(h), '2026-10-28') });

  it('refuses a NEW judged OCR result without router_evidence (negative control: passes when not new)', () => {
    const d = tmp(one(judged));
    expect(lintExperiments(d, { canons, routerCells, added: ['2026-10-28-route.md'] }).errors).toEqual([expect.stringContaining('needs router_evidence')]);
    expect(lintExperiments(d, { canons, routerCells }).errors).toEqual([]);
  });

  it('accepts router_evidence as known cell ids or "none — why"; refuses an unknown cell or a bare "none"', () => {
    const lint = (re: unknown) => lintExperiments(tmp(one({ ...judged, router_evidence: re })), { canons, routerCells, added: ['2026-10-28-route.md'] }).errors;
    expect(lint(['latin-lite', 'german-lite'])).toEqual([]);
    expect(lint('none — judged a prompt, not a route')).toEqual([]);
    expect(lint(['latin-lite', 'klingon-lite'])).toEqual([expect.stringContaining("cell 'klingon-lite'")]);
    expect(lint('none')).toEqual([expect.stringContaining('router_evidence must be')]);
  });

  // #6740: from 2026-10-30 an OCR/translation result carries its defect rates per 1,000 words, or says why not.
  const dr = { ...judged, router_evidence: 'none — a test' };
  const dated = (h: object, d: string) => ({ [`${d}-route.md`]: entry(serializeHeader(h), d) });
  it('refuses a NEW ocr result dated 2026-10-30 without defect_rates; older or not-new entries pass (negative control)', () => {
    const d = tmp(dated(dr, '2026-10-30'));
    expect(lintExperiments(d, { canons, routerCells, added: ['2026-10-30-route.md'] }).errors).toEqual([expect.stringContaining('needs defect_rates')]);
    expect(lintExperiments(d, { canons, routerCells }).errors).toEqual([]);
    expect(lintExperiments(tmp(dated(dr, '2026-10-29')), { canons, routerCells, added: ['2026-10-29-route.md'] }).errors).toEqual([]);
  });
  it('accepts defect_rates as "none — why" or a file of the right shape; refuses a bare none, a missing file and a wrong shape', () => {
    const root = mkdtempSync(join(tmpdir(), 'dr-'));
    writeFileSync(join(root, 'good.json'), JSON.stringify({ cells: { 'latin-lite': { lite: { misleads_per_1k: 6.3, wrong_text_per_1k: 5.6, fidelity_mean: 3.4 } } } }));
    writeFileSync(join(root, 'bad.json'), JSON.stringify({ cells: { 'latin-lite': { lite: { accept: '24/60' } } } }));
    const lint = (v: unknown) => readExperiment(entry(serializeHeader({ ...dr, defect_rates: v }), '2026-10-30'), { name: '2026-10-30-route.md', repoRoot: root }).problems;
    expect(lint('good.json')).toEqual([]);
    expect(lint('none — a prompt test, nothing judged for defects')).toEqual([]);
    expect(lint('none')).toEqual([expect.stringContaining('not a readable JSON')]);
    expect(lint('missing.json')).toEqual([expect.stringContaining('not a readable JSON')]);
    expect(lint('bad.json')).toEqual([expect.stringContaining('carries no route')]);
  });

  it('does not ask an unjudged or non-routing entry for router_evidence', () => {
    for (const h of [{ ...judged, measure: 'accuracy' }, { ...judged, stage: 'metadata' }]) {
      expect(lintExperiments(tmp(one(h)), { canons, routerCells, added: ['2026-10-28-route.md'] }).errors).toEqual([]);
    }
  });
});

// #6553: feeds / landed on new entries, and supersedes on the later entry deriving the earlier one's status.
describe('feeds, landed and supersedes', () => {
  const base = { stage: 'metadata', measure: 'none', verdict: 'x', status: 'informational' };
  const at = (h: object, d = '2026-11-05') => entry(serializeHeader(h), d);
  const name = '2026-11-05-new.md';

  it('refuses a NEW entry dated 2026-11-05 on without feeds; an older or not-new one passes (negative control)', () => {
    const d = tmp({ [name]: at(base) });
    expect(lintExperiments(d, { canons, added: [name] }).errors).toEqual([expect.stringContaining('needs feeds')]);
    expect(lintExperiments(d, { canons }).errors).toEqual([]);
    expect(lintExperiments(tmp({ '2026-11-04-new.md': at(base, '2026-11-04') }), { canons, added: ['2026-11-04-new.md'] }).errors).toEqual([]);
  });

  it('an adopted entry that feeds something needs landed; feeds none does not', () => {
    const lint = (h: object) => lintExperiments(tmp({ [name]: at({ ...base, ...h }) }), { canons, added: [name] }).errors;
    expect(lint({ status: 'adopted', feeds: 'route' })).toEqual([expect.stringContaining('needs landed')]);
    expect(lint({ status: 'adopted', feeds: 'none' })).toEqual([]);
    expect(lint({ status: 'rejected', feeds: 'route' })).toEqual([]);
    expect(lint({ status: 'adopted', feeds: 'route', landed: 'PR #7874' })).toEqual([]);
    expect(lint({ status: 'rejected', feeds: 'tea' })).toEqual([expect.stringContaining("feeds 'tea'")]);
  });

  it('landed: a path must exist (an #anchor is allowed); a PR must be merged when the lint can ask', () => {
    const root = mkdtempSync(join(tmpdir(), 'landed-'));
    writeFileSync(join(root, 'table.json'), '{}');
    const probs = (v: unknown) => readExperiment(at({ ...base, status: 'adopted', feeds: 'route', landed: v }), { name, repoRoot: root }).problems;
    expect(probs('table.json#latin-lite/print')).toEqual([]);
    expect(probs('gone.json')).toEqual([expect.stringContaining('does not exist')]);
    expect(probs('/etc/passwd')).toEqual([expect.stringContaining('repo path')]);
    const h = { ...base, status: 'adopted', feeds: 'route', landed: ['PR #1', 'PR #2'] };
    const errs = lintExperiments(tmp({ [name]: at(h) }), { canons, added: [name], prState: (n: number) => (n === 1 ? 'MERGED' : 'OPEN') }).errors;
    expect(errs).toEqual([expect.stringContaining('landed PR #2 is OPEN')]);
  });

  it('supersedes on the later entry marks the earlier one superseded in the index, keeping status_declared', () => {
    const old = '2026-10-30-old.md';
    const d = tmp({
      [old]: at({ ...base, status: 'rejected' }, '2026-10-30'),
      '2026-11-04-later.md': at({ ...base, feeds: 'none', supersedes: [old] }, '2026-11-04'),
      '2026-10-01-other.md': at({ ...base, status: 'adopted' }, '2026-10-01'),
    });
    const { entries, problems } = buildIndex(d);
    expect(problems).toEqual([]);
    const byFile = Object.fromEntries(entries.map((e: { file: string }) => [e.file, e]));
    expect(byFile[old]).toMatchObject({ status: 'superseded', superseded_by: '2026-11-04-later.md', status_declared: 'rejected' });
    expect(byFile['2026-10-01-other.md']).toMatchObject({ status: 'adopted', superseded_by: null });
    expect(lintExperiments(d, { canons }).errors).toEqual([]);
  });

  it('refuses supersedes naming a missing file or itself', () => {
    const probs = (v: unknown) => readExperiment(at({ ...base, supersedes: v }), { name, exists: (x: string) => x === 'a.md' }).problems;
    expect(probs(['a.md'])).toEqual([]);
    expect(probs(['b.md'])).toEqual(['supersedes b.md does not exist']);
    expect(probs([name])).toEqual(['supersedes names the file itself']);
  });
});
