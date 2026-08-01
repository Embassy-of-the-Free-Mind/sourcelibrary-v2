/**
 * audit-hallucinated-plate-descriptions.mjs
 *
 * Finds gallery-image descriptions that ASSERT a figurative/decorative scene —
 * putti, cherubs, allegories, coats of arms, sea monsters, portraits, etc. These
 * are the classic pre-#2707 hallucination signature: the captioner inventing a
 * Baroque decorative element from organic shapes (the "Sphaerocarpos liverwort
 * plate read as a putto tailpiece" case). The #2707 prompt guard now blocks this
 * at extraction time, so this surfaces the OLD data that still carries it.
 *
 * HEURISTIC, not proof — some books genuinely have such imagery (alchemical
 * frontispieces, emblem books). It ranks by how off-subject the description is:
 * a putto on a botany/science/medicine book is far likelier wrong than on an
 * emblem book. Output is a review list, not an auto-fix.
 *
 * Usage: node --env-file=.env.production.local scripts/analysis/audit-hallucinated-plate-descriptions.mjs [--limit=40]
 */
import { MongoClient } from 'mongodb';

const arg = (n, d) => { const h = process.argv.find(a => a.startsWith(`--${n}=`)); return h ? h.split('=')[1] : d; };
const LIMIT = parseInt(arg('limit', '40'), 10);

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

// Figurative / decorative scene assertions — the hallucination signature.
const FIG = /\b(putto|putti|cherub|cherubim|angel|allegor|allegory|coat of arms|armorial|heraldic|sea monster|dolphin|cornucopia|tailpiece|headpiece|goddess|deity|nymph|satyr|infant figure|winged figure|portrait of|bust of|escutcheon|crest)\b/i;
// Subjects where such figurative imagery is UNlikely (raises confidence it's a hallucination).
const NONFIG_SUBJECT = /\b(botan|plant|flora|fungi|mycolog|lichen|moss|liverwort|anatom|medicin|herbal|zoolog|insect|shell|mineral|geolog|astronom|math|geometr|map|chart|diagram|chemistr)\b/i;

const client = await MongoClient.connect(uri);
const db = client.db('bookstore');

// Pull candidate descriptions cheaply (regex in Mongo), then rank in JS.
const cands = await db.collection('gallery_images')
  .find({ description: { $regex: FIG } }, { projection: { _id: 0, id: 1, book_id: 1, description: 1 } })
  .toArray();

// Join book subject/title for the off-subject signal.
const bookIds = [...new Set(cands.map(c => c.book_id))];
const books = await db.collection('books')
  .find({ id: { $in: bookIds } }, { projection: { _id: 0, id: 1, slug: 1, display_title: 1, title: 1, categories: 1, content_type: 1 } })
  .toArray();
const byId = new Map(books.map(b => [b.id, b]));

const rows = cands.map(c => {
  const b = byId.get(c.book_id) || {};
  const haystack = `${b.display_title || ''} ${b.title || ''} ${(b.categories || []).join(' ')}`;
  const offSubject = NONFIG_SUBJECT.test(haystack);
  const term = (c.description.match(FIG) || [])[0];
  return { gid: c.id, slug: b.slug, title: b.display_title || b.title, term, offSubject, desc: c.description.slice(0, 90) };
});

// High-confidence = figurative assertion on a non-figurative subject.
const highConf = rows.filter(r => r.offSubject);
const rest = rows.filter(r => !r.offSubject);

console.log(`gallery images asserting a figurative/decorative scene: ${rows.length}`);
console.log(`  ↳ on a clearly non-figurative subject (LIKELY hallucination): ${highConf.length}`);
console.log(`  ↳ on other subjects (needs eyeballing): ${rest.length}`);
console.log(`\nTop likely-hallucination cases:\n`);
for (const r of highConf.slice(0, LIMIT)) {
  console.log(`  [${r.term}] ${r.slug || r.gid}`);
  console.log(`     "${r.desc}…"`);
}

await client.close();
