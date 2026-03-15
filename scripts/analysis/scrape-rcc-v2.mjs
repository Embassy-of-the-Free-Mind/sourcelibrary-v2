/**
 * Scrape Renaissance Cultural Crossroads v2
 *
 * Strategy:
 * 1. Search for "the" (6,263 records) to establish session
 * 2. Paginate through search results to collect all record IDs
 * 3. Fetch each full record with session cookie
 * 4. Rate limit: 1 request/second to avoid 503s
 */

import { writeFileSync, existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';

const COOKIE_FILE = '/tmp/rcc-cookies.txt';
const CACHE_FILE = 'scripts/analysis/rcc-records-v2.json';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function curlGet(url) {
  try {
    const result = execSync(
      `curl -s -b ${COOKIE_FILE} -H "User-Agent: ${UA}" "${url}"`,
      { timeout: 15000, maxBuffer: 1024 * 1024 }
    );
    return result.toString('utf-8');
  } catch (e) {
    return '';
  }
}

function sleep(ms) {
  execSync(`sleep ${ms / 1000}`);
}

function parseRecord(html, id) {
  const text = html.replace(/<[^>]*>/g, '');
  const record = { id };

  const patterns = [
    ['estc', /ESTC Citation:(.+?)(?=STC Citation|Uniform Title|Title:|$)/],
    ['stc', /STC Citation:(.+?)(?=Uniform Title|Title:|$)/],
    ['uniformTitle', /Uniform Title:(.+?)(?=Title:|Variant Title|$)/],
    ['title', /(?:^|\n)Title:(.+?)(?=Variant Title|Publisher|$)/],
    ['variantTitle', /Variant Title:(.+?)(?=Publisher|Year:|$)/],
    ['publisherYear', /Publisher\/Year:(.+?)(?=Year:|Physical|$)/],
    ['year', /(?:^|\n)Year:(\d{4})/],
    ['subject', /Subject:(.+?)(?=Original Author|Translator|$)/],
    ['originalAuthor', /Original Author:(.+?)(?=Translator|Original Language|$)/],
    ['translator', /Translator:(.+?)(?=Original Language|Target Language|$)/],
    ['originalLanguage', /Original Language:(.+?)(?=Target Language|Intermediary|Liminary|Notes|$)/],
    ['targetLanguage', /Target Language:(.+?)(?=Intermediary|Liminary|Notes|«|$)/],
    ['intermediaryLanguage', /Intermediary Language:(.+?)(?=Liminary|Notes|«|$)/],
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
  console.log('=== RCC Scrape v2 (slow & polite) ===\n');

  // Load cache
  let records = [];
  const seenIds = new Set();
  if (existsSync(CACHE_FILE)) {
    records = JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
    for (const r of records) seenIds.add(r.id);
    console.log(`Loaded ${records.length} cached records\n`);
  }

  // Step 1: Establish session with a search
  console.log('Establishing session...');
  execSync(`curl -s -c ${COOKIE_FILE} -H "User-Agent: ${UA}" "https://www.dhi.ac.uk/rcc/index.php?search_type=kw&page=search_results&kw=the&logic=and" > /dev/null`);
  sleep(1000);

  // Step 2: Collect record IDs from search results pages
  // The search for "the" returns 6,263 records. Check pagination.
  const firstPage = curlGet('https://www.dhi.ac.uk/rcc/index.php?search_type=kw&page=search_results&kw=the&logic=and');
  const totalMatch = firstPage.match(/found <strong>(\d+)<\/strong>/);
  const total = totalMatch ? parseInt(totalMatch[1]) : 0;
  console.log(`Total records: ${total}`);

  // Check pagination format
  const pageLinks = [...firstPage.matchAll(/results_page=(\d+)/g)].map(m => parseInt(m[1]));
  const maxPage = pageLinks.length > 0 ? Math.max(...pageLinks) : 1;
  console.log(`Max page in first result: ${maxPage}`);

  // Extract IDs from first page
  const firstIds = [...firstPage.matchAll(/id=(\d+)/g)].map(m => parseInt(m[1])).filter(id => id > 0);
  const uniqueFirstIds = [...new Set(firstIds)];
  console.log(`IDs on first page: ${uniqueFirstIds.length}`);

  // Collect all IDs by paginating
  const allIds = new Set(uniqueFirstIds);

  // Figure out records per page
  const recsPerPage = uniqueFirstIds.length;
  const totalPages = Math.ceil(total / recsPerPage);
  console.log(`Estimated pages: ${totalPages} (${recsPerPage} per page)`);

  for (let page = 2; page <= totalPages; page++) {
    sleep(800);
    const html = curlGet(`https://www.dhi.ac.uk/rcc/index.php?search_type=kw&page=search_results&kw=the&logic=and&results_page=${page}`);
    const ids = [...html.matchAll(/id=(\d+)/g)].map(m => parseInt(m[1])).filter(id => id > 0);
    for (const id of ids) allIds.add(id);

    if (page % 50 === 0 || page === totalPages) {
      process.stdout.write(`  Page ${page}/${totalPages}: ${allIds.size} unique IDs collected\r`);
    }

    // If we get a 503 or empty page, back off
    if (html.length < 100) {
      console.log(`\n  Rate limited at page ${page}, waiting 10s...`);
      sleep(10000);
      // Re-establish session
      execSync(`curl -s -c ${COOKIE_FILE} -H "User-Agent: ${UA}" "https://www.dhi.ac.uk/rcc/index.php?search_type=kw&page=search_results&kw=the&logic=and" > /dev/null`);
      sleep(2000);
    }
  }

  console.log(`\n\nCollected ${allIds.size} unique record IDs`);

  // Step 3: Fetch each record we haven't cached yet
  const idsToFetch = [...allIds].filter(id => !seenIds.has(id)).sort((a, b) => a - b);
  console.log(`Need to fetch: ${idsToFetch.length} (${seenIds.size} already cached)`);

  let fetched = 0, errors = 0;

  for (const id of idsToFetch) {
    sleep(1000); // 1 request per second

    const html = curlGet(`https://www.dhi.ac.uk/rcc/index.php?page=full_record&id=${id}&result_set=0&logic=and&search_type=kw&kw=the`);

    if (html.length < 100 || !html.includes('Title:')) {
      errors++;
      if (errors % 5 === 0) {
        console.log(`\n  ${errors} errors. Backing off 15s...`);
        sleep(15000);
        // Re-establish session
        execSync(`curl -s -c ${COOKIE_FILE} -H "User-Agent: ${UA}" "https://www.dhi.ac.uk/rcc/index.php?search_type=kw&page=search_results&kw=the&logic=and" > /dev/null`);
        sleep(2000);
      }
      continue;
    }

    const record = parseRecord(html, id);
    if (record.title || record.originalAuthor) {
      records.push(record);
      seenIds.add(id);
      fetched++;
    }

    if (fetched % 100 === 0 && fetched > 0) {
      process.stdout.write(`  ${fetched} fetched, ${errors} errors, ${records.length} total\r`);
      // Save checkpoint
      writeFileSync(CACHE_FILE, JSON.stringify(records, null, 2));
    }
  }

  // Final save
  writeFileSync(CACHE_FILE, JSON.stringify(records, null, 2));

  // Stats
  console.log(`\n\nTotal records: ${records.length}`);

  const byOrigLang = {};
  const authors = {};
  for (const r of records) {
    const lang = (r.originalLanguage || 'unknown').trim();
    byOrigLang[lang] = (byOrigLang[lang] || 0) + 1;

    const author = (r.originalAuthor || 'unknown').toLowerCase().trim();
    authors[author] = (authors[author] || 0) + 1;
  }

  console.log('\nBy original language:');
  for (const [l, c] of Object.entries(byOrigLang).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${l.padEnd(20)} ${c}`);
  }

  const authorList = Object.entries(authors).sort((a, b) => b[1] - a[1]);
  console.log(`\nDistinct authors: ${authorList.length}`);
  console.log('\nTop 20 authors:');
  for (const [a, c] of authorList.slice(0, 20)) {
    console.log(`  ${String(c).padEnd(5)} ${a}`);
  }

  // Year distribution
  const byDecade = {};
  for (const r of records) {
    const year = parseInt(r.year);
    if (year > 1400 && year < 1700) {
      const decade = Math.floor(year / 10) * 10;
      byDecade[decade] = (byDecade[decade] || 0) + 1;
    }
  }
  console.log('\nBy decade (publication of translation):');
  for (const [d, c] of Object.entries(byDecade).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) {
    const bar = '#'.repeat(Math.min(Math.round(c / 5), 50));
    console.log(`  ${d}: ${String(c).padEnd(5)} ${bar}`);
  }

  console.log(`\nSaved ${records.length} records to ${CACHE_FILE}`);
}

main().catch(console.error);
