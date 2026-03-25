#!/usr/bin/env node
/**
 * Import Rosenthaliana collection items from Allard Pierson (University of Amsterdam)
 * Source: uvaerfgoed.nl Goobi viewer IIIF manifests
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/import/import-rosenthaliana.mjs
 *
 * Add --dry-run to test manifest fetching without importing.
 */

const API_BASE = process.env.NEXT_PUBLIC_SITE_URL || 'https://sourcelibrary.org';
const API_KEY = process.env.CRON_SECRET;
const DRY_RUN = process.argv.includes('--dry-run');

if (!API_KEY) {
  console.error('Missing CRON_SECRET. Source .env.production.local first.');
  process.exit(1);
}

const CONTRIBUTING_LIBRARY = 'Bibliotheek Rosenthaliana (Allard Pierson, University of Amsterdam)';
const IIIF_BASE = 'https://uvaerfgoed.nl/viewer/api/v1/records';

const ITEMS = [
  {
    recordId: '11245_3_3685',
    title: 'Sefer Elim',
    author: 'Joseph Solomon Delmedigo',
    published: '1629',
    language: 'Hebrew',
    categories: ['Jewish Studies', 'Mathematics', 'Natural Philosophy'],
    notes: 'Mathematical and natural philosophical work by Delmedigo',
  },
  {
    recordId: '11245_3_3697',
    title: 'De nagelate schriften van Spinoza',
    author: 'Baruch Spinoza',
    published: '1677',
    language: 'Dutch',
    categories: ['Philosophy', 'Rationalism', 'Early Modern Philosophy'],
    notes: 'Opera Posthuma, Dutch edition (Nagelate Schriften)',
  },
  {
    recordId: '11245_3_25841',
    title: 'Conciliator',
    author: 'Menasseh ben Israel',
    published: '1633',
    language: 'Spanish',
    categories: ['Jewish Studies', 'Biblical Exegesis', 'Philosophy'],
    notes: 'Conciliator sive de convenientia locorum S. Scripturae',
  },
  {
    recordId: '11245_3_38641',
    title: 'De creatione problemata XXX',
    author: 'Menasseh ben Israel',
    published: '1636',
    language: 'Latin',
    categories: ['Jewish Studies', 'Theology', 'Natural Philosophy'],
    notes: 'Thirty problems on creation',
  },
  {
    recordId: '11245_3_3698',
    title: 'Sefer nishmat hayyim',
    author: 'Menasseh ben Israel',
    language: 'Hebrew',
    categories: ['Jewish Studies', 'Philosophy', 'Soul'],
    notes: 'Book of the Soul of Life — on immortality of the soul',
  },
  {
    recordId: '11245_3_4356',
    title: 'Piedra gloriosa',
    author: 'Menasseh ben Israel',
    language: 'Spanish',
    categories: ['Jewish Studies', 'Messianism', 'Kabbalah'],
    notes: 'Glorious Stone — messianic treatise with Rembrandt engravings',
  },
  {
    recordId: '11245_3_3523',
    title: 'Humble Address to Cromwell',
    author: 'Menasseh ben Israel',
    published: '1655',
    language: 'English',
    categories: ['Jewish Studies', 'Political History', 'Readmission of Jews'],
    notes: "Petition for readmission of Jews to England, addressed to Oliver Cromwell",
  },
  {
    recordId: '11245_3_3727',
    title: 'Psalterium Hebraeum',
    author: 'Menasseh ben Israel (editor)',
    language: 'Hebrew',
    categories: ['Jewish Studies', 'Biblical Texts', 'Psalms'],
    notes: 'Hebrew Psalter edited by Menasseh ben Israel',
  },
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchManifest(recordId) {
  const url = `${IIIF_BASE}/${recordId}/manifest/`;
  console.log(`  Fetching manifest: ${url}`);
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json, application/ld+json',
      'User-Agent': 'Mozilla/5.0 (compatible; SourceLibrary/1.0; +https://sourcelibrary.org)',
    },
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function extractLabel(label) {
  if (!label) return null;
  if (typeof label === 'string') return label;
  if (Array.isArray(label)) {
    const first = label[0];
    if (typeof first === 'string') return first;
    if (first?.['@value']) return first['@value'];
  }
  if (typeof label === 'object') {
    // IIIF v3 language map
    const vals = Object.values(label);
    if (vals.length && Array.isArray(vals[0])) return vals[0][0];
  }
  return null;
}

function countPages(manifest) {
  // IIIF v2
  if (manifest.sequences?.[0]?.canvases) {
    return manifest.sequences[0].canvases.length;
  }
  // IIIF v3
  if (manifest.items) {
    return manifest.items.length;
  }
  return null;
}

async function checkExists(title) {
  const url = `${API_BASE}/api/books/search?q=${encodeURIComponent(title)}&limit=5`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${API_KEY}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return false;
  const data = await res.json();
  const books = data.results || data.books || data || [];
  if (!Array.isArray(books)) return false;
  const norm = title.toLowerCase().trim();
  return books.some(b => {
    const t = (b.title || b.display_title || '').toLowerCase().trim();
    return t === norm || t.includes(norm) || norm.includes(t.substring(0, 20));
  });
}

async function importBook(item, manifest) {
  const manifest_url = `${IIIF_BASE}/${item.recordId}/manifest/`;
  const pageCount = countPages(manifest);
  const manifestTitle = extractLabel(manifest.label);

  console.log(`  Manifest title: ${manifestTitle || '(none)'}`);
  console.log(`  Page count: ${pageCount ?? '(unknown)'}`);

  // Use our curated title/author; fall back to manifest label if needed
  const title = item.title;
  const author = item.author;

  const body = {
    manifest_url,
    manifest_data: manifest,   // Pre-fetched: bypasses server-side 403 on uvaerfgoed.nl
    title,
    author,
    language: item.language,
    published: item.published,
    categories: item.categories,
    provider: CONTRIBUTING_LIBRARY,
    contributing_library: CONTRIBUTING_LIBRARY,
    license: 'publicdomain',
  };

  const res = await fetch(`${API_BASE}/api/import/iiif`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }

  if (res.status === 409) {
    // Already exists — return existing ID for enrichment
    return { json, pageCount, alreadyExists: true };
  }

  if (!res.ok) {
    throw new Error(`Import API ${res.status}: ${text.slice(0, 300)}`);
  }

  return { json, pageCount, alreadyExists: false };
}

async function enrichBook(bookId, item) {
  const patch = {
    digitized_by: 'Allard Pierson (University of Amsterdam)',
    digital_host: 'uvaerfgoed.nl',
  };

  const res = await fetch(`${API_BASE}/api/books/${bookId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(patch),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const text = await res.text();
    console.warn(`  ⚠ Enrich failed (${res.status}): ${text.slice(0, 200)}`);
  } else {
    console.log(`  Enriched: digitized_by + digital_host set`);
  }
}

async function main() {
  console.log(`\nRosenthaliana Import — ${ITEMS.length} items`);
  console.log(`API: ${API_BASE}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`);

  const results = [];

  for (let i = 0; i < ITEMS.length; i++) {
    const item = ITEMS[i];
    console.log(`[${i + 1}/${ITEMS.length}] ${item.title} (${item.author})`);

    try {
      // Check for duplicates
      const exists = await checkExists(item.title);
      if (exists) {
        console.log(`  SKIP — already exists in library\n`);
        results.push({ title: item.title, status: 'skipped' });
        await sleep(500);
        continue;
      }

      // Fetch manifest
      const manifest = await fetchManifest(item.recordId);

      if (DRY_RUN) {
        const pageCount = countPages(manifest);
        const manifestTitle = extractLabel(manifest.label);
        console.log(`  [DRY RUN] Would import: "${manifestTitle}" — ${pageCount} pages\n`);
        results.push({ title: item.title, status: 'dry-run', pageCount });
        continue;
      }

      // Import
      const { json, pageCount, alreadyExists } = await importBook(item, manifest);

      const bookId = json.bookId || json.id || json._id || json.existingId;
      const slug = json.slug;

      if (alreadyExists) {
        console.log(`  ALREADY EXISTS: id=${bookId}`);
        if (bookId) await enrichBook(bookId, item);
        results.push({ title: item.title, status: 'already_exists', bookId, slug, pageCount });
      } else {
        console.log(`  IMPORTED: id=${bookId} slug=${slug} pages=${pageCount}`);
        if (bookId) {
          const url = slug
            ? `https://sourcelibrary.org/book/${slug}`
            : `https://sourcelibrary.org/book/${bookId}`;
          console.log(`  URL: ${url}`);
          await enrichBook(bookId, item);
        }
        results.push({ title: item.title, status: 'imported', bookId, slug, pageCount });
      }
    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      results.push({ title: item.title, status: 'error', error: err.message });
    }

    console.log('');
    if (i < ITEMS.length - 1) await sleep(2000);
  }

  // Summary
  console.log('\n=== SUMMARY ===');
  for (const r of results) {
    const icon = r.status === 'imported' ? '✓'
      : r.status === 'already_exists' ? '✓'
      : r.status === 'skipped' ? '–'
      : r.status === 'dry-run' ? '○'
      : '✗';
    const detail = r.status === 'imported'
      ? ` → ${r.slug || r.bookId} (${r.pageCount} pages) [NEW]`
      : r.status === 'already_exists'
      ? ` → ${r.bookId} (enriched) [EXISTING]`
      : r.status === 'error'
      ? ` → ${r.error}`
      : r.status === 'dry-run'
      ? ` → ${r.pageCount} pages`
      : '';
    console.log(`  ${icon} ${r.title}${detail}`);
  }

  const imported = results.filter(r => r.status === 'imported').length;
  const existing = results.filter(r => r.status === 'already_exists').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const errors = results.filter(r => r.status === 'error').length;
  console.log(`\nTotal: ${imported} newly imported, ${existing} already existed (enriched), ${skipped} skipped, ${errors} errors`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
