#!/usr/bin/env node
/**
 * Rework sub-collections: add tradition-based subs, split/rename existing ones.
 *
 * What this does:
 * 1. Removes books from old sub-collections being replaced
 * 2. Deletes old sub-collection docs
 * 3. Creates new sub-collection docs
 * 4. Reclassifies books (rule-based + Gemini)
 * 5. Updates book_counts
 * 6. Renames theology → Christian Theology
 *
 * Usage:
 *   node scripts/rework-subcollections.mjs [--dry-run] [--skip-gemini] [--parent alchemy]
 */

import { MongoClient } from 'mongodb';
import { GoogleGenAI } from '@google/genai';

const MONGODB_URI = process.env.MONGODB_URI;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SKIP_GEMINI = args.includes('--skip-gemini');
const parentFilter = args.find(a => a.startsWith('--parent='))?.split('=')[1]
  || (args.includes('--parent') ? args[args.indexOf('--parent') + 1] : null);

// ─── What to remove (old subs being replaced) ───

const REMOVE_SUBS = {
  'natural-philosophy': ['early-modern-science', 'mathematics-harmony'],
  // All other existing subs stay — we're adding to them
};

// ─── New sub-collections to create ───

const NEW_SUBS = {
  alchemy: [
    { slug: 'daoist-alchemy', name: 'Daoist Alchemy', subtitle: 'Neidan (inner alchemy), waidan (outer alchemy), the Cantong Qi, and the Daozang alchemical corpus' },
    { slug: 'arabic-alchemy', name: 'Arabic Alchemy', subtitle: 'Jabir ibn Hayyan, al-Razi, the Ghayat al-Hakim — the Arabic alchemical tradition that transmitted Greek knowledge to Europe' },
  ],
  'natural-philosophy': [
    { slug: 'mathematics', name: 'Mathematics', subtitle: 'Geometry, number theory, arithmetic, and algebra — Euclid, Archimedes, al-Khwarizmi, Cardano' },
    { slug: 'music-harmony', name: 'Music & Harmony', subtitle: 'Musica mundana, tuning systems, the Pythagorean tradition of cosmic harmony, Boethius, Zarlino' },
    { slug: 'mechanical-engineering', name: 'Mechanical Engineering', subtitle: 'Machines, architecture, fortification, military engineering, hydraulics — from Vitruvius to the Renaissance engineers' },
    { slug: 'experimental-philosophy', name: 'Experimental Philosophy', subtitle: 'The Royal Society tradition — Boyle, Hooke, pneumatics, the empirical method, instrument-making' },
    { slug: 'optics', name: 'Optics', subtitle: 'Light, color, perspective, camera obscura — Alhazen, Bacon, Kepler, Newton' },
    { slug: 'natural-history', name: 'Natural History', subtitle: 'Pliny, Gesner, Aldrovandi — the descriptive tradition of zoology, mineralogy, and specimen collecting' },
    { slug: 'encyclopedic-works', name: 'Encyclopedic Works', subtitle: 'Kircher, the Sancai Tuhui, universal knowledge projects — compendia that map the whole of natural knowledge' },
    { slug: 'chinese-natural-knowledge', name: 'Chinese Natural Knowledge', subtitle: 'The investigation of nature in the Chinese tradition — from the Shanhai Jing to the Tiangong Kaiwu' },
    { slug: 'indian-natural-philosophy', name: 'Indian Natural Philosophy', subtitle: 'Astronomical, mathematical, and cosmological traditions of the Indian subcontinent' },
  ],
  medicine: [
    { slug: 'chinese-medicine', name: 'Chinese Medicine', subtitle: 'Huangdi Neijing, Bencao Gangmu, acupuncture, materia medica — the Chinese medical tradition' },
  ],
  astrology: [
    { slug: 'chinese-astrology', name: 'Chinese Astrology', subtitle: 'Celestial observation, the lunar mansions, Daoist cosmological divination, and imperial astronomical traditions' },
  ],
  magic: [
    { slug: 'chinese-daoist-magic', name: 'Chinese & Daoist Magic', subtitle: 'Fangshi traditions, Daoist ritual, talismanic practice, and divinatory arts of the Chinese tradition' },
    { slug: 'arabic-islamic-magic', name: 'Arabic & Islamic Magic', subtitle: 'Shams al-Maarif, Ghayat al-Hakim (Picatrix), Sufi esoteric practice, and the jinn traditions' },
  ],
  mysticism: [
    // Existing subs already cover traditions well. No changes needed.
  ],
};

// ─── Rule-based classification for NEW subs only ───

function lc(s) { return (s || '').toLowerCase(); }
function hasCat(cats, ...targets) { return targets.some(t => cats.includes(t)); }
function authorMatch(author, ...patterns) {
  const a = lc(author);
  return patterns.some(p => a.includes(p));
}
function titleMatch(title, ...patterns) {
  const t = lc(title);
  return patterns.some(p => t.includes(p));
}

// These rules ONLY classify into the NEW subs.
// Books already in existing subs are left alone.
const NEW_RULES = {
  alchemy: (b) => {
    const cats = (b.categories || []).map(lc);
    const lang = lc(b.language);
    if (['chinese'].includes(lang) || (hasCat(cats, 'daoism') && hasCat(cats, 'alchemy', 'spiritual-alchemy')))
      return 'daoist-alchemy';
    if (['arabic', 'persian'].includes(lang))
      return 'arabic-alchemy';
    return null;
  },
  'natural-philosophy': (b) => {
    const cats = (b.categories || []).map(lc);
    const lang = lc(b.language);
    const title = lc(b.display_title || b.title || '');

    // Tradition-based first
    if (['chinese'].includes(lang)) return 'chinese-natural-knowledge';
    if (['sanskrit', 'tamil', 'telugu', 'pali', 'tibetan'].includes(lang)) return 'indian-natural-philosophy';

    // Was in mathematics-harmony — split into math vs music
    if (hasCat(cats, 'music')) return 'music-harmony';
    if (hasCat(cats, 'mathematics')) return 'mathematics';

    // Was in early-modern-science — distribute to specific subs
    if (hasCat(cats, 'architecture', 'military') || titleMatch(title, 'fortif', 'machin', 'architec', 'engineer', 'artiller', 'hydraul'))
      return 'mechanical-engineering';
    if (hasCat(cats, 'physics') || titleMatch(title, 'optic', 'perspectiv', 'light', 'color', 'colour', 'camera obscura', 'dioptric', 'catoptric'))
      return 'optics';
    if (hasCat(cats, 'botany', 'zoology', 'natural history', 'mineralogy') || authorMatch(b.author, 'pliny', 'gesner', 'aldrovand', 'buffon'))
      return 'natural-history';
    if (titleMatch(title, 'encyclop', 'compendium', 'thesaurus', 'theatrum', 'museum') || authorMatch(b.author, 'kircher'))
      return 'encyclopedic-works';
    // Experimental: post-1600, empirical authors
    if ((b.year || 0) >= 1600 && (
      authorMatch(b.author, 'boyle', 'hooke', 'newton', 'harvey', 'huygens', 'leibniz', 'galileo', 'bacon') ||
      hasCat(cats, 'chemistry', 'physics')
    )) return 'experimental-philosophy';

    return null;
  },
  medicine: (b) => {
    const lang = lc(b.language);
    if (['chinese'].includes(lang)) return 'chinese-medicine';
    return null;
  },
  astrology: (b) => {
    const lang = lc(b.language);
    if (['chinese'].includes(lang)) return 'chinese-astrology';
    return null;
  },
  magic: (b) => {
    const cats = (b.categories || []).map(lc);
    const lang = lc(b.language);
    if (['chinese'].includes(lang) || (hasCat(cats, 'daoism') && hasCat(cats, 'divination', 'ritual-magic')))
      return 'chinese-daoist-magic';
    if (['arabic', 'persian'].includes(lang))
      return 'arabic-islamic-magic';
    return null;
  },
};

// ─── Gemini classification ───

async function classifyWithGemini(ai, books, parentSlug, subcollections) {
  const subDescriptions = subcollections.map(s =>
    `- "${s.slug}": ${s.name} — ${s.subtitle}`
  ).join('\n');

  const results = [];
  const BATCH = 30;

  for (let i = 0; i < books.length; i += BATCH) {
    const batch = books.slice(i, i + BATCH);
    const bookList = batch.map((b, idx) =>
      `${idx + 1}. "${b.display_title || b.title}" by ${b.author || 'Unknown'} (${b.year || '?'}, ${b.language || '?'}) [categories: ${(b.categories || []).join(', ') || 'none'}]`
    ).join('\n');

    const prompt = `You are classifying books in the "${parentSlug}" collection into sub-collections.

Sub-collections:
${subDescriptions}

For each book below, respond with ONLY the sub-collection slug, or "none" if it doesn't fit any well. One line per book, format: "NUMBER: SLUG"

Books:
${bookList}`;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: prompt,
      });
      const text = response.text || '';
      const lines = text.trim().split('\n');
      for (const line of lines) {
        const match = line.match(/^(\d+):\s*(\S+)/);
        if (match) {
          const idx = parseInt(match[1]) - 1;
          const slug = match[2].toLowerCase().replace(/"/g, '');
          if (idx >= 0 && idx < batch.length && slug !== 'none') {
            const validSlugs = subcollections.map(s => s.slug);
            if (validSlugs.includes(slug)) {
              results.push({ bookId: batch[idx].id, subSlug: slug });
            }
          }
        }
      }
    } catch (err) {
      console.error(`  Gemini batch error (offset ${i}):`, err.message);
    }

    if (i + BATCH < books.length) await new Promise(r => setTimeout(r, 1000));
  }

  return results;
}

// ─── Main ───

async function main() {
  const client = await MongoClient.connect(MONGODB_URI);
  const db = client.db('bookstore');
  const ai = GEMINI_KEY ? new GoogleGenAI({ apiKey: GEMINI_KEY }) : null;

  // ── Step 0: Rename theology → Christian Theology ──
  if (!parentFilter || parentFilter === 'theology') {
    console.log('\n── Renaming theology → Christian Theology ──');
    if (!DRY_RUN) {
      const result = await db.collection('collections').updateOne(
        { slug: 'theology' },
        { $set: { name: 'Christian Theology' } },
      );
      console.log(result.modifiedCount ? '  Renamed.' : '  Already named or not found.');
    } else {
      console.log('  [dry-run] Would rename theology to "Christian Theology"');
    }
  }

  // ── Step 1: Remove old subs ──
  const parentsToClean = parentFilter ? [parentFilter] : Object.keys(REMOVE_SUBS);
  for (const parentSlug of parentsToClean) {
    const toRemove = REMOVE_SUBS[parentSlug];
    if (!toRemove || toRemove.length === 0) continue;

    console.log(`\n── Removing old subs from ${parentSlug}: ${toRemove.join(', ')} ──`);

    for (const oldSlug of toRemove) {
      // Remove from books' collections arrays
      if (!DRY_RUN) {
        const pullResult = await db.collection('books').updateMany(
          { collections: oldSlug },
          { $pull: { collections: oldSlug } },
        );
        console.log(`  Removed "${oldSlug}" from ${pullResult.modifiedCount} books`);

        // Delete the sub-collection doc
        await db.collection('collections').deleteOne({ slug: oldSlug });
        console.log(`  Deleted collection doc: ${oldSlug}`);
      } else {
        const count = await db.collection('books').countDocuments({ collections: oldSlug });
        console.log(`  [dry-run] Would remove "${oldSlug}" from ${count} books and delete doc`);
      }
    }
  }

  // ── Step 2: Create new subs + classify ──
  const parentsToProcess = parentFilter ? [parentFilter] : Object.keys(NEW_SUBS);
  let totalCreated = 0;
  let totalAssigned = 0;
  let totalGemini = 0;

  for (const parentSlug of parentsToProcess) {
    const newSubs = NEW_SUBS[parentSlug];
    if (!newSubs || newSubs.length === 0) continue;

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  ${parentSlug.toUpperCase()} — adding ${newSubs.length} new subs`);
    console.log(`${'═'.repeat(60)}`);

    // Create sub-collection documents
    for (const sub of newSubs) {
      const exists = await db.collection('collections').findOne({ slug: sub.slug });
      if (exists) {
        console.log(`  [exists] ${sub.slug}`);
        continue;
      }
      if (DRY_RUN) {
        console.log(`  [dry-run] Would create: ${sub.slug}`);
      } else {
        await db.collection('collections').insertOne({
          slug: sub.slug,
          name: sub.name,
          subtitle: sub.subtitle,
          parent: parentSlug,
          book_count: 0,
          hidden: false,
          type: 'category',
          order: 0,
          languages: [],
          featured_images: [],
          created_at: new Date(),
        });
        console.log(`  [created] ${sub.slug}`);
        totalCreated++;
      }
    }

    // Fetch all books in parent collection
    const books = await db.collection('books').find(
      { collections: parentSlug, status: { $ne: 'deleted' }, hidden: { $ne: true } },
      { projection: { id: 1, title: 1, display_title: 1, author: 1, year: 1, language: 1, categories: 1, collections: 1 } },
    ).toArray();

    // Get ALL valid sub-slugs for this parent (existing + new)
    const allSubDocs = await db.collection('collections').find(
      { parent: parentSlug },
      { projection: { slug: 1 } }
    ).toArray();
    const allSubSlugs = new Set(allSubDocs.map(d => d.slug));
    const newSubSlugs = new Set(newSubs.map(s => s.slug));

    // Find books not yet in ANY sub-collection of this parent
    const unassigned = books.filter(b => {
      const bookCols = new Set(b.collections || []);
      return ![...allSubSlugs].some(s => bookCols.has(s));
    });

    // Also find books that should be MOVED from a Western sub to a tradition sub
    // (e.g., Chinese books in "herbals-botany" → "chinese-medicine")
    const TRADITION_REASSIGN = {
      medicine: { langs: ['chinese'], target: 'chinese-medicine', from: ['herbals-botany', 'galenic-classical-medicine', 'paracelsian-iatrochemistry', 'early-modern-medicine-sub'] },
      astrology: { langs: ['chinese'], target: 'chinese-astrology', from: ['horoscopic-western-astrology', 'celestial-divination'] },
      'natural-philosophy': { langs: ['chinese'], target: 'chinese-natural-knowledge', from: ['cosmology-astronomy', 'natural-magic-sympathies', 'geography-exploration'] },
      alchemy: { langs: ['chinese'], target: 'daoist-alchemy', from: ['spiritual-alchemy', 'laboratory-chemistry', 'paracelsian-medicine', 'rosicrucian-alchemy'] },
      magic: { langs: ['chinese'], target: 'chinese-daoist-magic', from: ['ritual-ceremonial-magic', 'natural-magic-sub', 'divination-oracles'] },
    };
    const reassignConf = TRADITION_REASSIGN[parentSlug];
    const reassignments = new Map(); // bookId -> { from: oldSlug, to: newSlug }
    if (reassignConf) {
      for (const book of books) {
        const lang = (book.language || '').toLowerCase();
        if (!reassignConf.langs.includes(lang)) continue;
        const bookCols = book.collections || [];
        const currentSub = bookCols.find(c => reassignConf.from.includes(c));
        if (currentSub) {
          reassignments.set(book.id, { from: currentSub, to: reassignConf.target });
        }
      }
      if (reassignments.size > 0) {
        console.log(`  ${reassignments.size} books to reassign from Western → tradition subs`);
      }
    }

    // Also reassign Indian books in natural-philosophy
    if (parentSlug === 'natural-philosophy') {
      for (const book of books) {
        const lang = (book.language || '').toLowerCase();
        if (!['sanskrit', 'tamil', 'telugu', 'pali', 'tibetan'].includes(lang)) continue;
        const bookCols = book.collections || [];
        const westernSub = bookCols.find(c => ['cosmology-astronomy', 'natural-magic-sympathies', 'geography-exploration'].includes(c));
        if (westernSub && !reassignments.has(book.id)) {
          reassignments.set(book.id, { from: westernSub, to: 'indian-natural-philosophy' });
        }
      }
    }
    // Arabic books in alchemy/magic
    if (parentSlug === 'alchemy') {
      for (const book of books) {
        const lang = (book.language || '').toLowerCase();
        if (!['arabic', 'persian'].includes(lang)) continue;
        const bookCols = book.collections || [];
        const westernSub = bookCols.find(c => ['spiritual-alchemy', 'laboratory-chemistry', 'paracelsian-medicine', 'rosicrucian-alchemy'].includes(c));
        if (westernSub && !reassignments.has(book.id)) {
          reassignments.set(book.id, { from: westernSub, to: 'arabic-alchemy' });
        }
      }
    }
    if (parentSlug === 'magic') {
      for (const book of books) {
        const lang = (book.language || '').toLowerCase();
        if (!['arabic', 'persian'].includes(lang)) continue;
        const bookCols = book.collections || [];
        const westernSub = bookCols.find(c => ['ritual-ceremonial-magic', 'natural-magic-sub', 'divination-oracles'].includes(c));
        if (westernSub && !reassignments.has(book.id)) {
          reassignments.set(book.id, { from: westernSub, to: 'arabic-islamic-magic' });
        }
      }
    }

    console.log(`  ${books.length} total, ${unassigned.length} unassigned to any sub`);

    // Rule-based pass on unassigned books
    const assigned = new Map();
    const ruleFn = NEW_RULES[parentSlug];
    if (ruleFn) {
      for (const book of unassigned) {
        const sub = ruleFn(book);
        if (sub && newSubSlugs.has(sub)) {
          assigned.set(book.id, sub);
        }
      }
      console.log(`  Rule-based: ${assigned.size} assigned to new subs`);
    }

    // Gemini pass for remaining unassigned
    const stillUnassigned = unassigned.filter(b => !assigned.has(b.id));
    if (stillUnassigned.length > 0 && ai && !SKIP_GEMINI) {
      // For Gemini, provide ALL subs (existing + new) so it can classify into any
      const allSubsForGemini = allSubDocs.map(d => d.slug);
      const allSubDetails = await db.collection('collections').find(
        { slug: { $in: allSubsForGemini } },
        { projection: { slug: 1, name: 1, subtitle: 1 } }
      ).toArray();

      console.log(`  Gemini pass: ${stillUnassigned.length} remaining...`);
      const geminiResults = await classifyWithGemini(ai, stillUnassigned, parentSlug, allSubDetails);
      for (const { bookId, subSlug } of geminiResults) {
        if (allSubSlugs.has(subSlug)) {
          assigned.set(bookId, subSlug);
          totalGemini++;
        }
      }
      console.log(`  Gemini assigned: ${geminiResults.length}`);
    } else if (stillUnassigned.length > 0 && !SKIP_GEMINI) {
      console.log(`  ${stillUnassigned.length} still unassigned (no Gemini key)`);
    }

    // Apply reassignments (move from Western sub → tradition sub)
    if (reassignments.size > 0 && !DRY_RUN) {
      const bulkReassign = [...reassignments.entries()].flatMap(([bookId, { from, to }]) => [
        { updateOne: { filter: { id: bookId }, update: { $pull: { collections: from } } } },
        { updateOne: { filter: { id: bookId }, update: { $addToSet: { collections: to } } } },
      ]);
      await db.collection('books').bulkWrite(bulkReassign);
      console.log(`  Reassigned: ${reassignments.size} books moved to tradition subs`);
      totalAssigned += reassignments.size;
    } else if (DRY_RUN && reassignments.size > 0) {
      const dist = {};
      for (const [, { from, to }] of reassignments) {
        const key = `${from} → ${to}`;
        dist[key] = (dist[key] || 0) + 1;
      }
      for (const [k, v] of Object.entries(dist)) console.log(`    ${k}: ${v}`);
    }

    // Apply new assignments
    if (assigned.size > 0 && !DRY_RUN) {
      const bulkOps = [...assigned.entries()].map(([bookId, subSlug]) => ({
        updateOne: {
          filter: { id: bookId },
          update: { $addToSet: { collections: subSlug } },
        },
      }));
      const result = await db.collection('books').bulkWrite(bulkOps);
      console.log(`  Applied: ${result.modifiedCount} books updated`);
      totalAssigned += result.modifiedCount;
    } else if (DRY_RUN && assigned.size > 0) {
      const dist = {};
      for (const [, sub] of assigned) dist[sub] = (dist[sub] || 0) + 1;
      console.log(`  Distribution:`);
      for (const [slug, count] of Object.entries(dist).sort((a, b) => b[1] - a[1])) {
        console.log(`    ${slug}: ${count}`);
      }
    }

    // Update book_counts for ALL subs of this parent
    if (!DRY_RUN) {
      for (const subDoc of allSubDocs) {
        const count = await db.collection('books').countDocuments({
          collections: subDoc.slug, status: { $ne: 'deleted' }, hidden: { $ne: true },
          pages_translated: { $gt: 0 },
        });
        await db.collection('collections').updateOne(
          { slug: subDoc.slug },
          { $set: { book_count: count } },
        );
      }
      console.log(`  Updated book_counts for all ${allSubDocs.length} subs`);
    }
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Done. Created: ${totalCreated}, Assigned: ${totalAssigned}, Gemini: ${totalGemini}`);
  if (DRY_RUN) console.log('(dry run — no changes made)');

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
