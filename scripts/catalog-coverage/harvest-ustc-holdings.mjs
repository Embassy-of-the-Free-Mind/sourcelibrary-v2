#!/usr/bin/env node
/**
 * Harvest USTC holdings (copy locations) and digitisation links.
 *
 * Fetches edition pages from ustc.ac.uk, parses Inertia.js data-page JSON,
 * extracts copies (library holdings) and digitisation URLs.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/catalog-coverage/harvest-ustc-holdings.mjs --sample=100
 *   node scripts/catalog-coverage/harvest-ustc-holdings.mjs --limit=5000
 *   node scripts/catalog-coverage/harvest-ustc-holdings.mjs --limit=5000 --unscanned-only
 *   node scripts/catalog-coverage/harvest-ustc-holdings.mjs --dry-run --sample=10
 */

import { MongoClient } from 'mongodb';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';

const DRY_RUN = process.argv.includes('--dry-run');
const UNSCANNED_ONLY = process.argv.includes('--unscanned-only');
const SAMPLE = parseInt(process.argv.find(a => a.startsWith('--sample='))?.split('=')[1] || '0');
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0');
const DELAY_MS = 1000; // 1 req/sec to be polite

const USTC_BASE = 'https://www.ustc.ac.uk/editions';

async function fetchEdition(sn) {
  const url = `${USTC_BASE}/${sn}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    headers: { 'User-Agent': 'SourceLibrary-CatalogCoverage/1.0 (academic research; https://sourcelibrary.org)' },
  });
  if (!res.ok) return null;

  const html = await res.text();
  const match = html.match(/data-page="([^"]*)"/);
  if (!match) return null;

  try {
    const decoded = match[1]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#039;/g, "'");
    const data = JSON.parse(decoded);
    if (data.component === 'Error') return null;
    return data.props;
  } catch {
    return null;
  }
}

async function main() {
  console.log('=== Harvest USTC Holdings & Digitisations ===');
  console.log(`Dry run: ${DRY_RUN}, Sample: ${SAMPLE || 'none'}, Limit: ${LIMIT || 'none'}, Unscanned only: ${UNSCANNED_ONLY}\n`);

  const uri = process.env.MONGODB_URI;
  if (!uri && !DRY_RUN) { console.error('MONGODB_URI required'); process.exit(1); }

  let client, db;
  if (!DRY_RUN) {
    client = new MongoClient(uri, { socketTimeoutMS: 60000, serverSelectionTimeoutMS: 15000 });
    await client.connect();
    db = client.db('bookstore');
  }

  // Get edition SNs to fetch
  let sns = [];
  if (UNSCANNED_ONLY && db) {
    // Get unscanned editions from catalog_coverage
    console.log('Loading unscanned edition SNs from catalog_coverage...');
    const cursor = db.collection('catalog_coverage').find(
      { has_iiif_scan: { $ne: true } },
      { projection: { ustc_id: 1, _id: 0 } }
    );
    for await (const doc of cursor) {
      if (doc.ustc_id) sns.push(String(doc.ustc_id));
    }
    console.log(`  ${sns.length.toLocaleString()} unscanned editions`);
  } else {
    // Load all SNs from the USTC CSV
    console.log('Loading SNs from USTC CSV...');
    const csvPath = process.env.HOME + '/secondrenaissance/data/ustc/ustc_editions.csv';
    const rl = createInterface({ input: createReadStream(csvPath) });
    let header = true;
    let snIdx = -1;
    for await (const line of rl) {
      if (header) {
        const cols = line.split(',');
        snIdx = cols.indexOf('sn');
        header = false;
        continue;
      }
      // Simple CSV parse — sn is early in the row and numeric
      const cols = line.split(',');
      const sn = cols[snIdx]?.replace(/"/g, '');
      if (sn && /^\d+$/.test(sn)) sns.push(sn);
    }
    console.log(`  ${sns.length.toLocaleString()} SNs loaded from CSV`);
  }

  // Sample or limit
  if (SAMPLE > 0) {
    // Random sample
    for (let i = sns.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [sns[i], sns[j]] = [sns[j], sns[i]];
    }
    sns = sns.slice(0, SAMPLE);
    console.log(`  Sampled ${sns.length} SNs`);
  } else if (LIMIT > 0) {
    sns = sns.slice(0, LIMIT);
    console.log(`  Limited to ${sns.length} SNs`);
  }

  // Fetch and store
  let fetched = 0, found = 0, errors = 0, notFound = 0;
  let totalCopies = 0, totalDigitisations = 0;
  const copiesByCountry = {};
  const digitisationProviders = {};

  for (let i = 0; i < sns.length; i++) {
    const sn = sns[i];
    try {
      const props = await fetchEdition(sn);
      fetched++;

      if (!props || !props.edition) {
        notFound++;
      } else {
        found++;
        const copies = props.copies || [];
        const digitisations = props.digitisations || [];
        totalCopies += copies.length;
        totalDigitisations += digitisations.length;

        // Track stats
        for (const c of copies) {
          const country = c.country || 'Unknown';
          copiesByCountry[country] = (copiesByCountry[country] || 0) + 1;
        }
        for (const d of digitisations) {
          const provider = d.provider || 'Unknown';
          digitisationProviders[provider] = (digitisationProviders[provider] || 0) + 1;
        }

        // Store in MongoDB
        if (!DRY_RUN && db && (copies.length > 0 || digitisations.length > 0)) {
          const ed = props.edition;
          await db.collection('ustc_holdings').updateOne(
            { ustc_sn: sn },
            {
              $set: {
                ustc_sn: sn,
                title: ed.std_title || '',
                author: ed.author_name_1 || '',
                year: ed.year || null,
                place: ed.place || '',
                copies_count: copies.length,
                copies: copies.map(c => ({
                  library: c.name || '',
                  city: c.city || '',
                  country: c.country || '',
                  shelfmark: c.shelfmark || '',
                })),
                digitisations: digitisations.map(d => ({
                  provider: d.provider || '',
                  url: d.url || '',
                })),
                fetched_at: new Date(),
              },
            },
            { upsert: true }
          );
        }
      }
    } catch (err) {
      errors++;
      if (errors <= 5) console.error(`  Error on SN ${sn}: ${err.message}`);
    }

    if (fetched % 10 === 0 || i === sns.length - 1) {
      process.stdout.write(`  ${fetched}/${sns.length} fetched, ${found} found, ${notFound} not found, ${errors} errors, ${totalCopies} copies, ${totalDigitisations} digitisations\r`);
    }

    // Rate limit
    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  // Create index
  if (!DRY_RUN && db) {
    try { await db.collection('ustc_holdings').createIndex({ ustc_sn: 1 }, { unique: true }); } catch {}
  }

  console.log(`\n\n=== Results ===`);
  console.log(`  Fetched: ${fetched}`);
  console.log(`  Found: ${found}`);
  console.log(`  Not found: ${notFound}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Total copies: ${totalCopies.toLocaleString()}`);
  console.log(`  Total digitisations: ${totalDigitisations.toLocaleString()}`);
  console.log(`  Avg copies/edition: ${found > 0 ? (totalCopies / found).toFixed(1) : 0}`);
  console.log(`  Avg digitisations/edition: ${found > 0 ? (totalDigitisations / found).toFixed(1) : 0}`);

  console.log(`\n--- Copies by country (top 15) ---`);
  Object.entries(copiesByCountry)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .forEach(([k, v]) => console.log(`  ${k}: ${v.toLocaleString()}`));

  console.log(`\n--- Digitisation providers (all) ---`);
  Object.entries(digitisationProviders)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  if (client) await client.close();
  if (DRY_RUN) console.log('\n(DRY RUN — nothing written)');
}

main().catch(err => { console.error(err); process.exit(1); });
