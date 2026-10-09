/**
 * scripts/audit/routing-drift.mjs (#5871): does the code route what the ledger decided?
 *
 * The comparison is exercised on a small ledger and injected routers, so a routing change or a new
 * ledger row never turns this file red: only the audit's own logic can. Each finding class has a clean
 * case and a planted drift. The ledger fixture's Stratum, Question and Decision cells are copied from
 * scripts/eval/DECISIONS.md as of 2026-10-05 (Evidence shortened), because the parser's contract is
 * with that file's shape.
 *
 * The one check against the real repo is `--ci`, which fails on a stale generated table and on
 * nothing else.
 */
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  parseLedger, buildGrid, selects, auditRouting, positiveControl, ledgerRowDate, syncIssues, issueBody, summarise,
  loadInputs, CLASSES, LABEL, PENDING_MAX_DAYS,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/audit/routing-drift.mjs';

const ROOT = path.resolve(__dirname, '../..');
const HEAD = '| Stratum | Question | Evidence | Rule output / proposal | Decision | Applied in | Re-measure when |\n|---|---|---|---|---|---|---|';
const GREEK = '| Greek (exception to the cost switch) | read Greek on flash (Batch) again, instead of lite? | #5575 | flash for visible Greek and for Greek books created from 2026-10-02; hidden Greek backlog stays lite | DECIDED Derek 2026-10-02 (Chinese taken out the same day, pending Paddle vs Flash on non-SKQS pages, #5574) | `isGreekFlashOcrBook` in `scripts/lib/ocr-routing.mjs` | #4884 relabels the hidden Greek books |';
const PERSIAN = '| Persian — HIDDEN backlog (55.6K pp) | override the #5795 rule\'s (b) failure? | #5795 row above | override | DECIDED Derek 2026-10-04 ("yes") | `FLASH_OCR_INCLUDES_HIDDEN` in `scripts/lib/ocr-routing.mjs` | loop-guard refusals on Persian flash pages exceed 5% |';
const HEBREW = '| Hebrew Rashi script | is Rashi OCR usable (#350 closed unmeasured)? | 4 Hebrew references, all square script | UNJUDGED | — | — | #5125 lands ≥ 30 referenced pages |';
const NONLATIN = '| All non-Latin-script books | translation on lite instead of flash? | #4759 | route translation to lite (≈ $12K/yr) | DECIDED Derek 2026-09 (#4759) | PR #4762 (commit 6edf9b4c) | a source-grounded fidelity judge is run |';
const FLASH_TR = '| Greek, Hebrew/Aramaic, Arabic, Persian, Sanskrit, Pali, Chinese (translation) | flash instead of lite, judged against published human translations? | #5695 | route these languages\' translation to flash | PENDING Derek (PR #5740, tier:hold) | PR #5740 | a cheaper model beats flash |';
const V16 = '| Prompt v16 (v15 + note-scope sentence) | flip v13 → v16? | #3825 | NOT ESTABLISHED: keep v13 | DECIDED (rule) 2026-10-03 | — | a v17 typed-apparatus candidate (#5698) |';
const IMAGES = '| Image extraction model (#4747) | lite instead of flash (rests on 5 pages from 2026-03)? | none yet | rule pre-stated | PENDING Derek\'s yes to spend | — | the test runs |';

const ledger = (ocr: string[], tr: string[], other: string[]) => [
  '# OCR and translation decisions — the ledger', '',
  '## OCR engine per stratum', '', HEAD, ...ocr, '',
  '## Translation', '', HEAD, ...tr, '',
  '## Other lanes', '', HEAD.replace('| Stratum |', '| Lane |'), ...other, '',
].join('\n');

const LANGS = [{ family: 'lat', name: 'Latin' }, { family: 'grc', name: 'Greek' }, { family: 'fas', name: 'Persian' }, { family: 'heb', name: 'Hebrew' }];
type Over = { ocr?: Record<string, Record<string, string>>; translate?: Record<string, string>; gate?: string[] };
/** Routers that do what the fixture ledger decided, plus overrides. */
const routers = (over: Over = {}) => ({
  ocr: (_f: string, name: string) => ({
    visible: 'lite', new: 'lite', 'hidden backlog': 'lite',
    ...(name === 'Greek' ? { visible: 'flash', new: 'flash' } : {}),
    ...(name === 'Persian' ? { 'hidden backlog': 'flash' } : {}),
    ...(over.ocr?.[name] || {}),
  }),
  translate: (language: string | null, provider: string) => over.translate?.[`${language}/${provider}`] ?? over.translate?.[String(language)] ?? 'lite',
  gate: (language: string | null) => (over.gate?.includes(String(language)) ? { value: 'refuse', stratum: `${String(language).toLowerCase()}-row` } : { value: 'translate', stratum: null }),
  constants: { OCR_LITE_ONLY: 'on' },
  ocrFamilies: ['grc', 'fas'],
  gateRows: [] as string[],
});

const ROWS = parseLedger(ledger([GREEK, PERSIAN, HEBREW], [NONLATIN, FLASH_TR, V16], [IMAGES]));
const id = (stratumStart: string) => ROWS.find((r: { stratum: string }) => r.stratum.startsWith(stratumStart)).id as string;
const MAP = {
  rows: {
    [id('Greek (exception')]: { probes: [{ fn: 'ocr', language: 'Greek', visibility: ['visible', 'new'], expect: 'flash' }, { fn: 'ocr', language: 'Greek', visibility: 'hidden backlog', expect: 'lite' }, { fn: 'constant', name: 'OCR_LITE_ONLY', expect: 'on' }] },
    [id('Persian — HIDDEN')]: { probes: [{ fn: 'ocr', language: 'Persian', visibility: 'hidden backlog', expect: 'flash' }] },
    [id('All non-Latin')]: { probes: [{ fn: 'translate', language: ['Greek', 'Persian', 'Hebrew'], expect: 'lite' }] },
    [id('Greek, Hebrew/Aramaic')]: { probes: [{ fn: 'translate', language: ['Greek', 'Hebrew', 'Persian'], expect: 'flash' }] },
    [id('Prompt v16')]: { not_routing: 'prompt version' },
  },
};
const NOW = new Date('2026-10-05T12:00:00Z');
const run = (o: { over?: Over; rows?: unknown; map?: unknown; table?: unknown; rowDate?: unknown; r?: unknown } = {}) => {
  const r = o.r ?? routers(o.over);
  return auditRouting({ rows: o.rows ?? ROWS, map: o.map ?? MAP, grid: buildGrid(LANGS, r), routers: r, table: o.table ?? { committed: 'T', rendered: 'T' }, now: NOW, rowDate: o.rowDate ?? (() => ({ date: '2026-10-01', source: 'fixture' })) });
};
const texts = (fs: { text: string }[]) => fs.map((f) => f.text).join('\n');

describe('routing-drift — the ledger parser', () => {
  it('reads all three tables, with status, line and a stable id per row', () => {
    expect(ROWS.map((r: { section: string }) => r.section)).toEqual(['ocr', 'ocr', 'ocr', 'translation', 'translation', 'translation', 'other']);
    expect(ROWS.map((r: { status: string }) => r.status)).toEqual(['decided', 'decided', 'unjudged', 'decided', 'pending', 'decided', 'pending']);
    expect(ROWS[0].id).toBe('ocr/greek-exception-to-the-cost-switch--read-greek-on-flash-batch-again-instead');
    expect(ROWS[0].line).toBe(7);
    expect(ROWS[6].stratum).toBe('Image extraction model (#4747)');
  });

  it('gives a repeated row its own id, so the map can name each copy', () => {
    const twice = parseLedger(ledger([GREEK], [NONLATIN, V16, NONLATIN], [IMAGES]));
    const ids = twice.filter((r: { stratum: string }) => r.stratum === 'All non-Latin-script books').map((r: { id: string }) => r.id);
    expect(ids).toEqual(['translation/all-non-latin-script-books--translation-on-lite-instead-of-flash', 'translation/all-non-latin-script-books--translation-on-lite-instead-of-flash#2']);
    expect(twice.find((r: { id: string }) => r.id.endsWith('#2')).line).toBeGreaterThan(twice.find((r: { id: string }) => r.id === ids[0]).line);
  });
});

describe('routing-drift — the comparison', () => {
  it('CLEAN: routers that do what the ledger decided produce no finding in any class', () => {
    const { findings, counts } = run();
    for (const k of Object.keys(CLASSES)) expect([k, findings[k]]).toEqual([k, []]);
    expect(counts).toMatchObject({ rows: 7, decided: 4, decided_probed: 3, decided_not_routing: 1, pending: 2, off_default: 3 });
  });

  it('(a) PLANTED: the code stops doing what a DECIDED row says', () => {
    const { findings } = run({ over: { ocr: { Greek: { visible: 'lite' } } } });
    expect(findings.contradicted).toHaveLength(1);
    expect(findings.contradicted[0].text).toMatch(/DECISIONS\.md:7 "Greek \(exception to the cost switch\)" expects ocr = flash; the probe says: ocr → lite · Greek · visible\./);
    expect(findings.undecided).toEqual([]);
  });

  it('(a) PLANTED: a later change contradicts an older DECIDED row, and (b) names the PENDING row behind it', () => {
    const { findings } = run({ over: { translate: { 'Hebrew/none': 'flash' } } });
    expect(texts(findings.contradicted)).toMatch(/"All non-Latin-script books" expects translate = lite; the probe says: translate → flash · Hebrew · no provider/);
    expect(findings.undecided).toHaveLength(1);
    expect(findings.undecided[0].text).toMatch(/^translate → flash · Hebrew · no provider \(default lite\) — the ledger row for it is not DECIDED: DECISIONS\.md:\d+ "Greek, Hebrew\/Aramaic.*PENDING Derek/);
  });

  it('(a) PLANTED: an environment switch the row depends on is flipped', () => {
    const r = { ...routers(), constants: { OCR_LITE_ONLY: 'off' } };
    expect(texts(run({ r }).findings.contradicted)).toMatch(/expects OCR_LITE_ONLY = on; this environment has off/);
  });

  it('(b) PLANTED: a branch nobody decided — an OCR family, a provider carve-out, a gate row', () => {
    const { findings } = run({ over: { ocr: { Hebrew: { visible: 'flash', new: 'flash' } }, translate: { 'Latin/bph': 'flash' }, gate: ['Persian'] } });
    const t = texts(findings.undecided);
    expect(t).toMatch(/ocr → flash · Hebrew · visible; new \(default lite\) — no mapped ledger row/);
    expect(t).toMatch(/translate → flash · Latin · provider bph \(default lite\) — no mapped ledger row/);
    expect(t).toMatch(/gate → refuse \(persian-row\) · Persian · manuscript \(any period\); print \(any period\) \(default translate\) — no mapped ledger row/);
    expect(findings.contradicted).toEqual([]);
  });

  it('(b) a branch counts as decided only when the DECIDED row expects what the code does there', () => {
    // Persian's hidden backlog on flash is covered; the same cell on a third model is not.
    expect(run().findings.undecided).toEqual([]);
    const { findings } = run({ over: { ocr: { Persian: { 'hidden backlog': 'pro' } } } });
    expect(texts(findings.undecided)).toMatch(/ocr → pro · Persian · hidden backlog/);
    expect(findings.contradicted).toHaveLength(1);
  });

  it('(b) PLANTED: a routing constant the probe grid cannot reach is reported, not skipped', () => {
    const r = { ...routers(), ocrFamilies: ['grc', 'fas', 'cop'], gateRows: ['coptic-manuscript'] };
    const t = texts(run({ r }).findings.undecided);
    expect(t).toMatch(/`cop` is in FLASH_OCR_FROM/);
    expect(t).toMatch(/OCR_TRUST_TABLE row `coptic-manuscript` is gated but no probe cell lands in it/);
  });

  it('(c) PLANTED: a committed table that is not what the generator renders', () => {
    expect(run({ table: { committed: 'a\nold\nc', rendered: 'a\nnew\nc' } }).findings['stale-table'][0].text).toMatch(/1 table line\(s\) differ/);
    expect(run({ table: { committed: null, rendered: 'x' } }).findings['stale-table'][0].text).toMatch(/markers missing/);
    expect(run().findings['stale-table']).toEqual([]);
  });

  it(`(d) PLANTED: a PENDING row older than ${PENDING_MAX_DAYS} days; exactly ${PENDING_MAX_DAYS} days is not`, () => {
    const at = (date: string) => run({ rowDate: (r: { stratum: string }) => ({ date: r.stratum.startsWith('Image') ? date : '2026-10-04', source: 'fixture' }) });
    const old = at('2026-09-20').findings['pending-old'];
    expect(old).toHaveLength(1);
    expect(old[0].text).toMatch(/^15 days \(since 2026-09-20, fixture\): DECISIONS\.md:\d+ "Image extraction model \(#4747\)"/);
    expect(at('2026-09-21').findings['pending-old']).toEqual([]);
  });

  it('(d) a PENDING row with no date is a note, never a finding; a DECIDED row is never aged', () => {
    const r = run({ rowDate: () => ({ date: null, source: 'none' }) });
    expect(r.findings['pending-old']).toEqual([]);
    expect(r.notes).toHaveLength(2);
    expect(run({ rowDate: () => ({ date: '2020-01-01', source: 'fixture' }) }).findings['pending-old']).toHaveLength(2);
  });

  it('(e) PLANTED: a DECIDED row the map does not name, a map entry with no row, a probe with no cell', () => {
    const { [id('Persian — HIDDEN')]: _dropped, ...rest } = MAP.rows;
    const map = { rows: { ...rest, 'ocr/gone--row': { not_routing: 'x' }, [id('Prompt v16')]: { probes: [{ fn: 'ocr', language: 'Klingon', expect: 'lite' }] }, [id('Hebrew Rashi')]: {} } };
    const t = texts(run({ map }).findings.unmapped);
    expect(t).toMatch(/DECIDED row DECISIONS\.md:8 "Persian — HIDDEN backlog \(55\.6K pp\)" is not in the map \(id `ocr\/persian-hidden-backlog-55-6k-pp--override/);
    expect(t).toMatch(/map entry `ocr\/gone--row` names no ledger row/);
    expect(t).toMatch(/has a probe that selects no cell: `\{"fn":"ocr","language":"Klingon"/);
    expect(t).toMatch(/has neither `probes` nor `not_routing`/);
    // the unmapped Persian branch is then also an undecided one: nothing vouches for it
    expect(texts(run({ map }).findings.undecided)).toMatch(/ocr → flash · Persian · hidden backlog/);
  });

  it('an UNJUDGED or PENDING row does not have to be in the map', () => {
    expect(run().findings.unmapped).toEqual([]);
    expect(MAP.rows).not.toHaveProperty(id('Hebrew Rashi'));
    expect(MAP.rows).not.toHaveProperty(id('Image extraction'));
  });

  it('a translate selector without a provider speaks for books with none; BPH is its own branch', () => {
    expect(selects({ fn: 'translate', language: 'Greek', expect: 'flash' }, { fn: 'translate', language: 'Greek', provider: 'none' })).toBe(true);
    expect(selects({ fn: 'translate', language: 'Greek', expect: 'flash' }, { fn: 'translate', language: 'Greek', provider: 'bph' })).toBe(false);
    expect(selects({ fn: 'translate', language: '*', provider: 'bph', expect: 'flash' }, { fn: 'translate', language: 'Latin', provider: 'bph' })).toBe(true);
    expect(selects({ fn: 'gate', language: 'Greek', hand: 'print', period: ['1450–1500'], expect: 'refuse' }, { fn: 'gate', language: 'Greek', hand: 'print', period: '1600–1699' })).toBe(false);
  });

  it('summarise merges languages that share a branch', () => {
    const cells = buildGrid(LANGS, routers({ translate: { 'Latin/bph': 'flash', 'Greek/bph': 'flash' } })).filter((c: { fn: string; value: string }) => c.fn === 'translate' && c.value === 'flash');
    expect(summarise(cells)).toEqual(['translate → flash · Latin, Greek · provider bph']);
  });
});

describe('routing-drift — the instrument checks itself', () => {
  it('POSITIVE CONTROL: flipping a cell a DECIDED row vouches for raises (a)', () => {
    const r = routers(); const input = { rows: ROWS, map: MAP, grid: buildGrid(LANGS, r), routers: r, table: { committed: 'T', rendered: 'T' }, now: NOW, rowDate: () => ({ date: '2026-10-01', source: 'fixture' }) };
    expect(positiveControl({ ...input, baseline: auditRouting(input) })).toMatchObject({ ok: true });
    // with no DECIDED probe there is nothing to flip, and it says so instead of passing
    const none = { ...input, map: { rows: {} } };
    expect(positiveControl({ ...none, baseline: auditRouting(none) }).ok).toBeNull();
  });

  it('on the real ledger, map and routers the control fires (the audit can run here)', () => {
    const input = loadInputs({ now: NOW, git: false });
    const baseline = auditRouting(input);
    expect(input.rows.length).toBeGreaterThan(20);
    expect(baseline.counts.cells).toBeGreaterThan(300);
    expect(positiveControl({ ...input, baseline }).ok).not.toBe(false);
  });

  it('dates a row from its Decision cell first, then from the newest date anywhere in it', () => {
    const [greek, , , , pending] = ROWS;
    expect(ledgerRowDate(greek, { git: false })).toEqual({ date: '2026-10-02', source: 'Decision cell' });
    expect(ledgerRowDate(pending, { git: false })).toEqual({ date: null, source: 'none' });
    expect(ledgerRowDate({ ...pending, cells: [...pending.cells, 'run of 2026-09-30, redrawn 2026-10-02'] }, { git: false })).toEqual({ date: '2026-10-02', source: 'newest date in the row' });
  });
});

describe('routing-drift — one issue per class, closed when the class is empty', () => {
  const fake = (open: { number: number; title: string; body: string }[]) => {
    const calls: string[][] = [];
    const gh = (args: string[]) => { calls.push(args); return args[1] === 'list' ? JSON.stringify(open) : args[1] === 'create' ? 'https://example.test/issues/9' : ''; };
    return { gh, calls };
  };
  const planted = () => run({ over: { ocr: { Greek: { visible: 'lite' } } } }).findings;
  const verbs = (calls: string[][]) => calls.filter((a) => a[1] !== 'list').map((a) => `${a[1]} ${a[1] === 'create' ? a[a.indexOf('--title') + 1] : a[2]}`);

  it('files ONE issue for a class with findings, labelled, and nothing for the clean classes', () => {
    const { gh, calls } = fake([]);
    const out = syncIssues(planted(), { gh, day: '2026-10-05' });
    expect(verbs(calls)).toEqual([`create ${CLASSES.contradicted.title}`]);
    expect(calls[1]).toEqual(expect.arrayContaining(['--label', LABEL]));
    expect(out).toHaveLength(Object.keys(CLASSES).length);
  });

  it('leaves the issue alone while the findings are the same, rewrites it when they change', () => {
    const f = planted();
    const same = fake([{ number: 7, title: CLASSES.contradicted.title, body: issueBody('contradicted', f.contradicted, { day: '2026-10-04' }) }]);
    syncIssues(f, { gh: same.gh, day: '2026-10-05' });
    expect(verbs(same.calls)).toEqual([]);
    const changed = fake([{ number: 7, title: CLASSES.contradicted.title, body: issueBody('contradicted', [{ key: 'another', text: 'x' }], { day: '2026-10-04' }) }]);
    syncIssues(f, { gh: changed.gh, day: '2026-10-05' });
    expect(verbs(changed.calls)).toEqual(['edit 7', 'comment 7']);
  });

  it('closes the issue on the first run that finds nothing in its class, and only that one', () => {
    const { gh, calls } = fake([{ number: 7, title: CLASSES.contradicted.title, body: '' }, { number: 8, title: 'someone else\'s issue with the label', body: '' }]);
    const out = syncIssues(run().findings, { gh, day: '2026-10-05' });
    expect(verbs(calls)).toEqual(['close 7']);
    expect(out[0]).toBe('(a) closed #7');
  });
});

describe('routing-drift --ci (the only check that can fail a PR)', () => {
  it('passes on the committed doc, and reports class (c) only', () => {
    const r = spawnSync(process.execPath, ['scripts/audit/routing-drift.mjs', '--ci'], { cwd: ROOT, encoding: 'utf8' });
    expect([r.status, r.stdout.trim()]).toEqual([0, 'routing-drift (c): the generated routing table is current']);
  });
});
