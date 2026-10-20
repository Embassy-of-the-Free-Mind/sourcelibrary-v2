/**
 * PRIOR ART: tests/unit/import-routes-spend-nothing.test.ts — same technique
 * (assert on source text across the import routes) for a different invariant.
 *
 * An import writer must never stamp a page with `ocr: { data: '', model: null }`
 * / `translation: { data: '', model: null }` at creation time (#4685 population
 * B). `hasOcr()`/`hasTranslation()` (scripts/lib/page-counts.mjs) already treat
 * that shape as "not done" — same as an absent `ocr`/`translation` key — so the
 * placeholder bought nothing semantically. What it cost: every downstream sweep
 * that looks for "pages needing OCR" by checking `ocr.data` empty/missing finds
 * these pages, but the page reads as *initialized* rather than *never touched*,
 * and #4685's census found 342/343 of a 40-book sample's empty-OCR pages
 * carrying exactly this `ocr.model: null` fingerprint — 40/40 sampled were real
 * text, silently dropped, never flagged as a failure.
 *
 * Three of the four hand-rolled importers (ia, gallica, google-books) already
 * fixed this with an explicit comment ("Don't initialize ocr/translation with
 * empty strings -- they cause false completion in job-completion.ts"). This
 * pins that fix on the two writers that still had the old shape
 * (src/lib/import-utils.ts's importBookFromIIIF, used by 16 IIIF-manifest
 * import routes, and the one-off scripts/import/import-thirukkural.ts) and
 * guards the fixed ones against regressing.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');

/** The exact placeholder shape the bug wrote: model:null paired with data:''. */
const PLACEHOLDER_RE = /model:\s*null,\s*\n?\s*data:\s*''/;

const FILES_MUST_NOT_STAMP_PLACEHOLDER = [
  // The shared IIIF importer — feeds 16 provider routes (bl, bodleian,
  // cambridge, europeana, getty, hab, harvard, huntington, kyoto, onb, penn,
  // sbb, vatican, vatlib, yale, and erara-style manifest imports).
  'src/lib/import-utils.ts',
  // One-off named-editions import script.
  'scripts/import/import-thirukkural.ts',
  // Already fixed — guarded here so they don't regress.
  'src/app/api/import/ia/route.ts',
  'src/app/api/import/gallica/route.ts',
  'src/app/api/import/google-books/route.ts',
];

describe('import writers never stamp the empty-OCR placeholder (#4685 population B)', () => {
  it.each(FILES_MUST_NOT_STAMP_PLACEHOLDER)('%s', (rel) => {
    const src = readFileSync(path.join(root, rel), 'utf8');
    expect(src, `${rel} stamps ocr/translation: { model: null, data: '' } at page creation`)
      .not.toMatch(PLACEHOLDER_RE);
  });

  it('the placeholder shape is recognizable (negative control)', () => {
    const fixture = `ocr: { language: 'la', model: null, data: '' }`;
    expect(fixture).toMatch(PLACEHOLDER_RE);
  });
});
