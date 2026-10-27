// PRIOR ART: none — a 20-line join helper; arms.mjs and score.mjs both need it, so it is one file.
/**
 * rows.mjs — which page a raw arm row was called on (#7570).
 * A row written after 2026-10-27 22:20 UTC carries `page_key` (book_id:page_number). Earlier rows carry only the pair
 * slug; for Chinese, the slugs of a premature seal (34 of 37 lookups done) are mapped through
 * results/…/slug-remap-chinese-v3.json; every other script's slugs never changed between seals.
 */
import fs from 'fs';
import path from 'path';

export function rowPageKey(RES, sealed) {
  const f = path.join(RES, 'slug-remap-chinese-v3.json');
  const remap = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).map : {};
  const cur = new Map(sealed.pages.map((p) => [p.slug, `${p.book_id}:${p.page_number}`]));
  return (r) => r.page_key || (r.slug.startsWith('P-') ? r.slug : r.slug.startsWith('chinese-') ? remap[r.slug] : cur.get(r.slug)) || null;
}
export const pageKeyOf = (p) => (p.book_id ? `${p.book_id}:${p.page_number}` : p.slug);
