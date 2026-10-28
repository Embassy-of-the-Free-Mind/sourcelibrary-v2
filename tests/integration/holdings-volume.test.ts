import { describe, it, expect, beforeEach } from 'vitest';
import type { ObjectId } from 'mongodb';
import { checkHoldings } from '@/lib/holdings-check';
import { buildEditionKey } from '@/lib/edition-key';
import { getTestDb, cleanDb } from '../setup';

// #7624: "Opera, vol. 1, 1555" was answered "same edition, high confidence" by pointing at the
// translated VOLUME II scan, whose record states no volume. The import gate is right to block
// such a match (a missing volume is the safe error there); the holdings answer must not call it
// the volume that was asked for.

function book(id: string, title: string, extra: Record<string, unknown> = {}) {
  const doc = { title, author: 'Vives, Juan Luis', year: 1555, ...extra };
  return { _id: id as unknown as ObjectId, id, visible: true, pages_count: 900, ...doc, edition_key: buildEditionKey(doc).key };
}

describe('checkHoldings: a requested volume is not confirmed by a record that names none', () => {
  beforeEach(async () => { await cleanDb(); });

  it('labels the volume-less record possible, not same edition', async () => {
    const db = getTestDb();
    await db.collection('books').insertOne(book('unnumbered', 'Opera omnia'));
    const res = await checkHoldings(db, { title: 'Opera omnia, vol. 1', author: 'Juan Luis Vives', year: 1555 });
    const hit = res.candidates.find((c) => c.book_id === 'unnumbered');
    expect(hit?.reason).toBe('same_edition_volume_unknown');
    expect(res.verdict).not.toBe('same_edition');
  });

  it('still calls a record of the same numbered volume the same edition', async () => {
    const db = getTestDb();
    await db.collection('books').insertOne(book('vol1', 'Opera omnia, vol. 1'));
    const res = await checkHoldings(db, { title: 'Opera omnia, vol. 1', author: 'Juan Luis Vives', year: 1555 });
    expect(res.candidates.find((c) => c.book_id === 'vol1')?.reason).toBe('same_edition');
  });

  it('calls a different numbered volume another edition', async () => {
    const db = getTestDb();
    await db.collection('books').insertOne(book('vol2', 'Opera omnia, vol. 2'));
    const res = await checkHoldings(db, { title: 'Opera omnia, vol. 1', author: 'Juan Luis Vives', year: 1555 });
    expect(res.candidates.find((c) => c.book_id === 'vol2')?.reason).toBe('other_edition');
  });

  it('a lookup that names no volume still treats the unnumbered record as the same edition', async () => {
    const db = getTestDb();
    await db.collection('books').insertOne(book('unnumbered', 'Opera omnia'));
    const res = await checkHoldings(db, { title: 'Opera omnia', author: 'Juan Luis Vives', year: 1555 });
    expect(res.candidates.find((c) => c.book_id === 'unnumbered')?.reason).toBe('same_edition');
  });
});
