/**
 * The read-side gates on reader translation-requests (#4482). `feedback` is a public
 * write; these pin that a request cannot unlock a dark page, set the spend, be
 * multiplied, or run through the pause.
 */
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { requestVerdict, repeatReasons } from '../../scripts/lib/translation-request-eligibility.mjs';

const LATIN = 'Quapropter cum de arte rhetorica dicere instituissem, visum est mihi primum ' +
  'exponere quae sint eius partes, quae officia, quis finis, et quomodo orator ad dicendum ' +
  'instrui debeat. Nam inventio, dispositio, elocutio, memoria, pronuntiatio sunt partes. ';
const book = { id: 'b1', visible: true, pages_count: 100 };
const page = { page_number: 7, ocr: { data: LATIN.repeat(3) }, translation: {} };
const base = { book, page, tail: 3, brakeStop: null, repeat: undefined, ceiling: 25 };

describe('requestVerdict', () => {
  it('auto-eligible: public book, untranslated translatable page, small tail, no pause', () => {
    expect(requestVerdict(base)).toEqual({ verdict: 'auto', reason: null, pages: 3 });
  });

  it('refuses a hidden, takedown or unpublished book', () => {
    expect(requestVerdict({ ...base, book: { ...book, visible: false, hidden_reason: 'duplicate' } }).verdict).toBe('refuse');
    const takedown = requestVerdict({ ...base, book: { ...book, visible: false, hidden_reason: 'copyright' } });
    expect(takedown.verdict).toBe('refuse');
    expect(takedown.reason).toMatch(/^book is (takedown|hidden)/);
    expect(requestVerdict({ ...base, book: { id: 'b1', pages_count: 100 } }).reason).toMatch(/unpublished/);
  });

  it('refuses a held book, an unknown book, a page outside the book, a soft-hidden page', () => {
    expect(requestVerdict({ ...base, book: { ...book, pipeline_auto: { hold: { reason: 'x' } } } }).reason).toMatch(/hold/);
    expect(requestVerdict({ ...base, book: null }).verdict).toBe('refuse');
    expect(requestVerdict({ ...base, page: null }).verdict).toBe('refuse');
    expect(requestVerdict({ ...base, page: { ...page, page_number: 0 } }).reason).toMatch(/soft-hidden/);
  });

  it('sends an over-ceiling tail, a repeat, or a paused pipeline to a person', () => {
    expect(requestVerdict({ ...base, tail: 1068 })).toMatchObject({ verdict: 'human', pages: 1068 });
    expect(requestVerdict({ ...base, repeat: 'repeat: x' }).verdict).toBe('human');
    expect(requestVerdict({ ...base, brakeStop: 'pipeline paused' })).toMatchObject({ verdict: 'human', reason: 'pipeline paused' });
  });

  it('a dark book is refused even when every other gate would pass', () => {
    expect(requestVerdict({ ...base, book: { ...book, visible: false }, repeat: undefined, tail: 1 }).verdict).toBe('refuse');
  });

  it('lane options (#7599): an allowlisted hold and a page awaiting OCR pass; nothing else loosens', () => {
    const held = { ...book, pipeline_auto: { status: 'held', hold: { reason: 'x' } } };
    expect(requestVerdict({ ...base, book: held, holdAllowed: true }).verdict).toBe('auto');
    expect(requestVerdict({ ...base, book: held }).verdict).toBe('refuse');
    const noOcr = { page_number: 7, translation: {} };
    expect(requestVerdict({ ...base, page: noOcr }).reason).toMatch(/no-ocr/);
    expect(requestVerdict({ ...base, page: noOcr, ocrPending: true }).verdict).toBe('auto');
    expect(requestVerdict({ ...base, page: { ...noOcr, page_number: 0 }, ocrPending: true }).verdict).toBe('refuse');
    expect(requestVerdict({ ...base, book: { ...held, visible: false }, holdAllowed: true }).verdict).toBe('refuse');
  });

  it('an already-translated page is done, not spent on', () => {
    expect(requestVerdict({ ...base, page: { ...page, translation: { data: 'x'.repeat(40) } } }).verdict).toBe('done');
  });
});

describe('repeatReasons', () => {
  const r = (bookRef: string, pageId: string, email: string | null, at: string, ip_hash: string | null = null) =>
    ({ bookRef, pageId, email, ip_hash, at });

  it('keeps the first request for a page, flags later ones regardless of input order', () => {
    const out = repeatReasons([r('b', 'p', 'b@x', '2026-02-01'), r('b', 'p', 'a@x', '2026-01-01')]);
    expect([...out.keys()]).toEqual([0]);
  });

  it('caps open requests per requester, by email or else ip hash', () => {
    const reqs = [1, 2, 3].map(n => r('b', `p${n}`, null, `2026-01-0${n}`, 'abc'));
    expect([...repeatReasons(reqs, { perRequester: 2 }).keys()]).toEqual([2]);
    const anon = [1, 2, 3].map(n => r('b', `p${n}`, null, `2026-01-0${n}`));
    expect(repeatReasons(anon, { perRequester: 2 }).size).toBe(0);
  });
});
