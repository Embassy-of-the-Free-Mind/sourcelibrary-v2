import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// #8042: a plate across the fold must stay one page in the splitter; two leaves of text must still be cut in two.
const { plateSpanVerdict, bboxToJoined, bboxUnion } = await import('../../scripts/lib/plate-spread.mjs');

// The read split-book.mjs had for BPH 69ef33e2 frame -127 (Khunrath's Emerald Table) when run spwmc8 cut it.
const EMERALD_TABLE = '<split-position>null</split-position>\n<page-type>illustration</page-type>\n<image-desc>A large engraved plate: the Tabula Smaragdina on a mountain…</image-desc>';
const TEXT_SPREAD = '<split-position>497</split-position>\n<page-type>text</page-type>\nCAPUT PRIMUM…\n<page-break/>\n<page-type>text</page-type>\nSequitur…';

describe('plateSpanVerdict', () => {
  it('keeps a plate whole when its own read says plate + single page', () => {
    expect(plateSpanVerdict({ ocrText: EMERALD_TABLE }, 500).keepWhole).toBe(true);
    for (const t of ['map', 'frontispiece', 'diagram', 'plate']) {
      expect(plateSpanVerdict({ ocrText: `<split-position>null</split-position><page-type>${t}</page-type>` }, 500).keepWhole).toBe(true);
    }
  });

  it('still splits a text spread, even when a detection box crosses the gutter', () => {
    const dets = [{ bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } }];
    expect(plateSpanVerdict({ ocrText: TEXT_SPREAD, detectedImages: dets }, 497)).toEqual({ keepWhole: false, reason: 'page-break: two leaves of text' });
  });

  it('a page-break wins over a plate page type', () => {
    expect(plateSpanVerdict({ ocrText: '<split-position>null</split-position><page-type>illustration</page-type>A<page-break/>B' }, 500).keepWhole).toBe(false);
  });

  it('a numeric split position on a plate-typed read is a spread, not a plate', () => {
    expect(plateSpanVerdict({ ocrText: '<split-position>480</split-position><page-type>illustration</page-type>' }, 480).keepWhole).toBe(false);
  });

  it('a read without a split position does not decide by page type alone (frontispiece facing a title page)', () => {
    expect(plateSpanVerdict({ ocrText: '<page-type>frontispiece</page-type>' }, 500).keepWhole).toBe(false);
  });

  it('keeps whole a plate-typed or unread frame whose image crosses the cut on both sides', () => {
    const map = [{ bbox: { x: 0.12, y: 0.05, width: 0.7, height: 0.9 } }];
    expect(plateSpanVerdict({ ocrText: '<page-type>map</page-type>', detectedImages: map }, 500).keepWhole).toBe(true);
    expect(plateSpanVerdict({ detectedImages: map }, 500).keepWhole).toBe(true);
  });

  it('does not keep whole on a box that only grazes the cut', () => {
    const graze = [{ bbox: { x: 0.1, y: 0, width: 0.42, height: 1 } }]; // ends 2% past the cut
    expect(plateSpanVerdict({ ocrText: '<page-type>illustration</page-type>', detectedImages: graze }, 500).keepWhole).toBe(false);
  });

  it('a title-page or text read with a box across the gutter still splits (BPH 68679f27 frame -3)', () => {
    const both = [{ bbox: { x: 0.12, y: 0.05, width: 0.65, height: 0.9 } }];
    expect(plateSpanVerdict({ ocrText: '<page-type>title-page</page-type>', detectedImages: both }, 500).keepWhole).toBe(false);
    expect(plateSpanVerdict({ pageType: 'text', detectedImages: both }, 500).keepWhole).toBe(false);
  });

  it('no read and no detections: split, as before', () => {
    expect(plateSpanVerdict({}, 500).keepWhole).toBe(false);
  });
});

describe('split-book.mjs applies the verdict per frame, in both lanes', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../scripts/split-book.mjs'), 'utf8');
  it('runs plateSpanVerdict before the page list is built, for gutter-only AND reviewed-position (#7605) runs', () => {
    const guard = src.indexOf('plateSpanVerdict({');
    const step4 = src.indexOf('--- Step 4: Build the new page list ---');
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(step4);
    expect(src).toMatch(/if \(\(GUTTER_ONLY \|\| TEXT_CUT\) && !args\.includes\('--cut-plates'\)\)/);
    expect(src).toMatch(/page\._gutter = 'single';\s*\n\s*page\._splitMethod = `plate-whole/);
  });
  it('loads detected_images with the frames', () => {
    expect(src).toMatch(/\.project\(\{[^)]*detected_images: 1/);
  });
});

describe('bbox remapping for a joined plate', () => {
  it('maps each half onto the joined image and unions them', () => {
    const l = bboxToJoined({ x: 0.2, y: 0.1, width: 0.8, height: 0.8 }, 'left', 1000, 1000);
    const r = bboxToJoined({ x: 0, y: 0.12, width: 0.7, height: 0.8 }, 'right', 1000, 1000);
    expect(l).toEqual({ x: 0.1, y: 0.1, width: 0.4, height: 0.8 });
    expect(r.x).toBeCloseTo(0.5); expect(r.width).toBeCloseTo(0.35);
    const u = bboxUnion(l, r);
    expect(u.x).toBeCloseTo(0.1); expect(u.width).toBeCloseTo(0.75); expect(u.y).toBeCloseTo(0.1); expect(u.height).toBeCloseTo(0.82);
  });
});
