import { MongoClient } from 'mongodb';

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const books = await db.collection('books').find({
    hidden: { $ne: true },
    pages_count: { $gt: 0 }
  }).project({
    _id: 1, id: 1, title: 1, author: 1, language: 1, year: 1,
    'image_source.provider': 1, pages_count: 1, pages_ocr: 1,
    pages_translated: 1, read_count: 1, 'pipeline_auto.status': 1,
    reading_summary: 1, 'index.generatedAt': 1
  }).toArray();

  console.log('Total visible books with pages:', books.length);

  // Normalize for comparison
  function norm(s) {
    return (s || '').toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\b(the|a|an|of|in|on|at|to|for|and|or|de|du|des|le|la|les|der|die|das|und|von|van|del|dei|di|et|cum|sive|seu)\b/g, '')
      .replace(/\s+/g, ' ').trim();
  }

  // Score a book (higher = keep this one)
  function score(b) {
    let s = 0;
    s += (b.read_count || 0) * 50;
    s += (b.pages_translated || 0) * 5;
    s += (b.pages_ocr || 0) * 2;
    s += (b.pages_count || 0);
    if (b.reading_summary) s += 100;
    if (b.index?.generatedAt) s += 80;
    const status = b.pipeline_auto?.status || '';
    if (status === 'complete') s += 200;
    if (status === 'chapters_complete') s += 150;
    if (status === 'enriched') s += 120;
    return s;
  }

  // Group by normalized title prefix (first 35 chars after normalization)
  const groups = {};
  for (const b of books) {
    const key = norm(b.title).substring(0, 35);
    if (key.length < 8) continue; // skip very short
    if (!groups[key]) groups[key] = [];
    groups[key].push(b);
  }

  // Filter to actual duplicates
  const dupeGroups = [];
  for (const [key, group] of Object.entries(groups)) {
    if (group.length < 2) continue;
    // Sort by score desc (best first)
    group.sort((a, b) => score(b) - score(a));
    dupeGroups.push(group);
  }

  // Sort groups: most duplicates first, then by total waste
  dupeGroups.sort((a, b) => b.length - a.length || score(b[0]) - score(a[0]));

  console.log('Duplicate groups:', dupeGroups.length);
  const totalDupeBooks = dupeGroups.reduce((s, g) => s + g.length - 1, 0);
  console.log('Books that could be hidden:', totalDupeBooks);

  const hideCandidates = [];

  for (const group of dupeGroups) {
    console.log('\n' + '='.repeat(80));
    for (let i = 0; i < group.length; i++) {
      const b = group[i];
      const prov = (b.image_source?.provider || '?').substring(0, 8);
      const ocrPct = b.pages_count > 0 ? Math.round((b.pages_ocr || 0) / b.pages_count * 100) : 0;
      const trPct = b.pages_count > 0 ? Math.round((b.pages_translated || 0) / b.pages_count * 100) : 0;
      const marker = i === 0 ? 'KEEP' : 'HIDE';
      const status = (b.pipeline_auto?.status || 'none').substring(0, 12);
      console.log(
        `  ${marker.padEnd(5)} ${prov.padEnd(9)} ` +
        `${(b.title || '').substring(0, 58).padEnd(60)} ` +
        `${(b.author || '').substring(0, 20).padEnd(22)} ` +
        `${String(b.year || '').padStart(5)} ` +
        `${String(b.pages_count || 0).padStart(5)}p ` +
        `${String(ocrPct).padStart(3)}%o ` +
        `${String(trPct).padStart(3)}%t ` +
        `${String(b.read_count || 0).padStart(3)}r ` +
        `${status}`
      );
      if (i > 0) hideCandidates.push(b);
    }
  }

  console.log('\n\n=== SUMMARY ===');
  console.log('Duplicate groups:', dupeGroups.length);
  console.log('Hide candidates:', hideCandidates.length);
  console.log('Visible after dedup:', books.length - hideCandidates.length);

  // Leonardo specific
  const leo = books.filter(b => (b.author || '').toLowerCase().includes('leonardo') || (b.author || '').toLowerCase().includes('vinci'));
  if (leo.length > 0) {
    console.log('\n=== ALL LEONARDO DA VINCI ===');
    for (const b of leo.sort((a, b) => score(b) - score(a))) {
      const prov = (b.image_source?.provider || '?').substring(0, 8);
      const ocrPct = b.pages_count > 0 ? Math.round((b.pages_ocr || 0) / b.pages_count * 100) : 0;
      console.log(
        `  ${prov.padEnd(9)} ${(b.title || '').substring(0, 55).padEnd(57)} ` +
        `${String(b.year || '').padStart(5)} ${String(b.pages_count || 0).padStart(5)}p ${String(ocrPct).padStart(3)}%o ` +
        `${String(b.read_count || 0).padStart(3)}r  ${b.id || b._id}`
      );
    }
  }

  if (process.argv.includes('--execute')) {
    console.log('\n=== EXECUTING HIDE ===');
    const ids = hideCandidates.map(b => b._id);
    const result = await db.collection('books').updateMany(
      { _id: { $in: ids } },
      { $set: { hidden: true } }
    );
    console.log(`Hidden ${result.modifiedCount} duplicate books`);
    const newVisible = await db.collection('books').countDocuments({ hidden: { $ne: true } });
    console.log(`New visible count: ${newVisible}`);
  } else {
    console.log('\nDry run. Use --execute to hide duplicates.');
  }

  await client.close();
}
main();
