#!/usr/bin/env node
/**
 * LLM-based matching of SHWEP episodes to Source Library books.
 *
 * Sends the full book catalog + batches of episodes to Gemini Flash (1M context)
 * and asks it to identify which primary sources are discussed in each episode.
 *
 * Output: src/data/shwep-book-matches.ts
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/shwep-llm-match.mjs
 *   node scripts/shwep-llm-match.mjs --dry-run    # just show catalog size, don't call API
 *   node scripts/shwep-llm-match.mjs --batch=0     # run just one batch (for testing)
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.production.local' });

import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONGODB_URI = process.env.MONGODB_URI;
const MODEL = 'gemini-2.5-flash';
const EPISODES_PER_BATCH = 15;

const args = process.argv.slice(2);
const GEMINI_API_KEY = args.includes('--key=default')
  ? process.env.GEMINI_API_KEY
  : (process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY);
const dryRun = args.includes('--dry-run');
const relatedMode = args.includes('--related');
const forceMode = args.includes('--force');
const singleBatch = args.find(a => a.startsWith('--batch='));
const singleBatchNum = singleBatch ? parseInt(singleBatch.split('=')[1]) : null;

// ── Load episode data ────────────────────────────────────────────────────────

async function loadEpisodes() {
  // Dynamically import the TS data via a simple parse approach
  // Read the compiled episodes from the source
  const episodesPath = path.join(__dirname, '..', 'src', 'data', 'shwep-episodes.ts');
  const descriptionsPath = path.join(__dirname, '..', 'src', 'data', 'shwep-descriptions.ts');

  // We'll extract episode data by running a quick eval-safe approach
  // Actually, let's just read from the crawled JSON if available, or parse TS

  // Parse episodes from TS file
  const epContent = fs.readFileSync(episodesPath, 'utf-8');
  const descContent = fs.readFileSync(descriptionsPath, 'utf-8');

  // Extract episodes using regex on the TS objects
  const episodes = [];
  const epRegex = /\{\s*number:\s*(\d+),\s*title:\s*"([^"]+)",\s*url:\s*"([^"]+)",\s*period:\s*"([^"]+)",\s*tags:\s*\[([^\]]*)\]/g;
  let match;
  while ((match = epRegex.exec(epContent)) !== null) {
    episodes.push({
      number: parseInt(match[1]),
      title: match[2],
      url: match[3],
      period: match[4],
      tags: match[5] ? match[5].split(',').map(t => t.trim().replace(/^'|'$/g, '')).filter(Boolean) : [],
    });
  }

  // Extract descriptions
  const descriptions = {};
  const descRegex = /(\d+):\s*'((?:[^'\\]|\\.)*)'/g;
  while ((match = descRegex.exec(descContent)) !== null) {
    descriptions[parseInt(match[1])] = match[2].replace(/\\'/g, "'");
  }

  // Merge
  for (const ep of episodes) {
    ep.description = descriptions[ep.number] || '';
  }

  return episodes;
}

// ── Load book catalog ────────────────────────────────────────────────────────

async function loadBookCatalog() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const books = await db.collection('books').find(
    { deleted: { $ne: true } },
    {
      projection: {
        _id: 1,
        title: 1,
        display_title: 1,
        author: 1,
        year: 1,
        published: 1,
        language: 1,
        'index.bookSummary.brief': 1,
      },
    }
  ).toArray();

  await client.close();

  return books.map(b => ({
    id: b._id.toString(),
    title: b.display_title || b.title,
    author: b.author || 'Unknown',
    year: b.year || (b.published ? parseInt(b.published) : null),
    language: b.language || 'Unknown',
    brief: b.index?.bookSummary?.brief || '',
  }));
}

// ── Build catalog text ───────────────────────────────────────────────────────

function buildCatalogText(books) {
  const lines = books.map(b => {
    let line = `[${b.id}] "${b.title}" by ${b.author}`;
    if (b.year) line += ` (${b.year})`;
    line += ` [${b.language}]`;
    if (b.brief) line += ` — ${b.brief}`;
    return line;
  });
  return lines.join('\n');
}

// ── Build episode batch text ─────────────────────────────────────────────────

function loadReadingLists() {
  const rlPath = path.join(__dirname, '..', 'src', 'data', 'shwep-reading-lists.json');
  if (fs.existsSync(rlPath)) {
    return JSON.parse(fs.readFileSync(rlPath, 'utf-8'));
  }
  return {};
}

function buildEpisodeBatchText(episodes, readingLists = {}) {
  return episodes.map(ep => {
    let text = `EPISODE ${ep.number}: "${ep.title}" [Period: ${ep.period}]`;
    if (ep.description) text += `\nDescription: ${ep.description}`;
    if (ep.tags.length > 0) text += `\nTopics: ${ep.tags.join(', ')}`;
    const rl = readingLists[String(ep.number)];
    if (rl) {
      // Truncate reading list to ~2000 chars to stay within context budget
      const truncated = rl.length > 2000 ? rl.slice(0, 2000) + '\n[truncated]' : rl;
      text += `\nReading List from episode page:\n${truncated}`;
    }
    return text;
  }).join('\n\n---\n\n');
}

// ── Call Gemini ──────────────────────────────────────────────────────────────

async function callGemini(catalogText, episodeBatchText, batchIndex, useRelatedPrompt = false) {
  const standardPrompt = `You are matching podcast episodes to a library of primary source books.

The podcast is SHWEP (Secret History of Western Esotericism Podcast), which covers the history of western esotericism from ancient Near East through the Renaissance and beyond. Each episode discusses specific ancient/historical texts, authors, and traditions.

Below is a CATALOG of ~4,800 books in the Source Library — mostly primary sources from antiquity through the early modern period (ancient philosophy, Hermetica, alchemy, astrology, Neoplatonism, Kabbalah, Renaissance magic, etc.).

Your task: For each episode below, identify which books from the catalog are **primary sources that the episode actually discusses or focuses on**.

RULES:
- Only match books that are PRIMARY SOURCES relevant to the episode's topic — not tangentially related works
- An episode about Plotinus should match Plotinus's Enneads, not every Neoplatonic text ever written
- An episode about the Corpus Hermeticum should match Hermetic texts, not Ficino's other works
- An episode about Plato's Timaeus should match editions of the Timaeus, not all of Plato's works
- If an episode is a methodological/overview episode (e.g. "Methodologies for the Study of Magic"), it may have few or zero matches — that's fine
- Guest interview episodes about modern scholarship typically have zero primary source matches
- When multiple editions of the same work exist (e.g. 5 editions of the Corpus Hermeticum), include ALL of them — readers benefit from seeing different editions
- Pay attention to the episode's period/era — an episode about ancient Egypt shouldn't match Renaissance texts unless those Renaissance texts are translations/commentaries of the ancient sources
- The "Topics" field lists author/text names from the episode — use these as strong hints but verify against the catalog
- The "Reading List" (if present) is scraped from the episode's webpage and lists works cited or recommended — use these to identify which primary texts the episode discusses. Match the PRIMARY SOURCES mentioned in the reading list against the catalog. Do NOT match secondary scholarship (modern academic books ABOUT the primary sources).
- MAXIMUM 40 books per episode. Most episodes should have 0-15.`;

  const relatedPrompt = `You are matching podcast episodes to a library of primary source books.

The podcast is SHWEP (Secret History of Western Esotericism Podcast), which covers the history of western esotericism from ancient Near East through the Renaissance and beyond.

Below is a CATALOG of ~4,800 books in the Source Library — mostly primary sources from antiquity through the early modern period (ancient philosophy, Hermetica, alchemy, astrology, Neoplatonism, Kabbalah, Renaissance magic, etc.).

These episodes are interviews, overviews, or introductory episodes that don't focus on specific primary texts. Your task: identify **primary sources from the catalog that are most relevant to the topic, tradition, or scholar's area of expertise discussed**.

RULES:
- Match the KEY primary sources that a listener would want to read to go deeper on the episode's topic
- For interviews with scholars: match the primary sources that the scholar's work focuses on
- For overview/intro episodes: match the most important primary sources for that tradition or period
- For episodes about a specific tradition (e.g. Mithraism, Manichaeism, early Islam): include the major surviving primary texts
- Include multiple editions of the same work if available
- Aim for 5-20 relevant books per episode — these should be genuinely relevant, not tangentially related
- Quality over quantity: better to have 5 excellent matches than 20 mediocre ones`;

  const chosenPrompt = useRelatedPrompt ? relatedPrompt : standardPrompt;

  const prompt = `${chosenPrompt}

Return a JSON object mapping episode numbers to arrays of book IDs:
{
  "0": [],
  "1": ["id1", "id2"],
  "100": ["id3", "id4", "id5"]
}

Only include episodes that have at least one match. Episodes with zero matches should be omitted.

=== BOOK CATALOG ===

${catalogText}

=== EPISODES TO MATCH ===

${episodeBatchText}

Return ONLY the JSON object, no other text.`;

  const MAX_RETRIES = 3;
  let data;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 600000); // 10 min timeout

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 65536,
              responseMimeType: 'application/json',
            },
          }),
        }
      );

      clearTimeout(timeout);

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Gemini API error (batch ${batchIndex}): ${response.status} ${err}`);
      }

      data = await response.json();
      break; // success
    } catch (err) {
      console.log(`  Attempt ${attempt + 1}/${MAX_RETRIES} failed: ${err.message}`);
      if (attempt < MAX_RETRIES - 1) {
        const delay = (attempt + 1) * 5000;
        console.log(`  Retrying in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }

  if (data.candidates?.[0]?.finishReason === 'SAFETY') {
    throw new Error(`Safety filter triggered on batch ${batchIndex}`);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error(`No response text from Gemini for batch ${batchIndex}`);
  }

  // Parse JSON (strip markdown fences if present)
  const jsonStr = text.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  const result = JSON.parse(jsonStr);

  // Log usage
  const usage = data.usageMetadata;
  if (usage) {
    console.log(`  Batch ${batchIndex}: ${usage.promptTokenCount?.toLocaleString()} input, ${usage.candidatesTokenCount?.toLocaleString()} output tokens`);
  }

  return result;
}

// ── Write output ─────────────────────────────────────────────────────────────

function writeOutput(outputPath, allMatches) {
  const sortedEntries = Object.entries(allMatches)
    .sort((a, b) => parseInt(a[0]) - parseInt(b[0]));

  let output = `/**
 * LLM-generated episode-to-book matches for SHWEP Reading Room.
 * Generated by scripts/shwep-llm-match.mjs using ${MODEL}.
 * ${new Date().toISOString().split('T')[0]}
 *
 * Maps episode numbers to arrays of book IDs from the Source Library collection.
 * These matches identify the primary sources discussed in each SHWEP episode.
 */
export const SHWEP_BOOK_MATCHES: Record<number, string[]> = {\n`;

  for (const [epNum, bookIds] of sortedEntries) {
    output += `  ${epNum}: ${JSON.stringify(bookIds)},\n`;
  }

  output += `};\n`;
  fs.writeFileSync(outputPath, output);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Loading episodes...');
  const episodes = await loadEpisodes();
  console.log(`  ${episodes.length} episodes loaded`);

  console.log('Loading book catalog from MongoDB...');
  const books = await loadBookCatalog();
  console.log(`  ${books.length} books loaded`);

  const catalogText = buildCatalogText(books);
  console.log(`  Catalog text: ${(catalogText.length / 1024).toFixed(0)}KB (~${Math.round(catalogText.length / 4000)}K tokens)`);

  const readingLists = loadReadingLists();
  const rlCount = Object.keys(readingLists).length;
  console.log(`  ${rlCount} episode reading lists loaded`);

  if (dryRun) {
    console.log('\n=== DRY RUN ===');
    console.log(`Batches needed: ${Math.ceil(episodes.length / EPISODES_PER_BATCH)}`);
    console.log(`Episodes per batch: ${EPISODES_PER_BATCH}`);
    console.log(`\nSample episode batch text (first 3):`);
    console.log(buildEpisodeBatchText(episodes.slice(0, 3), readingLists));
    console.log(`\nSample catalog (first 5 books):`);
    console.log(books.slice(0, 5).map(b => `[${b.id}] "${b.title}" by ${b.author} (${b.year}) [${b.language}] — ${b.brief}`).join('\n'));
    return;
  }

  // Load existing matches if resuming (skip if --force)
  const allMatches = {};
  const outputPath = path.join(__dirname, '..', 'src', 'data', 'shwep-book-matches.ts');
  if (!forceMode && fs.existsSync(outputPath)) {
    const existing = fs.readFileSync(outputPath, 'utf-8');
    const idRegex = /(\d+):\s*\[([^\]]+)\]/g;
    let m;
    while ((m = idRegex.exec(existing)) !== null) {
      const ids = m[2].match(/"([^"]+)"/g);
      if (ids) allMatches[m[1]] = ids.map(s => s.replace(/"/g, ''));
    }
    console.log(`Loaded ${Object.keys(allMatches).length} existing episode matches from previous run`);
  }

  // In --related mode, only process episodes with no existing matches
  let episodesToProcess = episodes;
  if (relatedMode) {
    episodesToProcess = episodes.filter(ep => !allMatches[String(ep.number)]);
    console.log(`\n--related mode: ${episodesToProcess.length} unmatched episodes to process`);
  }

  // Split into batches
  const batches = [];
  for (let i = 0; i < episodesToProcess.length; i += EPISODES_PER_BATCH) {
    batches.push(episodesToProcess.slice(i, i + EPISODES_PER_BATCH));
  }
  console.log(`${batches.length} batches of ~${EPISODES_PER_BATCH} episodes each`);

  // Process batches
  const batchesToRun = singleBatchNum !== null ? [singleBatchNum] : Array.from({ length: batches.length }, (_, i) => i);

  for (const batchIdx of batchesToRun) {
    if (batchIdx >= batches.length) {
      console.log(`Batch ${batchIdx} out of range (max ${batches.length - 1})`);
      continue;
    }

    const batch = batches[batchIdx];
    const epNums = batch.map(e => e.number).join(', ');

    // Skip if all episodes in this batch already have matches
    if (singleBatchNum === null && batch.every(ep => allMatches[String(ep.number)])) {
      console.log(`\nSkipping batch ${batchIdx}/${batches.length - 1} (already complete)`);
      continue;
    }

    console.log(`\nProcessing batch ${batchIdx}/${batches.length - 1} (episodes: ${epNums})...`);

    try {
      const result = await callGemini(catalogText, buildEpisodeBatchText(batch, readingLists), batchIdx, relatedMode);

      let totalBooks = 0;
      for (const [epNum, bookIds] of Object.entries(result)) {
        if (Array.isArray(bookIds) && bookIds.length > 0) {
          allMatches[epNum] = bookIds;
          totalBooks += bookIds.length;
        }
      }
      console.log(`  → ${Object.keys(result).length} episodes matched, ${totalBooks} total book links`);

      // Save progress after each batch
      writeOutput(outputPath, allMatches);

      // Small delay between batches
      if (batchIdx < batches.length - 1) {
        await new Promise(r => setTimeout(r, 3000));
      }
    } catch (err) {
      console.error(`  ERROR on batch ${batchIdx}: ${err.message}`);
      // Save what we have so far
      writeOutput(outputPath, allMatches);
      // Continue with other batches
    }
  }

  // Validate book IDs
  const validIds = new Set(books.map(b => b.id));
  let invalidCount = 0;
  for (const [epNum, bookIds] of Object.entries(allMatches)) {
    allMatches[epNum] = bookIds.filter(id => {
      if (validIds.has(id)) return true;
      invalidCount++;
      return false;
    });
    if (allMatches[epNum].length === 0) delete allMatches[epNum];
  }
  if (invalidCount > 0) {
    console.log(`\nRemoved ${invalidCount} invalid book IDs`);
  }

  // Summary
  const matchedEpisodes = Object.keys(allMatches).length;
  const totalLinks = Object.values(allMatches).reduce((s, ids) => s + ids.length, 0);
  console.log(`\n=== RESULTS ===`);
  console.log(`Episodes with matches: ${matchedEpisodes}/${episodes.length}`);
  console.log(`Total book links: ${totalLinks}`);
  console.log(`Avg books per matched episode: ${(totalLinks / matchedEpisodes).toFixed(1)}`);

  writeOutput(outputPath, allMatches);
  console.log(`\nWritten to ${outputPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
