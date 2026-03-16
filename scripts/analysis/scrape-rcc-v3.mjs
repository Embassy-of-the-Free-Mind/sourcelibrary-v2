/**
 * Scrape RCC v3 — simple sequential fetch of record IDs
 *
 * We know IDs exist in ranges (e.g., 565, 566, 2629-2640).
 * Strategy: scan IDs 1-8000, fetch each, parse if valid.
 * 1 second delay between requests.
 */

import { writeFileSync, existsSync, readFileSync } from 'fs';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const CACHE_FILE = 'scripts/analysis/rcc-records.json';

function parseRecord(html, id) {
  const text = html.replace(/<[^>]*>/g, '');
  const record = { id };

  const patterns = [
    ['estc', /ESTC Citation:(.+?)(?=STC Citation|Uniform Title|Title:|$)/s],
    ['stc', /STC Citation:(.+?)(?=Uniform Title|Title:|$)/s],
    ['uniformTitle', /Uniform Title:(.+?)(?=Title:|Variant Title|Publisher|$)/s],
    ['title', /[^a-zA-Z]Title:(.+?)(?=Variant Title|Publisher\/Year|Publisher:|Year:|$)/s],
    ['year', /[^a-zA-Z]Year:(\d{4})/],
    ['subject', /Subject:(.+?)(?=Original Author|Translator|Original Language|$)/s],
    ['originalAuthor', /Original Author:(.+?)(?=Translator|Original Language|Target Language|$)/s],
    ['translator', /Translator:(.+?)(?=Original Language|Target Language|Intermediary|$)/s],
    ['originalLanguage', /Original Language:(.+?)(?=Target Language|Intermediary|Liminary|Notes|«|$)/s],
    ['targetLanguage', /Target Language:(.+?)(?=Intermediary|Liminary|Notes|«|$)/s],
  ];

  for (const [key, regex] of patterns) {
    const match = text.match(regex);
    if (match) {
      record[key] = match[1].trim().substring(0, 500);
    }
  }

  return record;
}

async function main() {
  console.log('=== RCC Scrape v3 ===\n');

  let records = [];
  const seenIds = new Set();

  if (existsSync(CACHE_FILE)) {
    const cached = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
    if (cached.length > 0) {
      records = cached;
      for (const r of records) seenIds.add(r.id);
      console.log(`Loaded ${records.length} cached records`);
    }
  }

  const startId = seenIds.size > 0 ? Math.max(...seenIds) + 1 : 1;
  const endId = 8000;
  let found = records.length;
  let empty = 0;
  let consecutive503 = 0;

  console.log(`Scanning IDs ${startId} to ${endId} (1/sec)...\n`);

  for (let id = startId; id <= endId; id++) {
    if (seenIds.has(id)) continue;

    try {
      const res = await fetch(`https://www.dhi.ac.uk/rcc/index.php?page=full_record&id=${id}`, {
        headers: { 'User-Agent': UA },
        signal: AbortSignal.timeout(10000),
      });

      if (res.status === 503) {
        consecutive503++;
        if (consecutive503 >= 3) {
          console.log(`\n  503 x${consecutive503} at ID ${id}. Waiting 30s...`);
          await new Promise(r => setTimeout(r, 30000));
          consecutive503 = 0;
        }
        continue;
      }

      consecutive503 = 0;
      const html = await res.text();

      if (html.length > 1000 && html.includes('Original Author:')) {
        const record = parseRecord(html, id);
        if (record.title || record.originalAuthor) {
          records.push(record);
          seenIds.add(id);
          found++;
        }
      } else {
        empty++;
      }
    } catch (e) {
      empty++;
    }

    // Progress
    if (id % 100 === 0) {
      process.stdout.write(`  ID ${id}: ${found} found, ${empty} empty\r`);
    }

    // Save checkpoint every 200 records found
    if (found > 0 && found % 200 === 0) {
      writeFileSync(CACHE_FILE, JSON.stringify(records, null, 2));
    }

    // Rate limit: 1 second
    await new Promise(r => setTimeout(r, 1000));
  }

  // Final save
  writeFileSync(CACHE_FILE, JSON.stringify(records, null, 2));

  // Stats
  console.log(`\n\nTotal records: ${records.length}`);

  const byOrigLang = {};
  const byDecade = {};
  const authors = {};

  for (const r of records) {
    const lang = (r.originalLanguage || 'unknown').trim();
    byOrigLang[lang] = (byOrigLang[lang] || 0) + 1;

    const year = parseInt(r.year);
    if (year > 1400 && year < 1700) {
      const decade = Math.floor(year / 10) * 10;
      byDecade[decade] = (byDecade[decade] || 0) + 1;
    }

    const author = (r.originalAuthor || 'unknown').toLowerCase().trim();
    authors[author] = (authors[author] || 0) + 1;
  }

  console.log('\nBy original language:');
  for (const [l, c] of Object.entries(byOrigLang).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${l.padEnd(20)} ${c}`);
  }

  console.log('\nBy decade:');
  for (const [d, c] of Object.entries(byDecade).sort((a, b) => parseInt(a) - parseInt(b))) {
    const bar = '#'.repeat(Math.min(Math.round(c / 5), 50));
    console.log(`  ${d}: ${String(c).padEnd(5)} ${bar}`);
  }

  const authorList = Object.entries(authors).sort((a, b) => b[1] - a[1]);
  console.log(`\nDistinct authors: ${authorList.length}`);
  console.log('\nTop 20:');
  for (const [a, c] of authorList.slice(0, 20)) {
    console.log(`  ${String(c).padEnd(5)} ${a}`);
  }

  console.log(`\nSaved to ${CACHE_FILE}`);
}

main().catch(console.error);
