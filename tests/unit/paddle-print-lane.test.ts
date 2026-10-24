import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
// @ts-expect-error — plain .mjs module
import { LANE, HOLD_REASON, INK_BLANK, INK_FAINT, SHORT_LEAF, underRead, bookMedians, kanaShare, MAX_KANA_SHARE, stableRead, dropRepeats, coversLite, liteTextCount, storedPolicy, isSpread, innerInk, shortUnitRepeats, deflateRatio, convertLeaf, leafLoop, assemblePage, envelope, ocrField, laneLanguage, bodyCharCount } from '../../scripts/lib/paddle-print-lane.mjs';
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
    expect(assemblePage([{ side: 'R', blank: false, raw: fx('blank-leaf-loop-R.txt') }, { side: 'L', blank: false, raw: L }])).toMatchObject({ verdict: 'reject', side: 'R', reason: expect.stringMatching(/^leaf_loop:/) });
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

describe('repeats and flash-lite coverage (canary by eye, 2026-10-23)', () => {
  it('drops a line or a two-line block that repeats the one right before it, keeping the first copy', () => {
    const a = ['者一而巳本是瀟湘一釣客自東自西自南北只把', '孤舟爲屋宅無寬窄暮天席地人難則頃聞四海停', '者一而已本是瀟湘一釣客自東自西自南北只把', '孤舟爲屋宅無寬窄慕天席地人難測頃聞四海停', '戈革金門嬾去投書策時向灘頭歌月白眞高格浮'];
    expect(dropRepeats(a)).toEqual({ lines: [a[0], a[1], a[4]], dropped: 2 });
    expect(dropRepeats(['生墨一丸立與可竹一枝', '餘無所有', '餘無所有', '范堯夫謫居永州']).dropped).toBe(1);
    // below 4 characters a repeat is left (a recipe's 各一兩 lines can repeat for real): 第十題 twice stays
    expect(dropRepeats(['第十題', '第十題', '有三角形二']).dropped).toBe(0);
  });
  it('never touches bare one-character table lines or different columns', () => {
    expect(dropRepeats(['各一', '兩', '兩', '草烏']).dropped).toBe(0);
    expect(dropRepeats([fx('text-leaf-R.txt'), fx('text-leaf-L.txt')].join('\n').split('\n')).dropped).toBe(0);
  });
  it('a Paddle page that carries under 90 % of lite\'s text (margins included) does not replace it', () => {
    const lite = '<language>Chinese</language>\n<margin>橫占人物據為已有</margin>\n復造狀藏懷中期以必告\n<vocab>李, 劉</vocab>';
    expect(liteTextCount(lite)).toBe(18);
    expect(coversLite(10, lite).ok).toBe(false);
    expect(coversLite(17, lite).ok).toBe(true);
    expect(coversLite(5, '').ok).toBe(true);
  });
});

describe('faint leaves and spaced repeats (second by-eye draw, 2026-10-23)', () => {
  it('a page with a faint leaf (show-through on a near-blank leaf) is not written', () => {
    const L = fx('text-leaf-L.txt');
    expect(assemblePage([{ side: 'R', blank: false, ink: 0.05, raw: '松源和耑銘卷之下\n曾廷考應類附錄卷之四' }, { side: 'L', blank: false, ink: 0.15, raw: L }])).toMatchObject({ verdict: 'reject', reason: 'faint_leaf', side: 'R' });
    expect(assemblePage([{ side: 'R', blank: false, ink: INK_FAINT, raw: L }]).verdict).toBe('write');
  });
  it('drops a long line repeated after interlinear note lines', () => {
    const r = dropRepeats(['巳乙豈不大於丁庚乎壬丙原大於丙辛', '以甲丙原大', '于丙戊故', '巳乙豈不大於丁庚乎壬丙原大於丙辛于丙戊故', '則巳乙與壬丙矩內直角形大于丁']);
    expect(r.dropped).toBe(1);
    expect(r.lines).toHaveLength(4);
  });
});

describe('short leaves need a stable second read (third by-eye draw, 2026-10-23)', () => {
  const L = fx('text-leaf-L.txt');
  const invented = '松源和耑銘卷之下\n曾廷考應類附錄卷之四';
  it('a short leaf without its recheck is not written; an unstable one rejects the page; a stable one passes', () => {
    expect(assemblePage([{ side: 'R', blank: false, ink: 0.23, raw: invented }, { side: 'L', blank: false, ink: 0.12, raw: L }])).toMatchObject({ verdict: 'reject', reason: 'short_leaf_unchecked' });
    expect(assemblePage([{ side: 'R', blank: false, ink: 0.23, raw: invented, recheck: '松源和尚錄卷之下\n東坡居士文集卷四十' }, { side: 'L', blank: false, ink: 0.12, raw: L }])).toMatchObject({ verdict: 'reject', reason: 'short_leaf_unstable' });
    const ok = assemblePage([{ side: 'R', blank: false, ink: 0.2, raw: '虎丘語錄終', recheck: '虎丘語錄終' }, { side: 'L', blank: false, ink: 0.12, raw: L }]);
    expect(ok.verdict).toBe('write');
    expect(ok.stats.short_leaves_stable).toBe(1);
  });
  it('stableRead compares Han + kana only', () => {
    expect(stableRead('虎丘語錄終', '虎丘語錄終 |').ok).toBe(true);
    expect(stableRead('曾廷考應類附錄卷之四', '東坡居士文集卷四十').ok).toBe(false);
    expect(SHORT_LEAF).toBe(60);
  });
});

describe('lite margin commentary must survive (final by-eye draw, 2026-10-23)', () => {
  const B = '置不顧而金是取是乞兒相也何可耐哉狐子可兒雅態可想世說桓溫經王敦墓望之曰可兒乞兒相摭言薛逢晚年嘗乘嬴馬赴朝値新進士綴行而出團所輩見逢行李蕭然前曰廻避新郎君逢遺一介曰報莫貧相阿婆三年少年時也曾東塗西抹來';
  const lite = '<margin>以此試秀才其術最善特恐更有俗者並金巾而內之奈何</margin>\n' + B + B + '長袖拂榻相將坐衣輭無聲少間一美人起以白綾巾展几上上有草書三四行亦未審其何辭一美人置白金鋌可三四兩許秀才掇內袖中美人取巾握手笑出曰俗不可耐';
  const body = B + B + '長袖拂榻相將坐衣輭無聲少間一美人起以白綾巾展几上上有草書三四行亦未審其何辭一美人置白金鋌可三四兩許秀才掇內袖中美人取巾握手笑出曰俗不可耐';
  it('keeps lite when Paddle left the margin out, even above 90 % of its length', () => {
    expect(coversLite(liteTextCount(body), lite, body)).toMatchObject({ ok: false, why: 'lite_lines_missing' });
    expect(coversLite(liteTextCount(lite), lite, '以此試秀才其術最善特恐更有俗者並金巾而內之奈何\n' + body).ok).toBe(true);
    // lite writes the commentary as plain lines too (p.118): the same rule
    const plain = '以此試秀\n才其術最\n善特恐更\n有俗者誰\n' + B + B;
    expect(coversLite(liteTextCount(B + B), plain, B + B)).toMatchObject({ ok: false, why: 'lite_lines_missing' });
  });
});

describe('Japanese editions inside the Chinese frame (first frame chunk, 2026-10-23)', () => {
  it('a book whose text is ≥ 10 % kana is out; kunten-glossed Chinese stays in', () => {
    expect(kanaShare(['鹿三笠山雪', 'ニテアリトイフハコレナリ'])).toBeGreaterThan(MAX_KANA_SHARE);
    expect(kanaShare([fx('text-leaf-R.txt') + 'レ'])).toBeLessThan(MAX_KANA_SHARE);
  });
  it('a dense typeset page is not rejected for length alone', () => {
    const dense = fx('text-leaf-R.txt').repeat(1).split('\n').map((l, i) => l + '其' + i).join('\n');
    expect(leafLoop(dense.repeat(1)).loop).toBe(false);
  });
});

describe('under-read leaves (first frame chunk, 2026-10-24)', () => {
  it('a full-ink leaf with a fifth of the book\'s median text is an under-read; a low-ink short leaf is not', () => {
    const med = { chars: 1450, ink: 0.18 };
    expect(underRead(14, 0.17, med)).toBe(true);
    expect(underRead(14, 0.05, med)).toBe(false);
    expect(underRead(900, 0.17, med)).toBe(false);
    expect(underRead(14, 0.17, { chars: 60, ink: 0.18 })).toBe(false);
    const L = fx('text-leaf-L.txt');
    expect(assemblePage([{ side: 'S', blank: false, ink: 0.17, raw: '知是爲魔事復次須菩提說法者欲', recheck: '知是爲魔事復次須菩提說法者欲' }], { med })).toMatchObject({ verdict: 'reject', reason: 'under_read' });
    expect(bookMedians([{ raw: L, ink: 0.1 }, { raw: L, ink: 0.2 }, { raw: '', ink: null }]).ink).toBe(0.2);
  });
});
