#!/usr/bin/env node
/**
 * Enrich e-rara books with specific Swiss holding library names.
 * Fetches IIIF manifests one at a time (1 req/s) and extracts
 * the library from logo.service.@id.
 *
 * Designed to run from Hetzner (European server, ~5 hours for 17K books).
 *
 * Usage:
 *   node scripts/enrich-erara-swiss-libraries.mjs
 *   DRY_RUN=1 node scripts/enrich-erara-swiss-libraries.mjs
 */
import { MongoClient } from 'mongodb';

const DRY_RUN = process.env.DRY_RUN === '1';

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

function resolveLibrary(logoUrl) {
  if (!logoUrl) return null;
  // Direct match
  if (LOGO_MAP[logoUrl]) return LOGO_MAP[logoUrl];
  // Hostname match
  try {
    const host = new URL(logoUrl.startsWith('http') ? logoUrl : `http://${logoUrl}`).hostname;
    for (const [pattern, name] of Object.entries(LOGO_MAP)) {
      try {
        const patternHost = new URL(pattern.startsWith('http') ? pattern : `http://${pattern}`).hostname;
        if (host === patternHost) return name;
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
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
  let updated = 0, failed = 0, unmapped = 0;
  const unmappedLogos = {};

  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    try {
      const resp = await fetch(book.image_source.iiif_manifest, {
        signal: AbortSignal.timeout(15000),
        headers: { 'Accept': 'application/json' },
      });

      if (resp.status === 429 || resp.status === 503) {
        // Rate limited — wait 30s and retry once
        console.log(`  [${i}] Rate limited (${resp.status}), waiting 30s...`);
        await new Promise(r => setTimeout(r, 30000));
        const retry = await fetch(book.image_source.iiif_manifest, {
          signal: AbortSignal.timeout(15000),
          headers: { 'Accept': 'application/json' },
        });
        if (!retry.ok) { failed++; continue; }
        const manifest = await retry.json();
        const logoUrl = manifest?.logo?.service?.['@id'];
        const library = resolveLibrary(logoUrl);
        if (library && !DRY_RUN) {
          await db.collection('books').updateOne({ _id: book._id }, { $set: { 'image_source.contributing_library': library } });
          updated++;
        } else if (!library) {
          unmapped++;
          if (logoUrl) unmappedLogos[logoUrl] = (unmappedLogos[logoUrl] || 0) + 1;
        }
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      if (!resp.ok) { failed++; await new Promise(r => setTimeout(r, 1000)); continue; }
      const manifest = await resp.json();
      const logoUrl = manifest?.logo?.service?.['@id'];
      const library = resolveLibrary(logoUrl);

      if (library) {
        if (!DRY_RUN) {
          await db.collection('books').updateOne({ _id: book._id }, { $set: { 'image_source.contributing_library': library } });
        }
        updated++;
      } else {
        unmapped++;
        if (logoUrl) unmappedLogos[logoUrl] = (unmappedLogos[logoUrl] || 0) + 1;
      }
    } catch {
      failed++;
    }

    // Progress every 500
    if ((i + 1) % 500 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
      const rate = ((i + 1) / ((Date.now() - startTime) / 1000)).toFixed(1);
      console.log(`  ${i + 1}/${books.length} — ${updated} updated, ${failed} failed, ${unmapped} unmapped — ${elapsed}min (${rate} req/s)`);
    }

    // 1 request per second
    await new Promise(r => setTimeout(r, 1000));
  }

  if (Object.keys(unmappedLogos).length > 0) {
    console.log('\nUnmapped logo URLs:');
    for (const [url, count] of Object.entries(unmappedLogos).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${count}  ${url}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\nDone in ${elapsed} minutes. Updated: ${updated}, Failed: ${failed}, Unmapped: ${unmapped}`);
  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
