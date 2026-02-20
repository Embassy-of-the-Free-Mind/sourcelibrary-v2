#!/usr/bin/env node
/**
 * Find duplicate books across providers.
 * Matches on normalized author + similar title to detect the same work
 * imported from multiple sources (e.g., IA + EFM).
 */
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI required'); process.exit(1); }

const client = new MongoClient(uri, { maxPoolSize: 1 });
const timeout = setTimeout(() => { console.error('Script timeout (180s)'); client.close(); process.exit(1); }, 180000);

// --- Normalization helpers ---

function normalizeAuthor(author) {
  if (!author) return '';
  return author
    .toLowerCase()
    .replace(/[.,;:()[\]{}'"!?]/g, '')
    .replace(/\b(dr|prof|sir|st|saint|von|van|de|di|du|le|la|el|al|ibn)\b/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, '')
    .replace(/\d{4}[-–]\d{4}/g, '')
    .replace(/\d{4}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTitle(title) {
  if (!title) return '';
  return title
    .toLowerCase()
    .replace(/[.,;:()[\]{}'"!?\/\\]/g, '')
    .replace(/\b(the|a|an|of|in|on|at|to|for|and|or|de|du|des|le|la|les|der|die|das|und|von|van|del|dei|di|et|cum|sive|seu|sic)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleKey(title, n = 4) {
  const normalized = normalizeTitle(title);
  const words = normalized.split(' ').filter(w => w.length > 2);
  return words.slice(0, n).join(' ');
}

function titlesSimilar(t1, t2) {
  const n1 = normalizeTitle(t1);
  const n2 = normalizeTitle(t2);
  if (n1 === n2) return true;
  if (n1.length > 5 && n2.length > 5 && (n1.includes(n2) || n2.includes(n1))) return true;

  const words1 = new Set(n1.split(' ').filter(w => w.length > 2));
  const words2 = new Set(n2.split(' ').filter(w => w.length > 2));
  if (words1.size === 0 || words2.size === 0) return false;

  const intersection = [...words1].filter(w => words2.has(w));
  const minSize = Math.min(words1.size, words2.size);
  const overlapRatio = intersection.length / minSize;
  return overlapRatio >= 0.6 && intersection.length >= Math.min(3, minSize);
}

function classifyProvider(book) {
  const provider = (book.image_source?.provider || '').toLowerCase();
  const providerName = (book.image_source?.provider_name || '').toLowerCase();
  const sourceUrl = (book.image_source?.source_url || '').toLowerCase();

  if (provider.includes('efm') || provider.includes('embassy') || provider.includes('bph') ||
      providerName.includes('efm') || providerName.includes('embassy') || providerName.includes('bph') ||
      sourceUrl.includes('embassyofthefreemind') || sourceUrl.includes('bfreedmind')) {
    return 'EFM';
  }
  if (provider === 'ia' || provider === 'internet_archive' || provider === 'internet archive' ||
      providerName.includes('internet archive') || sourceUrl.includes('archive.org')) {
    return 'IA';
  }
  if (provider === 'gallica' || providerName.includes('gallica') || sourceUrl.includes('gallica')) return 'Gallica';
  if (provider === 'mdz' || provider === 'bsb' || providerName.includes('bavarian') || sourceUrl.includes('mdz')) return 'MDZ';
  if (provider === 'wellcome' || providerName.includes('wellcome')) return 'Wellcome';
  if (provider === 'e-rara' || provider === 'erara') return 'e-rara';
  if (provider === 'bodleian' || providerName.includes('bodleian')) return 'Bodleian';
  if (provider === 'cambridge' || providerName.includes('cambridge')) return 'Cambridge';
  if (provider === 'hab' || providerName.includes('wolfenb')) return 'HAB';
  if (provider === 'vatican' || providerName.includes('vatican')) return 'Vatican';
  if (provider === 'loc' || providerName.includes('library of congress')) return 'LOC';
  if (provider === 'google' || providerName.includes('google')) return 'Google Books';
  if (provider === 'europeana' || providerName.includes('europeana')) return 'Europeana';
  if (provider === 'hathitrust' || providerName.includes('hathi')) return 'HathiTrust';
  return provider || 'unknown';
}

function scorebook(book) {
  let score = 0;
  score += (book.pages_translated || 0) * 3;
  score += (book.pages_ocr || 0) * 2;
  score += (book.pages_count || 0) * 1;
  if (book.has_summary) score += 50;
  if (book.has_index) score += 50;
  if (book.has_chapters) score += 30;
  return score;
}

try {
  await client.connect();
  const db = client.db('bookstore');

  console.log('Fetching books (lightweight projection)...');
  const t0 = Date.now();

  // Minimal projection — skip reading_summary/index/chapters content, just check existence
  const allBooks = await db.collection('books').find(
    {},
    {
      projection: {
        title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1,
        'image_source.provider': 1, 'image_source.provider_name': 1, 'image_source.source_url': 1,
        pages_count: 1, pages_ocr: 1, pages_translated: 1,
        'pipeline_auto.status': 1, id: 1
      }
    }
  ).toArray();

  console.log(`Fetched ${allBooks.length} books in ${Date.now() - t0}ms\n`);

  // Check for summary/index/chapters existence with a second lighter query
  const enrichedIds = await db.collection('books').find(
    { $or: [
      { reading_summary: { $exists: true } },
      { 'index.generatedAt': { $exists: true } },
      { 'chapters.0': { $exists: true } }
    ]},
    { projection: { _id: 1, reading_summary: { $type: 'bool' }, 'index.generatedAt': 1, chapters: { $size: { $ifNull: ['$chapters', []] } } } }
  ).toArray();

  // Actually just do a simple aggregation for this
  const enrichments = await db.collection('books').aggregate([
    { $project: {
      has_summary: { $cond: [{ $ifNull: ['$reading_summary', false] }, true, false] },
      has_index: { $cond: [{ $ifNull: ['$index.generatedAt', false] }, true, false] },
      has_chapters: { $cond: [{ $gt: [{ $size: { $ifNull: ['$chapters', []] } }, 0] }, true, false] }
    }}
  ]).toArray();

  const enrichMap = new Map();
  for (const e of enrichments) {
    enrichMap.set(String(e._id), e);
  }

  // Merge enrichment flags
  for (const book of allBooks) {
    const e = enrichMap.get(String(book._id));
    if (e) {
      book.has_summary = e.has_summary;
      book.has_index = e.has_index;
      book.has_chapters = e.has_chapters;
    }
  }

  // ============================================
  // PHASE 1: Count books by provider
  // ============================================
  console.log('=== Books by Provider ===\n');
  console.log(`Total books: ${allBooks.length}\n`);

  const providerCounts = {};
  for (const book of allBooks) {
    const p = classifyProvider(book);
    book._provider = p;
    providerCounts[p] = (providerCounts[p] || 0) + 1;
  }

  for (const [provider, count] of Object.entries(providerCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${provider}: ${count}`);
  }
  console.log();

  const rawProviders = {};
  for (const book of allBooks) {
    const raw = book.image_source?.provider || '(none)';
    rawProviders[raw] = (rawProviders[raw] || 0) + 1;
  }
  console.log('Raw image_source.provider values:');
  for (const [p, c] of Object.entries(rawProviders).sort((a, b) => b[1] - a[1])) {
    console.log(`  "${p}": ${c}`);
  }
  console.log();

  // ============================================
  // PHASE 2: Find duplicates
  // ============================================
  console.log('=== Duplicate Detection ===\n');

  const authorGroups = {};
  for (const book of allBooks) {
    const authNorm = normalizeAuthor(book.author);
    if (!authNorm || authNorm.length < 2) continue;

    const title = book.display_title || book.title || '';
    const tKey = titleKey(title, 4);
    if (!tKey || tKey.length < 3) continue;

    const groupKey = `${authNorm}|||${tKey}`;
    if (!authorGroups[groupKey]) authorGroups[groupKey] = [];
    authorGroups[groupKey].push(book);
  }

  const duplicateGroups = [];

  for (const [key, books] of Object.entries(authorGroups)) {
    if (books.length < 2) continue;
    const providers = new Set(books.map(b => b._provider));
    if (providers.size < 2) continue;

    const clusters = [];
    for (const book of books) {
      let placed = false;
      for (const cluster of clusters) {
        if (titlesSimilar(book.display_title || book.title || '', cluster[0].display_title || cluster[0].title || '')) {
          cluster.push(book);
          placed = true;
          break;
        }
      }
      if (!placed) clusters.push([book]);
    }

    for (const cluster of clusters) {
      const cp = new Set(cluster.map(b => b._provider));
      if (cluster.length >= 2 && cp.size >= 2) duplicateGroups.push(cluster);
    }
  }

  // Second pass: same author, different title key but similar titles
  const authorOnlyGroups = {};
  for (const book of allBooks) {
    const authNorm = normalizeAuthor(book.author);
    if (!authNorm || authNorm.length < 3) continue;
    if (!authorOnlyGroups[authNorm]) authorOnlyGroups[authNorm] = [];
    authorOnlyGroups[authNorm].push(book);
  }

  const alreadyPaired = new Set();
  for (const dup of duplicateGroups) {
    for (const b of dup) alreadyPaired.add(String(b._id));
  }

  for (const [author, books] of Object.entries(authorOnlyGroups)) {
    if (books.length < 2) continue;
    const providers = new Set(books.map(b => b._provider));
    if (providers.size < 2) continue;

    for (let i = 0; i < books.length; i++) {
      for (let j = i + 1; j < books.length; j++) {
        if (books[i]._provider === books[j]._provider) continue;
        if (alreadyPaired.has(String(books[i]._id)) && alreadyPaired.has(String(books[j]._id))) continue;

        const t1 = books[i].display_title || books[i].title || '';
        const t2 = books[j].display_title || books[j].title || '';

        if (titlesSimilar(t1, t2)) {
          let foundGroup = false;
          for (const group of duplicateGroups) {
            const groupIds = new Set(group.map(b => String(b._id)));
            if (groupIds.has(String(books[i]._id)) || groupIds.has(String(books[j]._id))) {
              if (!groupIds.has(String(books[i]._id))) group.push(books[i]);
              if (!groupIds.has(String(books[j]._id))) group.push(books[j]);
              foundGroup = true;
              break;
            }
          }
          if (!foundGroup) duplicateGroups.push([books[i], books[j]]);
          alreadyPaired.add(String(books[i]._id));
          alreadyPaired.add(String(books[j]._id));
        }
      }
    }
  }

  duplicateGroups.sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length;
    return b.reduce((s, bk) => s + (bk.pages_count || 0), 0) - a.reduce((s, bk) => s + (bk.pages_count || 0), 0);
  });

  console.log(`Found ${duplicateGroups.length} duplicate groups across providers\n`);

  const totalDupBooks = duplicateGroups.reduce((s, g) => s + g.length, 0);
  console.log(`Total books involved in duplicates: ${totalDupBooks}\n`);

  const pairCounts = {};
  for (const group of duplicateGroups) {
    const providers = [...new Set(group.map(b => b._provider))].sort();
    pairCounts[providers.join(' + ')] = (pairCounts[providers.join(' + ')] || 0) + 1;
  }
  console.log('Duplicate groups by provider pair:');
  for (const [pair, count] of Object.entries(pairCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pair}: ${count}`);
  }
  console.log();

  // ============================================
  // PHASE 3: Show sample duplicates
  // ============================================
  console.log('=== Sample Duplicates (top 20) ===\n');

  const sample = duplicateGroups.slice(0, 20);
  for (let i = 0; i < sample.length; i++) {
    const group = sample[i];
    console.log(`--- Group ${i + 1} (${group.length} copies) ---`);

    const scored = group.map(b => ({ ...b, _score: scorebook(b) })).sort((a, b) => b._score - a._score);
    const best = scored[0];

    for (const book of scored) {
      const bookId = book.id || book._id;
      const isBest = book === best ? ' *** BEST ***' : '';
      console.log(`  [${book._provider}] ${book.display_title || book.title}`);
      console.log(`    Author: ${book.author || '(none)'} | Year: ${book.year || book.published || '?'} | Lang: ${book.language || '?'}`);
      console.log(`    Pages: ${book.pages_count || 0} total, ${book.pages_ocr || 0} OCR, ${book.pages_translated || 0} translated`);
      console.log(`    Score: ${book._score}${isBest} | Pipeline: ${book.pipeline_auto?.status || '(none)'}`);
      console.log(`    https://sourcelibrary.org/book/${bookId}`);
    }
    console.log();
  }

  // ============================================
  // PHASE 4: Summary stats
  // ============================================
  console.log('=== Duplicate Impact Summary ===\n');

  let totalWastedPages = 0, totalWastedOcr = 0, totalWastedTranslated = 0;

  for (const group of duplicateGroups) {
    const scored = group.map(b => ({
      pages_count: b.pages_count || 0,
      pages_ocr: b.pages_ocr || 0,
      pages_translated: b.pages_translated || 0,
      score: scorebook(b)
    })).sort((a, b) => b.score - a.score);

    for (let j = 1; j < scored.length; j++) {
      totalWastedPages += scored[j].pages_count;
      totalWastedOcr += scored[j].pages_ocr;
      totalWastedTranslated += scored[j].pages_translated;
    }
  }

  console.log(`Duplicate groups: ${duplicateGroups.length}`);
  console.log(`"Inferior" copies: ${totalDupBooks - duplicateGroups.length} books`);
  console.log(`Processing on inferior copies:`);
  console.log(`  Total pages: ${totalWastedPages}`);
  console.log(`  OCR'd pages: ${totalWastedOcr}`);
  console.log(`  Translated pages: ${totalWastedTranslated}`);
  console.log(`  Estimated wasted cost: ~$${((totalWastedOcr * 0.0011 + totalWastedTranslated * 0.0011) * 2).toFixed(2)}`);

} catch (err) {
  console.error('Error:', err);
} finally {
  clearTimeout(timeout);
  await client.close();
}
