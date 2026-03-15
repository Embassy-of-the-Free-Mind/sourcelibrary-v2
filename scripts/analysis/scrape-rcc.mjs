/**
 * Scrape Renaissance Cultural Crossroads catalog
 *
 * Iterate through record IDs and extract structured data.
 * Records are at: index.php?page=full_record&id=N
 * IDs appear to be sequential; we'll scan a range.
 */

import { writeFileSync, existsSync, readFileSync } from 'fs';

const BASE = 'https://www.dhi.ac.uk/rcc/index.php';
const CACHE_PATH = 'scripts/analysis/rcc-records.json';

function parseRecord(html, id) {
  // The record data appears as: Label:ValueLabel:Value...
  // Extract from the full_record div
  const record = { id };

  const fields = [
    ['estc', /ESTC Citation:([^<]*?)(?=(?:STC|Uniform|Title|$))/],
    ['stc', /STC Citation:([^<]*?)(?=(?:Uniform|Title|$))/],
    ['uniformTitle', /Uniform Title:([^<]*?)(?=(?:Title:|Variant))/],
    ['title', /(?:^|>)Title:([^<]*?)(?=(?:Variant|Publisher|$))/],
    ['variantTitle', /Variant Title:([^<]*?)(?=(?:Publisher|Year|$))/],
    ['publisher', /Publisher\/Year:([^<]*?)(?=(?:Year:|Physical))/],
    ['year', /(?:^|>)Year:(\d{4})/],
    ['subject', /Subject:([^<]*?)(?=(?:Original Author|Translator|$))/],
    ['originalAuthor', /Original Author:([^<]*?)(?=(?:Translator|Original Language|$))/],
    ['translator', /Translator:([^<]*?)(?=(?:Original Language|Target Language|$))/],
    ['originalLanguage', /Original Language:([^<]*?)(?=(?:Target Language|Intermediary|Liminary|Notes|$))/],
    ['targetLanguage', /Target Language:([^<]*?)(?=(?:Intermediary|Liminary|Notes|$))/],
    ['intermediaryLanguage', /Intermediary Language:([^<]*?)(?=(?:Liminary|Notes|$))/],
    ['notes', /Notes on Translator:([^<]*?)(?=(?:«|$))/],
  ];

  // Strip HTML tags for easier parsing
  const text = html.replace(/<[^>]*>/g, '');

  for (const [key, regex] of fields) {
    const match = text.match(regex);
    if (match) {
      record[key] = match[1].trim();
    }
  }

  return record;
}

async function fetchRecord(id) {
  try {
    const res = await fetch(`${BASE}?page=full_record&id=${id}`, { timeout: 10000 });
    if (!res.ok) return null;
    const html = await res.text();

    // Check if it's a valid record (has "Original Author" or "Title:" in content)
    if (!html.includes('Original Author:') && !html.includes('Uniform Title:')) return null;

    return parseRecord(html, id);
  } catch (e) {
    return null;
  }
}

async function main() {
  console.log('=== Renaissance Cultural Crossroads Scrape ===\n');

  let records = [];

  if (existsSync(CACHE_PATH)) {
    records = JSON.parse(readFileSync(CACHE_PATH, 'utf-8'));
    console.log(`Loaded ${records.length} cached records\n`);
  }

  const maxSeenId = records.length > 0 ? Math.max(...records.map(r => r.id)) : 0;

  // The search found IDs like 565, 566, 2629, 2633, 2636, 2638, 2640 for Machiavelli
  // Let's scan a wide range. Based on "6000+ records", IDs probably go up to ~7000-8000
  const startId = maxSeenId > 0 ? maxSeenId + 1 : 1;
  const endId = 10000;
  const batchSize = 20; // Concurrent requests

  console.log(`Scanning IDs ${startId} to ${endId}...`);
  let found = records.length;
  let empty = 0;
  let consecutiveEmpty = 0;

  for (let batchStart = startId; batchStart <= endId; batchStart += batchSize) {
    const promises = [];
    for (let id = batchStart; id < batchStart + batchSize && id <= endId; id++) {
      promises.push(fetchRecord(id));
    }

    const results = await Promise.all(promises);

    for (const record of results) {
      if (record && record.title) {
        records.push(record);
        found++;
        consecutiveEmpty = 0;
      } else {
        empty++;
        consecutiveEmpty++;
      }
    }

    if (batchStart % 200 === 1 || batchStart + batchSize > endId) {
      process.stdout.write(`  ID ${batchStart}: ${found} records found, ${empty} empty\r`);
    }

    // Small delay to be polite
    await new Promise(r => setTimeout(r, 200));

    // Save periodically
    if (found % 500 === 0 && found > 0) {
      writeFileSync(CACHE_PATH, JSON.stringify(records, null, 2));
    }
  }

  console.log(`\n\nTotal records: ${records.length}`);

  // Save
  writeFileSync(CACHE_PATH, JSON.stringify(records, null, 2));

  // Stats
  const byOrigLang = {};
  const byTargetLang = {};
  const authors = {};

  for (const r of records) {
    const ol = (r.originalLanguage || 'unknown').trim();
    byOrigLang[ol] = (byOrigLang[ol] || 0) + 1;

    const tl = (r.targetLanguage || 'unknown').trim();
    byTargetLang[tl] = (byTargetLang[tl] || 0) + 1;

    const author = (r.originalAuthor || 'unknown').toLowerCase().trim();
    if (!authors[author]) authors[author] = 0;
    authors[author]++;
  }

  console.log('\nBy original language:');
  for (const [l, c] of Object.entries(byOrigLang).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${l}: ${c}`);
  }

  console.log('\nBy target language:');
  for (const [l, c] of Object.entries(byTargetLang).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`  ${l}: ${c}`);
  }

  const authorList = Object.entries(authors).sort((a, b) => b[1] - a[1]);
  console.log(`\nDistinct original authors: ${authorList.length}`);
  console.log('\nTop 30 authors:');
  for (const [a, c] of authorList.slice(0, 30)) {
    console.log(`  ${String(c).padEnd(5)} ${a}`);
  }

  // MACHIAVELLI TEST
  const mach = records.filter(r => (r.originalAuthor || '').toLowerCase().includes('machiavelli'));
  console.log(`\n--- MACHIAVELLI TEST ---`);
  console.log(`Records: ${mach.length}`);
  for (const r of mach) {
    console.log(`  ${(r.year || '?')} ${(r.title || '?').substring(0, 70)} [${r.originalLanguage}→${r.targetLanguage}]`);
  }

  console.log(`\nSaved ${records.length} records to ${CACHE_PATH}`);
}

main().catch(console.error);
