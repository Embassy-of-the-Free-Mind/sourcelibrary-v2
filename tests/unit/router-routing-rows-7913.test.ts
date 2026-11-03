/**
 * #7913: the routing tables' cell-backed rows are generated from the router table's current.json, and lanes refuse a
 * contradicting route under ROUTER_BINDING_REFUSE=1.
 *
 * If the first test is red, the pointer moved without the tables: run
 * `node scripts/maintenance/router-routing-rows.mjs --write` and commit both tables. Do not edit `router_cells` by hand.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { plan, cellRows, withCellRows, isTranslationCell, KEY } from '../../scripts/maintenance/router-routing-rows.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module
import { effectiveMode, loadCurrentTable } from '../../scripts/lib/router-binding.mjs';

const ROOT = path.resolve(__dirname, '../..');

describe('router_cells is generated from current.json', () => {
  it('both routing tables carry exactly what current.json gives', () => {
    for (const [f, x] of Object.entries(plan() as Record<string, { current: string; wanted: string }>)) {
      expect(x.current, `${f}: run node scripts/maintenance/router-routing-rows.mjs --write`).toBe(x.wanted);
    }
  });

  it('every decided cell of the live table has one row, in the table of its task', () => {
    const t = loadCurrentTable();
    const rows = cellRows(t);
    const decided = [...t.rows.values()].filter((r: { decision: string }) => /^(keep|switch)\b/.test(r.decision) && !/UNTESTED/.test(r.decision));
    expect(rows.ocr.length + rows.translation.length).toBe(decided.length);
    for (const r of rows.translation) expect(isTranslationCell({ id: r.cell })).toBe(true);
    for (const r of rows.ocr) expect(isTranslationCell({ id: r.cell })).toBe(false);
    for (const r of [...rows.ocr, ...rows.translation]) expect(r.route).toBe(t.rows.get(r.cell).route);
  });

  it('the hand rows and every other key stay as they were', () => {
    for (const f of ['scripts/lib/ocr-routing-table.json', 'scripts/lib/translation-routing-table.json']) {
      const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
      const j = JSON.parse(text);
      expect(Object.keys(j).at(-1)).toBe(KEY);
      const again = withCellRows(text, j[KEY]);
      expect(again).toBe(text);   // writing the block back changes nothing
      const other = withCellRows(text, [{ cell: 'x/print', decision: 'keep', route: 'r', k_of_n: null, table: 't', set: null }]);
      const { [KEY]: a, ...restA } = JSON.parse(other); const { [KEY]: b, ...restB } = j;
      expect(restA).toEqual(restB);
      expect(a).not.toEqual(b);
    }
  });

  it('adds the block to a table that has none, and refuses one where it is not last', () => {
    const t = '{\n  "rows": [1, 2]\n}\n';
    const w = withCellRows(t, []);
    expect(JSON.parse(w)).toEqual({ rows: [1, 2], [`_${KEY}`]: expect.any(String), [KEY]: [] });
    expect(withCellRows(w, [])).toBe(w);
    expect(() => withCellRows(`{"${KEY}": [], "rows": []}`, [])).toThrow(/last key/);
  });

  it('a translation cell is the router\'s -tr split', () => {
    expect(isTranslationCell({ id: 'german-tr-flash3/print' })).toBe(true);
    expect(isTranslationCell({ id: 'latin-tr-first/print' })).toBe(true);
    expect(isTranslationCell({ id: 'tibetan-tr/manuscript' })).toBe(true);
    expect(isTranslationCell({ id: 'latin-lite/print' })).toBe(false);
    expect(isTranslationCell({ id: 'tibetan-yigdzin/manuscript' })).toBe(false);
  });
});

describe('ROUTER_BINDING_REFUSE (#7913): refuse, not warn, once Derek says go', () => {
  it('defaults OFF: warn stays warn', () => {
    expect(effectiveMode('warn', {})).toBe('warn');
    expect(effectiveMode('warn', { ROUTER_BINDING_REFUSE: '0' })).toBe('warn');
  });
  it('=1 turns warn into refuse; off and refuse are what they say', () => {
    expect(effectiveMode('warn', { ROUTER_BINDING_REFUSE: '1' })).toBe('refuse');
    expect(effectiveMode('off', { ROUTER_BINDING_REFUSE: '1' })).toBe('off');
    expect(effectiveMode('refuse', {})).toBe('refuse');
  });
  it('no crontab in the repo sets it yet', () => {
    const infra = path.join(ROOT, 'infrastructure');
    const files = [...fs.readdirSync(infra).filter((f) => f.endsWith('-crontab')).map((f) => path.join(infra, f)), path.join(ROOT, 'scripts/workers/crontab.production')];
    for (const f of files.filter((x) => fs.existsSync(x))) expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/ROUTER_BINDING_REFUSE=1/);
  });
});
