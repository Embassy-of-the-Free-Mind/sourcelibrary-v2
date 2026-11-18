/**
 * reader-request-lane (#7599): the request URL parse, the hold allowlist, and the reply a reader receives.
 */
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { parseRequestUrl, requestTitle, replyText, judgeRequest, requestedFirst, LANE_HOLDS, BOOK_CEILING, rereadSkip, rereadArgs, rereadRows, rereadTake, REREAD_CHUNK, stalled, blockers, STALL_DAYS, cannotServe, readerHold, scopeIds, waitingLines, WAIT_HOURS, underway, feedbackNote } from '../../scripts/batch/reader-request-lane.mjs';
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

describe('a request the lane can never serve is a refusal with its reason, not work (#406)', () => {
  const text = Array.from({ length: 80 }, (_, i) => `शिव${i} sutra${i}`).join(' ');
  const lite = (o = {}) => ({ id: 'p7', page_number: 7, page_type: 'text', ocr: { model: 'gemini-3.1-flash-lite', data: text }, ...o });
  const book = (o = {}) => ({ id: 'b1', title: 'T', language: 'Sanskrit', visible: true, pages_count: 51, pipeline_auto: { status: 'held', hold: { reason: 'scans-only-publish-7270' } }, ...o });
  const judge = (o: Record<string, unknown>) => judgeRequest({ book: book(), page: lite(), tail: 48, ceiling: BOOK_CEILING, ...o });

  it('refuses a Flash-Lite page in a language the re-read does not serve, naming why', () => {
    const v = judge({});
    expect(v.verdict).toBe('refuse');
    expect(v.reason).toMatch(/^lane cannot serve: .*not Sanskrit/);
  });
  it('works the same page in a language the re-read serves, and a Sanskrit page that is not Flash-Lite or was checked by a person', () => {
    expect(judge({ book: book({ language: 'German' }) }).verdict).toBe('auto');
    expect(judge({ page: lite({ ocr: { model: 'gemini-3-flash-preview', data: text } }) }).verdict).toBe('auto');
    expect(judge({ page: lite({ ocr: { model: 'gemini-3.1-flash-lite', data: text, edited_by: 'someone' } }) }).verdict).toBe('auto');
    expect(cannotServe({ book: book(), page: lite(), lane: { row: { adoption: { ocr_checked: 'checked 3 pages by eye' } } } })).toBeNull();
  });
  it('refuses a Flash-Lite page in a book the re-read cannot read (not visible) only when the gates let it through', () => {
    expect(cannotServe({ book: book({ language: 'German', visible: false }), page: lite(), lane: null })).toMatch(/visible books only/);
  });
  it('serves a tail over the ceiling on the requested pages instead of sending it to a person', () => {
    const v = judge({ book: book({ language: 'Polish', pipeline_auto: { status: 'failed' } }), page: lite({ ocr: { model: 'gemini-3-flash-preview', data: text } }), tail: 849 });
    expect(v).toMatchObject({ verdict: 'auto', scope: 'requested' });
    expect(judge({ book: book({ language: 'German' }), tail: 40 }).scope).toBeUndefined();
  });
  it('asks the re-read to admit a held book only for a hold outside its frame, on the requested pages only', () => {
    expect(readerHold(book())).toBe('scans-only-publish-7270');
    expect(readerHold(book({ pipeline_auto: { status: 'held', hold: { reason: 'translate-cli-7075' } } }))).toBeNull();
    expect(readerHold(book({ pipeline_auto: { status: 'complete' } }))).toBeNull();
    const args = rereadArgs({ id: 'b1', language: 'German' }, { maxPages: 5, first: ['p31', 'p33'], date: '2026-11-16', apply: true, readerHold: 'scans-only-publish-7270' });
    expect(args).toEqual(expect.arrayContaining(['--reader-hold=scans-only-publish-7270', '--first-only', '--first=p31,p33']));
    expect(rereadArgs({ id: 'b1', language: 'German' }, { maxPages: 5, date: '2026-11-16', apply: true })).not.toContain('--first-only');
  });
  it('never tells a reader the rest of a held book is underway: only the asked pages are served', () => {
    expect(underway({ translated: 5, note: null, reader_hold: null })).toBe(true);
    expect(underway({ translated: 5, note: null, reader_hold: 'scans-only-publish-7270' })).toBe(false);
    expect(underway({ translated: 5, note: 'OCR-first gate: x', reader_hold: null })).toBe(false);
    expect(underway({ translated: 0, ocr: 0, note: null, reader_hold: null })).toBe(false);
  });
  it('names the feedback rows behind every write, and passes them to the re-read', () => {
    expect(feedbackNote(new Set(['f1', 'f2']))).toBe('; from reader feedback f1, f2');
    expect(feedbackNote(new Set())).toBe('');
    expect(rereadArgs({ id: 'b1', language: 'German' }, { maxPages: 1, first: ['p1'], date: '2026-11-16', apply: true, note: 'from reader feedback f1' })).toContain('--reason-note=from reader feedback f1');
  });
  it('scopes to the requested pages and their neighbours by page number', () => {
    const pages = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ id: `p${n}`, page_number: n }));
    expect([...scopeIds(pages, new Set(['p5']))].sort()).toEqual(['p3', 'p4', 'p5', 'p6', 'p7']);
    expect([...scopeIds(pages, new Set(['p1', 'p10']), 1)].sort()).toEqual(['p1', 'p10', 'p2', 'p9']);
  });
});

describe('a request open over a day with no English is named with its blocker (#406)', () => {
  const now = Date.parse('2026-11-16T12:00:00Z');
  const req = (id: string, hoursAgo: number, o = {}) => ({ row: { _id: id }, at: new Date(now - hoursAgo * 3_600_000), book: { id: `b-${id}`, title: `Book ${id}` }, page: { id: `pg-${id}`, page_number: 7 }, verdict: { verdict: 'auto', reason: null }, translated: false, ...o });

  it('names each request over the wait with its verdict reason or what the run said about its book', () => {
    const summary = { books: [{ book: 'b-a', note: 'OCR waits for a person: spread' }] };
    const lines = waitingLines({ now, summary, reqs: [req('a', 30), req('b', 50, { verdict: { verdict: 'refuse', reason: 'book is on pipeline hold' } }), req('c', 26)] });
    expect(lines.map((l: { id: string }) => l.id)).toEqual(['a', 'b', 'c']);
    expect(lines[0].line).toMatch(/^a Book a p7 \(30 h\) — OCR waits for a person: spread$/);
    expect(lines[1].line).toMatch(/refuse: book is on pipeline hold$/);
    expect(lines[2].line).toMatch(/not reached this run$/);
  });
  it('stays quiet under the wait, once the page has English, and within a day of naming it', () => {
    expect(waitingLines({ now, summary: { books: [] }, reqs: [req('a', WAIT_HOURS - 1), req('b', 40, { translated: true }), req('c', 40, { verdict: { verdict: 'done' } })] })).toEqual([]);
    expect(waitingLines({ now, summary: { books: [] }, paged: { a: new Date(now - 3_600_000).toISOString() }, reqs: [req('a', 40)] })).toEqual([]);
    expect(waitingLines({ now, summary: { books: [] }, reqs: [req('a', 40, { row: { _id: 'a', reply_draft: 'Not yet.' } })] })).toEqual([]);
    expect(waitingLines({ now, summary: { books: [] }, paged: { a: new Date(now - 25 * 3_600_000).toISOString() }, reqs: [req('a', 40)] })).toHaveLength(1);
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
    it('says when the Siku lane is paused, so a waiting line does not read as moving (#406)', () => {
      expect(judge({ book: held('gpu-backlog-5660'), sikuPaused: 'STOP: spot check' }).reason).toMatch(/paused \(STOP: spot check\)$/);
      expect(judge({ book: held('gpu-backlog-5660') }).reason).not.toMatch(/paused/);
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
