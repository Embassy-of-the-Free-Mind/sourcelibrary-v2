import { describe, it, expect, beforeEach } from 'vitest';
import { buildCoverUpdate } from '@/lib/cover-fields';
import { buildCoverUpdate as buildCoverUpdateForScripts } from '../../scripts/lib/cover-write.mjs';
import { getTestDb, cleanDb } from '../setup';

// #7673: buildCoverUpdate() returned `field_provenance: { thumbnail }`, and every caller $sets it, so one cover
// write replaced the whole map. Title and author stamps vanished from books whose cover was chosen on first view.
describe.each([
  ['src/lib/cover-fields.ts', buildCoverUpdate],
  ['scripts/lib/cover-write.mjs', buildCoverUpdateForScripts],
])('a cover write through %s', (_name, build) => {
  const page = { archived_photo: 'https://images.sourcelibrary.org/b1/4.jpg', page_number: 4 };

  beforeEach(async () => { await cleanDb(); });

  it("keeps the book's other stamps and adds its own", async () => {
    const books = getTestDb().collection('books');
    const title = { source: 'source_catalogue', method: 'reconstructed_match', record_url: 'https://example.org/r' };
    await books.insertOne({ id: 'b1', title: 'De Anima', field_provenance: { title } });

    await books.updateOne({ id: 'b1' }, { $set: build(page as never, { source: 'manual', method: 'test' })! });

    const after = await books.findOne({ id: 'b1' });
    expect(after!.field_provenance.title).toEqual(title);
    expect(after!.field_provenance.thumbnail.method).toBe('test');
    expect(after!.thumbnail).toBe(page.archived_photo);
  });

  it('writes the stamp on a book that has no field_provenance yet', async () => {
    const books = getTestDb().collection('books');
    await books.insertOne({ id: 'b2', title: 'Physica' });

    await books.updateOne({ id: 'b2' }, { $set: build(page as never, { source: 'manual', method: 'test' })! });

    expect((await books.findOne({ id: 'b2' }))!.field_provenance.thumbnail.method).toBe('test');
  });
});
