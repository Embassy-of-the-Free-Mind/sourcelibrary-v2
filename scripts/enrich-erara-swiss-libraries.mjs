#!/usr/bin/env node
/**
 * Enrich e-rara books with metadata from IIIF manifests.
 *
 * Extracts from each manifest:
 * - contributing_library + shelfmark (from "Besitzende Institution")
 * - physical_description (from "Umfang")
 * - imprint (from "Impressum")
 * - DOI (from "DOI" metadata field)
 *
 * Runs at 1 req/s to respect e-rara rate limits.
 *
 * Usage:
 *   node scripts/enrich-erara-swiss-libraries.mjs
 *   DRY_RUN=1 node scripts/enrich-erara-swiss-libraries.mjs
 */
import { MongoClient } from 'mongodb';

const DRY_RUN = process.env.DRY_RUN === '1';

// Fallback: logo URL → library name (for manifests missing "Besitzende Institution")
const LOGO_MAP = {
  'http://www.ub.unibas.ch': 'Universitätsbibliothek Basel',
  'http://www.zb.uzh.ch': 'Zentralbibliothek Zürich',
  'http://www.ville-ge.ch/bge': 'Bibliothèque de Genève',
  'http://www.library.ethz.ch': 'ETH-Bibliothek Zürich',
  'http://www.ub.unibe.ch': 'Universitätsbibliothek Bern',
  'http://www.cgjung-werke.org': 'Stiftung der Werke von C.G. Jung (Zürich)',
  'http://www.unige.ch/ihr': 'Institut d\'histoire de la Réformation, Genève',
  'http://www.sbt.ti.ch/bsf/': 'Biblioteca Salita dei Frati (Lugano)',
  'www.stiftsbezirk.ch/de/stiftsbibliothek/': 'Stiftsbibliothek St. Gallen',
  'http://www.zbsolothurn.ch': 'Zentralbibliothek Solothurn',
  'www.bibliotheken-schaffhausen.ch': 'Stadtbibliothek Schaffhausen',
  'http://biblio.unibe.ch/adam': 'Universitätsbibliothek Bern (Medizinhistorik)',
  'http://www.snl.ch': 'Schweizerische Nationalbibliothek (Bern)',
  'http://www.nb.admin.ch': 'Schweizerische Nationalbibliothek (Bern)',
  'http://www.bcul.vd.ch': 'Bibliothèque cantonale et universitaire de Lausanne',
  'http://www.kantonsbibliothek.gr.ch': 'Kantonsbibliothek Graubünden (Chur)',
  'http://www.ag.ch/kantonsbibliothek': 'Kantonsbibliothek Aargau',
};

function resolveLogoLibrary(logoUrl) {
  if (!logoUrl) return null;
  if (LOGO_MAP[logoUrl]) return LOGO_MAP[logoUrl];
  try {
    const host = new URL(logoUrl.startsWith('http') ? logoUrl : `http://${logoUrl}`).hostname;
    for (const [pattern, name] of Object.entries(LOGO_MAP)) {
      try {
        const ph = new URL(pattern.startsWith('http') ? pattern : `http://${pattern}`).hostname;
        if (host === ph) return name;
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
  return null;
}

function getMetadataValue(metadata, label) {
  const entry = metadata?.find(m => m.label === label);
  if (!entry) return null;
  const val = entry.value;
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'object' && val['@value']) return val['@value'].trim();
  return null;
}

async function main() {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  const books = await db.collection('books').find({
    'image_source.provider': 'e-rara',
    'image_source.contributing_library': 'e-rara (Swiss libraries)',
    'image_source.iiif_manifest': { $exists: true },
    status: { $ne: 'deleted' },
  }, { projection: { _id: 1, 'image_source.iiif_manifest': 1 } }).toArray();

  console.log(`${DRY_RUN ? 'DRY RUN — ' : ''}${books.length} e-rara books to enrich`);
  const startTime = Date.now();
  let updated = 0, failed = 0, noInstitution = 0;

  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    try {
      const resp = await fetch(book.image_source.iiif_manifest, {
        signal: AbortSignal.timeout(15000),
        headers: { 'Accept': 'application/json' },
      });

      if (resp.status === 429 || resp.status === 503) {
        console.log(`  [${i}] Rate limited (${resp.status}), waiting 60s...`);
        await new Promise(r => setTimeout(r, 60000));
        failed++;
        continue;
      }

      if (!resp.ok) { failed++; await new Promise(r => setTimeout(r, 1000)); continue; }
      const manifest = await resp.json();
      const metadata = manifest.metadata || [];

      // Extract fields
      const besitzende = getMetadataValue(metadata, 'Besitzende Institution');
      const umfang = getMetadataValue(metadata, 'Umfang');
      const impressum = getMetadataValue(metadata, 'Impressum');
      const doi = getMetadataValue(metadata, 'DOI');

      // Parse "Besitzende Institution" → library name + shelfmark
      // Format: "ETH-Bibliothek Zürich, Rar 6998" or "Zentralbibliothek Zürich, 43.194,2 | G"
      let library = null;
      let shelfmark = null;
      if (besitzende) {
        const commaIdx = besitzende.indexOf(',');
        if (commaIdx > 0) {
          library = besitzende.substring(0, commaIdx).trim();
          shelfmark = besitzende.substring(commaIdx + 1).trim();
        } else {
          library = besitzende.trim();
        }
      }

      // Fallback to logo if no "Besitzende Institution"
      if (!library) {
        const logoUrl = manifest?.logo?.service?.['@id'];
        library = resolveLogoLibrary(logoUrl);
        if (!library) noInstitution++;
      }

      // Build update
      const $set = {};
      if (library) $set['image_source.contributing_library'] = library;
      if (shelfmark) $set['image_source.shelfmark'] = shelfmark;
      if (umfang) $set['dublin_core.dc_format'] = umfang;
      if (impressum && !$set['dublin_core.dc_publisher']) $set['dublin_core.dc_publisher'] = impressum;
      if (doi && !doi.startsWith('http')) $set['image_source.doi'] = doi;

      if (Object.keys($set).length > 0 && !DRY_RUN) {
        await db.collection('books').updateOne({ _id: book._id }, { $set });
      }
      if (library) updated++;

    } catch {
      failed++;
    }

    // Progress every 100
    if ((i + 1) % 100 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
      const rate = ((i + 1) / ((Date.now() - startTime) / 1000)).toFixed(1);
      console.log(`  ${i + 1}/${books.length} — ${updated} enriched, ${failed} failed, ${noInstitution} no institution — ${elapsed}min (${rate} req/s)`);
    }

    // 1 request per second
    await new Promise(r => setTimeout(r, 1000));
  }

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\nDone in ${elapsed} minutes. Enriched: ${updated}, Failed: ${failed}, No institution: ${noInstitution}`);
  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
