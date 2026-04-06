#!/usr/bin/env node
/**
 * AI-powered collection assignment using Gemini Flash Lite.
 *
 * For each book, sends metadata to Gemini and gets back:
 *   - Which collections (1-3) the book belongs to
 *   - A relevance score (0-100) for each
 *
 * Default behavior: only processes books that have not been AI-classified yet
 * (no `collection_scores` field). Use --force to reclassify everything.
 *
 * Writes are additive:
 *   - $addToSet for collections array (never removes existing assignments)
 *   - dot-notation $set for collection_relevance (preserves scores from other sources)
 *   - collection_scores marker records that AI classification has run
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; \
 *   node scripts/enrichment/assign-collections-ai.mjs \
 *     [--dry-run] [--force] [--limit N] [--offset N] [--concurrency N] \
 *     [--batch-size N] [--update-metadata]
 */

import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ── Fallback Collection Definitions (used if DB returns empty) ────────────────

const FALLBACK_COLLECTIONS = [
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
    subtitle: 'Foundational Scriptures of the World\'s Traditions',
    description: 'The foundational scriptures of the world\'s spiritual traditions — the Bible, Quran, Vedas, Upanishads, Buddhist sutras, Daoist classics, Sumerian hymns, Zoroastrian texts, and sacred literature from all traditions. Includes Church Fathers, liturgical texts, and core commentaries.',
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
    subtitle: 'Humanism, Neoplatonism & the Dignity of Man',
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
    subtitle: 'From Hippocrates to Paracelsus',
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
    subtitle: 'From Gilgamesh to the Divine Comedy',
    description: 'Literary works from classical epic to early modern prose — Homer, Virgil, Dante, alchemical allegories, utopian fiction, courtly romance, and the literary imagination.',
    color: 'sage',
    order: 18,
  },
];

// ── Build collection summary string for the prompt ────────────────────────────

function buildCollectionSummary(collections) {
  return collections.map(c => `- ${c.slug}: ${c.name} — ${c.description}`).join('\n');
}

// ── Gemini Classification ─────────────────────────────────────────────────────

const MODEL = 'gemini-3.1-flash-lite-preview';

function buildSystemPrompt(collections) {
  const summary = buildCollectionSummary(collections);
  return `You are a specialist librarian classifying rare books into thematic collections. For each book, assign 1-3 collections that BEST fit, with a relevance score.

COLLECTIONS:
${summary}

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
}

async function classifyBatch(genai, books, collections, batchIndex) {
  const validSlugs = new Set(collections.map(c => c.slug));
  const systemPrompt = buildSystemPrompt(collections);

  const booksText = books.map((b, i) => {
    const cats = (b.categories || []).slice(0, 8).join(', ');
    return `[${i}] "${(b.display_title || b.title || 'Untitled').substring(0, 120)}" by ${(b.author || 'Unknown').substring(0, 60)} (${b.year || '?'}, ${b.language || '?'}) [${cats}]`;
  }).join('\n');

  const prompt = `Classify these ${books.length} books:\n\n${booksText}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const model = genai.getGenerativeModel({
        model: MODEL,
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
        systemInstruction: systemPrompt,
      });

      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();
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

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');
  const updateMetadata = args.includes('--update-metadata');

  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 0;
  const offsetIdx = args.indexOf('--offset');
  const offset = offsetIdx >= 0 ? parseInt(args[offsetIdx + 1]) : 0;
  const concurrencyIdx = args.indexOf('--concurrency');
  const concurrency = concurrencyIdx >= 0 ? parseInt(args[concurrencyIdx + 1]) : 5;
  const batchSizeArg = args.find(a => a.startsWith('--batch-size='));
  const BATCH_SIZE = batchSizeArg ? parseInt(batchSizeArg.split('=')[1]) : 25;

  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }
  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY not set');
    process.exit(1);
  }

  const genai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // ── Load collections from DB, fall back to hardcoded list ──
  let collections = await db.collection('collections').find({}).toArray();
  if (collections.length === 0) {
    console.log('No collections in DB — using fallback list');
    collections = FALLBACK_COLLECTIONS;
  } else {
    console.log(`Loaded ${collections.length} collections from DB`);
    // Ensure required fields exist; patch from fallback if needed
    const fallbackMap = new Map(FALLBACK_COLLECTIONS.map(c => [c.slug, c]));
    collections = collections.map(c => ({
      slug: c.slug,
      name: c.name || fallbackMap.get(c.slug)?.name || c.slug,
      description: c.description || fallbackMap.get(c.slug)?.description || '',
      subtitle: c.subtitle || fallbackMap.get(c.slug)?.subtitle || '',
      color: c.color || fallbackMap.get(c.slug)?.color || 'sage',
      order: c.order ?? fallbackMap.get(c.slug)?.order ?? 99,
    }));
    // Sort by order
    collections.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  }

  // ── Build book query ──
  const baseQuery = force
    ? { status: { $ne: 'deleted' }, pages_count: { $gt: 0 }, hidden: { $ne: true } }
    : { collection_scores: { $exists: false }, pages_count: { $gt: 0 }, hidden: { $ne: true } };

  const projection = {
    id: 1, title: 1, display_title: 1, author: 1, year: 1, language: 1,
    categories: 1, pages_count: 1, thumbnail: 1, thumbnail_blob: 1, photo: 1,
  };

  let cursor = db.collection('books')
    .find(baseQuery, { projection })
    .sort({ created_at: 1 })
    .skip(offset);
  if (limit) cursor = cursor.limit(limit);
  const books = await cursor.toArray();

  console.log(`Mode: ${force ? '--force (reclassify all)' : 'incremental (unclassified only)'}`);
  console.log(`Loaded ${books.length} books (offset=${offset})\n`);

  if (books.length === 0) {
    console.log('No books to process.');
    await client.close();
    return;
  }

  // ── Batch classify ──
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
      classifyBatch(genai, batch, collections, i + j).then(results => {
        const validSlugs = new Set(collections.map(c => c.slug));
        for (const result of results) {
          const bookIdx = (i + j) * BATCH_SIZE + result.i;
          const book = books[bookIdx];
          if (!book) continue;
          const assignments = (result.c || [])
            .filter(a => a.s && validSlugs.has(a.s) && a.r >= 50)
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

  // ── Summarize ──
  const collectionCounts = {};
  for (const col of collections) collectionCounts[col.slug] = 0;
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
  for (const col of collections) {
    const count = collectionCounts[col.slug] || 0;
    if (count > 0) console.log(`${col.name}: ${count} books`);
  }
  console.log(`\nTotal assignments: ${totalAssignments} (avg ${(totalAssignments / books.length).toFixed(1)} per book)`);
  console.log(`Unassigned: ${unassigned} books`);
  console.log(`Assigned: ${books.length - unassigned} books\n`);

  // Show sample unassigned
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
    console.log();
  }

  if (dryRun) {
    console.log('[DRY RUN] No changes written.');
    await client.close();
    return;
  }

  // ── Write to DB (additive) ──
  console.log('Writing to database...');

  // Update each book: additive collections, dot-notation relevance, collection_scores marker
  const bulkOps = [];
  for (const book of books) {
    const assignments = bookAssignments.get(book.id) || [];
    if (assignments.length === 0) continue; // don't write marker for unclassified books

    const slugs = assignments.map(a => a.s);

    // Build dot-notation relevance updates
    const relevanceSets = {};
    for (const a of assignments) {
      relevanceSets[`collection_relevance.${a.s}`] = a.r;
    }

    bulkOps.push({
      updateOne: {
        filter: { id: book.id },
        update: {
          $addToSet: { collections: { $each: slugs } },
          $set: {
            ...relevanceSets,
            collection_scores: {
              assigned_at: new Date(),
              model: MODEL,
            },
            updated_at: new Date(),
          },
        },
      },
    });
  }

  // Also write collection_scores marker as "skipped" for books with zero assignments
  // so they don't get re-processed on next incremental run
  const skippedOps = [];
  for (const book of books) {
    const assignments = bookAssignments.get(book.id) || [];
    if (assignments.length === 0) {
      skippedOps.push({
        updateOne: {
          filter: { id: book.id },
          update: {
            $set: {
              collection_scores: {
                assigned_at: new Date(),
                model: MODEL,
                result: 'no_match',
              },
            },
          },
        },
      });
    }
  }

  const WRITE_BATCH = 500;
  let updated = 0;
  const allOps = [...bulkOps, ...skippedOps];
  for (let i = 0; i < allOps.length; i += WRITE_BATCH) {
    const batch = allOps.slice(i, i + WRITE_BATCH);
    const result = await db.collection('books').bulkWrite(batch);
    updated += result.modifiedCount;
    process.stdout.write(`  Books: ${Math.min(i + WRITE_BATCH, allOps.length)}/${allOps.length}\r`);
  }
  console.log(`  Books updated: ${updated}                `);

  // ── Collection metadata update (only if --update-metadata or processed >100 books) ──
  const shouldUpdateMetadata = updateMetadata || books.length > 100;
  if (shouldUpdateMetadata) {
    console.log('\nUpdating collection metadata...');
    const collectionsColl = db.collection('collections');

    for (const col of collections) {
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

      if (colBooks.length === 0) continue;

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
            sample_books: sampleBooks,
            languages,
            updated_at: new Date(),
          },
          $setOnInsert: { created_at: new Date() },
          $inc: { book_count: colBooks.length },
        },
        { upsert: true }
      );
    }
    console.log(`  Collection metadata updated for ${collections.filter(c => (collectionCounts[c.slug] || 0) > 0).length} collections`);

    // Populate featured_images from gallery_images
    console.log('\nPopulating featured images from gallery...');
    const galleryImages = db.collection('gallery_images');

    for (const col of collections) {
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
      }
    }
  } else {
    console.log('\nSkipping metadata update (< 100 books processed; use --update-metadata to force)');
  }

  // ── Final summary ──
  console.log('\n=== SUMMARY ===');
  console.log(`Books processed: ${books.length}`);
  console.log(`Assignments made: ${totalAssignments} across ${books.length - unassigned} books`);
  console.log(`Unmatched: ${unassigned} books`);
  console.log('\nBy collection:');
  for (const col of collections) {
    const count = collectionCounts[col.slug] || 0;
    if (count > 0) console.log(`  ${col.slug}: ${count}`);
  }
  console.log('\nDone.');

  await client.close();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
