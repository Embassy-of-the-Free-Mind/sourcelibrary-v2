/**
 * The publication writer against a real (in-memory) Mongo (#5340): the update
 * shape, id-OR-_id resolution, the takedown refusals, the `from` guard, the
 * event log, and the views over the rows the writer produced.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectId } from 'mongodb';
import { getTestDb, cleanDb } from '../setup';
import {
  setPublication, setPublicationMany, publicationFilter, legacyPublication,
} from '@/lib/publication';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import * as mjs from '../../scripts/lib/publication.mjs';

const BY = 'test:publication-writer';

async function seed() {
  const db = getTestDb();
  await db.collection('books').insertMany([
    { _id: new ObjectId(), id: 'pub', visible: true, hidden: false },
    { _id: new ObjectId(), id: 'stale', visible: true, hidden_reason: 'launch_curation' },
    { _id: new ObjectId(), id: 'hid', visible: false, hidden: true, hidden_reason: 'low_resolution' },
    { _id: new ObjectId(), id: 'unpub', hidden: true, hidden_reason: 'launch_curation' },
    { _id: new ObjectId(), id: 'td', visible: false, hidden: true, hidden_reason: 'kloss_manuscripts_removed_2026-07-08' },
    // re-minted _id: the string _id differs from `id`
    { _id: 'remint-oid' as never, id: 'remint', visible: true },
  ]);
  return db;
}

describe('setPublication', () => {
  beforeEach(cleanDb);

  it('publishing unsets hidden_reason in the same write (opposites corollary)', async () => {
    const db = await seed();
    const r = await setPublication(db, 'hid', { state: 'public', by: BY });
    expect(r.status).toBe('written');
    const b = await db.collection('books').findOne({ id: 'hid' });
    expect(b).toMatchObject({ visible: true, hidden: false, publication: { state: 'public', reason: null, by: BY } });
    expect(b).not.toHaveProperty('hidden_reason');
    expect(b!.updated_at).toBeInstanceOf(Date);
  });

  it('unpublished unsets visible, hidden and hidden_reason', async () => {
    const db = await seed();
    await setPublication(db, 'pub', { state: 'unpublished', reason: 'unprocessed', by: BY });
    const b = await db.collection('books').findOne({ id: 'pub' });
    expect(b).not.toHaveProperty('visible');
    expect(b).not.toHaveProperty('hidden');
    expect(b!.publication).toMatchObject({ state: 'unpublished', reason: 'unprocessed' });
  });

  it('hiding a duplicate records the keeper and the legacy duplicate reason', async () => {
    const db = await seed();
    await setPublication(db, 'pub', { state: 'hidden', reason: 'duplicate', duplicateOf: 'keeper', note: 'duplicate of keeper-slug', by: BY });
    const b = await db.collection('books').findOne({ id: 'pub' });
    expect(b).toMatchObject({
      visible: false, hidden: true, hidden_reason: 'duplicate', duplicate_of: 'keeper',
      publication: { state: 'hidden', reason: 'duplicate', duplicate_of: 'keeper', note: 'duplicate of keeper-slug' },
    });
    expect(b!.hidden_at).toBeInstanceOf(Date);
  });

  it('resolves a book by _id when _id and id differ', async () => {
    const db = await seed();
    const r = await setPublication(db, 'remint-oid', { state: 'hidden', reason: 'quality', by: BY });
    expect(r).toMatchObject({ status: 'written', book_id: 'remint' });
    expect((await db.collection('books').findOne({ id: 'remint' }))!.visible).toBe(false);
  });

  it('refuses to leave takedown without the override, and writes nothing', async () => {
    const db = await seed();
    await expect(setPublication(db, 'td', { state: 'public', by: BY })).rejects.toThrow(/rights-cleared/);
    const b = await db.collection('books').findOne({ id: 'td' });
    expect(b).toMatchObject({ visible: false, hidden_reason: 'kloss_manuscripts_removed_2026-07-08' });
    expect(await db.collection('publication_events').countDocuments()).toBe(0);
  });

  it('leaves takedown with override + issue, and logs who and why', async () => {
    const db = await seed();
    await setPublication(db, 'td', { state: 'public', by: BY, override: 'rights-cleared', issue: 42 });
    expect((await db.collection('books').findOne({ id: 'td' }))!.visible).toBe(true);
    const ev = await db.collection('publication_events').findOne({ book_id: 'td' });
    expect(ev).toMatchObject({ from: 'takedown', to: 'public', override: 'rights-cleared', issue: 42, by: BY, fanout: null });
  });

  it('a takedown writes a prefixed hidden_reason and requires an issue', async () => {
    const db = await seed();
    await expect(setPublication(db, 'pub', { state: 'takedown', by: BY })).rejects.toThrow(/issue/);
    await setPublication(db, 'pub', { state: 'takedown', by: BY, issue: 9 });
    const b = await db.collection('books').findOne({ id: 'pub' });
    expect(b).toMatchObject({ visible: false, hidden_reason: 'takedown:rights', publication: { state: 'takedown', issue: 9 } });
  });

  it('`from` skips a book in another state without writing', async () => {
    const db = await seed();
    const r = await setPublication(db, 'hid', { state: 'hidden', reason: 'duplicate', by: BY, from: ['public'] });
    expect(r.status).toBe('skipped');
    expect((await db.collection('books').findOne({ id: 'hid' }))!.hidden_reason).toBe('low_resolution');
  });

  it('a repeated identical write is unchanged and logs no second event', async () => {
    const db = await seed();
    await setPublication(db, 'hid', { state: 'public', by: BY });
    const again = await setPublication(db, 'hid', { state: 'public', by: BY });
    expect(again.status).toBe('unchanged');
    expect(await db.collection('publication_events').countDocuments({ book_id: 'hid' })).toBe(1);
  });

  it('not_found for an unknown ref', async () => {
    const db = await seed();
    expect((await setPublication(db, 'nope', { state: 'public', by: BY })).status).toBe('not_found');
  });

  it('the .mjs twin writes the same document', async () => {
    const db = await seed();
    const now = new Date('2026-09-30T12:00:00Z');
    await setPublication(db, 'pub', { state: 'hidden', reason: 'quality', by: BY, now });
    await mjs.setPublication(db, 'stale', { state: 'hidden', reason: 'quality', by: BY, now });
    const strip = (d: Record<string, unknown> | null) => { const { _id, id, ...rest } = d!; void _id; void id; return rest; };
    expect(strip(await db.collection('books').findOne({ id: 'stale' })))
      .toEqual(strip(await db.collection('books').findOne({ id: 'pub' })));
  });
});

describe('setPublicationMany', () => {
  beforeEach(cleanDb);

  it('hides only public books when from=[public]; refuses none, skips the rest', async () => {
    const db = await seed();
    const r = await setPublicationMany(db, ['pub', 'stale', 'hid', 'td', 'missing'], {
      state: 'hidden', reason: 'duplicate', duplicateOf: 'k', by: BY, from: ['public'],
    });
    expect(r.written.sort()).toEqual(['pub', 'stale']);
    expect(r.skipped.sort()).toEqual(['hid', 'td']);
    expect(r.not_found).toEqual(['missing']);
    expect(await db.collection('publication_events').countDocuments()).toBe(2);
  });

  it('without `from`, a takedown book is refused individually and the rest are written', async () => {
    const db = await seed();
    const r = await setPublicationMany(db, ['pub', 'td'], { state: 'hidden', reason: 'curation', by: BY });
    expect(r.written).toEqual(['pub']);
    expect(r.refused).toEqual(['td']);
    expect((await db.collection('books').findOne({ id: 'td' }))!.hidden_reason).toBe('kloss_manuscripts_removed_2026-07-08');
  });
});

describe('views over legacy rows', () => {
  beforeEach(cleanDb);

  it('each view counts what legacyPublication says', async () => {
    const db = await seed();
    const all = await db.collection('books').find({}).toArray();
    const states = all.map((b) => legacyPublication(b).state);
    const n = (s: string[]) => states.filter((x) => s.includes(x)).length;
    const count = (v: Parameters<typeof publicationFilter>[0]) => db.collection('books').countDocuments(publicationFilter(v));
    expect(await count('public')).toBe(n(['public']));
    expect(await count('unpublished')).toBe(n(['unpublished']));
    expect(await count('withdrawn')).toBe(n(['hidden', 'takedown']));
    expect(await count('takedown')).toBe(n(['takedown']));
    expect(await count('reachable')).toBe(n(['public', 'unpublished']));
    expect(await count('not_public')).toBe(n(['unpublished', 'hidden', 'takedown']));
  });

  it('a writer-made takedown is still found by the legacy takedown view', async () => {
    const db = await seed();
    await setPublication(db, 'pub', { state: 'takedown', by: BY, issue: 1 });
    expect(await db.collection('books').countDocuments({ ...publicationFilter('takedown'), id: 'pub' })).toBe(1);
  });
});
