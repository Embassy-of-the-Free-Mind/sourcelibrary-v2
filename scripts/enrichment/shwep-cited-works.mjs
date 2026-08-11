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
 *   node scripts/enrichment/shwep-cited-works.mjs --cluster-expand   # work_id-sibling recall (#3887)
 *   node scripts/enrichment/shwep-cited-works.mjs --gap-audit        # full-catalog lexical recall net
 *   node scripts/enrichment/shwep-cited-works.mjs --apply-recall     # fold confirmed gap hits into holdings
 *   node scripts/enrichment/shwep-cited-works.mjs --work-id-audit    # dupe rows + matcher-vs-work_id contradictions
 *   node scripts/enrichment/shwep-cited-works.mjs --emit
 *   node scripts/enrichment/shwep-cited-works.mjs --linkbib
 *   node scripts/enrichment/shwep-cited-works.mjs --all      # all of the above, in sequence —
 *                     the recall + audit passes are STANDING parts of every refresh (#3887)
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

// Ranking context for bestEdition (#3888): the work's composition language and the
// edition Earl's citation names, per episode. Both optional — absent files or keys
// degrade to the legacy ranking. Loaded lazily by emit/linkbib.
async function loadRankingContext(dataDir) {
  let langs = {}, quotes = {};
  try { langs = (await import(path.join(dataDir, 'shwep-work-languages.ts'))).SHWEP_WORK_LANGUAGES || {}; } catch {}
  try { quotes = (await import(path.join(dataDir, 'shwep-earl-quotes.ts'))).SHWEP_EARL_QUOTES || {}; } catch {}
  return { langs, quotes };
}

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

// A work that appears ONLY in Secondary-literature sections (per each reading list's
// own headings) and is never cited via a specific edition is the title-similarity trap
// shape: both 2026-08-11 false positives — "Poimandres" extracted from Reitzenstein's
// monograph, "Nonnos Mythographos" via Cumont 1896 — were Secondary-section artifacts.
// Such a work stays in the works DB (flagged needs_review) but gets no reader card or
// inline link until a human confirms it. Extracts predating the sec field are treated
// as primary (flag absent), so behavior is unchanged until the next --extract run.
const needsSecondaryReview = w => w.secondary_only === true && w.edition_cited !== true;

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

For each work give "work" (canonical English title of the historical work), "author" (canonical historical author, or "Anonymous"), "era" (Ancient Near Eastern / Classical Greek / Hellenistic / Roman / Late Antique / Medieval / Byzantine / Islamicate / Renaissance / Early Modern), plus two provenance fields:
- "sec": which part of the reading list the citation sits in, going by the list's OWN section headings: "P" if under a primary-sources/texts/editions heading, "S" if under a secondary-literature/studies heading, "U" if the list has no such sectioning or it is unclear.
- "ed_cite": true if the entry cites a SPECIFIC edition/translation of this work (an editor or translator is named for IT), false if the work is only named inside the title or description of a modern study ABOUT it. A work mentioned only in passing inside secondary literature ("Reitzenstein, Poimandres") is ed_cite false.

Return ONLY JSON: {"<episodeNumber>":[{"work","author","era","sec","ed_cite"},...]} — empty list if none.

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
  // collect raw works with episode refs (+ Primary/Secondary provenance, #3887)
  const raw = [];
  for (const [ep, works] of Object.entries(extracted)) for (const w of works) raw.push({ ep: +ep, work: w.work, author: w.author, era: w.era, sec: w.sec, ed_cite: w.ed_cite });
  // first pass: deterministic merge on normalized author+work. A work is
  // secondary_only when EVERY appearance sits in a Secondary-literature section
  // (per the list's own headings); edition_cited when ANY appearance names a
  // specific edition of it. Extracts predating the sec field count as primary.
  const byKey = new Map();
  for (const r of raw) {
    const key = `${norm(r.author)}|${norm(r.work)}`;
    if (!byKey.has(key)) byKey.set(key, { work: r.work, author: r.author, era: r.era, episodes: new Set(), allSecondary: true, anyEdCite: false });
    const e = byKey.get(key);
    e.episodes.add(r.ep);
    if (r.sec !== 'S') e.allSecondary = false;
    if (r.ed_cite === true) e.anyEdCite = true;
  }
  let works = [...byKey.values()].map(w => ({
    work: w.work, author: w.author, era: w.era,
    episodes: [...w.episodes].sort((a, b) => a - b),
    secondary_only: w.allSecondary, edition_cited: w.anyEdCite,
  }));
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
      return {
        work: g.canonical_work, author: g.canonical_author, era,
        episodes: [...eps].sort((a, b) => a - b),
        secondary_only: members.every(i => works[i].secondary_only === true),
        edition_cited: members.some(i => works[i].edition_cited === true),
      };
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
      work_id: b.work_id || null,
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
    ...(needsSecondaryReview(w) ? { needs_review: true } : {}),
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
  /** Appears only in Secondary-literature sections with no edition citation — kept in
   *  the DB but excluded from reader cards/links until a human confirms it (#3887). */
  needs_review?: boolean;
  held: ShwepCitedHolding[];
}
export const SHWEP_CITED_WORKS: ShwepCitedWork[] = ${JSON.stringify(dbRows, null, 2)};
`;
  fs.writeFileSync(path.join(DATA_DIR, 'shwep-cited-works.ts'), ts);

  // 4b — per-episode held works (the "Read in Source Library" grid) → shwep-book-matches.ts.
  // WORK-centric: one card per cited held work (its bestEdition), not one per edition — so a
  // common text doesn't flood the page with copies. When the best edition is a collected
  // volume and the work matches a chapter, carry that chapter's pageId so the grid card
  // deep-links to the PART (the treatise), mirroring the inline/supplementary links.
  const allHeldIds2 = [...new Set(works.flatMap(w => (w.heldMeta || []).map(m => m.id)))];
  const pcById2 = new Map(), chaptersById2 = new Map();
  if (allHeldIds2.length) {
    const client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    const rows = await client.db('bookstore').collection('books').find(
      { _id: { $in: allHeldIds2.map(i => { try { return new ObjectId(i); } catch { return null; } }).filter(Boolean) } },
      { projection: { pages_count: 1, chapters: 1 } }).toArray();
    await client.close();
    for (const r of rows) { pcById2.set(r._id.toString(), r.pages_count || 0); chaptersById2.set(r._id.toString(), r.chapters || []); }
    for (const w of works) for (const m of (w.heldMeta || [])) m.pages_count = pcById2.get(m.id) || m.pages_count || 0;
  }
  // Edition choice is per (work, EPISODE): when Earl's citation for this episode
  // names an edition we hold (citedEdition), that edition is the card — the McCown
  // Testament of Solomon on ep 326 by design, not by coincidence of translation
  // counts (#3888). workLanguage lets role/authority rank within a completeness tier.
  const { langs, quotes } = await loadRankingContext(DATA_DIR);
  const perEp = {};
  for (const w of works) {
    if (!w.held.length || needsSecondaryReview(w)) continue;
    const workLanguage = langs[`${w.author}|${w.work}`];
    for (const ep of w.episodes) {
      const citedEdition = quotes[`${ep}|${w.author}|${w.work}`]?.citedEdition;
      const best = bestEdition(w.heldMeta, { workLanguage, citedEdition, workAuthor: w.author, workTitle: w.work })
        || (w.heldMeta || [])[0];
      if (!best) continue;
      let page = null;
      if (isCollected(best)) { const ch = chapterMatch(w.title_forms || [w.work], chaptersById2.get(best.id)); if (ch && ch.pageId) page = ch.pageId; }
      if (!page) page = HAND_PAGE_LINKS[`${ep}|${best.id}`] || null;
      const card = page ? { id: best.id, page } : { id: best.id };
      perEp[ep] = perEp[ep] || new Map();
      if (!perEp[ep].has(best.id)) perEp[ep].set(best.id, card);
    }
  }
  const matchSorted = Object.entries(perEp).map(([ep, m]) => [+ep, [...m.values()]]).sort((a, b) => a[0] - b[0]);
  let mt = `/**
 * Held primary sources per SHWEP episode — the works Earl cites that we hold, shown as the
 * "Read in Source Library" grid. WORK-centric (one representative edition per cited work);
 * \`page\` is the chapter pageId when the work is a PART of a collected edition (deep-link to
 * the treatise). Derived from src/data/shwep-cited-works.ts by
 * scripts/enrichment/shwep-cited-works.mjs. Do not edit by hand.
 */
export interface ShwepBookMatch { id: string; page?: string }
export const SHWEP_BOOK_MATCHES: Record<number, ShwepBookMatch[]> = {\n`;
  for (const [ep, cards] of matchSorted) mt += `  ${ep}: ${JSON.stringify(cards)},\n`;
  mt += `};\n`;
  fs.writeFileSync(path.join(DATA_DIR, 'shwep-book-matches.ts'), mt);

  // 4c — acquisition gap report (primary sources we lack, most-cited first)
  const gap = works.filter(w => !w.held.length).sort((a, b) => b.episodes.length - a.episodes.length);
  let md = `# SHWEP cited primary sources we don't yet hold\n\n${gap.length} works, ordered by how many episodes cite them.\n\n`;
  md += `| Work | Author | Era | Episodes |\n|---|---|---|---|\n`;
  for (const w of gap) md += `| ${w.work} | ${w.author} | ${w.era} | ${w.episodes.length} (${w.episodes.slice(0, 8).join(', ')}${w.episodes.length > 8 ? '…' : ''}) |\n`;
  fs.writeFileSync(path.join(CACHE, 'acquire.md'), md);

  // 4d — Secondary-section works held back from cards/links pending human review
  const review = works.filter(needsSecondaryReview);
  if (review.length) {
    let rmd = `# Secondary-section works needing review (#3887)\n\nThese appear ONLY in Secondary-literature sections and are never cited via a specific edition — the title-similarity-trap shape. Confirm each against the actual citation before granting it a card.\n\n| Work | Author | Held | Episodes |\n|---|---|---|---|\n`;
    for (const w of review) rmd += `| ${w.work} | ${w.author} | ${w.held.length ? 'yes' : 'no'} | ${w.episodes.slice(0, 8).join(', ')}${w.episodes.length > 8 ? '…' : ''} |\n`;
    fs.writeFileSync(path.join(CACHE, 'secondary-review.md'), rmd);
    console.log(`  secondary-section review: ${review.length} works held back from cards → ${path.join(CACHE, 'secondary-review.md')}`);
  }

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

// Hand-verified chapter deep-links, keyed "episode|bookId" → pageId. These point a
// card at the PART of a volume that carries the cited work (Hygromanteia = Anecdota
// Atheniensia's "Treatise on Magic" chapter; Testament of Adam in Syriac Patrology
// I.2; etc. — 2026-08-10 audit and earlier curation). chapterMatch cannot derive
// them (title-token overlap misses, or the volume title no longer trips the
// collected-edition gate), so emit must consult this map or regeneration silently
// drops them. Applies only when the ranked card IS that book; if a better edition
// outranks the volume, the deep link is moot and the override is skipped.
const HAND_PAGE_LINKS = {
  '25|6a357e822aadc65cf0906d5f': '6a357e822aadc65cf0906d66',
  '60|69ac9c0399d9a0170d090ed2': '69ac9c0399d9a0170d090ede',
  '83|69b2ff225545150b61b46d12': '69b2ff225545150b61b46e9a',
  '97|69ac80931aa2dc787a684edc': '69ac80931aa2dc787a684f0c',
  '116|69a956fa65ddd05bbcd3d7c8': '69a956fa65ddd05bbcd3d8c1',
  '121|69ad747b059a2da73405f323': '69ad747b059a2da73405f3e9',
  '122|69ad747b059a2da73405f323': '69ad747b059a2da73405f3e9',
  '124|6a3f035097e91e1768f69f31': '6a3f035097e91e1768f69f87',
  '128|69ad747b059a2da73405f323': '69ad747b059a2da73405f3e9',
  '129|69ad747b059a2da73405f323': '69ad747b059a2da73405f3e9',
  '132|69ad747b059a2da73405f323': '69ad747b059a2da73405f3e9',
  '217|6a357f112aadc65cf0908511': '6a357f112aadc65cf0908522',
  '266|69a956fa65ddd05bbcd3d7c8': '69a956fa65ddd05bbcd3d8c1',
  '324|6994400f06e186ed6c012a44': '6994400f06e186ed6c012d05',
  '325|6a357f112aadc65cf0908511': '6a357f112aadc65cf0908522',
  '326|6a357f112aadc65cf0908511': '6a357f112aadc65cf0908522',
};

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
  // Edition choice is per (work, EPISODE) — the citation's named edition wins when
  // held, then role/authority via the work's composition language (#3888).
  const { langs, quotes } = await loadRankingContext(DATA_DIR);
  const byEp = {};
  for (const w of works) {
    const meta = w.heldMeta || [];
    if (!meta.length || needsSecondaryReview(w)) continue;
    const workLanguage = langs[`${w.author}|${w.work}`];
    for (const ep of w.episodes) {
      const citedEdition = quotes[`${ep}|${w.author}|${w.work}`]?.citedEdition;
      const best = bestEdition(meta, { workLanguage, citedEdition, workAuthor: w.author, workTitle: w.work });
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
      if (best && !chapterPage) {
        const ov = HAND_PAGE_LINKS[`${ep}|${best.id}`];
        if (ov) { href = `/book/${best.slug || best.id}/page/${ov}`; chapterPage = ov; }
      }
      (byEp[ep] = byEp[ep] || []).push({
        work: w.work, author: w.author,
        forms: (w.title_forms && w.title_forms.length ? w.title_forms : [w.work]),
        linkable: !!best, href,
        repId: rep.id, repSlug: rep.slug || null, chapterPage,
      });
    }
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

/**
 * Accent-folding for lexical retrieval. A Mongo regex is case-insensitive but not
 * accent-insensitive, so an ASCII title form cannot match an accented catalogue title:
 * "Epitre sur la Chrysopee" missed Bidez's "Épître sur la Chrysopée" and the audit
 * reported Psellos' Epistle on Chrysopoeia as absent while we hold it. Expanding each
 * letter to its accented variants makes the two directions meet.
 */
const ACCENTS = {
  a: 'aàáâãäåāăą', c: 'cçćč', e: 'eèéêëēĕėęě', i: 'iìíîïĩīĭ',
  n: 'nñńň', o: 'oòóôõöøōŏ', s: 'sśşš', u: 'uùúûüũūŭ', y: 'yýÿ', z: 'zźżž',
};
const foldRx = s => reEsc(s).replace(/[a-z]/gi, ch => {
  const set = ACCENTS[ch.toLowerCase()];
  return set ? `[${set}]` : ch;
});
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
    const titleRx = forms.filter(f => f && f.length >= 4).map(foldRx).join('|');
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

// Lexical recall safety-net: the embedding+confirm matcher structurally misses works
// the lexical full-catalog gap-audit catches — author-attribution divergence (a work by
// X bound in an edition catalogued under Y, e.g. Lazzarelli's Crater Hermetis in a
// "Hermes Trismegistus" omnibus), series-containment, and books too freshly visible to
// have embeddings yet. This folds the gap-audit's CONFIRMED held_readable hits (same
// flash-lite confirm + author guard, so precision-equivalent) back into works-held.json
// before emit, so those works link instead of being mislabelled "acquire". Read gap-audit
// first (it writes gap-audit.json). Idempotent: only fills works that are still empty.
async function stageApplyRecall() {
  console.log('Stage 6b APPLY-RECALL (fold gap-audit held_readable → holdings)');
  const audit = readJSON('gap-audit.json', null);
  if (!audit || !audit.held_readable) { console.log('  no gap-audit.json — run --gap-audit first; skipping'); return; }
  const works = readJSON('works-held.json', []);
  const byKey = new Map(works.map(w => [`${w.work}|||${w.author}`, w]));
  const recall = audit.held_readable;
  const slugs = [...new Set(recall.flatMap(r => (r.evidence || []).map(e => e.slug)).filter(Boolean))];
  if (!slugs.length) { console.log('  nothing to merge'); return; }
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const docs = await db.collection('books').find({ slug: { $in: slugs }, visible: true, pages_count: { $gt: 0 } },
    { projection: { display_title: 1, title: 1, author: 1, year: 1, language: 1, slug: 1, visible: 1, pages_count: 1, pages_translated: 1, pages_ocr: 1, pages_blank: 1 } }).toArray();
  await client.close();
  const bySlug = new Map(docs.map(d => [d.slug, d]));
  let merged = 0;
  for (const r of recall) {
    const w = byKey.get(`${r.work}|||${r.author}`);
    if (!w) continue;
    const books = (r.evidence || []).map(e => bySlug.get(e.slug)).filter(b => b && editionReadable(b) && editionVisible(b));
    if (!books.length) continue;
    // These are gap-audit LLM-confirmed holdings (full-catalog confirm + author guard). Two
    // recall-loss classes both land here: (a) the matcher found nothing (held empty), and
    // (b) the edition is catalogued under a different author than the work (Crater Hermetis
    // = Lazzarelli, bound in a "Hermes Trismegistus" omnibus) so emit's author guard drops
    // it. Force heldMeta.author = the work's author on these confirmed books only, so the
    // guard keeps them — targeted, precision unaffected for every other work.
    const evMeta = books.map(b => ({
      id: b._id.toString(), slug: b.slug || null, title: b.display_title || b.title || '',
      author: w.author, year: b.year || null, language: b.language || '',
      pages_translated: b.pages_translated || 0, pages_ocr: b.pages_ocr || 0, pages_blank: b.pages_blank || 0,
    }));
    const evIds = new Set(evMeta.map(m => m.id));
    w.heldMeta = [...(w.heldMeta || []).filter(m => !evIds.has(m.id)), ...evMeta];
    w.held = [...new Set([...(w.held || []), ...evMeta.map(m => m.id)])];
    merged++;
  }
  writeJSON('works-held.json', works);
  console.log(`  merged ${merged}/${recall.length} recall hits into holdings → works-held.json`);
}

// ── Stage 6c: cluster-expansion for recall (#3887) ───────────────────────────
// The embedding retrieval ranks sibling editions of a confirmed work poorly (the
// omnibus-recall gap), but once the confirmer has accepted SOME editions of a work,
// their `books.work_id` names the cluster — every other book in those clusters is a
// high-prior candidate. Offer them through the SAME per-candidate confirmer (and the
// emit-time author guard), so recall widens with precision unchanged. Idempotent:
// only candidates not already held are offered. Writes works-held.json in place.
async function stageClusterExpand() {
  console.log('Stage 6c CLUSTER-EXPAND (work_id siblings of confirmed editions)');
  const works = readJSON('works-held.json', []);
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const PROJ = { display_title: 1, title: 1, author: 1, year: 1, language: 1, slug: 1, work_id: 1, pages_translated: 1, pages_ocr: 1, pages_blank: 1 };

  // work_id for every held edition (older works-held.json rows predate heldMeta.work_id)
  const heldIds = [...new Set(works.flatMap(w => (w.heldMeta || []).map(m => m.id)))];
  const heldOids = heldIds.map(i => { try { return new ObjectId(i); } catch { return null; } }).filter(Boolean);
  const widById = new Map();
  if (heldOids.length) {
    const rows = await db.collection('books').find({ _id: { $in: heldOids } }, { projection: { work_id: 1 } }).toArray();
    for (const r of rows) widById.set(r._id.toString(), r.work_id || null);
  }

  const targets = works.filter(w => (w.held || []).length && (w.status || 'extant') !== 'lost');
  let expandedWorks = 0, addedEditions = 0, offered = 0, done = 0;
  await mapPool(targets, 6, async (w) => {
    const have = new Set(w.held);
    const wids = [...new Set((w.heldMeta || []).map(m => m.work_id || widById.get(m.id)).filter(Boolean))];
    done++; if (done % 50 === 0) console.log(`  ${done}/${targets.length}`);
    if (!wids.length) return;
    const sibs = (await db.collection('books').find(
      { work_id: { $in: wids }, visible: true, pages_count: { $gt: 0 } },
      { projection: PROJ }).limit(40).toArray())
      .filter(b => !have.has(b._id.toString()) && !EXCLUDE_LANGS.has(b.language))
      .slice(0, 12);
    if (!sibs.length) return;
    offered += sibs.length;
    const forms = (w.title_forms && w.title_forms.length ? w.title_forms : [w.work]).slice(0, 8);
    let picks = [];
    try { picks = (await gemini(confirmPrompt(forms, w.author, sibs), 2048)).matches || []; }
    catch (e) { console.warn(`  confirm failed [${w.work}]: ${e.message}`); return; }
    const accepted = picks.map(p => sibs[p]).filter(Boolean);
    if (!accepted.length) return;
    for (const b of accepted) {
      const id = b._id.toString();
      w.held.push(id);
      w.heldMeta.push({
        id, slug: b.slug || null, title: b.display_title || b.title || '',
        author: b.author || '', year: b.year || null, language: b.language || '',
        work_id: b.work_id || null,
        pages_translated: b.pages_translated || 0, pages_ocr: b.pages_ocr || 0, pages_blank: b.pages_blank || 0,
      });
    }
    expandedWorks++; addedEditions += accepted.length;
  });
  await client.close();
  writeJSON('works-held.json', works);
  console.log(`  → offered ${offered} cluster siblings; confirmer accepted ${addedEditions} editions across ${expandedWorks} works`);
}

// ── Stage 6d: work_id cross-audit — dupes + contradictions (#3887) ───────────
// The matcher and books.work_id are independent systems; where they disagree, one of
// them is wrong — in BOTH directions in practice (a books-side Laws volume stamped
// plato-republic; a matcher-side Corpus Hermeticum split across two rows). Read-only,
// no LLM: writes /tmp/shwep-cited/work-id-audit.{json,md} for human/agent adjudication.
//   DUPES: two work rows whose held sets share a work_id via NON-collected editions —
//     the rows are almost certainly the same work and should merge (the CH case).
//   CONTRADICTIONS: one work row whose non-collected held editions carry ≥2 distinct
//     work_ids — either a matcher false positive (drop the edition from the row) or a
//     books-side work_id error (fix books.work_id); each needs a judgment, and
//     books-side fixes flow back to the catalog.
async function stageWorkIdAudit() {
  console.log('Stage 6d WORK-ID AUDIT (dupes + contradictions, read-only)');
  const works = readJSON('works-held.json', []);
  applyAuthorGuard(works);
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const heldIds = [...new Set(works.flatMap(w => (w.heldMeta || []).map(m => m.id)))];
  const oids = heldIds.map(i => { try { return new ObjectId(i); } catch { return null; } }).filter(Boolean);
  const widById = new Map();
  if (oids.length) {
    const rows = await client.db('bookstore').collection('books').find(
      { _id: { $in: oids } }, { projection: { work_id: 1 } }).toArray();
    for (const r of rows) widById.set(r._id.toString(), r.work_id || null);
  }
  await client.close();

  // wid → [{wIdx, edition}] over non-collected editions only: a shared omnibus
  // legitimately serves many cited works and proves nothing about row identity.
  // NB even a non-collected volume can legitimately serve several rows (a
  // five-dialogue Plato volume sits in the Phaedo AND Phaedrus rows; a Patrologia
  // volume in every treatise row of its Father) — CONTAINMENT, not duplication.
  // So sharing a wid is only a DUPE signal when the two ROW TITLES read as the
  // same work (the CH split: "Corpus Hermeticum" under two authors), measured by
  // work-title token overlap; everything else is counted as containment.
  const byWid = new Map();
  works.forEach((w, wIdx) => {
    for (const m of (w.heldMeta || [])) {
      const wid = m.work_id || widById.get(m.id);
      if (!wid || isCollected(m)) continue;
      if (!byWid.has(wid)) byWid.set(wid, []);
      byWid.get(wid).push({ wIdx, m, wid });
    }
  });

  const titleOverlap = (a, b) => {
    const ta = new Set(titleToks(a)), tb = new Set(titleToks(b));
    if (!ta.size || !tb.size) return norm(a) === norm(b) ? 1 : 0;
    const inter = [...ta].filter(t => tb.has(t)).length;
    return inter / Math.min(ta.size, tb.size);
  };

  const dupes = [];
  let containment = 0;
  for (const [wid, rows] of byWid) {
    const wIdxs = [...new Set(rows.map(r => r.wIdx))];
    if (wIdxs.length < 2) continue;
    const flagged = [];
    for (let i = 0; i < wIdxs.length; i++) for (let j = i + 1; j < wIdxs.length; j++) {
      const A = works[wIdxs[i]], B = works[wIdxs[j]];
      if (titleOverlap(A.work, B.work) >= 0.6) flagged.push([wIdxs[i], wIdxs[j]]);
      else containment++;
    }
    if (!flagged.length) continue;
    const idxs = [...new Set(flagged.flat())];
    dupes.push({
      work_id: wid,
      rows: idxs.map(i => ({
        work: works[i].work, author: works[i].author, episodes: works[i].episodes,
        editions: rows.filter(r => r.wIdx === i).map(r => ({ slug: r.m.slug, title: r.m.title.slice(0, 60) })),
      })),
    });
  }

  // Contradictions, precision cut: an edition inside row R stamped with the wid
  // that is the MAJORITY id of a DIFFERENT row R' — a genuine cross-assignment
  // (the "Laws Vol. 2 stamped plato-republic" shape), where either the matcher
  // put the edition in the wrong row or books.work_id names the wrong work.
  // Minority wids that are no row's majority are usually multi-work volumes
  // stamped with one member work — counted, detailed in the JSON, not in the md.
  const majorityOf = works.map(w => {
    const counts = new Map();
    for (const m of (w.heldMeta || [])) {
      const wid = m.work_id || widById.get(m.id);
      if (!wid || isCollected(m)) continue;
      counts.set(wid, (counts.get(wid) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  });
  const rowByMajority = new Map();
  majorityOf.forEach((wid, i) => { if (wid && !rowByMajority.has(wid)) rowByMajority.set(wid, i); });

  const cross = [];
  const minor = [];
  works.forEach((w, wIdx) => {
    const maj = majorityOf[wIdx];
    for (const m of (w.heldMeta || [])) {
      const wid = m.work_id || widById.get(m.id);
      if (!wid || isCollected(m) || wid === maj) continue;
      const otherIdx = rowByMajority.get(wid);
      const entry = {
        row: `${w.work} — ${w.author}`, row_majority: maj,
        edition: { slug: m.slug, title: m.title.slice(0, 60) }, edition_work_id: wid,
      };
      if (otherIdx !== undefined && otherIdx !== wIdx) {
        cross.push({ ...entry, work_id_belongs_to: `${works[otherIdx].work} — ${works[otherIdx].author}` });
      } else minor.push(entry);
    }
  });

  writeJSON('work-id-audit.json', { dupes, cross_assignments: cross, minority_wids: minor, containment_pairs: containment });
  let md = `# work_id cross-audit — matcher vs books.work_id (#3887)\n\nNon-collected held editions only. ${containment} row-pairs share a wid via multi-work volumes (containment — suppressed); ${minor.length} minority wids match no other row (mostly multi-work volumes stamped with one member work — see JSON).\n\n`;
  md += `## Merge candidates — ${dupes.length} row pair(s) that read as the SAME work\n\nShared specific work_id + near-identical row titles (the Corpus Hermeticum split shape). Merge the rows (union episodes/holdings) or record why they are genuinely distinct.\n\n`;
  for (const d of dupes) {
    md += `### \`${d.work_id}\`\n`;
    for (const r of d.rows) md += `- **${r.work}** — ${r.author} (eps ${r.episodes.slice(0, 6).join(', ')}${r.episodes.length > 6 ? '…' : ''}): ${r.editions.map(e => e.slug).join(', ')}\n`;
    md += `\n`;
  }
  md += `## Cross-assignments — ${cross.length} edition(s) stamped with ANOTHER row's work_id\n\nEither the matcher put the edition in the wrong row (remove it there) or \`books.work_id\` names the wrong work (fix the catalog). Both classes occurred on 2026-08-10/11; adjudicate each by reading the edition.\n\n`;
  for (const c of cross) {
    md += `- **${c.row}**: \`${c.edition.slug}\` ("${c.edition.title}") is stamped \`${c.edition_work_id}\` = **${c.work_id_belongs_to}** (row majority \`${c.row_majority}\`)\n`;
  }
  fs.writeFileSync(path.join(CACHE, 'work-id-audit.md'), md);
  console.log(`  → ${dupes.length} merge candidates | ${cross.length} cross-assignments | ${minor.length} minority wids (JSON) | ${containment} containment pairs suppressed`);
  console.log(`  → ${path.join(CACHE, 'work-id-audit.md')}`);
}

// ── Stage 7: related holdings for unmatched works (#3887 follow-on) ──────────
// When the cited edition cannot be in the library (in-copyright critical editions —
// Chadwick, des Places, Saffrey-Westerink — or works with no PD edition at all, like
// Sepher ha-Razim), the reader currently hits a dead end: a bare name in the "no copy
// matched" list. This stage finds what we DO hold that genuinely relates to each such
// work — a commentary on it, other works by its author, a volume containing excerpts,
// the same tradition — and emits src/data/shwep-related-works.ts for the episode page.
// Related ≠ edition: candidates the confirmer would accept as editions belong to the
// holdings stages; this classifier is told to REJECT editions and loose topical noise.
const RELATION_KINDS = ['commentary on it', 'by the same author', 'contains excerpts', 'a reply or continuation', 'the same tradition'];
function relatedPrompt(work, author, cands) {
  const list = cands.map((b, j) => `[${j}] "${(b.display_title || b.title || '').slice(0, 90)}" by ${b.author || '?'}${b.year ? ` (${b.year})` : ''} [${b.language || '?'}]`).join('\n');
  return `A reader wants "${work}" by ${author}, which our library does NOT hold in a readable copy.
From the candidate books below (all held and readable), pick AT MOST 3 that a scholar of that work would find genuinely useful as RELATED material, and label each with exactly one relation from: ${JSON.stringify(RELATION_KINDS)}.
Keep ONLY candidates with a real scholarly connection to THIS work: a commentary or study OF it, another work BY its author, a volume containing excerpts or fragments of it, a direct reply/continuation, or a core text of the same specific tradition it belongs to.
REJECT: books that merely share subject keywords; books about the same broad era or religion with no specific tie; and anything that IS an edition or translation of the work itself (those are handled elsewhere — if one appears, something upstream failed; do not select it).
CANDIDATES:
${list}
Return ONLY JSON {"related":[{"i":<index>,"relation":"<one of the allowed labels>"}]} — empty list if nothing qualifies.`;
}

async function stageRelated() {
  console.log('Stage 7 RELATED (holdings adjacent to unmatched cited works)');
  const works = readJSON('works-held.json', []);
  applyAuthorGuard(works);
  const targets = works.filter(w =>
    (w.status || 'extant') !== 'lost' &&
    !needsSecondaryReview(w) &&
    !(w.heldMeta || []).some(m => editionReadable(m)));
  const items = LIMIT ? targets.slice(0, LIMIT) : targets;
  console.log(`  ${items.length} cited works with no readable copy — searching for related holdings…`);
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const PROJ = { display_title: 1, title: 1, author: 1, year: 1, language: 1, slug: 1, pages_translated: 1, pages_count: 1 };

  let done = 0;
  const out = {};
  await mapPool(items, 6, async (w) => {
    const forms = (w.title_forms && w.title_forms.length ? w.title_forms : [w.work]).slice(0, 6);
    const vec = await embed(`${forms.join('; ')} by ${w.author}`);
    done++; if (done % 25 === 0) console.log(`  ${done}/${items.length}`);
    if (!vec) return;
    const { data } = await supabase.rpc('match_books_semantic', { query_embedding: JSON.stringify(vec), match_threshold: 0.2, match_count: 12 });
    const ids = (data || []).map(r => { try { return new ObjectId(r.book_id); } catch { return null; } }).filter(Boolean);
    if (!ids.length) return;
    const have = new Set(w.held || []);
    const rows = (await db.collection('books').find(
      { _id: { $in: ids }, visible: true, pages_count: { $gt: 0 }, pages_translated: { $gt: 0 } },
      { projection: PROJ }).toArray())
      .filter(b => !have.has(b._id.toString()) && !EXCLUDE_LANGS.has(b.language));
    if (!rows.length) return;
    let picks = [];
    try { picks = (await gemini(relatedPrompt(w.work, w.author, rows), 1024)).related || []; } catch { return; }
    const rel = picks
      .filter(p => Number.isInteger(p.i) && rows[p.i] && RELATION_KINDS.includes(p.relation))
      .slice(0, 3)
      .map(p => ({
        id: rows[p.i]._id.toString(), slug: rows[p.i].slug || null,
        title: (rows[p.i].display_title || rows[p.i].title || '').slice(0, 90),
        author: rows[p.i].author || '', year: rows[p.i].year || null,
        relation: p.relation,
      }));
    if (rel.length) out[`${w.author}|${w.work}`] = rel;
  });
  await client.close();

  let ts = `/**
 * Related holdings for cited works we do NOT hold in a readable copy — the cited
 * edition may be in copyright (Chadwick, des Places…) or no PD edition exists at all.
 * Keyed "author|work". At most 3 per work; each carries a one-phrase relation label
 * chosen by the classifier from a fixed set (never free text). Generated by
 * scripts/enrichment/shwep-cited-works.mjs --related (${MODEL}). Do not edit by hand.
 */
export interface ShwepRelatedHolding {
  id: string;
  slug: string | null;
  title: string;
  author: string;
  year: number | null;
  relation: string;
}
export const SHWEP_RELATED_WORKS: Record<string, ShwepRelatedHolding[]> = ${JSON.stringify(out, null, 2)};
`;
  fs.writeFileSync(path.join(DATA_DIR, 'shwep-related-works.ts'), ts);
  const n = Object.keys(out).length, tot = Object.values(out).reduce((s, a) => s + a.length, 0);
  console.log(`  → related holdings for ${n}/${items.length} unmatched works (${tot} links) → shwep-related-works.ts`);
}

// ── main ─────────────────────────────────────────────────────────────────────

(async () => {
  // --all is the reading-room refresh; the recall + audit passes are STANDING parts
  // of it (#3887), not occasional heroics: books too new to have embeddings are
  // invisible to semantic retrieval ("acquire" is a decaying claim in a growing
  // library), and the work_id cross-audit is what catches matcher/catalog drift.
  if (want('--extract')) { let eps = loadEpisodes(); if (LIMIT) eps = eps.slice(0, LIMIT); await stageExtract(eps); }
  if (want('--dedupe')) await stageDedupe();
  if (want('--holdings')) await stageHoldings();
  if (want('--cluster-expand')) await stageClusterExpand();
  if (want('--gap-audit')) await stageGapAudit();
  if (want('--apply-recall')) await stageApplyRecall();
  if (want('--work-id-audit')) await stageWorkIdAudit();
  if (want('--related')) await stageRelated();
  if (want('--emit')) await stageEmit();
  if (want('--linkbib')) await stageLinkBib();
  if (!args.length) console.log('Specify --extract | --dedupe | --holdings | --cluster-expand | --gap-audit | --apply-recall | --work-id-audit | --related | --emit | --linkbib | --all');
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
