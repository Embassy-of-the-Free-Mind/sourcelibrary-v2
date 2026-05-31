#!/usr/bin/env node
/**
 * PROPOSAL (read-only): cluster distinct book-author strings into canonical
 * people, to size/validate a canonical author-layer rebuild (GitHub #2179).
 * No writes. Shows, per top cluster: the variant strings, book count, how many
 * distinct entity records currently fragment the person, and any VIAF anchor.
 */
import { MongoClient } from 'mongodb';

const PARTICLES = new Set(['de','del','della','di','da','la','le','van','von','der','den','du','des','el','al','ibn','ben','a','ab','zu','of','the','don','fr','st','saint','y','e']);
const norm = (s) => (s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
function canonicalKey(author) {
  let s = norm(author).replace(/\([^)]*\)/g,'').replace(/,?\s*\d{3,4}\b.*$/,'').replace(/[^a-z\s,]/g,' ');
  const toks = s.split(/[\s,]+/).filter(t => t.length>=3 && !PARTICLES.has(t));
  // light Latin stem + j/i, v/u, g(i)→i folding so Iordanus/Giordano/Jordan converge
  const stems = toks.map(t => t
    .replace(/^j/,'i').replace(/^gi/,'i').replace(/v/g,'u')
    .replace(/(issimus|us|um|orum|arum|ibus|onis|ius|is|ae|i|o|a|e)$/,''))
    .filter(t => t.length>=3).sort();
  // Non-Latin scripts (CJK / Cyrillic / Greek / Arabic) lose every token to the
  // a–z filter above; fall back to the diacritic-folded raw name so they still
  // cluster instead of collapsing to an empty key (e.g. 李時珍 / Li Shizhen).
  if (!stems.length) {
    return (author || '').normalize('NFKD').replace(/[̀-ͯ]/g,'')
      .replace(/\([^)]*\)/g,'').replace(/[\d,.;]/g,'').replace(/\s+/g,'').toLowerCase();
  }
  return stems.join(' ');
}

const mc = new MongoClient(process.env.MONGODB_URI); await mc.connect();
const db = mc.db('bookstore'); const books = db.collection('books'); const ents = db.collection('entities');

// distinct author strings + book counts (real books)
const rows = await books.aggregate([
  { $match: { visible: { $ne: false }, pages_count: { $gt: 0 }, author: { $type: 'string', $ne: '' } } },
  { $group: { _id: '$author', n: { $sum: 1 }, ents: { $addToSet: '$author_entity_id' } } },
], { allowDiskUse: true }).toArray();

const clusters = new Map();
for (const r of rows) {
  const k = canonicalKey(r._id); if (!k) continue;
  if (!clusters.has(k)) clusters.set(k, { strings: [], books: 0, ents: new Set() });
  const c = clusters.get(k);
  c.strings.push({ s: r._id, n: r.n });
  c.books += r.n;
  for (const e of r.ents) if (e) c.ents.add(String(e));
}

const top = [...clusters.values()].sort((a,b)=>b.books-a.books).slice(0,30);
console.log(`distinct author strings: ${rows.length}  →  canonical clusters: ${clusters.size}\n`);
console.log('Top clusters by book count (variants · books · current entity records):');
for (const c of top) {
  const canonical = c.strings.sort((a,b)=>b.n-a.n)[0].s;
  // any VIAF anchor among the linked entities?
  let viaf = null;
  for (const eid of c.ents) {
    try { const e = await ents.findOne({ _id: new (await import('mongodb')).ObjectId(eid) }, { projection: { viaf_id: 1 } }); if (e?.viaf_id) { viaf = e.viaf_id; break; } } catch {}
  }
  console.log(`  ${String(c.books).padStart(4)} books · ${String(c.strings.length).padStart(2)} variants · ${String(c.ents.size).padStart(2)} entity recs ${viaf?'· VIAF '+viaf:'· no VIAF'}  → "${canonical}"`);
  if (c.strings.length > 1) console.log(`        variants: ${c.strings.slice(0,6).map(x=>`"${x.s}"(${x.n})`).join(', ')}${c.strings.length>6?' …':''}`);
}
await mc.close();
