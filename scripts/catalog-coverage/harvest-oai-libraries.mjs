#!/usr/bin/env node
/**
 * Harvest early modern books from IIIF libraries via OAI-PMH.
 *
 * Libraries:
 *   - SBB Berlin (239K items, VD16/VD17 sets)
 *   - SLUB Dresden (650K items)
 *   - HAB Wolfenbuttel (42K items)
 *   - Heidelberg UB (manuscripts + prints)
 *   - Göttingen SUB (87K items)
 *
 * Records are stored INCREMENTALLY — each OAI page is written to MongoDB
 * immediately, so network failures don't lose all progress.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/catalog-coverage/harvest-oai-libraries.mjs --library=sbb
 *   node scripts/catalog-coverage/harvest-oai-libraries.mjs --library=hab --dry-run
 *   node scripts/catalog-coverage/harvest-oai-libraries.mjs --library=sbb --limit=500
 */

import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');
const LIBRARY = process.argv.find(a => a.startsWith('--library='))?.split('=')[1];
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0');

if (!LIBRARY) {
  console.error('Usage: --library=sbb|slub|hab|heidelberg|goettingen');
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
    sets: null,
    iiifManifest: (id) => null,
    viewerUrl: (id) => {
      const ppn = id?.match(/ppn_(\w+)/)?.[1];
      return ppn ? `http://diglib.hab.de/?db=drucke&list=ppn&id=${ppn}` : null;
    },
    source: 'hab',
    scanQuality: 'high',
  },
  slub: {
    name: 'SLUB Dresden',
    oaiUrl: 'https://digital.slub-dresden.de/oai/',
    metadataPrefix: 'oai_dc',
    sets: null,
    iiifManifest: (id) => null,
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
  goettingen: {
    name: 'Göttingen State and University Library',
    oaiUrl: 'https://gdz.sub.uni-goettingen.de/oai2/',
    metadataPrefix: 'oai_dc',
    sets: null,
    iiifManifest: (id) => null,
    viewerUrl: (id) => {
      const match = id?.match(/oai:gdz\.sub\.uni-goettingen\.de:(.+)/);
      return match ? `http://resolver.sub.uni-goettingen.de/purl?${match[1]}` : null;
    },
    source: 'goettingen',
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
  const recordBlocks = xml.split(/<record\b[^>]*>/g).slice(1);

  for (const block of recordBlocks) {
    const id = extractIdentifier(block);
    const titles = extractDcField(block, 'title');
    const creators = extractDcField(block, 'creator');
    const dates = extractDcField(block, 'date');
    const languages = extractDcField(block, 'language');
    const identifiers = extractDcField(block, 'identifier');
    const types = extractDcField(block, 'type');
    const subjects = extractDcField(block, 'subject');
    const publishers = extractDcField(block, 'publisher');
    const coverages = extractDcField(block, 'coverage');
    const rights = extractDcField(block, 'rights');
    const formats = extractDcField(block, 'format');

    if (block.includes('status="deleted"')) continue;

    let year = null;
    for (const d of dates) {
      const ym = d.match(/(\d{4})/);
      if (ym) { year = parseInt(ym[1]); break; }
    }
    if (!year) {
      for (const d of [...publishers, ...coverages]) {
        const ym = d.match(/(\d{4})/);
        if (ym) { year = parseInt(ym[1]); break; }
      }
    }
    if (!year) {
      for (const val of identifiers) {
        if (val.startsWith('(fingerprint)')) {
          const ym = val.match(/(\d{4})R?\s*$/);
          if (ym) { year = parseInt(ym[1]); break; }
        }
      }
    }

    let place = coverages[0] || '';
    if (!place && publishers[0]?.includes(':')) {
      place = publishers[0].split(':')[0].trim();
    }

    let pageCount = null;
    for (const f of formats) {
      const pages = f.match(/(\d+)\s*(?:S\.|p\.|pages|Bl\.)/);
      if (pages) { pageCount = parseInt(pages[1]); break; }
    }

    let manifestUrl = null;
    let viewerUrl = null;
    let urn = null;
    for (const val of identifiers) {
      if (val.includes('iiif') && val.includes('manifest')) manifestUrl = val;
      else if (val.startsWith('http')) { if (!viewerUrl) viewerUrl = val; }
      const urnMatch = val.match(/\b(urn:nbn:[^\s)]+)/);
      if (urnMatch) urn = urnMatch[1];
    }

    records.push({
      oaiId: id,
      title: titles[0] || '',
      author: creators[0] || '',
      year,
      language: languages[0] || '',
      type: types[0] || '',
      subjects,
      publisher: publishers[0] || '',
      place,
      rights: rights[0] || '',
      physicalFormat: formats.find(f => /^\[?\d|°/.test(f)) || '',
      pageCount,
      manifestUrl,
      viewerUrl: viewerUrl || (identifiers.find(u => u.startsWith('http')) || null),
      urn,
    });
  }
  return records;
}

// ─── Extract surname ─────────────────────────────────────────────────────

function extractSurname(author) {
  if (!author) return null;
  const cleaned = author.replace(/&amp;/g, '&').replace(/<[^>]*>/g, '').trim();
  const comma = cleaned.indexOf(',');
  const name = comma > 0 ? cleaned.slice(0, comma) : cleaned.split(/\s+/)[0];
  return name.toLowerCase().replace(/[^a-z]/g, '') || null;
}

// ─── OAI-PMH Harvester (incremental storage) ────────────────────────────

async function harvestOai(config, col) {
  const sets = config.sets || [null];
  let totalFetched = 0;
  let totalEarlyModern = 0;
  let totalInserted = 0;
  let totalSkipped = 0;

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
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const res = await fetch(fetchUrl, { signal: AbortSignal.timeout(30000) });
          xml = await res.text();
          break;
        } catch (err) {
          if (attempt < 4) {
            console.error(`    Fetch error, retry ${attempt + 1}/5: ${err.message}`);
            await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
          } else {
            throw err;
          }
        }
      }

      if (!setTotal) setTotal = extractTotalSize(xml);
      const records = parseRecords(xml);
      totalFetched += records.length;

      const earlyModern = records.filter(r => !r.year || (r.year >= 1400 && r.year <= 1750));

      for (const rec of earlyModern) {
        if (!rec.manifestUrl && config.iiifManifest && rec.oaiId) {
          rec.manifestUrl = config.iiifManifest(rec.oaiId);
        }
        if (!rec.viewerUrl && config.viewerUrl && rec.oaiId) {
          rec.viewerUrl = config.viewerUrl(rec.oaiId);
        }
      }
      totalEarlyModern += earlyModern.length;

      // Store incrementally — each page written immediately
      if (!DRY_RUN && col && earlyModern.length > 0) {
        const ops = earlyModern.map(r => {
          const doc = {
            source: config.source,
            scan_quality: config.scanQuality,
            oai_id: r.oaiId,
            title: r.title,
            author: r.author,
            author_surname: extractSurname(r.author),
            language: r.language || null,
            date_earliest: r.year,
            date_latest: r.year,
            publisher: r.publisher || null,
            place: r.place || null,
            rights: r.rights || null,
            physical_format: r.physicalFormat || null,
            page_count: r.pageCount || null,
            subjects: r.subjects || [],
            viewer_url: r.viewerUrl,
            urn: r.urn || null,
            status: 'discovered',
            discovered_at: new Date(),
            harvested_at: new Date(),
          };
          // Only include manifest_url if non-null (avoids sparse index issues)
          if (r.manifestUrl) doc.manifest_url = r.manifestUrl;
          return {
            updateOne: {
              filter: { oai_id: r.oaiId, source: config.source },
              update: { $setOnInsert: doc },
              upsert: true,
            },
          };
        });

        try {
          const result = await col.bulkWrite(ops, { ordered: false });
          totalInserted += result.upsertedCount;
          totalSkipped += (ops.length - result.upsertedCount);
        } catch (err) {
          if (err.result) {
            totalInserted += err.result.upsertedCount || 0;
            totalSkipped += (ops.length - (err.result.upsertedCount || 0));
          }
          const msg = String(err.message || err);
          if (!msg.includes('duplicate key')) {
            console.error(`  Write error: ${msg.slice(0, 100)}`);
          }
        }
      }

      process.stdout.write(`    Page ${pageNum}: ${totalFetched.toLocaleString()} fetched, ${totalEarlyModern.toLocaleString()} pre-1700${!DRY_RUN ? `, ${totalInserted.toLocaleString()} new` : ''}${setTotal ? ` / ${setTotal.toLocaleString()} total` : ''}\r`);

      resumptionToken = extractResumptionToken(xml);
      if (!resumptionToken) break;
      if (LIMIT > 0 && totalEarlyModern >= LIMIT) break;

      await new Promise(r => setTimeout(r, 500));
    }

    console.log(`    Set ${set || '(all)'}: ${totalFetched.toLocaleString()} fetched, ${totalEarlyModern.toLocaleString()} pre-1700`);
    if (LIMIT > 0 && totalEarlyModern >= LIMIT) break;
  }

  return { totalFetched, totalEarlyModern, totalInserted, totalSkipped };
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

  let client, col;
  if (!DRY_RUN) {
    const uri = process.env.MONGODB_URI;
    if (!uri) { console.error('MONGODB_URI required'); process.exit(1); }
    client = new MongoClient(uri, { socketTimeoutMS: 60000, serverSelectionTimeoutMS: 15000 });
    await client.connect();
    col = client.db('bookstore').collection('import_candidates');
  }

  const result = await harvestOai(config, col);
  console.log(`\nTotal: ${result.totalFetched.toLocaleString()} fetched, ${result.totalEarlyModern.toLocaleString()} pre-1700`);
  if (!DRY_RUN) {
    console.log(`  Inserted: ${result.totalInserted.toLocaleString()}`);
    console.log(`  Skipped (already existed): ${result.totalSkipped.toLocaleString()}`);
  }

  if (!DRY_RUN && col) {
    try { await col.createIndex({ oai_id: 1, source: 1 }, { sparse: true, name: 'oai_id_source' }); } catch {}
  }

  if (client) await client.close();
  console.log('\nDone.');
}

main().catch(err => { console.error(err); process.exit(1); });
