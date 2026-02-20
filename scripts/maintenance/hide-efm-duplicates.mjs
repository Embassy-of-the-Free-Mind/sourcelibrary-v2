import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI);
const DRY_RUN = !process.argv.includes('--apply');

async function main() {
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  // Get all EFM books
  const efmBooks = await books.find({
    $or: [
      { 'image_source.provider': { $regex: /efm|embassy|bph/i } },
      { 'image_source.provider_name': { $regex: /efm|embassy|bph|free.?mind/i } },
      { 'image_source.source_url': { $regex: /embassyofthefreemind|bfreedmind/i } },
    ]
  }, { projection: { id: 1, title: 1, display_title: 1, author: 1, year: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1 } }).toArray();

  console.log(`EFM books: ${efmBooks.length}`);

  // Get all non-EFM books
  const nonEfmBooks = await books.find({
    $and: [
      { 'image_source.provider': { $not: { $regex: /efm|embassy|bph/i } } },
      { $or: [
        { 'image_source.provider_name': { $not: { $regex: /efm|embassy|bph|free.?mind/i } } },
        { 'image_source.provider_name': { $exists: false } },
      ]},
      { $or: [
        { 'image_source.source_url': { $not: { $regex: /embassyofthefreemind|bfreedmind/i } } },
        { 'image_source.source_url': { $exists: false } },
      ]},
    ]
  }, { projection: { id: 1, title: 1, display_title: 1, author: 1, year: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, 'image_source.provider': 1 } }).toArray();

  console.log(`Non-EFM books: ${nonEfmBooks.length}`);

  // Normalize for matching
  function normalize(s) {
    if (!s) return '';
    return s.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeAuthor(s) {
    if (!s) return '';
    // Extract last name (first word or word after comma)
    const n = normalize(s);
    const parts = n.split(/[,\s]+/).filter(Boolean);
    // Return first meaningful word (skip "von", "de", etc.)
    const skip = new Set(['von', 'de', 'di', 'van', 'der', 'le', 'la', 'the', 'of']);
    for (const p of parts) {
      if (!skip.has(p) && p.length > 2) return p;
    }
    return parts[0] || '';
  }

  // Build EFM lookup by normalized author
  const efmByAuthor = new Map();
  for (const b of efmBooks) {
    const authorKey = normalizeAuthor(b.author);
    if (!authorKey) continue;
    if (!efmByAuthor.has(authorKey)) efmByAuthor.set(authorKey, []);
    efmByAuthor.get(authorKey).push(b);
  }

  // Find duplicates: non-EFM books whose author+title closely match an EFM book
  const toHide = [];
  
  for (const nonEfm of nonEfmBooks) {
    const authorKey = normalizeAuthor(nonEfm.author);
    if (!authorKey) continue;
    
    const efmCandidates = efmByAuthor.get(authorKey);
    if (!efmCandidates) continue;

    const nonEfmTitle = normalize(nonEfm.display_title || nonEfm.title);
    if (!nonEfmTitle || nonEfmTitle.length < 5) continue;

    for (const efm of efmCandidates) {
      const efmTitle = normalize(efm.display_title || efm.title);
      if (!efmTitle) continue;

      // Check title similarity: one contains the other, or significant word overlap
      const nonEfmWords = new Set(nonEfmTitle.split(' ').filter(w => w.length > 3));
      const efmWords = new Set(efmTitle.split(' ').filter(w => w.length > 3));
      
      if (nonEfmWords.size === 0 || efmWords.size === 0) continue;

      const overlap = [...nonEfmWords].filter(w => efmWords.has(w)).length;
      const similarity = overlap / Math.min(nonEfmWords.size, efmWords.size);

      if (similarity >= 0.5 && overlap >= 2) {
        toHide.push({
          nonEfm: {
            id: nonEfm.id,
            title: nonEfm.display_title || nonEfm.title,
            author: nonEfm.author,
            year: nonEfm.year,
            provider: nonEfm.image_source?.provider,
            pages: nonEfm.pages_count,
            ocr: nonEfm.pages_ocr,
            translated: nonEfm.pages_translated,
          },
          efm: {
            id: efm.id,
            title: efm.display_title || efm.title,
            author: efm.author,
            year: efm.year,
            pages: efm.pages_count,
            ocr: efm.pages_ocr,
            translated: efm.pages_translated,
          },
          similarity: Math.round(similarity * 100),
          overlapWords: overlap,
        });
        break; // One match is enough
      }
    }
  }

  // Split into safe-to-hide (EFM has pages) vs needs-attention (EFM is empty shell)
  const safeToHide = toHide.filter(p => (p.efm.pages || 0) > 0);
  const needsAttention = toHide.filter(p => (p.efm.pages || 0) === 0);

  console.log(`\nDuplicate pairs found: ${toHide.length}`);
  console.log(`  Safe to hide (EFM has pages): ${safeToHide.length}`);
  console.log(`  Needs attention (EFM empty): ${needsAttention.length}\n`);

  console.log('=== SAFE TO HIDE (EFM copy has content) ===\n');
  for (const pair of safeToHide) {
    console.log(`HIDE: "${pair.nonEfm.title}" (${pair.nonEfm.provider}, ${pair.nonEfm.pages}p, ${pair.nonEfm.ocr} ocr, ${pair.nonEfm.translated} trans)`);
    console.log(`KEEP: "${pair.efm.title}" (EFM, ${pair.efm.pages}p, ${pair.efm.ocr} ocr, ${pair.efm.translated} trans)`);
    console.log(`      Similarity: ${pair.similarity}%, ${pair.overlapWords} words overlap\n`);
  }

  if (needsAttention.length > 0) {
    console.log('=== NEEDS ATTENTION (EFM copy has 0 pages — keeping non-EFM for now) ===\n');
    for (const pair of needsAttention) {
      console.log(`KEEP FOR NOW: "${pair.nonEfm.title}" (${pair.nonEfm.provider}, ${pair.nonEfm.pages}p, ${pair.nonEfm.ocr} ocr, ${pair.nonEfm.translated} trans)`);
      console.log(`EFM SHELL:    "${pair.efm.title}" (EFM, 0 pages — needs reimport)`);
      console.log(`      Similarity: ${pair.similarity}%, ${pair.overlapWords} words overlap\n`);
    }
  }

  // Only action the safe-to-hide set
  for (const pair of safeToHide) {
    console.log(`HIDE: "${pair.nonEfm.title}" (${pair.nonEfm.provider}, ${pair.nonEfm.pages}p, ${pair.nonEfm.ocr} ocr, ${pair.nonEfm.translated} trans)`);
    console.log(`KEEP: "${pair.efm.title}" (EFM, ${pair.efm.pages}p, ${pair.efm.ocr} ocr, ${pair.efm.translated} trans)`);
    console.log(`      Similarity: ${pair.similarity}%, ${pair.overlapWords} words overlap`);
    console.log('');
  }

  if (DRY_RUN) {
    console.log(`\nDRY RUN — would hide ${safeToHide.length} non-EFM duplicates (skipping ${needsAttention.length} where EFM is empty).`);
    console.log('Run with --apply to execute.');
  } else {
    const ids = safeToHide.map(p => p.nonEfm.id);
    if (ids.length > 0) {
      const result = await books.updateMany(
        { id: { $in: ids } },
        { $set: { hidden: true, hidden_reason: 'efm_duplicate' } }
      );
      console.log(`\nHid ${result.modifiedCount} non-EFM duplicate books.`);
    } else {
      console.log('\nNo books to hide.');
    }
    if (needsAttention.length > 0) {
      console.log(`${needsAttention.length} duplicates skipped (EFM copy has 0 pages — hide these after EFM reimport).`);
    }
  }

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
