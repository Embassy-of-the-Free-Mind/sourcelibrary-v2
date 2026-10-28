import { describe, it, expect } from 'vitest';
import {
  setCatalogueFields,
  buildCatalogueUpdate,
  ProvenanceError,
} from '../../scripts/lib/catalogue-fields.mjs';
import { imprintWritesIn } from '../../scripts/lib/imprint-write-lint.mjs';

// #6327. A featured book read "Venice, Aldus Manutius, 1516" with no field_provenance stamp on the place or the
// printer; its title page says Lyon, Jean de Tournes, 1549. These pin the two halves of the fix: the helper
// refuses an unstamped write and records what it replaced, and the lint sees a write that goes around it.

const SCRIPT = 'scripts/maintenance/x.mjs';

/** Just enough of a Mongo Db for the helper: one book, findOne by id/_id, updateOne honouring the guard. */
function fakeDb(book: Record<string, unknown> | null) {
  const calls: { filter: Record<string, unknown>; update: Record<string, Record<string, unknown>> }[] = [];
  let doc = book ? { ...book } : null;
  const books = {
    async findOne() { return doc ? { ...doc } : null; },
    async updateOne(filter: Record<string, unknown>, update: Record<string, Record<string, unknown>>) {
      calls.push({ filter, update });
      const ok = doc && Object.entries(filter).every(([k, v]) =>
        k === '_id' ? v === doc!._id
          : v && typeof v === 'object' && '$exists' in v ? !(k in doc!) : doc![k] === v);
      if (!ok) return { modifiedCount: 0 };
      doc = { ...doc!, ...update.$set };
      return { modifiedCount: 1 };
    },
  };
  return { db: { collection: () => books }, calls, current: () => doc, mutate: (p: Record<string, unknown>) => { doc = { ...doc!, ...p }; } };
}

const aldine = () => ({
  _id: 'oid-1', id: '6952ca2a77f38f6761bc33bf',
  year: 1516, published: '1516', place_published: 'Venice', publisher: 'Aldus Manutius',
  field_provenance: { year: { source: 'import', provider: 'internet_archive' } },
});

describe('setCatalogueFields — refuses a write without a stamp (negative controls)', () => {
  it.each([
    ['no stamp at all', undefined],
    ['no source', { script: SCRIPT }],
    ['blank source', { source: '  ', script: SCRIPT }],
    ['no script', { source: 'titlepage' }],
  ])('%s → throws and writes nothing', async (_label, stamp) => {
    const f = fakeDb(aldine());
    await expect(setCatalogueFields(f.db, 'x', { place_published: 'Lyon' }, stamp as never)).rejects.toThrow(ProvenanceError);
    expect(f.calls).toHaveLength(0);
  });

  it('refuses a caller-supplied previous_value — the helper reads it, so it cannot be guessed', async () => {
    const f = fakeDb(aldine());
    await expect(setCatalogueFields(f.db, 'x', { place_published: 'Lyon' }, { source: 's', script: SCRIPT, previous_value: 'Rome' } as never))
      .rejects.toThrow(/previous_value/);
    expect(f.calls).toHaveLength(0);
  });

  it('refuses a field outside the gated catalogue fields', async () => {
    const f = fakeDb(aldine());
    await expect(setCatalogueFields(f.db, 'x', { summary: 'X' } as never, { source: 's', script: SCRIPT })).rejects.toThrow(ProvenanceError);
    await expect(setCatalogueFields(f.db, 'x', { place_published: 'Lyon', author_id: 'x' } as never, { source: 's', script: SCRIPT })).rejects.toThrow(/author_id/);
    expect(f.calls).toHaveLength(0);
  });
});

describe('setCatalogueFields — a stamped write', () => {
  it('stamps every changed field with source, script, date and the value it replaced', async () => {
    const f = fakeDb(aldine());
    const r = await setCatalogueFields(f.db, '6952ca2a77f38f6761bc33bf',
      { year: 1549, published: '1549', year_source: 'titlepage', place_published: 'Lyon', publisher: 'Jean de Tournes' },
      { source: 'titlepage', script: SCRIPT, evidence: { page_number: 3 } });
    expect(r.modified).toBe(1);
    const { $set, $push } = f.calls[0].update;
    expect($set.place_published).toBe('Lyon');
    const stamp = $set['field_provenance.place_published'] as Record<string, unknown>;
    expect(stamp).toMatchObject({ source: 'titlepage', script: SCRIPT, previous_value: 'Venice', previous_provenance: null });
    expect(stamp.date).toBeInstanceOf(Date);
    expect(($set['field_provenance.year'] as Record<string, unknown>).previous_provenance)
      .toEqual({ source: 'import', provider: 'internet_archive' });
    // History entry identical to the stamp, so a second run cannot erase the first previous_value.
    expect($push['field_provenance_history.publisher']).toEqual($set['field_provenance.publisher']);
    // year_source describes `year`; it is written but gets no stamp of its own.
    expect($set.year_source).toBe('titlepage');
    expect($set['field_provenance.year_source']).toBeUndefined();
  });

  // #7673: "Complete Works" was written onto a single volume's display_title with no stamp, so the writer that
  // produced it could not be found. A title write now carries the same stamp as an imprint write.
  it('stamps a title correction with the title-page evidence and the title it replaced', () => {
    const built = buildCatalogueUpdate(
      { _id: 'o', title: 'Opera omnia', display_title: 'Complete Works' },
      { title: 'Opera, Tomus Secundus', display_title: 'Works, Volume II (Basel, 1555)' },
      { source: 'titlepage', script: SCRIPT, evidence: { page_number: 5, as_printed: 'TOMVS SECVNDVS' } });
    const { $set, $push } = built!.update;
    expect($set['field_provenance.display_title']).toMatchObject({ source: 'titlepage', previous_value: 'Complete Works', evidence: { page_number: 5 } });
    expect($set['field_provenance.title']).toMatchObject({ previous_value: 'Opera omnia' });
    expect($push['field_provenance_history.display_title']).toEqual($set['field_provenance.display_title']);
  });

  it('a first write records previous_value: null, not an absent key', () => {
    const built = buildCatalogueUpdate({ _id: 'o' }, { printer: 'Froben' }, { source: 's', script: SCRIPT });
    expect(built!.update.$set['field_provenance.printer']).toMatchObject({ previous_value: null });
    expect(built!.filter).toEqual({ _id: 'o', printer: { $exists: false } });
  });

  it('writes nothing when no imprint value differs', async () => {
    const f = fakeDb(aldine());
    const r = await setCatalogueFields(f.db, 'x', { place_published: 'Venice' }, { source: 's', script: SCRIPT });
    expect(r.modified).toBe(0);
    expect(f.calls).toHaveLength(0);
  });

  it('writes nothing if another writer changed the field between read and write', async () => {
    const f = fakeDb(aldine());
    const built = buildCatalogueUpdate(aldine(), { place_published: 'Lyon' }, { source: 's', script: SCRIPT })!;
    f.mutate({ place_published: 'Basel' });
    const r = await f.db.collection().updateOne(built.filter, built.update as never);
    expect(r.modifiedCount).toBe(0);
    expect(f.current()!.place_published).toBe('Basel');
  });

  it('a missing book throws rather than silently doing nothing', async () => {
    const f = fakeDb(null);
    await expect(setCatalogueFields(f.db, 'nope', { year: 1549 }, { source: 's', script: SCRIPT })).rejects.toThrow(/not found/);
  });
});

describe('imprintWritesIn — the lint sees writes that go around the helper', () => {
  const books = "const books = db.collection('books');\n";

  it('a literal $set of an imprint field', () => {
    const w = imprintWritesIn(`${books}await books.updateOne({ id }, { $set: { place_published: 'Venice' } });`);
    expect(w).toEqual([{ line: 2, field: 'place_published', how: '$set' }]);
  });

  it('an update object built field by field', () => {
    const w = imprintWritesIn(`${books}const updates = {};\nupdates.publisher = p;\nset['year'] = y;\nawait books.updateOne({ id }, { $set: updates });`);
    expect(w.map((x) => [x.field, x.how])).toEqual([['publisher', 'assign'], ['year', 'assign']]);
  });

  it('a field allowlist copied into $set (the book PATCH route shape)', () => {
    const w = imprintWritesIn(`${books}const allowedFields = [\n  'summary', 'place_published',\n];`);
    expect(w).toEqual([{ line: 3, field: 'place_published', how: 'listed' }]);
  });

  it('title and author writes are gated too (#7673)', () => {
    const w = imprintWritesIn(`${books}await books.updateOne({ id }, { $set: { display_title: t, author: a, author_id: s } });`);
    expect(w.map((x) => x.field).sort()).toEqual(['author', 'display_title']);
  });

  it('not: a file that never opens books, a stamp, a query, a select list, a comparison, or a marked line', () => {
    expect(imprintWritesIn(`const updates = {}; updates.publisher = p;`)).toEqual([]);
    expect(imprintWritesIn([
      books,
      'provenance.year = { source };',
      'filter.published = y;',
      "const PROJECTION = ['title', 'publisher'];",
      'if (row.year == 1500) {}',
      'out.publisher = b.publisher; // imprint-write-ok: CSV row, not a books write',
    ].join('\n'))).toEqual([]);
  });
});
