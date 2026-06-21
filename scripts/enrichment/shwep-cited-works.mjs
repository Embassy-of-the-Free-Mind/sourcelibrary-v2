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
 *   3 HOLDINGS — the "process matcher" (validated 10/10 on #76, 9/9 + 0 FP on the
 *                Islamicate/Byzantine tail; see scripts/eval/_tmp-shwep-gemini-match-eval-v2.mjs
 *                and .claude/docs/work-identity-matching-research.md). Two steps:
 *                (a) NORMALIZE each cited work → canonical title forms in ALL languages
 *                    (original-language + English + variants) + extant/lost status;
 *                (b) embed the title forms, retrieve nearest books (match_books_semantic),
 *                    then a per-WORK LLM confirmer keeps only books that ARE an
 *                    edition/translation/commentary of THAT exact work by THAT author.
 *                Lost works → no holding (never a same-author fallback). This replaces the
 *                old batch single-confirm matcher (missed cross-language + City of God cases).
 *   4 EMIT     — writes:
 *                • src/data/shwep-cited-works.ts          (the works DB)
 *                • src/data/shwep-book-matches.ts         (held works per episode = reader links)
 *                • /tmp/shwep-cited/acquire.md            (the acquisition gap, primary sources we lack)
 *   5 LINKBIB  — auto-generates src/data/shwep-linked-bibliographies.ts for ALL episodes:
 *                injects inline /book/<slug> "read here" links into each episode's
 *                displayed bibliography at the cited-work mentions, ONLY for works we
 *                publicly hold (visible + translated, via bestEdition). Hand-curated
 *                #76/#323 are preserved verbatim as the quality bar. Output is validated
 *                verbatim-faithful (the only delta vs. the source bibliography is the added
 *                link markup) or the episode is skipped (page falls back to plain text).
 *
 * Usage (run stages in order; each caches so you can re-emit cheaply):
 *   node scripts/enrichment/shwep-cited-works.mjs --extract
 *   node scripts/enrichment/shwep-cited-works.mjs --dedupe
 *   node scripts/enrichment/shwep-cited-works.mjs --holdings
 *   node scripts/enrichment/shwep-cited-works.mjs --emit
 *   node scripts/enrichment/shwep-cited-works.mjs --linkbib
 *   node scripts/enrichment/shwep-cited-works.mjs --all      # all stages in sequence
 *
 * Needs src/data/shwep-reading-lists.json (gitignored — copy from main checkout into
 * the worktree first). LINKBIB additionally reads src/data/shwep-bibliographies.ts
 * (the text the reader page actually displays) so injected links land in shown text.
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.production.local' });
import { MongoClient, ObjectId } from 'mongodb';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { COLLECTED_RX, isCollected, bestEdition, editionReadable, editionVisible } from '../lib/holdings-resolver.mjs';

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

// ── shared holdings helpers (emit + linkbib) ─────────────────────────────────

// Deterministic author guard: drop held books whose author doesn't overlap the work's
// author — catches title-coincidence false positives the LLM won't retract (e.g.
// Middleton's "A Game at Chess" matched to Cessolis's "Game of Chess"). Skipped for
// anonymous/various works (scripture, the Hermetica, corpora) where author can't gate.
const AUTH_STOP = new Set(['the', 'of', 'de', 'von', 'van', 'di', 'del', 'la', 'le', 'al', 'ibn', 'bin', 'abu', 'ben', 'saint', 'st', 'pseudo', 'attributed', 'elder', 'younger', 'and', 'the elder', 'the younger']);
const authTokens = a => norm(a).split(' ').filter(t => t.length > 2 && !AUTH_STOP.has(t));
function authorOk(workAuthor, bookAuthor) {
  const wa = norm(workAuthor);
  if (!wa || wa.includes('anonymous') || wa.includes('various') || wa.includes('attributed') || wa.includes('unknown')) return true;
  const wt = authTokens(workAuthor);
  if (!wt.length) return true;
  const bt = new Set(authTokens(bookAuthor || ''));
  return wt.some(t => bt.has(t));
}
// Mutates each work: filters .held / .heldMeta to author-consistent books. Returns count dropped.
function applyAuthorGuard(works) {
  let dropped = 0;
  for (const w of works) {
    const meta = w.heldMeta || [];
    const keptMeta = meta.filter(m => authorOk(w.author, m.author));
    dropped += meta.length - keptMeta.length;
    const keepIds = new Set(keptMeta.map(m => m.id));
    w.heldMeta = keptMeta;
    w.held = (w.held || []).filter(id => keepIds.has(id));
  }
  return dropped;
}

// Pick the single representative PUBLICLY-READABLE edition for inline reader links:
// must be translated (pages_translated > 0; visibility already enforced at retrieval).
// Holdings primitives live in the shared resolver so the works-catalog / translation
// registry (#2453/#2567) imports the same logic instead of reinventing it.
const bookHref = m => `/book/${m.slug || m.id}`;

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

// ── Stage 3: holdings match (the "process matcher") ──────────────────────────
// Two steps, validated 10/10 on #76 and 9/9 (+0 FP) on the Islamicate/Byzantine
// tail vs. 6/10 for the old single-confirm matcher:
//   (a) NORMALIZE each cited work → canonical title forms in ALL languages + status.
//   (b) embed the title forms → retrieve → per-WORK confirmer reasons per candidate.
// Wikidata work-level coverage is ~45% (≈0% Islamicate), so the LLM confirmer stays
// in the loop; canonical title forms (not a single QID) are the precision overlay.

const EXCLUDE_LANGS = new Set(['Chinese', 'Classical Chinese', 'Literary Chinese', 'Sanskrit', 'Tibetan', 'Japanese', 'Korean', 'Pali', 'Thai', 'Vietnamese', 'Mongolian']);

// Step (a): normalize a batch of works → { i, title_forms[], author, status }.
const NORMALIZE_PROMPT = `For each cited ancient/medieval/early-modern work below, return its canonical identity for matching against a library catalogue.
For EACH return:
- "i": the index.
- "title_forms": array of the work's titles a catalogue might use — the ORIGINAL-LANGUAGE title (Latin/Greek/Arabic-transliterated/etc.), the standard English title, and common variants/abbreviations. Examples: "City of God" by Augustine → ["De Civitate Dei","The City of God","civ. dei"]; "Platonic Theology" by Proclus → ["Theologia Platonica","Platonic Theology"]; "Commentary on the Republic" by Proclus → ["In Rem Publicam","in Politiam Platonis","Commentary on the Republic"].
- "author": canonical author name (or "Anonymous").
- "status": "extant" if the work survives in standalone editions/translations, or "lost" if it survives only as fragments/testimonia with NO standalone edition (e.g. Porphyry "De regressu animae" = lost; but Damascius "In Phaedonem" survives and is a DISTINCT work from his De principiis — that is extant).
Return ONLY JSON {"works":[{"i":<index>,"title_forms":[...],"author":"...","status":"extant|lost"}]} covering every index.

WORKS:
`;

async function stageNormalize() {
  const works = readJSON('works.json', []);
  const items = LIMIT ? works.slice(0, LIMIT) : works;
  console.log(`  normalizing ${items.length} works → canonical title forms…`);
  const norm = {};
  const BATCH = 12;
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    const listing = batch.map((w, j) => `${i + j}: "${w.work}" by ${w.author}`).join('\n');
    try {
      const res = await gemini(NORMALIZE_PROMPT + listing, 8192);
      for (const w of (res.works || [])) if (Number.isInteger(w.i)) norm[w.i] = w;
    } catch (e) { console.warn(`  normalize batch failed: ${e.message}`); }
    await sleep(800);
  }
  // fill any gaps with the bare title so nothing falls out of the pipeline
  items.forEach((w, idx) => { if (!norm[idx]) norm[idx] = { i: idx, title_forms: [w.work], author: w.author, status: 'extant' }; });
  writeJSON('normalized.json', norm);
  const lost = Object.values(norm).filter(n => n.status === 'lost').length;
  console.log(`  → normalized ${Object.keys(norm).length} works (${lost} flagged lost → no holding)`);
}

// Per-work confirmer: reason per candidate, keep only this exact work by this author.
function confirmPrompt(titleForms, author, cands) {
  const list = cands.map((b, j) => `[${j}] "${(b.display_title || b.title || '').slice(0, 90)}" by ${b.author || '?'}${b.year ? ` (${b.year})` : ''} [${b.language || '?'}]`).join('\n');
  return `You are matching a cited work to a library's candidate books.
CITED WORK: "${titleForms[0]}" by ${author}. Known title forms (any language): ${JSON.stringify(titleForms)}.
A candidate matches if it is an edition, translation, or commentary of THIS EXACT work by THIS author — recognise it under ANY of the title forms above, in any language (Latin/Greek/Arabic/English).
ALSO a match: a COMPLETE-WORKS / OPERA OMNIA / "Works of <author>" edition of THIS SAME author that would CONTAIN this work. But be careful with a TITLED SUBSET ("Philosophical Works", "Theological Works", "Letters", "Poems", "Orations", "Sermons", "Exegetical Works"): it counts ONLY if the cited work fits that genre — e.g. an ALCHEMICAL "Epistle on Chrysopoeia" is NOT in a "Philosophical Works" of Psellos; a single oration is not in a "Letters". When unsure whether the collection includes this specific work, do NOT match.
NOT a match: a DIFFERENT work by the same author (when the candidate is a single specific other work); a work or collected-works of a DIFFERENT author (watch name collisions — Philo of Alexandria ≠ Philoponus ≠ Philostratus; Plato's dialogue ≠ a commentary ON it); a modern monograph merely ABOUT the work.
CANDIDATES:
${list || '(no candidates)'}
Think step by step: restate the work's original-language title; then for each candidate decide whether its title (possibly Latin/Greek/Arabic) denotes this same work by this author. Return JSON {"reasoning":"<one sentence>","matches":[<indices of candidate books that ARE this work>]}.`;
}

async function stageHoldings() {
  console.log('Stage 3 HOLDINGS (process matcher)');
  await stageNormalize();
  const works = readJSON('works.json', []);
  const norm = readJSON('normalized.json', {});
  const items = LIMIT ? works.slice(0, LIMIT) : works;
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Author-anchored recall pool. Embedding retrieval ranks a specific treatise title
  // ("De Cherubim") poorly against a generically-titled collected edition ("Complete
  // Works of Philo"), so omnibus editions that DO contain a cited work get missed — we
  // hold 16 readable Philo editions but the matcher saw only one. Pre-fetch all visible,
  // readable collected/complete-works editions, index by author token, and offer them as
  // extra candidates per (non-anonymous) work; the flash-lite confirmer judges containment.
  const collected = await db.collection('books').find(
    { visible: true, pages_count: { $gt: 0 }, pages_translated: { $gt: 0 },
      $or: [{ title: { $regex: COLLECTED_RX } }, { display_title: { $regex: COLLECTED_RX } }] },
    { projection: { display_title: 1, title: 1, author: 1, year: 1, language: 1, slug: 1, work_id: 1, pages_translated: 1, pages_ocr: 1, pages_blank: 1 } }).toArray();
  const collectedByToken = new Map();
  for (const b of collected) {
    if (EXCLUDE_LANGS.has(b.language)) continue;
    for (const t of authTokens(b.author)) { if (!collectedByToken.has(t)) collectedByToken.set(t, []); collectedByToken.get(t).push(b); }
  }
  console.log(`  author-anchored pool: ${collected.length} collected-works editions across ${collectedByToken.size} author tokens`);

  console.log(`  matching ${items.length} works (embed title-forms + author-anchored → retrieve → per-candidate confirm)…`);
  let done = 0;
  const out = await mapPool(items, 6, async (w, idx) => {
    const nf = norm[idx] || { title_forms: [w.work], author: w.author, status: 'extant' };
    const forms = (nf.title_forms && nf.title_forms.length ? nf.title_forms : [w.work]).slice(0, 8);
    const author = nf.author || w.author;
    const base = { ...w, title_forms: forms, status: nf.status || 'extant' };

    // lost work → explicit no-holding, never a same-author fallback
    if (nf.status === 'lost') { done++; if (done % 25 === 0) console.log(`  ${done}/${items.length}`); return { ...base, held: [] }; }

    // retrieve: query the combined form string AND each individual title form, then
    // UNION the candidates. A divergent-title / cross-language edition (e.g. an
    // English-titled "Testament of Solomon" edition, or a Greek edition of a work cited
    // in English) often ranks outside the top-12 of a single blended query; querying
    // each form on its own and unioning recovers it. The per-candidate confirmer +
    // author guard still gate every hit, so wider recall doesn't cost precision.
    const queries = [...new Set([`${forms.join('; ')} by ${author}`, ...forms.slice(0, 4).map(f => `${f} by ${author}`)])];
    const rank = new Map(); // book_id → best (lowest) retrieval rank across all queries
    for (const q of queries) {
      const vec = await embed(q);
      if (!vec) continue;
      const { data } = await supabase.rpc('match_books_semantic', { query_embedding: JSON.stringify(vec), match_threshold: 0.2, match_count: 12 });
      (data || []).forEach((r, i) => { const cur = rank.get(r.book_id); if (cur === undefined || i < cur) rank.set(r.book_id, i); });
    }
    const ids = [...rank.keys()];
    const oids = ids.map(i => { try { return new ObjectId(i); } catch { return null; } }).filter(Boolean);
    const rows = oids.length ? await db.collection('books').find({ _id: { $in: oids }, visible: true, pages_count: { $gt: 0 } },
      { projection: { display_title: 1, title: 1, author: 1, year: 1, language: 1, slug: 1, work_id: 1, pages_translated: 1, pages_ocr: 1, pages_blank: 1 } }).toArray() : [];
    const byId = new Map(rows.filter(r => !EXCLUDE_LANGS.has(r.language)).map(r => [r._id.toString(), r]));
    // best-ranked embedding candidates (cap), then add author-anchored collected-works
    const CAND_CAP = 16;
    const cands = ids.filter(i => byId.has(i)).sort((a, b) => rank.get(a) - rank.get(b)).slice(0, CAND_CAP).map(i => byId.get(i));
    const authToks = author && !/anonymous|various|unknown|attributed/i.test(author) ? authTokens(author) : [];
    if (authToks.length) {
      const seen = new Set(cands.map(b => b._id.toString()));
      const extra = [];
      for (const t of authToks) for (const b of (collectedByToken.get(t) || [])) { const id = b._id.toString(); if (!seen.has(id)) { seen.add(id); extra.push(b); } }
      cands.push(...extra.slice(0, 8)); // cap omnibus extras per work
    }
    if (!cands.length) { done++; if (done % 25 === 0) console.log(`  ${done}/${items.length}`); return { ...base, held: [] }; }

    // confirm: reason per candidate
    let picks = [];
    if (cands.length) {
      try { picks = (await gemini(confirmPrompt(forms, author, cands), 2048)).matches || []; } catch (e) { console.warn(`  confirm failed [${idx}] ${w.work}: ${e.message}`); }
    }
    const heldBooks = picks.map(p => cands[p]).filter(Boolean);
    const held = heldBooks.map(b => b._id.toString());
    const heldMeta = heldBooks.map(b => ({
      id: b._id.toString(), slug: b.slug || null, title: b.display_title || b.title || '',
      author: b.author || '', year: b.year || null, language: b.language || '',
      pages_translated: b.pages_translated || 0, pages_ocr: b.pages_ocr || 0, pages_blank: b.pages_blank || 0,
    }));
    done++; if (done % 25 === 0) console.log(`  ${done}/${items.length}`);
    return { ...base, author, held, heldMeta };
  });

  await client.close();
  writeJSON('works-held.json', out);
  const haveN = out.filter(w => w.held.length).length;
  console.log(`  → ${haveN}/${out.length} cited works held; ${out.length - haveN} to acquire`);
}

// ── Stage 4: emit ────────────────────────────────────────────────────────────

async function stageEmit() {
  console.log('Stage 4 EMIT');
  const works = readJSON('works-held.json', []);

  // author guard (shared with linkbib) — drop title-coincidence false positives
  const guarded = applyAuthorGuard(works);
  if (guarded) console.log(`  author guard dropped ${guarded} title-coincidence holdings`);

  // 4a — works DB (sorted: most-cited first). held carries slug + whether it's
  // publicly readable (translated), so the reader UI and linkbib can pick editions.
  const metaById = new Map();
  for (const w of works) for (const m of (w.heldMeta || [])) metaById.set(m.id, m);
  const dbRows = works.map(w => ({
    work: w.work, author: w.author, era: w.era,
    episodes: w.episodes,
    status: w.held.length ? 'held' : 'acquire',
    held: w.held.map(id => {
      const m = metaById.get(id) || {};
      return { id, slug: m.slug || null, title: m.title || id, language: m.language || '', translated: (m.pages_translated || 0) > 0 };
    }),
  }));
  let ts = `/**
 * SHWEP cited-works database — the historical primary sources cited across SHWEP
 * episodes, deduped + work/author aligned, flagged held vs. to-acquire.
 * Generated by scripts/enrichment/shwep-cited-works.mjs (${MODEL}, process matcher).
 * Do not edit by hand.
 */
export interface ShwepCitedHolding {
  id: string;
  slug: string | null;
  title: string;
  language: string;
  /** true when we hold this edition translated into English (publicly readable). */
  translated: boolean;
}
export interface ShwepCitedWork {
  work: string;
  author: string;
  era: string;
  episodes: number[];
  status: 'held' | 'acquire';
  held: ShwepCitedHolding[];
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

// ── Stage 5: linked bibliographies ───────────────────────────────────────────
// Inject inline /book/<slug> "read here" links into each episode's DISPLAYED
// bibliography (src/data/shwep-bibliographies.ts) at the cited-work mentions, ONLY
// for works we publicly hold (visible + translated, via bestEdition). The LLM only
// LOCATES the exact substring naming each held work (its title or scholarly
// abbreviation, recognised across languages — "civ. dei" = City of God); JS splices
// the link into the ORIGINAL text, so the bibliography is preserved byte-for-byte
// apart from the added markup. A span the LLM returns that isn't a verbatim slice of
// the bibliography is dropped (never fabricated). Hand-curated #76/#323 are kept
// verbatim as the quality bar.

const HAND_CURATED = new Set([76, 323]);

// Ranges [start,end) we must never splice a link into: every bracketed span `[...]`
// (with or without a trailing `(url)`). This covers existing markdown links AND bare
// brackets used as abbreviation keys / editorial notes (e.g. "[Abbreviations: *PT* =
// …]", "[But how do we reconcile…]"). Splicing a `[..](..)` inside one of these would
// nest brackets and break the markdown.
function protectedSpanRanges(s) {
  const ranges = [];
  const re = /\[[^\]]*\](?:\([^)]*\))?/g;
  let m; while ((m = re.exec(s)) !== null) ranges.push([m.index, m.index + m[0].length]);
  return ranges;
}

// Does the bibliography entry (blank-line-delimited block) containing index `idx`
// carry a publication year? A dated entry is a formal citation of a SPECIFIC edition
// (e.g. "Proclus, Saffrey & Westerink (Ed.), 1997. Théologie Platonicienne. Les Belles
// Lettres."). We must NOT wrap the title there: our "read here" link points at a
// DIFFERENT edition we hold, so attaching it to that citation misattributes provenance.
// Earl's in-discussion mentions ("*theol. Plat.* 1.25", "*civ. dei* X.9") carry no year,
// so this cleanly keeps the #76-style links and drops the edition-citation ones.
const PUB_YEAR = /\b(1[4-9]\d\d|20\d\d)\b/;
function entryHasYear(s, idx) {
  let start = s.lastIndexOf('\n\n', idx); start = start === -1 ? 0 : start + 2;
  let end = s.indexOf('\n\n', idx); if (end === -1) end = s.length;
  return PUB_YEAR.test(s.slice(start, end));
}

async function injectLinks(bib, holds) {
  const holdList = holds.map((h, i) =>
    `${i}. "${h.work}" by ${h.author}; also written as: ${JSON.stringify(h.forms.slice(0, 6))}`).join('\n');
  const prompt = `A history-of-philosophy reading-list bibliography (markdown) is below, followed by a numbered list of historical works WE HOLD in our library.
For EACH held work, find where it is FIRST mentioned anywhere in the bibliography and return the EXACT substring — copied character-for-character from the bibliography — that names it. This is usually the work's title or its scholarly abbreviation AS WRITTEN, including any markdown emphasis around it (e.g. "*civ. dei*", "*de myst*.", "*Chaldæan Oracles*", "*Vit. Proc*."). Recognise the work under ANY language, title form, or abbreviation.
The substring will be turned into a hyperlink, so it MUST be a verbatim slice of the bibliography text, and should be JUST the title/abbreviation token (a few words at most) — never a whole sentence, clause, or citation. Never include square brackets, parentheses, or line breaks in the substring.
If a held work is NOT mentioned in the bibliography, return null for its text.
Return ONLY JSON {"spans":[{"i":<held index>,"text":"<exact substring, or null>"}]}.

BIBLIOGRAPHY:
${bib}

WORKS WE HOLD:
${holdList}`;
  let res; try { res = await gemini(prompt, 8192); } catch { return null; }
  const spans = (res && Array.isArray(res.spans)) ? res.spans : [];
  const picks = [];
  const used = protectedSpanRanges(bib).slice(); // seed with bracket spans → never splice inside one
  const seenWork = new Set();
  for (const s of spans) {
    if (!s || typeof s.text !== 'string' || !s.text.trim()) continue;
    const h = holds[s.i]; if (!h || seenWork.has(s.i)) continue;
    const span = s.text.trim();
    // span must be a clean, short title/abbreviation token — no brackets/parens/newlines
    // (which would break nested markdown), no run-on phrases. Otherwise drop the link.
    if (/[[\]()\n]/.test(span) || span.length > 70 || span.split(/\s+/).length > 10) continue;
    // first occurrence that is a verbatim slice, not overlapping a prior pick or an existing link
    let from = 0, idx;
    while ((idx = bib.indexOf(span, from)) !== -1) {
      const end = idx + span.length;
      const overlap = used.some(([a, b]) => idx < b && end > a);
      // accept only a clean, undated occurrence — never inside a bracket span or a
      // dated edition citation (that would point our copy at someone else's edition)
      if (!overlap && !entryHasYear(bib, idx)) break;
      from = idx + 1;
    }
    if (idx === -1) continue; // no clean, undated occurrence → drop (never misattribute)
    picks.push({ idx, end: idx + span.length, span, href: h.href });
    used.push([idx, idx + span.length]);
    seenWork.add(s.i);
  }
  if (!picks.length) return null;
  picks.sort((a, b) => a.idx - b.idx);
  let out = '', cursor = 0;
  for (const p of picks) {
    if (p.idx < cursor) continue;
    out += bib.slice(cursor, p.idx) + `[${p.span}](${p.href})`;
    cursor = p.end;
  }
  out += bib.slice(cursor);
  return { text: out, count: picks.length };
}

// Match a cited work to a CHAPTER (a part) of a collected edition by English-title token
// overlap — both chapter.titleEn and the work's title_forms carry English forms, so no LLM
// is needed. Conservative: requires ~all of the work's distinctive tokens to appear in the
// chapter title, so we deep-link only on a confident match and otherwise fall back to the
// volume front (never a wrong-page link). Returns the chapter (with .pageId) or null.
const TITLE_STOP = new Set(['the', 'a', 'an', 'of', 'on', 'de', 'to', 'and', 'or', 'in', 'book', 'treatise', 'concerning', 'being', 'first', 'second', 'third', 'fourth', 'vol', 'volume', 'part', 'against', 'que', 'qui']);
const titleToks = s => norm(s).split(' ').filter(t => t.length > 2 && !TITLE_STOP.has(t));
function chapterMatch(titleForms, chapters) {
  if (!chapters || !chapters.length) return null;
  const wantSets = (titleForms || []).map(f => new Set(titleToks(f))).filter(s => s.size);
  if (!wantSets.length) return null;
  let best = null, bestScore = 0;
  for (const ch of chapters) {
    if (!ch || !ch.pageId) continue;
    const ct = new Set(titleToks(ch.titleEn || ch.title || ''));
    if (!ct.size) continue;
    for (const want of wantSets) {
      const inter = [...want].filter(t => ct.has(t)).length;
      const score = inter / want.size; // fraction of the work's distinctive tokens in the chapter
      if (score > bestScore) { bestScore = score; best = ch; }
    }
  }
  return bestScore >= 0.8 ? best : null;
}

async function stageLinkBib() {
  console.log('Stage 5 LINKBIB');
  const works = readJSON('works-held.json', []);
  applyAuthorGuard(works);

  // Enrich heldMeta with pages_count (so bestEdition can score completeness) and capture
  // each held book's chapters (so a cited work can be deep-linked to the PART of a collected
  // edition that contains it — chapter.pageId is the reader-route page id).
  const allHeldIds = [...new Set(works.flatMap(w => (w.heldMeta || []).map(m => m.id)))];
  const chaptersById = new Map();
  if (allHeldIds.length) {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const rows = await client.db('bookstore').collection('books').find(
      { _id: { $in: allHeldIds.map(i => { try { return new ObjectId(i); } catch { return null; } }).filter(Boolean) } },
      { projection: { pages_count: 1, chapters: 1 } }).toArray();
    await client.close();
    const pcById = new Map(rows.map(r => [r._id.toString(), r.pages_count || 0]));
    for (const r of rows) chaptersById.set(r._id.toString(), r.chapters || []);
    for (const w of works) for (const m of (w.heldMeta || [])) m.pages_count = pcById.get(m.id) || m.pages_count || 0;
  }

  const BIB = (await import(path.join(DATA_DIR, 'shwep-bibliographies.ts'))).SHWEP_BIBLIOGRAPHIES || {};
  let HAND = {};
  try { HAND = (await import(path.join(DATA_DIR, 'shwep-linked-bibliographies.ts'))).SHWEP_LINKED_BIBLIOGRAPHIES || {}; } catch {}

  // per-episode: EVERY held work for the episode, deduped to one representative edition
  // (the readable bestEdition when we have it, else any held copy). `linkable` works can
  // be inline-linked; the rest — and any linkable work whose only mention is in a dated
  // citation — still need to reach the reader, via the supplementary card grid below.
  const byEp = {};
  for (const w of works) {
    const meta = w.heldMeta || [];
    if (!meta.length) continue;
    const best = bestEdition(meta);
    const rep = best || meta[0];
    // Page-precise deep link: if the chosen edition is a collected/omnibus volume and the
    // cited work matches one of its chapters (a PART of the book), link straight to that
    // treatise's page instead of the 800-page volume front.
    let href = best ? bookHref(best) : null;
    let chapterPage = null;
    if (best && isCollected(best)) {
      const ch = chapterMatch(w.title_forms || [w.work], chaptersById.get(best.id));
      if (ch && ch.pageId) { href = `/book/${best.slug || best.id}/page/${ch.pageId}`; chapterPage = ch.pageId; }
    }
    const entry = {
      work: w.work, author: w.author,
      forms: (w.title_forms && w.title_forms.length ? w.title_forms : [w.work]),
      linkable: !!best, href,
      repId: rep.id, repSlug: rep.slug || null, chapterPage,
    };
    for (const ep of w.episodes) (byEp[ep] = byEp[ep] || []).push(entry);
  }

  const candidates = Object.keys(BIB).map(Number).filter(n => BIB[n] && byEp[n] && byEp[n].some(e => e.linkable)).sort((a, b) => a - b);
  const items = LIMIT ? candidates.slice(0, LIMIT) : candidates;
  console.log(`  ${items.length} episodes with a displayed bibliography + ≥1 held+readable cited work`);

  const linked = {};
  const supplementary = {}; // ep → representative book ids of held works NOT linked inline
  let okCount = 0, skipCount = 0, linkTotal = 0, done = 0;
  await mapPool(items, 5, async (ep) => {
    if (HAND_CURATED.has(ep) && HAND[ep]) { linked[ep] = HAND[ep]; okCount++; done++; return; }
    const r = await injectLinks(BIB[ep], byEp[ep].filter(e => e.linkable));
    if (r) {
      linked[ep] = r.text; okCount++; linkTotal += r.count;
      // works whose representative edition wasn't linked inline still need a path →
      // emit them as supplementary cards so a held work mentioned only in a dated
      // citation (e.g. Eunapius' Lives of the Sophists via the 1922 Loeb) stays reachable.
      // bare slug/id of each inline target (strip any /page/<id> suffix) so page-precise
      // inline links still dedupe against the supplementary cards
      const targets = new Set([...r.text.matchAll(/\/book\/([^)/]+)/g)].map(m => m[1]));
      const seen = new Set();
      const supp = [];
      for (const e of byEp[ep]) {
        if (targets.has(e.repSlug) || targets.has(e.repId) || seen.has(e.repId)) continue;
        seen.add(e.repId);
        supp.push(e.chapterPage ? { id: e.repId, page: e.chapterPage } : { id: e.repId });
      }
      if (supp.length) supplementary[ep] = supp;
    } else skipCount++;
    done++; if (done % 25 === 0) console.log(`  ${done}/${items.length}`);
  });
  // ensure hand-curated episodes are always present even if not auto-eligible
  for (const ep of HAND_CURATED) if (HAND[ep] && !linked[ep]) linked[ep] = HAND[ep];

  const sorted = Object.keys(linked).map(Number).sort((a, b) => a - b);
  let out = `/**
 * Inline-linked SHWEP reading lists for the Reading Room. Earl Fontainelle's
 * bibliography with the historical works WE HOLD (visible + translated) turned into
 * inline /book/ "read here" links at the cited-work mentions. Episodes here render
 * inline instead of the separate "Read in Source Library" list.
 *
 * Episodes 76 and 323 are HAND-CURATED (the quality bar) and preserved verbatim.
 * All others are auto-generated by scripts/enrichment/shwep-cited-works.mjs
 * (${MODEL}, process matcher): the LLM only locates each held work's mention; the link
 * is spliced into the original bibliography text, so it stays verbatim apart from the
 * added markup. Do not edit by hand — re-run \`--linkbib\` instead.
 */
export const SHWEP_LINKED_BIBLIOGRAPHIES: Record<number, string> = {\n`;
  for (const ep of sorted) out += `  ${ep}: ${JSON.stringify(linked[ep])},\n`;
  out += `};\n`;
  fs.writeFileSync(path.join(DATA_DIR, 'shwep-linked-bibliographies.ts'), out);

  // supplementary held works per inline-linked episode (held but not reachable via an
  // inline link — so the reader page can still surface them as "more in the library"
  // cards instead of hiding the whole held-works grid behind the linked bibliography).
  const suppSorted = Object.keys(supplementary).map(Number).sort((a, b) => a - b);
  let so = `/**
 * Held primary sources for an inline-linked SHWEP episode that are NOT reachable via an
 * inline /book/ link (their only mention sits in a dated edition citation, or they aren't
 * named in the bibliography text at all). One representative edition per held work; \`page\`
 * is the chapter pageId when the work is a PART of a collected edition (deep-link straight
 * to that treatise). The reader page shows these as a "more from this episode in the
 * library" grid beneath the inline-linked bibliography, so no held work is hidden.
 * Generated by scripts/enrichment/shwep-cited-works.mjs. Do not edit by hand.
 */
export interface ShwepSupplementaryWork { id: string; page?: string }
export const SHWEP_SUPPLEMENTARY_WORKS: Record<number, ShwepSupplementaryWork[]> = {\n`;
  for (const ep of suppSorted) so += `  ${ep}: ${JSON.stringify(supplementary[ep])},\n`;
  so += `};\n`;
  fs.writeFileSync(path.join(DATA_DIR, 'shwep-supplementary-works.ts'), so);

  const suppTotal = suppSorted.reduce((s, e) => s + supplementary[e].length, 0);
  console.log(`  → ${sorted.length} episodes linked (${okCount} matched, ${skipCount} no-link/skipped); ${linkTotal} inline links inserted`);
  console.log(`  → ${suppSorted.length} linked episodes carry ${suppTotal} supplementary held works (kept reachable as cards)`);
}

// ── Stage 6: gap audit (full-catalog, read-only) ─────────────────────────────
// The main matcher retrieves over the VISIBLE + embedded catalog only, so its
// "acquire" list conflates two very different things: works we genuinely don't own,
// and works we DO own but that are hidden/unprocessed (no translation yet → not in the
// embedding index → invisible to retrieval). This stage re-checks each currently-"acquire"
// work LEXICALLY against the FULL Mongo catalog (incl. hidden/draft/untranslated), confirms
// with the same flash-lite judge, and splits the gap into three honest buckets:
//   held_readable    — we missed a visible+translated edition (recall bonus → should link)
//   held_unprocessed — we own it but it's hidden and/or untranslated (publish/process queue)
//   absent           — genuinely not in the catalog (acquire)
// Read-only: writes /tmp/shwep-cited/gap-audit.{json,md}; touches no .ts data files.
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
async function stageGapAudit() {
  console.log('Stage 6 GAP AUDIT (full catalog, read-only)');
  const works = readJSON('works-held.json', []);
  applyAuthorGuard(works);
  const acquire = works.filter(w => !(w.held || []).length && (w.status || 'extant') !== 'lost');
  const items = LIMIT ? acquire.slice(0, LIMIT) : acquire;
  console.log(`  re-checking ${items.length} "acquire" works against the full catalog…`);
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const PROJ = { display_title: 1, title: 1, author: 1, year: 1, language: 1, slug: 1, visible: 1, status: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, pages_blank: 1 };

  let done = 0;
  const out = await mapPool(items, 6, async (w) => {
    const forms = (w.title_forms && w.title_forms.length ? w.title_forms : [w.work]).slice(0, 6);
    const author = w.author || '';
    // lexical retrieval over the FULL catalog (no visible filter) — title forms (≥4 chars) ∪ author
    const titleRx = forms.filter(f => f && f.length >= 4).map(reEsc).join('|');
    const orClauses = [];
    if (titleRx) { orClauses.push({ title: { $regex: titleRx, $options: 'i' } }, { display_title: { $regex: titleRx, $options: 'i' } }); }
    const authToks = !/anonymous|various|unknown|attributed/i.test(author) ? authTokens(author).filter(t => t.length >= 4) : [];
    let rows = orClauses.length ? await db.collection('books').find({ $or: orClauses, pages_count: { $gt: 0 } }, { projection: PROJ }).limit(25).toArray() : [];
    // narrow to author-plausible when we have an author (keeps confirm prompt focused)
    if (authToks.length) { const a = rows.filter(r => { const bt = new Set(authTokens(r.author || '')); return authToks.some(t => bt.has(t)); }); if (a.length) rows = a; }
    rows = rows.filter(r => !EXCLUDE_LANGS.has(r.language)).slice(0, 16);
    if (!rows.length) { done++; if (done % 25 === 0) console.log(`  ${done}/${items.length}`); return { work: w.work, author, era: w.era, episodes: w.episodes, bucket: 'absent', evidence: [] }; }
    let picks = [];
    try { picks = (await gemini(confirmPrompt(forms, author, rows), 2048)).matches || []; } catch {}
    const matched = picks.map(p => rows[p]).filter(Boolean);
    // reader-facing cut: a "recall miss" is held + readable + VISIBLE (link-eligible now);
    // anything owned but hidden or untranslated is the publish/process queue. (Ownership-only
    // status — visibility-agnostic — is holdingStatus() in the shared lib, for #2453.)
    const linkable = matched.filter(m => editionReadable(m) && editionVisible(m));
    const ownedUnready = matched.filter(m => !(editionReadable(m) && editionVisible(m)));
    const bucket = linkable.length ? 'held_readable' : ownedUnready.length ? 'held_unprocessed' : 'absent';
    const evidence = (linkable.length ? linkable : ownedUnready).slice(0, 3).map(m => ({
      slug: m.slug, title: (m.display_title || m.title || '').slice(0, 50), visible: !!m.visible,
      tr: m.pages_translated || 0, pc: m.pages_count || 0, lang: m.language || '',
    }));
    done++; if (done % 25 === 0) console.log(`  ${done}/${items.length}`);
    return { work: w.work, author, era: w.era, episodes: w.episodes, bucket, evidence };
  });
  await client.close();

  const by = b => out.filter(x => x.bucket === b).sort((a, c) => c.episodes.length - a.episodes.length);
  const readable = by('held_readable'), unproc = by('held_unprocessed'), absent = by('absent');
  writeJSON('gap-audit.json', { generated: 'shwep-cited-works.mjs --gap-audit', held_readable: readable, held_unprocessed: unproc, absent });
  let md = `# SHWEP gap audit — the matcher's "acquire" list, re-checked against the FULL catalog\n\n`;
  md += `Of ${items.length} works the visible-only matcher called "acquire": **${readable.length} are actually held & readable** (recall miss — should link), **${unproc.length} we own but hidden/unprocessed** (publish/process), **${absent.length} genuinely absent** (acquire).\n\n`;
  for (const [title, set] of [['Held & readable (matcher missed — fix recall)', readable], ['Held but hidden/unprocessed (publish or process)', unproc], ['Genuinely absent (acquire)', absent]]) {
    md += `## ${title} — ${set.length}\n\n| Work | Author | Eps | Evidence |\n|---|---|---|---|\n`;
    for (const x of set) md += `| ${x.work} | ${x.author} | ${x.episodes.length} | ${x.evidence.map(e => `${e.slug || '?'} (${e.visible ? 'vis' : 'hid'}, tr${e.tr}/${e.pc})`).join('; ') || '—'} |\n`;
    md += `\n`;
  }
  fs.writeFileSync(path.join(CACHE, 'gap-audit.md'), md);
  console.log(`  → held_readable ${readable.length} | held_unprocessed ${unproc.length} | absent ${absent.length}`);
  console.log(`  → ${path.join(CACHE, 'gap-audit.md')}`);
}

// ── main ─────────────────────────────────────────────────────────────────────

(async () => {
  if (want('--extract')) { let eps = loadEpisodes(); if (LIMIT) eps = eps.slice(0, LIMIT); await stageExtract(eps); }
  if (want('--dedupe')) await stageDedupe();
  if (want('--holdings')) await stageHoldings();
  if (want('--emit')) await stageEmit();
  if (want('--linkbib')) await stageLinkBib();
  if (args.includes('--gap-audit')) await stageGapAudit();
  if (!args.length) console.log('Specify --extract | --dedupe | --holdings | --emit | --linkbib | --gap-audit | --all');
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
