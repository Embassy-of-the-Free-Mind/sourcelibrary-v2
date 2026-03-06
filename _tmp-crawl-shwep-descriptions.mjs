#!/usr/bin/env node

/**
 * Crawl episode descriptions from shwep.net for all episodes defined in shwep-episodes.ts.
 * Extracts the first content paragraph from the episode page body.
 * Saves to src/data/shwep-descriptions.json.
 *
 * Phase 2: re-crawl episodes that got corrections/notes or members-only text.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = '/Users/dereklomas/sourcelibrary';
const EPISODES_FILE = resolve(ROOT, 'src/data/shwep-episodes.ts');
const OUTPUT_FILE = resolve(ROOT, 'src/data/shwep-descriptions.json');
const DELAY_MS = 500;

// Parse episodes from TS file using regex
function parseEpisodes() {
  const content = readFileSync(EPISODES_FILE, 'utf-8');
  const episodes = [];
  const re = /\{\s*number:\s*(\d+),\s*title:\s*["'`]([^"'`]+)["'`],\s*url:\s*["'`]([^"'`]+)["'`]/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    episodes.push({
      number: parseInt(m[1], 10),
      title: m[2],
      url: m[3],
    });
  }
  return episodes;
}

// Extract description from HTML — improved to skip corrections and notes
function extractDescription(html) {
  // Find the content area: everything after download link or post-date
  let contentStart = html.indexOf('class="download"');
  if (contentStart === -1) contentStart = html.indexOf('class="post-date"');
  if (contentStart === -1) contentStart = 0;

  // Cut off at themes section or comments
  let contentEnd = html.indexOf('<h2>Themes</h2>', contentStart);
  if (contentEnd === -1) contentEnd = html.indexOf('class="themes"', contentStart);
  if (contentEnd === -1) contentEnd = html.indexOf('<h2>Recommended Reading</h2>', contentStart);
  if (contentEnd === -1) contentEnd = html.indexOf('<h2>Works Cited</h2>', contentStart);
  if (contentEnd === -1) contentEnd = html.indexOf('<h2>Bibliography</h2>', contentStart);
  if (contentEnd === -1) contentEnd = html.indexOf('id="comments"', contentStart);
  if (contentEnd === -1) contentEnd = html.length;

  const contentBlock = html.slice(contentStart, contentEnd);

  // Collect all substantial paragraphs
  const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  const paragraphs = [];
  let match;
  while ((match = pRegex.exec(contentBlock)) !== null) {
    const rawP = match[1];
    const text = stripTags(rawP).trim();

    // Skip junk
    if (text.length < 30) continue;
    if (text.startsWith('Sorry, this product')) continue;
    if (text.startsWith('Download audio')) continue;
    if (text.includes('Comments are open to')) continue;
    if (text.includes('Already a member?')) continue;
    if (text.includes('Join now to comment')) continue;
    if (text.startsWith('Podcast episode')) continue;
    if (text === 'This is a special podcast episode for SHWEP members only') continue;

    paragraphs.push(cleanText(text));
  }

  if (paragraphs.length === 0) return null;

  // Strategy: prefer the first paragraph that doesn't start with [ (correction/note)
  // and is long enough to be a real description (50+ chars)
  for (const p of paragraphs) {
    if (!p.startsWith('[') && !p.startsWith('(') && p.length >= 50) {
      return p;
    }
  }

  // If all start with [ or (, try ones that start with ( but are descriptive
  for (const p of paragraphs) {
    if (p.startsWith('(') && p.length >= 80) {
      return p;
    }
  }

  // Fallback: grab whatever we have, including bracket paragraphs
  // but combine first bracket paragraph with the next real paragraph if available
  const bracketP = paragraphs.find(p => p.startsWith('[') || p.startsWith('('));
  const realP = paragraphs.find(p => !p.startsWith('[') && !p.startsWith('(') && p.length >= 40);

  if (bracketP && realP) {
    return realP; // skip the correction, use real content
  }

  // Last resort: first paragraph over 40 chars
  return paragraphs.find(p => p.length >= 40) || paragraphs[0] || null;
}

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#8217;/g, '\u2019')
    .replace(/&#8216;/g, '\u2018')
    .replace(/&#8220;/g, '\u201c')
    .replace(/&#8221;/g, '\u201d')
    .replace(/&#8211;/g, '\u2013')
    .replace(/&#8212;/g, '\u2014')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#038;/g, '&')
    .replace(/&hellip;/g, '\u2026')
    .replace(/&#8230;/g, '\u2026')
    .replace(/&#8242;/g, '\u2032')
    .replace(/&#8243;/g, '\u2033')
    .replace(/&#\d+;/g, (m) => {
      const code = parseInt(m.slice(2, -1), 10);
      return String.fromCharCode(code);
    })
    .replace(/&[a-z]+;/gi, ' ');
}

function cleanText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const episodes = parseEpisodes();

  // Load existing results
  let results = {};
  try {
    results = JSON.parse(readFileSync(OUTPUT_FILE, 'utf-8'));
  } catch {
    // fresh start
  }

  // Find episodes that need re-crawling:
  // 1. Members-only text
  // 2. Start with [ (correction/note)
  // 3. Missing entirely
  const needsRecrawl = episodes.filter(ep => {
    const desc = results[ep.number];
    if (!desc) return true;
    if (desc === 'This is a special podcast episode for SHWEP members only') return true;
    if (desc.startsWith('[')) return true;
    return false;
  });

  console.log(`Found ${episodes.length} total episodes`);
  console.log(`${Object.keys(results).length} existing descriptions`);
  console.log(`${needsRecrawl.length} need re-crawling (members-only, corrections, or missing)`);

  if (needsRecrawl.length === 0) {
    console.log('Nothing to do!');
    return;
  }

  let improved = 0;
  let membersOnly = 0;
  let failed = 0;
  const errors = [];

  for (let i = 0; i < needsRecrawl.length; i++) {
    const ep = needsRecrawl[i];
    try {
      const res = await fetch(ep.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) SourceLibrary/1.0 (research; derek@sourcelibrary.org)',
          'Accept': 'text/html',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const html = await res.text();
      const desc = extractDescription(html);

      if (desc) {
        results[ep.number] = desc;
        improved++;
        const preview = desc.length > 100 ? desc.slice(0, 100) + '...' : desc;
        console.log(`[${i+1}/${needsRecrawl.length}] #${ep.number}: ${preview}`);
      } else {
        // No usable content — probably members-only
        results[ep.number] = null;
        membersOnly++;
        console.log(`[${i+1}/${needsRecrawl.length}] #${ep.number}: members-only (no public content)`);
      }
    } catch (err) {
      failed++;
      console.error(`[${i+1}/${needsRecrawl.length}] #${ep.number} FAILED: ${err.message}`);
      errors.push(`#${ep.number}: ${err.message}`);
    }

    if ((i + 1) % 20 === 0) {
      writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    }

    await sleep(DELAY_MS);
  }

  // Final save — sort by episode number, remove null values
  const sorted = {};
  for (const key of Object.keys(results).sort((a, b) => Number(a) - Number(b))) {
    if (results[key] !== null) {
      sorted[key] = results[key];
    }
  }
  writeFileSync(OUTPUT_FILE, JSON.stringify(sorted, null, 2));

  console.log(`\nDone!`);
  console.log(`  Improved: ${improved}`);
  console.log(`  Members-only (removed): ${membersOnly}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total descriptions in output: ${Object.keys(sorted).length}`);
  console.log(`  Saved to: ${OUTPUT_FILE}`);

  if (errors.length > 0) {
    console.log(`\nErrors:`);
    for (const e of errors) console.log(`  - ${e}`);
  }
}

main().catch(console.error);
