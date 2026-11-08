/**
 * reader-request-lane (#7599): the request URL parse, the hold allowlist, and the reply a reader receives.
 */
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { parseRequestUrl, requestTitle, replyText, judgeRequest, requestedFirst, LANE_HOLDS, BOOK_CEILING, rereadSkip, rereadArgs, rereadRows, rereadTake, REREAD_CHUNK, stalled, blockers, STALL_DAYS } from '../../scripts/batch/reader-request-lane.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { latinFirstSteps, firstPagesFirst } from '../../scripts/batch/cli-ocr-lane.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('the OCR-first gate sends the book to the re-read (#8395)', () => {
  it('serves Latin, German and French, and says why not for anything else', () => {
    expect(rereadSkip({ language: 'Latin' })).toBeNull();
    expect(rereadSkip({ language: 'German' })).toBeNull();
    expect(rereadSkip({ language: 'French' })).toBeNull();
    expect(rereadSkip({ language: 'Italian' })).toMatch(/not Italian/);
    expect(rereadSkip({})).toMatch(/no language/);
  });

  it('runs the re-read in the same day folder the gex45 latin-first cron uses, so its ledger and claims are shared', () => {
    const date = '2026-11-08';
    const cron = latinFirstSteps({ home: '/root/.agy-james', root: '/root/jobs', date, maxPages: 10, concurrency: 4, apply: true })[0].args;
    const out = (a: string[]) => a.find((x) => x.startsWith('--out='));
    const latin = rereadArgs({ id: 'b1', language: 'Latin' }, { maxPages: 12, first: ['p9', 'p3'], date, apply: true, home: '/root/.agy-james' });
    expect(out(latin)).toBe(out(cron));
    expect(latin).toEqual(expect.arrayContaining(['correct', '--reread-per-call=4', '--reread-languages=Latin', '--book=b1', '--first=p9,p3', '--max-pages=12', '--agy-home=/root/.agy-james', '--apply']));
  });

  it('runs German without the Latin flag, the default pool when AGY_HOME is unset, and a dry run without --apply', () => {
    const de = rereadArgs({ id: 'b2', language: 'German' }, { maxPages: 5, date: '2026-11-08', apply: false, home: '' });
    expect(de).not.toContain('--reread-languages=Latin');
    expect(de).toContain('--agy-home=default');
    expect(de).not.toContain('--apply');
    expect(de.some((a: string) => a.startsWith('--first='))).toBe(false);
  });

  it('counts only this book\'s ledger rows written since the re-read started', () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rr-')), 'reread-ledger.jsonl');
    fs.writeFileSync(f, [
      { page_id: 'a', book_id: 'b1', outcome: 'written', at: '2026-11-08T09:00:00.000Z' },
      { page_id: 'b', book_id: 'b1', outcome: 'written', at: '2026-11-08T10:00:01.000Z' },
      { page_id: 'c', book_id: 'b1', outcome: 'other', at: '2026-11-08T10:00:02.000Z' },
      { page_id: 'd', book_id: 'b9', outcome: 'written', at: '2026-11-08T10:00:03.000Z' },
    ].map((r) => JSON.stringify(r)).join('\n') + '\n{half');
    expect(rereadRows(f, 'b1', '2026-11-08T10:00:00.000Z').map((r: { page_id: string }) => r.page_id)).toEqual(['b', 'c']);
    expect(rereadRows(f + '.none', 'b1', '2026-11-08T10:00:00.000Z')).toEqual([]);
  });

  it('re-reads one chunk a book a run, or every requested page, inside the budget', () => {
    expect(rereadTake({ left: 200, lite: 185, requested: 0 })).toBe(REREAD_CHUNK);
    expect(rereadTake({ left: 200, lite: 461, requested: 60 })).toBe(60);
    expect(rereadTake({ left: 15, lite: 461, requested: 2 })).toBe(15);
    expect(rereadTake({ left: 200, lite: 7 })).toBe(7);
    expect(rereadTake({ left: 0, lite: 7 })).toBe(0);
  });

  it('reads the requested pages first in the re-read', () => {
    expect(firstPagesFirst([{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }], new Set(['p3'])).map((p: { id: string }) => p.id)).toEqual(['p3', 'p1', 'p2']);
    expect(firstPagesFirst([{ id: 'p1' }], null).map((p: { id: string }) => p.id)).toEqual(['p1']);
  });
});

describe('the stall page (#8395)', () => {
  const now = Date.parse('2026-11-08T12:00:00Z');
  const run = (daysAgo: number, emailed = 0) => ({ at: new Date(now - daysAgo * 86_400_000).toISOString(), notify: { emailed } });
  const quiet = [run(3.5), run(2), run(1), run(0)];

  it('pages when requests are open and every run of the last 3 days emailed no one', () => {
    expect(STALL_DAYS).toBe(3);
    expect(stalled({ summaries: quiet, open: 12, now })).toBe(true);
  });
  it('stays quiet with no open request, after an email, before 3 days of runs, or within a day of the last page', () => {
    expect(stalled({ summaries: quiet, open: 0, now })).toBe(false);
    expect(stalled({ summaries: [run(3.5), run(2, 1), run(0)], open: 12, now })).toBe(false);
    expect(stalled({ summaries: [run(2), run(0)], open: 12, now })).toBe(false);
    expect(stalled({ summaries: quiet, open: 12, now, lastPagedAt: new Date(now - 3_600_000).toISOString() })).toBe(false);
    expect(stalled({ summaries: quiet, open: 12, now, lastPagedAt: new Date(now - 25 * 3_600_000).toISOString() })).toBe(true);
  });
  it('names each blocked book once, with its reason', () => {
    const summary = { books: [
      { book: 'b1', title: 'Symbolik', note: 'OCR-first gate: 3 page(s) still on Flash-Lite OCR', reread_skip: null },
      { book: 'b2', title: 'La Maddalena', note: 'OCR waits for a person: possible unsplit spreads' },
      { book: 'b3', title: 'Libro', note: null, lite_waiting: '9 page(s) still on Flash-Lite OCR', reread_skip: 'the re-read serves Latin, German and French print, not Italian' },
      { book: 'b4', title: 'Done', note: null, translated: 5 },
    ] };
    const reqs = [
      { row: { _id: 'r1' }, book: { id: 'b5', title: 'Stolp' }, verdict: { verdict: 'human', reason: 'book tail 824 pages > ceiling 800' } },
      { row: { _id: 'r2' }, book: { id: 'b2', title: 'La Maddalena' }, verdict: { verdict: 'auto' } },
    ];
    const lines = blockers(summary, reqs);
    expect(lines).toHaveLength(4);
    expect(lines[2]).toMatch(/Libro — 9 page\(s\).*\(the re-read serves .* not Italian\)/);
    expect(lines[3]).toBe('Stolp — human: book tail 824 pages > ceiling 800');
  });
});

describe('reader-request-lane', () => {
  it('parses the page URL a request carries, with or without host and query', () => {
    expect(parseRequestUrl('https://sourcelibrary.org/book/abc/page/def?x=1')).toEqual({ bookRef: 'abc', pageId: 'def' });
    expect(parseRequestUrl('/book/abc/page/def#t')).toEqual({ bookRef: 'abc', pageId: 'def' });
    expect(parseRequestUrl('/book/abc')).toBeNull();
    expect(parseRequestUrl(undefined)).toBeNull();
    expect(parseRequestUrl('/book/abc/page/%E0%A4%A')).toBeNull(); // a public write: a bad escape must not throw
  });

  describe('a request on a Siku-held book (#7690)', () => {
    const held = (reason: string, o = {}) => ({ id: 'b1', visible: true, pages_count: 171, pipeline_auto: { status: 'held', hold: { reason } }, ...o });
    const page = { id: 'p1', page_number: 6, page_type: 'text', ocr: { data: '欽定四庫全書 類說卷三十三 '.repeat(5) } };
    const judge = (o: Record<string, unknown>) => judgeRequest({ page, tail: 171, ceiling: BOOK_CEILING, ...o });

    it('is queued for the Siku lane, under every hold that lane owns, and never worked here', () => {
      for (const r of ['paddle-zh-5600-ocr-only', 'gpu-backlog-5660', 'zh-histories-7546']) {
        expect(judge({ book: held(r) }).verdict).toBe('siku');
      }
    });
    it('still refuses a hold that is not a lane\'s, and a dark Siku book', () => {
      expect(judge({ book: held('jabir-ocr-gate-7341') })).toMatchObject({ verdict: 'refuse', reason: 'book is on pipeline hold' });
      expect(judge({ book: held('paddle-zh-5600-ocr-only', { visible: false, hidden_reason: 'duplicate' }) }).verdict).toBe('refuse');
    });
    it('refuses a Siku page with no OCR, because that lane does not OCR; another lane\'s book still OCRs first', () => {
      const noOcr = { ...page, ocr: {} };
      expect(judge({ book: held('paddle-zh-5600-ocr-only'), page: noOcr }).verdict).toBe('refuse');
      expect(judge({ book: held('scans-only-publish-7176'), page: noOcr }).verdict).toBe('auto');
    });
    it('answers a Siku page that already has English, and sends a repeat to a person, as for any book', () => {
      expect(judge({ book: held('gpu-backlog-5660'), page: { ...page, translation: { data: 'x'.repeat(40) } } }).verdict).toBe('done');
      expect(judge({ book: held('gpu-backlog-5660'), repeat: 'repeat: x' }).verdict).toBe('human');
    });
  });

  it('allows only waiting-for-a-lane holds, never a containment', () => {
    expect(LANE_HOLDS).toContain('ocr-flash-cli-7075');
    expect(LANE_HOLDS).toContain('translate-cli-7075');
    for (const r of LANE_HOLDS) expect(r).not.toMatch(/contain|invent|wrong-leaf|awaits|fabricat|poison/);
  });

  it('puts the requested pages first and keeps the rest in order', () => {
    const pages = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'p4' }];
    expect(requestedFirst(pages, new Set(['p3'])).map((p: { id: string }) => p.id)).toEqual(['p3', 'p1', 'p2', 'p4']);
  });

  it('takes the title from the request prompt, shortened at the first sentence when long', () => {
    expect(requestTitle('Translation requested for "Turris Babel" (page 101)')).toBe('Turris Babel');
    expect(requestTitle('no title here')).toBe('the book');
    const long = `${'A'.repeat(50)}. ${'B'.repeat(50)}`;
    expect(requestTitle(`Translation requested for "${long}" (page 1)`)).toBe('A'.repeat(50));
  });

  it('says the book is done, or underway only when the lane is on it, and links other editions only when not done', () => {
    const base = { title: 'T', pageNumber: 9 };
    expect(replyText({ ...base, bookDone: true, editions: [{ year: 1584, url: 'u' }] })).toBe('The page you asked about in "T" (page 9) now has an English translation. The whole book now has an English translation.');
    expect(replyText({ ...base, bookDone: false, underway: false })).toBe('The page you asked about in "T" (page 9) now has an English translation.');
    expect(replyText({ ...base, bookDone: false, underway: true, alsoPages: [19] })).toMatch(/Page 19, which you also asked about, is translated too\. We are transcribing and translating the rest/);
    expect(replyText({ ...base, bookDone: false, editions: [{ year: 1584, url: 'a' }, { year: 1637, url: 'b' }] })).toMatch(/Other editions of the same work are already readable in English: 1584 \(a\) and 1637 \(b\)\./);
  });
});
