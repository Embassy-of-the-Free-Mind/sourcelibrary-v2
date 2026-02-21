#!/usr/bin/env node
/**
 * AI-powered collection assignment using Gemini Flash.
 *
 * For each book, sends metadata to Gemini and gets back:
 *   - Which collections (1-3) the book belongs to
 *   - A relevance score (0-100) for each
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/assign-collections-ai.mjs [--dry-run] [--limit N] [--offset N] [--concurrency N]
 */

import { MongoClient } from 'mongodb';
import { GoogleGenAI } from '@google/genai';

// ── Collection Definitions ──────────────────────────────────────────────────

const COLLECTIONS = [
  {
    slug: 'alchemy',
    name: 'Alchemy',
    subtitle: 'The Art of Transmutation',
    description: 'Alchemical treatises on the philosopher\'s stone, transmutation, and the Great Work — Paracelsus, Basil Valentine, George Ripley, Nicolas Flamel, and the practical and spiritual traditions of laboratory alchemy.',
    color: 'gold',
    order: 1,
  },
  {
    slug: 'hermetica',
    name: 'Hermetica',
    subtitle: 'Hermetic Philosophy & Prisca Theologia',
    description: 'The Hermetic tradition from the Corpus Hermeticum and Asclepius through Ficino\'s translations to Renaissance Hermeticism — the ancient wisdom attributed to Hermes Trismegistus and its influence on Western thought.',
    color: 'rust',
    order: 2,
  },
  {
    slug: 'kabbalah',
    name: 'Kabbalah',
    subtitle: 'Jewish Mysticism & Christian Cabala',
    description: 'Kabbalistic texts including the Zohar, Sefer Yetzirah, the works of Isaac Luria and Moses Cordovero, Christian Kabbalah from Pico della Mirandola to Knorr von Rosenroth, gematria, and the Sefirotic system.',
    color: 'violet',
    order: 3,
  },
  {
    slug: 'magic',
    name: 'Magic & Occult Arts',
    subtitle: 'Grimoires, Natural Magic & Ceremonial Practice',
    description: 'Texts of magical practice — Solomonic grimoires, Agrippa\'s occult philosophy, natural magic, talismanic arts, the Ars Notoria, angel magic, and the philosophical defense of magic from Ficino to Dee.',
    color: 'rust',
    order: 4,
  },
  {
    slug: 'demonology',
    name: 'Demonology & Witchcraft',
    subtitle: 'Witch Trials, Possession & the Demonic',
    description: 'Demonological treatises, witch-trial literature, accounts of possession and exorcism — from the Malleus Maleficarum to Reginald Scot\'s sceptical challenge. The great early modern debate over the reality of witchcraft.',
    color: 'rust',
    order: 5,
  },
  {
    slug: 'secret-societies',
    name: 'Secret Societies',
    subtitle: 'Freemasonry, Rosicrucians & Fraternal Orders',
    description: 'Texts from and about secret and fraternal orders — Rosicrucian manifestos (Fama, Confessio, Chemical Wedding), Masonic constitutions and rituals, Illuminati, Templars, Philadelphians, and esoteric fraternities.',
    color: 'sage',
    order: 6,
  },
  {
    slug: 'astrology',
    name: 'Astrology & Divination',
    subtitle: 'Celestial Science & the Mantic Arts',
    description: 'Astrological theory and practice from Ptolemy through the Renaissance — horoscopes, judicial astrology, geomancy, physiognomy, palmistry, oneiromancy, and the art of reading signs.',
    color: 'violet',
    order: 7,
  },
  {
    slug: 'mysticism',
    name: 'Mysticism',
    subtitle: 'Direct Experience of the Divine',
    description: 'The literature of mystical experience across traditions — Meister Eckhart, Jakob Böhme, Teresa of Ávila, John of the Cross, Hildegard of Bingen, Sufi poets, hesychasm, quietism, and the contemplative traditions.',
    color: 'violet',
    order: 8,
  },
  {
    slug: 'sacred-texts',
    name: 'Sacred Texts',
    subtitle: 'Scripture, Church Fathers & Liturgy',
    description: 'Biblical manuscripts and editions, patristic writings (Augustine, Origen, Chrysostom), the Church Fathers, liturgical texts, psalters, and the foundational religious texts of Western civilization.',
    color: 'gold',
    order: 9,
  },
  {
    slug: 'theology',
    name: 'Theology & Religious Thought',
    subtitle: 'Scholasticism, Reformation & Apologetics',
    description: 'Theological works — Aquinas, Luther, Calvin, Suárez — systematic theology, Reformation debates, apologetics, ecclesiology, and the intellectual architecture of Christian thought.',
    color: 'gold',
    order: 10,
  },
  {
    slug: 'classical-philosophy',
    name: 'Classical Philosophy',
    subtitle: 'Ancient Greek & Roman Thought',
    description: 'The philosophical traditions of Greece and Rome — Plato, Aristotle, the Stoics (Seneca, Epictetus, Marcus Aurelius), Neoplatonists (Plotinus, Proclus, Iamblichus), pre-Socratics, Epicureans, and Sceptics.',
    color: 'violet',
    order: 11,
  },
  {
    slug: 'renaissance-philosophy',
    name: 'Renaissance Philosophy',
    subtitle: 'Florentine Platonism & Humanist Thought',
    description: 'The philosophical revival of the 15th-17th centuries — Ficino, Pico della Mirandola, Bruno, Campanella, the Florentine Academy, Renaissance Neoplatonism, and the humanist recovery of ancient learning.',
    color: 'violet',
    order: 12,
  },
  {
    slug: 'natural-philosophy',
    name: 'Natural Philosophy & Science',
    subtitle: 'From Aristotle to Newton',
    description: 'The investigation of the natural world — Copernicus, Kepler, Galileo, Newton, astronomy, mathematics, physics, optics, mechanics, and the birth of modern science from ancient cosmology.',
    color: 'sage',
    order: 13,
  },
  {
    slug: 'medicine',
    name: 'Medicine & Natural History',
    subtitle: 'Herbalism, Anatomy & the Living World',
    description: 'Medical treatises (Galen, Paracelsus, Vesalius), herbals, pharmacopoeia, anatomical atlases, botany, zoology, and the practical knowledge of healing and the natural world.',
    color: 'sage',
    order: 14,
  },
  {
    slug: 'indic-traditions',
    name: 'Indic Traditions',
    subtitle: 'Vedas, Yoga, Tantra & Buddhist Texts',
    description: 'Sacred and philosophical texts from the Indian subcontinent — the Vedas, Upanishads, Yoga sūtras, Tantric traditions, Buddhist scriptures, and Āyurvedic medicine.',
    color: 'gold',
    order: 15,
  },
  {
    slug: 'chinese-classics',
    name: 'Chinese Classics',
    subtitle: 'Confucian, Daoist & Buddhist Texts',
    description: 'The literary and philosophical heritage of China — Confucian classics, Daoist scriptures, Chan/Zen Buddhist texts, Chinese medical treatises, and military strategy.',
    color: 'gold',
    order: 16,
  },
  {
    slug: 'art-illustrated',
    name: 'Art & Illustrated Books',
    subtitle: 'Emblems, Engravings & Visual Knowledge',
    description: 'Books prized for their visual content — emblem books (Alciato, Ripa), illustrated encyclopedias, architectural treatises, anatomical atlases, and the masterworks of early modern printmaking.',
    color: 'gold',
    order: 17,
  },
  {
    slug: 'literature',
    name: 'Literature & Poetry',
    subtitle: 'Epic, Allegory & Early Fiction',
    description: 'Literary works from classical epic to early modern prose — Homer, Virgil, Dante, alchemical allegories, utopian fiction, courtly romance, and the literary imagination.',
    color: 'sage',
    order: 18,
  },
];

const COLLECTION_SUMMARY = COLLECTIONS.map(c => `- ${c.slug}: ${c.name} — ${c.description}`).join('\n');

// ── Gemini Classification ───────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a specialist librarian classifying rare books into thematic collections. For each book, assign 1-3 collections that BEST fit, with a relevance score.

COLLECTIONS:
${COLLECTION_SUMMARY}

RULES:
1. Assign 1-3 collections per book. Most books should get 1-2.
2. Only assign a collection if the book genuinely belongs. Don't pad with marginal matches.
3. The MOST relevant collection should score 80-100. Secondary fits: 50-79. Don't assign below 50.
4. Consider title, author, year, language, and existing categories together.
5. A book about Paracelsian medicine could be "alchemy" (80) + "medicine" (70). Use judgment.
6. For non-Western books (Chinese, Sanskrit, etc.), prefer the regional collection (chinese-classics, indic-traditions) over Western categories.

Respond with a JSON array, one entry per book, in the same order as input. Each entry:
{"i": <index>, "c": [{"s": "<slug>", "r": <score>}]}

NO explanation, just the JSON array.`;

async function classifyBatch(ai, books, batchIndex) {
  const booksText = books.map((b, i) => {
    const cats = (b.categories || []).slice(0, 8).join(', ');
    return `[${i}] "${(b.display_title || b.title || 'Untitled').substring(0, 120)}" by ${(b.author || 'Unknown').substring(0, 60)} (${b.year || '?'}, ${b.language || '?'}) [${cats}]`;
  }).join('\n');

  const prompt = `Classify these ${books.length} books:\n\n${booksText}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: prompt,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      });

      const text = response.text.trim();
      const results = JSON.parse(text);
      if (!Array.isArray(results)) throw new Error('Not an array');
      return results;
    } catch (err) {
      console.error(`  Batch ${batchIndex} attempt ${attempt + 1} failed: ${err.message}`);
      if (attempt < 2) await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  // Return empty assignments on failure
  return books.map((_, i) => ({ i, c: [] }));
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 0;
  const offsetIdx = args.indexOf('--offset');
  const offset = offsetIdx >= 0 ? parseInt(args[offsetIdx + 1]) : 0;
  const concurrencyIdx = args.indexOf('--concurrency');
  const concurrency = concurrencyIdx >= 0 ? parseInt(args[concurrencyIdx + 1]) : 5;

  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }
  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY not set');
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Fetch books
  const projection = {
    id: 1, title: 1, display_title: 1, author: 1, year: 1, language: 1,
    categories: 1, pages_count: 1, thumbnail: 1, thumbnail_blob: 1, photo: 1,
  };
  let cursor = db.collection('books')
    .find({ status: { $ne: 'deleted' } }, { projection })
    .sort({ created_at: 1 })
    .skip(offset);
  if (limit) cursor = cursor.limit(limit);
  const books = await cursor.toArray();
  console.log(`Loaded ${books.length} books (offset=${offset})\n`);

  // Batch classify
  const BATCH_SIZE = 25;
  const batches = [];
  for (let i = 0; i < books.length; i += BATCH_SIZE) {
    batches.push(books.slice(i, i + BATCH_SIZE));
  }
  console.log(`${batches.length} batches of ${BATCH_SIZE}, concurrency=${concurrency}\n`);

  // Store results: bookId -> [{ slug, relevance }]
  const bookAssignments = new Map();
  let processed = 0;

  // Process batches with concurrency limit
  for (let i = 0; i < batches.length; i += concurrency) {
    const chunk = batches.slice(i, i + concurrency);
    const promises = chunk.map((batch, j) =>
      classifyBatch(ai, batch, i + j).then(results => {
        for (const result of results) {
          const bookIdx = (i + j) * BATCH_SIZE + result.i;
          const book = books[bookIdx];
          if (!book) continue;
          const assignments = (result.c || [])
            .filter(a => a.s && COLLECTIONS.some(c => c.slug === a.s) && a.r >= 50)
            .sort((a, b) => b.r - a.r)
            .slice(0, 3);
          bookAssignments.set(book.id, assignments);
        }
      })
    );
    await Promise.all(promises);
    processed += chunk.reduce((s, b) => s + b.length, 0);
    process.stdout.write(`  Classified: ${processed}/${books.length}\r`);
  }
  console.log(`\nClassification complete.\n`);

  // Summarize
  const collectionCounts = {};
  for (const col of COLLECTIONS) collectionCounts[col.slug] = 0;
  let unassigned = 0;
  let totalAssignments = 0;

  for (const book of books) {
    const assignments = bookAssignments.get(book.id) || [];
    if (assignments.length === 0) {
      unassigned++;
    } else {
      for (const a of assignments) {
        collectionCounts[a.s] = (collectionCounts[a.s] || 0) + 1;
        totalAssignments++;
      }
    }
  }

  console.log('=== COLLECTION ASSIGNMENTS ===\n');
  for (const col of COLLECTIONS) {
    console.log(`${col.name}: ${collectionCounts[col.slug] || 0} books`);
  }
  console.log(`\nTotal assignments: ${totalAssignments} (avg ${(totalAssignments / books.length).toFixed(1)} per book)`);
  console.log(`Unassigned: ${unassigned} books\n`);

  // Show unassigned
  if (unassigned > 0) {
    console.log('Sample unassigned:');
    let shown = 0;
    for (const book of books) {
      const a = bookAssignments.get(book.id) || [];
      if (a.length === 0 && shown < 20) {
        console.log(`  ${(book.title || '').substring(0, 80)} | ${book.language || '?'} | ${(book.categories || []).join(', ')}`);
        shown++;
      }
    }
  }

  if (dryRun) {
    console.log('\n[DRY RUN] No changes written.');
    await client.close();
    return;
  }

  // Write to DB
  console.log('\nWriting to database...');

  // 1. Update each book with collections array + collection_relevance map
  const bulkOps = [];
  for (const book of books) {
    const assignments = bookAssignments.get(book.id) || [];
    const slugs = assignments.map(a => a.s);
    const relevance = {};
    for (const a of assignments) relevance[a.s] = a.r;

    bulkOps.push({
      updateOne: {
        filter: { id: book.id },
        update: { $set: { collections: slugs, collection_relevance: relevance } },
      },
    });
  }

  const WRITE_BATCH = 500;
  let updated = 0;
  for (let i = 0; i < bulkOps.length; i += WRITE_BATCH) {
    const batch = bulkOps.slice(i, i + WRITE_BATCH);
    const result = await db.collection('books').bulkWrite(batch);
    updated += result.modifiedCount;
    process.stdout.write(`  Books: ${Math.min(i + WRITE_BATCH, bulkOps.length)}/${bulkOps.length}\r`);
  }
  console.log(`  Books updated: ${updated}                `);

  // 2. Upsert collection metadata
  const collectionsColl = db.collection('collections');

  // Delete old collections that no longer exist
  const newSlugs = COLLECTIONS.map(c => c.slug);
  const deleted = await collectionsColl.deleteMany({ slug: { $nin: newSlugs } });
  if (deleted.deletedCount > 0) {
    console.log(`  Removed ${deleted.deletedCount} old collections`);
  }

  for (const col of COLLECTIONS) {
    // Get books for this collection, sorted by relevance
    const colBooks = books
      .filter(b => {
        const a = bookAssignments.get(b.id) || [];
        return a.some(x => x.s === col.slug);
      })
      .sort((a, b) => {
        const ra = (bookAssignments.get(a.id) || []).find(x => x.s === col.slug)?.r || 0;
        const rb = (bookAssignments.get(b.id) || []).find(x => x.s === col.slug)?.r || 0;
        return rb - ra;
      });

    // Pick sample books (top relevance, with thumbnails)
    const withThumbs = colBooks.filter(b => b.thumbnail_blob || b.thumbnail || b.photo);
    const samplePool = withThumbs.length >= 8 ? withThumbs : colBooks;
    const sampleBooks = samplePool.slice(0, 8).map(b => ({
      id: b.id,
      title: (b.display_title || b.title || '').substring(0, 100),
      author: (b.author || '').substring(0, 80),
      year: b.year,
      thumbnail: b.thumbnail_blob || b.thumbnail || b.photo || null,
    }));

    // Language distribution
    const langCounts = {};
    for (const b of colBooks) {
      const l = b.language || 'Unknown';
      langCounts[l] = (langCounts[l] || 0) + 1;
    }
    const languages = Object.entries(langCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([lang, count]) => ({ lang, count }));

    await collectionsColl.updateOne(
      { slug: col.slug },
      {
        $set: {
          slug: col.slug,
          name: col.name,
          subtitle: col.subtitle,
          description: col.description,
          color: col.color,
          order: col.order,
          book_count: colBooks.length,
          sample_books: sampleBooks,
          languages,
          updated_at: new Date(),
        },
        $setOnInsert: { created_at: new Date() },
      },
      { upsert: true }
    );
  }
  console.log(`  Collections metadata: ${COLLECTIONS.length} upserted`);

  // 3. Populate featured_images from gallery_images
  console.log('\nPopulating featured images from gallery...');
  const galleryImages = db.collection('gallery_images');

  for (const col of COLLECTIONS) {
    const colBookIds = books
      .filter(b => (bookAssignments.get(b.id) || []).some(x => x.s === col.slug))
      .map(b => b.id);

    if (colBookIds.length === 0) continue;

    const images = await galleryImages.aggregate([
      { $match: {
        book_id: { $in: colBookIds },
        gallery_quality: { $gte: 0.7 },
        thumbnail_url: { $exists: true, $ne: null },
      }},
      { $addFields: {
        _score: { $add: [
          { $multiply: ['$gallery_quality', 50] },
          { $cond: [{ $gt: [{ $size: { $ifNull: ['$metadata.subjects', []] } }, 0] }, 5, 0] },
          { $cond: [{ $and: [
            { $ne: ['$museum_description', null] },
            { $gt: [{ $strLenCP: { $ifNull: ['$museum_description', ''] } }, 50] },
          ]}, 10, 0] },
          { $cond: [{ $in: ['$type', ['emblem', 'engraving', 'frontispiece', 'diagram', 'portrait']] }, 10, 0] },
        ]},
      }},
      { $sort: { _score: -1 } },
      { $group: {
        _id: '$book_id',
        top: { $first: '$$ROOT' },
      }},
      { $replaceRoot: { newRoot: '$top' } },
      { $sort: { _score: -1 } },
      { $limit: 6 },
      { $project: {
        id: 1, page_id: 1, detection_index: 1,
        thumbnail_url: 1, extracted_url: 1, image_url: 1,
        description: 1, type: 1, gallery_quality: 1,
        book_id: 1, book_title: 1, book_author: 1, book_year: 1,
      }},
    ]).toArray();

    if (images.length > 0) {
      await collectionsColl.updateOne(
        { slug: col.slug },
        { $set: { featured_images: images } }
      );
      console.log(`  ${col.name}: ${images.length} featured images`);
    } else {
      console.log(`  ${col.name}: no gallery images found`);
    }
  }

  await client.close();
  console.log('\nDone.');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
