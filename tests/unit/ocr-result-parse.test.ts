/**
 * The scripts-side OCR parser must not drift from the TS canonical.
 *
 * `src/lib/types/prompts/defaults.ts` is the canonical OCR-result parser. Until
 * #4443 `scripts/lib/` had no twin of it, so six pipeline scripts each carried a
 * private copy and imported nothing — and those copies had drifted into five
 * mutually incompatible behaviours:
 *
 *   - `collect-batch-results.mjs`, `realtime-ocr.mjs`, `realtime-reocr-efm.mjs`,
 *     `collect-multipage-ocr.mjs` — wrote the model's page-type string with no
 *     vocabulary screening at all;
 *   - `workers/batch-collector.mjs` — screened against a 14-value set that had
 *     lost `digitizer-insert`, so the collector could not record the very type
 *     the digitizer-page guards read;
 *   - `split-book.mjs` — screened against a different 15-value set;
 *   - `collect-multipage-ocr.mjs` — had also lost the `i` flag, so `<PAGE-TYPE>`
 *     did not match.
 *
 * None of it errors. A dropped `<page-type>` is *missing metadata*, and these are
 * the collectors that read batch output we have already paid to generate. This
 * test is the report that never existed: it runs both implementations over one
 * fixture corpus and fails if they disagree.
 */
import { describe, it, expect } from 'vitest';
import {
  PROMPT_VERSION,
  VALID_PAGE_TYPES,
  extractPageType,
  extractColumns,
  extractScriptType,
  parseMultiPageOcr,
  parseDetectedImages,
} from '@/lib/types/prompts/defaults';
import {
  PROMPT_VERSION as PROMPT_VERSION_JS,
  VALID_PAGE_TYPES as VALID_PAGE_TYPES_JS,
  extractPageType as extractPageTypeJs,
  extractColumns as extractColumnsJs,
  extractScriptType as extractScriptTypeJs,
  parseMultiPageOcr as parseMultiPageOcrJs,
  parseDetectedImages as parseDetectedImagesJs,
} from '../../scripts/lib/ocr-result-parse.mjs';

/** One fixture per real-world shape the six copies disagreed on. */
const pageTypeFixtures: Record<string, string> = {
  plain: 'body text\n<page-type>title-page</page-type>\n<vocab>x</vocab>',
  padded: '<page-type>  Frontispiece  </page-type>',
  uppercaseTag: '<PAGE-TYPE>blank</PAGE-TYPE>',
  multiline: '<page-type>\ntext\n</page-type>',
  // Offered by the OCR prompt, absent from VALID_PAGE_TYPES — see #4455.
  promptOnly: '<page-type>musical-score</page-type>',
  promptOnlyTable: '<page-type>table</page-type>',
  promptOnlyCover: '<page-type>cover</page-type>',
  // The type batch-collector.mjs's stale set could not record.
  digitizer: '<page-type>digitizer-insert</page-type>',
  exlibris: '<page-type>exlibris</page-type>',
  garbage: '<page-type>a page of some kind</page-type>',
  empty: '<page-type></page-type>',
  absent: 'just body text with no tags at all',
};

const columnsFixtures: Record<string, string> = {
  two: '<columns>2</columns>',
  padded: '<columns> 3 </columns>',
  single: '<columns>1</columns>',
  uppercase: '<COLUMNS>4</COLUMNS>',
  absent: 'no columns tag',
};

const scriptFixtures: Record<string, string> = {
  printed: '<script>printed</script>',
  handwritten: '<script>  Handwritten  </script>',
  mixed: '<script>mixed</script>',
  bogus: '<script>engraved</script>',
  absent: 'no script tag',
};

const multiPageFixtures: Record<string, string> = {
  wellFormed: '<page id="a1">alpha</page>\n<page id="a2">beta</page>',
  // Gemini truncates a long batch response mid-stream: the last page loses its
  // closing tag. The strict parser drops it; the collector dialect keeps it.
  truncatedTail: '<page id="a1">alpha</page>\n<page id="a2">beta but never closed',
  extraWhitespaceInTag: '<page   id="a1">alpha</page>',
  emptyBlock: '<page id="a1"></page>\n<page id="a2">beta</page>',
  interleaved: 'preamble\n<page id="a1">alpha</page>\ntrailing prose\n<page id="a2">beta</page>',
  none: 'no page blocks here',
};

/**
 * `<detected-images>` fixtures (#4456). The block the current prompt asks for is a
 * JSON array; `xmlWalkerShape` is the format the five scripts-side copies parsed,
 * which the prompt has never asked for and which zero production pages hold — it
 * is here to pin that BOTH implementations now ignore it identically.
 */
const detectedImagesFixtures: Record<string, string> = {
  full: `body\n<detected-images>\n[{"description": "Alchemical emblem, king and queen", "type": "emblem", "bbox": {"x": 0.1, "y": 0.2, "width": 0.7, "height": 0.5}, "gallery_quality": 0.85, "museum_rationale": "Striking allegorical scene", "confidence": 0.9, "museum_description": "A crowned pair...", "metadata": {"subjects": ["alchemy"], "figures": ["king", 7], "symbols": ["sun"], "style": "baroque", "technique": "engraving"}}]\n</detected-images>`,
  minimal: '<detected-images>[{"description": "a woodcut"}]</detected-images>',
  twoImages: '<detected-images>[{"description": "one", "type": "map"}, {"description": "two", "type": "portrait"}]</detected-images>',
  uppercaseTag: '<DETECTED-IMAGES>[{"description": "shouted"}]</DETECTED-IMAGES>',
  // Model emitted a type outside the gallery vocabulary — dropped, image kept.
  invalidType: '<detected-images>[{"description": "x", "type": "woodcut-ish"}]</detected-images>',
  // Reasoning-as-value, the #3419 failure shape.
  narratedType: '<detected-images>[{"description": "x", "type": "diagram - wait, must be one of the list"}]</detected-images>',
  outOfRangeQuality: '<detected-images>[{"description": "x", "gallery_quality": 1.7}]</detected-images>',
  negativeQuality: '<detected-images>[{"description": "x", "gallery_quality": -0.4}]</detected-images>',
  partialBbox: '<detected-images>[{"description": "x", "bbox": {"x": 0.1, "y": 0.2, "width": 0.7}}]</detected-images>',
  stringBbox: '<detected-images>[{"description": "x", "bbox": {"x": "0.1", "y": 0.2, "width": 0.7, "height": 0.5}}]</detected-images>',
  // The old pixel four-tuple. Not a bbox this parser recognises — must be dropped,
  // never coerced (detected_images.bbox is read as fractional).
  pixelBbox: '<detected-images>[{"description": "x", "bbox": {"x1": 10, "y1": 20, "x2": 900, "y2": 1400}}]</detected-images>',
  noDescription: '<detected-images>[{"type": "emblem", "bbox": {"x": 0, "y": 0, "width": 1, "height": 1}}]</detected-images>',
  mixedValidity: '<detected-images>[{"type": "emblem"}, {"description": "kept"}]</detected-images>',
  notAnArray: '<detected-images>{"description": "an object, not an array"}</detected-images>',
  malformedJson: '<detected-images>[{"description": "truncated mid-</detected-images>',
  emptyArray: '<detected-images>[]</detected-images>',
  padded: '<detected-images>\n\n  [{"description": "padded"}]  \n\n</detected-images>',
  // What the five scripts-side walkers were written for.
  xmlWalkerShape: '<detected-images><image><description>emblem</description><type>emblem</type><bbox>10,20,900,1400</bbox></image></detected-images>',
  xmlWalkerBoundingBox: '<detected-images><image><description>emblem</description><type>emblem</type><bounding-box>10,20,900,1400</bounding-box></image></detected-images>',
  absent: 'a text-only page, block omitted as the prompt instructs',
};

/**
 * `detected_at` is `new Date()` at parse time, so two runs never produce equal
 * objects. Normalise it away — and assert it was a Date, which is the part that
 * matters (it is written to Mongo as the provenance stamp).
 */
function normalizeDetected(images: Array<Record<string, unknown>>) {
  return images.map((img) => {
    expect(img.detected_at).toBeInstanceOf(Date);
    const { detected_at: _dropped, ...rest } = img;
    return rest;
  });
}

describe('TS canonical and scripts JS twin agree — extractPageType', () => {
  it('validating mode returns identical results for every fixture', () => {
    for (const [name, text] of Object.entries(pageTypeFixtures)) {
      expect(extractPageTypeJs(text), name).toBe(extractPageType(text));
    }
  });

  it('validate:false mode returns identical results for every fixture', () => {
    for (const [name, text] of Object.entries(pageTypeFixtures)) {
      expect(extractPageTypeJs(text, { validate: false }), name)
        .toBe(extractPageType(text, { validate: false }));
    }
  });

  it('the two vocabulary sets are the same set', () => {
    expect([...VALID_PAGE_TYPES_JS].sort()).toEqual([...VALID_PAGE_TYPES].sort());
  });
});

describe('TS canonical and scripts JS twin agree — the rest', () => {
  it('extractColumns', () => {
    for (const [name, text] of Object.entries(columnsFixtures)) {
      expect(extractColumnsJs(text), name).toBe(extractColumns(text));
    }
  });

  it('extractScriptType', () => {
    for (const [name, text] of Object.entries(scriptFixtures)) {
      expect(extractScriptTypeJs(text), name).toBe(extractScriptType(text));
    }
  });

  it('parseMultiPageOcr, strict and lenient', () => {
    for (const [name, text] of Object.entries(multiPageFixtures)) {
      for (const lenient of [false, true]) {
        expect([...parseMultiPageOcrJs(text, { lenient })], `${name}/lenient=${lenient}`)
          .toEqual([...parseMultiPageOcr(text, { lenient })]);
      }
    }
  });

  it('parseDetectedImages', () => {
    for (const [name, text] of Object.entries(detectedImagesFixtures)) {
      expect(normalizeDetected(parseDetectedImagesJs(text)), name)
        .toEqual(normalizeDetected(parseDetectedImages(text)));
    }
  });

  it('PROMPT_VERSION is mirrored', () => {
    expect(PROMPT_VERSION_JS).toBe(PROMPT_VERSION);
  });
});

/**
 * Behaviour the parity assertions above would pass while both sides were wrong
 * together. These pin what the functions actually do.
 */
describe('extractPageType behaviour', () => {
  it('screens the model output against the vocabulary by default', () => {
    expect(extractPageType(pageTypeFixtures.garbage)).toBeUndefined();
    expect(extractPageType(pageTypeFixtures.plain)).toBe('title-page');
  });

  it('validate:false passes the model string through, screening nothing', () => {
    expect(extractPageType(pageTypeFixtures.garbage, { validate: false }))
      .toBe('a page of some kind');
  });

  it('the three prompt-only types are the measured vocabulary gap (#4455)', () => {
    // The OCR prompt offers musical-score / table / cover and the reader renders
    // them (tests/unit/page-type-vocabulary.test.ts), but VALID_PAGE_TYPES does
    // not list them — which is why the four unvalidated collectors could NOT be
    // flipped to validating in #4443 without silently dropping all three.
    for (const t of ['musical-score', 'table', 'cover']) {
      expect(VALID_PAGE_TYPES.has(t), `${t} unexpectedly in VALID_PAGE_TYPES`).toBe(false);
      expect(extractPageType(`<page-type>${t}</page-type>`)).toBeUndefined();
      expect(extractPageType(`<page-type>${t}</page-type>`, { validate: false })).toBe(t);
    }
  });

  it('digitizer-insert survives — the type batch-collector could not record', () => {
    expect(extractPageType(pageTypeFixtures.digitizer)).toBe('digitizer-insert');
  });

  it('matches case-insensitively and across newlines', () => {
    expect(extractPageType(pageTypeFixtures.uppercaseTag)).toBe('blank');
    expect(extractPageType(pageTypeFixtures.multiline)).toBe('text');
  });

  it('an empty tag is undefined, never the empty string', () => {
    expect(extractPageType(pageTypeFixtures.empty, { validate: false })).toBeUndefined();
  });
});

describe('extractColumns behaviour', () => {
  it('tolerates whitespace inside the tag (every scripts copy did)', () => {
    expect(extractColumns('<columns> 3 </columns>')).toBe(3);
  });
  it('single-column is undefined, not 1', () => {
    expect(extractColumns('<columns>1</columns>')).toBeUndefined();
  });
});

describe('parseMultiPageOcr behaviour', () => {
  it('strict mode drops a page whose closing tag was truncated away', () => {
    const strict = parseMultiPageOcr(multiPageFixtures.truncatedTail);
    expect([...strict.keys()]).toEqual(['a1']);
  });

  it('lenient mode recovers it — that page was already paid for', () => {
    const lenient = parseMultiPageOcr(multiPageFixtures.truncatedTail, { lenient: true });
    expect([...lenient.keys()]).toEqual(['a1', 'a2']);
    expect(lenient.get('a2')).toBe('beta but never closed');
  });

  it('lenient mode omits an empty block; strict mode keeps it', () => {
    expect([...parseMultiPageOcr(multiPageFixtures.emptyBlock, { lenient: true }).keys()])
      .toEqual(['a2']);
    expect([...parseMultiPageOcr(multiPageFixtures.emptyBlock).keys()])
      .toEqual(['a1', 'a2']);
  });

  it('lenient mode absorbs prose that follows a closed block, tag and all', () => {
    // A wart of the dialect, pinned rather than fixed: because a block runs to
    // the next `<page id=`, anything printed between two pages is appended to the
    // earlier one — and since the `</page>` is no longer trailing, it survives
    // the strip and lands in the stored text. Strict mode does not have this
    // problem. Changing it would rewrite what the collectors store, so #4443
    // records it instead.
    const lenient = parseMultiPageOcr(multiPageFixtures.interleaved, { lenient: true });
    expect(lenient.get('a1')).toBe('alpha</page>\ntrailing prose');
    expect(lenient.get('a2')).toBe('beta');
    expect(parseMultiPageOcr(multiPageFixtures.interleaved).get('a1')).toBe('alpha');
  });

  it('strict mode requires exactly one space before id=', () => {
    expect(parseMultiPageOcr(multiPageFixtures.extraWhitespaceInTag).size).toBe(0);
    expect(parseMultiPageOcr(multiPageFixtures.extraWhitespaceInTag, { lenient: true }).size).toBe(1);
  });
});

/**
 * `parseDetectedImages` behaviour (#4456).
 *
 * The defect this closes was not a wrong value — it was `[]` on every page, from a
 * parser written for a format the prompt does not emit, behind a
 * `if (detectedImages.length > 0)` guard that made the loss silent. The first test
 * here is the one that would have caught it: the JSON shape the prompt actually
 * asks for must yield a non-empty result.
 */
describe('parseDetectedImages behaviour', () => {
  it('parses the shape the OCR prompt asks for — the case that returned [] (#4456)', () => {
    const [img] = parseDetectedImages(detectedImagesFixtures.full);
    expect(img.description).toBe('Alchemical emblem, king and queen');
    expect(img.type).toBe('emblem');
    expect(img.bbox).toEqual({ x: 0.1, y: 0.2, width: 0.7, height: 0.5 });
    expect(img.gallery_quality).toBe(0.85);
    expect(img.gallery_rationale).toBe('Striking allegorical scene');
    expect(img.confidence).toBe(0.9);
    expect(img.museum_description).toBe('A crowned pair...');
    expect(img.metadata).toEqual({
      subjects: ['alchemy'],
      figures: ['king'], // the non-string is filtered out
      symbols: ['sun'],
      style: 'baroque',
      technique: 'engraving',
    });
    expect(img.detection_source).toBe('ocr_tag');
    expect(img.detected_at).toBeInstanceOf(Date);
  });

  it('the `<image>` sub-tag shape yields nothing — no fallback was kept', () => {
    // Both walkers the five scripts carried are represented. Zero production
    // pages hold this shape, and no prompt in this repo asks for it, so parsing
    // it would be dead code that the TS canonical does not have.
    expect(parseDetectedImages(detectedImagesFixtures.xmlWalkerShape)).toEqual([]);
    expect(parseDetectedImages(detectedImagesFixtures.xmlWalkerBoundingBox)).toEqual([]);
  });

  it('an image with no description is dropped, and does not take its siblings with it', () => {
    expect(parseDetectedImages(detectedImagesFixtures.noDescription)).toEqual([]);
    const mixed = parseDetectedImages(detectedImagesFixtures.mixedValidity);
    expect(mixed.map((i) => i.description)).toEqual(['kept']);
  });

  it('a type outside the gallery vocabulary is omitted, the image is kept', () => {
    // Including the reasoning-as-value shape from #3419 — narration must never
    // land in `type`.
    for (const key of ['invalidType', 'narratedType'] as const) {
      const [img] = parseDetectedImages(detectedImagesFixtures[key]);
      expect(img.description, key).toBe('x');
      expect(img.type, key).toBeUndefined();
    }
  });

  it('gallery_quality is clamped to 0..1', () => {
    expect(parseDetectedImages(detectedImagesFixtures.outOfRangeQuality)[0].gallery_quality).toBe(1);
    expect(parseDetectedImages(detectedImagesFixtures.negativeQuality)[0].gallery_quality).toBe(0);
  });

  it('a bbox is all-or-nothing, and the pixel four-tuple is not a bbox', () => {
    // `detected_images.bbox` is read as fractional x/y/width/height. A partial or
    // wrong-shaped box is dropped rather than half-filled or coerced — a pixel
    // `{x1,y1,x2,y2}` read as fractions would crop the whole page.
    for (const key of ['partialBbox', 'stringBbox', 'pixelBbox'] as const) {
      expect(parseDetectedImages(detectedImagesFixtures[key])[0].bbox, key).toBeUndefined();
    }
  });

  it('malformed JSON, a non-array, and an absent block all give []', () => {
    for (const key of ['malformedJson', 'notAnArray', 'emptyArray', 'absent'] as const) {
      expect(parseDetectedImages(detectedImagesFixtures[key]), key).toEqual([]);
    }
  });

  it('matches case-insensitively and tolerates padding inside the block', () => {
    expect(parseDetectedImages(detectedImagesFixtures.uppercaseTag)[0].description).toBe('shouted');
    expect(parseDetectedImages(detectedImagesFixtures.padded)[0].description).toBe('padded');
  });

  it('keeps every image in the array, in order', () => {
    expect(parseDetectedImages(detectedImagesFixtures.twoImages).map((i) => i.description))
      .toEqual(['one', 'two']);
  });
});

/**
 * Scripts-only hardening: `split-book.mjs` calls extractPageType with `page.ocr`,
 * which is null on an un-OCR'd page. The twin must not throw there.
 */
describe('twin tolerates the nullish input scripts actually pass', () => {
  it('extractPageType(null) is undefined, not a TypeError', () => {
    expect(extractPageTypeJs(null)).toBeUndefined();
    expect(extractPageTypeJs(undefined)).toBeUndefined();
  });
  it('extractColumns(null) is undefined', () => {
    expect(extractColumnsJs(null)).toBeUndefined();
  });
  it('parseDetectedImages(null) is [], not a TypeError', () => {
    // The TS canonical does `ocrText.match(...)` and throws here; the collectors
    // read `ocr.data` off documents where it can be absent.
    expect(parseDetectedImagesJs(null)).toEqual([]);
    expect(parseDetectedImagesJs(undefined)).toEqual([]);
  });
});
