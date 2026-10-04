import { describe, it, expect } from 'vitest';
import {
  cleanGlm, scriptGuard, truncationGuard, guardVerdict, endsClosed, bookMedianChars, longestWordRun, envelope, ocrSetFields,
} from '../../scripts/lib/glm-english-lane.mjs';
import { missingProvenance } from '../../scripts/lib/write-provenance.mjs';

// The two guards #5660 asked for before any GLM-OCR text is stored (verdict 2026-10-04 04:35Z).
// Fixtures are shaped on the bake-off's own GLM reads (PR #5786).
const PROSE = 'And therefore it is manifest, that the Spirit of the World is the bond of all things; for without it the Heavens could not move, nor the Elements be mixed.';

describe('script guard', () => {
  it('refuses the Hebrew-title failure ("ישראל ישראל …")', () => {
    const g = scriptGuard('3. Lichtenstein (Abraham ben Eliezer). ישראל ישראל ישראל ישראל. Wilna, 1799.');
    expect(g.pass).toBe(false);
    expect(g.reasons).toEqual(expect.arrayContaining(['non_latin_script', 'repeated_word']));
    expect(g.detail.word).toBe('ישראל');
  });
  it('refuses any Greek in an English book — GLM is not trusted on Greek (60/114 catastrophic)', () => {
    expect(scriptGuard(`${PROSE} λόγος τοῦ θεοῦ`).reasons).toEqual(['non_latin_script']);
  });
  it('refuses a Latin-script word repeated three times in a row', () => {
    expect(scriptGuard(`${PROSE} the the the Elements`).reasons).toEqual(['repeated_word']);
  });
  it('passes English print, long-s, ligatures, thorn and symbols', () => {
    const g = scriptGuard(`${PROSE} ſo þe Æther ☉ ♀ — &c. &c. &c. that that is`);
    expect(g).toMatchObject({ pass: true, reasons: [] });
  });
  it('a single letter repeated is not a word run (I. I. I. in a list)', () => {
    expect(longestWordRun('I I I I').run).toBe(0);
  });
});

describe('truncation guard', () => {
  it('flags the token cap, from finish or from the token count', () => {
    expect(truncationGuard(PROSE, { finish: 'length' }).reasons).toEqual(['token_cap']);
    expect(truncationGuard(PROSE, { finish: 'stop', out_tok: 4500, max_tokens: 4500 }).reasons).toEqual(['token_cap']);
  });
  it('flags a read that ends mid-line AND is far shorter than the book', () => {
    const cut = 'And therefore it is manifest, that the Spirit of the World is the bond of all things; for without it the';
    expect(truncationGuard(cut, { finish: 'stop' }, 1500).reasons).toEqual(['ends_mid_line']);
  });
  it('a page that runs on to the next page is NOT truncation when it is full length', () => {
    const full = `${PROSE}\n`.repeat(10) + 'and so the Heavens';
    expect(truncationGuard(full, { finish: 'stop' }, 1500).pass).toBe(true);
  });
  it('a short page that closes (a chapter end) passes; an unknown book median never flags mid-line', () => {
    expect(truncationGuard(PROSE, { finish: 'stop' }, 1500).pass).toBe(true);
    expect(truncationGuard('and so the', { finish: 'stop' }, null).pass).toBe(true);
  });
  it('a catchword or a hyphen closes a page', () => {
    expect(endsClosed(`${PROSE}\nwhich`)).toBe(true);
    expect(endsClosed('the bond of all things; for with-')).toBe(true);
    expect(endsClosed('the bond of all things; for without it the')).toBe(false);
  });
  it('the book median needs enough real pages', () => {
    expect(bookMedianChars([1000, 1200, 50])).toBeNull();
    expect(bookMedianChars([900, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 10])).toBe(1300);
  });
});

describe('the page write', () => {
  it('cleans fences, envelopes, and carries provenance the checker accepts', () => {
    const body = cleanGlm('```markdown\n# THE PREFACE\n\nTo the Reader.\n```\n\n');
    expect(body).toBe('# THE PREFACE\n\nTo the Reader.');
    const text = envelope(body);
    const v = guardVerdict(body, { finish: 'stop', out_tok: 12, max_tokens: 8192 }, null);
    expect(v.pass).toBe(true);
    const set = ocrSetFields(text, { run: 'glm-english-2026-10/test', imageUrl: 'https://images.sourcelibrary.org/x/1.jpg', guards: v });
    const ocr = { data: set['ocr.data'], source: set['ocr.source'], updated_at: set['ocr.updated_at'], content_hash: set['ocr.content_hash'], engine: set['ocr.engine'] };
    expect(missingProvenance('ocr', ocr).missing).toEqual([]);
    expect(missingProvenance('ocr', { ...ocr, engine: { ...ocr.engine, run: undefined } }).missing).toEqual(['ocr.engine.run']);
    expect(set['ocr.engine']).toMatchObject({ licence: 'MIT', model: 'zai-org/GLM-OCR' });
    expect(set['ocr.data'].startsWith('<language>English</language>\n<script>printed</script>\n\n# THE PREFACE')).toBe(true);
  });
});
