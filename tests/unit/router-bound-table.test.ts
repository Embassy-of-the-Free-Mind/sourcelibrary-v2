/**
 * #8283: THE binding test. Fails when either router disagrees with the bound table (current.json), which is what the two audits
 * it replaced (scripts/audit/router-table-drift.mjs, scripts/audit/router-binding.mjs) could only report.
 *
 * OCR: every cell of the live table a book can reach is read straight from loadCurrentTable, not through `router_cells`, so a
 * stale generated block goes red here as well as in router-routing-rows-7913. Translation: `<lang>-tr-first` cells, the only ones
 * a language picks. If this is red on a nightly bind PR, a router did not follow the pointer: fix the router, not this test.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { loadCurrentTable, boundRoute, routeReader, planBind, translationDisagrees, trFirstLanguage, checkBinding } from '../../scripts/lib/router-binding.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { ocrRouteForBook, getOcrModelForBook, OCR_MODEL_AGY, OCR_MODEL_OPUS, OCR_ROUTING_TABLE } from '../../scripts/lib/ocr-routing.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { translateLaneForBook } from '../../scripts/lib/translation-routing.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { cellRows } from '../../scripts/maintenance/router-routing-rows.mjs';

/* eslint-disable @typescript-eslint/no-explicit-any */
const require = createRequire(import.meta.url);
const TRANSLATIONS = require('../../scripts/lib/translation-routing-table.json');
const LANGUAGES: Record<string, string> = {
  latin: 'Latin', german: 'German', french: 'French', english: 'English', italian: 'Italian', spanish: 'Spanish', greek: 'Greek', sanskrit: 'Sanskrit', arabic: 'Arabic',
  zh: 'Chinese', korean: 'Korean', russian: 'Russian', portuguese: 'Portuguese', danish: 'Danish', hindi: 'Hindi', 'middle-english': 'Middle English', mhg: 'Middle High German',
  'old-french': 'Old French', ottoman: 'Ottoman Turkish', tamil: 'Tamil', turkish: 'Turkish',
};
const CELL_BASE = (language: string) => ({ Latin: 'latin-blank', German: 'german-blank', French: 'french-blank', English: 'english-blank-pre1800' } as Record<string, string>)[language]
  ?? `${Object.entries(LANGUAGES).find(([, v]) => v === language)![0]}-lite`;

/** What the table says a book of this language and script reads: the first cell whose bound route reads fresh, by agy or Opus. */
function expected(table: any, language: string, script?: string) {
  const scripts = script === 'handwritten' ? ['manuscript'] : script === 'printed' ? ['print'] : ['unknown', 'print'];
  for (const s of scripts) {
    const route = boundRoute(table.rows.get(`${CELL_BASE(language)}/${s}`));
    if (route && routeReader(route).first_read && routeReader(route).reader) return { route, model: routeReader(route).reader === 'opus' ? OCR_MODEL_OPUS : OCR_MODEL_AGY };
  }
  return { route: null, model: OCR_MODEL_AGY };
}

/** Every disagreement between the routers and a bound table. Empty means bound. */
function disagreements(table: any, ocrTable: any = OCR_ROUTING_TABLE, translations: any = TRANSLATIONS) {
  const out: string[] = [];
  for (const language of Object.values(LANGUAGES)) for (const script_type of [undefined, 'printed', 'handwritten']) {
    const got = ocrRouteForBook({ language, script_type }, ocrTable), want = expected(table, language, script_type);
    if (got.route !== want.route || got.model !== want.model) out.push(`OCR ${language}/${script_type}: router ${got.route} ${got.model}, table ${want.route} ${want.model}`);
  }
  for (const row of table.rows.values()) {
    const language = trFirstLanguage(row.id);
    if (!language) continue;
    const why = translationDisagrees(row, translateLaneForBook(translations, { language }));
    if (why) out.push(`translation ${row.id}: ${why}`);
  }
  return out;
}

const liveRows = () => { const t = loadCurrentTable(); return { ...t, rows: new Map(t.rows) } as any; };
const withCell = (t: any, id: string, row: any) => { const c = { ...t, rows: new Map(t.rows) }; c.rows.set(id, { id, base: id.split('/')[0], routes: [], ...row }); return c; };

describe('both routers follow the bound table', () => {
  it('the live pointer: no disagreement', () => {
    expect(disagreements(liveRows())).toEqual([]);
  });

  it('getOcrModelForBook is the table\'s model; only { liteOnly } asks the legacy label', () => {
    expect(getOcrModelForBook({ language: 'Latin' })).toBe(ocrRouteForBook({ language: 'Latin' }).model);
    expect(getOcrModelForBook({ language: 'Latin' }, { liteOnly: true })).toBe('gemini-3.1-flash-lite');
  });

  it('NEGATIVE CONTROL: a pointer the OCR rows have not followed goes red', () => {
    const moved = withCell(liveRows(), 'spanish-lite/unknown', { decision: 'switch', route: 'opus-read', bound_route: 'opus-read' });
    expect(disagreements(moved).join('\n')).toContain('OCR Spanish/undefined');
  });

  it('NEGATIVE CONTROL: OCR rows the pointer does not say go red', () => {
    const edited = { ...OCR_ROUTING_TABLE, router_cells: [...OCR_ROUTING_TABLE.router_cells, { cell: 'spanish-lite/print', route: 'opus-read', reads: routeReader('opus-read') }] };
    expect(disagreements(liveRows(), edited).join('\n')).toContain('OCR Spanish');
  });

  it('NEGATIVE CONTROL: the translation router not following a -tr-first cell goes red, and following it does not', () => {
    const t = withCell(liveRows(), 'latin-tr-first/print', { decision: 'switch', route: 'opus-cli', bound_route: 'opus-cli' });
    expect(disagreements(t).join('\n')).toContain('translation latin-tr-first/print');
    const row = TRANSLATIONS.rows.find((r: any) => translateLaneForBook(TRANSLATIONS, { language: 'Latin' }).row?.id === r.id);
    const same = withCell(liveRows(), 'latin-tr-first/print', { decision: 'switch', route: `agy-flash-low@${row.per_call}`, bound_route: `agy-flash-low@${row.per_call}` });
    expect(disagreements(same)).toEqual([]);
  });
});

describe('routeReader', () => {
  it.each([
    ['agy-flash-low@4-written', { first_read: true, reader: 'agy', draft: null, per_call: 4 }],
    ['pero>agy-flash-low@4-written', { first_read: true, reader: 'agy', draft: 'pero', per_call: 4 }],
    ['agy-flash-low-read-diplomatic', { first_read: true, reader: 'agy', draft: null, per_call: 1 }],
    ['opus-read', { first_read: true, reader: 'opus', draft: null, per_call: 1 }],
    ['paddle>opus', { first_read: true, reader: 'opus', draft: 'paddle', per_call: 1 }],
    ['lite>opus', { first_read: false, reader: 'opus', draft: 'lite', per_call: 1 }],
    ['lite', { first_read: false, reader: null, draft: null, per_call: 1 }],
    ['lighton-written', { first_read: true, reader: null, draft: null, per_call: 1 }],
    ['paddle>agy-flash-high', { first_read: true, reader: null, draft: 'paddle', per_call: 1 }],
  ])('%s', (route, want) => expect(routeReader(route)).toEqual(want));
});

describe('ocrRouteForBook', () => {
  const table = { router_cells: cellRows({ rows: new Map([
    ['german-blank/print', { id: 'german-blank/print', decision: 'keep', route: 'agy-flash-low@4-written', bound_route: 'agy-flash-low@4-written', routes: [] }],
    ['latin-blank/print', { id: 'latin-blank/print', decision: 'keep', route: 'pero>agy-flash-low-written', bound_route: 'pero>agy-flash-low-written', routes: [] }],
    ['spanish-lite/print', { id: 'spanish-lite/print', decision: 'HOLD', route: 'lite', bound_route: 'lite', routes: [] }],
    ['spanish-lite/manuscript', { id: 'spanish-lite/manuscript', decision: 'held', route: 'opus-read', bound_route: null, routes: [] }],
  ]), pointer: {}, waivers: [] }).ocr };

  it('answers from the cell, drafts and per-call included', () => {
    expect(ocrRouteForBook({ language: 'German' }, table)).toEqual({ cell: 'german-blank/print', route: 'agy-flash-low@4-written', model: OCR_MODEL_AGY, draft: null, per_call: 4 });
    expect(ocrRouteForBook({ language: 'Latin' }, table).draft).toBe('pero');
  });

  it('a stored-text route, a cell that binds nothing and a language with no cell all take agy', () => {
    const agy = { cell: null, route: null, model: OCR_MODEL_AGY, draft: null, per_call: 1 };
    expect(ocrRouteForBook({ language: 'Spanish' }, table)).toEqual(agy);
    expect(ocrRouteForBook({ language: 'Spanish', script_type: 'handwritten' }, table)).toEqual(agy);
    expect(ocrRouteForBook({ language: 'Tibetan' }, table)).toEqual(agy);
    expect(ocrRouteForBook({}, table)).toEqual(agy);
  });

  it('a manuscript never takes the print cell', () => {
    expect(ocrRouteForBook({ language: 'German', script_type: 'handwritten' }, table).cell).toBeNull();
  });

  it('never returns a model the paid API or Batch would run', () => {
    for (const language of Object.values(LANGUAGES)) expect([OCR_MODEL_AGY, OCR_MODEL_OPUS]).toContain(ocrRouteForBook({ language }).model);
  });
});

describe('planBind: the nightly move', () => {
  const row = (id: string, bound: string | null, extra = {}) => ({ id, decision: 'keep', route: bound, bound_route: bound, routes: [], v3: null, ...extra });
  const current = () => ({ name: 'old', rows: new Map([['a/print', row('a/print', 'x')], ['b/print', row('b/print', 'x')], ['gone/print', row('gone/print', 'x')]]), waivers: [{ cell: 'a/print', until: '2026-11-14' }],
    pointer: { _doc: 'kept', table: 'old', set: '2026-11-01', why: 'w', cells: { 'b/print': { table: 'older', set: '2026-11-01', why: 'Derek' } } } });
  const plan = (rows: any[], refuse?: any) => planBind(current(), { rows }, { name: 'new', today: '2026-11-07', refuse });

  it('nothing changed: no move, so no PR', () => {
    expect(plan([row('a/print', 'x'), row('b/print', 'x'), row('gone/print', 'x')]).moved).toEqual([]);
  });

  it('a rule pick that passes V3 moves; the pointer names the build, keeps the waivers and its doc', () => {
    const p = plan([row('a/print', 'y', { decision: 'switch', v3: { passes: true } }), row('b/print', 'x')]);
    expect(p.moved.map((m: any) => [m.cell, m.from, m.to])).toEqual([['a/print', 'x', 'y']]);
    expect(p.pointer).toMatchObject({ table: 'new', set: '2026-11-07', _doc: 'kept', waivers: [{ cell: 'a/print', until: '2026-11-14' }] });
  });

  it('a rule pick over the V3 bar stays where it runs, by a pin, and says so', () => {
    const p = plan([row('a/print', 'y', { decision: 'switch', v3: { passes: false, false_pick_boundary: 0.31 } })]);
    expect(p.moved).toEqual([]);
    expect(p.blocked[0].why).toContain('31.0%');
    expect(p.pointer.cells['a/print']).toMatchObject({ table: 'old' });
  });

  it('a judge-held cell does not move; a default or a person\'s decision is no rule pick, so V3 does not gate it', () => {
    const held = plan([row('a/print', 'y', { decision: 'HOLD (judge)', judge_validity: { held: 'keep y' } })]);
    expect(held.blocked[0].why).toContain('judge');
    const bad = { passes: false, false_pick_boundary: 0.5 };
    expect(plan([row('a/print', 'y', { decision: 'switch (default: agy, measured here; was HOLD)', v3: bad })]).moved).toHaveLength(1);
    expect(plan([row('a/print', 'y', { decision: 'switch (Derek)', rule_alone: 'keep x', v3: bad })]).moved).toHaveLength(1);
  });

  it('a rule pick with no V3 result refuses the whole plan: the gate never passes by absence', () => {
    const { v3: _v3, ...noV3 } = row('a/print', 'y', { decision: 'switch' });
    expect(() => plan([noV3])).toThrow(/no V3 result/);
  });

  it('a person\'s pin on a blocked cell stays verbatim; a pin on a cell that did not change goes', () => {
    const p = plan([row('b/print', 'y', { decision: 'switch', v3: { passes: false, false_pick_boundary: 0.2 } })]);
    expect(p.pointer.cells['b/print']).toEqual({ table: 'older', set: '2026-11-01', why: 'Derek' });
    expect(plan([row('b/print', 'x')]).pointer.cells['b/print']).toBeUndefined();
  });

  it('a new cell that may not bind stays out of the live table; a cell the build lacks stays on the old one', () => {
    const p = plan([row('new/print', 'y', { decision: 'switch', v3: { passes: false, false_pick_boundary: 0.2 } })]);
    expect(p.pointer.cells['new/print'].table).toBeNull();
    expect(p.pointer.cells['gone/print'].table).toBe('old');
  });

  it('a router that cannot follow refuses the cell', () => {
    const p = plan([row('a/print', 'y', { decision: 'switch', v3: { passes: true } })], () => 'the translation router runs z');
    expect(p.blocked[0].why).toBe('the translation router runs z');
  });
});

describe('a HOLD cell binds through bound_route', () => {
  it('checkBinding: runs the bound route = ok, another = mismatch; an older build\'s HOLD stays undecided', () => {
    const t = { name: 't', waivers: [], rows: new Map([
      ['n/print', { id: 'n/print', decision: 'HOLD (x)', route: 'r', bound_route: 'live', routes: [] }],
      ['o/print', { id: 'o/print', decision: 'HOLD (x)', route: 'r', routes: [] }],
      ['h/print', { id: 'h/print', decision: 'held', route: 'r', bound_route: null, routes: [] }],
    ]) };
    const st = (cell: string, route: string) => checkBinding(t, [{ lane: 'l', cell, route }], { today: '2026-11-07' })[0].status;
    expect(st('n/print', 'live')).toBe('ok');
    expect(st('n/print', 'r')).toBe('mismatch');
    expect(st('o/print', 'r')).toBe('undecided');
    expect(st('h/print', 'r')).toBe('undecided');
  });
});
