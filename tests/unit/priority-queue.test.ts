/**
 * Pins the priority queue's rule (v3#461, scripts/lib/priority-queue.mjs):
 *  - Derek's order: a book >= 80% in English is tier 1 (finish), any other book owing reads or English is tier 2;
 *    re-reads and re-translations are tier 3 whatever the book.
 *  - English originals owe reads, never translation.
 *  - A hold keeps a book out, except the "published as scans" holds the lanes serve.
 *  - Inside a tier: asked for first, then fewest pages to get there.
 *  - The share attributes a write to the book's place at the START of the window.
 *  - A stale or missing ranks document leaves a lane on its own order.
 */
import { describe, it, expect } from 'vitest';
import {
  placeBook, buildQueue, byQueue, classifyWrite, shareByPriority, queueRankOrder, holdOwner, QUEUE_VERSION,
} from '../../scripts/lib/priority-queue.mjs';

const book = (id: string, s: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id, visible: true, pages_count: 100, translation_state: { rung: 'translating', english_original: false, whole: 100, ocr: 100, translatable: 100, translated: 0, ...s }, ...extra,
});

describe('placeBook', () => {
  it('puts a book 85% in English in tier 1 with the pages it owes', () => {
    const p = placeBook(book('a', { translated: 85, rung: 'translating' }));
    expect(p).toMatchObject({ tier: 1, key: 'finish', owed: 15, unread: 0 });
    expect(p.reason).toMatch(/finish: 85% of 100 pages in English, 15 to go/);
  });
  it('puts a book under 80% in tier 2', () => {
    expect(placeBook(book('b', { translated: 50 }))).toMatchObject({ tier: 2, key: 'first' });
  });
  it('puts an unread book in tier 2 and says it has no text', () => {
    const p = placeBook(book('c', { rung: 'no_text', ocr: 0 }));
    expect(p).toMatchObject({ tier: 2, unread: 100 });
    expect(p.reason).toMatch(/no text yet/);
  });
  it('places a book the window completed where it stood at the start: finish, not first', () => {
    const p = placeBook(book('k', { rung: 'complete', translated: 100 }), { adjust: { translated: 15, ocr: 0 } });
    expect(p).toMatchObject({ tier: 1, key: 'finish', owed: 15 });
  });
  it('drops a complete book and a hidden one', () => {
    expect(placeBook(book('d', { rung: 'complete', translated: 100 }))).toBeNull();
    expect(placeBook(book('e', { translated: 10 }, { visible: false }))).toBeNull();
  });
  it('owes an English original reads only', () => {
    expect(placeBook(book('f', { english_original: true, rung: 'transcribed', translated: 0 }))).toBeNull();
    expect(placeBook(book('g', { english_original: true, rung: 'transcribing', ocr: 40 }))).toMatchObject({ tier: 2, owed: 0, unread: 60 });
  });
  it('keeps a held book out unless the lanes serve its hold', () => {
    const held = (reason: string) => book('h', { translated: 90 }, { pipeline_auto: { status: 'held', hold: { reason } } });
    expect(placeBook(held('gpu-backlog-5660'))).toMatchObject({ held: 'gpu-backlog-5660', owed: 10 });
    expect(placeBook(held('scans-only-publish-7176'))).toMatchObject({ tier: 1 });
  });
  it('takes back the window\'s writes for the place at its start', () => {
    // 95% now, 70% before the window's 25 translations: first, not finish, at the start.
    expect(placeBook(book('i', { translated: 95 }), { adjust: { translated: 25, ocr: 0 } })).toMatchObject({ tier: 2 });
  });
});

describe('order', () => {
  it('ranks tier, then asked for, then fewest pages', () => {
    const q = buildQueue([
      book('slow', { translated: 81 }),
      book('quick', { translated: 98 }),
      book('asked', { translated: 82 }, { processing_priority: 95 }),
      book('first', { translated: 10 }),
    ]);
    expect(q.ranked.map((r) => r.id)).toEqual(['asked', 'quick', 'slow', 'first']);
    expect(q.ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    expect(q.tiers[0]).toMatchObject({ key: 'finish', books: 3, owed: 18 + 2 + 19 });
  });
  it('lists held books by hold with who releases them', () => {
    const q = buildQueue([book('x', { translated: 5 }, { pipeline_auto: { status: 'held', hold: { reason: 'paddle-zh-5600-ocr-only', release_when: { kind: 'decision', ref: 'release paddle-zh-5600-ocr-only' } } } })]);
    expect(q.ranked).toHaveLength(0);
    expect(q.held[0]).toMatchObject({ reason: 'paddle-zh-5600-ocr-only', books: 1, owed: 95, derek: true });
  });
  it('byQueue is a total order on ids', () => {
    const a = { tier: 1, asked: false, sort: 3, share: 0.9, id: 'a' }, b = { ...a, id: 'b' };
    expect(byQueue(a, b)).toBeLessThan(0);
  });
});

describe('holdOwner', () => {
  it('names the owner of each release kind', () => {
    expect(holdOwner({ kind: 'issue', ref: 6948 }).owner).toBe('#6948 closing');
    expect(holdOwner(null)).toMatchObject({ owner: 'no release condition', derek: false });
  });
});

describe('classifyWrite and the share', () => {
  it('counts agy writes only and marks re-reads and re-translations', () => {
    expect(classifyWrite('ocr', { ocr: { lane: 'paddle-zh' } })).toBeNull();
    expect(classifyWrite('ocr', { ocr: { lane: 'agy-flash-ocr', pipeline: 'agy-reread-lite-7853' } })).toEqual({ stage: 'ocr', kind: 'again' });
    expect(classifyWrite('ocr', { ocr: { lane: 'agy-flash-ocr', pipeline: 'agy-first-read-7701' } })).toEqual({ stage: 'ocr', kind: 'first' });
    expect(classifyWrite('translation', { translation: { lane: 'agy-flash-translate', engine: { run: { read_call: 'cli-retranslate-2026-11-17-x' } } } })).toMatchObject({ kind: 'again' });
    expect(classifyWrite('translation', { translation: { lane: 'agy-flash-translate', engine: { run: { read_call: 'cli-tr-finish-2026-11-17-x' } } } })).toMatchObject({ kind: 'first' });
  });
  it('splits writes by the book\'s place, re-reads apart', () => {
    const places: Record<string, unknown> = { a: { key: 'finish' }, b: { key: 'first' }, c: { held: 'gpu-backlog-5660' } };
    const s = shareByPriority([
      { book_id: 'a', stage: 'translation', kind: 'first' },
      { book_id: 'b', stage: 'ocr', kind: 'first' },
      { book_id: 'a', stage: 'ocr', kind: 'again' },
      { book_id: 'c', stage: 'ocr', kind: 'first' },
      { book_id: 'z', stage: 'ocr', kind: 'first' },
    ], (id: string) => places[id] ?? null);
    expect(s.total).toBe(5);
    expect(s.buckets.finish).toMatchObject({ translation: 1, total: 1, share: 0.2 });
    expect(s.buckets.reread.total).toBe(1);
    expect(s.buckets.held.total).toBe(1);
    expect(s.buckets.other.total).toBe(1);
  });
});

describe('queueRankOrder', () => {
  const now = Date.parse('2026-11-17T12:00:00Z');
  const doc = { version: QUEUE_VERSION, generated_at: '2026-11-17T10:00:00Z', ids: ['b', 'a'] };
  const byId = (x: { id: string }, y: { id: string }) => x.id.localeCompare(y.id);
  it('orders ranked books by rank, then the rest by the fallback', () => {
    const { order } = queueRankOrder(doc, byId, { now });
    expect([{ id: 'z' }, { id: 'a' }, { id: 'y' }, { id: 'b' }].sort(order!).map((x) => x.id)).toEqual(['b', 'a', 'y', 'z']);
  });
  it('refuses a stale, missing or other-version document', () => {
    expect(queueRankOrder(doc, byId, { now: now + 7 * 3600e3 }).order).toBeNull();
    expect(queueRankOrder(null, byId, { now }).order).toBeNull();
    expect(queueRankOrder({ ...doc, version: QUEUE_VERSION + 1 }, byId, { now }).order).toBeNull();
  });
});
