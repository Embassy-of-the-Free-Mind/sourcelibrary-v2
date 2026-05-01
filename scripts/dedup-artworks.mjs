#!/usr/bin/env node
/**
 * Deduplicate artwork records across collections.
 *
 * Problem: The same painting was imported multiple times from different
 * Commons uploads — tourist photos, detail crops, different-language titles,
 * Flickr snapshots. This script clusters near-duplicates and hides the
 * lower-quality versions.
 *
 * Strategy:
 * 1. Group by artist + normalized title (strip language prefixes, parens,
 *    numbers, punctuation → core subject)
 * 2. Score each record: resolution, has enrichment, has commons_url,
 *    clean reproduction (no tourist/phone indicators)
 * 3. Keep the highest-scored record visible, set hidden: true on the rest
 * 4. Tourist photo detection via filename heuristics
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/dedup-artworks.mjs [--dry-run] [--collection ficinos-florence] [--min-cluster 3]
 */
import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');
const TARGET_COLLECTION = process.argv.find((_, i, a) => a[i - 1] === '--collection') || null;
const MIN_CLUSTER = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--min-cluster') || '3');

const client = new MongoClient(process.env.MONGODB_URI);

// Tourist/phone photo indicators in filenames or titles
const TOURIST_PATTERNS = [
  /panoramio/i, /flickr/i, /\bDSC\d/i, /\bIMG_/i, /\bDSCN/i,
  /\bP\d{7}/i, /\(\d{8,}\)/, // Flickr-style numeric IDs
  /\bweb$/i, /\bphoto\b/i,
  /museum.*\d{4}/i, // "Museum 2017" style
  /gente.interesada/i, // Spanish "people interested in..."
  /con.*venus.*web/i,
  /in\s+uffizi/i, /at\s+the\s+museum/i,
];

// Filename patterns suggesting clean reproduction
const CLEAN_PATTERNS = [
  /^File:.*WGA\d/i,        // Web Gallery of Art
  /Google.Art.Project/i,    // GAP scans
  /^File:.*MET\s/i,        // Met museum
  /-\s*Google\s+Art/i,
  /Uffizi/i,               // Museum direct
  /Rijksmuseum/i,
];

function normalizeTitle(title) {
  return title
    .toLowerCase()
    // Strip QS:P1476 and label markup from Wikidata-style titles
    .replace(/title\s+qs:p\d+[^"]*"([^"]+)"/g, '$1')
    .replace(/label\s+qs:l\w+,"[^"]*"/g, '')
    // Strip parentheticals
    .replace(/\([^)]*\)/g, '')
    // Strip dates and numbers
    .replace(/\d{4,}/g, '')
    .replace(/\b\d+\b/g, '')
    // Strip common prefixes
    .replace(/^(file:|the |a |an |el |la |le |les |il |lo |der |die |das |de |het )/gi, '')
    // Strip everything non-alpha
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    // Take first 50 chars (captures the core subject)
    .substring(0, 50);
}

function normalizeAuthor(author) {
  return (author || 'unknown')
    .toLowerCase()
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    // Keep only last name for clustering (catches "Sandro Botticelli" vs "Botticelli")
    .split(' ').pop();
}

// Cross-language subject keywords for famous paintings
// Maps variant words to a canonical form
const SUBJECT_SYNONYMS = {
  'nascita': 'birth', 'nacimiento': 'birth', 'narodziny': 'birth', 'geburt': 'birth', 'naissance': 'birth',
  'venere': 'venus', 'wenus': 'venus', 'afrodita': 'venus',
  'primavera': 'spring', 'frühling': 'spring', 'printemps': 'spring',
  'madonna': 'madonna', 'vergine': 'virgin', 'vierge': 'virgin', 'jungfrau': 'virgin',
  'crocifissione': 'crucifixion', 'kreuzigung': 'crucifixion', 'crucifixión': 'crucifixion',
  'annunciazione': 'annunciation', 'verkündigung': 'annunciation', 'anunciación': 'annunciation',
  'giudizio': 'judgement', 'juicio': 'judgement', 'urteil': 'judgement',
};

// Common prepositions/articles to strip after synonym replacement
const STOP_WORDS = new Set([
  'di', 'del', 'della', 'delle', 'dei', 'degli', 'da', 'con', 'fra', 'tra', 'su', 'per', 'von',
  'of', 'the', 'and', 'with', 'in', 'at', 'by', 'from', 'to', 'on', 'for',
  'de', 'du', 'des', 'et', 'en', 'le', 'la', 'les', 'un', 'une',
  'und', 'mit', 'zu', 'im', 'am', 'an', 'auf', 'aus',
  'ca', 'circa', 'detail', 'dettaglio', 'detalle',
]);

function canonicalizeTitle(normalized, authorLastName) {
  let words = normalized.split(' ')
    .map(w => SUBJECT_SYNONYMS[w] || w)
    .filter(w => !STOP_WORDS.has(w))
    .filter(w => w.length > 1);

  // Remove artist name from title (e.g., "sandro botticelli la nascita di venere")
  if (authorLastName) {
    words = words.filter(w => w !== authorLastName);
    // Also remove common first names paired with the artist
    const firstNames = ['sandro', 'leonardo', 'michelangelo', 'raffaello', 'raphael', 'giovanni',
      'pietro', 'andrea', 'lorenzo', 'cosimo', 'piero', 'fra', 'domenico', 'filippino', 'filippo'];
    words = words.filter(w => !firstNames.includes(w));
  }

  return words.join(' ');
}

function isTouristPhoto(slug, title, commonsUrl, commonsTitle) {
  const allText = [slug, title, commonsUrl || '', commonsTitle || ''].join(' ');
  return TOURIST_PATTERNS.some(p => p.test(allText));
}

function isCleanReproduction(commonsUrl, commonsTitle) {
  const text = [commonsUrl || '', commonsTitle || ''].join(' ');
  return CLEAN_PATTERNS.some(p => p.test(text));
}

function scoreArtwork(doc) {
  let score = 0;
  const maxDim = Math.max(doc.commons_width || 0, doc.commons_height || 0, doc.full_width || 0, doc.full_height || 0);

  // Resolution: higher is better
  if (maxDim >= 5000) score += 30;
  else if (maxDim >= 3000) score += 25;
  else if (maxDim >= 2000) score += 20;
  else if (maxDim >= 1000) score += 10;
  else if (maxDim >= 500) score += 5;

  // Has enrichment (AI description)
  if (doc.enrichment?.description) score += 15;

  // Has commons_url (provenance)
  if (doc.commons_url) score += 5;

  // Has archived image on R2
  if (doc.thumbnail_blob?.includes('images.sourcelibrary.org')) score += 5;

  // Clean reproduction bonus
  if (isCleanReproduction(doc.commons_url, doc.commons_title)) score += 10;

  // Tourist photo penalty
  if (isTouristPhoto(doc.slug, doc.title, doc.commons_url, doc.commons_title)) score -= 20;

  // In collections bonus (more = more curated)
  score += Math.min((doc.collections?.length || 0) * 2, 10);

  return score;
}

async function main() {
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== LIVE RUN ===');
  console.log(`Min cluster size: ${MIN_CLUSTER}`);
  if (TARGET_COLLECTION) console.log(`Target collection: ${TARGET_COLLECTION}`);

  // Query artworks
  const query = {
    resource_type: { $exists: true },
    hidden: { $ne: true },
  };
  if (TARGET_COLLECTION) {
    query.collections = TARGET_COLLECTION;
  }

  const allArtworks = await books.find(query, {
    projection: {
      _id: 1, slug: 1, title: 1, author: 1,
      commons_url: 1, commons_title: 1,
      commons_width: 1, commons_height: 1,
      full_width: 1, full_height: 1,
      enrichment: 1, thumbnail_blob: 1,
      collections: 1, created_at: 1,
    },
  }).toArray();

  console.log(`Total artworks: ${allArtworks.length}`);

  // Group by normalized author + canonicalized title
  const clusters = {};
  for (const art of allArtworks) {
    const authorKey = normalizeAuthor(art.author);
    const titleKey = canonicalizeTitle(normalizeTitle(art.title || ''), authorKey);
    if (titleKey.length < 3) continue; // Skip very short titles

    const key = `${authorKey}|||${titleKey}`;
    if (!clusters[key]) clusters[key] = [];
    clusters[key].push(art);
  }

  // Filter to clusters with MIN_CLUSTER+ items
  const dupeClusters = Object.entries(clusters)
    .filter(([_, items]) => items.length >= MIN_CLUSTER)
    .sort((a, b) => b[1].length - a[1].length);

  console.log(`Clusters with ${MIN_CLUSTER}+ duplicates: ${dupeClusters.length}`);

  let totalHidden = 0;
  let totalKept = 0;

  for (const [key, items] of dupeClusters) {
    // Score each item
    const scored = items.map(item => ({
      ...item,
      score: scoreArtwork(item),
    })).sort((a, b) => b.score - a.score);

    const best = scored[0];
    const rest = scored.slice(1);

    const [authorKey, titleKey] = key.split('|||');
    console.log(`\n--- ${items.length}x: ${authorKey} — "${titleKey}" (best: ${best.slug}, score ${best.score})`);

    for (const item of rest) {
      const tourist = isTouristPhoto(item.slug, item.title, item.commons_url, item.commons_title);
      const maxDim = Math.max(item.commons_width || 0, item.commons_height || 0);
      console.log(`  HIDE: ${item.slug} (score ${item.score}, ${maxDim}px${tourist ? ', TOURIST' : ''})`);

      if (!DRY_RUN) {
        await books.updateOne({ _id: item._id }, {
          $set: {
            hidden: true,
            hidden_reason: `duplicate of ${best.slug}`,
            hidden_at: new Date(),
          },
        });
      }
      totalHidden++;
    }
    totalKept++;
  }

  console.log('\n━━━ SUMMARY ━━━');
  console.log(`Clusters processed: ${dupeClusters.length}`);
  console.log(`Records kept (best per cluster): ${totalKept}`);
  console.log(`Records hidden: ${totalHidden}`);

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
