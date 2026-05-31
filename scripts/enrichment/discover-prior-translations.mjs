#!/usr/bin/env node
/**
 * discover-prior-translations.mjs  —  GitHub issue #2244
 *
 * Populate `translation_verification.translations_found[]` for first-translation
 * books, surfacing PRIOR published translations the catalog-by-title pipeline
 * misses — especially SECTION / EXCERPT translations published under a different
 * title (e.g. Peter Hauge's *The Temple of Music* (2011) translates one section
 * of Fludd's *Utriusque Cosmi Historia*; a title search for the Latin work never
 * finds it).
 *
 * WHY THIS IS A NEW SCRIPT (not the existing discovery pass):
 *   `discover-translations-estimate.mjs` + `apply-discovery-results.mjs` ask a
 *   generic "does any English translation exist?" and write `validated_translations`
 *   tagged `evidence_source: 'gemini_grounding_discovery'` WITHOUT catalog
 *   verification. #2244 requires the opposite discipline:
 *     - prompt specifically for section/excerpt translations under any title;
 *     - cross-check every LLM claim against a real catalog (Open Library /
 *       Google Books / Internet Archive) to obtain a RESOLVABLE url + catalog_id;
 *     - only catalog-resolved entries go to `translations_found` (the rendered
 *       field) and `validated_translations` (Path A);
 *     - unresolved LLM-only claims go to `llm_knowledge_translations` (Path B),
 *       NEVER promoted, never rendered as fact.
 *
 * GUARDRAILS (issue #2244):
 *   - Do not fabricate. Every entry written to translations_found has a url that
 *     resolved (HTTP 200 / catalog hit). LLM-only claims are segregated.
 *   - A prior PARTIAL/EXCERPT translation does NOT invalidate a first-COMPLETE
 *     claim — it makes it more precise. We surface it without touching the flag.
 *   - A prior COMPLETE translation is a conflict: we DO NOT silently flip
 *     is_first_translation. We record `first_translation_conflict` for human
 *     review and report it.
 *   - Reuses the TranslationEvidence shape (src/lib/types/book.ts); no new fields
 *     on the rendered path.
 *
 * MODES:
 *   --dry-run (default)  build proposals, cross-check catalogs, write a JSON +
 *                        text report to scripts/output/. NO database writes.
 *   --apply              additionally write translations_found / validated_/
 *                        llm_knowledge_translations and conflict flags to Mongo.
 *
 * SELECTION:
 *   --limit N            cap candidates (default 25 in dry-run).
 *   --author "Fludd"     restrict to author substring (priority-2 named authors).
 *   --book-id ID         single book.
 *   --min-disposition    default targets the first_* / confirmed_first family.
 *   --force              re-process books already stamped this run-flag.
 *
 * USAGE:
 *   set -a; source .env.production.local; set +a
 *   node scripts/enrichment/discover-prior-translations.mjs --dry-run --limit 8
 *   node scripts/enrichment/discover-prior-translations.mjs --author "Fludd" --dry-run
 *   node scripts/enrichment/discover-prior-translations.mjs --apply --limit 50
 *
 * COST: ~$0.014/book (Gemini 3.1 Flash Lite + Google Search grounding) plus free
 *       catalog lookups. Idempotent via translation_verification.<RUN_FLAG>.
 */

import { GoogleGenAI } from '@google/genai';
import { MongoClient } from 'mongodb';
import fs from 'fs';

// ── Config ──────────────────────────────────────────────────────────
const MODEL = 'gemini-3.1-flash-lite'; // per CLAUDE.md AI-models policy; -preview suffix is retired
const CONCURRENCY = 4;     // ~1 inflight per API key (4 keys, round-robin); retries+no-grounding fallback absorb throttle
const DELAY_MS = 800;
const MAX_RETRIES = 4;     // also retried when a grounded call returns empty/blocked text
const RUN_FLAG = 'prior_translations_2026_05_31'; // idempotency / reversibility marker
const FIRST_FAMILY = [
  'confirmed_first',
  'first_complete_translation',
  'first_modern_translation',
  'first_from_source',
  'first_translation',
];

// ── Env + keys (matches sibling enrichment scripts) ─────────────────
function loadEnv() {
  const env = {};
  for (const file of ['.env.production.local', '.env.local']) {
    try {
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const m = line.match(/^([^=#]+)=(.*)$/);
        if (m) {
          let v = m[2].trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
          env[m[1].trim()] = v;
        }
      }
      break;
    } catch {}
  }
  return { ...process.env, ...env };
}
const env = loadEnv();
if (!env.MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

function getApiKeys() {
  const keys = [];
  if (env.GEMINI_API_KEY) keys.push(env.GEMINI_API_KEY);
  for (let i = 2; i <= 10; i++) if (env[`GEMINI_API_KEY_${i}`]) keys.push(env[`GEMINI_API_KEY_${i}`]);
  if (env.GEMINI_API_KEY_TIER3) keys.push(env.GEMINI_API_KEY_TIER3);
  return keys.filter(Boolean);
}
const apiKeys = getApiKeys();
if (apiKeys.length === 0) { console.error('No GEMINI_API_KEY found'); process.exit(1); }
let keyIdx = 0;
const nextKey = () => apiKeys[keyIdx++ % apiKeys.length];

// ── CLI ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const FORCE = args.includes('--force');
const getArg = (n) => { const i = args.indexOf(n); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; };
const LIMIT = getArg('--limit') ? parseInt(getArg('--limit')) : (APPLY ? 200 : 25);
const AUTHOR = getArg('--author');
const BOOK_ID = getArg('--book-id');
// --apply-report <dir|file>: write the EXACT vetted entries from a prior dry-run's
// JSON report(s) — decouples writing from a fresh (non-deterministic) discovery pass,
// so what lands in production is precisely what was QC'd. Reads a single report.json
// or a directory of per-author <name>.json files. #2244
const APPLY_REPORT = getArg('--apply-report');

// ── Translator-author / compilation detection ───────────────────────
// The QC trap (#2244): when the BOOK is itself a translation or a multi-author
// compilation — e.g. Ficino's *Latin* rendering of Plato, a Dee-annotated alchemical
// manuscript, a "Various"-author miscellany — asking for "earlier translations of this
// work" wrongly surfaces independent English translations of the underlying SOURCE
// (English Plato from Greek) rather than translations of THIS specific edition. We
// detect these and switch to a stricter prompt that excludes source translations.
function isCompilationOrTranslation(book) {
  const a = (book.author || '').trim();
  if (/translat|\btrans\.|\bvarious\b|annotated by|compiled by|\(ed\.|\bedited by\b/i.test(a)) return true;
  if (a.split(/[;|]/).filter((p) => p.trim()).length >= 2) return true; // semicolon/pipe = multiple contributors
  // Title-level compilation signals — anthologies/collections whose author field is a
  // single editor slip past the author check (e.g. Richebourg's "Bibliothèque des
  // philosophes chimiques", classic alchemical theatrums/musaeums). #2244
  const t = book.display_title || book.title || '';
  return /biblioth[eèé]\w*|theatrum chem|theatrum chym|musaeum|opera omnia|\bfragmente der\b|florilegi|deliciae|anthologi|\bcollected works\b|\bcollection of\b/i.test(t);
}

// ── Discovery prompt — tuned for section/excerpt translations ────────
function buildPrompt(book) {
  const author = (book.author || '').replace(/\s+/g, ' ').trim();
  const title = book.display_title || book.title || '';
  const lang = book.language || 'its original language';
  const year = book.published || book.year || '';
  const guarded = isCompilationOrTranslation(book);
  const head = guarded
    ? `You are a bibliographer crediting prior scholarship. The work below is ITSELF a translation, edition, compilation, or annotated manuscript — NOT an original composition.

WORK: "${title}"${year ? ` (${year})` : ''}, attributed in our catalog as: ${author}. Original language of THIS edition: ${lang}.

CRITICAL SCOPING — only report a translation if it is a prior English translation of THIS SPECIFIC work/edition/compilation, i.e. someone translated THIS text (this exact compilation/miscellany, this author's own commentary, or this very translation/edition).

DO NOT report independent English translations of the underlying classical SOURCE made from its original language. Example of what to EXCLUDE: if this work is Ficino's Latin translation of Plato, do NOT list English translations of Plato made from the Greek (Jowett, Spens, Sydenham, etc.) — those are not translations of THIS work. The same applies to Plotinus, the Hermetica, Iamblichus, Synesius, etc. translated from their original tongues.
If the only English versions are translations of the source from its original language, return an empty list.`
    : `You are a bibliographer hunting for EARLIER PUBLISHED ENGLISH TRANSLATIONS of a historical work, to credit prior scholarship.

WORK: "${title}"${year ? ` (${year})` : ''} by ${author}, originally in ${lang}.

CRITICAL: do not only look for a full translation under the same title. The most-missed cases are:
  1. SECTION translations — one part of the work translated and published under a DIFFERENT title. (Example pattern: a section of Fludd's "Utriusque Cosmi Historia" was published as "The Temple of Music" by Peter Hauge, 2011.)
  2. EXCERPT translations inside anthologies, readers, or scholarly monographs (e.g. Godwin, Huffman, Faivre collections).
  3. Full or near-complete modern translations.`;
  return `${head}

Search library catalogs (HathiTrust, Open Library, WorldCat, Internet Archive), university presses (Brill, Cambridge, Oxford, Harvard, Yale, Penn State, SUNY), and scholarly bibliographies.

Be rigorous and skeptical. Distinguish a genuine English TRANSLATION from: a critical edition of the original-language text, a scholarly study/commentary that merely quotes the work, or a translation of a DIFFERENT work by the same author. Report only translations you have real evidence for.

Respond JSON only:
{
  "translations": [
    {
      "english_title": "exact published English title",
      "translator": "translator name(s)",
      "pub_year": "YYYY",
      "publisher": "publisher",
      "isbn": "ISBN if known, else null",
      "completeness": "complete" | "partial" | "excerpts",
      "section_translated": "which part/section, if partial/excerpts (else null)",
      "confidence": "high" | "medium" | "low",
      "notes": "one phrase describing scope, e.g. 'facing-page translation of the Templum Musicae section'"
    }
  ],
  "found_complete_prior_translation": true | false,
  "reasoning": "1-2 sentences on what the search established"
}
If you find nothing credible, return {"translations": [], "found_complete_prior_translation": false, "reasoning": "..."}.`;
}

function tryParse(text) {
  // Grab the largest {...} span (handles prose/fences around the JSON object).
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/\{[\s\S]*\}/);
  try { return JSON.parse((m ? m[1] || m[0] : text).trim()); } catch { return null; }
}

async function callDiscovery(book) {
  let resp, text = '', cand, parsed = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const ai = new GoogleGenAI({ apiKey: nextKey() });
      // gemini-3.1-flash-lite is a thinking model. WITH googleSearch grounding it
      // intermittently emits a TRUNCATED answer (`{ "translations":` then STOP, ~19
      // chars). For most books it's non-deterministic and a retry clears it; for SOME
      // (esp. sparse catalog records) it's deterministic at temp 0.1, so identical
      // retries truncate forever. So we ESCALATE: bump temperature to break the
      // deterministic path, and on the final attempt DROP grounding entirely — a
      // no-grounding call never truncates, and this script verifies every claim against
      // catalog APIs itself, so grounding is recall-only, not load-bearing. #2244.
      const lastAttempt = attempt === MAX_RETRIES;
      const config = {
        temperature: attempt === 0 ? 0.1 : 0.4,
        thinkingConfig: { thinkingBudget: -1 }, // dynamic; a FIXED budget (0/2048) reliably truncates
      };
      if (!lastAttempt) config.tools = [{ googleSearch: {} }];
      resp = await ai.models.generateContent({ model: MODEL, contents: buildPrompt(book), config });
      cand = resp.candidates?.[0];
      // Thinking-capable models + grounding can leave resp.text empty while the
      // answer sits in non-"thought" content parts — gather both, prefer resp.text.
      const partText = (cand?.content?.parts || []).filter((p) => p && p.text && !p.thought).map((p) => p.text).join('\n');
      text = (resp.text && resp.text.trim()) ? resp.text : partText;
      parsed = tryParse(text);
      // Success requires PARSEABLE JSON. The intermittent truncation returns a 200
      // with finishReason:STOP and a non-empty-but-invalid body — so checking only
      // for non-empty text (the old bug) treated a truncated `{ "translations":` as
      // success. Retry until the body actually parses or we exhaust attempts.
      if (parsed) break;
      try { fs.appendFileSync('/tmp/disc-debug.log', `\n--- ${book.id} attempt=${attempt} finishReason=${cand?.finishReason} textlen=${text.length}\n${text.slice(0, 300)}\n`); } catch {}
      if (attempt < MAX_RETRIES) { await new Promise((r) => setTimeout(r, (attempt + 1) * 2500)); continue; }
    } catch (err) {
      if (attempt < MAX_RETRIES && /fetch failed|ECONNRESET|timeout|429|503|RESOURCE_EXHAUSTED|UNAVAILABLE/.test(err.message)) {
        await new Promise((r) => setTimeout(r, (attempt + 1) * 2500));
        continue;
      }
      throw err;
    }
  }
  const grounding = cand?.groundingMetadata;
  const groundingUrls = (grounding?.groundingChunks || []).filter((c) => c.web?.uri).map((c) => c.web.uri);
  const tokens = { input: resp?.usageMetadata?.promptTokenCount || 0, output: resp?.usageMetadata?.candidatesTokenCount || 0 };
  if (!parsed) {
    return { error: 'parse_failed', raw: text.slice(0, 500), finishReason: cand?.finishReason, groundingUrls, tokens };
  }
  return { ...parsed, groundingUrls, tokens };
}

// ── Catalog cross-check → resolvable URL + catalog_id ───────────────
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
function titleOverlap(a, b) {
  const A = new Set(norm(a).split(' ').filter((w) => w.length > 2));
  const B = new Set(norm(b).split(' ').filter((w) => w.length > 2));
  if (!A.size || !B.size) return 0;
  let hit = 0; for (const w of A) if (B.has(w)) hit++;
  return hit / A.size;
}
const yearClose = (a, b, tol = 3) => { const x = parseInt(a), y = parseInt(b); return !x || !y ? true : Math.abs(x - y) <= tol; };
// Acceptance predicate shared by all catalog matchers. The hazard with short titles:
// "The Temple of Music" forward-matches "Songs of the temple ... sacred music" (1831)
// at overlap 1.0 — a totally different book. A URL pointing at the wrong record is
// worse than no URL (it's the fabrication #2244 forbids). So we require BOTH:
//   - forward overlap (claim words present in the catalog title), AND
//   - reverse overlap (the catalog title isn't bloated with unrelated content words).
// Catalog years are unreliable (OL records Hauge's 2011 "Temple of Music" as a 2017
// reprint), so when both years are present we allow a wide ±8 window — which still
// rejects the 1831/1867 false positives. When a year is MISSING we can't lean on it,
// so we demand a much tighter two-way title match instead. #2244
function catalogAccepts(claimTitle, claimYear, catTitle, catYear) {
  const fwd = titleOverlap(claimTitle, catTitle); // claim words found in catalog title
  if (fwd < 0.6) return false;
  const rev = titleOverlap(catTitle, claimTitle); // catalog words found in claim (rejects bloated unrelated titles)
  const cy = parseInt(catYear), cly = parseInt(claimYear);
  if (cy && cly) return Math.abs(cy - cly) <= 8 && rev >= 0.4; // both years known: wide window + sane reverse
  return fwd >= 0.85 && rev >= 0.6; // a year is missing: demand a tight two-way title match
}

async function fetchJson(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// Each returns {evidence_source, catalog_id, url, cat_title, cat_year} or null
async function matchOpenLibrary(claim) {
  const q = new URLSearchParams({ title: claim.english_title || '', author: claim.translator || '', language: 'eng', limit: '5' });
  const j = await fetchJson(`https://openlibrary.org/search.json?${q}`);
  for (const d of j?.docs || []) {
    if (catalogAccepts(claim.english_title, claim.pub_year, d.title, d.first_publish_year)) {
      return { evidence_source: 'open_library', catalog_id: d.key, url: `https://openlibrary.org${d.key}`, cat_title: d.title, cat_year: String(d.first_publish_year || '') };
    }
  }
  return null;
}
async function matchGoogleBooks(claim) {
  const keyParam = env.GOOGLE_BOOKS_API_KEY ? `&key=${env.GOOGLE_BOOKS_API_KEY}` : '';
  const q = `intitle:${claim.english_title || ''}${claim.translator ? '+inauthor:' + claim.translator : ''}`;
  const j = await fetchJson(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&langRestrict=en&maxResults=5${keyParam}`);
  for (const it of j?.items || []) {
    const vi = it.volumeInfo || {};
    if (catalogAccepts(claim.english_title, claim.pub_year, vi.title, (vi.publishedDate || '').slice(0, 4))) {
      return { evidence_source: 'google_books', catalog_id: it.id, url: vi.infoLink || `https://books.google.com/books?id=${it.id}`, cat_title: vi.title, cat_year: (vi.publishedDate || '').slice(0, 4) };
    }
  }
  return null;
}
async function matchInternetArchive(claim) {
  const q = `title:(${(claim.english_title || '').replace(/[":]/g, ' ')}) AND mediatype:texts`;
  // advancedsearch returns the fields we request via fl[]
  const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&fl[]=year&rows=5&output=json`;
  const j = await fetchJson(url);
  for (const d of j?.response?.docs || []) {
    if (catalogAccepts(claim.english_title, claim.pub_year, d.title, d.year)) {
      return { evidence_source: 'internet_archive', catalog_id: d.identifier, url: `https://archive.org/details/${d.identifier}`, cat_title: d.title, cat_year: String(d.year || '') };
    }
  }
  return null;
}

async function resolveCatalog(claim) {
  // Try catalogs in order; first resolvable hit wins.
  for (const fn of [matchOpenLibrary, matchGoogleBooks, matchInternetArchive]) {
    try { const hit = await fn(claim); if (hit) return hit; } catch {}
  }
  return null;
}

// ── Build the per-book proposal ─────────────────────────────────────
function toEvidence(claim, cat) {
  // Year reconciliation: we DISPLAY the LLM's claimed pub_year because that is
  // normally the ORIGINAL publication of the translation (e.g. Hauge's Temple of
  // Music 2011), which is what "Earlier translations" wants — the earliest date.
  // But the resolved catalog record often carries a REPRINT year (OL lists Hauge
  // as 2017). Showing "(2011)" against a 2017-dated record is a silent mismatch a
  // scholar would catch, so when the two diverge by >1yr we surface the catalog
  // year in notes for transparency rather than hide it. No new fields (issue #2244
  // says reuse TranslationEvidence as-is). #2244
  const yearDivergence = cat && cat.cat_year && claim.pub_year
    && Math.abs(parseInt(cat.cat_year) - parseInt(claim.pub_year)) > 1
    ? `linked catalog record dated ${cat.cat_year}` : null;
  return {
    english_title: claim.english_title,
    translator: claim.translator || undefined,
    pub_year: claim.pub_year || (cat ? cat.cat_year : undefined) || undefined,
    publisher: claim.publisher || undefined,
    completeness: ['complete', 'partial', 'excerpts'].includes(claim.completeness) ? claim.completeness : 'unknown',
    evidence_source: cat ? cat.evidence_source : 'llm_knowledge',
    catalog_id: cat ? cat.catalog_id : undefined,
    url: cat ? cat.url : undefined,
    validated: !!cat,
    notes: [
      claim.notes,
      claim.section_translated ? `section: ${claim.section_translated}` : null,
      yearDivergence,
    ].filter(Boolean).join('; ') || undefined,
  };
}

// A claim is only eligible for the RENDERED path if we can name a translator to
// credit. An "unknown" / "anonymous" / "various" translator is weak evidence — keep
// such claims as llm-only even when a catalog title matches. #2244
function hasNamedTranslator(claim) {
  const core = (claim.translator || '').replace(/\([^)]*\)/g, '').trim(); // drop "(editor/translator)" etc.
  if (!core) return false;
  return !/^(unknown|anonymous|various|n\/?a|none|n\.n\.|anon\.?)$/i.test(core);
}

// Render eligibility gate. The catalog cross-check confirms a book EXISTS but not
// that it CONTAINS this work — the failure mode for generic anthologies (Maier's
// "Circulus physicus" matched a 20th-c. anthology "The Alchemical Tradition" that
// does not contain it). So for EXCERPTS/anthology claims we additionally require the
// English title to name THIS author (Godwin's "Robert Fludd: Hermetic Philosopher"
// contains "Fludd"; a generic "The Alchemical Tradition" does not) — strong evidence
// the anthology is actually about this author. complete/partial translation titles
// (e.g. "The Temple of Music") needn't name the author. #2244
function eligibleForRender(book, claim) {
  if (!hasNamedTranslator(claim)) return false;
  if (claim.completeness === 'excerpts') {
    const authorToks = norm(book.author).split(' ').filter((w) => w.length >= 4);
    const titleNorm = norm(claim.english_title);
    if (authorToks.length && !authorToks.some((t) => titleNorm.includes(t))) return false;
  }
  return true;
}

async function processBook(book) {
  const disc = await callDiscovery(book);
  if (disc.error) return { book, error: disc.error, raw: disc.raw };
  const claims = Array.isArray(disc.translations) ? disc.translations : [];
  const validated = []; // catalog-resolved → translations_found + validated_translations
  const llmOnly = [];   // unresolved → llm_knowledge_translations (segregated)
  for (const claim of claims) {
    if (!claim?.english_title) continue;
    const cat = await resolveCatalog(claim);
    const ev = toEvidence(claim, cat);
    if (cat && ev.url && eligibleForRender(book, claim)) validated.push(ev); else llmOnly.push(ev);
  }
  // Conflict: a prior COMPLETE translation (catalog-resolved) on a first-* book.
  const priorComplete = validated.filter((e) => e.completeness === 'complete');
  const conflict = (book.is_first_translation || FIRST_FAMILY.includes(book?.translation_verification?.disposition)) && priorComplete.length > 0;
  return {
    book,
    validated,
    llmOnly,
    conflict,
    guarded: isCompilationOrTranslation(book),
    found_complete_prior_translation: !!disc.found_complete_prior_translation,
    reasoning: disc.reasoning || '',
    groundingUrls: disc.groundingUrls || [],
    tokens: disc.tokens || { input: 0, output: 0 },
  };
}

// ── Worker pool ─────────────────────────────────────────────────────
async function pool(items, fn, n) {
  const out = [];
  for (let i = 0; i < items.length; i += n) {
    const r = await Promise.allSettled(items.slice(i, i + n).map(fn));
    out.push(...r.map((x) => (x.status === 'fulfilled' ? x.value : { error: x.reason?.message || 'rejected' })));
    if (i + n < items.length) await new Promise((r) => setTimeout(r, DELAY_MS));
  }
  return out;
}

// ── Apply exactly the vetted entries from a prior dry-run report ─────
async function applyFromReport(reportPath) {
  const stat = fs.statSync(reportPath);
  const files = stat.isDirectory()
    ? fs.readdirSync(reportPath).filter((f) => f.endsWith('.json')).map((f) => `${reportPath.replace(/\/$/, '')}/${f}`)
    : [reportPath];
  // Merge per-book entries across files; last write wins per book id.
  const byId = new Map();
  for (const f of files) {
    let rep;
    try { rep = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { console.warn(`  skip unreadable ${f}`); continue; }
    for (const b of rep.books || []) if (b.id) byId.set(b.id, b);
  }
  const entries = [...byId.values()];
  console.log(`Apply-from-report: ${files.length} file(s), ${entries.length} unique books.`);

  const client = new MongoClient(env.MONGODB_URI, { maxPoolSize: 4 });
  await client.connect();
  const books = client.db(env.MONGODB_DB || 'bookstore').collection('books');
  let written = 0, withTf = 0, withConflict = 0;
  for (const b of entries) {
    const validated = Array.isArray(b.validated) ? b.validated : [];
    const llmOnly = Array.isArray(b.llm_only) ? b.llm_only : [];
    const set = { [`translation_verification.${RUN_FLAG}`]: true, 'translation_verification.prior_translations_discovered_at': new Date() };
    if (validated.length) {
      set['translation_verification.translations_found'] = validated;
      set['translation_verification.validated_translations'] = validated;
      withTf++;
    }
    if (llmOnly.length) set['translation_verification.llm_knowledge_translations'] = llmOnly;
    if (b.conflict) {
      set['translation_verification.first_translation_conflict'] = {
        flagged_at: new Date(),
        prior_complete: validated.filter((e) => e.completeness === 'complete'),
        note: 'Catalog-resolved prior COMPLETE translation found; review is_first_translation manually. Flag NOT auto-changed.',
      };
      withConflict++;
    }
    const res = await books.updateOne({ id: b.id }, { $set: set });
    if (res.matchedCount) written++; else console.warn(`  no book matched id=${b.id} (${b.title})`);
  }
  console.log(`\n=== Applied from report ===`);
  console.log(`  books updated:            ${written}`);
  console.log(`  with translations_found:  ${withTf}`);
  console.log(`  first_translation_conflict flags: ${withConflict}`);
  console.log('  NOTE: conflicts are flagged, not auto-flipped — review is_first_translation manually.');
  await client.close();
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  if (APPLY_REPORT) { await applyFromReport(APPLY_REPORT); return; }
  console.log('=== discover-prior-translations (#2244) ===');
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'} | model: ${MODEL} | keys: ${apiKeys.length} | limit: ${LIMIT}`);

  const client = new MongoClient(env.MONGODB_URI, { maxPoolSize: 4 });
  await client.connect();
  const db = client.db(env.MONGODB_DB || 'bookstore');
  const books = db.collection('books');

  const match = BOOK_ID
    ? { id: BOOK_ID }
    : {
        visible: true,
        pages_count: { $gt: 0 },
        $and: [
          { $or: [{ is_first_translation: true }, { 'translation_verification.disposition': { $in: FIRST_FAMILY } }] },
          // empty translations_found
          { $or: [{ 'translation_verification.translations_found': { $exists: false } }, { 'translation_verification.translations_found': { $size: 0 } }] },
        ],
      };
  if (AUTHOR) match.author = { $regex: AUTHOR, $options: 'i' };
  if (!FORCE && !BOOK_ID) match[`translation_verification.${RUN_FLAG}`] = { $ne: true };

  const proj = { id: 1, title: 1, display_title: 1, author: 1, language: 1, published: 1, year: 1, is_first_translation: 1, 'translation_verification.disposition': 1 };
  const candidates = await books.find(match).project(proj).limit(LIMIT).toArray();
  console.log(`Candidates: ${candidates.length}\n`);
  if (!candidates.length) { await client.close(); return; }

  const results = await pool(candidates, processBook, CONCURRENCY);

  // ── Report ──
  const report = { generated_at: new Date().toISOString(), mode: APPLY ? 'apply' : 'dry-run', candidates: candidates.length, books: [] };
  let withValidated = 0, withLlmOnly = 0, conflicts = 0, errors = 0, tokIn = 0, tokOut = 0;
  const lines = [];
  for (const r of results) {
    if (!r || r.error) { errors++; if (r?.book) lines.push(`ERROR  ${r.book.display_title || r.book.title}: ${r.error}`); continue; }
    tokIn += r.tokens.input; tokOut += r.tokens.output;
    if (r.validated.length) withValidated++;
    if (r.llmOnly.length) withLlmOnly++;
    if (r.conflict) conflicts++;
    report.books.push({
      id: r.book.id, title: r.book.display_title || r.book.title, author: r.book.author,
      disposition: r.book?.translation_verification?.disposition,
      validated: r.validated, llm_only: r.llmOnly, conflict: r.conflict, guarded: r.guarded, reasoning: r.reasoning,
    });
    const t = (r.book.display_title || r.book.title || '').slice(0, 60);
    lines.push(`\n[${r.book.id}] ${t}  — ${r.book.author || ''}${r.guarded ? '  [guarded: compilation/translation]' : ''}${r.conflict ? '   ⚠️ FIRST-TRANSLATION CONFLICT' : ''}`);
    for (const e of r.validated) lines.push(`   ✓ ${e.completeness.toUpperCase()}  "${e.english_title}" tr. ${e.translator || '?'} (${e.pub_year || '?'}) [${e.evidence_source}] ${e.url}`);
    for (const e of r.llmOnly) lines.push(`   · llm-only (NOT rendered): "${e.english_title}" tr. ${e.translator || '?'} (${e.pub_year || '?'})`);
    if (!r.validated.length && !r.llmOnly.length) lines.push('   (no prior translation found)');
  }

  fs.mkdirSync('scripts/output', { recursive: true });
  fs.writeFileSync('scripts/output/prior-translations-report.json', JSON.stringify(report, null, 2));
  fs.writeFileSync('scripts/output/prior-translations-report.txt', lines.join('\n'));

  console.log(`\n=== Summary ===`);
  console.log(`  books with catalog-validated prior translation(s): ${withValidated}`);
  console.log(`  books with LLM-only (segregated) claims:           ${withLlmOnly}`);
  console.log(`  first-translation conflicts (need human review):   ${conflicts}`);
  console.log(`  errors/parse-fails:                                ${errors}`);
  const cost = (tokIn / 1e6) * 0.15 + (tokOut / 1e6) * 0.4;
  console.log(`  tokens in=${tokIn.toLocaleString()} out=${tokOut.toLocaleString()} ~$${cost.toFixed(2)} + grounding ~$${(candidates.length * 0.014).toFixed(2)}`);
  console.log(`  report → scripts/output/prior-translations-report.{json,txt}`);

  if (!APPLY) { console.log('\nDry run — no DB writes. Spot-check the report, then re-run with --apply.'); await client.close(); return; }

  // ── Apply (additive; original byline untouched) ──
  console.log('\nApplying…');
  let written = 0;
  for (const r of results) {
    if (!r || r.error) continue;
    const set = { [`translation_verification.${RUN_FLAG}`]: true, 'translation_verification.prior_translations_discovered_at': new Date() };
    if (r.validated.length) {
      set['translation_verification.translations_found'] = r.validated;
      set['translation_verification.validated_translations'] = r.validated;
    }
    if (r.llmOnly.length) set['translation_verification.llm_knowledge_translations'] = r.llmOnly;
    if (r.conflict) {
      set['translation_verification.first_translation_conflict'] = {
        flagged_at: new Date(),
        prior_complete: r.validated.filter((e) => e.completeness === 'complete'),
        note: 'Catalog-resolved prior COMPLETE translation found; review is_first_translation manually. Flag NOT auto-changed.',
      };
    }
    // Books where nothing was found are still stamped with RUN_FLAG (set above)
    // so a re-run does not re-pay for them.
    await books.updateOne({ _id: r.book._id }, { $set: set });
    written++;
  }
  console.log(`  updated ${written} books (translations_found / validated / llm_knowledge / conflict flags + ${RUN_FLAG}).`);
  console.log('  NOTE: first_translation_conflict books are flagged, not auto-flipped — review before changing is_first_translation.');
  await client.close();
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
