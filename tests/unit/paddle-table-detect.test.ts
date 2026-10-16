import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { paddleTableRisk, pageShape, servedBody, longestDittoRun, T, T_V1, T_V2 } from '../../scripts/lib/paddle-table-detect.mjs';

// Stored Paddle reads from #6388, each judged against its page image: two contained 洪範皇極內篇 chart pages, a
// 三才圖會 troop-formation diagram (軍 written 11× where 9 are printed), a random-sample page judged clean (qa3) and a
// strict-flagged dictionary page Opus judged clean.
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/paddle-table-detect-6388.json'), 'utf8'));
const risk = (k: string, t = T) => paddleTableRisk(fx[k].text, { title: fx[k].title }, t);

describe('paddle-table-detect: invented chart pages are flagged (#6388)', () => {
  it('a counting-rod chart the strict screen flags', () => {
    const v = risk('chart_strict');
    expect(v.flag).toBe(true);
    expect(v.reasons.some((r: string) => r.startsWith('strict:'))).toBe(true);
  });
  it('a chart page the strict screen let through is caught by repeated_line + run', () => {
    const v = risk('chart_repline');
    expect(v.flag).toBe(true);
    expect(v.reasons).toContain('repeated_line_run');
    expect(v.reasons.some((r: string) => r.startsWith('strict:'))).toBe(false);
  });
  it('a troop-formation diagram', () => expect(risk('formation').flag).toBe(true));
});

describe('paddle-table-detect: prose is not flagged', () => {
  it('a random page judged clean raises nothing', () => {
    const v = risk('random_clean');
    expect(v.gate).toBe(false);
    expect(v.flag).toBe(false);
  });
  it('a strict-flagged dictionary page judged clean passes on shape', () => {
    const v = risk('strict_prose_clean');
    expect(v.gate).toBe(true);
    expect(v.shape).toBe(false);
    expect(v.flag).toBe(false);
  });
  it('the title term alone never flags', () => {
    expect(paddleTableRisk(fx.random_clean.text, { title: '三才圖會(一)' }).flag).toBe(false);
  });
});

// #6561: the ditto term. Fixtures: a 御定子史精華 page whose flag came only from 丨 ditto marks (longest run 4; Opus's
// correction kept > 95 % of its Han), a 子史精華 page judged invented for ONE extra 丨 (run 5), and a 洪範皇極內篇
// counting-rod chart where 丨 is a rod numeral.
describe('paddle-table-detect: ditto marks (#6561)', () => {
  it('the default is still the #6516 rule (not wired): T has no ditto term', () => {
    expect(T.dittoMinRun).toBe(0);
    expect(T_V1).toBe(T);
    expect(risk('ditto_short_clean').flag).toBe(true);
  });
  it('with T_V2, a page flagged only by short 丨 ditto runs is not flagged; the #6516 rule still flags it', () => {
    const v = risk('ditto_short_clean', T_V2);
    expect(v.ditto_only).toBe(true);
    expect(v.features.ditto_run).toBe(4);
    expect(v.flag).toBe(false);
    expect(paddleTableRisk(fx.ditto_short_clean.text, { title: fx.ditto_short_clean.title }, T_V1).flag).toBe(true);
  });
  it('the invented ditto page (one extra 丨, run 5) stays flagged, marked ditto_only', () => {
    const v = risk('ditto_invented', T_V2);
    expect(v.flag).toBe(true);
    expect(v.ditto_only).toBe(true);
  });
  it('a counting-rod chart is never relaxed: 丨 there is a rod, not a ditto', () => {
    const v = risk('rod_chart', T_V2);
    expect(v.flag).toBe(true);
    expect(v.ditto_only).toBe(false);
  });
  it('longestDittoRun crosses line breaks and ignores margin marks', () => {
    expect(longestDittoRun('<header>丨丨丨丨丨丨</header>\n甲丨丨\n丨乙')).toBe(3);
  });
});

describe('paddle-table-detect: shape features', () => {
  it('margin marks and the envelope are not body', () => {
    expect(servedBody('<language>Chinese</language>\n<script>handwritten</script>\n\n<header>洪範皇極內篇</header>\n甲乙\n<page-num>二</page-num>')).toBe('甲乙');
  });
  it('counts duplicated lines, the longest run and the distinct ratio', () => {
    const s = pageShape('軍軍軍軍軍\n甲士\n甲士\n角角');
    expect(s.run).toBe(5);
    expect(s.dup_lines).toBe(1);
    expect(s.han).toBe(11);
    expect(s.distinct_ratio).toBeCloseTo(4 / 11, 3);
  });
});
