import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);

async function main() {
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  const queries = [
    { title: /Sergius.*Capitis|Capitis.*Caput/i },
    { title: /More.*Utopia.*Burnet|Utopia.*1685/i },
    { title: /Ramon Llull.*Ars Inv|Ars Inv.*Ramon Llull|Llull.*Ars Inventiva/i },
  ];

  // Also try broader matches
  const broadQueries = [
    { title: /Sergius/i },
    { title: /Utopia.*Burnet|Burnet.*Utopia/i },
    { title: /Ars Invent/i },
  ];

  const projection = {
    title: 1,
    id: 1,
    _id: 1,
    thumbnail: 1,
    thumbnail_source: 1,
    pipeline_status: 1,
    pages_count: 1,
    pages_ocr: 1,
    pages_translated: 1,
    hidden: 1,
    visible: 1,
    published: 1,
    status: 1,
    deleted: 1,
    ia_identifier: 1,
    slug: 1,
    author: 1,
    year: 1,
    cover_page: 1,
    image_source: 1,
  };

  console.log('=== CHECKING BOOKS FOR BAD COVERS ===\n');

  for (let i = 0; i < queries.length; i++) {
    const results = await books.find(queries[i], { projection }).limit(5).toArray();

    // Fall back to broad query if no results
    const finalResults = results.length > 0 ? results :
      await books.find(broadQueries[i], { projection }).limit(5).toArray();

    if (finalResults.length === 0) {
      console.log(`No results for query: ${JSON.stringify(queries[i])}\n`);
      continue;
    }

    for (const book of finalResults) {
      console.log(`--- BOOK ---`);
      console.log(`Title: ${book.title}`);
      console.log(`Author: ${book.author || '(none)'}`);
      console.log(`Year: ${book.year || '(none)'}`);
      console.log(`id: ${book.id}`);
      console.log(`_id: ${book._id}`);
      console.log(`slug: ${book.slug || '(none)'}`);
      console.log(`thumbnail: ${book.thumbnail || '(none)'}`);
      console.log(`thumbnail_source: ${book.thumbnail_source || '(none)'}`);
      console.log(`cover_page: ${book.cover_page ?? '(none)'}`);
      console.log(`image_source: ${JSON.stringify(book.image_source) || '(none)'}`);
      console.log(`pipeline_status: ${book.pipeline_status || '(none)'}`);
      console.log(`pages_count: ${book.pages_count ?? '(none)'}`);
      console.log(`pages_ocr: ${book.pages_ocr ?? '(none)'}`);
      console.log(`pages_translated: ${book.pages_translated ?? '(none)'}`);

      // Visibility fields
      console.log(`hidden: ${book.hidden ?? '(field not present)'}`);
      console.log(`visible: ${book.visible ?? '(field not present)'}`);
      console.log(`published: ${book.published ?? '(field not present)'}`);
      console.log(`status: ${book.status ?? '(field not present)'}`);
      console.log(`deleted: ${book.deleted ?? '(field not present)'}`);

      // Parse IA page number from thumbnail URL
      if (book.thumbnail) {
        const pageMatch = book.thumbnail.match(/[?&](?:seq|page|n)=(\d+)/i) ||
                          book.thumbnail.match(/\/n(\d+)/);
        if (pageMatch) {
          console.log(`thumbnail page N: ${pageMatch[1]}`);
        } else {
          console.log(`thumbnail page N: (not an IA page URL or no page param)`);
        }
      }

      console.log('');
    }
  }

  // Check the Book schema for visibility fields by sampling a book that IS visible
  console.log('=== SCHEMA VISIBILITY FIELDS — sampling 3 visible books ===\n');
  const sample = await books.find({}).limit(3).project(projection).toArray();
  for (const s of sample) {
    console.log(`Title: ${s.title?.substring(0, 60)}`);
    console.log(`  hidden: ${s.hidden ?? '(absent)'}, visible: ${s.visible ?? '(absent)'}, published: ${s.published ?? '(absent)'}, status: ${s.status ?? '(absent)'}, deleted: ${s.deleted ?? '(absent)'}`);
  }

  // Check how many books have each visibility field
  console.log('\n=== VISIBILITY FIELD COVERAGE ===');
  const total = await books.countDocuments({});
  const hasHidden = await books.countDocuments({ hidden: { $exists: true } });
  const hiddenTrue = await books.countDocuments({ hidden: true });
  const hasPublished = await books.countDocuments({ published: { $exists: true } });
  const hasStatus = await books.countDocuments({ status: { $exists: true } });
  const hasDeleted = await books.countDocuments({ deleted: { $exists: true } });
  console.log(`Total books: ${total}`);
  console.log(`Books with 'hidden' field: ${hasHidden} (hidden=true: ${hiddenTrue})`);
  console.log(`Books with 'published' field: ${hasPublished}`);
  console.log(`Books with 'status' field: ${hasStatus}`);
  console.log(`Books with 'deleted' field: ${hasDeleted}`);

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
