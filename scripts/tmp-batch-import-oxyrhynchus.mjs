import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.production.local' });

const API_BASE = 'https://sourcelibrary.org';
const ADMIN_KEY = process.env.ADMIN_API_KEY || process.env.CRON_SECRET;

const oxyrhynchusVolumes = [
  { id: 'oxyrhynchuspapyr0001unse', vol: 1 },
  { id: 'oxyrhynchuspapyrunse_68', vol: 4 },
  { id: 'oxyrhynchuspapyrunse_69', vol: 5 },
  { id: 'oxyrhynchuspapyrunse_71', vol: 7 },
  { id: 'oxyrhynchuspapyrunse_72', vol: 8 },
  { id: 'oxyrhynchuspapyr0009unse', vol: 9 },
  { id: 'oxyrhynchuspapyrunse_75', vol: 10 },
  { id: 'oxyrhynchuspapyr0011unse', vol: 11 },
  { id: 'oxyrhynchuspapyrunse_77', vol: 12 },
  { id: 'oxyrhynchuspapyrunse_76', vol: 13 },
  { id: 'oxyrhynchuspapyrunse_79', vol: 15 },
  { id: 'oxyrhynchuspapyr0021unse', vol: 21 },
  { id: 'oxyrhynchuspapyr0038unse', vol: 38 },
  { id: 'oxyrhynchuspapyr0040unse', vol: 40 },
  { id: 'oxyrhynchuspapyr0043unse', vol: 43 },
  { id: 'oxyrhynchuspapyr0049unse', vol: 49 },
  { id: 'oxyrhynchuspapyr0055unse', vol: 55 },
  { id: 'oxyrhynchuspapyr0057unse', vol: 57 },
  { id: 'oxyrhynchuspapyr0058unse', vol: 58 },
  { id: 'oxyrhynchuspapyr0060unse', vol: 60 },
  { id: 'oxyrhynchuspapyr0062unse', vol: 62 },
  { id: 'oxyrhynchuspapyr0066unse', vol: 66 },
  { id: 'oxyrhynchuspapyr0068unse', vol: 68 },
  { id: 'oxyrhynchuspapyr0069unse', vol: 69 },
  { id: 'oxyrhynchuspapyr0070unse', vol: 70 },
  { id: 'oxyrhynchuspapyr0073unse', vol: 73 },
];

const otherImports = [
  { id: 'cu31924028975923', title: 'The Fragments of Empedocles', author: 'Empedocles; trans. William Ellery Leonard', collection: 'ancient-papyri' },
  { id: 'poetarumphilosop00diel', title: 'Poetarum Philosophorum Fragmenta', author: 'Hermann Diels (ed.)', collection: 'ancient-papyri' },
  { id: 'the-facsimile-edition-of-the-nag-hammadi-codices-codex-i-by-farid-mehrez-et-al.-eds-z-lib.org', title: 'Facsimile Edition of the Nag Hammadi Codices: Codex I', author: 'Mehrez Farid et al. (eds.)', collection: 'great-manuscripts' },
  { id: 'the-facsimile-edition-of-the-nag-hammadi-codices-codex-ii-by-farid-mehrez-et-al.-eds-z-lib.org', title: 'Facsimile Edition of the Nag Hammadi Codices: Codex II', author: 'Mehrez Farid et al. (eds.)', collection: 'great-manuscripts' },
];

function getEditor(vol) {
  if (vol <= 17) return 'Bernard P. Grenfell & Arthur S. Hunt';
  if (vol <= 25) return 'Bernard P. Grenfell, Arthur S. Hunt & Harold I. Bell';
  if (vol <= 36) return 'Edgar Lobel et al.';
  return 'Egypt Exploration Society';
}

async function importBook({ ia_identifier, title, author }) {
  const resp = await fetch(`${API_BASE}/api/import/ia`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ADMIN_KEY}` },
    body: JSON.stringify({ ia_identifier, title, author })
  });
  return resp.json();
}

async function main() {
  const imported = [];

  console.log(`=== Importing ${oxyrhynchusVolumes.length} Oxyrhynchus volumes ===\n`);
  for (let i = 0; i < oxyrhynchusVolumes.length; i++) {
    const { id, vol } = oxyrhynchusVolumes[i];
    const title = `The Oxyrhynchus Papyri, Part ${vol}`;
    const author = getEditor(vol);
    console.log(`[${i + 1}/${oxyrhynchusVolumes.length}] ${title} (${id})...`);
    try {
      const data = await importBook({ ia_identifier: id, title, author });
      if (data.error) {
        console.log(`  ERROR: ${data.error}`);
        imported.push({ id, status: 'error', msg: data.error });
      } else {
        const bookId = data.book?.id || data.id;
        console.log(`  OK: ${bookId}`);
        imported.push({ id, status: 'ok', bookId, collection: 'ancient-papyri' });
      }
    } catch (e) {
      console.log(`  ERROR: ${e.message}`);
      imported.push({ id, status: 'error', msg: e.message });
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`\n=== Importing ${otherImports.length} additional works ===\n`);
  for (let i = 0; i < otherImports.length; i++) {
    const item = otherImports[i];
    console.log(`[${i + 1}/${otherImports.length}] ${item.title} (${item.id})...`);
    try {
      const data = await importBook({ ia_identifier: item.id, title: item.title, author: item.author });
      if (data.error) {
        console.log(`  ERROR: ${data.error}`);
        imported.push({ ...item, status: 'error', msg: data.error });
      } else {
        const bookId = data.book?.id || data.id;
        console.log(`  OK: ${bookId}`);
        imported.push({ ...item, status: 'ok', bookId, collection: item.collection });
      }
    } catch (e) {
      console.log(`  ERROR: ${e.message}`);
      imported.push({ ...item, status: 'error', msg: e.message });
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  // Tag imports into collections
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const papyriIds = imported.filter(r => r.status === 'ok' && r.collection !== 'great-manuscripts').map(r => r.bookId);
  const msIds = imported.filter(r => r.status === 'ok' && r.collection === 'great-manuscripts').map(r => r.bookId);

  if (papyriIds.length) {
    const r = await db.collection('books').updateMany(
      { $or: [{ id: { $in: papyriIds } }, { _id: { $in: papyriIds } }] },
      { $addToSet: { collections: 'ancient-papyri' } }
    );
    console.log(`\nTagged ${r.modifiedCount} books into ancient-papyri`);
  }
  if (msIds.length) {
    const r = await db.collection('books').updateMany(
      { $or: [{ id: { $in: msIds } }, { _id: { $in: msIds } }] },
      { $addToSet: { collections: 'great-manuscripts' } }
    );
    console.log(`Tagged ${r.modifiedCount} books into great-manuscripts`);
  }

  for (const slug of ['ancient-papyri', 'great-manuscripts']) {
    const count = await db.collection('books').countDocuments({
      collections: slug, visible: true, pages_count: { $gt: 0 }
    });
    await db.collection('collections').updateOne(
      { slug },
      { $set: { book_count: count, updated_at: new Date() } }
    );
    console.log(`${slug}: ${count} books`);
  }

  await client.close();

  console.log('\n=== SUMMARY ===');
  const ok = imported.filter(r => r.status === 'ok');
  const err = imported.filter(r => r.status === 'error');
  console.log(`OK: ${ok.length}`);
  console.log(`Errors: ${err.length}`);
  err.forEach(r => console.log(`  FAIL: ${r.id} - ${r.msg}`));
}

main().catch(console.error);
