/**
 * Which `$set` blocks does scripts/audit/new-field-writes.mjs examine? (#4493)
 *
 * The audit was green on a PR that `$set` an unregistered `books` field, because it only
 * looked 900 characters past a `collection('books')` call and the write went through a
 * handle hoisted 45 lines up. tests-that-are-not-guards.md: a negative control has to vary
 * the SHAPE of the code, so each idiom below carries the same unknown field and each must
 * be seen. The `pages` cases are the other half — the 814-false-positive direction.
 *
 * The hoisted fixture is the write as it stood in scripts/maintenance/recount-page-stats.mjs
 * at 844413cc4 (the file the issue names), padded to the real distance, not an invented one.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error — plain .mjs helper, no types
import { booksSetBlocks, topKeys } from '../../scripts/lib/books-set-attribution.mjs';

const keysOf = (src: string): string[] => booksSetBlocks(src).sets.flatMap((s: { body: string }) => topKeys(s.body));
const FILLER = Array.from({ length: 45 }, (_, i) => `const filler${i} = await something(${i}); // unrelated work`).join('\n');

const HOISTED = `
const db = client.db('bookstore');
const books = db.collection('books');
${FILLER}
for (const book of list) {
  if (APPLY) {
    const res = await books.updateOne(
      { _id: book._id },
      {
        $set: {
          pages_count: counts.total,
          pages_translatable: counts.translatable,
          updated_at: new Date(),
        },
      },
    );
  }
}`;

describe('books $set attribution', () => {
  it('sees a write through a hoisted handle, at any distance (#4493)', () => {
    expect(HOISTED.indexOf('$set') - HOISTED.indexOf("collection('books')")).toBeGreaterThan(900);
    expect(keysOf(HOISTED)).toEqual(['pages_count', 'pages_translatable', 'updated_at']);
  });

  it('still sees the inline form', () => {
    expect(keysOf(`await db.collection('books').updateOne({ id }, { $set: { zz_new: 1 } });`)).toEqual(['zz_new']);
    expect(keysOf(`await db.collection<Book>('books').updateOne({ id }, { $set: { zz_new: 1 } });`)).toEqual(['zz_new']);
  });

  it('sees ops pushed for a books bulkWrite, and an update built in a variable', () => {
    const bulk = `const books = db.collection('books');\n${FILLER}
      const ops = [];
      for (const b of rows) ops.push({ updateOne: { filter: { id: b.id }, update: { $set: { zz_bulk: 1 } } } });
      await books.bulkWrite(ops, { ordered: false });`;
    expect(keysOf(bulk)).toEqual(['zz_bulk']);
    const built = `const books = db.collection('books');\n${FILLER}
      const update = { $set: { zz_built: 1 } };
      await books.updateOne({ id }, update);
      const set = { zz_set: 1, updated_at: now };
      await books.updateOne({ id }, { $set: set });`;
    expect(keysOf(built).sort()).toEqual(['updated_at', 'zz_built', 'zz_set']);
  });

  it('does not blame another collection\'s write on books', () => {
    const mixed = `
      const books = db.collection('books');
      const pages = db.collection('pages');
      ${FILLER}
      await pages.updateOne({ id }, { $set: { ocr: 1 } });
      await db.collection('batch_jobs').updateOne({ id }, { $set: { status: 'x' } });
      const pageOps = [];
      pageOps.push({ updateOne: { filter: {}, update: { $set: { translation: 1 } } } });
      await pages.bulkWrite(pageOps);
      await books.updateOne({ id }, { $set: { title: 't' } });`;
    expect(keysOf(mixed)).toEqual(['title']);
  });

  it('does not blame a write through another handle on a books handle bound just above (#6498)', () => {
    // The shape of src/lib/identity-review-apply.ts at 46a9ce3c6.
    const src = `
      const queue = db.collection('work_merge_queue');
      const booksCol = db.collection('books');
      await queue.updateOne({ _id: id, status: 'pending' }, { $set: { status: 'stale', stale_reason: r } });
      await booksCol.updateOne({ work_id: a }, { $set: { work_id: b } });`;
    expect(keysOf(src)).toEqual(['work_id']);
  });

  it('follows the binding nearest above the call when a name is reused', () => {
    const rebound = `
      async function a() { const col = db.collection('books'); await col.updateOne({}, { $set: { in_books: 1 } }); }
      ${FILLER}
      async function b() { const col = db.collection('pages'); await col.updateOne({}, { $set: { in_pages: 1 } }); }`;
    expect(keysOf(rebound)).toEqual(['in_books']);
  });

  it('does not treat a query result as the handle', () => {
    const src = `const book = await db.collection('books').findOne({ id });\n${FILLER}\nawait book.updateOne({}, { $set: { nope: 1 } });`;
    expect(keysOf(src)).toEqual([]);
  });

  it('reports a $set it cannot resolve instead of passing it silently', () => {
    const src = `const books = db.collection('books');\nawait books.updateOne({ id }, { $set: fields });`;
    expect(booksSetBlocks(src).opaque.length).toBe(1);
    expect(keysOf(src)).toEqual([]);
  });

  it('reads keys, not ternaries in values', () => {
    expect(topKeys(`a: x ? y : z, 'b.c': cond ? 'p:q' : 'r', // note: here\n d: { e: 1 }, ...(w ? { f: 1 } : {}), g`)).toEqual(['a', 'b.c', 'd']);
  });
});

describe('new-field-writes.mjs, end to end', () => {
  it('exits 1 on an unknown field behind a hoisted handle, and 0 once it is removed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nfw-'));
    try {
      for (const d of ['src', 'scripts/audit', 'scripts/lib', 'scripts/maintenance']) mkdirSync(join(dir, d), { recursive: true });
      for (const f of [
        'scripts/audit/new-field-writes.mjs', 'scripts/lib/books-set-attribution.mjs', 'scripts/lib/books-known-fields.json',
        // The same CI step runs the imprint-provenance gate (#6327).
        'scripts/audit/imprint-field-writes.mjs', 'scripts/lib/imprint-write-lint.mjs', 'scripts/lib/catalogue-fields.mjs', 'scripts/lib/field-provenance.mjs',
      ]) cpSync(f, join(dir, f));
      const run = (src: string) => {
        writeFileSync(join(dir, 'scripts/maintenance/sweep.mjs'), src);
        try { execFileSync('node', ['scripts/audit/new-field-writes.mjs'], { cwd: dir, encoding: 'utf8' }); return 0; }
        catch (e) { return (e as { status: number }).status; }
      };
      expect(run(HOISTED)).toBe(0);
      expect(run(HOISTED.replace('pages_count:', 'zz_negative_control_4493: 1, pages_count:'))).toBe(1);
      // A KNOWN field, but an imprint one written with no stamp: the second gate in the same step fails it.
      expect(run(HOISTED.replace('pages_count:', "place_published: 'Venice', pages_count:"))).toBe(1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
