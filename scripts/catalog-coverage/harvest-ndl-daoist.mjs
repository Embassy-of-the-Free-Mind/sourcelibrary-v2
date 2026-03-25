#!/usr/bin/env node
/**
 * Harvest Daoist alchemy texts from National Diet Library of Japan (NDL).
 *
 * NDL has 340K+ IIIF digitized items including Chinese classics.
 * Uses the OpenSearch API (RSS format) which returns clean XML with
 * rdfs:seeAlso links to dl.ndl.go.jp/pid/ for digitized items.
 *
 * Only items with a dl.ndl.go.jp/pid/ link (= digitized with IIIF) are stored.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/catalog-coverage/harvest-ndl-daoist.mjs
 *   node scripts/catalog-coverage/harvest-ndl-daoist.mjs --dry-run
 *   node scripts/catalog-coverage/harvest-ndl-daoist.mjs --limit=50
 *   node scripts/catalog-coverage/harvest-ndl-daoist.mjs --query="抱朴子"
 */

import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0');
const CUSTOM_QUERY = process.argv.find(a => a.startsWith('--query='))?.split('=').slice(1).join('=');

const OPENSEARCH_BASE = 'https://ndlsearch.ndl.go.jp/api/opensearch';
const RECORDS_PER_PAGE = 200; // NDL max is 200
const REQUEST_DELAY_MS = 1500;

// Daoist alchemy search terms
const SEARCH_QUERIES = CUSTOM_QUERY ? [CUSTOM_QUERY] : [
  '道蔵',         // Daozang (Taoist Canon)
  '抱朴子',       // Baopuzi (Ge Hong)
  '参同契',       // Cantong qi (Seal of the Unity of Three)
  '金丹',         // Golden Elixir
  '内丹',         // Neidan (internal alchemy)
  '煉丹',         // Alchemy / elixir refinement
  '悟真篇',       // Wuzhen pian (Understanding Reality)
  '太乙金華宗旨', // Secret of the Golden Flower
  '性命圭旨',     // Xingming guizhi
  '黄庭経',       // Yellow Court Classic
  '陰符経',       // Yinfu jing
  '清静経',       // Qingjing jing
  '周易参同契',   // Zhouyi cantong qi
  '道教 丹道',    // Daoism + Way of the Elixir
  '煉丹術',       // Art of elixir refinement
  '列仙伝',       // Biographies of Immortals
  '神仙伝',       // Traditions of Divine Transcendents
  '太平経',       // Taiping jing (Scripture of Great Peace)
];

// ─── OpenSearch RSS Parser ───────────────────────────────────────────────

function extractTag(xml, tag) {
  const regex = new RegExp(`<${tag}[^>]*>([^<]*)`, 'g');
  const values = [];
  let m;
  while ((m = regex.exec(xml))) {
    const val = m[1].trim();
    if (val) values.push(val);
  }
  return values;
}

function extractSeeAlsoResources(xml) {
  const regex = /rdfs:seeAlso[^>]*rdf:resource="([^"]*)"/g;
  const values = [];
  let m;
  while ((m = regex.exec(xml))) values.push(m[1]);
  return values;
}

function parseOpenSearchItems(xml) {
  const records = [];
  const items = xml.split(/<item>/g).slice(1);

  for (const item of items) {
    const title = extractTag(item, 'dc:title')[0] || extractTag(item, 'title')[0] || '';
    if (!title) continue;

    const creators = extractTag(item, 'dc:creator');
    const dates = extractTag(item, 'dc:date');
    const publishers = extractTag(item, 'dc:publisher');
    const subjects = extractTag(item, 'dc:subject');
    const languages = extractTag(item, 'dc:language');
    const descriptions = extractTag(item, 'dc:description');
    const extent = extractTag(item, 'dc:extent')[0] || '';
    const categories = extractTag(item, 'category');

    // Find digitization link from rdfs:seeAlso
    const seeAlso = extractSeeAlsoResources(item);
    let ndlPid = null;
    let viewerUrl = null;
    let manifestUrl = null;

    for (const url of seeAlso) {
      const pidMatch = url.match(/dl\.ndl\.go\.jp\/pid\/(\d+)/);
      if (pidMatch) {
        ndlPid = pidMatch[1];
        viewerUrl = `https://dl.ndl.go.jp/pid/${ndlPid}`;
        manifestUrl = `https://www.dl.ndl.go.jp/api/iiif/${ndlPid}/manifest.json`;
        break;
      }
    }

    // Extract year
    let year = null;
    for (const d of dates) {
      const ym = d.match(/(\d{4})/);
      if (ym) { year = parseInt(ym[1]); break; }
    }

    // Extract language
    let language = languages[0] || '';
    const langMap = { jpn: 'Japanese', chi: 'Chinese', eng: 'English', kor: 'Korean', ger: 'German', fre: 'French' };
    if (langMap[language]) language = langMap[language];

    // Extract page count from extent (e.g. "69, 8p" or "3冊")
    let pageCount = null;
    const pageMatch = extent.match(/(\d+)\s*p/);
    if (pageMatch) pageCount = parseInt(pageMatch[1]);

    records.push({
      ndlPid,
      title,
      author: creators[0] || '',
      year,
      language,
      subjects,
      publisher: publishers[0] || '',
      description: descriptions[0] || '',
      categories,
      extent,
      pageCount,
      viewerUrl,
      manifestUrl,
    });
  }

  return records;
}

function extractTotalResults(xml) {
  const m = xml.match(/<openSearch:totalResults>(\d+)/);
  return m ? parseInt(m[1]) : 0;
}

// ─── OpenSearch fetch ────────────────────────────────────────────────────

async function fetchOpenSearch(query, startIndex = 1) {
  const params = new URLSearchParams({
    any: query,
    cnt: String(RECORDS_PER_PAGE),
    idx: String(startIndex),
  });

  const url = `${OPENSEARCH_BASE}?${params}`;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt < 4) {
        console.error(`    Fetch error, retry ${attempt + 1}/5: ${err.message}`);
        await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
      } else {
        throw err;
      }
    }
  }
}

// ─── CJK surname extraction ─────────────────────────────────────────────

function extractSurname(author) {
  if (!author) return null;
  const cleaned = author.replace(/&amp;/g, '&').replace(/<[^>]*>/g, '').trim();
  // CJK names: first character is typically surname
  if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(cleaned)) {
    return cleaned.charAt(0);
  }
  // Western: "Last, First" or "First Last"
  const comma = cleaned.indexOf(',');
  const name = comma > 0 ? cleaned.slice(0, comma) : cleaned.split(/\s+/)[0];
  return name.toLowerCase().replace(/[^a-z]/g, '') || null;
}

// ─── Harvest one query ──────────────────────────────────────────────────

async function harvestQuery(query, col, seenPids) {
  console.log(`\n  Query: "${query}"`);

  let startIndex = 1;
  let totalResults = 0;
  let fetched = 0;
  let inserted = 0;
  let skipped = 0;
  let digitized = 0;
  let newInQuery = 0;

  while (true) {
    const xml = await fetchOpenSearch(query, startIndex);
    if (!totalResults) totalResults = extractTotalResults(xml);

    const records = parseOpenSearchItems(xml);
    if (records.length === 0) break;

    fetched += records.length;

    // Filter: only digitized items with IIIF, not already seen in this run
    const withManifest = records.filter(r => {
      if (!r.ndlPid || !r.manifestUrl) return false;
      if (seenPids.has(r.ndlPid)) return false;
      seenPids.add(r.ndlPid);
      return true;
    });
    digitized += withManifest.length;

    if (DRY_RUN && withManifest.length > 0) {
      for (const r of withManifest.slice(0, 3)) {
        console.log(`    [DRY] ${r.title.slice(0, 50)} | ${r.author.slice(0, 20)} | ${r.year || '?'} | pid/${r.ndlPid}`);
      }
      if (withManifest.length > 3) console.log(`    ... and ${withManifest.length - 3} more`);
    }

    if (!DRY_RUN && col && withManifest.length > 0) {
      const ops = withManifest.map(r => {
        const doc = {
          source: 'ndl',
          scan_quality: 'high',
          ndl_id: r.ndlPid,
          title: r.title,
          author: r.author,
          author_surname: extractSurname(r.author),
          language: r.language || null,
          date_earliest: r.year,
          date_latest: r.year,
          publisher: r.publisher || null,
          subjects: r.subjects || [],
          page_count: r.pageCount || null,
          manifest_url: r.manifestUrl,
          viewer_url: r.viewerUrl,
          status: 'discovered',
          tags: ['daoist-alchemy'],
          discovered_at: new Date(),
          harvested_at: new Date(),
        };
        return {
          updateOne: {
            filter: { ndl_id: r.ndlPid, source: 'ndl' },
            update: { $setOnInsert: doc },
            upsert: true,
          },
        };
      });

      try {
        const result = await col.bulkWrite(ops, { ordered: false });
        inserted += result.upsertedCount;
        newInQuery += result.upsertedCount;
        skipped += (ops.length - result.upsertedCount);
      } catch (err) {
        if (err.result) {
          inserted += err.result.upsertedCount || 0;
          newInQuery += err.result.upsertedCount || 0;
          skipped += (ops.length - (err.result.upsertedCount || 0));
        }
        const msg = String(err.message || err);
        if (!msg.includes('duplicate key')) {
          console.error(`  Write error: ${msg.slice(0, 100)}`);
        }
      }
    }

    process.stdout.write(`    ${fetched.toLocaleString()} / ${totalResults.toLocaleString()} fetched, ${digitized} digitized${!DRY_RUN ? `, ${inserted} new` : ''}\r`);

    startIndex += records.length;
    if (startIndex > totalResults) break;
    if (LIMIT > 0 && fetched >= LIMIT) break;

    await new Promise(r => setTimeout(r, REQUEST_DELAY_MS));
  }

  console.log(`    "${query}": ${fetched.toLocaleString()} results, ${digitized} digitized${!DRY_RUN ? `, ${newInQuery} new` : ''}`);
  return { fetched, digitized, inserted, skipped };
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Harvesting Daoist Alchemy from NDL Japan ===');
  console.log(`Dry run: ${DRY_RUN}, Limit: ${LIMIT || 'none'}`);
  console.log(`Queries: ${SEARCH_QUERIES.length}\n`);

  let client, col;
  if (!DRY_RUN) {
    const uri = process.env.MONGODB_URI;
    if (!uri) { console.error('MONGODB_URI required'); process.exit(1); }
    client = new MongoClient(uri, { socketTimeoutMS: 60000, serverSelectionTimeoutMS: 15000 });
    await client.connect();
    col = client.db('bookstore').collection('import_candidates');
  }

  const seenPids = new Set(); // Dedup across queries within this run
  let totalFetched = 0;
  let totalDigitized = 0;
  let totalInserted = 0;

  for (const query of SEARCH_QUERIES) {
    try {
      const result = await harvestQuery(query, col, seenPids);
      totalFetched += result.fetched;
      totalDigitized += result.digitized;
      totalInserted += result.inserted;
    } catch (err) {
      console.error(`\n  ERROR on "${query}": ${err.message}`);
    }

    if (LIMIT > 0 && totalFetched >= LIMIT) break;
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total results scanned: ${totalFetched.toLocaleString()}`);
  console.log(`Unique digitized items: ${seenPids.size}`);
  if (!DRY_RUN) {
    console.log(`New candidates inserted: ${totalInserted.toLocaleString()}`);
    try {
      await col.createIndex({ ndl_id: 1, source: 1 }, { sparse: true, name: 'ndl_id_source' });
    } catch {}
  }

  if (client) await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
