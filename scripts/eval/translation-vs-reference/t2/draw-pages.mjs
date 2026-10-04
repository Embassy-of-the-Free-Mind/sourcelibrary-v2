// PRIOR ART: scripts/eval/lib/sampling.mjs sampleOnePagePerBook draws by corpus registry, not from a fixed book list
// with a per-page script check; translation-corpus-audit/draw.mjs draws the whole library. This draws up to K seeded
// interior pages per CANDIDATE book (#5695 T2) that are Greek-majority by letter count and carry a served translation.
/** Draw up to K seeded interior candidate pages per book for #5695 T2: Greek-majority OCR (letter share), served translation present. Read-only. */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { makeRng } from '../../lib/paired-stats.mjs';

const [,, candFile, booksFile, outFile, Karg] = process.argv;
const K = Number(Karg || 6);
const books = JSON.parse(fs.readFileSync(booksFile, 'utf8'));
const cands = fs.readFileSync(candFile, 'utf8').trim().split('\n').slice(1).map((l) => l.split('\t'));
const strip = (t) => String(t || '').replace(/<[^>]+>/g, ' ');
export const greekShare = (t) => {
  const s = strip(t); const g = (s.match(/[Ͱ-Ͽἀ-῿]/g) || []).length; const l = (s.match(/\p{L}/gu) || []).length;
  return l ? g / l : 0;
};
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const pages = c.db('bookstore').collection('pages');
const out = [];
for (const [suffix, bucket, work, ref, style, canonical, genre] of cands) {
  const b = books.find((x) => x.id.endsWith(suffix));
  if (!b) { console.error('no book', suffix); continue; }
  const n = b.pages_count || 0;
  const rng = makeRng(5695 + parseInt(suffix, 16) % 100000);
  const lo = Math.max(3, Math.floor(n * 0.1)), hi = Math.max(lo + 1, Math.floor(n * 0.9));
  const tried = new Set(); const picks = []; let attempts = 0;
  while (picks.length < K && attempts < 40) {
    attempts++;
    const pn = lo + Math.floor(rng() * (hi - lo));
    if (tried.has(pn)) continue; tried.add(pn);
    const p = await pages.findOne({ book_id: b.id, page_number: pn }, { projection: { page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'translation.data': 1, 'translation.model': 1, 'translation.prompt_version': 1, photo: 1, display_photo: 1, photo_original: 1, archived_photo: 1 } });
    const o = p?.ocr?.data || ''; const t = p?.translation?.data || '';
    const gs = greekShare(o);
    const ok = o.length >= 400 && t.length >= 300 && gs >= 0.35;
    if (ok) picks.push({ page_number: pn, script: gs >= 0.6 ? 'greek' : 'bilingual', greek_share: +gs.toFixed(3), ocr_chars: o.length, tr_chars: t.length, tr_model: p.translation?.model ?? null, prompt_version: p.translation?.prompt_version ?? null, ocr_model: p.ocr?.model ?? null, image: p.display_photo || p.photo || p.archived_photo || null });
    else if (p) picks.push({ page_number: pn, greek_share: +gs.toFixed(3), rejected: o.length < 400 ? 'short-ocr' : t.length < 300 ? 'no-translation' : `greek_share ${gs.toFixed(2)}` });
  }
  const good = [...picks.filter((x) => x.script === 'greek'), ...picks.filter((x) => x.script === 'bilingual')];
  out.push({ suffix, book_id: b.id, title: b.title, author: b.author, published: b.published, pages_count: n, pages_translated: b.pages_translated, bucket, work, reference_hint: ref, style, canonical: canonical === 'true', genre, pages: good.slice(0, K), rejected: picks.filter((x) => x.rejected), attempts });
  console.error(suffix, good.filter((x)=>x.script==='greek').length, good.filter((x)=>x.script==='bilingual').length, picks.filter((x) => x.rejected).map((x) => x.rejected).slice(0, 3).join(';'));
}
await c.close();
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
