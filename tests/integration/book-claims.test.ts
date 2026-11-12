/**
 * Book claims (#8550): two finish runs on different boxes must not take the same book, and apply must not write a read
 * over English another run wrote after the read.
 *
 * PRIOR ART: tests/unit/lane-book-list.test.ts pins lane_job_books, which records books AFTER they are taken and
 * locks nothing. These run the claim against a real (in-memory) Mongo, the only way to pin the atomic refusal.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getTestDb, cleanDb } from '../setup';
import { claimBook, releaseBook, releaseAll, BOOK_CLAIMS, englishChangedSinceRead, translationHashOf } from '../../scripts/lib/book-claims.mjs';

describe('claimBook', () => {
  beforeEach(cleanDb);

  it('one holder at a time; the same holder renews; release frees it', async () => {
    const db = getTestDb();
    expect(await claimBook(db, { bookId: 'b1', holder: 'clawdbot:1', job: 'near-bar' })).toEqual({ ok: true });
    const other = await claimBook(db, { bookId: 'b1', holder: 'gex45:2', job: 'finish-cron' });
    expect(other.ok).toBe(false);
    expect(other.by).toMatchObject({ holder: 'clawdbot:1', job: 'near-bar' });
    expect(await claimBook(db, { bookId: 'b1', holder: 'clawdbot:1' })).toEqual({ ok: true });
    expect((await claimBook(db, { bookId: 'b2', holder: 'gex45:2' })).ok).toBe(true);
    await releaseBook(db, { bookId: 'b1', holder: 'gex45:2' }); // not its claim: no effect
    expect((await claimBook(db, { bookId: 'b1', holder: 'gex45:2' })).ok).toBe(false);
    await releaseBook(db, { bookId: 'b1', holder: 'clawdbot:1' });
    expect((await claimBook(db, { bookId: 'b1', holder: 'gex45:2' })).ok).toBe(true);
    await releaseAll(db, 'gex45:2');
    expect(await db.collection(BOOK_CLAIMS).countDocuments()).toBe(0);
  });

  it('an expired lease (a run that died) is taken over', async () => {
    const db = getTestDb();
    const past = new Date(Date.now() - 2 * 3600_000);
    expect((await claimBook(db, { bookId: 'b1', holder: 'dead', leaseMs: 60_000, now: past })).ok).toBe(true);
    expect((await claimBook(db, { bookId: 'b1', holder: 'alive' })).ok).toBe(true);
  });

  it('two runs racing for one book: exactly one wins', async () => {
    const db = getTestDb();
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => claimBook(db, { bookId: 'b9', holder: `h${i}` })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });
});

describe('englishChangedSinceRead (apply backstop)', () => {
  const page = (data: string | null, at?: string) => ({ translation: data == null ? null : { data, updated_at: at ? new Date(at) : undefined } });
  it('refuses when the English differs from what the read saw', () => {
    expect(englishChangedSinceRead({ translation_hash: null }, page('Written by the other lane'))).toBe('English changed since the read');
    expect(englishChangedSinceRead({ translation_hash: translationHashOf(page('old')) }, page('new'))).toBe('English changed since the read');
  });
  it('allows a first translation, and a re-translation of English that did not change', () => {
    expect(englishChangedSinceRead({ translation_hash: null }, page(null))).toBeNull();
    expect(englishChangedSinceRead({ translation_hash: null }, page('   '))).toBeNull();
    expect(englishChangedSinceRead({ translation_hash: translationHashOf(page('old')) }, page('old'))).toBeNull();
  });
  it('a read from before translation_hash existed: refuses only English written after the read started', () => {
    const m = { started_at: '2026-11-11T10:12:00Z' };
    expect(englishChangedSinceRead(m, page('x', '2026-11-11T10:12:17Z'))).toBe('English written by another run since the read');
    expect(englishChangedSinceRead(m, page('x', '2026-11-01T00:00:00Z'))).toBeNull();
    expect(englishChangedSinceRead(m, page(null))).toBeNull();
  });
});
