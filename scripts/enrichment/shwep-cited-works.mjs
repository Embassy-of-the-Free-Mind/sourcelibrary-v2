#!/usr/bin/env node
/**
 * Build a database of the HISTORICAL PRIMARY SOURCES cited across SHWEP episodes,
 * deduped + work/author aligned, flagged held-in-library vs. need-to-acquire.
 *
 * Pipeline (staged + resumable; intermediates cached under /tmp/shwep-cited/):
 *   1 EXTRACT  — per episode, LLM pulls the historical primary works cited in Earl
 *                Fontainelle's reading list (incl. works named in the title and works
 *                cited via modern critical editions). Excludes modern secondary
 *                scholarship, journals, podcasts, cross-episode links.
 *   2 DEDUPE   — cluster the raw works across all episodes by normalized author+work,
 *                then an LLM canonicalisation pass merges title/author variants.
 *   3 HOLDINGS — for each canonical work, embed "work by author", retrieve nearest
 *                books (match_books_semantic) and have the LLM confirm which (if any)
 *                are an edition/translation of that exact work → held book ids.
 *   4 EMIT     — writes:
 *                • src/data/shwep-cited-works.ts        (the works DB)
 *                • src/data/shwep-book-matches.ts       (held works per episode = reader links)
 *                • /tmp/shwep-cited/acquire.md          (the acquisition gap, primary sources we lack)
 *
 * Usage (run stages in order; each caches so you can re-emit cheaply):
 *   node scripts/enrichment/shwep-cited-works.mjs --extract
 *   node scripts/enrichment/shwep-cited-works.mjs --dedupe
 *   node scripts/enrichment/shwep-cited-works.mjs --holdings
 *   node scripts/enrichment/shwep-cited-works.mjs --emit
 *   node scripts/enrichment/shwep-cited-works.mjs --all      # all four in sequence
 *
 * Needs src/data/shwep-reading-lists.json (gitignored — copy from main checkout into
 * the worktree first).
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
const CACHE = '/tmp/shwep-cited';
fs.mkdirSync(CACHE, { recursive: true });

const MODEL = 'gemini-3.1-flash-lite';
const EMBED_MODEL = 'gemini-embedding-2-preview';
const KEY = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;
const EMBED_KEY = process.env.GEMINI_API_KEY;
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const args = process.argv.slice(2);
const want = s => args.includes(s) || args.includes('--all');
const LIMIT = (() => { const a = args.find(x => x.startsWith('--limit=')); return a ? parseInt(a.split('=')[1]) : null; })();

const sleep = ms => new Promise(r => setTimeout(r, ms));
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8')); } catch { return d; } };
const writeJSON = (f, o) => fs.writeFileSync(path.join(CACHE, f), JSON.stringify(o, null, 2));
const norm = s => (s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

async function gemini(prompt, maxOut = 8192) {
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0, maxOutputTokens: maxOut, responseMimeType: 'application/json' } }),
        signal: AbortSignal.timeout(120000),
      });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      const txt = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!txt) throw new Error('empty');
      return JSON.parse(txt.replace(/^```json\s*/, '').replace(/\s*```$/, ''));
    } catch (e) { if (i === 3) throw e; await sleep(4000 * (i + 1)); }
  }
}

async function embed(text) {
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents?key=${EMBED_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: [{ model: `models/${EMBED_MODEL}`, content: { parts: [{ text }] }, outputDimensionality: 768 }] }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.status === 429) { await sleep(2000 * (i + 1)); continue; }
      if (!res.ok) throw new Error(`${res.status}`);
      return (await res.json()).embeddings?.[0]?.values || null;
    } catch (e) { if (i === 3) throw e; await sleep(2000 * (i + 1)); }
  }
}

function loadEpisodes() {
  const etxt = fs.readFileSync(path.join(DATA_DIR, 'shwep-episodes.ts'), 'utf8');
  const eps = []; let m;
  const re = /\{\s*number:\s*(\d+),\s*title:\s*"([^"]+)",\s*url:\s*"([^"]+)",\s*period:\s*"([^"]+)"/g;
  while ((m = re.exec(etxt)) !== null) eps.push({ number: +m[1], title: m[2], url: m[3], period: m[4] });
  const rl = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'shwep-reading-lists.json'), 'utf8'));
  for (const e of eps) e.readingList = rl[String(e.number)] || '';
  return eps;
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

// ── Stage 1: extract ─────────────────────────────────────────────────────────

const EXTRACT_PROMPT = `You are cataloguing the HISTORICAL PRIMARY SOURCES cited in SHWEP podcast reading lists (history of Western esotericism).

For each episode below extract ONLY historical primary-source works — texts composed before ~1700 (ancient/medieval/early-modern philosophy, religion, magic, science, literature, scripture, in any language).

Modern editions of historical texts COUNT — scholars cite primary sources through modern critical editions/translations. Extract the UNDERLYING historical work and its original author, NOT the modern editor:
- "McCown 1922" / "Duling 2021" for the Testament of Solomon → work "Testament of Solomon", author "Anonymous".
- "ed. Stahl, Commentary on the Dream of Scipio by Macrobius" → work "Commentary on the Dream of Scipio", author "Macrobius".
Also include any historical work NAMED IN THE EPISODE TITLE (the text the episode reads/discusses), even if the list cites it only via a modern edition. Do NOT invent a work from a merely thematic title.

STRICTLY EXCLUDE: modern secondary scholarship that is NOT itself an edition/translation of a historical text; journals; encyclopedias/dictionaries; websites; podcasts; the host's cross-references to his own episodes; vague unidentifiable fragments.

For each work give "work" (canonical English title of the historical work), "author" (canonical historical author, or "Anonymous"), "era" (Ancient Near Eastern / Classical Greek / Hellenistic / Roman / Late Antique / Medieval / Byzantine / Islamicate / Renaissance / Early Modern).

Return ONLY JSON: {"<episodeNumber>":[{"work","author","era"},...]} — empty list if none.

EPISODES:
`;

async function stageExtract(eps) {
  console.log(`Stage 1 EXTRACT — ${eps.length} episodes`);
  const BATCH = 10;
  const batches = [];
  for (let i = 0; i < eps.length; i += BATCH) batches.push(eps.slice(i, i + BATCH));
  const result = {};
  let done = 0;
  for (const batch of batches) {
    const blocks = batch.map(e => `### EPISODE ${e.number}: "${e.title}"\nReading list:\n${(e.readingList || '(none)').slice(0, 2600)}`).join('\n\n');
    let out = {};
    try { out = await gemini(EXTRACT_PROMPT + blocks); } catch (e) { console.warn(`  batch failed: ${e.message}`); }
    for (const e of batch) result[e.number] = (out[String(e.number)] || []).filter(w => w && w.work);
    done += batch.length;
    console.log(`  ${done}/${eps.length}`);
    await sleep(1000);
  }
  writeJSON('extracted.json', result);
  const total = Object.values(result).reduce((s, a) => s + a.length, 0);
  console.log(`  → ${total} primary-source citations across ${Object.keys(result).length} episodes`);
}

// ── Stage 2: dedupe / canonicalise ───────────────────────────────────────────

async function stageDedupe() {
  console.log('Stage 2 DEDUPE');
  const extracted = readJSON('extracted.json', {});
  // collect raw works with episode refs
  const raw = [];
  for (const [ep, works] of Object.entries(extracted)) for (const w of works) raw.push({ ep: +ep, work: w.work, author: w.author, era: w.era });
  // first pass: deterministic merge on normalized author+work
  const byKey = new Map();
  for (const r of raw) {
    const key = `${norm(r.author)}|${norm(r.work)}`;
    if (!byKey.has(key)) byKey.set(key, { work: r.work, author: r.author, era: r.era, episodes: new Set() });
    byKey.get(key).episodes.add(r.ep);
  }
  let works = [...byKey.values()].map(w => ({ ...w, episodes: [...w.episodes].sort((a, b) => a - b) }));
  console.log(`  ${raw.length} raw → ${works.length} after exact-key merge`);

  // second pass: LLM canonicalisation — merge title/author variants of the same work.
  // Send compact list, get back canonical groups.
  works.sort((a, b) => (a.author + a.work).localeCompare(b.author + b.work));
  const listing = works.map((w, i) => `${i}: "${w.work}" — ${w.author}`).join('\n');
  const CANON = `These are historical works cited across a podcast, after a naive de-duplication. Merge entries that are THE SAME work (title variants, translated/latinised titles, author-name variants, "Timaeus"="Timæus", a work and its obvious abbreviation). Do NOT merge genuinely different works by the same author (e.g. Plato's Republic vs Timaeus are different).

Return ONLY JSON: {"groups":[{"canonical_work","canonical_author","members":[indices]}]} covering every index exactly once.

ENTRIES:
${listing}`;
  let merged = works;
  try {
    const res = await gemini(CANON, 16384);
    const groups = res.groups || [];
    const seen = new Set();
    merged = groups.map(g => {
      const members = (g.members || []).filter(i => Number.isInteger(i) && works[i] && !seen.has(i));
      members.forEach(i => seen.add(i));
      if (!members.length) return null;
      const eps = new Set(); let era = '';
      for (const i of members) { works[i].episodes.forEach(e => eps.add(e)); era = era || works[i].era; }
      return { work: g.canonical_work, author: g.canonical_author, era, episodes: [...eps].sort((a, b) => a - b) };
    }).filter(Boolean);
    // any index the model forgot → keep as-is
    works.forEach((w, i) => { if (!seen.has(i)) merged.push(w); });
    console.log(`  ${works.length} → ${merged.length} after LLM canonicalisation`);
  } catch (e) { console.warn(`  canonicalisation failed (${e.message}); keeping exact-key merge`); }

  merged.sort((a, b) => b.episodes.length - a.episodes.length);
  writeJSON('works.json', merged);
  console.log(`  → ${merged.length} canonical works`);
}

// ── Stage 3: holdings match ──────────────────────────────────────────────────

const EXCLUDE_LANGS = new Set(['Chinese', 'Classical Chinese', 'Literary Chinese', 'Sanskrit', 'Tibetan', 'Japanese', 'Korean', 'Pali', 'Thai', 'Vietnamese', 'Mongolian']);

async function stageHoldings() {
  console.log('Stage 3 HOLDINGS');
  const works = readJSON('works.json', []);
  const items = LIMIT ? works.slice(0, LIMIT) : works;
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // retrieve candidates per work
  console.log(`  retrieving candidates for ${items.length} works…`);
  const withCands = await mapPool(items, 6, async (w) => {
    const vec = await embed(`${w.work} by ${w.author}`);
    if (!vec) return { w, cands: [] };
    const { data } = await supabase.rpc('match_books_semantic', { query_embedding: JSON.stringify(vec), match_threshold: 0.3, match_count: 12 });
    const ids = (data || []).map(r => r.book_id);
    const oids = ids.map(i => { try { return new ObjectId(i); } catch { return null; } }).filter(Boolean);
    const rows = await db.collection('books').find({ _id: { $in: oids }, visible: true, pages_count: { $gt: 0 } },
      { projection: { display_title: 1, title: 1, author: 1, year: 1, language: 1 } }).toArray();
    const byId = new Map(rows.filter(r => !EXCLUDE_LANGS.has(r.language)).map(r => [r._id.toString(), r]));
    return { w, cands: ids.filter(i => byId.has(i)).map(i => byId.get(i)) };
  });

  // confirm in batches
  console.log('  confirming holdings…');
  const BATCH = 14;
  const out = [];
  for (let i = 0; i < withCands.length; i += BATCH) {
    const batch = withCands.slice(i, i + BATCH);
    const blocks = batch.map((b, j) => {
      const lines = b.cands.map(c => `[${c._id}] "${(c.display_title || c.title || '').slice(0, 90)}" by ${c.author || '?'}${c.year ? ` (${c.year})` : ''}`).join('\n') || '(no candidates)';
      return `WORK ${i + j}: "${b.w.work}" by ${b.w.author}\nCandidate books:\n${lines}`;
    }).join('\n\n');
    const PROMPT = `For each WORK, choose the candidate books that ARE an edition, translation, or commentary of THAT EXACT historical work — the SAME work by the SAME author.

- Match across title/language variants (Latin/Greek/English, abbreviations, "Timaeus"="Timæus").
- REJECT coincidental title matches that are a DIFFERENT work or by a DIFFERENT author. Examples to reject:
  • Thomas Middleton's play "A Game at Chess" is NOT Jacobus de Cessolis's medieval "Game of Chess" — different work and author.
  • A modern monograph merely ABOUT the work is not the work.
- Both the work AND the author must align. If unsure, do NOT select. Return [] if none qualify.

Return ONLY JSON: {"<workIndex>":["bookid",...]}.

${blocks}`;
    let res = {};
    try { res = await gemini(PROMPT); } catch (e) { console.warn(`  holdings batch failed: ${e.message}`); }
    batch.forEach((b, j) => {
      const valid = new Set(b.cands.map(c => c._id.toString()));
      const held = (res[String(i + j)] || []).filter(id => valid.has(id));
      out.push({ ...b.w, held });
    });
    console.log(`  ${Math.min(i + BATCH, withCands.length)}/${withCands.length}`);
    await sleep(1000);
  }
  await client.close();
  writeJSON('works-held.json', out);
  const haveN = out.filter(w => w.held.length).length;
  console.log(`  → ${haveN}/${out.length} cited works held; ${out.length - haveN} to acquire`);
}

// ── Stage 4: emit ────────────────────────────────────────────────────────────

async function stageEmit() {
  console.log('Stage 4 EMIT');
  const works = readJSON('works-held.json', []);
  const eps = loadEpisodes();
  const titleByNum = new Map(eps.map(e => [e.number, e.title]));

  // resolve held book titles for the DB
  const allHeld = [...new Set(works.flatMap(w => w.held))];
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const rows = allHeld.length ? await db.collection('books').find({ _id: { $in: allHeld.map(i => new ObjectId(i)) } },
    { projection: { display_title: 1, title: 1, author: 1 } }).toArray() : [];
  await client.close();
  const bookTitle = new Map(rows.map(r => [r._id.toString(), r.display_title || r.title]));
  const bookAuthor = new Map(rows.map(r => [r._id.toString(), r.author || '']));

  // Deterministic author guard: drop held books whose author doesn't overlap the work's
  // author — catches title-coincidence false positives the LLM won't retract (e.g.
  // Middleton's "A Game at Chess" matched to Cessolis's "Game of Chess"). Skipped for
  // anonymous/various works (scripture, the Hermetica, corpora) where author can't gate.
  const AUTH_STOP = new Set(['the', 'of', 'de', 'von', 'van', 'di', 'del', 'la', 'le', 'al', 'ibn', 'bin', 'abu', 'ben', 'saint', 'st', 'pseudo', 'attributed', 'elder', 'younger', 'and', 'the elder', 'the younger']);
  const authTokens = a => norm(a).split(' ').filter(t => t.length > 2 && !AUTH_STOP.has(t));
  const authorOk = (workAuthor, bookId) => {
    const wa = norm(workAuthor);
    if (!wa || wa.includes('anonymous') || wa.includes('various') || wa.includes('attributed') || wa.includes('unknown')) return true;
    const wt = authTokens(workAuthor);
    if (!wt.length) return true;
    const bt = new Set(authTokens(bookAuthor.get(bookId) || ''));
    return wt.some(t => bt.has(t));
  };
  let guarded = 0;
  for (const w of works) {
    const kept = w.held.filter(id => authorOk(w.author, id));
    if (kept.length !== w.held.length) guarded += w.held.length - kept.length;
    w.held = kept;
  }
  if (guarded) console.log(`  author guard dropped ${guarded} title-coincidence holdings`);

  // 4a — works DB (sorted: most-cited first)
  const dbRows = works.map(w => ({
    work: w.work, author: w.author, era: w.era,
    episodes: w.episodes,
    status: w.held.length ? 'held' : 'acquire',
    held: w.held.map(id => ({ id, title: bookTitle.get(id) || id })),
  }));
  let ts = `/**
 * SHWEP cited-works database — the historical primary sources cited across SHWEP
 * episodes, deduped + work/author aligned, flagged held vs. to-acquire.
 * Generated by scripts/enrichment/shwep-cited-works.mjs (${MODEL}).
 * Do not edit by hand.
 */
export interface ShwepCitedWork {
  work: string;
  author: string;
  era: string;
  episodes: number[];
  status: 'held' | 'acquire';
  held: { id: string; title: string }[];
}
export const SHWEP_CITED_WORKS: ShwepCitedWork[] = ${JSON.stringify(dbRows, null, 2)};
`;
  fs.writeFileSync(path.join(DATA_DIR, 'shwep-cited-works.ts'), ts);

  // 4b — per-episode held books (grounded reader links) → shwep-book-matches.ts.
  // Cap editions-per-work so a common text (e.g. a Bible, Plato's complete works) cited
  // in an episode doesn't flood the page with a dozen copies; the full holdings live in
  // the works DB. Keep up to EDITIONS_PER_WORK per cited work per episode.
  const EDITIONS_PER_WORK = 4;
  const perEp = {};
  for (const w of works) {
    if (!w.held.length) continue;
    const editions = w.held.slice(0, EDITIONS_PER_WORK);
    for (const ep of w.episodes) {
      (perEp[ep] = perEp[ep] || new Set());
      editions.forEach(id => perEp[ep].add(id));
    }
  }
  const matchSorted = Object.entries(perEp).map(([ep, set]) => [+ep, [...set]]).sort((a, b) => a[0] - b[0]);
  let mt = `/**
 * Held primary sources per SHWEP episode — the works Earl cites that we hold, shown
 * as "Read in Source Library" links. Derived from src/data/shwep-cited-works.ts by
 * scripts/enrichment/shwep-cited-works.mjs. Do not edit by hand.
 */
export const SHWEP_BOOK_MATCHES: Record<number, string[]> = {\n`;
  for (const [ep, ids] of matchSorted) mt += `  ${ep}: ${JSON.stringify(ids)},\n`;
  mt += `};\n`;
  fs.writeFileSync(path.join(DATA_DIR, 'shwep-book-matches.ts'), mt);

  // 4c — acquisition gap report (primary sources we lack, most-cited first)
  const gap = works.filter(w => !w.held.length).sort((a, b) => b.episodes.length - a.episodes.length);
  let md = `# SHWEP cited primary sources we don't yet hold\n\n${gap.length} works, ordered by how many episodes cite them.\n\n`;
  md += `| Work | Author | Era | Episodes |\n|---|---|---|---|\n`;
  for (const w of gap) md += `| ${w.work} | ${w.author} | ${w.era} | ${w.episodes.length} (${w.episodes.slice(0, 8).join(', ')}${w.episodes.length > 8 ? '…' : ''}) |\n`;
  fs.writeFileSync(path.join(CACHE, 'acquire.md'), md);

  const held = works.filter(w => w.held.length).length;
  console.log(`  works DB: ${works.length} (held ${held}, acquire ${works.length - held})`);
  console.log(`  reader links: ${matchSorted.length} episodes with held sources`);
  console.log(`  acquisition gap: ${gap.length} → ${path.join(CACHE, 'acquire.md')}`);
}

// ── main ─────────────────────────────────────────────────────────────────────

(async () => {
  if (want('--extract')) { let eps = loadEpisodes(); if (LIMIT) eps = eps.slice(0, LIMIT); await stageExtract(eps); }
  if (want('--dedupe')) await stageDedupe();
  if (want('--holdings')) await stageHoldings();
  if (want('--emit')) await stageEmit();
  if (!args.length) console.log('Specify --extract | --dedupe | --holdings | --emit | --all');
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
