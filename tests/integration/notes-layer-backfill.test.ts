import { describe, it, expect, beforeEach } from 'vitest';
import { BSON } from 'mongodb';
import { getTestDb, cleanDb } from '../setup';
import { processBatch, newTotals } from '../../scripts/maintenance/notes-layer-backfill-5942/backfill.mjs';
import { undoRun } from '../../scripts/maintenance/notes-layer-backfill-5942/undo.mjs';
import { getTranslationText, translationTextIsCurrent, translationLayers, writePageAnnotations, getPageAnnotations } from '../../scripts/lib/translation-text.mjs';
import { splitAnnotations } from '../../scripts/lib/annotation-layer.mjs';

// #5942 failure modes that need a real database: a page edited between read and write, withheld
// and empty pages, a writer that forgets the new fields, and undo byte for byte.

const DATA = 'Geomancy <note>divination by figures cast in earth</note>, an art of the Arabs, is <margin>Hermes</margin> taught here.\n\n<summary>On geomancy.</summary>';
const page = (id: string, extra: Record<string, unknown> = {}) => ({
  id, book_id: 'b1', page_number: 1, updated_at: new Date('2026-01-01T00:00:00Z'),
  translation: { data: DATA, language: 'English', model: 'm', source: 'ai', prompt_version: '13', updated_at: new Date('2026-01-01T00:00:00Z'), content_hash: 'abc' },
  ...extra,
});
const RUN = 'notes-layer-backfill-5942-test';
const run = (ids: string[], o: Record<string, unknown> = {}) => processBatch(getTestDb(), ids, newTotals(), null, { apply: true, runId: RUN, ...o });

describe('notes-layer backfill against a database', () => {
  beforeEach(cleanDb);

  it('writes text + text_from + one page_annotations doc + one revision row, and touches nothing else', async () => {
    const db = getTestDb();
    await db.collection('pages').insertOne(page('p1'));
    const before = await db.collection('pages').findOne({ id: 'p1' });
    const totals = newTotals();
    await processBatch(db, ['p1'], totals, null, { apply: true, runId: RUN });
    expect(totals.written).toBe(1);
    const after = await db.collection('pages').findOne({ id: 'p1' });
    expect(translationTextIsCurrent(after!.translation)).toBe(true);
    expect(after!.updated_at).toEqual(before!.updated_at);
    expect(after!.translation.updated_at).toEqual(before!.translation.updated_at);
    expect(after!.translation.data).toBe(DATA);
    const { text: _t, text_from: _f, ...rest } = after!.translation;
    expect(rest).toEqual(before!.translation);
    expect(await db.collection('page_annotations').countDocuments({ page_id: 'p1', source: 'inline-v13', anchor_kind: 'inferred' })).toBe(1);
    expect(await db.collection('page_revisions').countDocuments({ page_id: 'p1', field: 'translation.text', source: 'notes-layer-backfill-5942' })).toBe(1);
    expect(await db.collection('page_revisions').countDocuments({ page_id: 'p1', field: 'translation' })).toBe(0);
  });

  it('a page edited between read and write is skipped (compare-and-set), its revision row marked aborted', async () => {
    const db = getTestDb();
    await db.collection('pages').insertOne(page('p1'));
    const totals = newTotals();
    await processBatch(db, ['p1'], totals, null, {
      apply: true, runId: RUN,
      beforeWrite: async () => { await db.collection('pages').updateOne({ id: 'p1' }, { $set: { 'translation.data': DATA.replace('Arabs', 'Persians') } }); },
    });
    expect(totals).toMatchObject({ written: 0, conflict: 1 });
    const p = await db.collection('pages').findOne({ id: 'p1' });
    expect(p!.translation.text).toBeUndefined();
    expect(p!.translation.data).toContain('Persians');
    expect(await db.collection('page_annotations').countDocuments({})).toBe(0);
    expect(await db.collection('page_revisions').countDocuments({ page_id: 'p1', aborted: 'conflict' })).toBe(1);
  });

  it('withheld and empty pages are skipped and translation_withheld is untouched', async () => {
    const db = getTestDb();
    const withheld = { reason: 'stale', model: 'm', chars: 300, content_hash: 'h' };
    await db.collection('pages').insertMany([
      { id: 'w1', book_id: 'b1', translation_withheld: withheld },
      { id: 'e1', book_id: 'b1', translation: { data: '' } },
      { id: 'n1', book_id: 'b1' },
    ]);
    const totals = newTotals();
    await processBatch(db, ['w1', 'e1', 'n1'], totals, null, { apply: true, runId: RUN });
    expect(totals).toMatchObject({ written: 0, no_data: 3 });
    const w = await db.collection('pages').findOne({ id: 'w1' });
    expect(w!.translation_withheld).toEqual(withheld);
    expect(w!.translation).toBeUndefined();
  });

  it('a writer that later sets translation.data alone: the accessor falls back to the new data', async () => {
    const db = getTestDb();
    await db.collection('pages').insertOne(page('p1'));
    await run(['p1']);
    await db.collection('pages').updateOne({ id: 'p1' }, { $set: { 'translation.data': 'A corrected page <note>a new note</note> of the book.' } });
    const p = await db.collection('pages').findOne({ id: 'p1' });
    expect(translationTextIsCurrent(p!.translation)).toBe(false);
    expect(getTranslationText(p)).toBe(splitAnnotations(p!.translation.data).text);
    expect(getTranslationText(p)).not.toContain('Geomancy');
  });

  it('a second run skips pages it already wrote (resume is safe)', async () => {
    const db = getTestDb();
    await db.collection('pages').insertOne(page('p1'));
    await run(['p1']);
    const t2 = newTotals();
    await processBatch(db, ['p1'], t2, null, { apply: true, runId: RUN + '-2' });
    expect(t2).toMatchObject({ written: 0, already: 1 });
  });

  it('undo restores the page byte for byte and deletes only the run\'s annotations', async () => {
    const db = getTestDb();
    await db.collection('pages').insertMany([page('p1'), page('p2'), page('p3')]);
    const raw = async (id: string) => Buffer.from(BSON.serialize((await db.collection('pages').findOne({ id }))!)).toString('hex');
    const before = { p1: await raw('p1'), p2: await raw('p2'), p3: await raw('p3') };
    await run(['p1', 'p2', 'p3']);
    // p3 is re-translated by a writer after the run: undo must leave it alone.
    await db.collection('pages').updateOne({ id: 'p3' }, { $set: { 'translation.text_from.data_hash': 'newer' } });
    expect(await raw('p1')).not.toBe(before.p1);
    const t = await undoRun(db, { runId: RUN, apply: true });
    expect(t).toMatchObject({ rows: 3, unset: 2, moved_on: 1 });
    expect(await raw('p1')).toBe(before.p1);
    expect(await raw('p2')).toBe(before.p2);
    expect(await raw('p3')).not.toBe(before.p3);
    expect(await db.collection('page_annotations').countDocuments({ run_id: RUN })).toBe(0);
    // Undo is not repeated: the rows are marked.
    expect((await undoRun(db, { runId: RUN, apply: true })).rows).toBe(0);
  });

  // KEEP THE READS (Derek, 2026-10-28): a re-run or a writer never overwrites or deletes a
  // page_annotations doc; it inserts its own. Undo removes only its own run's docs. data is never rewritten.
  it('keep the reads: a re-run inserts its own doc, the first is byte-identical, undo removes only its own', async () => {
    const db = getTestDb();
    await db.collection('pages').insertOne(page('p1'));
    const hex = (d: unknown) => Buffer.from(BSON.serialize(d as object)).toString('hex');
    const dataHex = async () => hex({ d: (await db.collection('pages').findOne({ id: 'p1' }))!.translation.data });
    const data0 = await dataHex();
    await run(['p1']);
    const first = await db.collection('page_annotations').findOne({ page_id: 'p1', run_id: RUN });
    expect(first).toBeTruthy();
    // A second run (as after a parser bump: the page's text_from is no longer current for it).
    await db.collection('pages').updateOne({ id: 'p1' }, { $set: { 'translation.text_from.parser_version': 'annotation-layer/0' } });
    const t2 = newTotals();
    await processBatch(db, ['p1'], t2, null, { apply: true, runId: RUN + '-2' });
    expect(t2.written).toBe(1);
    expect(await db.collection('page_annotations').countDocuments({ page_id: 'p1' })).toBe(2);
    expect(hex(await db.collection('page_annotations').findOne({ _id: first!._id }))).toBe(hex(first));
    // A writer storing the same text again under a key that exists changes nothing.
    await writePageAnnotations(db, [{ page_id: 'p1', book_id: 'b1', run_id: RUN, layers: { ...translationLayers(DATA, { promptVersion: 13 }), annotations: [{ type: 'note', body: 'different' }] } }]);
    expect(hex(await db.collection('page_annotations').findOne({ _id: first!._id }))).toBe(hex(first));
    // The reader picks a doc of the current text.
    const p = await db.collection('pages').findOne({ id: 'p1' });
    expect((await getPageAnnotations(db, p)).length).toBe(first!.annotations.length);
    // Undo of run 2 removes run 2's doc only.
    await undoRun(db, { runId: RUN + '-2', apply: true });
    expect(await db.collection('page_annotations').countDocuments({ page_id: 'p1', run_id: RUN + '-2' })).toBe(0);
    expect(hex(await db.collection('page_annotations').findOne({ _id: first!._id }))).toBe(hex(first));
    // translation.data never changed through any of it.
    expect(await dataHex()).toBe(data0);
  });

  it('keep the reads: a new translation inserts a new doc and the old text\'s doc stays (not served)', async () => {
    const db = getTestDb();
    await db.collection('pages').insertOne(page('p1'));
    await run(['p1']);
    const old = await db.collection('page_annotations').findOne({ page_id: 'p1' });
    const NEW = 'A new reading <note>a newer note</note> of the page.';
    await db.collection('pages').updateOne({ id: 'p1' }, { $set: { 'translation.data': NEW } });
    await writePageAnnotations(db, [{ page_id: 'p1', book_id: 'b1', run_id: 'job-9', layers: translationLayers(NEW, { promptVersion: 13 }) }]);
    expect(await db.collection('page_annotations').countDocuments({ page_id: 'p1' })).toBe(2);
    expect(await db.collection('page_annotations').findOne({ _id: old!._id })).toEqual(old);
    const p = await db.collection('pages').findOne({ id: 'p1' });
    const served = await getPageAnnotations(db, p);
    expect(served.some((a: { body: string }) => a.body === 'a newer note')).toBe(true);
    expect(served.some((a: { body: string }) => a.body === 'divination by figures cast in earth')).toBe(false);
  });
});

