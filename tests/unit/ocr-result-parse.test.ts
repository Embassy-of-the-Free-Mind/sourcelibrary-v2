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
} from '@/lib/types/prompts/defaults';
import {
  PROMPT_VERSION as PROMPT_VERSION_JS,
  VALID_PAGE_TYPES as VALID_PAGE_TYPES_JS,
  extractPageType as extractPageTypeJs,
  extractColumns as extractColumnsJs,
  extractScriptType as extractScriptTypeJs,
  parseMultiPageOcr as parseMultiPageOcrJs,
} from '../../scripts/lib/ocr-result-parse.mjs';

/** One fixture per real-world shape the six copies disagreed on. */
const pageTypeFixtures: Record<string, string> = {
  plain: 'body text\n<page-type>title-page</page-type>\n<vocab>x</vocab>',
  padded: '<page-type>  Frontispiece  </page-type>',
  uppercaseTag: '<PAGE-TYPE>blank</PAGE-TYPE>',
  multiline: '<page-type>\ntext\n</page-type>',
  // Offered by the OCR prompt, absent from VALID_PAGE_TYPES — see #4444.
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

  it('the three prompt-only types are the measured vocabulary gap (#4444)', () => {
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
});
