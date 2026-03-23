#!/usr/bin/env node
/**
 * Harvest early modern books from A-tier German IIIF libraries via OAI-PMH.
 *
 * Libraries:
 *   - SBB Berlin (175K+ items, VD16/VD17 sets)
 *   - SLUB Dresden (650K items)
 *   - HAB Wolfenbuttel (42K items)
 *   - Heidelberg UB (manuscripts + prints)
 *   - Vatican Library (80K+ manuscripts, no OAI — uses manifest list scraping)
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/catalog-coverage/harvest-oai-libraries.mjs --library=sbb
 *   node scripts/catalog-coverage/harvest-oai-libraries.mjs --library=vatican
 *   node scripts/catalog-coverage/harvest-oai-libraries.mjs --library=hab --dry-run
 *   node scripts/catalog-coverage/harvest-oai-libraries.mjs --library=sbb --limit=500
 */

import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');
const LIBRARY = process.argv.find(a => a.startsWith('--library='))?.split('=')[1];
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0');

if (!LIBRARY) {
  console.error('Usage: --library=sbb|slub|hab|heidelberg|vatican');
  process.exit(1);
}

const LIBRARIES = {
  sbb: {
    name: 'Staatsbibliothek zu Berlin',
    oaiUrl: 'https://oai.sbb.berlin/',
    metadataPrefix: 'oai_dc',
    sets: ['vd16', 'vd17'],
    iiifManifest: (id) => {
      const ppn = id.replace('oai:digital.staatsbibliothek-berlin.de:', '');
      return `https://content.staatsbibliothek-berlin.de/dc/${ppn}/manifest`;
    },
    viewerUrl: (id) => {
      const ppn = id.replace('oai:digital.staatsbibliothek-berlin.de:', '');
      return `https://digital.staatsbibliothek-berlin.de/werkansicht?PPN=${ppn}`;
    },
    source: 'sbb',
    scanQuality: 'high',
  },
  hab: {
    name: 'Herzog August Bibliothek Wolfenbüttel',
    oaiUrl: 'http://oai.hab.de/',
    metadataPrefix: 'oai_dc',
    sets: null, // harvest all
    iiifManifest: (id) => {
      // HAB manifests use the record path, e.g. drucke/lp-10-1/start.htm → need to parse from identifier
      return null; // Will be extracted from dc:identifier URLs
    },
    viewerUrl: (id) => null,
    source: 'hab',
    scanQuality: 'high',
  },
  slub: {
    name: 'SLUB Dresden',
    oaiUrl: 'https://digital.slub-dresden.de/oai/',
    metadataPrefix: 'oai_dc',
    sets: null,
    iiifManifest: (id) => null, // Extract from metadata
    viewerUrl: (id) => null,
    source: 'slub',
    scanQuality: 'high',
  },
  heidelberg: {
    name: 'Heidelberg University Library',
    oaiUrl: 'https://digi.ub.uni-heidelberg.de/cgi-bin/digioai.cgi',
    metadataPrefix: 'oai_dc',
    sets: null,
    iiifManifest: (id) => {
      const match = id.match(/oai:digi\.ub\.uni-heidelberg\.de:(\d+)/);
      return match ? `https://digi.ub.uni-heidelberg.de/diglit/iiif3/${match[1]}/manifest.json` : null;
    },
    viewerUrl: (id) => {
      const match = id.match(/oai:digi\.ub\.uni-heidelberg\.de:(\d+)/);
      return match ? `https://digi.ub.uni-heidelberg.de/diglit/${match[1]}` : null;
    },
    source: 'heidelberg',
    scanQuality: 'high',
  },
};

// ─── OAI-PMH Parser ─────────────────────────────────────────────────────

function extractDcField(xml, field) {
  const regex = new RegExp(`<dc:${field}>([^<]+)`, 'g');
  const values = [];
  let m;
  while ((m = regex.exec(xml))) values.push(m[1].trim());
  return values;
}

function extractIdentifier(xml) {
  const m = xml.match(/<identifier>([^<]+)/);
  return m ? m[1].trim() : null;
}

function extractResumptionToken(xml) {
  const m = xml.match(/<resumptionToken[^>]*>([^<]*)/);
  return m && m[1] ? m[1].trim() : null;
}

function extractTotalSize(xml) {
  const m = xml.match(/completeListSize="(\d+)"/);
  return m ? parseInt(m[1]) : null;
}

function parseRecords(xml) {
  const records = [];
  const recordBlocks = xml.split(/<record>/g).slice(1);

  for (const block of recordBlocks) {
    const id = extractIdentifier(block);
    const titles = extractDcField(block, 'title');
    const creators = extractDcField(block, 'creator');
    const dates = extractDcField(block, 'date');
    const languages = extractDcField(block, 'language');
    const identifiers = extractDcField(block, 'identifier');
    const types = extractDcField(block, 'type');
    const subjects = extractDcField(block, 'subject');

    // Skip deleted records
    if (block.includes('status="deleted"')) continue;

    // Extract year from dates
    let year = null;
    for (const d of dates) {
      const ym = d.match(/(\d{4})/);
      if (ym) { year = parseInt(ym[1]); break; }
    }

    // Find IIIF manifest or viewer URL from identifiers
    let manifestUrl = null;
    let viewerUrl = null;
    for (const url of identifiers) {
      if (url.includes('iiif') && url.includes('manifest')) manifestUrl = url;
      else if (url.startsWith('http') && !manifestUrl) viewerUrl = url;
    }

    records.push({
      oaiId: id,
      title: titles[0] || '',
      author: creators[0] || '',
      year,
      language: languages[0] || '',
      type: types[0] || '',
      subjects,
      manifestUrl,
      viewerUrl: viewerUrl || (identifiers.find(u => u.startsWith('http')) || null),
      allIdentifiers: identifiers.filter(u => u.startsWith('http')),
    });
  }
  return records;
}

// ─── OAI-PMH Harvester ─────────────────────────────────────────────────

async function harvestOai(config) {
  const sets = config.sets || [null]; // null = no set filter
  let totalFetched = 0;
  let totalStored = 0;
  let allRecords = [];

  for (const set of sets) {
    console.log(`  Set: ${set || '(all)'}`);
    let url = `${config.oaiUrl}?verb=ListRecords&metadataPrefix=${config.metadataPrefix}`;
    if (set) url += `&set=${set}`;

    let resumptionToken = null;
    let pageNum = 0;
    let setTotal = null;

    while (true) {
      pageNum++;
      const fetchUrl = resumptionToken
        ? `${config.oaiUrl}?verb=ListRecords&resumptionToken=${encodeURIComponent(resumptionToken)}`
        : url;

      let xml;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(fetchUrl, { signal: AbortSignal.timeout(30000) });
          xml = await res.text();
          break;
        } catch (err) {
          if (attempt < 2) {
            console.error(`    Fetch error, retry ${attempt + 1}/3: ${err.message}`);
            await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
          } else {
            throw err;
          }
        }
      }

      if (!setTotal) setTotal = extractTotalSize(xml);
      const records = parseRecords(xml);
      totalFetched += records.length;

      // Filter to pre-1700 if year is known
      const earlyModern = records.filter(r => !r.year || (r.year >= 1400 && r.year <= 1750));

      for (const rec of earlyModern) {
        // Construct IIIF manifest URL if the library config can
        if (!rec.manifestUrl && config.iiifManifest && rec.oaiId) {
          rec.manifestUrl = config.iiifManifest(rec.oaiId);
        }
        if (!rec.viewerUrl && config.viewerUrl && rec.oaiId) {
          rec.viewerUrl = config.viewerUrl(rec.oaiId);
        }
        allRecords.push(rec);
      }

      process.stdout.write(`    Page ${pageNum}: ${totalFetched.toLocaleString()} fetched, ${allRecords.length.toLocaleString()} pre-1700${setTotal ? ` / ${setTotal.toLocaleString()} total` : ''}\r`);

      resumptionToken = extractResumptionToken(xml);
      if (!resumptionToken) break;
      if (LIMIT > 0 && allRecords.length >= LIMIT) break;

      // Rate limit
      await new Promise(r => setTimeout(r, 500));
    }

    console.log(`    Set ${set || '(all)'}: ${totalFetched.toLocaleString()} fetched, ${allRecords.length.toLocaleString()} pre-1700`);
    if (LIMIT > 0 && allRecords.length >= LIMIT) break;
  }

  return allRecords;
}

// ─── Extract surname ─────────────────────────────────────────────────────

function extractSurname(author) {
  if (!author) return null;
  const cleaned = author.replace(/&amp;/g, '&').replace(/<[^>]*>/g, '').trim();
  const comma = cleaned.indexOf(',');
  const name = comma > 0 ? cleaned.slice(0, comma) : cleaned.split(/\s+/)[0];
  return name.toLowerCase().replace(/[^a-z]/g, '') || null;
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const config = LIBRARIES[LIBRARY];
  if (!config) {
    console.error(`Unknown library: ${LIBRARY}. Options: ${Object.keys(LIBRARIES).join(', ')}`);
    process.exit(1);
  }

  console.log(`=== Harvesting ${config.name} ===`);
  console.log(`Source: ${config.source}, Quality: ${config.scanQuality}`);
  console.log(`Dry run: ${DRY_RUN}, Limit: ${LIMIT || 'none'}\n`);

  const records = await harvestOai(config);
  console.log(`\nTotal pre-1700 records: ${records.length.toLocaleString()}`);

  // Stats
  const withManifest = records.filter(r => r.manifestUrl).length;
  const withYear = records.filter(r => r.year).length;
  const withAuthor = records.filter(r => r.author).length;
  console.log(`  With IIIF manifest: ${withManifest.toLocaleString()}`);
  console.log(`  With year: ${withYear.toLocaleString()}`);
  console.log(`  With author: ${withAuthor.toLocaleString()}`);

  // Language distribution
  const langs = {};
  for (const r of records) {
    const l = r.language || 'unknown';
    langs[l] = (langs[l] || 0) + 1;
  }
  console.log(`  Languages: ${Object.entries(langs).sort((a,b) => b[1]-a[1]).slice(0,10).map(([k,v]) => `${k}:${v}`).join(', ')}`);

  // Sample records
  console.log('\n--- Sample records ---');
  for (const r of records.slice(0, 5)) {
    console.log(`  ${r.year || '?'} | ${r.author?.slice(0, 30) || '?'} | ${r.title?.slice(0, 60) || '?'}`);
    if (r.manifestUrl) console.log(`    IIIF: ${r.manifestUrl.slice(0, 80)}`);
  }

  // Store in MongoDB
  if (!DRY_RUN) {
    const uri = process.env.MONGODB_URI;
    if (!uri) { console.error('MONGODB_URI required'); process.exit(1); }
    const client = new MongoClient(uri, { socketTimeoutMS: 60000, serverSelectionTimeoutMS: 15000 });
    await client.connect();
    const col = client.db('bookstore').collection('import_candidates');

    console.log(`\nStoring ${records.length.toLocaleString()} records...`);
    let inserted = 0, skipped = 0;

    for (let i = 0; i < records.length; i += 50) {
      const batch = records.slice(i, i + 50);
      const ops = batch.map(r => ({
        updateOne: {
          filter: { oai_id: r.oaiId, source: config.source },
          update: {
            $setOnInsert: {
              source: config.source,
              scan_quality: config.scanQuality,
              oai_id: r.oaiId,
              title: r.title,
              author: r.author,
              author_surname: extractSurname(r.author),
              language: r.language || null,
              date_earliest: r.year,
              date_latest: r.year,
              manifest_url: r.manifestUrl,
              viewer_url: r.viewerUrl,
              status: 'discovered',
              discovered_at: new Date(),
            },
          },
          upsert: true,
        },
      }));

      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const result = await col.bulkWrite(ops, { ordered: false });
          inserted += result.upsertedCount;
          skipped += (ops.length - result.upsertedCount);
          break;
        } catch (err) {
          if (attempt < 4) {
            console.error(`  Write error, retry ${attempt + 1}/5`);
            await new Promise(r => setTimeout(r, 5000 * Math.pow(2, attempt)));
          } else throw err;
        }
      }

      if ((i + 50) % 500 === 0) {
        process.stdout.write(`  ${(i + 50).toLocaleString()} processed, ${inserted.toLocaleString()} new\r`);
      }
    }

    // Index
    try { await col.createIndex({ oai_id: 1, source: 1 }, { sparse: true, name: 'oai_id_source' }); } catch {}

    await client.close();
    console.log(`\n  Inserted: ${inserted.toLocaleString()}`);
    console.log(`  Skipped: ${skipped.toLocaleString()}`);
  }

  console.log('\nDone.');
}

main().catch(err => { console.error(err); process.exit(1); });
