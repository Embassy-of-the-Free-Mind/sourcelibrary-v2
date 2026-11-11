/**
 * The daily new-translation leak check (#5026): bookFlags on made pairs. Each firing case has a twin that differs in
 * the one condition the rule turns on (the window, the source repeat, the run length), so deleting it fails a test.
 * The real-data control (L'escole des filles before its repair: 8 pages, 12 pairs) is on #5026, not here.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { bookFlags, seenKeys, ntfyLine, RUN_MIN } from '../../scripts/audit/new-translation-leaks.mjs';

const WORDS = 'the of salt mercury sulphur fire water earth air stone king queen vessel heat light dark green lion eagle dragon moon sun gold silver tree root seed glass furnace ash tincture'.split(' ');
function prose(seed: number, n: number): string {
  let x = seed * 2654435761 % 4294967296, out = '';
  while (out.length < n) { x = (x * 1103515245 + 12345) % 2147483648; out += WORDS[x % WORDS.length] + (x % 7 === 0 ? `${seed}. ` : ' '); }
  return out.slice(0, n);
}
const page = (n: number, src: string, en: string, extra: any = {}) => ({
  page_number: n, page_type: 'text', ocr: { data: src },
  translation: { data: en, model: 'gemini-x', updated_at: new Date('2026-11-08T01:00:00Z'), engine: { call_site: 'scripts/batch/cli-translate.mjs', run: { job_id: 'j1' } }, ...extra },
});

// p.2's English = its own English + p.1's English appended (the Atalanta shape): 1,000 chars of copy.
const p1 = page(1, prose(101, 1000), prose(1, 1000));
const p2leak = page(2, prose(102, 1000), prose(2, 1000) + ' ' + prose(1, 1000));
const p2ok = page(2, prose(102, 1000), prose(2, 1000));
const p3 = page(3, prose(103, 1000), prose(3, 1000));

describe('bookFlags', () => {
  it('fires on a page written in the window that carries its neighbour\'s English, and names its lane and model', () => {
    const f = bookFlags({ bookId: 'b', pages: [p1, p2leak, p3], windowed: new Set([2]), k: 0 });
    // p.2 at twice its source's length also fits its source plus p.3's: the guard's length rule names that pair too.
    expect(f.map((x: any) => `${x.prev}-${x.next}`)).toEqual(['1-2', '2-3']);
    expect(f[1].rules).toEqual(['guard:absorbs-neighbour@2']);
    expect(f[0]).toMatchObject({ prev: 1, next: 2, receiver: { page: 2, lane: 'scripts/batch/cli-translate.mjs', model: 'gemini-x', job: 'j1' }, receiver_in_window: true });
    expect(f[0].rules).toContain('shared-run');
    expect(f[0].rules.some((r: string) => r.startsWith('guard:neighbour-leak@2'))).toBe(true);
    expect(f[0].run_len).toBeGreaterThanOrEqual(RUN_MIN);
  });

  it('is silent on the same pair when neither page was written in the window', () => {
    expect(bookFlags({ bookId: 'b', pages: [p1, p2leak, p3], windowed: new Set([3]), k: 0 })).toHaveLength(0);
  });

  it('is silent when the page carries only its own English', () => {
    expect(bookFlags({ bookId: 'b', pages: [p1, p2ok, p3], windowed: new Set([1, 2, 3]), k: 0 })).toHaveLength(0);
  });

  it('does not count a run the SOURCES share too (the book repeats itself)', () => {
    const refrain = prose(500, 1000);
    const a = page(1, refrain + prose(101, 300), refrain + prose(1, 300));
    const b = page(2, refrain + prose(102, 300), refrain + prose(2, 300));
    expect(bookFlags({ bookId: 'b', pages: [a, b], windowed: new Set([2]), k: 0 })).toHaveLength(0);
  });

  it('flags a new page beside an OLD page that holds the copy, with the old page as receiver', () => {
    const old = page(1, prose(101, 1000), prose(1, 1000) + ' ' + prose(2, 1000), { updated_at: new Date('2026-04-01T00:00:00Z') });
    const f = bookFlags({ bookId: 'b', pages: [old, p2ok], windowed: new Set([2]), k: 0 });
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ receiver: { page: 1 }, receiver_in_window: false, other: { page: 2 } });
    expect(ntfyLine({ fresh: f, titles: new Map([['b', 'Book']]), books: 1, pages: 1, date: 'd', monday: false })).toMatch(/held by old p\.1 \(2026-04-01/);
  });

  it('a pair re-flagged on a later day is not new; a rewritten receiver is', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ntl-'));
    const f = bookFlags({ bookId: 'b', pages: [p1, p2leak], windowed: new Set([2]), k: 0 });
    fs.writeFileSync(path.join(dir, '2026-11-07.jsonl'), f.map((x: any) => JSON.stringify(x)).join('\n') + '\n');
    expect(seenKeys(dir, '2026-11-08.jsonl').has(f[0].key)).toBe(true);
    expect(seenKeys(dir, '2026-11-07.jsonl').has(f[0].key)).toBe(false);
    const again = bookFlags({ bookId: 'b', pages: [p1, page(2, prose(102, 1000), prose(9, 1000) + ' ' + prose(1, 1000))], windowed: new Set([2]), k: 0 });
    expect(again[0].key).not.toBe(f[0].key);
  });
});

describe('ntfyLine', () => {
  it('silent at zero on a weekday; one weekly line on Monday', () => {
    expect(ntfyLine({ fresh: [], titles: new Map(), books: 190, pages: 3900, date: 'd', monday: false })).toBeNull();
    expect(ntfyLine({ fresh: [], titles: new Map(), books: 190, pages: 3900, date: 'd', monday: true })).toMatch(/checked 190 books .* 0 new leaks/);
  });
});
