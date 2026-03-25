#!/usr/bin/env node
/**
 * Harvest early modern books from IIIF libraries via OAI-PMH (METS format).
 *
 * Uses METS/MODS metadata for comprehensive extraction:
 *   - Structured titles, subtitles
 *   - Multiple authors with roles and dates
 *   - Publisher, place, edition as separate fields
 *   - IIIF manifests (dv:iiif or constructed from IDs)
 *   - Viewer + reference URLs from dv:links
 *   - PPN, URN, shelfmarks, VD16/VD17 numbers
 *   - Physical description, classification, subjects
 *   - File group info (image quality tiers)
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
import { parseDateRange, normalizeLanguage } from '../iiif-discovery/lib/iiif-metadata.mjs';

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
    metadataPrefix: 'mets',
    sets: ['vd16', 'vd17'],
    // SBB embeds dv:iiif in METS; this is a fallback
    iiifManifest: (oaiId) => {
      const ppn = oaiId?.replace('oai:digital.staatsbibliothek-berlin.de:', '');
      return ppn ? `https://content.staatsbibliothek-berlin.de/dc/${ppn}/manifest` : null;
    },
    source: 'sbb',
    scanQuality: 'high',
  },
  hab: {
    name: 'Herzog August Bibliothek Wolfenbüttel',
    oaiUrl: 'http://oai.hab.de/',
    metadataPrefix: 'mets',
    sets: null,
    // HAB has no public IIIF; viewer URL comes from dv:presentation in METS
    iiifManifest: () => null,
    source: 'hab',
    scanQuality: 'high',
  },
  slub: {
    name: 'SLUB Dresden',
    oaiUrl: 'https://digital.slub-dresden.de/oai/',
    metadataPrefix: 'mets',
    sets: null,
    iiifManifest: () => null,
    source: 'slub',
    scanQuality: 'high',
  },
  heidelberg: {
    name: 'Heidelberg University Library',
    oaiUrl: 'https://digi.ub.uni-heidelberg.de/cgi-bin/digioai.cgi',
    metadataPrefix: 'mets',
    sets: null,
    iiifManifest: (oaiId) => {
      const match = oaiId?.match(/oai:digi\.ub\.uni-heidelberg\.de:(\d+)/);
      return match ? `https://digi.ub.uni-heidelberg.de/diglit/iiif3/${match[1]}/manifest.json` : null;
    },
    source: 'heidelberg',
    scanQuality: 'high',
  },
  goettingen: {
    name: 'Göttingen State and University Library',
    oaiUrl: 'https://gdz.sub.uni-goettingen.de/oai2/',
    metadataPrefix: 'mets',
    sets: null,
    iiifManifest: (oaiId) => {
      const match = oaiId?.match(/oai:gdz\.sub\.uni-goettingen\.de:(.+)/);
      return match ? `https://manifests.sub.uni-goettingen.de/iiif/presentation/${match[1]}/manifest` : null;
    },
    source: 'goettingen',
    scanQuality: 'high',
  },
};

// ─── MODS/METS Parser ──────────────────────────────────────────────────

function extractField(xml, tagName) {
  // Handle both namespaced and non-namespaced variants
  const re = new RegExp(`<(?:mods:|mets:)?${tagName}[^>]*>([^<]+)`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

function extractAllFields(xml, tagName) {
  const re = new RegExp(`<(?:mods:|mets:)?${tagName}[^>]*>([^<]+)`, 'gi');
  const values = [];
  let m;
  while ((m = re.exec(xml))) values.push(m[1].trim());
  return values;
}

function extractFieldWithAttr(xml, tagName, attrName, attrValue) {
  const re = new RegExp(`<(?:mods:|mets:)?${tagName}[^>]*${attrName}="${attrValue}"[^>]*>([^<]+)`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

function extractNameBlocks(xml) {
  const re = /<(?:mods:)?name[^>]*>([\s\S]*?)<\/(?:mods:)?name>/gi;
  const blocks = [];
  let m;
  while ((m = re.exec(xml))) blocks.push(m[1]);
  return blocks;
}

function parseNameBlock(block) {
  const displayForm = block.match(/<(?:mods:)?displayForm>([^<]+)/i)?.[1]?.trim();
  const family = block.match(/<(?:mods:)?namePart[^>]*type="family"[^>]*>([^<]+)/i)?.[1]?.trim();
  const given = block.match(/<(?:mods:)?namePart[^>]*type="given"[^>]*>([^<]+)/i)?.[1]?.trim();
  const dates = block.match(/<(?:mods:)?namePart[^>]*type="date"[^>]*>([^<]+)/i)?.[1]?.trim();
  const role = block.match(/<(?:mods:)?roleTerm[^>]*>([^<]+)/i)?.[1]?.trim();
  const name = displayForm || (family && given ? `${family}, ${given}` : family || given || null);
  return name ? { name, role: role || null, dates: dates || null } : null;
}

function parseIdentifiers(xml) {
  const result = { ppn: null, urn: null, shelfmark: null, vd16: null, vd17: null, vd18: null, catalog_ids: {} };
  const re = /<(?:mods:)?identifier[^>]*type="([^"]+)"[^>]*>([^<]+)/gi;
  let m;
  while ((m = re.exec(xml))) {
    const type = m[1].toLowerCase().trim();
    const value = m[2].trim();
    if (type === 'ppn' || type === 'purl' || type === 'swb-ppn-digital') result.ppn = value;
    else if (type === 'urn') result.urn = value;
    else if (type === 'shelfmark' || type === 'shelf' || type === 'signatur') result.shelfmark = value;
    else if (type === 'vd16') result.vd16 = value;
    else if (type === 'vd17') result.vd17 = value;
    else if (type === 'vd18') result.vd18 = value;
    else if (type === 'kitodo' || type === 'rism' || type === 'isbn' || type === 'issn' || type === 'fingerprint') {
      result.catalog_ids[type] = value;
    }
  }
  // Also check recordIdentifier
  const recId = xml.match(/<(?:mods:)?recordIdentifier[^>]*>([^<]+)/i)?.[1]?.trim();
  if (recId && !result.ppn) result.ppn = recId;
  return result;
}

function parseDvLinks(xml) {
  const dvBlock = xml.match(/<dv:links>([\s\S]*?)<\/dv:links>/i)?.[1] || '';
  return {
    iiif: dvBlock.match(/<dv:iiif>([^<]+)/i)?.[1]?.trim() || null,
    presentation: dvBlock.match(/<dv:presentation>([^<]+)/i)?.[1]?.trim() || null,
    reference: dvBlock.match(/<dv:reference>([^<]+)/i)?.[1]?.trim() || null,
  };
}

function parseFileGroups(xml) {
  const re = /<(?:METS|mets):fileGrp[^>]*USE="([^"]+)"/gi;
  const groups = [];
  let m;
  while ((m = re.exec(xml))) groups.push(m[1]);
  return groups;
}

function extractOaiId(xml) {
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

function parseMetsRecords(xml) {
  const records = [];
  const recordBlocks = xml.split(/<record\b[^>]*>/g).slice(1);

  for (const block of recordBlocks) {
    if (block.includes('status="deleted"')) continue;
    const oaiId = extractOaiId(block);
    if (!oaiId) continue;

    // Title
    const title = extractField(block, 'title') || '';
    const subtitle = extractField(block, 'subTitle') || null;

    // Authors
    const nameBlocks = extractNameBlocks(block);
    const authors = nameBlocks.map(parseNameBlock).filter(Boolean);
    const primaryAuthor = authors.find(a => a.role === 'aut') || authors[0] || null;
    const additionalAuthors = authors.filter(a => a !== primaryAuthor);

    // Language
    const langTerms = extractAllFields(block, 'languageTerm');
    const language = normalizeLanguage(langTerms[0]) || langTerms[0] || null;

    // Dates
    const dateIssuedStart = extractFieldWithAttr(block, 'dateIssued', 'point', 'start');
    const dateIssuedEnd = extractFieldWithAttr(block, 'dateIssued', 'point', 'end');
    const dateIssuedKey = extractFieldWithAttr(block, 'dateIssued', 'keyDate', 'yes');
    const dateIssued = extractField(block, 'dateIssued');
    const dateCreated = extractField(block, 'dateCreated');
    const displayDate = block.match(/<(?:mods:)?displayDate>([^<]+)/i)?.[1]?.trim() || null;

    let dateEarliest = null, dateLatest = null;
    if (dateIssuedStart) {
      const { earliest } = parseDateRange(dateIssuedStart);
      dateEarliest = earliest;
      if (dateIssuedEnd) {
        const { latest } = parseDateRange(dateIssuedEnd);
        dateLatest = latest;
      } else {
        dateLatest = dateEarliest;
      }
    } else {
      const dateStr = dateIssuedKey || dateIssued || dateCreated;
      const { earliest, latest } = parseDateRange(dateStr);
      dateEarliest = earliest;
      dateLatest = latest;
    }

    // Publisher / Place / Edition
    const publisher = extractField(block, 'publisher') || null;
    const place = extractFieldWithAttr(block, 'placeTerm', 'type', 'text')
      || extractField(block, 'placeTerm') || null;
    const edition = extractField(block, 'edition') || null;

    // Physical description
    const extent = extractField(block, 'extent') || null;
    const digitalOrigin = extractField(block, 'digitalOrigin') || null;
    let pageCount = null;
    if (extent) {
      const pages = extent.match(/(\d+)\s*(?:S\.|p\.|pages|Bl\.|fol\.|leaves|ff\.|sheets)/i);
      if (pages) pageCount = parseInt(pages[1]);
    }
    const physicalFormat = extractAllFields(block, 'extent').find(f => /^\[?\d|°/.test(f)) || null;

    // Subjects and classification
    const subjects = extractAllFields(block, 'topic');
    const classifications = extractAllFields(block, 'classification');

    // Identifiers (PPN, URN, shelfmark, VD numbers, etc.)
    const ids = parseIdentifiers(block);

    // DFG Viewer links (viewer URL, reference URL, IIIF manifest)
    const dvLinks = parseDvLinks(block);

    // File groups (image quality tiers)
    const fileGroups = parseFileGroups(block);

    // Also check dc:identifier for URLs (some libraries put manifest URLs there)
    const dcIdentifiers = extractAllFields(block, 'identifier');
    let manifestFromDc = null;
    let viewerFromDc = null;
    for (const val of dcIdentifiers) {
      if (val.includes('iiif') && val.includes('manifest') && !manifestFromDc) manifestFromDc = val;
      else if (val.startsWith('http') && !viewerFromDc) viewerFromDc = val;
    }

    records.push({
      oaiId,
      title,
      subtitle,
      author: primaryAuthor?.name || '',
      authorDates: primaryAuthor?.dates || null,
      additionalAuthors: additionalAuthors.length > 0 ? additionalAuthors : null,
      language,
      dateEarliest,
      dateLatest,
      displayDate,
      publisher,
      place,
      edition,
      extent,
      digitalOrigin,
      physicalFormat,
      pageCount,
      subjects,
      classifications,
      ids,
      dvLinks,
      fileGroups: fileGroups.length > 0 ? fileGroups : null,
      manifestUrl: dvLinks.iiif || manifestFromDc || null,
      viewerUrl: dvLinks.presentation || viewerFromDc || null,
      referenceUrl: dvLinks.reference || null,
    });
  }
  return records;
}

// ─── Extract surname ─────────────────────────────────────────────────────

function extractSurname(author) {
  if (!author) return null;
  const cleaned = author.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/<[^>]*>/g, '').trim();
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
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalWithManifest = 0;

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
          const res = await fetch(fetchUrl, {
            signal: AbortSignal.timeout(90000),
            headers: { 'User-Agent': 'SourceLibrary-Harvester/2.0 (sourcelibrary.org)' },
          });
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
      const records = parseMetsRecords(xml);
      totalFetched += records.length;

      // Filter to early modern period
      const earlyModern = records.filter(r => !r.dateEarliest || (r.dateEarliest >= 1400 && r.dateEarliest <= 1750));

      // Apply library-specific IIIF manifest fallback
      for (const rec of earlyModern) {
        if (!rec.manifestUrl && config.iiifManifest) {
          rec.manifestUrl = config.iiifManifest(rec.oaiId);
        }
        if (rec.manifestUrl) totalWithManifest++;
      }
      totalEarlyModern += earlyModern.length;

      // Store incrementally
      if (!DRY_RUN && col && earlyModern.length > 0) {
        const ops = earlyModern.map(r => {
          const setFields = {
            source: config.source,
            scan_quality: config.scanQuality,
            title: r.title,
            subtitle: r.subtitle,
            author: r.author,
            author_surname: extractSurname(r.author),
            additional_authors: r.additionalAuthors,
            language: r.language,
            date_earliest: r.dateEarliest,
            date_latest: r.dateLatest,
            display_date: r.displayDate,
            publisher: r.publisher,
            place: r.place,
            edition: r.edition,
            extent: r.extent,
            digital_origin: r.digitalOrigin,
            physical_format: r.physicalFormat,
            page_count: r.pageCount,
            subjects: r.subjects.length > 0 ? r.subjects : null,
            classifications: r.classifications.length > 0 ? r.classifications : null,
            viewer_url: r.viewerUrl,
            reference_url: r.referenceUrl,
            urn: r.ids.urn,
            ppn: r.ids.ppn,
            shelfmark: r.ids.shelfmark,
            vd16: r.ids.vd16,
            vd17: r.ids.vd17,
            vd18: r.ids.vd18,
            catalog_ids: Object.keys(r.ids.catalog_ids).length > 0 ? r.ids.catalog_ids : null,
            file_groups: r.fileGroups,
            harvested_at: new Date(),
            harvest_format: 'mets',
          };
          // Only set manifest_url if non-null (sparse index)
          if (r.manifestUrl) setFields.manifest_url = r.manifestUrl;

          return {
            updateOne: {
              filter: { oai_id: r.oaiId, source: config.source },
              update: {
                $set: setFields,
                $setOnInsert: {
                  oai_id: r.oaiId,
                  status: 'discovered',
                  discovered_at: new Date(),
                },
              },
              upsert: true,
            },
          };
        });

        try {
          const result = await col.bulkWrite(ops, { ordered: false });
          totalInserted += result.upsertedCount;
          totalUpdated += result.modifiedCount;
          totalSkipped += (ops.length - result.upsertedCount - result.modifiedCount);
        } catch (err) {
          if (err.result) {
            totalInserted += err.result.upsertedCount || 0;
            totalUpdated += err.result.modifiedCount || 0;
          }
          const msg = String(err.message || err);
          if (!msg.includes('duplicate key')) {
            console.error(`  Write error: ${msg.slice(0, 100)}`);
          }
        }
      }

      process.stdout.write(`    Page ${pageNum}: ${totalFetched.toLocaleString()} fetched, ${totalEarlyModern.toLocaleString()} pre-1700${!DRY_RUN ? `, ${totalInserted.toLocaleString()} new, ${totalUpdated.toLocaleString()} updated` : ''}, ${totalWithManifest.toLocaleString()} w/manifest${setTotal ? ` / ${setTotal.toLocaleString()} total` : ''}\r`);

      resumptionToken = extractResumptionToken(xml);
      if (!resumptionToken) break;
      if (LIMIT > 0 && totalEarlyModern >= LIMIT) break;

      await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`\n    Set ${set || '(all)'}: ${totalFetched.toLocaleString()} fetched, ${totalEarlyModern.toLocaleString()} pre-1700`);
    if (LIMIT > 0 && totalEarlyModern >= LIMIT) break;
  }

  return { totalFetched, totalEarlyModern, totalInserted, totalUpdated, totalSkipped, totalWithManifest };
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const config = LIBRARIES[LIBRARY];
  if (!config) {
    console.error(`Unknown library: ${LIBRARY}. Options: ${Object.keys(LIBRARIES).join(', ')}`);
    process.exit(1);
  }

  console.log(`=== Harvesting ${config.name} (METS) ===`);
  console.log(`Source: ${config.source}, Quality: ${config.scanQuality}`);
  console.log(`Format: ${config.metadataPrefix}`);
  console.log(`Dry run: ${DRY_RUN}, Limit: ${LIMIT || 'none'}\n`);

  let client, col;
  if (!DRY_RUN) {
    const uri = process.env.MONGODB_URI;
    if (!uri) { console.error('MONGODB_URI required'); process.exit(1); }
    client = new MongoClient(uri, { socketTimeoutMS: 120000, serverSelectionTimeoutMS: 15000 });
    await client.connect();
    col = client.db('bookstore').collection('import_candidates');
  }

  const result = await harvestOai(config, col);
  console.log(`\nTotal: ${result.totalFetched.toLocaleString()} fetched, ${result.totalEarlyModern.toLocaleString()} pre-1700`);
  console.log(`  With IIIF manifest: ${result.totalWithManifest.toLocaleString()}`);
  if (!DRY_RUN) {
    console.log(`  New: ${result.totalInserted.toLocaleString()}`);
    console.log(`  Updated: ${result.totalUpdated.toLocaleString()}`);
    console.log(`  Skipped (unchanged): ${result.totalSkipped.toLocaleString()}`);
  }

  if (!DRY_RUN && col) {
    try { await col.createIndex({ oai_id: 1, source: 1 }, { sparse: true, name: 'oai_id_source' }); } catch {}
  }

  if (client) await client.close();
  console.log('\nDone.');
}

main().catch(err => { console.error(err); process.exit(1); });
