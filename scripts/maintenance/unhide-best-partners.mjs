import { MongoClient } from 'mongodb';

const TARGET_TOTAL = 2222;
const DRY_RUN = process.argv.includes('--dry-run');
const EXECUTE = process.argv.includes('--execute');

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const currentVisible = await db.collection('books').countDocuments({ hidden: { $ne: true } });
  const needed = TARGET_TOTAL - currentVisible;
  console.log(`Current visible: ${currentVisible}, target: ${TARGET_TOTAL}, need to unhide: ${needed}`);
  if (needed <= 0) {
    console.log('Already at or above target!');
    await client.close();
    return;
  }

  // Fetch all hidden partner books with pages
  const candidates = await db.collection('books').find({
    hidden: true,
    'image_source.provider': { $nin: ['efm', null] },
    pages_count: { $gt: 0 }
  }).project({
    id: 1, _id: 1, title: 1, author: 1, language: 1, year: 1,
    'image_source.provider': 1, pages_count: 1, pages_ocr: 1,
    pages_translated: 1, read_count: 1, categories: 1,
    reading_summary: 1, index: 1
  }).toArray();

  console.log(`\nTotal candidates: ${candidates.length}`);

  // Score each book
  for (const b of candidates) {
    let score = 0;
    const provider = b.image_source?.provider || '';
    const title = (b.title || '').toLowerCase();
    const author = (b.author || '').toLowerCase();
    const lang = (b.language || '').toLowerCase();
    const pages = b.pages_count || 0;
    const ocrPct = pages > 0 ? (b.pages_ocr || 0) / pages : 0;
    const trPct = pages > 0 ? (b.pages_translated || 0) / pages : 0;

    // OCR completion (huge bonus — less pipeline work)
    score += ocrPct * 40;
    score += trPct * 20;

    // Has summary/index (fully processed)
    if (b.reading_summary) score += 15;
    if (b.index?.generatedAt) score += 10;

    // Read count (user engagement)
    score += Math.min(b.read_count || 0, 20) * 2;

    // Provider diversity bonus (rare providers get boost)
    const providerBonus = {
      vatican: 25, loc: 20, cambridge: 20, bodleian: 20,
      wellcome: 20, 'e-rara': 15, mdz: 10, gallica: 10,
      iiif: 5, internet_archive: 0, google_books: -5
    };
    score += providerBonus[provider] || 0;

    // Spiritual/esoteric content bonus
    const spiritualTerms = [
      'zohar', 'kabbal', 'hermet', 'emerald', 'gnostic', 'corpus hermeticum',
      'picatrix', 'ars notoria', 'goetia', 'key of solomon', 'sepher', 'sefer',
      'yoga', 'tantra', 'upanishad', 'bhagavad', 'vedanta', 'chakra', 'kundalini',
      'tao', 'dao', 'i ching', 'zhuangzi', 'laozi',
      'sufi', 'rumi', 'ibn arabi',
      'eckhart', 'mystical', 'theologia', 'pistis sophia', 'enoch',
      'paracelsus', 'agrippa', 'trithemius', 'bruno', 'dee',
      'rosicrucian', 'fama fraternitatis', 'chymical',
      'alchem', 'chrysopoeia', 'philosopher',
      'buddh', 'lotus sutra', 'diamond sutra', 'prajnaparamita',
      'neoplatoni', 'proclus', 'plotinus', 'iamblichus', 'porphyry',
      'orphic', 'eleusinian', 'mystery', 'initiation',
      'swedenborg', 'boehme', 'böhme', 'fludd', 'kircher', 'maier', 'khunrath',
      'magic', 'occult', 'divination', 'astrol', 'prophecy', 'revelation',
      'secret', 'sacred', 'wisdom', 'illuminat', 'masonic', 'freemason',
      'templar', 'grail', 'philosopher.*stone', 'transmut',
      'newton', 'principia', 'opticks', 'leonardo', 'da vinci',
      'copernicus', 'kepler', 'galileo', 'descartes',
      'plato', 'aristotle', 'socrates', 'pythagoras',
      'virgil', 'ovid', 'homer', 'iliad', 'odyssey', 'aeneid',
      'dante', 'divina commedia', 'paradise', 'inferno',
      'bible', 'genesis', 'exodus', 'psalm', 'revelation', 'apocalypse',
      'quran', 'torah', 'talmud',
      'botany', 'herbal', 'bestiary', 'anatomy', 'medicina',
      'astronomia', 'cosmograph', 'geograph',
      'emblem', 'hieroglyph', 'symbol',
    ];
    const spiritualMatch = spiritualTerms.some(t => title.includes(t) || author.includes(t));
    if (spiritualMatch) score += 20;

    // Major authors bonus
    const majorAuthors = [
      'newton', 'plato', 'aristotle', 'plotinus', 'proclus', 'ficino',
      'paracelsus', 'agrippa', 'trithemius', 'bruno', 'dee', 'fludd',
      'kircher', 'kepler', 'copernicus', 'galileo', 'descartes', 'leibniz',
      'boehme', 'böhme', 'swedenborg', 'eckhart', 'cusanus',
      'dante', 'virgil', 'homer', 'ovid', 'cicero', 'seneca',
      'leonardo', 'michelangelo', 'dürer', 'vesalius',
      'erasmus', 'thomas more', 'bacon', 'locke', 'hobbes',
      'aquinas', 'augustine', 'origen', 'clement', 'tertullian',
      'avicenna', 'averroes', 'maimonides', 'al-kindi', 'rhazes',
      'confucius', 'laozi', 'zhuangzi', 'mencius',
      'buddha', 'nagarjuna', 'shankara', 'patanjali',
      'rumi', 'hafiz', 'ibn arabi', 'al-ghazali',
    ];
    const authorMatch = majorAuthors.some(a => author.includes(a));
    if (authorMatch) score += 25;

    // Language diversity (non-European languages get a boost)
    const eastLangBonus = { chinese: 15, sanskrit: 15, arabic: 12, persian: 12,
      hebrew: 10, syriac: 10, armenian: 10, tamil: 10, tibetan: 12, japanese: 10, korean: 10,
      greek: 5, italian: 3 };
    score += eastLangBonus[lang] || 0;

    // Page count sweet spot (50-500 is ideal for reading)
    if (pages >= 50 && pages <= 500) score += 10;
    else if (pages >= 20 && pages <= 800) score += 5;
    else if (pages > 1000) score -= 5; // very large books are harder to process
    else if (pages < 10) score -= 10; // tiny fragments

    // Year bonus for older/historically significant
    const yr = b.year || 0;
    if (yr > 0 && yr < 1500) score += 10; // medieval/ancient
    else if (yr >= 1500 && yr < 1600) score += 5; // Renaissance
    else if (yr >= 1600 && yr < 1700) score += 3; // Early Modern

    b._score = score;
  }

  // Sort by score descending
  candidates.sort((a, b) => b._score - a._score);

  // Select top N
  const selected = candidates.slice(0, needed);

  // Print top selections
  console.log(`\n=== TOP ${Math.min(50, selected.length)} SELECTIONS (of ${selected.length}) ===\n`);
  for (const b of selected.slice(0, 50)) {
    const provider = (b.image_source?.provider || '?').substring(0, 6);
    const ocrPct = b.pages_count > 0 ? Math.round((b.pages_ocr || 0) / b.pages_count * 100) : 0;
    console.log(
      `  ${String(Math.round(b._score)).padStart(4)}pt  ${provider.padEnd(7)}` +
      `${(b.title || '').substring(0, 50).padEnd(52)}` +
      `${(b.author || '').substring(0, 22).padEnd(24)}` +
      `${String(b.year || '').padStart(5)} ` +
      `${(b.language || '?').substring(0, 6).padEnd(7)}` +
      `${String(b.pages_count || 0).padStart(5)}p ` +
      `${String(ocrPct).padStart(3)}% ocr`
    );
  }

  // Provider breakdown of selected
  const selByProvider = {};
  for (const b of selected) {
    const p = b.image_source?.provider || '?';
    if (!selByProvider[p]) selByProvider[p] = 0;
    selByProvider[p]++;
  }
  console.log('\n=== SELECTED BY PROVIDER ===');
  for (const [p, c] of Object.entries(selByProvider).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${p.padEnd(20)} ${c}`);
  }

  // Language breakdown
  const selByLang = {};
  for (const b of selected) {
    const l = b.language || 'Unknown';
    if (!selByLang[l]) selByLang[l] = 0;
    selByLang[l]++;
  }
  console.log('\n=== SELECTED BY LANGUAGE ===');
  for (const [l, c] of Object.entries(selByLang).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${l.padEnd(20)} ${c}`);
  }

  // Score distribution
  console.log('\n=== SCORE DISTRIBUTION ===');
  const scoreBuckets = { '80+': 0, '60-79': 0, '40-59': 0, '20-39': 0, '0-19': 0, '<0': 0 };
  for (const b of selected) {
    if (b._score >= 80) scoreBuckets['80+']++;
    else if (b._score >= 60) scoreBuckets['60-79']++;
    else if (b._score >= 40) scoreBuckets['40-59']++;
    else if (b._score >= 20) scoreBuckets['20-39']++;
    else if (b._score >= 0) scoreBuckets['0-19']++;
    else scoreBuckets['<0']++;
  }
  for (const [bucket, count] of Object.entries(scoreBuckets)) {
    console.log(`  ${bucket.padEnd(10)} ${count}`);
  }

  // Bottom 10 (cutoff quality)
  console.log('\n=== BOTTOM 10 SELECTIONS (cutoff quality) ===\n');
  for (const b of selected.slice(-10)) {
    const provider = (b.image_source?.provider || '?').substring(0, 6);
    const ocrPct = b.pages_count > 0 ? Math.round((b.pages_ocr || 0) / b.pages_count * 100) : 0;
    console.log(
      `  ${String(Math.round(b._score)).padStart(4)}pt  ${provider.padEnd(7)}` +
      `${(b.title || '').substring(0, 50).padEnd(52)}` +
      `${(b.author || '').substring(0, 22).padEnd(24)}` +
      `${String(b.year || '').padStart(5)} ` +
      `${(b.language || '?').substring(0, 6).padEnd(7)}` +
      `${String(b.pages_count || 0).padStart(5)}p ` +
      `${String(ocrPct).padStart(3)}% ocr`
    );
  }

  // Total pages being added
  const totalNewPages = selected.reduce((s, b) => s + (b.pages_count || 0), 0);
  const totalNewOcr = selected.reduce((s, b) => s + (b.pages_ocr || 0), 0);
  console.log(`\n=== IMPACT ===`);
  console.log(`Books to unhide: ${selected.length}`);
  console.log(`New pages: ${totalNewPages.toLocaleString()}`);
  console.log(`Pages with OCR: ${totalNewOcr.toLocaleString()} (${Math.round(totalNewOcr / totalNewPages * 100)}%)`);
  console.log(`Pages needing OCR: ${(totalNewPages - totalNewOcr).toLocaleString()}`);

  if (EXECUTE) {
    console.log('\n=== EXECUTING UNHIDE ===');
    const ids = selected.map(b => b._id);
    const result = await db.collection('books').updateMany(
      { _id: { $in: ids } },
      { $unset: { hidden: '' } }
    );
    console.log(`Updated ${result.modifiedCount} books (removed hidden flag)`);

    const newVisible = await db.collection('books').countDocuments({ hidden: { $ne: true } });
    console.log(`New visible count: ${newVisible}`);
  } else {
    console.log('\nDry run. Use --execute to apply changes.');
  }

  await client.close();
}
main();
