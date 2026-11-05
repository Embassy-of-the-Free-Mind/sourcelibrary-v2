// PRIOR ART: scripts/lib/ocr-trust-gate.mjs bookHand / loadOcrProfile — the book-level manuscript | print | unknown
// call from counts of pages.script_type, reused here unchanged for the book fallback. It does not fit alone: the router
// split (Derek, inbox 2026-10-28 11:54Z) is per JUDGED PAGE, and many 3 Flash pages carry neither script_type nor the
// <script> tag, so the page's own field, then its tag, then the book come first.
/**
 * Print or manuscript, per page, for the router's script-type split (#7263). Order (Derek, inbox 2026-10-28 12:06Z):
 *   1. the <script>…</script> tag in the page's CURRENT ocr.data, where pages.script_type is missing   basis 'tag'
 *   2. pages.script_type (printed | handwritten | mixed)                                               basis 'page'
 *      field and tag disagree: the tag wins, counted as a conflict                                    basis 'tag-conflict'
 *   3. neither: the book's majority (ocr-trust-gate bookHand over pages.script_type)                   basis 'book'
 *   4. unknown, reported apart, never pooled                                                           basis 'none'
 * mixed counts as print (Derek: "mixed with print unless the evidence says otherwise"). Read-only: nothing is written
 * to pages.script_type here (a backfill is its own decided sweep).
 */
import { bookHand, loadOcrProfile } from '../../lib/ocr-trust-gate.mjs';

const CLASS = { printed: 'print', mixed: 'print', handwritten: 'manuscript' };
export const tagOf = (data) => String(data || '').match(/<script>\s*(printed|handwritten|mixed)\s*<\/script>/i)?.[1]?.toLowerCase() ?? null;

/** page ids → Map(page_id → { cls: print | manuscript | unknown, basis, raw, field, tag, book_id }). */
export async function classifyPages(db, ids) {
  const out = new Map(), books = new Map();
  for (let i = 0; i < ids.length; i += 500) {
    const ps = await db.collection('pages').find({ id: { $in: ids.slice(i, i + 500) } }, { projection: { _id: 0, id: 1, book_id: 1, script_type: 1, 'ocr.data': 1 } }).toArray();
    for (const p of ps) {
      const tag = tagOf(p.ocr?.data), field = CLASS[p.script_type] ? p.script_type : null;
      const raw = tag || field;
      const basis = !tag ? 'page' : !field ? 'tag' : CLASS[tag] === CLASS[field] ? 'page' : 'tag-conflict';
      if (raw) out.set(p.id, { cls: CLASS[raw], basis, raw, field, tag, book_id: p.book_id });
      else out.set(p.id, { cls: null, basis: null, raw: null, book_id: p.book_id });
    }
  }
  for (const [id, v] of out) {
    if (v.cls) continue;
    if (!books.has(v.book_id)) books.set(v.book_id, bookHand(await loadOcrProfile(db, v.book_id, [])));
    const h = books.get(v.book_id);
    out.set(id, h === 'unknown' ? { ...v, cls: 'unknown', basis: 'none' } : { ...v, cls: h, basis: 'book' });
  }
  for (const id of ids) if (!out.has(id)) out.set(id, { cls: 'unknown', basis: 'missing page' });
  return out;
}
