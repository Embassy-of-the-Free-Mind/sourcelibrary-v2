#!/usr/bin/env node
/**
 * Scrape recommended reading / works cited from SHWEP episode pages.
 *
 * Fetches each episode's webpage, extracts bibliography text, and saves
 * to src/data/shwep-reading-lists.ts for use in LLM book matching.
 *
 * Usage:
 *   node scripts/shwep-scrape-reading-lists.mjs
 *   node scripts/shwep-scrape-reading-lists.mjs --limit=10   # test with first 10
 *   node scripts/shwep-scrape-reading-lists.mjs --episode=213 # single episode
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const limitArg = args.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1]) : null;
const episodeArg = args.find(a => a.startsWith('--episode='));
const singleEpisode = episodeArg ? parseInt(episodeArg.split('=')[1]) : null;
const CONCURRENCY = 5;
const DELAY_MS = 500; // be respectful

// ── Load episode URLs from TS file ──────────────────────────────────────────

function loadEpisodes() {
  const epPath = path.join(__dirname, '..', 'src', 'data', 'shwep-episodes.ts');
  const content = fs.readFileSync(epPath, 'utf-8');
  const episodes = [];
  const regex = /\{\s*number:\s*(\d+),\s*title:\s*"([^"]+)",\s*url:\s*"([^"]+)"/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    episodes.push({
      number: parseInt(match[1]),
      title: match[2],
      url: match[3],
    });
  }
  return episodes;
}

// ── Fetch and extract bibliography from a SHWEP page ────────────────────────

async function fetchReadingList(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'SourceLibrary/1.0 (reading list scraper for book matching; https://sourcelibrary.org)',
      },
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    const html = await resp.text();
    return extractBibliography(html);
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

function extractBibliography(html) {
  // Remove script/style tags
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');

  // Look for the main content area — SHWEP uses WordPress
  // The bibliography is usually in the entry-content div
  const contentMatch = text.match(/<div[^>]*class="[^"]*entry-content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<\/article|<footer|<div[^>]*class="[^"]*(?:comments|related|navigation))/i);
  const content = contentMatch ? contentMatch[1] : text;

  // Convert HTML to readable text, preserving structure
  let readable = content
    // Convert headers to markers
    .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, '\n### $1\n')
    // Convert list items
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n')
    // Convert paragraphs
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n')
    // Convert <br> tags
    .replace(/<br\s*\/?>/gi, '\n')
    // Convert <em> and <i>
    .replace(/<(?:em|i)[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, '*$1*')
    // Convert <strong> and <b>
    .replace(/<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, '**$1**')
    // Extract link text (keep the text, drop the href)
    .replace(/<a[^>]*>([\s\S]*?)<\/a>/gi, '$1')
    // Remove remaining HTML tags
    .replace(/<[^>]+>/g, '')
    // Decode HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#8216;|&#8217;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/&rdquo;|&ldquo;/g, '"')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&hellip;/g, '...')
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '')
    // Clean up whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Extract the bibliography sections
  // Look for patterns like "Recommended Reading", "Works Cited", "Bibliography", "References"
  const bibPatterns = [
    /(?:^|\n)(#{1,3}\s*(?:Recommended\s+Reading|Works?\s+Cited|Bibliography|References|Further\s+Reading|Primary\s+Sources?|Secondary\s+Sources?|Editions?\s+and\s+Translations?)[^\n]*\n[\s\S]*)/i,
    /(?:^|\n)(\*\*(?:Recommended\s+Reading|Works?\s+Cited|Bibliography|References|Further\s+Reading|Primary\s+Sources?|Secondary\s+Sources?)\*\*[^\n]*\n[\s\S]*)/i,
    /(?:^|\n)((?:Recommended\s+Reading|Works?\s+Cited|Bibliography|References|Further\s+Reading)[^\n]*\n[\s\S]*)/i,
  ];

  let bibliography = '';
  for (const pattern of bibPatterns) {
    const match = readable.match(pattern);
    if (match) {
      bibliography = match[1].trim();
      break;
    }
  }

  // If we couldn't find a clear bibliography section, look for citation-like patterns
  // in the full text (lines with author names, years, publishers)
  if (!bibliography) {
    const lines = readable.split('\n');
    const citationLines = lines.filter(line => {
      const l = line.trim();
      if (l.length < 20) return false;
      // Citation patterns: "Author, Year." or "Author (Year)" or has publisher-like text
      return /\b\d{4}\b/.test(l) && (
        /(?:University|Press|Oxford|Cambridge|Brill|Springer|Routledge|Princeton|Yale|Harvard)/i.test(l) ||
        /(?:ed\.|trans\.|tr\.|vol\.|pp\.)/i.test(l) ||
        /\*[^*]+\*/.test(l) // italicized title
      );
    });
    if (citationLines.length >= 2) {
      bibliography = citationLines.join('\n');
    }
  }

  // Truncate if very long (some episodes have huge reading lists)
  if (bibliography.length > 5000) {
    bibliography = bibliography.slice(0, 5000) + '\n[truncated]';
  }

  return bibliography;
}

// ── Concurrency helper ──────────────────────────────────────────────────────

async function processInBatches(items, fn, concurrency) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map((item, idx) => fn(item, i + idx))
    );
    results.push(...batchResults);
    // Delay between batches
    if (i + concurrency < items.length) {
      await new Promise(r => setTimeout(r, DELAY_MS));
    }
  }
  return results;
}

// ── Write output ────────────────────────────────────────────────────────────

function writeOutput(outputPath, readingLists) {
  const sortedEntries = Object.entries(readingLists)
    .sort((a, b) => parseInt(a[0]) - parseInt(b[0]));

  let output = `/**
 * Scraped recommended reading / works cited from SHWEP episode pages.
 * Generated by scripts/shwep-scrape-reading-lists.mjs
 * ${new Date().toISOString().split('T')[0]}
 *
 * Used as additional context for LLM book matching.
 */
export const SHWEP_READING_LISTS: Record<number, string> = {\n`;

  for (const [epNum, text] of sortedEntries) {
    // Escape for TS template literal
    const escaped = text
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$');
    output += `  ${epNum}: \`${escaped}\`,\n`;
  }

  output += `};\n`;
  fs.writeFileSync(outputPath, output);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Loading episodes...');
  let episodes = loadEpisodes();
  console.log(`  ${episodes.length} episodes loaded`);

  if (singleEpisode !== null) {
    episodes = episodes.filter(ep => ep.number === singleEpisode);
    if (episodes.length === 0) {
      console.log(`Episode ${singleEpisode} not found`);
      return;
    }
  } else if (limit) {
    episodes = episodes.slice(0, limit);
  }

  console.log(`Scraping ${episodes.length} episode pages...`);

  // Load existing reading lists if available
  const outputPath = path.join(__dirname, '..', 'src', 'data', 'shwep-reading-lists.ts');
  const readingLists = {};

  let scraped = 0;
  let empty = 0;
  let errors = 0;

  const results = await processInBatches(episodes, async (ep, idx) => {
    try {
      const bib = await fetchReadingList(ep.url);
      if (bib) {
        readingLists[ep.number] = bib;
        scraped++;
        console.log(`  [${idx + 1}/${episodes.length}] #${ep.number} — ${bib.split('\n').length} lines`);
      } else {
        empty++;
        console.log(`  [${idx + 1}/${episodes.length}] #${ep.number} — no bibliography found`);
      }
    } catch (err) {
      errors++;
      console.log(`  [${idx + 1}/${episodes.length}] #${ep.number} — ERROR: ${err.message}`);
    }
  }, CONCURRENCY);

  console.log(`\n=== RESULTS ===`);
  console.log(`Scraped: ${scraped} episodes with reading lists`);
  console.log(`Empty: ${empty} episodes with no bibliography`);
  console.log(`Errors: ${errors}`);

  if (Object.keys(readingLists).length > 0) {
    writeOutput(outputPath, readingLists);
    console.log(`Written to ${outputPath}`);

    // Also write raw JSON for inspection
    const jsonPath = path.join(__dirname, '..', 'src', 'data', 'shwep-reading-lists.json');
    fs.writeFileSync(jsonPath, JSON.stringify(readingLists, null, 2));
    console.log(`JSON written to ${jsonPath}`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
