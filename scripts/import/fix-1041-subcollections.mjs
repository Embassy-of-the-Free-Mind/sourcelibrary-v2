#!/usr/bin/env node
/**
 * Fix subcollection assignments for books already tagged with parent collections
 */

import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/dereklomas/sourcelibrary/.env.production.local' });

const client = new MongoClient(process.env.MONGODB_URI);

async function main() {
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');
  const colls = db.collection('collections');

  console.log('=== Fix Subcollection Assignments ===\n');
  let total = 0;

  // Chinese Theater → subcollections
  // Yuan Zaju: 元曲選 volumes
  const yuanBooks = await books.find({
    collections: 'chinese-theater',
    title: { $regex: '元曲選|Yuanqu|Yuan.*Play|yuan.*zaju', $options: 'i' }
  }).toArray();
  for (const b of yuanBooks) {
    const r = await books.updateOne({ _id: b._id }, { $addToSet: { collections: 'yuan-zaju' } });
    if (r.modifiedCount) { console.log(`  yuan-zaju: ${b.title.substring(0, 60)}`); total++; }
  }

  // Ming Chuanqi: 琵琶記, 牡丹亭, 六十種曲, 盛明雜劇, 西廂記, 董解元, 玉茗堂, 崑曲
  const mingBooks = await books.find({
    collections: 'chinese-theater',
    title: { $regex: '琵琶記|牡丹亭|六十種曲|盛明雜劇|西廂記|董解元|玉茗堂|崑曲|Peony Pavilion|Lute|Western Chamber|Sixty Plays|Kunqu', $options: 'i' }
  }).toArray();
  for (const b of mingBooks) {
    const r = await books.updateOne({ _id: b._id }, { $addToSet: { collections: 'ming-chuanqi' } });
    if (r.modifiedCount) { console.log(`  ming-chuanqi: ${b.title.substring(0, 60)}`); total++; }
  }

  // Theater theory: 閑情偶寄
  const theoryBooks = await books.find({
    collections: 'chinese-theater',
    title: { $regex: '閑情偶寄|Xianqing|Casual Expressions|theater theory', $options: 'i' }
  }).toArray();
  for (const b of theoryBooks) {
    const r = await books.updateOne({ _id: b._id }, { $addToSet: { collections: 'chinese-theater-theory' } });
    if (r.modifiedCount) { console.log(`  chinese-theater-theory: ${b.title.substring(0, 60)}`); total++; }
  }

  // Medieval Drama
  const medievalBooks = await books.find({
    collections: 'renaissance-theater',
    title: { $regex: 'Hrotsvitha|Hrosvit|Everyman|Mystery Play|Morality|Hildegard|Ordo Virtutum', $options: 'i' }
  }).toArray();
  for (const b of medievalBooks) {
    const r = await books.updateOne({ _id: b._id }, { $addToSet: { collections: 'medieval-drama' } });
    if (r.modifiedCount) { console.log(`  medieval-drama: ${b.title.substring(0, 60)}`); total++; }
  }

  // Italian Renaissance Theater
  const italianBooks = await books.find({
    collections: 'renaissance-theater',
    title: { $regex: 'Orfeo|Poliziano|Aminta|Tasso|Pastor Fido|Guarini|Commedia|Flaminio|Scala|Castelvetro|Poetica.*Aristotele', $options: 'i' }
  }).toArray();
  for (const b of italianBooks) {
    const r = await books.updateOne({ _id: b._id }, { $addToSet: { collections: 'italian-renaissance-theater' } });
    if (r.modifiedCount) { console.log(`  italian-renaissance-theater: ${b.title.substring(0, 60)}`); total++; }
  }

  // Spanish Golden Age
  const spanishBooks = await books.find({
    collections: 'renaissance-theater',
    title: { $regex: 'Celestina|Lope de Vega|Arte Nuevo|Calder[oó]n|vida es sue[nñ]o', $options: 'i' }
  }).toArray();
  for (const b of spanishBooks) {
    const r = await books.updateOne({ _id: b._id }, { $addToSet: { collections: 'spanish-golden-age' } });
    if (r.modifiedCount) { console.log(`  spanish-golden-age: ${b.title.substring(0, 60)}`); total++; }
  }

  // French Classical
  const frenchBooks = await books.find({
    collections: 'renaissance-theater',
    title: { $regex: 'Corneille|Cid|Tartuffe|Moli[eè]re|Racine|Ph[eè]dre', $options: 'i' }
  }).toArray();
  for (const b of frenchBooks) {
    const r = await books.updateOne({ _id: b._id }, { $addToSet: { collections: 'french-classical-theater' } });
    if (r.modifiedCount) { console.log(`  french-classical-theater: ${b.title.substring(0, 60)}`); total++; }
  }

  // English Renaissance
  const englishBooks = await books.find({
    collections: 'renaissance-theater',
    title: { $regex: 'Shakespeare|First Folio|Ben Jonson|Workes.*Jonson|Kyd|Spanish Tragedy|Marlowe|Tamburlaine|Sidney|Defence of Poesie', $options: 'i' }
  }).toArray();
  for (const b of englishBooks) {
    const r = await books.updateOne({ _id: b._id }, { $addToSet: { collections: 'english-renaissance-theater' } });
    if (r.modifiedCount) { console.log(`  english-renaissance-theater: ${b.title.substring(0, 60)}`); total++; }
  }

  // Panchatantra & Derivatives
  const panchBooks = await books.find({
    collections: 'world-fable-traditions',
    title: { $regex: 'Panchatantra|Hitopadesha|Kathasaritsagara|Ocean of Story|Directorium|Buch der Beispiele|Bidpai', $options: 'i' }
  }).toArray();
  for (const b of panchBooks) {
    const r = await books.updateOne({ _id: b._id }, { $addToSet: { collections: 'panchatantra-derivatives' } });
    if (r.modifiedCount) { console.log(`  panchatantra-derivatives: ${b.title.substring(0, 60)}`); total++; }
  }

  // Buddhist Jataka
  const jatakaBooks = await books.find({
    collections: 'world-fable-traditions',
    title: { $regex: 'Jataka|J[aā]taka', $options: 'i' }
  }).toArray();
  for (const b of jatakaBooks) {
    const r = await books.updateOne({ _id: b._id }, { $addToSet: { collections: 'buddhist-jataka' } });
    if (r.modifiedCount) { console.log(`  buddhist-jataka: ${b.title.substring(0, 60)}`); total++; }
  }

  // Persian & Arabic Fables
  const persianBooks = await books.find({
    collections: 'world-fable-traditions',
    title: { $regex: 'Kalila|Dimna|Anvar|Suhaili|Suhayli|Bidpai', $options: 'i' }
  }).toArray();
  for (const b of persianBooks) {
    const r = await books.updateOne({ _id: b._id }, { $addToSet: { collections: 'persian-arabic-fables' } });
    if (r.modifiedCount) { console.log(`  persian-arabic-fables: ${b.title.substring(0, 60)}`); total++; }
  }

  // Chinese Technology subcollections
  const agriBooks = await books.find({
    collections: 'chinese-technology',
    title: { $regex: '天工開物|Tiangong|考工記|Kaogong|農書|Nongshu|三才圖會|Sancai|夢溪筆談|Dream Pool', $options: 'i' }
  }).toArray();
  for (const b of agriBooks) {
    // Sancai and Mengxi are general encyclopedias, skip subcollection
    if (/三才圖會|Sancai|夢溪筆談|Dream Pool/.test(b.title)) continue;
    const r = await books.updateOne({ _id: b._id }, { $addToSet: { collections: 'chinese-agricultural-industrial' } });
    if (r.modifiedCount) { console.log(`  chinese-agricultural-industrial: ${b.title.substring(0, 60)}`); total++; }
  }

  const milBooks = await books.find({
    collections: 'chinese-technology',
    title: { $regex: '武備志|Wubei', $options: 'i' }
  }).toArray();
  for (const b of milBooks) {
    const r = await books.updateOne({ _id: b._id }, { $addToSet: { collections: 'chinese-military-technology' } });
    if (r.modifiedCount) { console.log(`  chinese-military-technology: ${b.title.substring(0, 60)}`); total++; }
  }

  const natBooks = await books.find({
    collections: 'chinese-technology',
    title: { $regex: '本草綱目|Bencao|Flora Sinensis|Boym', $options: 'i' }
  }).toArray();
  for (const b of natBooks) {
    // Already tagged — skip if already in subcollection
    const r = await books.updateOne({ _id: b._id }, { $addToSet: { collections: 'chinese-natural-history' } });
    if (r.modifiedCount) { console.log(`  chinese-natural-history: ${b.title.substring(0, 60)}`); total++; }
  }

  console.log(`\nAssigned ${total} new subcollection links`);

  // Update all counts
  console.log('\n--- Updating counts ---');
  const allSlugs = [
    'chinese-theater', 'yuan-zaju', 'ming-chuanqi', 'chinese-theater-theory',
    'renaissance-theater', 'medieval-drama', 'italian-renaissance-theater',
    'spanish-golden-age', 'french-classical-theater', 'english-renaissance-theater',
    'world-fable-traditions', 'panchatantra-derivatives', 'buddhist-jataka',
    'chinese-philosophical-fables', 'persian-arabic-fables',
    'chinese-technology', 'chinese-agricultural-industrial',
    'chinese-military-technology', 'chinese-natural-history',
  ];

  for (const slug of allSlugs) {
    const count = await books.countDocuments({ collections: slug, status: { $ne: 'deleted' } });
    await colls.updateOne({ slug }, { $set: { book_count: count } });

    if (count > 0) {
      const langAgg = await books.aggregate([
        { $match: { collections: slug, status: { $ne: 'deleted' } } },
        { $group: { _id: '$original_language', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]).toArray();
      await colls.updateOne({ slug }, { $set: { languages: langAgg.map(l => ({ lang: l._id || 'Unknown', count: l.count })) } });
    }
    console.log(`  ${slug}: ${count}`);
  }

  console.log('\n=== Done ===');
  await client.close();
}

main().catch(console.error);
