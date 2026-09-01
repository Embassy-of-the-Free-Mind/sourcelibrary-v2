#!/usr/bin/env node
/**
 * Creates the "The Forum of Conscience" collection — the medieval and early
 * modern literature of confession: penitentials, summae confessorum, and the
 * casuistry that grew out of them.
 *
 * Built around a 13-item reading list (N01-N13) supplied by Derek. Six of those
 * items are NOT yet in the library (see GAPS below); this script tags what we
 * hold and records the gaps so the acquisition list stays attached to the work.
 *
 * The collection is created HIDDEN (visible: false). Most of the tagged books are
 * themselves hidden and un-OCR'd, so the page would render nearly empty; going
 * live is a separate decision that needs OCR spend. See the PR for the estimate.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; \
 *     node scripts/maintenance/setup-penitential-forum-collection.mjs [--apply]
 *
 * Without --apply it runs as a dry run and writes nothing.
 */
import { MongoClient, ObjectId } from 'mongodb';

const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!uri) { console.error('No MONGODB_URI in env'); process.exit(1); }

const APPLY = process.argv.includes('--apply');
const SLUG = 'forum-of-conscience';

const COLLECTION = {
  slug: SLUG,
  name: 'The Forum of Conscience',
  subtitle: 'Penitentials, summae confessorum, and the invention of casuistry',
  description:
    "In 1215 the Fourth Lateran Council obliged every Christian to confess to a priest at least once a year. That single canon created a professional problem on a continental scale: tens of thousands of parish priests now had to judge sins they had never been trained to weigh. The literature in this collection is the answer to that problem — and, incidentally, the largest sustained body of practical moral reasoning Europe produced before the modern law faculty. It begins with the early penitentials, tariff books that priced sins like a customs schedule, and with Burchard of Worms's <em>Corrector</em>, whose interrogatory reads as an accidental ethnography of what eleventh-century villagers actually believed. It passes through the great <em>summae confessorum</em> — Raymond of Penyafort, John of Freiburg, the Astesana, the Pisanella, the Angelica that Luther burned alongside the papal bull — which reorganised the material alphabetically, turning pastoral advice into something searchable. And it ends in the post-Tridentine casuistry of Navarrus, Toletus and Suárez, where the confessor's handbook became a genuine jurisprudence of the interior life, subtle enough that Pascal could make it a scandal. These books were never meant to be read through. They were meant to be consulted, at speed, by a tired man in a dark church who had to decide something.",
  color: '#6b4a3a',
  order: 60,
  type: 'category',
  kind: 'category',
  book_count: 0,
  languages: [],
  featured_images: [],
  visible: false,
  hidden: true,
  created_at: new Date(),
  updated_at: new Date(),
};

/**
 * Books we hold. `n` ties a book to the N01-N13 reading list where it answers
 * one; entries without `n` are the surrounding tradition that makes the
 * collection coherent. Ids verified against the `books` collection 2026-09-01.
 */
const HELD = [
  // --- the reading list ---
  { n: 'N05', id: '6a3a529eb271827abb182519', note: 'Raymond of Penyafort, Summa (print; list asks for Clm 14789 / Clm 2756)' },
  { n: 'N06', id: '6a3a3bcc862ce9a5b4d7658d', note: 'John of Freiburg, Summa confessorum, 1518 (list asks for Zainer 1476 / Clm 4520)' },
  { n: 'N08', id: '6a367fa0b308d2c3ca0c412b', note: 'Astesana, Summa Astensis, 1728 — visible, OCR + translated' },
  { n: 'N08', id: '6a367f5d65fce64ebd46f5ac', note: 'Astesana, Summa Astensis, 1730 — visible, OCR + translated' },
  { n: 'N09', id: '69b631a51c1c21a373809403', note: 'Antoninus, Summula confessionis, 1480 — visible, OCR (not the Defecerunt recension)' },
  { n: 'N09', id: '6a516e1dc337fd5f57a095a7', note: 'Antoninus, Summula confessionis (second copy)' },
  { n: 'N10', id: '6a3a3b416f5a257530ce0ad0', note: 'Summa Angelica, 1504 (list asks for Koberger 1498)' },
  { n: 'N10', id: '6a909543ac1fcc717ba30057', note: 'Angelus de Clavasio, Summa de casibus conscientiae' },
  { n: 'N11', id: '6a3a3b546f5a257530ce0ec9', note: 'Summa Sylvestrina, 1539 (list asks for Plantin 1569)' },
  { n: 'N12', id: '6a3a3ba8862ce9a5b4d75da1', note: 'Navarrus, Enchiridion, Antwerp: Plantin 1575 — EXACT edition requested' },
  { n: 'N13', id: '6a96cc5a3ac6c47a6318a539', note: 'Suárez, Opera omnia t. XXII (Vivès, Paris) — ACQUIRED 2026-09-01 from IA rpfranciscisuare22su; title page verified to carry De virtute poenitentiae … through Indulgentiis' },
  { id: '6a42b94e5207af7c42f67cc8', note: 'Suárez, Disputationum de censuris, 1606 — adjacent, NOT De poenitentia' },

  // --- the surrounding tradition ---
  { id: '69dbc8731040d1d5e2099c44', note: 'Bartholomaeus de Chaimis, Confessionale, 1482 — visible, translated' },
  { id: '69b633381c1c21a373817007', note: 'Bartholomaeus, Confessionale, 1490' },
  { id: '69f33467876dd827cbc4cdef', note: 'Antoninus, Tractato de septe peccati mortali, 1449 — visible, translated' },
  { id: '69dbc7e91040d1d5e2095644', note: 'Antoninus Florentinus, Trialogus, 1495 — visible, translated' },
  { id: '69dbccae0f8c5edf20f4cd23', note: 'Thomas Aquinas, Quaestiones circa confessionem, 1475 — visible, translated' },
  { id: '69dbccaf0f8c5edf20f4cd43', note: 'Thomas Aquinas, Quaestiones circa confessionem, 1490 — visible, translated' },
  { id: '6a9093ecac1fcc717ba2f0ab', note: 'ps.-Thomas, Confessionale de modo confitendi, 1508' },
  { id: '6a3a3b6882a064363d359f64', note: 'Summa Pisanella, 1484' },
  { id: '69b6476a18b87551bfc4c2c2', note: 'Nikolaus, Supplementum summae Pisanellae, 1488' },
  { id: '6a3a3b80862ce9a5b4d75782', note: 'Summa Rosella, 1488' },
  { id: '6a3a3b98862ce9a5b4d759b3', note: 'Summa Tabiena, 1517' },
  { id: '6a4d4e931d29ad53ed1da316', note: 'Andrés de Escobar, Canones poenitentiales' },
  { id: '6a3a3bb7862ce9a5b4d76118', note: 'Manuel Sá, Aphorismi confessariorum, 1599' },
  { id: '6a3a3bc2862ce9a5b4d76271', note: 'Francisco de Toledo, Summa casuum conscientiae, 1625' },
  { id: '6a4ecd2762c75f944baf166c', note: 'Bartolomé de Medina, Instructio confessariorum' },
  { id: '6a435560f920db620cce208b', note: 'Juan de Medina, De poenitentia, restitutione et contractibus, 1581' },
  { id: '6a42c42197284560a2b0bb2e', note: 'Melchor Cano, Relectio de poenitentiae sacramento, 1580' },
  { id: '6a4e5bdf00c1250433dc2c03', note: 'Azpilcueta, Compendium Manualis Navarri' },
  { id: '6a49ba89107a5b4f32d3f706', note: 'Azpilcueta, Compendium et commentarii de usuris' },
  { id: '6a42afd4466deeb51e55eb85', note: 'Valère Regnault, Praxis fori poenitentialis, 1616' },
  { id: '69b51d05261c58d636648590', note: 'Gregory Sayer, Casuum conscientiae theatrum, 1601 — visible' },
  { id: '6a51d66d361684666359655d', note: 'William Perkins, De casibus conscientiae — the Protestant counterpart' },
];

/**
 * Reading-list items with no copy in the library. Recorded on the collection doc
 * so the acquisition list travels with the collection instead of rotting in a
 * chat log. All six are the medieval/manuscript half of the list.
 */
const GAPS = [
  { n: 'N01', want: 'Burchard of Worms, Decretum lib. XIX (Corrector)', witnesses: 'Bamberg Msc.Can.6 (c. 1020); BSB Clm 4570 (1108)' },
  { n: 'N02', want: 'Bartholomew of Exeter, Poenitentiale', witnesses: 'BL Cotton Vitellius A.XII, ff. 136r-185r (Morey base text)' },
  { n: 'N03', want: 'Alain de Lille, Liber poenitentialis (long redaction)', witnesses: 'Lilienfeld 144 (undigitized); fallback BSB Clm 4616 (= collated M)' },
  { n: 'N04', want: 'Robert of Flamborough, Liber poenitentialis (Form 3)', witnesses: 'Arsenal Ms-769 (undigitized); fallback CCCC 441, Parker Library' },
  { n: 'N07', want: 'Berthold von Freiburg, Rechtssumme', witnesses: 'Bämler, Augsburg 1472' },
];

/**
 * Acquisition notes for the remaining gaps, from a source sweep on 2026-09-01.
 * Recorded because "not found" is only useful with the search attached.
 *   N01  Burchard: no standalone scan on IA. The text is in Migne PL 140 (public
 *        domain) but that is an edition, not the Bamberg/Clm witness asked for.
 *   N02  Bartholomew of Exeter: nothing on IA. Morey's 1937 edition is still in
 *        copyright; the base MS is BL Cotton Vitellius A.XII, and the BL's IIIF
 *        has been degraded since the 2023 cyber-attack.
 *   N03  Alain de Lille: Longère's critical edition of the long redaction IS on
 *        IA (alaindelillelibe0000jean) but is `access-restricted-item: true`,
 *        lending-only, 1965 Nauwelaerts — in copyright, NOT importable. The
 *        list's own fallback (BSB Clm 4616) needs a BSB manuscript id.
 *   N04  Robert of Flamborough: nothing on IA (the hits are Flamborough Head).
 *        Firth's 1971 edition is in copyright; CCCC 441 needs a Parker id.
 *   N07  Berthold, Rechtssumme: nothing on IA. Bämler 1472 needs a BSB id.
 * Four of the five therefore need an institutional IIIF manifest id, and three
 * separate BSB lookup endpoints (search UI, api search, OPACplus/SRU) failed to
 * resolve a Clm shelfmark programmatically — that lookup is the open blocker.
 */


const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');
const books = db.collection('books');
const colls = db.collection('collections');

console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — collection "${SLUG}"\n`);

// Resolve every id before writing anything, so a bad id is a report, not a silent gap.
const resolved = [];
const missing = [];
for (const entry of HELD) {
  const or = [{ id: entry.id }];
  try { or.push({ _id: new ObjectId(entry.id) }); } catch { /* not an ObjectId-shaped id */ }
  const b = await books.findOne({ $or: or }, {
    projection: { id: 1, title: 1, author: 1, published: 1, visible: 1, language: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1 },
  });
  if (b) resolved.push({ ...entry, book: b }); else missing.push(entry);
}

console.log(`Resolved ${resolved.length}/${HELD.length} ids.`);
if (missing.length) {
  console.log('\nUNRESOLVED ids (fix before applying):');
  for (const m of missing) console.log(`  ${m.id} — ${m.note}`);
}

const live = resolved.filter(r => r.book.visible !== false && (r.book.pages_count || 0) > 0);
const totalPages = resolved.reduce((s, r) => s + (r.book.pages_count || 0), 0);
const ocrPages = resolved.reduce((s, r) => s + (r.book.pages_ocr || 0), 0);

console.log(`\nTagged set: ${resolved.length} books, ${totalPages.toLocaleString()} pages.`);
console.log(`  readable now (visible + processed): ${live.length}`);
console.log(`  pages with OCR: ${ocrPages.toLocaleString()}  |  un-OCR'd: ${(totalPages - ocrPages).toLocaleString()}`);

console.log('\nBy reading-list item:');
for (const n of ['N01','N02','N03','N04','N05','N06','N07','N08','N09','N10','N11','N12','N13']) {
  const hits = resolved.filter(r => r.n === n);
  const gap = GAPS.find(g => g.n === n);
  if (hits.length) {
    for (const h of hits) console.log(`  ${n}  HELD${h.book.visible === false ? ' (hidden)' : '        '}  ${String(h.book.title).slice(0, 60)}`);
    if (gap) console.log(`  ${n}  GAP           ${gap.want}`);
  } else {
    console.log(`  ${n}  GAP           ${gap ? gap.want : '(unmapped)'}`);
  }
}

if (!APPLY) {
  console.log('\nDry run — nothing written. Re-run with --apply.');
  await client.close();
  process.exit(0);
}

if (missing.length) {
  console.error('\nRefusing to apply with unresolved ids.');
  await client.close();
  process.exit(1);
}

// Upsert the collection doc, preserving created_at on re-run.
const existing = await colls.findOne({ slug: SLUG });
const doc = { ...COLLECTION, reading_list_gaps: GAPS, updated_at: new Date() };
if (existing) {
  delete doc.created_at;
  // Don't flip visibility back to hidden if a human has since published it.
  delete doc.visible; delete doc.hidden;
  await colls.updateOne({ slug: SLUG }, { $set: doc });
  console.log(`\nUpdated existing collection ${SLUG} (visibility left as-is).`);
} else {
  await colls.insertOne(doc);
  console.log(`\nCreated collection ${SLUG} (hidden).`);
}

let tagged = 0;
for (const r of resolved) {
  const res = await books.updateOne(
    { _id: r.book._id },
    { $addToSet: { collections: SLUG }, $currentDate: { updated_at: true } },
  );
  if (res.matchedCount === 1) tagged++;
}
console.log(`Tagged ${tagged}/${resolved.length} books with "${SLUG}".`);

// book_count = the readable subset, matching what the collection grid shows.
const taggedDocs = await books.find({ collections: SLUG }, { projection: { language: 1, visible: 1, pages_count: 1 } }).toArray();
const readable = taggedDocs.filter(b => b.visible !== false && (b.pages_count || 0) > 0);
const langMap = {};
for (const b of readable) { const l = b.language || 'Unknown'; langMap[l] = (langMap[l] || 0) + 1; }
const languages = Object.entries(langMap).map(([lang, count]) => ({ lang, count })).sort((a, b) => b.count - a.count);
await colls.updateOne({ slug: SLUG }, { $set: { book_count: readable.length, languages, updated_at: new Date() } });

console.log(`book_count set to ${readable.length} (readable subset of ${taggedDocs.length} tagged).`);
console.log('languages:', JSON.stringify(languages));
console.log('\nCollection is HIDDEN. Publishing needs: OCR the tagged books, unhide them,');
console.log('re-run this script, then flip the collection + sync Supabase (see PR).');

await client.close();
