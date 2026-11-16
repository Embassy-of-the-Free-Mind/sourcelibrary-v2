/**
 * The spare lane's paired-fifths round (v3#197): which round the lane starts, how its pooled comment is posted, how
 * the uniform stratum spreads books over language x form cells, and what the pooled report counts toward repair.
 * Pure parts only; nothing here reads Mongo or calls a model.
 */
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { allocate, bigCells, cellOf, summariseRow, poolMarkdown, callsMade } from '../../scripts/audit/spare-paired-fifths.mjs';
import { parseBookList, evidencePath } from '../../scripts/eval/paired-fifths-check.mjs';
import { mulberry32 } from '../../scripts/lib/paired-fifths.mjs';

function py(body: string, env: Record<string, string> = {}): string {
  const code = `
import importlib.util, datetime as dt, json
spec = importlib.util.spec_from_file_location("spare_lane", "scripts/workers/spare-lane.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
${body}`;
  const r = spawnSync('python3', ['-c', code], { encoding: 'utf8', env: { ...process.env, SPARE_LANE_ROUND: '', ...env } });
  expect(r.stderr).toBe('');
  return r.stdout.trim();
}

const drain = `
reset = (m.NOW + dt.timedelta(hours=5)).isoformat()
limits = {"weekly_all": {"percent": 91, "resets_at": reset}, "session": {"percent": 0}}
m.STATE = "/nonexistent/state.json"
m.DRY = True
m.this_box_account = lambda: "a@x"
m.account_limits = lambda: ("a@x", limits)
m.lane_jobs = lambda: []
m.os.getloadavg = lambda: (0.0, 0.0, 0.0)
m.pending_digest = lambda state: None
m.box_ready = lambda: "yes"
m.log = lambda s: print(s.split(" ")[1])
m.main()
`;

describe('the spare round the lane starts', () => {
  it('is a paired-fifths round by default', () => {
    expect(py(drain)).toMatch(/^spare-pf-\d{8}-1$/);
  });
  it('is never the retired #6420 convergent round, even with SPARE_LANE_ROUND=convergent (v3#381)', () => {
    expect(py(drain, { SPARE_LANE_ROUND: 'convergent' })).toMatch(/^spare-pf-\d{8}-1$/);
  });
});

describe('the pooled comment', () => {
  it('posts each kind of round once, and marks the week posted only when every kind is', () => {
    const out = py(`
calls = []
class R:
    def __init__(self, rc): self.returncode, self.stderr = rc, "boom" if rc else ""
fail = {"paired-fifths": True}
def run(cmd, **kw):
    kind = "paired-fifths" if "scripts/audit/spare-paired-fifths.mjs" in cmd else "convergent"
    calls.append(kind)
    return R(1 if fail.get(kind) else 0)
m.subprocess.run = run
m.box_name = lambda: "main"
m.save_state = lambda s: None
m.log = lambda s: None
past = (m.NOW - dt.timedelta(hours=2)).strftime("%Y-%m-%dT%H")
state = {"audit": {f"a@x|{past}": {"runs": ["/j/spare-audit-1"], "pf_runs": ["/j/spare-pf-1"], "posted": False}}}
m.post_pooled_audits(state, [])
rec = state["audit"][f"a@x|{past}"]
print(json.dumps([calls, rec["posted_kinds"], bool(rec["posted"])]))
fail["paired-fifths"] = False
m.post_pooled_audits(state, [])
print(json.dumps([calls, rec["posted_kinds"], bool(rec["posted"])]))
`);
    expect(out.split('\n').map((l) => JSON.parse(l))).toEqual([
      [['convergent', 'paired-fifths'], ['convergent'], false],
      [['convergent', 'paired-fifths', 'paired-fifths'], ['convergent', 'paired-fifths'], true],
    ]);
  });
  it('waits while a round of the week is still running', () => {
    const out = py(`
m.subprocess.run = lambda cmd, **kw: print("posted")
m.box_name = lambda: "main"
past = (m.NOW - dt.timedelta(hours=2)).strftime("%Y-%m-%dT%H")
m.post_pooled_audits({"audit": {f"a@x|{past}": {"runs": [], "pf_runs": ["/j/spare-pf-20990101-1"], "posted": False}}}, ["spare-pf-20990101-1"])
print("waited")
`);
    expect(out).toBe('waited');
  });
});

describe('uniform cells', () => {
  const book = (language: string, extra: Record<string, unknown> = {}) => ({ language, title: 'A book', published: '1650', ...extra });
  it('keeps a language x form cell with enough books and pools the rest by form', () => {
    const books = [...Array(5)].map(() => book('Latin')).concat([book('Latin', { published: '1300' }), book('Welsh')]);
    const big = bigCells(books, 5);
    expect([...big]).toEqual(['Latin/print']);
    expect(cellOf(book('Latin'), big)).toBe('Latin/print');
    expect(cellOf(book('Latin', { published: '1300' }), big)).toBe('other/ms');
    expect(cellOf(book('Welsh'), big)).toBe('other/print');
  });
  it('gives each slot to the cell with the fewest books this month, skipping a cell that ran dry', () => {
    const got = allocate(['A', 'B', 'C', 'D'], { A: 3, B: 0, C: 1 }, 6, mulberry32(1), new Set(['D']));
    const n = (c: string) => got.filter((x) => x === c).length;
    expect(got).toHaveLength(6);
    expect(n('D')).toBe(0);
    // B 0 -> 3, C 1 -> 3 (or one of them 4), A stays 3: the floor rises evenly.
    expect(n('A') + n('B') + n('C')).toBe(6);
    expect(Math.max(3 + n('A'), n('B'), 1 + n('C')) - Math.min(3 + n('A'), n('B'), 1 + n('C'))).toBeLessThanOrEqual(1);
  });
});

describe('the pooled report', () => {
  const row = (stratum: string, cell: string | null, verdict: string, findings: object[], exposure = 'served') => ({
    book_id: `${stratum}-${cell}-${verdict}`, run_id: 'r', frame: { stratum, cell }, verdict,
    pages_read: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], page_findings: findings,
    exposure: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((page_number) => ({ page_number, exposure })),
  });
  it('counts toward repair only served pages with a serious OCR or wrong-leaf finding', () => {
    const s = summariseRow(row('uniform', 'Latin/print', 'caveat', [
      { page_number: 1, errors: [{ stage: 'ocr', problem: 'misread' }] },
      { page_number: 2, errors: [{ stage: 'translation', problem: 'negation' }] },
      { page_number: 3, wrong_page: true, errors: [{ stage: 'ocr', kind: 'carry_over', problem: 'page break: carry_over — "x"' }] },
    ]));
    expect(s).toMatchObject({ serious_pages: 3, ocr_pages: 2, translation_pages: 1, break_findings: 1, to_queue: 2 });
    const hidden = summariseRow(row('risk', null, 'fix', [{ page_number: 1, errors: [{ stage: 'ocr', problem: 'x' }] }], 'withheld'));
    expect(hidden.to_queue).toBe(0);
  });
  it('does not count a page with no English yet as a wrong English page', () => {
    const s = summariseRow(row('uniform', 'Chinese/print', 'caveat', [
      { page_number: 1, errors: [{ stage: 'translation', class: 'T1', problem: 'no English translation was supplied for the page' }] },
    ], 'no_english'));
    expect(s).toMatchObject({ verdict: 'show', untranslated_only: true, serious_pages: 0, translation_pages: 0, to_queue: 0 });
    const ocrToo = summariseRow(row('uniform', 'Chinese/print', 'caveat', [
      { page_number: 1, errors: [{ stage: 'ocr', problem: 'misread' }, { stage: 'translation', class: 'T1', problem: 'none' }] },
    ], 'no_english'));
    expect(ocrToo).toMatchObject({ verdict: 'caveat', untranslated_only: false, serious_pages: 1, ocr_pages: 1, translation_pages: 0 });
  });
  it('reports the strata apart and weights the uniform cells by served books', () => {
    const rows = [
      row('uniform', 'Latin/print', 'show', []),
      row('uniform', 'Greek/print', 'fix', [{ page_number: 1, errors: [{ stage: 'ocr', problem: 'x' }] }]),
      row('risk', null, 'caveat', [{ page_number: 4, errors: [{ stage: 'ocr', problem: 'y' }] }]),
    ].map(summariseRow);
    const md = poolMarkdown(rows, { label: 'main, week to 2099-01-01', population: { 'Latin/print': 900, 'Greek/print': 100 }, rounds: 1 });
    expect(md).toContain('| uniform | 2 | 1 | 0 | 1 |');
    expect(md).toContain('| risk | 1 | 0 | 1 | 0 |');
    expect(md).toContain('| Greek/print | 1 | 0 | 0 | 1 |');
    expect(md).toContain('**90% of books show**');
    expect(md).toContain('**To repair:** 2 served page(s)');
  });
});

describe('paired-fifths-check book lists', () => {
  it('reads plain ids and JSON lines, keeping only stratum, cell and round for the frame', () => {
    expect(parseBookList('a, b\nc')).toEqual([{ id: 'a', frame: {} }, { id: 'b', frame: {} }, { id: 'c', frame: {} }]);
    expect(parseBookList('{"book_id":"x","stratum":"uniform","cell":"Latin/print","round":"r1","title":"no"}\n')).toEqual([
      { id: 'x', frame: { stratum: 'uniform', cell: 'Latin/print', round: 'r1' } },
    ]);
    expect(() => parseBookList('{"stratum":"risk"}')).toThrow(/book_id/);
  });
  it('records evidence in the repo as a relative path and scratch evidence as an absolute one', () => {
    expect(evidencePath(`${process.cwd()}/scripts/eval/results/paired-fifths-check/r.json`)).toBe('scripts/eval/results/paired-fifths-check/r.json');
    expect(evidencePath('/mnt/jobs/spare-pf/r/evidence/r.json')).toBe('/mnt/jobs/spare-pf/r/evidence/r.json');
  });
});

describe('the daily lane\'s call cap (v3#381)', () => {
  it('counts every call made, failed ones too, across the strata of a round', () => {
    expect(callsMade([{ attempts: 7, books: { a: { calls: { '1/2': {} } } } }, { attempts: 3 }])).toBe(10);
  });
  it('falls back to the stored calls for an evidence file from before the counter', () => {
    expect(callsMade([{ books: { a: { calls: { '1/2': {}, '3/4': {} } }, b: { calls: { '5/6': {} } } } }])).toBe(3);
  });
  it('is zero for a round not yet started', () => {
    expect(callsMade([])).toBe(0);
  });
});
