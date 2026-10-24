import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs module
import { LANE, HOLD_REASON, HOLD_REASONS, APPLY_HOLD, REVISION_SOURCE, EXCLUDED_WORKS, DOWNSTREAM_NOTE, pageSet, boxFromRun, routePage, nextOcr } from '../../scripts/workers/paddle-zh-guarded-lane.mjs';
// @ts-expect-error — plain .mjs module
import { ocrRouteForKind } from '../../scripts/lib/ocr-routing.mjs';
// @ts-expect-error — plain .mjs module
import { missingProvenance } from '../../scripts/lib/write-provenance.mjs';

// The shapes the GPU task (scripts/gpu/zh-guarded-read-6871/drive.py) and flash.py write, from the 2026-10-18 smoke run.
const RUN = {
  run: 'zh-guarded-read-6871/20261018T1800Z', host: 'gex45-1', gpu: 'NVIDIA RTX PRO 4000 Blackwell SFF Edition',
  engine: { name: 'PaddleOCR-VL', model: 'PaddleOCR-VL-1.6-0.9B', revision: 'sha256:85a479d506a11e724e7285d395c551be69f41dbc16b6342d3cacfb189aed71db',
    stack: { 'paddlepaddle-gpu': '3.2.1', paddleocr: '3.7.0', paddlex: '3.7.2' }, vllm: '0.10.2',
    serving: { backend: 'vllm-server', runners: 8, layout: 0, max_width: 2400, input_long_side_cap: 2744 } },
  guard_code: { 'zh-confirm-6871/guard.py': 'a'.repeat(64) }, guard_constants: { loop_zlib: 0.25 }, guard_frozen_in: '282f64b54',
};
const IMG = { url: 'https://archive.org/download/06055237.cn/page/n25/full/full/0/default.jpg', sha256: 'b'.repeat(64), bytes: 405466, fed_w: 2045, fed_h: 2744 };
const REC = { page_id: 'p1', book_id: 'b1', page_number: 26, route: 'PADDLE', text: '卷一\n孔子年譜\n生年從公羊穀梁傳月日從穀',
  guard: { route: 'PADDLE', flags: [], n: 20, zlib: 0.7, rep6: 1, num: 0.1, ink: 381, blobs: 580 }, image: IMG };
const FLASH = { page_id: 'p1', route: 'FLASH', text: '廷廟社總圖\n小寢\n正寢', attempt: 1, reply_flags: [], cli: { name: 'agy', version: '1.4.2' },
  model: 'gemini-3.8-flash-low', prompt_sent: 'This is one page … @./p1.jpg', date: '2026-10-18T18:08:00Z', image: { url: IMG.url, sha256: IMG.sha256 } };
const ctx = { run: RUN, now: new Date('2026-10-18T19:00:00Z'), codeVer: 'abc1234', workTitle: '鄉黨圖考' };
const sub = (set: Record<string, unknown>) => Object.fromEntries(Object.entries(set).filter(([k]) => k.startsWith('ocr.')).map(([k, v]) => [k.slice(4), v]));

describe('paddle-zh-guarded-lane: what a page carries (#6871 row 3)', () => {
  it('a PADDLE page passes the specialist provenance check and names the weights, run, image hash and verdict', () => {
    const { set, text } = pageSet(REC, 'PADDLE', ctx);
    const o = sub(set);
    expect(missingProvenance('ocr', o).missing).toEqual([]);
    expect(o).toMatchObject({ source: 'paddle', pipeline: LANE, model: 'PaddleOCR-VL-1.6-0.9B', data: text });
    expect(o.engine).toMatchObject({ revision: RUN.engine.revision, licence: 'Apache-2.0', run: RUN.run, issue: 6871, input: { image_url: IMG.url, image_sha256: IMG.sha256 } });
    expect(o.verdict).toMatchObject({ verdict: 'SERVE', rule: 'guard_pass', route: 'PADDLE', judged_engine: 'PaddleOCR-VL-1.6-0.9B' });
    expect(text.startsWith('<language>Chinese</language>')).toBe(true);
  });
  it('a FLASH page carries a gemini-engine/1 CLI block, the prompt sent, and the guard that sent it there', () => {
    const { set } = pageSet({ ...REC, route: 'FLASH', guard: { ...REC.guard, route: 'FLASH', flags: ['COLLAPSE'] } }, 'FLASH', { ...ctx, flash: FLASH });
    const o = sub(set);
    const m = missingProvenance('ocr', o);
    expect(m.missing).toEqual([]);
    expect(m.markers).toEqual(['ocr.engine.generation']);
    expect(o).toMatchObject({ source: 'ai', pipeline: LANE, model: 'gemini-3.8-flash-low' });
    expect((o.engine as { api: string; cli: unknown }).api).toBe('cli');
    expect(o.verdict).toMatchObject({ rule: 'guard_reject_flash_pass', paddle_flags: ['COLLAPSE'], reply_flags: [] });
  });
  it('the works no engine reads are excluded, and the hold it requires is the backlog hold', () => {
    for (const t of ['欽定西域同文志·卷一 (vol 1)', '琴譜合璧·卷四 (vol 4)', '御製清文鑑·卷三']) expect(EXCLUDED_WORKS.test(t)).toBe(true);
    expect(EXCLUDED_WORKS.test('御製歷象考成·表·卷十五')).toBe(false);
    expect(HOLD_REASON).toBe('gpu-backlog-5660');
    expect(DOWNSTREAM_NOTE).toMatch(/RELEASE/);
  });
  it('boxFromRun hands ocrSetFields the logged weights hash, not a pinned one', () => {
    expect(boxFromRun(RUN).weights_sha256).toBe(RUN.engine.revision.slice(7));
  });
});

// The routing row for the held Chinese table + mixed classes (ocr-routing-table.json `chinese-held-tables-mixed`):
// guard pass → Paddle; guard reject + Flash reply pass on the same bytes → Flash; everything else stays unread.
describe('paddle-zh-guarded-lane: routing row (#6871 row 3)', () => {
  const PAGE = { id: 'p1', book_id: 'b1', page_number: 26, photo_original: IMG.url };
  const src = () => 'https://r2.example/archived/b1/26.jpg';
  const FREC = { ...REC, route: 'FLASH', guard: { ...REC.guard, route: 'FLASH', flags: ['COLLAPSE'] } };
  it('a guard-passed Paddle read goes to PADDLE', () => {
    expect(routePage(REC, PAGE, undefined, { getSource: src })).toEqual({ route: 'PADDLE' });
  });
  it('a guard-rejected page goes to FLASH only when Flash passed its reply guard on the same image bytes', () => {
    expect(routePage(FREC, PAGE, FLASH, { getSource: src })).toEqual({ route: 'FLASH', flash: FLASH });
    expect(routePage(FREC, PAGE, undefined, { getSource: src })).toEqual({ skip: 'flash_not_run' });
    expect(routePage(FREC, PAGE, { ...FLASH, route: 'HOLD' }, { getSource: src })).toEqual({ skip: 'flash_hold' });
    expect(routePage(FREC, PAGE, { ...FLASH, image: { url: IMG.url, sha256: 'c'.repeat(64) } }, { getSource: src })).toEqual({ skip: 'flash_read_another_image' });
  });
  it('a near-blank page (guard HOLD) is never written, by either engine', () => {
    expect(routePage({ ...REC, route: 'HOLD' }, PAGE, FLASH, { getSource: src })).toEqual({ skip: 'route_hold' });
  });
  it('never a human-edited page, never a page already read, never another image or another book', () => {
    expect(routePage(REC, { ...PAGE, ocr: { edited_by: 'derek' } }, undefined, { getSource: src })).toEqual({ skip: 'human_edited' });
    expect(routePage(REC, { ...PAGE, ocr: { source: 'manual' } }, undefined, { getSource: src })).toEqual({ skip: 'human_edited' });
    expect(routePage(REC, { ...PAGE, ocr: { data: 'x', source: 'ai' } }, undefined, { getSource: src })).toEqual({ skip: 'already_read' });
    expect(routePage(REC, { ...PAGE, photo_original: 'https://archive.org/other.jpg' }, undefined, { getSource: src })).toEqual({ skip: 'image_not_the_pages' });
    expect(routePage(REC, { ...PAGE, book_id: 'b2' }, undefined, { getSource: src })).toEqual({ skip: 'wrong_book' });
    expect(routePage(REC, undefined, undefined, { getSource: src })).toEqual({ skip: 'page_gone' });
    // the R2 copy (what getPageSource returns) is the same page too
    expect(routePage({ ...REC, image: { ...IMG, url: src() } }, { ...PAGE, photo_original: undefined }, undefined, { getSource: src })).toEqual({ route: 'PADDLE' });
  });
  it('the ocr object written drops stale failure keys and keeps nothing of a prior text', () => {
    const { set } = pageSet(REC, 'PADDLE', ctx);
    const o = nextOcr({ fail_count: 3, fail_blocked: true, fail_reason: 'x', note: 'keep' }, set);
    expect(o.fail_count).toBeUndefined();
    expect(o.fail_blocked).toBeUndefined();
    expect(o.note).toBe('keep');
    expect(o).toMatchObject({ source: 'paddle', pipeline: LANE });
    expect(missingProvenance('ocr', o).missing).toEqual([]);
  });
  it('the apply holds an unheld book under its own reason, and accepts the backlog hold', () => {
    expect(APPLY_HOLD.reason).toBe('zh-guarded-6871');
    expect(APPLY_HOLD.release).toMatch(/priced decision/);
    expect(HOLD_REASONS).toEqual(['gpu-backlog-5660', 'zh-guarded-6871']);
    expect(REVISION_SOURCE).toBe('paddle-zh-guarded-6871');
  });
  it('the routing table names this lane for the held classes', () => {
    const row = ocrRouteForKind('chinese-held-tables-mixed');
    expect(row?.code?.file).toBe('scripts/workers/paddle-zh-guarded-lane.mjs');
    expect(row?.evidence?.map((e: { file: string }) => e.file)).toContain('2026-10-18-zh-guarded-paddle-6871.md');
  });
});
