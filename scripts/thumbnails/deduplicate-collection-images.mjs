#!/usr/bin/env node
/**
 * Global deduplication of collection card images.
 *
 * Ensures every collection's hero image (featured_images[0]) is globally unique.
 * Uses a greedy most-constrained-first algorithm to maximize thematic relevance
 * while eliminating all cross-collection image sharing.
 *
 * For top-level collections without good gallery images, sources CC0 artwork
 * from the Metropolitan Museum Open Access API.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/thumbnails/deduplicate-collection-images.mjs
 *   node scripts/thumbnails/deduplicate-collection-images.mjs --dry-run
 */

import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');

// ── Thematic scoring (from backfill-collection-images.mjs) ──────────────

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'from', 'with', 'that', 'this', 'are', 'was', 'has',
  'its', 'into', 'their', 'also', 'all', 'can', 'not', 'but', 'more', 'most',
  'than', 'been', 'other', 'which', 'about', 'such', 'through', 'between',
  'texts', 'books', 'works', 'including', 'tradition', 'traditions',
]);

function extractKeywords(text) {
  if (!text) return [];
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function thematicRelevance(image, collectionKeywords) {
  if (collectionKeywords.length === 0) return 0;
  const imageText = [
    ...(image.metadata?.subjects || []),
    ...(image.metadata?.figures || []),
    ...(image.metadata?.symbols || []),
    image.description || '',
    image.museum_description || '',
    image.book_title || '',
    image.type || '',
  ].join(' ');
  const imageWords = new Set(extractKeywords(imageText));
  let hits = 0;
  for (const kw of collectionKeywords) {
    if (imageWords.has(kw)) hits++;
    else if ([...imageWords].some(w => w.startsWith(kw) || kw.startsWith(w))) hits += 0.5;
  }
  return Math.min(30, Math.round((hits / collectionKeywords.length) * 30));
}

/** Canonical ID for an image */
function imageId(img) {
  if (img.page_id && img.detection_index != null) return `${img.page_id}-${img.detection_index}`;
  return img.thumbnail_url || img.extracted_url || img.image_url || 'unknown';
}

/** Does the image have a proper gallery crop? */
function hasCrop(img) {
  return !!(img.thumbnail_url || img.extracted_url);
}

// ── Met Museum API for sourcing CC0 artwork ─────────────────────────────

/** Curated Met object IDs for key collections */
const MET_CURATED = {
  'secret-societies': [436532], // The Alchemist, Teniers
  'sacred-texts': [471869, 453363], // Quran folio, Book of Hours
  'psychology': [436819, 437984], // Melencolia I (Dürer), Saturn
  'sacred-texts': [453363, 471869], // Book of the Dead, Quran page
  'literature-poetry': [459053, 437329], // Dante, Homer
  'history-political-thought': [437397], // Napoleon
  'freemasonry': [434963, 411419], // Masonic symbols, George Washington
  'christianity': [436573, 437787], // Annunciation, Last Supper
  'mysticism': [436105], // Saint Francis in Ecstasy
  'the-classical-mysteries': [253594], // Dionysiac mysteries
};

async function fetchMetImage(objectId) {
  try {
    const res = await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${objectId}`);
    if (!res.ok) return null;
    const obj = await res.json();
    if (!obj.isPublicDomain || !obj.primaryImage) return null;
    return {
      url: obj.primaryImage,
      title: obj.title,
      artist: obj.artistDisplayName,
      date: obj.objectDate,
      museum: 'The Metropolitan Museum of Art',
      accession: obj.accessionNumber,
      object_id: objectId,
      license: 'CC0',
    };
  } catch { return null; }
}

async function searchMetMuseum(query, maxResults = 3) {
  try {
    const res = await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/search?q=${encodeURIComponent(query)}&hasImages=true&isPublicDomain=true`);
    if (!res.ok) return [];
    const data = await res.json();
    if (!data.objectIDs?.length) return [];
    const results = [];
    for (const id of data.objectIDs.slice(0, maxResults * 2)) {
      const img = await fetchMetImage(id);
      if (img) results.push(img);
      if (results.length >= maxResults) break;
      await new Promise(r => setTimeout(r, 300));
    }
    return results;
  } catch { return []; }
}

// ── Main ────────────────────────────────────────────────────────────────

async function run() {
  const client = await MongoClient.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 120000,
    maxIdleTimeMS: 60000,
  });
  const db = client.db('bookstore');

  console.log('Phase 1: Building affinity matrix...');

  const collections = await db.collection('collections').find({})
    .project({ slug: 1, name: 1, description: 1, book_count: 1, parent: 1, featured_images: 1 })
    .toArray();

  console.log(`  ${collections.length} collections`);

  // For each collection, gather candidate images with scores
  const affinity = new Map(); // slug -> [{ id, score, data }]

  for (const col of collections) {
    const colKeywords = extractKeywords(
      `${col.name} ${col.slug.replace(/-/g, ' ')} ${col.description || ''}`
    );

    const bookIds = await db.collection('books').distinct('id', {
      collections: col.slug, deleted: { $ne: true },
    });

    const candidates = new Map(); // imageId -> { score, data }

    // Source 1: gallery_images from collection's books
    if (bookIds.length > 0) {
      const galleryImgs = await db.collection('gallery_images').find({
        book_id: { $in: bookIds },
        gallery_quality: { $gte: 0.6 },
        $or: [
          { thumbnail_url: { $exists: true, $ne: null, $ne: '' } },
          { extracted_url: { $exists: true, $ne: null, $ne: '' } },
        ],
      }).project({
        id: 1, page_id: 1, detection_index: 1,
        thumbnail_url: 1, extracted_url: 1, image_url: 1,
        description: 1, type: 1, gallery_quality: 1,
        book_id: 1, book_title: 1, book_author: 1, book_year: 1,
        museum_description: 1, metadata: 1,
      }).sort({ gallery_quality: -1 }).limit(50).toArray();

      // Max 3 per book for diversity
      const perBook = {};
      for (const img of galleryImgs) {
        const bk = img.book_id;
        perBook[bk] = (perBook[bk] || 0) + 1;
        if (perBook[bk] > 3) continue;

        const id = imageId(img);
        const relevance = thematicRelevance(img, colKeywords);
        let score = (img.gallery_quality || 0) * 50
          + relevance
          + (hasCrop(img) ? 20 : 0)
          + (['emblem', 'engraving', 'frontispiece', 'diagram'].includes(img.type) ? 10 : 0)
          + (img.museum_description ? 5 : 0);

        const { metadata, ...clean } = img;
        if (!candidates.has(id) || candidates.get(id).score < score) {
          candidates.set(id, { id, score, data: clean });
        }
      }
    }

    // Source 2: existing featured_images (respect prior curation)
    if (col.featured_images?.length) {
      for (let i = 0; i < col.featured_images.length; i++) {
        const img = col.featured_images[i];
        const id = imageId(img);
        const relevance = thematicRelevance(img, colKeywords);
        let score = (img.gallery_quality || 0) * 50
          + relevance
          + (hasCrop(img) ? 20 : 0)
          + (i === 0 ? 15 : 0); // bonus for current hero
        if (!candidates.has(id) || candidates.get(id).score < score) {
          candidates.set(id, { id, score, data: img });
        }
      }
    }

    // Sort by score descending
    const sorted = [...candidates.values()].sort((a, b) => b.score - a.score);
    affinity.set(col.slug, sorted);

    if (VERBOSE && sorted.length > 0) {
      console.log(`  ${col.name}: ${sorted.length} candidates, top="${sorted[0].data.book_title?.slice(0, 40)}" (${sorted[0].score.toFixed(0)})`);
    }
  }

  // ── Phase 2: Greedy global assignment ──────────────────────────────────
  console.log('\nPhase 2: Global hero assignment (most-constrained-first)...');

  const usedImages = new Set();
  const heroAssignment = new Map(); // slug -> candidate
  const needsSourcing = []; // collections that got no hero

  // Sort collections: fewest candidates first
  const colsByConstraint = [...collections].sort((a, b) => {
    const aCount = affinity.get(a.slug)?.length || 0;
    const bCount = affinity.get(b.slug)?.length || 0;
    return aCount - bCount;
  });

  for (const col of colsByConstraint) {
    const candidates = affinity.get(col.slug) || [];
    let assigned = false;

    for (const cand of candidates) {
      if (!usedImages.has(cand.id)) {
        heroAssignment.set(col.slug, cand);
        usedImages.add(cand.id);
        assigned = true;
        break;
      }
    }

    if (!assigned) {
      needsSourcing.push(col);
    }
  }

  console.log(`  Assigned unique heroes: ${heroAssignment.size}`);
  console.log(`  Need sourcing: ${needsSourcing.length}`);

  // ── Phase 3: Source museum images for collections without heroes ────────
  if (needsSourcing.length > 0) {
    console.log('\nPhase 3: Sourcing museum images for collections without heroes...');

    for (const col of needsSourcing) {
      const isTopLevel = !col.parent;

      // Try curated Met IDs first
      const curatedIds = MET_CURATED[col.slug];
      if (curatedIds) {
        for (const objId of curatedIds) {
          const met = await fetchMetImage(objId);
          if (met) {
            const id = `met-${objId}`;
            heroAssignment.set(col.slug, {
              id,
              score: 100,
              data: {
                image_url: met.url,
                description: `${met.title} by ${met.artist || 'Unknown'}, ${met.date || ''}`,
                type: 'museum-artwork',
                book_title: met.title,
                book_author: met.artist,
                book_year: met.date,
                _museum_attribution: met,
              },
            });
            usedImages.add(id);
            console.log(`  ${col.name}: Met curated #${objId} "${met.title}"`);
            break;
          }
          await new Promise(r => setTimeout(r, 300));
        }
      }

      // If still no hero and it's a top-level collection, search Met
      if (!heroAssignment.has(col.slug) && isTopLevel) {
        const searchTerms = col.name.replace(/[&,]/g, ' ').trim();
        const results = await searchMetMuseum(searchTerms, 2);
        for (const met of results) {
          const id = `met-${met.object_id}`;
          if (!usedImages.has(id)) {
            heroAssignment.set(col.slug, {
              id,
              score: 80,
              data: {
                image_url: met.url,
                description: `${met.title} by ${met.artist || 'Unknown'}, ${met.date || ''}`,
                type: 'museum-artwork',
                book_title: met.title,
                book_author: met.artist,
                book_year: met.date,
                _museum_attribution: met,
              },
            });
            usedImages.add(id);
            console.log(`  ${col.name}: Met search "${met.title}"`);
            break;
          }
        }
        await new Promise(r => setTimeout(r, 500));
      }

      if (!heroAssignment.has(col.slug)) {
        console.log(`  ${col.name}: NO IMAGE FOUND`);
      }
    }
  }

  // ── Phase 4: Build final featured_images arrays ────────────────────────
  console.log('\nPhase 4: Building final arrays...');

  const updates = []; // { slug, featured_images }

  for (const col of collections) {
    const hero = heroAssignment.get(col.slug);
    if (!hero) continue;

    // Fill remaining slots with unused images from this collection's candidates
    const candidates = affinity.get(col.slug) || [];
    const images = [hero.data];
    const usedInThisCol = new Set([hero.id]);

    for (const cand of candidates) {
      if (images.length >= 6) break;
      if (usedInThisCol.has(cand.id)) continue;
      // For non-hero slots, allow cross-collection sharing but prefer unique
      usedInThisCol.add(cand.id);
      images.push(cand.data);
    }

    // Strip internal fields before storing
    const cleanImages = images.map(img => {
      const { _quality_score, _relevance, _total_score, metadata, _museum_attribution, ...clean } = img;
      return clean;
    });

    updates.push({ slug: col.slug, featured_images: cleanImages });
  }

  // ── Phase 5: Write to DB ───────────────────────────────────────────────
  console.log(`\nPhase 5: Writing ${updates.length} collections...`);

  if (!DRY_RUN) {
    await client.close();
    const writeClient = await MongoClient.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 60000,
    });
    const writeDb = writeClient.db('bookstore');

    const ops = updates.map(u => ({
      updateOne: {
        filter: { slug: u.slug },
        update: { $set: { featured_images: u.featured_images, featured_images_updated: new Date() } },
      },
    }));

    for (let i = 0; i < ops.length; i += 50) {
      const chunk = ops.slice(i, i + 50);
      await writeDb.collection('collections').bulkWrite(chunk, { ordered: false });
      console.log(`  Written ${Math.min(i + 50, ops.length)}/${ops.length}`);
    }

    await writeClient.close();
  } else {
    console.log('  [DRY RUN - no writes]');
    await client.close();
  }

  // ── Summary ────────────────────────────────────────────────────────────
  const noHero = collections.filter(c => !heroAssignment.has(c.slug));
  const withCrop = [...heroAssignment.values()].filter(h => hasCrop(h.data));
  const museumSourced = [...heroAssignment.values()].filter(h => h.data.type === 'museum-artwork');

  console.log('\n=== RESULTS ===');
  console.log(`Collections: ${collections.length}`);
  console.log(`Unique heroes assigned: ${heroAssignment.size}`);
  console.log(`Heroes with gallery crop: ${withCrop.length}`);
  console.log(`Museum-sourced heroes: ${museumSourced.length}`);
  console.log(`No hero: ${noHero.length}`);
  if (noHero.length > 0) {
    console.log('  Missing:', noHero.map(c => c.name).join(', '));
  }

  // Verify uniqueness
  const heroUrls = new Map();
  for (const [slug, hero] of heroAssignment) {
    const url = hero.data.thumbnail_url || hero.data.extracted_url || hero.data.image_url;
    if (heroUrls.has(url)) {
      console.log(`  DUPLICATE: ${slug} and ${heroUrls.get(url)} share ${url?.slice(-50)}`);
    } else {
      heroUrls.set(url, slug);
    }
  }
}

run().catch(err => { console.error(err); process.exit(1); });
