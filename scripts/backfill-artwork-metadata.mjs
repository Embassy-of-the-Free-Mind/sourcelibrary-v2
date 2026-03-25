#!/usr/bin/env node
/**
 * Backfill artwork records with complete Commons metadata.
 * Re-fetches extmetadata for all artworks and updates the DB with:
 * - commons_categories (were empty due to API bug)
 * - commons_credit (holding museum / source)
 * - commons_license_url, commons_usage_terms, etc.
 * - image_source.attribution, access_date, identifier
 * - Extracted holding museum from Credit or filename
 *
 * Usage: set -a; source .env.production.local; set +a; node scripts/backfill-artwork-metadata.mjs
 */

import { MongoClient } from 'mongodb';

const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; contact@sourcelibrary.org)';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';

function cleanHtml(html) {
  if (!html) return '';
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

/** Extract holding museum from Credit field or filename */
function extractMuseum(credit, filename) {
  // Common patterns in Credit: "Google Art Project", museum names
  // Common patterns in filenames: MET, NGA, Rijksmuseum, WGA
  const museums = {
    'MET': 'The Metropolitan Museum of Art',
    'NGA': 'National Gallery of Art, Washington',
    'Rijksmuseum': 'Rijksmuseum, Amsterdam',
    'WGA': 'Web Gallery of Art',
    'Google Art Project': 'Google Art Project',
    'Uffizi': 'Galleria degli Uffizi, Florence',
    'Louvre': 'Musée du Louvre, Paris',
    'National Gallery': 'National Gallery, London',
    'Prado': 'Museo del Prado, Madrid',
    'RP-P': 'Rijksmuseum, Amsterdam', // Rijksprentenkabinet inventory prefix
    'RP-T': 'Rijksmuseum, Amsterdam',
    'BI-': 'Rijksmuseum, Amsterdam',
    'SK-A': 'Rijksmuseum, Amsterdam',
    'NL-HlmNHA': 'Noord-Hollands Archief, Haarlem',
  };

  const combined = `${credit || ''} ${filename || ''}`;
  for (const [pattern, museum] of Object.entries(museums)) {
    if (combined.includes(pattern)) return museum;
  }

  // Try to extract from Credit if it contains a known institution pattern
  if (credit) {
    // "Courtesy of X" or "Collection of X" patterns
    const match = credit.match(/(?:courtesy of|collection of|from|©)\s+(.+?)(?:\.|,|$)/i);
    if (match) return match[1].trim();
  }

  return '';
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  // Get all artworks that need backfill
  const artworks = await books.find(
    { resource_type: { $exists: true }, commons_title: { $exists: true } },
    { projection: { _id: 1, commons_title: 1 } }
  ).toArray();

  console.log(`Backfilling ${artworks.length} artworks...`);

  let updated = 0;
  let errors = 0;

  // Process in batches of 50 (API limit)
  for (let i = 0; i < artworks.length; i += 50) {
    const batch = artworks.slice(i, i + 50);
    const titles = batch.map(a => a.commons_title);

    try {
      const url = new URL(COMMONS_API);
      url.searchParams.set('format', 'json');
      url.searchParams.set('action', 'query');
      url.searchParams.set('titles', titles.join('|'));
      url.searchParams.set('prop', 'imageinfo|categories');
      url.searchParams.set('iiprop', 'extmetadata|url|sha1|timestamp|user');
      url.searchParams.set('cllimit', '50');

      const res = await fetch(url.toString(), { headers: { 'User-Agent': UA } });
      if (!res.ok) { errors++; continue; }
      const data = await res.json();

      for (const page of Object.values(data.query?.pages || {})) {
        const p = page;
        if (!p.imageinfo?.[0]) continue;
        const info = p.imageinfo[0];
        const ext = info.extmetadata || {};
        const categories = (p.categories || []).map(c => c.title.replace('Category:', ''));
        const credit = cleanHtml(ext.Credit?.value) || '';
        const artist = cleanHtml(ext.Artist?.value) || '';
        const museum = extractMuseum(credit, p.title);

        // Find matching artwork in our batch
        const artwork = batch.find(a => a.commons_title === p.title);
        if (!artwork) continue;

        const update = {
          commons_categories: categories,
          commons_credit: credit,
          commons_license_url: ext.LicenseUrl?.value || '',
          commons_usage_terms: ext.UsageTerms?.value || '',
          commons_copyrighted: ext.Copyrighted?.value === 'True',
          commons_attribution_required: ext.AttributionRequired?.value === 'true',
          commons_restrictions: ext.Restrictions?.value || '',
          commons_assessment: ext.Assessments?.value || '',
          commons_sha1: info.sha1 || '',
          commons_upload_date: info.timestamp || '',
          commons_uploader: info.user || '',
          commons_artist_html: ext.Artist?.value?.slice(0, 500) || '',
          harvested_at: new Date(),
          // Update image_source with complete info
          'image_source.attribution': credit || artist || '',
          'image_source.access_date': new Date(),
          'image_source.identifier': p.title.replace('File:', ''),
          'image_source.contributing_library': museum,
        };

        await books.updateOne({ _id: artwork._id }, { $set: update });
        updated++;
      }
    } catch (err) {
      console.error(`Batch error at ${i}: ${err.message}`);
      errors++;
    }

    if (i % 500 === 0 && i > 0) {
      console.log(`  ${i}/${artworks.length} processed, ${updated} updated`);
    }

    await new Promise(r => setTimeout(r, 100)); // Rate limit
  }

  console.log(`\nDone. Updated: ${updated}, Errors: ${errors}`);
  await client.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
