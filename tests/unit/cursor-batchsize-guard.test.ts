/**
 * #5859 / #7268 — mongodb driver v7 dropped the implicit getMore batchSize of 1000 (NODE-6296). An unbatched
 * cursor buffers 45K–196K docs before its next getMore (measured on prod), and the server kills a cursor that
 * goes 10 minutes without one, so a long per-doc loop in scripts/ dies with CursorNotFound where it used to
 * finish. Every such loop carries `.batchSize(1000)` (exact v6 semantics); this keeps new ones from regressing.
 *
 * The scanner is scripts/lib/cursor-batchsize-lint.mjs (`node scripts/lib/cursor-batchsize-lint.mjs --fix`
 * inserts the call). A loop that is deliberately unbatched says so with a `cursor-batch-ok: <reason>` comment
 * on the line of the `.find(`/`.aggregate(` call or the line before it. Request-path cursors in src/ are out
 * of scope: they gain from larger batches and finish well inside ten minutes.
 */
import { describe, it, expect } from 'vitest';
import path from 'path';
// @ts-expect-error — untyped .mjs helper
import { scanScripts, scanSource, fixSource } from '../../scripts/lib/cursor-batchsize-lint.mjs';

const ROOT = path.join(__dirname, '..', '..');

type Finding = { file: string; line: number; kind: string; method: string };
type SrcFinding = { line: number; kind: string; method: string; insertAt: number };

/** Files allowed to carry an unbatched loop, with why. Shrink it; never grow it without a reason. */
const ALLOW: Record<string, string> = {};

describe('long-running cursor loops in scripts/ set batchSize (#5859)', () => {
  it('no unbatched cursor loop outside the allow-list', () => {
    const offenders = (scanScripts(ROOT) as Finding[])
      .filter(f => !(f.file in ALLOW))
      .map(f => `${f.file}:${f.line} ${f.kind} .${f.method}() — add .batchSize(1000) or a cursor-batch-ok: comment`);
    expect(offenders).toEqual([]);
  });

  it('allow-list carries no stale entries', () => {
    const found = new Set((scanScripts(ROOT) as Finding[]).map(f => f.file));
    expect(Object.keys(ALLOW).filter(f => !found.has(f))).toEqual([]);
  });
});

describe('scanner (planted regressions)', () => {
  const kinds = (src: string) => (scanSource(src) as SrcFinding[]).map(f => f.kind);

  it('flags an inline for-await over find()', () => {
    expect(kinds(`for await (const b of db.collection('books').find({}, { projection: { id: 1 } })) { await work(b); }`))
      .toEqual(['inline']);
  });

  it('flags a cursor variable iterated with for-await, hasNext or forEach', () => {
    expect(kinds(`const cursor = pages.find(q).project(p);\nfor await (const p of cursor) {}`)).toEqual(['variable']);
    expect(kinds(`const cur = db.collection('pages').aggregate([{ $match: q }]);\nwhile (await cur.hasNext()) { await cur.next(); }`))
      .toEqual(['variable']);
    expect(kinds(`const c = books.find(q);\nawait c.forEach(async (b) => { await go(b); });`)).toEqual(['forEach']);
    expect(kinds(`await books.find(q).forEach((b) => n++);`)).toEqual(['forEach']);
  });

  it('flags a reassigned cursor and both arms of a ternary', () => {
    expect(kinds(`let cursor;\nif (x) cursor = B.find({ a: 1 });\nelse cursor = B.find({});\nfor await (const b of cursor) {}`))
      .toEqual(['variable', 'variable']);
    expect(kinds(`const cursor = LIMIT ? P.find(f).limit(LIMIT) : P.find(f);\nfor await (const p of cursor) {}`))
      .toEqual(['variable', 'variable']);
  });

  it('flags a TypeScript cast in the loop header', () => {
    expect(kinds(`for await (const d of c.find({ a: 1 }) as any) {}`)).toEqual(['inline']);
    expect(kinds(`const cursor = books.find({});\nfor await (const b of cursor as any) {}`)).toEqual(['variable']);
  });

  it('passes a cursor that sets batchSize (method, option, or later statement)', () => {
    expect(kinds(`for await (const b of books.find({}).batchSize(1000)) {}`)).toEqual([]);
    expect(kinds(`for await (const b of books.find({}, { projection: p, batchSize: 500 })) {}`)).toEqual([]);
    expect(kinds(`const cur = books.aggregate(pipe, { allowDiskUse: true, batchSize: 1000 });\nfor await (const b of cur) {}`)).toEqual([]);
    expect(kinds(`const cur = books.find({});\ncur.batchSize(1000);\nfor await (const b of cur) {}`)).toEqual([]);
  });

  it('passes toArray(), a small literal limit, Array.prototype.find and comments', () => {
    expect(kinds(`const rows = await books.find({}).toArray();\nfor (const r of rows) {}`)).toEqual([]);
    expect(kinds(`for await (const b of books.find({}).sort({ _id: 1 }).limit(500)) {}`)).toEqual([]);
    expect(kinds(`for await (const b of books.aggregate([{ $sample: { size: 1 } }, { $limit: 200 }])) {}`)).toEqual([]);
    expect(kinds(`const hit = arr.find((x) => x.id === id);\nfor await (const y of hit) {}`)).toEqual([]);
    expect(kinds(`// for await (const b of books.find({})) {}\nconst x = 1;`)).toEqual([]);
  });

  it('passes a loop that says why it is unbatched', () => {
    expect(kinds(`// cursor-batch-ok: 30-row collection\nfor await (const b of db.collection('tiny').find({})) {}`)).toEqual([]);
  });

  it('does not flag a cursor handed to another function (documented blind spot) or the next loop over a new name', () => {
    expect(kinds(`const cursor = books.find({}).batchSize(1000);\nfor await (const b of cursor) {}\nconst other = pages.find({}).toArray();`))
      .toEqual([]);
  });

  it('--fix inserts .batchSize(1000) right after the call, and the result scans clean', () => {
    const src = `const cursor = db.collection('pages')\n  .find({ book_id: id }, { projection: P })\n  .sort({ page_number: 1 });\nfor await (const p of cursor) {}`;
    const fixed = fixSource(src) as string;
    expect(fixed).toContain(`.find({ book_id: id }, { projection: P }).batchSize(1000)\n  .sort({ page_number: 1 });`);
    expect(kinds(fixed)).toEqual([]);
  });
});
