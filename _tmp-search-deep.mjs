import { MongoClient, ObjectId } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);

async function main() {
  await client.connect();
  const db = client.db('bookstore');

  // 1. Corpus Hermeticum (Greek manuscript) - the one that contains Hero's Pneumatica!
  console.log('========================================');
  console.log('1. CORPUS HERMETICUM + HERO PNEUMATICA');
  console.log('========================================');
  const corpusBook = await db.collection('books').findOne(
    { _id: new ObjectId('695230c6ab34727b1f044784') },
    { projection: { title: 1, author: 1, published: 1, id: 1, pages_count: 1, pages_translated: 1, language: 1, 'reading_summary.overview': 1 } }
  );
  console.log('Title:', corpusBook.title);
  console.log('Author:', corpusBook.author);
  console.log('Published:', corpusBook.published);
  console.log('Language:', corpusBook.language);
  console.log('Pages:', corpusBook.pages_count, '/ Translated:', corpusBook.pages_translated);
  console.log('\nSummary:', corpusBook.reading_summary?.overview?.slice(0, 800));

  // Get Hero-related pages from this manuscript
  const heroPages = await db.collection('pages').find(
    { book_id: corpusBook.id, 'translation.data': { $regex: 'Hero|steam|aeolipile|pneumat|automat|theorem|siphon|fountain', $options: 'i' } },
    { projection: { page_number: 1, 'translation.data': 1 } }
  ).sort({ page_number: 1 }).toArray();
  console.log('\nHero/engineering-related pages (' + heroPages.length + '):');
  for (const p of heroPages) {
    const text = p.translation.data.replace(/<[^>]+>/g, '').replace(/\n+/g, ' ').trim();
    console.log('\n  --- p.' + p.page_number + ' ---');
    console.log('  ' + text.slice(0, 500));
  }

  // 2. Monas Hieroglyphica - Dee's reference to Hero
  console.log('\n\n========================================');
  console.log('2. MONAS HIEROGLYPHICA (Dee) - Hero ref');
  console.log('========================================');
  const deePage = await db.collection('pages').findOne(
    { book_id: '69520571ab34727b1f042c78', 'translation.data': { $regex: 'Hero', $options: 'i' } },
    { projection: { page_number: 1, 'translation.data': 1 } }
  );
  if (deePage) {
    console.log('Page', deePage.page_number + ':');
    console.log(deePage.translation.data.replace(/<[^>]+>/g, '').slice(0, 800));
  }

  // 3. Magia Naturalis - Porta's Hero references
  console.log('\n\n========================================');
  console.log('3. MAGIA NATURALIS (Porta) - Hero refs');
  console.log('========================================');
  const portaPages = await db.collection('pages').find(
    { book_id: '694fe5f9f844de8615417df4', 'translation.data': { $regex: 'Hero', $options: 'i' } },
    { projection: { page_number: 1, 'translation.data': 1 } }
  ).sort({ page_number: 1 }).toArray();
  console.log('Hero references in Magia Naturalis (' + portaPages.length + ' pages):');
  for (const p of portaPages) {
    const text = p.translation.data.replace(/<[^>]+>/g, '').replace(/\n+/g, ' ').trim();
    const idx = text.toLowerCase().indexOf('hero');
    const ctx = text.slice(Math.max(0, idx - 150), idx + 300);
    console.log('\n  --- p.' + p.page_number + ' ---');
    console.log('  ...' + ctx.slice(0, 500) + '...');
  }

  // 4. De architectura (Vitruvius) - Ctesibius/Hero/engineering
  console.log('\n\n========================================');
  console.log('4. DE ARCHITECTURA (Vitruvius)');
  console.log('========================================');
  const vitruviusPages = await db.collection('pages').find(
    { book_id: '6949af986ef4a68b726b7fa9', 'translation.data': { $regex: 'Ctesibius|Hero|aeolipile|hydraul|pneumat|organ', $options: 'i' } },
    { projection: { page_number: 1, 'translation.data': 1 } }
  ).sort({ page_number: 1 }).toArray();
  console.log('Engineering pages in Vitruvius (' + vitruviusPages.length + ' pages):');
  for (const p of vitruviusPages.slice(0, 8)) {
    const text = p.translation.data.replace(/<[^>]+>/g, '').replace(/\n+/g, ' ').trim();
    console.log('\n  --- p.' + p.page_number + ' ---');
    console.log('  ' + text.slice(0, 400));
  }

  // 5. Poliphile - automaton/fountain references
  console.log('\n\n========================================');
  console.log('5. HYPNEROTOMACHIA POLIPHILI - engineering');
  console.log('========================================');
  const poliphilePages = await db.collection('pages').find(
    { book_id: '69099eb5cf28baa1b4caeb38', 'translation.data': { $regex: 'automaton|fountain|hydraul|mechani|engine', $options: 'i' } },
    { projection: { page_number: 1, 'translation.data': 1 } }
  ).sort({ page_number: 1 }).limit(5).toArray();
  console.log('Engineering pages in Poliphile (' + poliphilePages.length + ' pages):');
  for (const p of poliphilePages) {
    const text = p.translation.data.replace(/<[^>]+>/g, '').replace(/\n+/g, ' ').trim();
    console.log('\n  --- p.' + p.page_number + ' ---');
    console.log('  ' + text.slice(0, 400));
  }

  // 6. Oedipus Aegyptiacus - Kircher's engineering
  console.log('\n\n========================================');
  console.log('6. OEDIPUS AEGYPTIACUS (Kircher) p.329');
  console.log('========================================');
  const kircherPage = await db.collection('pages').findOne(
    { book_id: '694f4a642bef28522211754c', page_number: 329 },
    { projection: { page_number: 1, 'translation.data': 1 } }
  );
  if (kircherPage) {
    console.log(kircherPage.translation.data?.replace(/<[^>]+>/g, '').replace(/\n+/g, ' ').trim().slice(0, 800));
  }

  // 7. Miscellaneorum - Poliziano's Hero reference
  console.log('\n\n========================================');
  console.log('7. MISCELLANEORUM (Poliziano)');
  console.log('========================================');
  const polizianoPage = await db.collection('pages').findOne(
    { book_id: '694fe5fcf844de8615417e08', page_number: 183 },
    { projection: { page_number: 1, 'translation.data': 1 } }
  );
  if (polizianoPage) {
    console.log(polizianoPage.translation.data?.replace(/<[^>]+>/g, '').replace(/\n+/g, ' ').trim().slice(0, 800));
  }

  // 8. Get the Ctesibius Belopoeeca pages
  console.log('\n\n========================================');
  console.log('8. BELOPOEECA (Ctesibius/Hero/Baldi 1616)');
  console.log('========================================');
  const beloBook = await db.collection('books').findOne(
    { _id: new ObjectId('695aa9adbe4023bd34bd6d24') },
    { projection: { title: 1, id: 1, 'reading_summary.overview': 1 } }
  );
  console.log('Title:', beloBook?.title);
  console.log('Summary:', beloBook?.reading_summary?.overview?.slice(0, 500));
  const beloPages = await db.collection('pages').find(
    { book_id: beloBook?.id },
    { projection: { page_number: 1, 'translation.data': 1 } }
  ).sort({ page_number: 1 }).limit(5).toArray();
  for (const p of beloPages) {
    console.log('\n  --- p.' + p.page_number + ' ---');
    console.log('  ' + (p.translation?.data || '').replace(/<[^>]+>/g, '').replace(/\n+/g, ' ').trim().slice(0, 400));
  }

  // 9. Silentium post clamores - automata discussion
  console.log('\n\n========================================');
  console.log('9. SILENTIUM POST CLAMORES (Rosicrucian)');
  console.log('========================================');
  const silPages = await db.collection('pages').find(
    { book_id: '690c3840e0787282ad59386e', 'translation.data': { $regex: 'automat|mechani|pneumat|Hero|Archimedes', $options: 'i' } },
    { projection: { page_number: 1, 'translation.data': 1 } }
  ).sort({ page_number: 1 }).toArray();
  console.log('Mechanical arts pages (' + silPages.length + '):');
  for (const p of silPages) {
    const text = p.translation.data.replace(/<[^>]+>/g, '').replace(/\n+/g, ' ').trim();
    console.log('\n  --- p.' + p.page_number + ' ---');
    console.log('  ' + text.slice(0, 500));
  }

  // 10. De Occulta Philosophia - Agrippa's automata/Hero
  console.log('\n\n========================================');
  console.log('10. DE OCCULTA PHILOSOPHIA (Agrippa)');
  console.log('========================================');
  const agrippaPages = await db.collection('pages').find(
    { book_id: '694bf8d2343422769f237558', 'translation.data': { $regex: 'automat|Hero|Archimedes|pneumat|mechani', $options: 'i' } },
    { projection: { page_number: 1, 'translation.data': 1 } }
  ).sort({ page_number: 1 }).limit(5).toArray();
  console.log('Mechanical references (' + agrippaPages.length + ' pages):');
  for (const p of agrippaPages) {
    const text = p.translation.data.replace(/<[^>]+>/g, '').replace(/\n+/g, ' ').trim();
    console.log('\n  --- p.' + p.page_number + ' ---');
    console.log('  ' + text.slice(0, 500));
  }

  await client.close();
}
main().catch(e => { console.error(e); process.exit(1); });
