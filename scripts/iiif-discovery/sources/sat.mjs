#!/usr/bin/env node
/**
 * SAT Daizokyo Buddhist Text Discovery
 *
 * Harvests Buddhist manuscript IIIF manifests from the SAT Daizokyo
 * Text Database (bauddha.dhii.jp). SAT aggregates manifests from
 * multiple institutions: BSB Munich, NDL Japan, Kyushu, Keio,
 * Koyasan, Bukkyo, Nagoya, Shimane, Cambridge, Vatican, etc.
 *
 * Single JSON endpoint returns all ~288 manifest URLs.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/iiif-discovery/sources/sat.mjs
 *
 * Options:
 *   --dry-run     Show what would be discovered, don't write to DB
 */

import { withMongo } from '../../lib/mongo.mjs';
import { ensureIndexes, insertCandidate } from '../lib/candidate-store.mjs';

const SOURCE = 'sat_daizokyo';
const LIST_URL = 'https://bauddha.dhii.jp/SAT/iiifmani/show.php?m=getList&m2=json';
const DRY_RUN = process.argv.includes('--dry-run');

// Map hostname to institution name
function getInstitution(url) {
  if (url.includes('digitale-sammlungen.de')) return 'Bayerische Staatsbibliothek';
  if (url.includes('dl.ndl.go.jp')) return 'National Diet Library Japan';
  if (url.includes('catalog.lib.kyushu-u.ac.jp')) return 'Kyushu University Library';
  if (url.includes('dcollections.lib.keio.ac.jp')) return 'Keio University Libraries';
  if (url.includes('rmda.kulib.kyoto-u.ac.jp')) return 'Kyoto University Library';
  if (url.includes('koyasan')) return 'Koyasan University Library';
  if (url.includes('bukkyo')) return 'Bukkyo University Library';
  if (url.includes('nagoya')) return 'Nagoya University Library';
  if (url.includes('shimane')) return 'Shimane University Library';
  if (url.includes('ryukoku')) return 'Ryukoku University Library';
  if (url.includes('cambridge')) return 'Cambridge University Library';
  if (url.includes('digi.vatlib.it')) return 'Vatican Library';
  if (url.includes('crossasia')) return 'CrossAsia';
  if (url.includes('u-tokyo.ac.jp') || url.includes('dzkimgs')) return 'University of Tokyo';
  if (url.includes('waseda.ac.jp')) return 'Waseda University';
  if (url.includes('kokusho.nijl.ac.jp')) return 'NIJL Kokusho';
  return 'Unknown';
}

async function fetchManifestMetadata(manifestUrl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(manifestUrl, { signal: controller.signal });
    if (!res.ok) return null;
    const manifest = await res.json();

    // Extract label (IIIF v2 or v3)
    let title = 'Unknown';
    const label = manifest.label;
    if (typeof label === 'string') title = label;
    else if (label?.['@value']) title = label['@value'];
    else if (Array.isArray(label)) title = typeof label[0] === 'string' ? label[0] : label[0]?.['@value'] || 'Unknown';
    else if (label?.en) title = label.en[0] || 'Unknown';
    else if (label?.ja) title = label.ja[0] || 'Unknown';
    else if (label?.none) title = label.none[0] || 'Unknown';

    // Count canvases
    const canvases = manifest.sequences?.[0]?.canvases || manifest.items || [];

    // Extract metadata
    const metadata = {};
    for (const item of manifest.metadata || []) {
      let key = item.label;
      if (typeof key === 'object') key = key['@value'] || key.en?.[0] || key.ja?.[0] || JSON.stringify(key);
      let val = item.value;
      if (typeof val === 'object' && !Array.isArray(val)) val = val['@value'] || val.en?.[0] || val.ja?.[0] || JSON.stringify(val);
      if (Array.isArray(val)) val = val.map(v => typeof v === 'object' ? v['@value'] || JSON.stringify(v) : v).join('; ');
      if (key && val) metadata[key] = val;
    }

    return {
      title: title.slice(0, 500),
      page_count: canvases.length,
      metadata,
      attribution: manifest.attribution || null,
    };
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

await withMongo(async (db) => {
  if (!DRY_RUN) {
    try { await ensureIndexes(db); } catch (e) {
      console.log(`[sat] Index warning (OK if already exists): ${e.message.slice(0, 80)}`);
    }
  }

  console.log(`[sat] Fetching manifest list from SAT Daizokyo...`);
  const res = await fetch(LIST_URL);
  if (!res.ok) {
    console.error(`[sat] Failed to fetch manifest list: HTTP ${res.status}`);
    process.exit(1);
  }

  const data = await res.json();
  // SAT returns an array of { id, sid, mani, title, lang, index, fascicle, cname, cdate, attribution }
  const manifests = Array.isArray(data) ? data : [];
  console.log(`[sat] Found ${manifests.length} manifests`);

  // Count by institution
  const byCname = {};
  for (const m of manifests) {
    const inst = getInstitution(m.mani || '');
    byCname[inst] = (byCname[inst] || 0) + 1;
  }
  console.log(`[sat] By institution:`);
  for (const [inst, count] of Object.entries(byCname).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${inst}: ${count}`);
  }

  let inserted = 0, skipped = 0, errors = 0;

  for (let i = 0; i < manifests.length; i++) {
    const entry = manifests[i];
    const manifestUrl = entry.mani;

    if (!manifestUrl) {
      errors++;
      continue;
    }

    const institution = getInstitution(manifestUrl);
    const title = entry.title || 'Buddhist Text';

    if (DRY_RUN) {
      if (i < 20 || i % 500 === 0) {
        console.log(`  [${i + 1}/${manifests.length}] ${institution}: ${title.slice(0, 50)} | ${manifestUrl.slice(0, 80)}`);
      }
      inserted++;
      continue;
    }

    const result = await insertCandidate(db, {
      manifest_url: manifestUrl,
      source: SOURCE,
      origin_library: institution,
      title,
      author: entry.attribution || 'Unknown',
      language: entry.lang || 'Multiple',
      date_text: entry.cdate || null,
      page_count: null, // Don't fetch each manifest — too slow for 8K items
      categories: ['buddhism', 'religious-texts'],
      provider_name: 'SAT Daizokyo',
      source_url: manifestUrl,
      source_id: entry.id || entry.sid,
      metadata: {
        fascicle: entry.fascicle,
        collection: entry.cname,
        index: entry.index,
      },
    });

    if (result.inserted) {
      inserted++;
      if (inserted <= 20 || inserted % 100 === 0) {
        console.log(`  [${i + 1}/${manifests.length}] NEW: ${title.slice(0, 50)} (${institution})`);
      }
    } else {
      skipped++;
    }
  }

  console.log(`\n[sat] Done: ${inserted} inserted, ${skipped} skipped, ${errors} errors`);
});
