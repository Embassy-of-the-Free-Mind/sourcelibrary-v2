import { MongoClient, ObjectId } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);

async function main() {
  await client.connect();
  const db = client.db('bookstore');

  // 1. Dee - Monas Hieroglyphica p.13 (the Hero/steam engine reference)
  console.log('========================================');
  console.log('1. DEE - MONAS HIEROGLYPHICA (Hero ref)');
  console.log('========================================');
  // Get book first to find the actual id format
  const deeBook = await db.collection('books').findOne(
    { _id: new ObjectId('69520571ab34727b1f042c78') },
    { projection: { id: 1, title: 1 } }
  );
  console.log('Book:', deeBook?.title, '| id:', deeBook?.id);
  // Get the specific page with Hero ref
  const deePages = await db.collection('pages').find(
    { book_id: deeBook.id, 'translation.data': { $regex: 'Hero|steam|automat', $options: 'i' } },
    { projection: { page_number: 1, 'translation.data': 1 } }
  ).sort({ page_number: 1 }).toArray();
  for (const p of deePages) {
    console.log('\n--- p.' + p.page_number + ' ---');
    console.log(p.translation.data.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').slice(0, 1200));
  }

  // 2. Porta - Magia Naturalis Hero references
  console.log('\n\n========================================');
  console.log('2. PORTA - MAGIA NATURALIS (Hero refs)');
  console.log('========================================');
  const portaBook = await db.collection('books').findOne(
    { _id: new ObjectId('694fe5f9f844de8615417df4') },
    { projection: { id: 1, title: 1 } }
  );
  console.log('Book:', portaBook?.title, '| id:', portaBook?.id);
  const portaPages = await db.collection('pages').find(
    { book_id: portaBook.id, 'translation.data': { $regex: 'Hero|Heron|pneumat', $options: 'i' } },
    { projection: { page_number: 1, 'translation.data': 1 } }
  ).sort({ page_number: 1 }).toArray();
  console.log('Found ' + portaPages.length + ' pages');
  for (const p of portaPages) {
    const text = p.translation.data.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n');
    const idx = text.toLowerCase().search(/hero|heron|pneumat/i);
    console.log('\n--- p.' + p.page_number + ' ---');
    console.log(text.slice(Math.max(0, idx - 200), idx + 600));
  }

  // 3. Poliziano - Miscellaneorum p.183
  console.log('\n\n========================================');
  console.log('3. POLIZIANO - MISCELLANEORUM (Hero ref)');
  console.log('========================================');
  const polBook = await db.collection('books').findOne(
    { _id: new ObjectId('694fe5fcf844de8615417e08') },
    { projection: { id: 1, title: 1 } }
  );
  console.log('Book:', polBook?.title, '| id:', polBook?.id);
  const polPages = await db.collection('pages').find(
    { book_id: polBook.id, 'translation.data': { $regex: 'Hero|pneumat', $options: 'i' } },
    { projection: { page_number: 1, 'translation.data': 1 } }
  ).sort({ page_number: 1 }).toArray();
  for (const p of polPages) {
    console.log('\n--- p.' + p.page_number + ' ---');
    console.log(p.translation.data.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').slice(0, 1000));
  }

  // 4. Silentium post clamores (Rosicrucian) - the automata pages
  console.log('\n\n========================================');
  console.log('4. SILENTIUM POST CLAMORES (automata)');
  console.log('========================================');
  const silBook = await db.collection('books').findOne(
    { _id: new ObjectId('690c3840e0787282ad59386e') },
    { projection: { id: 1, title: 1 } }
  );
  // Search more broadly
  const silPages = await db.collection('pages').find(
    { book_id: silBook.id, 'translation.data': { $regex: 'automat|Automaten|machine|Archimedes|mechani|pneumat|Talus|Archytas', $options: 'i' } },
    { projection: { page_number: 1, 'translation.data': 1 } }
  ).sort({ page_number: 1 }).toArray();
  console.log('Found ' + silPages.length + ' pages');
  for (const p of silPages.slice(0, 5)) {
    console.log('\n--- p.' + p.page_number + ' ---');
    console.log(p.translation.data.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').slice(0, 800));
  }

  // 5. Agrippa - De Occulta Philosophia automata/mechanical passages
  console.log('\n\n========================================');
  console.log('5. AGRIPPA - DE OCCULTA PHILOSOPHIA');
  console.log('========================================');
  const agrBook = await db.collection('books').findOne(
    { _id: new ObjectId('694bf8d2343422769f237558') },
    { projection: { id: 1, title: 1 } }
  );
  const agrPages = await db.collection('pages').find(
    { book_id: agrBook.id, 'translation.data': { $regex: 'automat|Archimedes|mechani|pneumat|Hero|Albertus', $options: 'i' } },
    { projection: { page_number: 1, 'translation.data': 1 } }
  ).sort({ page_number: 1 }).limit(5).toArray();
  console.log('Found pages');
  for (const p of agrPages) {
    const text = p.translation.data.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n');
    const idx = text.toLowerCase().search(/automat|archimedes|mechani|hero|albertus/i);
    console.log('\n--- p.' + p.page_number + ' ---');
    console.log(text.slice(Math.max(0, idx - 200), idx + 600));
  }

  // 6. Rosicrucian - Die Lehren der Rosenkreuzer (steam engine ref!)
  console.log('\n\n========================================');
  console.log('6. DIE LEHREN DER ROSENKREUZER (steam)');
  console.log('========================================');
  const rosBook = await db.collection('books').findOne(
    { _id: new ObjectId('690c27e6e0787282ad593282') },
    { projection: { id: 1, title: 1 } }
  );
  const rosPages = await db.collection('pages').find(
    { book_id: rosBook.id, 'translation.data': { $regex: 'steam|engine|chariot|Elijah|machine|mechani', $options: 'i' } },
    { projection: { page_number: 1, 'translation.data': 1 } }
  ).sort({ page_number: 1 }).limit(5).toArray();
  for (const p of rosPages) {
    console.log('\n--- p.' + p.page_number + ' ---');
    console.log(p.translation.data.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').slice(0, 800));
  }

  // 7. Kircher - Oedipus Aegyptiacus (mechanics pages)
  console.log('\n\n========================================');
  console.log('7. KIRCHER - OEDIPUS AEGYPTIACUS');
  console.log('========================================');
  const kirBook = await db.collection('books').findOne(
    { _id: new ObjectId('694f4a642bef28522211754c') },
    { projection: { id: 1, title: 1 } }
  );
  const kirPages = await db.collection('pages').find(
    { book_id: kirBook.id, 'translation.data': { $regex: 'Hero|mechani|pneumat|screw|automat|hydraul', $options: 'i' } },
    { projection: { page_number: 1, 'translation.data': 1 } }
  ).sort({ page_number: 1 }).limit(5).toArray();
  for (const p of kirPages) {
    const text = p.translation.data.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n');
    console.log('\n--- p.' + p.page_number + ' ---');
    console.log(text.slice(0, 800));
  }

  // 8. Musurgia Universalis - water organ
  console.log('\n\n========================================');
  console.log('8. KIRCHER - MUSURGIA UNIVERSALIS');
  console.log('========================================');
  const musBook = await db.collection('books').findOne(
    { _id: new ObjectId('694f4a652bef28522211754e') },
    { projection: { id: 1, title: 1 } }
  );
  const musPages = await db.collection('pages').find(
    { book_id: musBook.id, 'translation.data': { $regex: 'water organ|hydraul|automat|Hero|pneumat', $options: 'i' } },
    { projection: { page_number: 1, 'translation.data': 1 } }
  ).sort({ page_number: 1 }).limit(5).toArray();
  for (const p of musPages) {
    const text = p.translation.data.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n');
    console.log('\n--- p.' + p.page_number + ' ---');
    console.log(text.slice(0, 600));
  }

  // 9. Corpus Hermeticum - specifically the Hermetica part (after Hero)
  console.log('\n\n========================================');
  console.log('9. CORPUS HERMETICUM - Hermetica section');
  console.log('========================================');
  const chPages = await db.collection('pages').find(
    { book_id: '695230c6ab34727b1f044784', page_number: { $gte: 150, $lte: 170 } },
    { projection: { page_number: 1, 'translation.data': 1 } }
  ).sort({ page_number: 1 }).toArray();
  for (const p of chPages.slice(0, 5)) {
    console.log('\n--- p.' + p.page_number + ' ---');
    console.log(p.translation.data?.replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').slice(0, 500));
  }

  await client.close();
}
main().catch(e => { console.error(e); process.exit(1); });
