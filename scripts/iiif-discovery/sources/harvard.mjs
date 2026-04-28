#!/usr/bin/env node
/**
 * Harvard Library Discovery Crawler
 *
 * Harvests digitized books from Harvard's LibraryCloud API.
 * Covers Houghton Library (rare books), Harvard-Yenching (CJK),
 * Islamic Heritage Project, and other collections.
 *
 * API: https://api.lib.harvard.edu/v2/items
 * IIIF manifests: https://mps.lib.harvard.edu/iiif/2/URN-3:{OWNER}:{ID}
 *
 * No API key required. No rate limiting observed, but we throttle
 * to be a good citizen (~2 req/s).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/iiif-discovery/sources/harvard.mjs
 *
 * Options:
 *   --query="alchemy"      Search query (default: broad pre-1800 sweep)
 *   --collection=houghton  Limit to specific repository
 *   --max-records=5000     Stop after N records (default: 10000)
 *   --dry-run              Show what would be discovered, don't write to DB
 *   --resume               Resume from last position
 */

import { withMongo } from '../../lib/mongo.mjs';
import { ensureIndexes, insertCandidate } from '../lib/candidate-store.mjs';
import { parseDateRange } from '../lib/iiif-metadata.mjs';

const SOURCE = 'harvard';
const API_BASE = 'https://api.lib.harvard.edu/v2/items';
const PAGE_SIZE = 50; // LibraryCloud max per page
const DELAY_MS = 500; // 2 req/s — polite rate

// Parse CLI args
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [key, val] = a.slice(2).split('=');
      return [key, val ?? true];
    })
);

const DRY_RUN = 'dry-run' in args;
const MAX_RECORDS = parseInt(args['max-records']) || 10000;
const QUERY = args.query || null;
const COLLECTION = args.collection || null;
const RESUME = 'resume' in args;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Repository codes → human-readable names
const REPO_NAMES = {
  'FHCL.HOUGH': 'Houghton Library',
  'HYL': 'Harvard-Yenching Library',
  'HMS.COUNT': 'Countway Library of Medicine',
  'DIV': 'Harvard Divinity School',
  'LAW': 'Harvard Law School',
  'MUS': 'Loeb Music Library',
  'FHCL.LAMONT': 'Lamont Library',
  'FHCL.WIDENER': 'Widener Library',
  'GSD': 'Frances Loeb Library (GSD)',
  'HUFAS': 'Fine Arts Library',
  'PEA': 'Peabody Museum',
};

function getRepoName(urn) {
  if (!urn) return 'Harvard Library';
  // urn-3:FHCL.HOUGH:4699645 → FHCL.HOUGH
  const match = urn.match(/urn-3:([^:]+):/i);
  if (match) return REPO_NAMES[match[1]] || match[1];
  return 'Harvard Library';
}

function buildManifestUrl(urn) {
  if (!urn) return null;
  // urn-3:FHCL.HOUGH:4699645 → URN-3:FHCL.HOUGH:4699645
  const normalized = urn.replace(/^urn-3:/i, 'URN-3:');
  return `https://mps.lib.harvard.edu/iiif/2/${normalized}`;
}

/**
 * Parse a single item from LibraryCloud XML response.
 * Extracts metadata + NRS URN for manifest construction.
 */
function parseItem(itemXml) {
  const get = (tag) => {
    const match = itemXml.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`));
    return match ? match[1].trim() : null;
  };

  const getAll = (tag) => {
    const matches = [];
    const re = new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, 'g');
    let m;
    while ((m = re.exec(itemXml)) !== null) matches.push(m[1].trim());
    return matches;
  };

  // Title
  const title = get('mods:title') || get('title') || 'Unknown';
  const subtitle = get('mods:subTitle') || get('subTitle') || null;
  const displayTitle = subtitle ? `${title}: ${subtitle}` : title;

  // Creator/Author
  const creators = getAll('mods:namePart') || getAll('namePart');
  const author = creators[0] || 'Unknown';

  // Date
  const dateText = get('mods:dateIssued') || get('mods:dateCreated') || get('dateIssued') || get('dateCreated') || null;
  const dateRange = dateText ? parseDateRange(dateText) : {};

  // Language
  const langCode = get('mods:languageTerm') || get('languageTerm') || null;
  const language = langCode || 'Unknown';

  // NRS URN (key to IIIF manifest)
  const urnMatches = itemXml.match(/urn-3:[A-Za-z0-9._]+:[A-Za-z0-9._]+/g) || [];
  const nrsUrn = urnMatches[0] || null;

  // DRS thumbnail URL
  const thumbMatch = itemXml.match(/https:\/\/ids\.lib\.harvard\.edu\/ids\/iiif\/\d+\/full\/[^"]+/);
  const thumbnail = thumbMatch ? thumbMatch[0] : null;

  // HOLLIS ID
  const hollisMatch = itemXml.match(/https:\/\/id\.lib\.harvard\.edu\/alma\/(\d+)/);
  const hollisId = hollisMatch ? hollisMatch[1] : null;

  // Repository
  const repoName = getRepoName(nrsUrn);

  return {
    title: displayTitle.slice(0, 500),
    author,
    language,
    dateText,
    dateEarliest: dateRange.earliest || null,
    dateLatest: dateRange.latest || null,
    nrsUrn,
    manifestUrl: buildManifestUrl(nrsUrn),
    thumbnail,
    hollisId,
    repoName,
  };
}

/**
 * Build search queries targeting pre-modern content.
 * Returns array of { query, description } objects.
 */
function getSearchQueries() {
  if (QUERY) {
    return [{ query: QUERY, description: `Custom: ${QUERY}` }];
  }

  // Targeted queries for Source Library-relevant content
  return [
    { query: 'manuscript medieval', description: 'Medieval manuscripts' },
    { query: 'alchemy alchemical', description: 'Alchemical texts' },
    { query: 'kabbalah kabbalistic hebrew mysticism', description: 'Kabbalistic texts' },
    { query: 'hermetic hermetica', description: 'Hermetic texts' },
    { query: 'incunabula incunabulum', description: 'Incunabula' },
    { query: 'illuminated manuscript', description: 'Illuminated manuscripts' },
    { query: 'arabic manuscript astronomy', description: 'Arabic astronomy' },
    { query: 'islamic manuscript philosophy', description: 'Islamic philosophy' },
    { query: 'sanskrit vedic', description: 'Sanskrit/Vedic texts' },
    { query: 'tibetan buddhist', description: 'Tibetan Buddhist texts' },
    { query: 'chinese rare book woodblock', description: 'Chinese rare books' },
    { query: 'japanese rare book manuscript', description: 'Japanese rare books' },
    { query: 'korean manuscript', description: 'Korean manuscripts' },
    { query: 'latin manuscript renaissance', description: 'Latin/Renaissance' },
    { query: 'greek manuscript classical', description: 'Greek manuscripts' },
    { query: 'persian manuscript sufi', description: 'Persian/Sufi texts' },
    { query: 'early printed book 16th century', description: 'Early printed books' },
    { query: 'astrology horoscope', description: 'Astrological texts' },
    { query: 'magic occult divination', description: 'Occult texts' },
    { query: 'philosophy natural philosophy', description: 'Natural philosophy' },
  ];
}

await withMongo(async (db) => {
  if (!DRY_RUN) {
    try { await ensureIndexes(db); } catch (e) {
      console.log(`[harvard] Index warning: ${e.message.slice(0, 80)}`);
    }
  }

  const queries = getSearchQueries();
  let totalInserted = 0, totalSkipped = 0, totalErrors = 0;

  for (const { query, description } of queries) {
    if (totalInserted >= MAX_RECORDS) break;

    console.log(`\n[harvard] Searching: ${description} (q="${query}")`);
    let start = 0;
    let queryInserted = 0;

    while (true) {
      if (totalInserted + queryInserted >= MAX_RECORDS) break;

      const url = `${API_BASE}?q=${encodeURIComponent(query)}&digitalFormat=Books%20and%20documents&limit=${PAGE_SIZE}&start=${start}`;

      let xml;
      try {
        const res = await fetch(url);
        if (!res.ok) {
          console.log(`  HTTP ${res.status} at start=${start}, stopping this query`);
          break;
        }
        xml = await res.text();
      } catch (err) {
        console.log(`  Fetch error at start=${start}: ${err.message}`);
        break;
      }

      // Extract total count
      const totalMatch = xml.match(/numFound>(\d+)/);
      const totalFound = totalMatch ? parseInt(totalMatch[1]) : 0;

      if (start === 0) {
        console.log(`  Found ${totalFound} items`);
      }

      // Parse items
      const itemBlocks = xml.match(/<mods:mods[\s\S]*?<\/mods:mods>/g) || [];
      if (itemBlocks.length === 0) break;

      for (const block of itemBlocks) {
        const item = parseItem(block);
        if (!item.manifestUrl) {
          totalErrors++;
          continue;
        }

        if (DRY_RUN) {
          if (queryInserted < 5) {
            console.log(`  ${item.title.slice(0, 50)} | ${item.author.slice(0, 30)} | ${item.dateText || '?'} | ${item.repoName}`);
          }
          queryInserted++;
          continue;
        }

        const result = await insertCandidate(db, {
          manifest_url: item.manifestUrl,
          source: SOURCE,
          origin_library: item.repoName,
          title: item.title,
          author: item.author,
          language: item.language,
          date_text: item.dateText,
          date_earliest: item.dateEarliest,
          date_latest: item.dateLatest,
          categories: [],
          provider_name: 'Harvard Library',
          source_url: item.hollisId ? `https://id.lib.harvard.edu/alma/${item.hollisId}/catalog` : null,
          source_id: item.hollisId,
          metadata: {
            nrs_urn: item.nrsUrn,
            thumbnail: item.thumbnail,
            repository: item.repoName,
          },
        });

        if (result.inserted) {
          queryInserted++;
          if (queryInserted <= 3 || queryInserted % 50 === 0) {
            console.log(`  NEW [${queryInserted}]: ${item.title.slice(0, 50)} (${item.repoName}, ${item.dateText || '?'})`);
          }
        } else {
          totalSkipped++;
        }
      }

      start += PAGE_SIZE;
      if (start >= totalFound || start >= 10000) break; // LibraryCloud caps at 10K

      await sleep(DELAY_MS); // Be polite
    }

    totalInserted += queryInserted;
    console.log(`  → ${queryInserted} new from "${description}"`);
  }

  console.log(`\n[harvard] Done: ${totalInserted} inserted, ${totalSkipped} skipped (dedup), ${totalErrors} errors`);
});
