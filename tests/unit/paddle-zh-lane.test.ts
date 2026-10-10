import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs module
import { LANE, HOLD_REASON, PADDLE, MIN_HAN, convertPaddle, flattenHtml, envelope, hanCount, bodyHanCount, longestCharRun, MAX_CHAR_RUN, workTitleOf, pagePolicy, ocrSetFields, isHumanEdited } from '../../scripts/lib/paddle-zh-lane.mjs';
// @ts-expect-error — plain .mjs module
import * as mjs from '../../scripts/lib/write-provenance.mjs';
import * as ts from '../../src/lib/write-provenance';
// @ts-expect-error — plain .mjs module
import { loopVerdict } from '../../scripts/lib/ocr-loop-guard.mjs';

// Shapes copied from the #5547 pilot outputs (hetzner:/root/zh-ocr-eval-5547/pilot/out), #5568 test 3.
const MARGIN_TOP = ['もうりこ習月', '欽定四庫全書', '卷四之二', 't：--'];
const BODY = ['自竒楊柳最', '隋煬帝湖上柳詞烟雨更', '張九齡詩聲動'];

describe('paddle-zh-lane conversion 1: the envelope (#5568 test 3)', () => {
  it('prepends language and script as the Kraken and NDL lanes do, and claims no page-type', () => {
    const t = envelope('子曰學而時習之');
    expect(t).toBe('<language>Chinese</language>\n<script>handwritten</script>\n\n子曰學而時習之');
    expect(t).not.toMatch(/<page-type>/);
  });
});

describe('paddle-zh-lane conversion 2: the 版心 margin', () => {
  it('drops kana lines and lines with no Han character; marks 四庫全書 and the bare juan line as headers', () => {
    const { body, stats } = convertPaddle([...MARGIN_TOP, ...BODY].join('\n'));
    expect(body.split('\n')).toEqual(['<header>欽定四庫全書</header>', '<header>卷四之二</header>', ...BODY]);
    expect(stats).toMatchObject({ kana_lines_dropped: 1, non_han_lines_dropped: 1, header_lines: 2 });
  });
  it('a misread 金定四庫全書 is still the margin title', () => {
    expect(convertPaddle('金定四庫全書\n周官集傳').body).toBe('<header>金定四庫全書</header>\n周官集傳');
  });
  it('a leaf number is a page-num only next to a margin line; a lone numeral in the body is text', () => {
    expect(convertPaddle('為之辨是以積漸陵夷\n欽定四庫全書\n經\n二十四').body.split('\n').slice(-1)[0]).toBe('<page-num>二十四</page-num>');
    const far = convertPaddle(['欽定四庫全書', '甲', '乙', '丙', '丁', '五'].join('\n')).body.split('\n');
    expect(far[far.length - 1]).toBe('五');
  });
  it('the work title is a header only beside the margin lines', () => {
    expect(convertPaddle('西清古鑑\n卷一', { workTitle: '西清古鑑' }).body).toBe('<header>西清古鑑</header>\n<header>卷一</header>');
    expect(convertPaddle('西清古鑑\n甲\n乙\n丙\n丁\n戊', { workTitle: '西清古鑑' }).body.split('\n')[0]).toBe('西清古鑑');
  });
  it('a fold strip whose 欽定四庫全書 was misread as kana still anchors the title and leaf (#5600 pilot, read-from-image)', () => {
    // 6a3c787401fe4f593c2084f8 p40 and 6a3cb83d3dce6cfad748c6c1 p77: the strip is the last column read
    const a = convertPaddle('謂之長男巽一索而得女故謂之長女坎再索而得男\nこんにちはいい\n大易通解\n二十', { workTitle: '大易通解' });
    expect(a.body.split('\n').slice(-2)).toEqual(['<header>大易通解</header>', '<page-num>二十</page-num>']);
    // the strip abbreviates the title: 御定佩文齋書畫譜 → 御定書畫譜; 林春 (a name heading in the body) stays text
    const b = convertPaddle('例著論一道景泰間上之朝\n懷麓堂集\n林春\n御定書畫譜\nこっつミー・ン・う\n二十八', { workTitle: '御定佩文齋書畫譜' });
    expect(b.body.split('\n').slice(-4)).toEqual(['懷麓堂集', '林春', '<header>御定書畫譜</header>', '<page-num>二十八</page-num>']);
  });
  it('a title-shaped line in the middle of a page is text even next to kana', () => {
    const lines = ['甲乙丙丁', '戊己庚辛', '壬癸子丑', '寅卯辰巳', 'こんにち', '大易', '午未申酉', '戌亥甲乙', '丙丁戊己', '庚辛壬癸'];
    expect(convertPaddle(lines.join('\n'), { workTitle: '大易通解' }).body).toContain('\n大易\n');
  });
  it('a body juan heading (work title + 卷) is text, not margin', () => {
    expect(convertPaddle('周官集傳卷十').body).toBe('周官集傳卷十');
  });
  it('workTitleOf takes the title before ·', () => {
    expect(workTitleOf('記纂淵海·卷三十八~卷三十九 (vol 24)')).toBe('記纂淵海');
    expect(workTitleOf('無分隔')).toBeNull();
  });
});

describe('paddle-zh-lane conversion 3: HTML', () => {
  it('drops <img> (a path to a file that never existed) and its wrapper', () => {
    const raw = '<div style="text-align: center;"><img src="imgs/img_in_chart_box_90_90_680_939.jpg" alt="Image" width="76%" /></div>\n右通盖髙五寸九分';
    const { body, stats } = convertPaddle(raw);
    expect(body).toBe('右通盖髙五寸九分');
    expect(stats.img_dropped).toBe(1);
  });
  it('flattens a table to one line per row', () => {
    const { text, tables } = flattenHtml('<table><tr><td>繩梁卣一</td><td>有銘</td></tr><tr><td>素卣二</td></tr></table>');
    expect(tables).toBe(1);
    expect(text.split('\n').map((l: string) => l.trim()).filter(Boolean)).toEqual(['繩梁卣一 有銘', '素卣二']);
  });
  it('a plate page (only an <img>) converts to no Han text — the textless rule then keeps the stored reading', () => {
    const { body } = convertPaddle('<div style="text-align: center;"><img src="imgs/x.jpg" alt="Image" /></div>');
    expect(hanCount(body)).toBeLessThan(MIN_HAN);
  });
  it('a blank leaf read as a recited juan list is textless (#5660 stress canary)', () => {
    const { body } = convertPaddle(['欽定四庫全書', '卷一', '卷二', '卷三', '卷四', '卷五', '卷六', '卷七', '卷八', '卷九', '卷十'].join('\n'));
    expect(hanCount(body)).toBeGreaterThanOrEqual(MIN_HAN);
    expect(bodyHanCount(body)).toBeLessThan(MIN_HAN);
    expect(bodyHanCount(convertPaddle('欽定四庫全書\n子曰學而時習之不亦說乎').body)).toBeGreaterThanOrEqual(MIN_HAN);
  });
  it('a one-character loop is longer than any real table run (#5660 stress re-test)', () => {
    expect(longestCharRun('幫裒包 ' + '○'.repeat(3000))).toBeGreaterThan(MAX_CHAR_RUN);
    expect(longestCharRun('姑洗○七九三七○五二五九\n經度宮〇〇〇〇〇〇〇〇〇〇〇〇')).toBeLessThanOrEqual(MAX_CHAR_RUN);
  });
  it('no tag survives the conversion except the page marks it adds', () => {
    const { body } = convertPaddle('<table><tr><td>甲乙</td></tr></table>\n<div><img src="a.jpg"/></div>\n欽定四庫全書\n丙丁');
    expect(body.replace(/<\/?(header|page-num)>/g, '')).not.toMatch(/</);
  });
});

describe('paddle-zh-lane conversion 4: provenance', () => {
  const box = { host: 'sl-zh-paddle-1', gpu: 'NVIDIA L4', paddleocr_version: '3.7.0', paddlex_version: '3.7.2', paddle_version: '3.2.1', weights_sha256: 'ab'.repeat(32) };
  const text = envelope('子曰學而時習之');
  const set = ocrSetFields(text, { run: `${LANE}/sl-zh-paddle-1`, now: new Date('2026-10-02T00:00:00Z'), imageUrl: 'https://images.sourcelibrary.org/archived/b1/3.jpg', box, stats: { kana_lines_dropped: 1 } });
  const sub = Object.fromEntries(Object.entries(set).filter(([k]) => k.startsWith('ocr.')).map(([k, v]) => [k.slice(4), v]));

  it('records source, model, stack, run, host, GPU, weights hash, image URL and the pipeline id', () => {
    expect(set['ocr.source']).toBe('paddle');
    expect(set['ocr.pipeline']).toBe(LANE);
    expect(set['ocr.language']).toBe('Chinese');
    expect(set['ocr.content_hash']).toBe(mjs.contentHash(text));
    const e = set['ocr.engine'];
    expect(e).toMatchObject({ name: 'PaddleOCR-VL', model: PADDLE.model, licence: 'Apache-2.0', run: `${LANE}/sl-zh-paddle-1`, host: 'sl-zh-paddle-1', gpu: 'NVIDIA L4', issue: 5600 });
    expect(e.stack).toMatchObject({ paddleocr: '3.7.0', paddlex: '3.7.2', 'paddlepaddle-gpu': '3.2.1', source: 'logged' });
    expect(e.revision).toBe(`sha256:${'ab'.repeat(32)}`);
    expect(e.input).toEqual({ image_url: 'https://images.sourcelibrary.org/archived/b1/3.jpg' });
    expect(e.postprocess).toEqual({ kana_lines_dropped: 1 });
  });
  it('passes the provenance checker in both twins', () => {
    expect(mjs.missingProvenance('ocr', sub)).toEqual({ missing: [], markers: [] });
    expect(ts.missingProvenance('ocr', sub)).toEqual({ missing: [], markers: [] });
  });
  it('paddle is a specialist source: a write with no engine block now FAILS (it passed before #5600)', () => {
    const bare = { data: text, source: 'paddle', updated_at: new Date(), content_hash: mjs.contentHash(text) };
    expect(mjs.missingProvenance('ocr', bare).missing).toEqual(['ocr.engine']);
    expect(ts.missingProvenance('ocr', bare).missing).toEqual(['ocr.engine']);
    expect(mjs.missingProvenance('ocr', { ...bare, engine: { name: 'PaddleOCR-VL', model: 'm' } }).missing).toEqual(['ocr.engine.run']);
  });
  it('a box that did not report says so instead of claiming an observation', () => {
    const e = ocrSetFields(text, { run: 'r' })['ocr.engine'];
    expect(e.revision).toBeUndefined();
    expect(e.revision_source).toMatch(/^not_recorded/);
    expect(e.stack.source).toMatch(/^pinned/);
    expect(e.input.status).toBe('not_recorded');
  });
  it('the converted pilot shapes pass the loop guard', () => {
    expect(loopVerdict(envelope(convertPaddle([...MARGIN_TOP, ...BODY].join('\n')).body)).refuse).toBe(false);
  });
});

describe('paddle-zh-lane: hold and human-edit guard', () => {
  it('the hold reason is kebab-case (holdBook refuses anything else)', () => {
    expect(HOLD_REASON).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
  it('a page a person edited is kept; everything else is read', () => {
    expect(pagePolicy({ ocr: { data: 'x', edited_by: 'derek' } }, isHumanEdited)).toEqual({ action: 'keep', why: 'human_edited' });
    expect(pagePolicy({ ocr: { data: 'x', source: 'manual' } }, isHumanEdited).action).toBe('keep');
    expect(pagePolicy({ ocr: null }, isHumanEdited)).toEqual({ action: 'reocr', why: 'first_write' });
    expect(pagePolicy({ ocr: { data: 'x', source: 'ai' } }, isHumanEdited)).toEqual({ action: 'reocr', why: 'skqs_cohort' });
  });
});
