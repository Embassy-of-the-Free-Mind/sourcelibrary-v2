import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);

async function main() {
  await client.connect();
  const db = client.db('bookstore');

  const searchTerms = ['pneumatic', 'hydraulic', 'automaton', 'automata', 'water organ', 'steam engine', 'siphon', 'vacuum'];
  for (const term of searchTerms) {
    const results = await db.collection('pages').find(
      { 'translation.data': { $regex: term, $options: 'i' } },
      { projection: { book_id: 1, page_number: 1, 'translation.data': 1 } }
    ).limit(5).toArray();
    if (results.length > 0) {
      console.log('\n=== "' + term + '" in translations (' + results.length + ' hits shown) ===');
      for (const r of results) {
        const text = r.translation.data;
        const idx = text.toLowerCase().indexOf(term.toLowerCase());
        const ctx = text.slice(Math.max(0, idx - 100), idx + term.length + 150).replace(/\n/g, ' ').replace(/<[^>]+>/g, '').trim();
        const book = await db.collection('books').findOne({ id: r.book_id }, { projection: { title: 1, _id: 1, id: 1 } });
        console.log('  [' + (book?._id || '???') + '] ' + (book?.title || r.book_id).slice(0, 60) + ' p.' + r.page_number);
        console.log('    ...' + ctx + '...');
      }
    } else {
      console.log('\n=== "' + term + '" in translations (0 results) ===');
    }
  }

  // Also search for Hero-specific content
  const heroTerms = ['Hero of Alexandria', 'Heron', 'aeolipile', 'Ctesibius', 'Spiritalia'];
  for (const term of heroTerms) {
    const results = await db.collection('pages').find(
      { $or: [
        { 'translation.data': { $regex: term, $options: 'i' } },
        { 'ocr.data': { $regex: term, $options: 'i' } }
      ]},
      { projection: { book_id: 1, page_number: 1, 'translation.data': 1, 'ocr.data': 1 } }
    ).limit(5).toArray();
    if (results.length > 0) {
      console.log('\n=== "' + term + '" in page text (' + results.length + ' hits) ===');
      for (const r of results) {
        const text = r.translation?.data || r.ocr?.data || '';
        const idx = text.toLowerCase().indexOf(term.toLowerCase());
        const ctx = text.slice(Math.max(0, idx - 100), idx + term.length + 150).replace(/\n/g, ' ').replace(/<[^>]+>/g, '').trim();
        const book = await db.collection('books').findOne({ id: r.book_id }, { projection: { title: 1, _id: 1 } });
        console.log('  [' + (book?._id || '???') + '] ' + (book?.title || r.book_id).slice(0, 60) + ' p.' + r.page_number);
        console.log('    ...' + ctx + '...');
      }
    } else {
      console.log('\n=== "' + term + '" in page text (0 results) ===');
    }
  }

  await client.close();
}
main().catch(e => { console.error(e); process.exit(1); });
