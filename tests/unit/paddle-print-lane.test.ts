import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
// @ts-expect-error — plain .mjs module
import { LANE, HOLD_REASON, INK_BLANK, storedPolicy, isSpread, innerInk, shortUnitRepeats, deflateRatio, convertLeaf, leafLoop, assemblePage, envelope, ocrField, laneLanguage, bodyCharCount } from '../../scripts/lib/paddle-print-lane.mjs';
// @ts-expect-error — plain .mjs module
import { convertPaddle } from '../../scripts/lib/paddle-zh-lane.mjs';
// @ts-expect-error — plain .mjs module
import { missingProvenance } from '../../scripts/lib/write-provenance.mjs';

// Real PaddleOCR-VL leaf reads from #7184 (hetzner:/root/cbeta-ref-6101/split/gpu/…): a blank title leaf that loops,
// and the two leaves of a text spread.
const FX = path.resolve(__dirname, '../fixtures/paddle-print-6101');
const fx = (f: string) => readFileSync(path.join(FX, f), 'utf8');

describe('storedPolicy: which stored readings the print lane may replace (#6101)', () => {
  it('reads empty pages, flash-lite reads and whole-spread Paddle reads', () => {
    expect(storedPolicy(undefined, { spread: false })).toEqual({ action: 'read', why: 'no_text' });
    expect(storedPolicy({ data: '  ' }, { spread: true }).action).toBe('read');
    expect(storedPolicy({ data: '[RECITATION_BLOCKED]', model: 'gemini-3.1-flash-lite-preview' }, { spread: false }).why).toBe('no_text');
    expect(storedPolicy({ data: 'x', model: 'gemini-3.1-flash-lite-preview', source: 'batch_api' }, { spread: false })).toEqual({ action: 'read', why: 'flash_lite' });
    expect(storedPolicy({ data: 'x', source: 'paddle', model: 'PaddleOCR-VL-1.6-0.9B' }, { spread: true })).toEqual({ action: 'read', why: 'paddle_whole_spread' });
  });
  it('never replaces Flash, Pro, Claude, a typed edition, a human edit, or a single-leaf Paddle read', () => {
    expect(storedPolicy({ data: 'x', model: 'gemini-3-flash-preview' }, { spread: true }).action).toBe('keep');
    expect(storedPolicy({ data: 'x', model: 'gemini-3.8-flash' }, { spread: true }).why).toBe('gemini_flash');
    expect(storedPolicy({ data: 'x', model: 'gemini-3-pro-preview' }, { spread: true }).why).toBe('gemini_pro');
    expect(storedPolicy({ data: 'x', model: 'claude-opus-4-7' }, { spread: true }).why).toBe('claude');
    expect(storedPolicy({ data: 'x', source: 'cbeta-xml-p5' }, { spread: true }).why).toBe('typed_edition');
    expect(storedPolicy({ data: 'x', model: 'gemini-3.1-flash-lite-preview', edited_by: 'someone' }, { spread: true }).why).toBe('human_edited');
    expect(storedPolicy({ data: 'x', source: 'manual' }, { spread: true }).why).toBe('human_edited');
    expect(storedPolicy({ data: 'x', source: 'paddle' }, { spread: false }).why).toBe('paddle_single_leaf');
    expect(storedPolicy({ data: 'x', source: 'paddle', pipeline: LANE }, { spread: true }).why).toBe('this_lane');
    expect(storedPolicy({ data: 'x', source: 'kraken', model: 'k' }, { spread: true }).action).toBe('keep');
  });
});

describe('spread and blank-leaf detection', () => {
  it('a spread is at least as wide as it is tall', () => {
    expect(isSpread(3000, 2100)).toBe(true);
    expect(isSpread(780, 1049)).toBe(false);
    expect(isSpread(null, 1000)).toBe(false);
  });
  it('innerInk measures ink inside the leaf, ignoring a dark border', () => {
    const w = 100, h = 100;
    const blank = new Uint8Array(w * h).fill(230);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < 5 || x > 94 || y < 5 || y > 94) blank[y * w + x] = 20; // frame rule
    expect(innerInk(blank, w, h)).toBeLessThan(INK_BLANK);
    const text = Uint8Array.from(blank);
    for (let y = 15; y < 85; y++) for (let x = 20; x < 80; x += 6) { text[y * w + x] = 10; text[y * w + x + 1] = 10; }
    expect(innerInk(text, w, h)).toBeGreaterThan(0.05);
  });
});

describe('leaf loop guards (#7184 blank-leaf loops, #5100 short-period note)', () => {
  it('rejects the real blank-leaf loop (卷一 … recited, not periodic)', () => {
    const { body } = convertLeaf(fx('blank-leaf-loop-R.txt'));
    const v = leafLoop(body);
    expect(v.loop).toBe(true);
    expect(deflateRatio(fx('blank-leaf-loop-R.txt'))).toBeLessThan(0.05);
  });
  it('rejects a single-character run and a short unit repeated (地震 ×30)', () => {
    expect(leafLoop(convertLeaf(fx('char-run-leaf-L.txt')).body)).toMatchObject({ loop: true, reason: 'char_run' });
    expect(shortUnitRepeats('其後地震' + '地震'.repeat(30) + '而止')).toBeGreaterThanOrEqual(30);
    expect(leafLoop('其後' + '地震'.repeat(30) + '而止').loop).toBe(true);
  });
  it('passes real text leaves', () => {
    for (const f of ['text-leaf-R.txt', 'text-leaf-L.txt']) expect(leafLoop(convertLeaf(fx(f)).body)).toEqual({ loop: false });
    expect(deflateRatio(fx('text-leaf-R.txt'))).toBeGreaterThan(0.3);
  });
});

describe('convertLeaf: the print conversions', () => {
  it('drops the NDL label strip and keeps kana lines (Japanese print, kunten)', () => {
    const { body, stats } = convertLeaf('国立国会図書館\nいろはにほへと\n子曰學而時習之');
    expect(body.split('\n')).toEqual(['いろはにほへと', '子曰學而時習之']);
    expect(stats.label_lines_dropped).toBe(1);
  });
  it('leaves the #5600 default (kana lines dropped) unchanged', () => {
    expect(convertPaddle('いろはにほへと\n子曰學而時習之').body).toBe('子曰學而時習之');
  });
  it('counts kana as text for the textless test', () => {
    expect(bodyCharCount('<header>卷一</header>\nいろはにほ')).toBe(5);
  });
});

describe('assemblePage: leaves → one page', () => {
  const R = fx('text-leaf-R.txt'), L = fx('text-leaf-L.txt');
  it('joins right leaf then left with one line break', () => {
    const a = assemblePage([{ side: 'R', blank: false, raw: R }, { side: 'L', blank: false, raw: L }]);
    expect(a.verdict).toBe('write');
    expect(a.body.indexOf('除夜小參')).toBe(0);
    expect(a.body.indexOf(convertLeaf(L).body.split('\n')[0])).toBeGreaterThan(a.body.indexOf('除夜小參'));
  });
  it('a blank leaf contributes nothing; the other leaf is the page', () => {
    const a = assemblePage([{ side: 'R', blank: true, raw: null }, { side: 'L', blank: false, raw: L }]);
    expect(a).toMatchObject({ verdict: 'write' });
    expect(a.stats.blank_leaves).toBe(1);
  });
  it('a looping leaf with ink rejects the whole page; an errored leaf too', () => {
    expect(assemblePage([{ side: 'R', blank: false, raw: fx('blank-leaf-loop-R.txt') }, { side: 'L', blank: false, raw: L }])).toMatchObject({ verdict: 'reject', side: 'R' });
    expect(assemblePage([{ side: 'R', blank: false, raw: null, err: 'timeout 90s' }, { side: 'L', blank: false, raw: L }])).toMatchObject({ verdict: 'reject', reason: 'leaf_error' });
  });
  it('two blank leaves are textless, never an empty write', () => {
    expect(assemblePage([{ side: 'R', blank: true }, { side: 'L', blank: true }]).verdict).toBe('textless');
  });
});

describe('the written field', () => {
  it('carries the envelope, provenance the checker accepts, and the leaf geometry', () => {
    const text = envelope('子曰學而時習之', laneLanguage('Classical Chinese'));
    expect(text).toBe('<language>Chinese</language>\n<script>printed</script>\n\n子曰學而時習之');
    expect(laneLanguage('Japanese')).toBe('Japanese');
    const f = ocrField(text, { language: 'Chinese', run: `${LANE}/64-a`, imageUrl: 'https://images.sourcelibrary.org/x.jpg', spread: true, leaves: [{ side: 'R', box: [1, 0, 2, 3], ink: 0.1, blank: false }], box: { host: 'gex45-1', weights_sha256: 'ab' } });
    expect(f).toMatchObject({ source: 'paddle', pipeline: LANE, data: text });
    expect(f.engine.revision).toBe('sha256:ab');
    expect(f.engine.input.leaves).toHaveLength(1);
    expect(missingProvenance('ocr', f).missing).toEqual([]);
    expect(HOLD_REASON).toBe('paddle-print-6101');
  });
});
