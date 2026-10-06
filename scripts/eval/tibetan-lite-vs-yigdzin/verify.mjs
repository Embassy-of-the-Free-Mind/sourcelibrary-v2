// yigdzin-527 (#4523) end-of-run check: holds and visible unchanged on all 527 books, Yigdzin pages written, none translated,
// lite/flash snapshots in page_revisions, excluded books untouched. Read-only; book_id-scoped (pages has no index on ocr.engine.run).
// PRIOR ART: /root/tib-step2/chk-enrol.mjs (a one-off step-2 check of the same kind, not reusable here). Run from /root/yig527.
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
const EXCL = JSON.parse(fs.readFileSync('/root/sourcelibrary/.claude/worktrees/job-yigdzin-527/scripts/eval/tibetan-lite-vs-yigdzin/exclude-books.json', 'utf8')).books;
const books = fs.readFileSync('books-527.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
const m = new MongoClient(process.env.MONGODB_URI); await m.connect(); const db = m.db('bookstore');
const c = { books: 0, held_same: 0, held_changed: [], visible_changed: [], yig_pages: 0 };
const priorIds = [];
for (const l of fs.readFileSync('todo-all.jsonl', 'utf8').split('\n')) { if (!l) continue; const r = JSON.parse(l); if (r.prior !== 'none') priorIds.push(r.id); }
for (const b of books) {
  const bk = await db.collection('books').findOne({ id: b.book }, { projection: { visible: 1, 'pipeline_auto.hold.reason': 1 } });
  c.books++;
  if (bk.pipeline_auto?.hold?.reason === b.hold) c.held_same++; else c.held_changed.push([b.book, b.hold, bk.pipeline_auto?.hold?.reason]);
  if (bk.visible !== b.visible) c.visible_changed.push([b.book, b.visible, bk.visible]);
}
c.yig_pages_with_translation = 0;
for (const b of books) {
  c.yig_pages += await db.collection('pages').countDocuments({ book_id: b.book, 'ocr.engine.run': 'yigdzin-leaf-2026-10-03' });
  c.yig_pages_with_translation += await db.collection('pages').countDocuments({ book_id: b.book, 'ocr.engine.run': 'yigdzin-leaf-2026-10-03', 'translation.data': { $exists: true, $nin: ['', null] } });
}
let revs = 0;
for (let i = 0; i < priorIds.length; i += 1000) revs += await db.collection('page_revisions').countDocuments({ page_id: { $in: priorIds.slice(i, i + 1000) }, field: 'ocr', reason: 'reocr_bdrc_4523' });
c.revisions_on_gemini_pages = revs;
c.excluded_books_touched = 0;
for (const id of Object.keys(EXCL)) c.excluded_books_touched += await db.collection('pages').countDocuments({ book_id: id, 'ocr.engine.run': 'yigdzin-leaf-2026-10-03' });
console.log(JSON.stringify(c, null, 1));
await m.close();
