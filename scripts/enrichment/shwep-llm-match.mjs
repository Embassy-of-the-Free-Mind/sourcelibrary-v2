#!/usr/bin/env node
/**
 * Match SHWEP episodes to Source Library primary-source books.
 *
 * Architecture (rewritten 2026-06-19): EMBEDDINGS RETRIEVAL + LLM CONFIRM.
 *
 *   Per episode:
 *     1. Build a query from title + period + topics + scraped reading list.
 *     2. Embed it (gemini-embedding-2-preview, 768-dim — same space as book_embeddings).
 *     3. Retrieve the ~80 nearest books via the match_books_semantic Supabase RPC.
 *     4. Resolve candidates against Mongo (visible + readable + Western/Mediterranean
 *        languages only — SHWEP never matches CJK/Indic corpora).
 *   Then, in small batches, ask Gemini to CONFIRM which candidates are genuine
 *   focal-work matches (precision prompt).
 *
 * Why not one big call against the whole catalog? The catalog grew from ~4.8K books
 * (when matches were first generated) to ~13.5K (~900K tokens). At that size a single
 * LLM call can't reliably retrieve the right IDs — it returns near-random picks. Pre-
 * filtering to ~80 topically-nearest candidates per episode keeps each confirm call
 * small and accurate, and embeddings handle title variants (Pymander ↔ Corpus Hermeticum).
 *
 * Output: src/data/shwep-book-matches.ts (episode number → [Mongo _id strings]).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/shwep-llm-match.mjs
 *   node scripts/enrichment/shwep-llm-match.mjs --dry-run        # candidate counts only, no confirm calls
 *   node scripts/enrichment/shwep-llm-match.mjs --episodes=120,150,280   # only these episode numbers
 *   node scripts/enrichment/shwep-llm-match.mjs --limit=20       # first N episodes (smoke test)
 *
 * Note: src/data/shwep-reading-lists.json is gitignored and lives only in the main
 * checkout — copy it into the worktree's src/data before running there.
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.production.local' });

import { MongoClient, ObjectId } from 'mongodb';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'src', 'data');
const MONGODB_URI = process.env.MONGODB_URI;
const MODEL = 'gemini-3.1-flash-lite';
const EMBED_MODEL = 'gemini-embedding-2-preview';

const args = process.argv.slice(2);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;
const EMBED_API_KEY = process.env.GEMINI_API_KEY; // free-tier embedding quota
const dryRun = args.includes('--dry-run');
const limitArg = args.find(a => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1]) : null;
const episodesArg = args.find(a => a.startsWith('--episodes='));
const ONLY_EPISODES = episodesArg ? new Set(episodesArg.split('=')[1].split(',').map(s => s.trim())) : null;

// Retrieval / confirm tuning
const CANDIDATES_PER_EPISODE = 80;
const RETRIEVAL_THRESHOLD = 0.2;
const EPISODES_PER_CONFIRM = 10;
const RETRIEVAL_CONCURRENCY = 6;

// SHWEP covers Western/Mediterranean/Islamicate esotericism; the big CJK/Indic corpora
// (CBETA, Siku Quanshu, Tibetan) can never be a SHWEP primary source.
const EXCLUDE_LANGS = new Set([
  'Chinese', 'Classical Chinese', 'Literary Chinese', 'Sanskrit', 'Tibetan',
  'Japanese', 'Korean', 'Pali', 'Thai', 'Vietnamese', 'Mongolian',
]);

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ── Load episode + reading-list data ─────────────────────────────────────────

function loadEpisodes() {
  const epContent = fs.readFileSync(path.join(DATA_DIR, 'shwep-episodes.ts'), 'utf-8');
  const descContent = fs.readFileSync(path.join(DATA_DIR, 'shwep-descriptions.ts'), 'utf-8');

  const episodes = [];
  const epRegex = /\{\s*number:\s*(\d+),\s*title:\s*"([^"]+)",\s*url:\s*"([^"]+)",\s*period:\s*"([^"]+)",\s*tags:\s*\[([^\]]*)\]/g;
  let m;
  while ((m = epRegex.exec(epContent)) !== null) {
    episodes.push({
      number: parseInt(m[1]),
      title: m[2],
      url: m[3],
      period: m[4],
      tags: m[5] ? m[5].split(',').map(t => t.trim().replace(/^'|'$/g, '')).filter(Boolean) : [],
    });
  }

  const descriptions = {};
  const descRegex = /(\d+):\s*'((?:[^'\\]|\\.)*)'/g;
  while ((m = descRegex.exec(descContent)) !== null) {
    descriptions[parseInt(m[1])] = m[2].replace(/\\'/g, "'");
  }
  for (const ep of episodes) ep.description = descriptions[ep.number] || '';
  return episodes;
}

function loadReadingLists() {
  const rlPath = path.join(DATA_DIR, 'shwep-reading-lists.json');
  if (fs.existsSync(rlPath)) return JSON.parse(fs.readFileSync(rlPath, 'utf-8'));
  console.warn('  ⚠ shwep-reading-lists.json not found — matching will be weaker (no reading-list grounding)');
  return {};
}

// ── Embedding ────────────────────────────────────────────────────────────────

async function embed(text) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents?key=${EMBED_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: [{ model: `models/${EMBED_MODEL}`, content: { parts: [{ text }] }, outputDimensionality: 768 }],
          }),
          signal: AbortSignal.timeout(30000),
        }
      );
      if (res.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
      if (!res.ok) throw new Error(`embed ${res.status}: ${(await res.text()).slice(0, 150)}`);
      const d = await res.json();
      return d.embeddings?.[0]?.values || null;
    } catch (err) {
      if (attempt === 3) throw err;
      await sleep(2000 * (attempt + 1));
    }
  }
  return null;
}

function episodeQuery(ep, readingList) {
  let q = `${ep.title}. Period: ${ep.period}.`;
  if (ep.tags.length) q += ` Topics: ${ep.tags.join(', ')}.`;
  if (ep.description) q += ` ${ep.description}`;
  if (readingList) q += ` ${readingList.slice(0, 1500)}`;
  return q;
}

// ── Candidate retrieval (embedding → RPC → Mongo resolve) ────────────────────

async function retrieveCandidates(db, ep, readingList) {
  const vec = await embed(episodeQuery(ep, readingList));
  if (!vec) return [];
  const { data, error } = await supabase.rpc('match_books_semantic', {
    query_embedding: JSON.stringify(vec),
    match_threshold: RETRIEVAL_THRESHOLD,
    match_count: CANDIDATES_PER_EPISODE,
  });
  if (error) { console.warn(`  #${ep.number} RPC error: ${error.message}`); return []; }
  const ids = (data || []).map(r => r.book_id);
  if (!ids.length) return [];

  const oids = ids.map(i => { try { return new ObjectId(i); } catch { return null; } }).filter(Boolean);
  const rows = await db.collection('books').find(
    { _id: { $in: oids }, visible: true, pages_count: { $gt: 0 } },
    { projection: { display_title: 1, title: 1, author: 1, year: 1, published: 1, language: 1 } }
  ).toArray();
  const byId = new Map(
    rows.filter(r => !EXCLUDE_LANGS.has(r.language)).map(r => [r._id.toString(), r])
  );
  // Preserve similarity order from the RPC.
  return ids.filter(i => byId.has(i)).map(i => byId.get(i));
}

// ── LLM confirm ──────────────────────────────────────────────────────────────

const CONFIRM_RULES = `You are matching SHWEP (Secret History of Western Esotericism Podcast) episodes to primary-source books.

For EACH episode you are given a CANDIDATE list of books (already topically pre-filtered by embedding similarity). Select ONLY the candidates that ARE a specific primary-source work the episode actually focuses on (or a direct edition / translation / commentary of it).

RULES:
- Pick a book ONLY if it IS one of the works the episode is genuinely about — NOT merely because it shares the episode's author, tradition, period, or theme.
  • A Mithras episode must NOT pick Plato / Homer / Orphica just for being "ancient pagan".
  • A Marius Victorinus episode must NOT pick Galen / Plutarch / Boethius just for being "late antique".
- DO include a work the episode genuinely centres on even when the episode is framed as a guest interview. If the title, Topics, or Reading List name a specific ancient author or text (e.g. Parmenides, the Corpus Hermeticum, the Chaldean Oracles, the Testament of Solomon) and editions of it are among the candidates, include those editions.
- When the episode is explicitly about a TRADITION (e.g. "...and the Solomonic Tradition"), include the core texts OF that tradition that are present.
- Include all editions/translations of a genuinely-focal WORK. But do NOT add a "Complete Works of [author]" collection unless the episode is a general survey of that whole author — prefer the specific work(s) the episode is about.
- Return [] when the episode is purely methodological, or a modern-scholarship interview with no specific primary text present among the candidates. Never pad to fill space; never strip a clearly-focal text.
- Pick ONLY from each episode's own candidate list, using the exact [id] given. Most episodes land at 0–15 matches.

Return ONLY a JSON object mapping episode number (string) to an array of chosen book id strings, e.g. {"120":["652f..."],"260":[]}.`;

function buildConfirmPrompt(batch) {
  const blocks = batch.map(({ ep, readingList, cands }) => {
    const lines = cands
      .map(b => `[${b._id}] "${(b.display_title || b.title || '').slice(0, 95)}" by ${b.author || '?'}${b.year ? ` (${b.year})` : ''} [${b.language || '?'}]`)
      .join('\n');
    let t = `### EPISODE ${ep.number}: "${ep.title}" [Period: ${ep.period}]`;
    if (ep.tags.length) t += `\nTopics: ${ep.tags.join(', ')}`;
    if (readingList) t += `\nReading List:\n${readingList.length > 1500 ? readingList.slice(0, 1500) + '…' : readingList}`;
    t += `\nCANDIDATE BOOKS (choose only genuine focal-work matches from THIS list):\n${lines || '(none)'}`;
    return t;
  }).join('\n\n');
  return `${CONFIRM_RULES}\n\n${blocks}`;
}

async function confirmBatch(batch) {
  const prompt = buildConfirmPrompt(batch);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0, maxOutputTokens: 8192, responseMimeType: 'application/json' },
          }),
          signal: AbortSignal.timeout(120000),
        }
      );
      if (!res.ok) throw new Error(`confirm ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      const txt = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!txt) throw new Error('empty confirm response');
      const result = JSON.parse(txt.replace(/^```json\s*/, '').replace(/\s*```$/, ''));
      const usage = data.usageMetadata;
      return { result, tokens: usage ? `${usage.promptTokenCount} in / ${usage.candidatesTokenCount} out` : '' };
    } catch (err) {
      console.warn(`  confirm attempt ${attempt + 1} failed: ${err.message}`);
      if (attempt === 2) return { result: {}, tokens: '' };
      await sleep(5000 * (attempt + 1));
    }
  }
  return { result: {}, tokens: '' };
}

// ── Output ───────────────────────────────────────────────────────────────────

function writeOutput(allMatches) {
  const sorted = Object.entries(allMatches).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
  let out = `/**
 * Episode-to-book matches for the SHWEP Reading Room.
 * Generated by scripts/enrichment/shwep-llm-match.mjs (embeddings retrieval + ${MODEL} confirm).
 * ${new Date().toISOString().split('T')[0]}
 *
 * Maps episode numbers to arrays of Source Library book IDs (Mongo _id strings) —
 * the primary sources each SHWEP episode focuses on.
 */
export const SHWEP_BOOK_MATCHES: Record<number, string[]> = {\n`;
  for (const [epNum, ids] of sorted) out += `  ${epNum}: ${JSON.stringify(ids)},\n`;
  out += `};\n`;
  fs.writeFileSync(path.join(DATA_DIR, 'shwep-book-matches.ts'), out);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  let episodes = loadEpisodes();
  const readingLists = loadReadingLists();
  if (ONLY_EPISODES) episodes = episodes.filter(e => ONLY_EPISODES.has(String(e.number)));
  if (LIMIT) episodes = episodes.slice(0, LIMIT);
  console.log(`Matching ${episodes.length} episodes (${Object.keys(readingLists).length} reading lists available)`);

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Stage 1: retrieve candidates per episode (embedding → RPC → Mongo resolve).
  console.log('Retrieving candidates (embedding + semantic search)…');
  const withCands = await mapWithConcurrency(episodes, RETRIEVAL_CONCURRENCY, async (ep) => {
    const readingList = readingLists[String(ep.number)] || '';
    const cands = await retrieveCandidates(db, ep, readingList);
    return { ep, readingList, cands };
  });
  const candTotal = withCands.reduce((s, e) => s + e.cands.length, 0);
  console.log(`  ${candTotal} candidate books across ${withCands.length} episodes (avg ${(candTotal / withCands.length).toFixed(0)})`);

  if (dryRun) {
    console.log('\n=== DRY RUN — candidate counts (no confirm calls) ===');
    for (const { ep, cands } of withCands) console.log(`  #${ep.number} ${cands.length} cands — ${ep.title.slice(0, 50)}`);
    await client.close();
    return;
  }

  // Stage 2: LLM confirm in small batches.
  console.log('Confirming matches…');
  const allMatches = {};
  for (let i = 0; i < withCands.length; i += EPISODES_PER_CONFIRM) {
    const batch = withCands.slice(i, i + EPISODES_PER_CONFIRM);
    const { result, tokens } = await confirmBatch(batch);
    for (const { ep, cands } of batch) {
      const valid = new Set(cands.map(b => b._id.toString()));
      const picked = (result[String(ep.number)] || []).filter(id => valid.has(id));
      if (picked.length) allMatches[ep.number] = picked;
    }
    const done = Math.min(i + EPISODES_PER_CONFIRM, withCands.length);
    console.log(`  ${done}/${withCands.length} confirmed (${tokens})`);
    if (done < withCands.length) await sleep(1500);
  }

  // If we only ran a subset, merge into the existing file rather than clobbering it.
  if (ONLY_EPISODES || LIMIT) {
    const outPath = path.join(DATA_DIR, 'shwep-book-matches.ts');
    if (fs.existsSync(outPath)) {
      const existing = fs.readFileSync(outPath, 'utf-8');
      const re = /(\d+):\s*\[([^\]]*)\]/g; let m;
      while ((m = re.exec(existing)) !== null) {
        if (!(m[1] in allMatches)) {
          const ids = (m[2].match(/"([^"]+)"/g) || []).map(s => s.replace(/"/g, ''));
          if (ids.length) allMatches[m[1]] = ids;
        }
      }
    }
  }

  await client.close();

  const counts = Object.values(allMatches).map(a => a.length);
  const links = counts.reduce((s, n) => s + n, 0);
  console.log(`\n=== RESULTS ===`);
  console.log(`Episodes with matches: ${counts.length}`);
  console.log(`Total book links: ${links}  (avg ${(links / (counts.length || 1)).toFixed(1)}, max ${Math.max(0, ...counts)})`);
  writeOutput(allMatches);
  console.log(`Wrote src/data/shwep-book-matches.ts`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
