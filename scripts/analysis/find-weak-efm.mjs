import { MongoClient } from 'mongodb';

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // All visible EFM books
  const efmBooks = await db.collection('books').find({
    hidden: { $ne: true },
    'image_source.provider': 'efm'
  }).project({
    id: 1, title: 1, author: 1, language: 1, year: 1,
    pages_count: 1, pages_ocr: 1, pages_translated: 1,
    read_count: 1, 'pipeline_auto.status': 1,
    categories: 1, reading_summary: 1,
  }).sort({ read_count: 1, pages_count: 1 }).toArray();

  console.log('Total visible EFM books:', efmBooks.length);
  console.log('');

  // Categorize weak candidates
  const weak = {
    tiny: [],        // < 15 pages (fragments, pamphlets)
    noReads: [],     // 0 reads
    legal: [],       // Legal/administrative documents
    duplicates: [],  // Potential duplicates (similar titles)
    generic: [],     // Generic/unclear titles
  };

  // Legal/administrative patterns
  const legalPatterns = [
    /\bMandat\b/i, /\bEdikt\b/i, /\bVerordnung\b/i, /\bPatent\b/i,
    /\bBescheid\b/i, /\bBefeh?l\b/i, /\bCopey\b/i, /\bAbdruck\b/i,
    /\bSchreiben.*an\b/i, /\bSendschreiben\b/i, /\bResponsum\b/i,
    /\bAntwort.*Schreiben/i, /\bRecès\b/i, /\bOrdonnance\b/i,
    /\bPlacca?at\b/i, /\bDecree\b/i, /\bBericht.*Prussian/i,
    /\bKurtze.*Bericht\b/i, /\bGründtlicher.*Bericht\b/i,
    /\bI\.N\.D\.N\.I\.C\b/, /\bJudicium\b.*\b(auff|theologicum)\b/i,
    /\bQuaestiones selectiores\b/i, /\bIllustr.*quaestion/i,
    /\bHunc quaestion/i, /\bDisputat/i,
    /\bSchutzschrift\b/i, /\bVerantwort/i, /\bStreitschrift/i,
    /\bAppellation\b/i, /\bInhibition\b/i,
    /\bVor rede\b/i, /\bVorbericht\b/i,
  ];

  // Pamphlet/polemic patterns (low value for esoteric collection)
  const polemicPatterns = [
    /\bWider\b.*\b(die|den|das)\b/i, /\bGegen\b.*\b(die|den|das)\b/i,
    /\bWarnung\b/i, /\bVermahnung\b/i,
    /\bKlage\b/i, /\bBeschwerd/i,
    /\bEntdeckung\b.*\b(Betrug|falsch)/i,
    /\bWiderlegung\b/i, /\bRefutation\b/i,
    /\bAntwort\b.*\bauf\b/i,
  ];

  for (const b of efmBooks) {
    const title = b.title || '';
    const pages = b.pages_count || 0;
    const reads = b.read_count || 0;

    // Tiny fragments
    if (pages <= 15 && pages > 0) {
      weak.tiny.push(b);
    }

    // Legal/administrative
    if (legalPatterns.some(p => p.test(title))) {
      weak.legal.push(b);
    }

    // Polemics
    if (polemicPatterns.some(p => p.test(title))) {
      weak.generic.push(b);
    }
  }

  // Find zero-read books that aren't otherwise categorized
  const categorized = new Set([
    ...weak.tiny.map(b => b.id),
    ...weak.legal.map(b => b.id),
    ...weak.generic.map(b => b.id),
  ]);

  for (const b of efmBooks) {
    if ((b.read_count || 0) === 0 && !categorized.has(b.id)) {
      weak.noReads.push(b);
    }
  }

  // Find potential duplicates (same author + similar title start)
  const titleMap = {};
  for (const b of efmBooks) {
    const key = ((b.author || 'anon') + '::' + (b.title || '').substring(0, 30)).toLowerCase();
    if (!titleMap[key]) titleMap[key] = [];
    titleMap[key].push(b);
  }
  for (const [key, books] of Object.entries(titleMap)) {
    if (books.length > 1) {
      weak.duplicates.push(...books);
    }
  }

  // Print results
  function printBooks(books, limit = 30) {
    const sorted = books.sort((a, b) => (a.read_count || 0) - (b.read_count || 0));
    for (const b of sorted.slice(0, limit)) {
      const status = (b.pipeline_auto?.status || '').substring(0, 10);
      console.log(
        '  ' + (b.title || '').substring(0, 58).padEnd(60) +
        (b.author || '').substring(0, 22).padEnd(24) +
        String(b.year || '').padStart(5) + ' ' +
        String(b.pages_count || 0).padStart(4) + 'p ' +
        String(b.read_count || 0).padStart(2) + 'r ' +
        status
      );
    }
  }

  console.log('=== TINY FRAGMENTS (<= 15 pages) — ' + weak.tiny.length + ' books ===\n');
  printBooks(weak.tiny, 50);

  console.log('\n=== LEGAL/ADMINISTRATIVE DOCUMENTS — ' + weak.legal.length + ' books ===\n');
  printBooks(weak.legal, 50);

  console.log('\n=== POLEMICS/REBUTTALS — ' + weak.generic.length + ' books ===\n');
  printBooks(weak.generic, 30);

  console.log('\n=== POTENTIAL DUPLICATES — ' + weak.duplicates.length + ' books ===\n');
  const dupeGroups = {};
  for (const b of weak.duplicates) {
    const key = ((b.author || 'anon') + '::' + (b.title || '').substring(0, 30)).toLowerCase();
    if (!dupeGroups[key]) dupeGroups[key] = [];
    dupeGroups[key].push(b);
  }
  for (const [key, books] of Object.entries(dupeGroups)) {
    for (const b of books) {
      console.log(
        '  ' + (b.title || '').substring(0, 58).padEnd(60) +
        String(b.year || '').padStart(5) + ' ' +
        String(b.pages_count || 0).padStart(4) + 'p ' +
        String(b.read_count || 0).padStart(2) + 'r'
      );
    }
    console.log('');
  }

  // Summary
  const allWeak = new Set([
    ...weak.tiny.map(b => b.id),
    ...weak.legal.map(b => b.id),
    ...weak.generic.map(b => b.id),
  ]);

  console.log('\n=== SUMMARY ===');
  console.log('Tiny fragments:', weak.tiny.length);
  console.log('Legal/admin:', weak.legal.length);
  console.log('Polemics:', weak.generic.length);
  console.log('Potential duplicates:', Object.keys(dupeGroups).length, 'groups,', weak.duplicates.length, 'books');
  console.log('Zero reads (not otherwise flagged):', weak.noReads.length);
  console.log('');
  console.log('Unique weak candidates:', allWeak.size);
  console.log('(These are the ones most suitable to hide in favor of partner library gems)');

  // Also show: read count distribution
  console.log('\n=== READ COUNT DISTRIBUTION (all visible EFM) ===');
  const readBuckets = { '0 reads': 0, '1-2 reads': 0, '3-5 reads': 0, '6-10 reads': 0, '11+ reads': 0 };
  for (const b of efmBooks) {
    const r = b.read_count || 0;
    if (r === 0) readBuckets['0 reads']++;
    else if (r <= 2) readBuckets['1-2 reads']++;
    else if (r <= 5) readBuckets['3-5 reads']++;
    else if (r <= 10) readBuckets['6-10 reads']++;
    else readBuckets['11+ reads']++;
  }
  for (const [bucket, count] of Object.entries(readBuckets)) {
    console.log('  ' + bucket.padEnd(15) + count);
  }

  // Pages distribution
  console.log('\n=== PAGE COUNT DISTRIBUTION (all visible EFM) ===');
  const pageBuckets = { '1-15p': 0, '16-50p': 0, '51-100p': 0, '101-300p': 0, '301-500p': 0, '500+p': 0 };
  for (const b of efmBooks) {
    const p = b.pages_count || 0;
    if (p <= 15) pageBuckets['1-15p']++;
    else if (p <= 50) pageBuckets['16-50p']++;
    else if (p <= 100) pageBuckets['51-100p']++;
    else if (p <= 300) pageBuckets['101-300p']++;
    else if (p <= 500) pageBuckets['301-500p']++;
    else pageBuckets['500+p']++;
  }
  for (const [bucket, count] of Object.entries(pageBuckets)) {
    console.log('  ' + bucket.padEnd(15) + count);
  }

  await client.close();
}
main();
