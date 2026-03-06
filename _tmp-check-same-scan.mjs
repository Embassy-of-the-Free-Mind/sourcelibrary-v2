import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');

const pairs = [
  { label: "Alberti - De re aedificatoria", new_slug: "de-re-aedificatoria-1485-editio-princeps", old_slug: "alberti-de-re-aedificatoria-1512-paris" },
  { label: "Hooke - Micrographia", new_slug: "micrographia-or-some-physiological", old_slug: "micrographia-1665-first-edition" },
  { label: "Macrobius (Mar 5 vs Dec)", new_slug: "macrobii-commentarii-in-somnium-scipionis-macrobius", old_slug: "commentary-on-the-dream-of-scipio" },
  { label: "Macrobius (Feb vs Dec)", new_slug: "in-somnium-scipionis-explanatio-saturnaliorum", old_slug: "commentary-on-the-dream-of-scipio" },
  { label: "Hermetica (Scott)", new_slug: "hermetica-vol-1-scott", old_slug: "hermetica-vol-i-texts-and-translation" },
  { label: "Gilbert - De Magnete", new_slug: "de-magnete-magneticisque-corporibus", old_slug: "de-magnete-1600-first-edition" },
];

for (const p of pairs) {
  const newBook = await db.collection("books").findOne({ slug: { $regex: p.new_slug } });
  const oldBook = await db.collection("books").findOne({ slug: { $regex: p.old_slug } });

  if (!newBook || !oldBook) {
    console.log(`=== ${p.label} === BOOK NOT FOUND (new: ${!!newBook}, old: ${!!oldBook})`);
    continue;
  }

  const newId = newBook.ia_identifier || newBook.image_source?.identifier || "";
  const oldId = oldBook.ia_identifier || oldBook.image_source?.identifier || "";

  const newPages = await db.collection("pages").find({ book_id: newBook.id || newBook._id.toString() }).sort({ page_number: 1 }).limit(3).project({ photo_original: 1, photo: 1, page_number: 1 }).toArray();
  const oldPages = await db.collection("pages").find({ book_id: oldBook.id || oldBook._id.toString() }).sort({ page_number: 1 }).limit(3).project({ photo_original: 1, photo: 1, page_number: 1 }).toArray();

  console.log(`=== ${p.label} ===`);
  console.log(`  NEW: ia=${newId} | ${newBook.pages_count}p | provider=${newBook.image_source?.provider || "?"}`);
  for (const pg of newPages.slice(0, 2)) {
    console.log(`    p${pg.page_number}: ${(pg.photo_original || pg.photo || "?").substring(0, 120)}`);
  }
  console.log(`  OLD: ia=${oldId} | ${oldBook.pages_count}p | provider=${oldBook.image_source?.provider || "?"}`);
  for (const pg of oldPages.slice(0, 2)) {
    console.log(`    p${pg.page_number}: ${(pg.photo_original || pg.photo || "?").substring(0, 120)}`);
  }

  const same = newId && oldId && newId === oldId;
  console.log(`  VERDICT: ${same ? "SAME SCAN - true duplicate" : `Different scans (${newId.substring(0, 35)} vs ${oldId.substring(0, 35)})`}`);
  console.log();
}

await client.close();
