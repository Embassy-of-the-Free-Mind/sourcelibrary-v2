/**
 * The translate-gate stamp (#378): the translator's own pre-flight refusals leave a book's denominator, recorded on the
 * page and undone by a re-read, so a book whose only owed pages are empty or looped reaches `complete`.
 *
 * PRIOR ART: tests/integration/page-counts-parity.test.ts — pins that every count twin agrees on a stamped page; this
 * file pins the stamp's writer and its exit, and the book-level outcome through recountBook().
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getTestDb, cleanDb } from '../setup';
import { recountBook, isTranslatablePageForCount } from '../../scripts/lib/page-counts.mjs';
import { stampGateRefusals, releaseStaleGateStamps, gateVerdict, GATE_PROJECTION, TRANSLATE_GATE_BLOCK } from '../../scripts/lib/translate-gate-stamp.mjs';

const BOOK = 'gate-book';
const TEXT = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.';
const LOOP = 'ab '.repeat(3000);

async function seed() {
  const db = getTestDb();
  await db.collection('books').insertOne({ id: BOOK, language: 'Latin', pages_count: 4 });
  await db.collection('pages').insertMany([
    { id: 'p1', book_id: BOOK, page_number: 1, ocr: { data: TEXT }, translation: { data: 'English one.' } },
    { id: 'p2', book_id: BOOK, page_number: 2, ocr: { data: TEXT }, translation: { data: 'English two.' } },
    { id: 'p3', book_id: BOOK, page_number: 3, ocr: { data: '<page-num>3</page-num>' } }, // no body: nothing owed
    { id: 'p4', book_id: BOOK, page_number: 4, ocr: { data: LOOP } },                     // looped OCR: a repair item
  ]);
  return db;
}
const owed = async () => (await getTestDb().collection('pages').find({ book_id: BOOK }).toArray()).filter((p) => isTranslatablePageForCount(p) && !p.translation?.data).map((p) => p.id);

describe('translate-gate stamp (#378)', () => {
  beforeEach(async () => { await cleanDb(); });

  it('verdicts: no body is nothing owed, a loop is a repair item, a text page and an OCR-less page are not judged', () => {
    expect(gateVerdict({ id: 'a', page_number: 1, ocr: { data: '<page-num>3</page-num>' } })).toMatchObject({ reason: 'no-body', kind: 'nothing_owed' });
    expect(gateVerdict({ id: 'b', page_number: 1, ocr: { data: LOOP } })).toMatchObject({ reason: 'ocr-loop', kind: 'repair' });
    expect(gateVerdict({ id: 'c', page_number: 1, ocr: { data: TEXT } })).toBeNull();
    expect(gateVerdict({ id: 'd', page_number: 1 })).toBeNull(); // awaiting OCR: owed work, never stamped
    expect(gateVerdict({ id: 'e', page_number: 1, ocr: { data: LOOP }, translation: { data: 'x' } })).toBeNull(); // has English
  });

  it('a dry run writes nothing and the book stays short of complete', async () => {
    const db = await seed();
    const pages = await db.collection('pages').find({ book_id: BOOK }, { projection: GATE_PROJECTION }).toArray();
    const g = await stampGateRefusals(db, pages, { apply: false, lane: 'test' });
    expect(g.stamped.map((x) => x.id).sort()).toEqual(['p3', 'p4']);
    expect(await db.collection('pages').countDocuments({ 'translation.health_blocked': { $exists: true } })).toBe(0);
    expect((await recountBook(db, BOOK, { reason: 'test' })).rung).not.toBe('complete');
  });

  it('stamped, the refused pages leave the denominator and the book is complete; the text page is untouched', async () => {
    const db = await seed();
    const pages = await db.collection('pages').find({ book_id: BOOK }, { projection: GATE_PROJECTION }).toArray();
    await stampGateRefusals(db, pages, { apply: true, lane: 'test', run: 'r1' });
    const p4 = await db.collection('pages').findOne({ id: 'p4' });
    expect(p4?.translation).toMatchObject({ health_blocked: TRANSLATE_GATE_BLOCK, refusal_reason: 'ocr-loop', refusal: { kind: 'repair', run: 'r1', ocr_chars: LOOP.length } });
    expect((await db.collection('pages').findOne({ id: 'p1' }))?.translation).toEqual({ data: 'English one.' });
    expect(await owed()).toEqual([]);
    const r = await recountBook(db, BOOK, { reason: 'test' });
    expect(r.rung).toBe('complete');
    expect(r.after.pages_translatable).toBe(2);
  });

  it('a re-read OCR undoes the stamp: owed again at once, released when it now passes, re-stamped when still refused', async () => {
    const db = await seed();
    const pages = await db.collection('pages').find({ book_id: BOOK }, { projection: GATE_PROJECTION }).toArray();
    await stampGateRefusals(db, pages, { apply: true, lane: 'test' });
    await db.collection('pages').updateOne({ id: 'p4' }, { $set: { 'ocr.data': TEXT, 'ocr.updated_at': new Date() } });            // the loop re-read
    await db.collection('pages').updateOne({ id: 'p3' }, { $set: { 'ocr.data': '<page-num>3</page-num> ', 'ocr.updated_at': new Date() } }); // still empty
    expect((await owed()).sort()).toEqual(['p3', 'p4']); // the count no longer trusts either stamp
    expect((await recountBook(db, BOOK, { reason: 'test' })).rung).not.toBe('complete');
    const rel = await releaseStaleGateStamps(db, { since: new Date(Date.now() - 60e3), apply: true, lane: 'test' });
    expect(rel).toMatchObject({ released: ['p4'], restamped: ['p3'], books: [BOOK] });
    expect((await db.collection('pages').findOne({ id: 'p4' }))?.translation?.health_blocked).toBeUndefined();
    expect(await owed()).toEqual(['p4']); // a real page to translate, back in every selector
  });

  it('never stamps over another reason, nor a page that gained English', async () => {
    const db = await seed();
    await db.collection('pages').updateOne({ id: 'p4' }, { $set: { 'translation.health_blocked': 'collapsed' } });
    const pages = await db.collection('pages').find({ book_id: BOOK }, { projection: GATE_PROJECTION }).toArray();
    const g = await stampGateRefusals(db, pages, { apply: true, lane: 'test' });
    expect(g.stamped.map((x) => x.id)).toEqual(['p3']);
    expect((await db.collection('pages').findOne({ id: 'p4' }))?.translation?.health_blocked).toBe('collapsed');
  });
});
