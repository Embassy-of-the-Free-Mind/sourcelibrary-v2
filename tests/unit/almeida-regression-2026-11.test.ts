import { describe, it, expect } from 'vitest';

// The member-report regression builder (scripts/eval/regression-from-almeida-2026-11.mjs) reads free text, so these pin
// what it takes from a line and what it refuses to take. Lines here are synthetic, not the member's.
const lib = await import('../../scripts/lib/shortlink-code.mjs');
const { encodeShortlink, decodeShortlink } = await import('@/lib/shortlinks');
const m = await import('../../scripts/eval/regression-from-almeida-2026-11.mjs');

describe('UUID shortlinks decode in scripts as the app decodes them', () => {
  it('round-trips the u… scheme and leaves decodeShortlinkCode refusing it', () => {
    for (const [id, n] of [['9754fae4-b3c6-45e6-8742-53c85117ca09', 17], ['00000000-0000-4000-8000-000000000001', 1], ['ffffffff-ffff-4fff-bfff-ffffffffffff', 65535]] as const) {
      const code = encodeShortlink(id, n);
      expect(lib.decodeUuidShortlinkCode(code)).toEqual(decodeShortlink(code));
      expect(lib.decodeShortlinkCode(code)).toBeNull();
    }
    expect(lib.decodeUuidShortlinkCode(encodeShortlink('6a06d4e89a48d513999643b4', 59))).toBeNull();
    expect(lib.decodeUuidShortlinkCode('u!!!!!!!!!!!!!!!!!!!!!!!!!')).toBeNull();
  });
});

describe('parseLine', () => {
  const code = encodeShortlink('6a06d4e89a48d513999643b4', 59);
  const line = `[ocr] Some Work, Venice 1546 (6a06d4e89a48d513999643b4), p. 41 [scans 57 to 59] | the OCR gives "fortibus" in the \`original\` field | the page prints "sortibus" (page image read) | sourcelibrary.org/q/${code} | Passage 12 (new)`;
  const p = m.parseLine(line);
  it('takes ids, locators, links, evidence and quoted spans', () => {
    expect(p).toMatchObject({
      category: 'ocr', book_id: '6a06d4e89a48d513999643b4', printed_page: 'p. 41', scans: [57, 58, 59],
      short_links: [code], evidence: 'human-image', defect_spans: ['fortibus'], page_spans: ['sortibus'],
      passage: '12', ledger_code: 'new',
    });
    expect(m.decodeCode(code)).toEqual({ bookId: '6a06d4e89a48d513999643b4', pageNumber: 59 });
  });
  it('reads the evidence marker three ways', () => {
    expect(m.evidenceOf('x (OCR only, image not seen)')).toBe('ocr-only');
    expect(m.evidenceOf('x (page images read)')).toBe('human-image');
    expect(m.evidenceOf('the page prints x')).toBe('unspecified');
  });
  it('drops field names and bare tags, keeps tagged text, caps long spans', () => {
    expect(m.quotedSpans('`continues_on_next` is true; `<note>` here; OCR gives `<page-num>615`')).toEqual(['<page-num>615']);
    expect(m.quotedSpans(`"${'a'.repeat(300)}"`)[0]).toHaveLength(120);
  });
  it('a wrong span is not a generic word nor the source word quoted on both sides', () => {
    expect(m.wrongSpansOf({ defect_spans: ['circulus', 'sphere', 'translation'], page_spans: ['circulus'] })).toEqual(['sphere']);
  });
  it('refuses a line that is not five fields', () => {
    expect(() => m.parseLine('[ocr] a | b | c')).toThrow(/5 fields/);
  });
});

describe('stillServed', () => {
  it('tests only spans of four or more characters, and null without text', () => {
    expect(m.stillServed(['ἡ'], 'ἡ ὁδός')).toBeNull();
    expect(m.stillServed(['fortibus'], 'in  fortibus\nviris')).toBe(true);
    expect(m.stillServed(['fortibus'], 'in sortibus')).toBe(false);
    expect(m.stillServed(['fortibus'], undefined)).toBeNull();
  });
});

describe('the committed labels', () => {
  it('put every line in exactly one batch and use only known class codes', async () => {
    const fs = await import('node:fs');
    const labels = JSON.parse(fs.readFileSync('scripts/eval/regression/almeida-2026-11-batches.json', 'utf8'));
    const seen = Object.values(labels.batches).flatMap((b) => (b as { lines: number[] }).lines).sort((a, b) => a - b);
    expect(seen).toEqual(Array.from({ length: labels.line_sha8.length }, (_, i) => i + 1));
    const taxonomy = fs.readFileSync('.claude/docs/page-error-taxonomy.md', 'utf8');
    const codes = [...Object.values(labels.batches).map((b) => (b as { class: string }).class), ...Object.values(labels.overrides) as string[]];
    for (const c of new Set(codes)) {
      if (c === 'none') continue;
      if (c.startsWith('new:')) { expect(labels.proposals[c]).toBeTruthy(); continue; }
      expect(taxonomy).toContain(`### ${c} ·`);
    }
  });
});
