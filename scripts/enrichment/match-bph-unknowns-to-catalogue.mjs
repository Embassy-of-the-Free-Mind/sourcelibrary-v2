#!/usr/bin/env node
/**
 * Match BPH "unknown-provenance" books against the bph_works catalogue.
 *
 * The problem
 * ─────────────────────────────────────────────────────────────────────
 * 142 MongoDB BPH books have `dublin_core: {}` — no dc_identifier, no
 * IIIF URL, no source URL. They were imported without provenance metadata
 * and never linked to a bph_works row, so they vanish from the
 * catalogue's list view (which shows only sl_book_id-linked rows).
 *
 * They DO have rich derived metadata: title, author, year, language,
 * and a 1-2 sentence description (populated by an earlier enrichment
 * pass that read the first 25 OCR'd pages). That's plenty to match
 * against bph_works — which itself has title/author/year/place/printer
 * for every printed work in the BPH collection.
 *
 * The approach
 * ─────────────────────────────────────────────────────────────────────
 * Hybrid SQL + LLM matcher with function calling. Per unknown book:
 *
 *   1. Prefilter — 3 parallel Supabase queries against bph_works:
 *      (a) title-similarity (ilike on title and title_norm), year ±15
 *      (b) author surname + year window
 *      (c) leading-word of title + year window
 *      Union+dedupe ≈ 15-30 candidates per book.
 *
 *   2. Gemini — `gemini-3.1-flash-lite-preview` per CLAUDE.md, with two
 *      function-calling tools:
 *
 *      - search_catalogue({ title?, author?, year_from?, year_to?,
 *                          place?, printer?, language?, limit? })
 *        → returns up to 20 candidate rows from bph_works. Gemini calls
 *          this to refine when the initial candidate list is weak (e.g.
 *          the title is generic and a printer/place narrows it down).
 *
 *      - final_answer({ matched_ubn | null, confidence, reasoning,
 *                       evidence })
 *        → terminates the loop with Gemini's pick.
 *
 *   3. Apply rules
 *      confidence=high → PATCH bph_works.sl_book_id = book.id and stamp
 *                        field_provenance.sl_book_id.source = 'ai_match'
 *                        with the Gemini reasoning attached.
 *      confidence=medium → write to a review file; no DB write.
 *      confidence=low | null match → flag as "likely catalogue gap"
 *                        (book exists digitally but no bph_works entry).
 *
 * Outputs
 *   .claude/docs/bph-unknowns-match-YYYY-MM-DD.json  (per-book results)
 *   .claude/docs/bph-unknowns-match-YYYY-MM-DD.md    (markdown summary)
 *
 * Usage
 *   node scripts/enrichment/match-bph-unknowns-to-catalogue.mjs --dry-run
 *   node scripts/enrichment/match-bph-unknowns-to-catalogue.mjs --apply
 *   node scripts/enrichment/match-bph-unknowns-to-catalogue.mjs --apply --limit 10
 *
 * Idempotent. Re-running skips books whose sl_book_id has already been
 * matched (i.e. that already appear in bph_works.sl_book_id) — so partial
 * runs are safe to resume.
 */

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// ── Config ───────────────────────────────────────────────────────────

const MODEL = 'gemini-3.1-flash-lite-preview';
const CONCURRENCY = 6;
const DELAY_BETWEEN_BATCHES_MS = 200;
const PREFILTER_PER_QUERY = 15;
const SEARCH_TOOL_MAX = 20;
const MAX_TOOL_ROUNDS = 6;
const YEAR_WINDOW = 15;

const today = new Date().toISOString().slice(0, 10);
const REPORT_JSON = `.claude/docs/bph-unknowns-match-${today}.json`;
const REPORT_MD = `.claude/docs/bph-unknowns-match-${today}.md`;

const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

// ── Env ──────────────────────────────────────────────────────────────

function loadEnv() {
  const env = {};
  for (const filename of ['.env.production.local', '.env.local']) {
    try {
      const content = fs.readFileSync(filename, 'utf8');
      for (const line of content.split('\n')) {
        const m = line.match(/^([^=#]+)=(.*)$/);
        if (m) {
          let v = m[2].trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
          if (!(m[1].trim() in env)) env[m[1].trim()] = v;
        }
      }
    } catch { /* file absent */ }
  }
  return { ...env, ...process.env };
}

const env = loadEnv();
const MONGODB_URI = env.MONGODB_URI;
const SUPABASE_URL = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set'); process.exit(1); }

function getApiKeys() {
  const keys = [];
  if (env.GEMINI_API_KEY) keys.push(env.GEMINI_API_KEY);
  for (let i = 2; i <= 10; i++) if (env[`GEMINI_API_KEY_${i}`]) keys.push(env[`GEMINI_API_KEY_${i}`]);
  return keys;
}
const apiKeys = getApiKeys();
if (apiKeys.length === 0) { console.error('No GEMINI_API_KEY configured'); process.exit(1); }
let keyIndex = 0;
function getGenAI() {
  const k = apiKeys[keyIndex % apiKeys.length];
  keyIndex++;
  return new GoogleGenerativeAI(k);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Args ─────────────────────────────────────────────────────────────
const APPLY = process.argv.includes('--apply');
const DRY = !APPLY || process.argv.includes('--dry-run');
const LIMIT_IDX = process.argv.indexOf('--limit');
const LIMIT = LIMIT_IDX !== -1 ? parseInt(process.argv[LIMIT_IDX + 1], 10) : null;

// ── Prefilter ────────────────────────────────────────────────────────

function escapeIlike(s) {
  return String(s).replace(/[%_\\]/g, '\\$&');
}

async function prefilterCandidates(book) {
  const title = (book.display_title || book.title || '').trim();
  const author = (book.author || '').trim();
  const year = typeof book.year === 'number' ? book.year : null;
  const seen = new Map();
  const add = (rows) => {
    for (const r of rows || []) {
      if (!seen.has(r.ubn)) seen.set(r.ubn, r);
    }
  };

  const fields = 'ubn, title, author, year, place, printer, publisher, language, shelf_mark, sl_book_id';

  // 1. Leading words of title (first 4 significant words).
  const titleProbe = title.replace(/[\[\]"']/g, '').split(/\s+/).filter(w => w.length > 2).slice(0, 4).join(' ');
  if (titleProbe.length >= 3) {
    let q = supabase.from('bph_works').select(fields).is('sl_book_id', null).limit(PREFILTER_PER_QUERY);
    q = q.ilike('title', `%${escapeIlike(titleProbe)}%`);
    if (year) { q = q.gte('year', year - YEAR_WINDOW).lte('year', year + YEAR_WINDOW); }
    const { data } = await q;
    add(data);
  }

  // 2. Author surname + year window.
  const surname = author.replace(/[\[\]"']/g, '').split(/[,\s]/).filter(Boolean)[0] || '';
  if (surname && surname.length > 2 && !/^(unknown|anonymous|n\.d|\[\?)/i.test(surname)) {
    let q = supabase.from('bph_works').select(fields).is('sl_book_id', null).limit(PREFILTER_PER_QUERY);
    q = q.ilike('author', `%${escapeIlike(surname)}%`);
    if (year) { q = q.gte('year', year - YEAR_WINDOW).lte('year', year + YEAR_WINDOW); }
    const { data } = await q;
    add(data);
  }

  // 3. First significant word of title (broader) + tight year window.
  const firstWord = title.replace(/[\[\]"']/g, '').split(/\s+/).find(w => w.length > 4 && !/^(the|der|die|das|von|und|ein|eine|sur|les|del|della)$/i.test(w));
  if (firstWord && year) {
    let q = supabase.from('bph_works').select(fields).is('sl_book_id', null).limit(PREFILTER_PER_QUERY);
    q = q.ilike('title', `%${escapeIlike(firstWord)}%`);
    q = q.gte('year', year - 5).lte('year', year + 5);
    const { data } = await q;
    add(data);
  }

  return [...seen.values()];
}

// ── Gemini tool: live search ─────────────────────────────────────────

async function tool_search_catalogue(args) {
  const { title, author, year_from, year_to, place, printer, language, limit = SEARCH_TOOL_MAX } = args || {};
  const fields = 'ubn, title, author, year, place, printer, publisher, language, shelf_mark, sl_book_id';
  let q = supabase.from('bph_works').select(fields).limit(Math.min(limit, SEARCH_TOOL_MAX));
  if (title) q = q.ilike('title', `%${escapeIlike(title)}%`);
  if (author) q = q.ilike('author', `%${escapeIlike(author)}%`);
  if (place) q = q.ilike('place', `%${escapeIlike(place)}%`);
  if (printer) q = q.ilike('printer', `%${escapeIlike(printer)}%`);
  if (language) q = q.ilike('language', `%${escapeIlike(language)}%`);
  if (typeof year_from === 'number') q = q.gte('year', year_from);
  if (typeof year_to === 'number') q = q.lte('year', year_to);
  const { data, error } = await q;
  if (error) return { error: error.message, results: [] };
  return { results: data || [] };
}

const toolDeclarations = [
  {
    name: 'search_catalogue',
    description: 'Search the BPH printed-book catalogue (bph_works). Use this to refine when the initial candidate list looks weak — e.g. add a printer to disambiguate a generic title, or widen the year window. Returns up to 20 rows.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Substring to search in title (case-insensitive ilike).' },
        author: { type: 'string', description: 'Substring to search in author (surname is best).' },
        year_from: { type: 'integer' },
        year_to: { type: 'integer' },
        place: { type: 'string', description: 'Place of publication, e.g. Frankfurt' },
        printer: { type: 'string' },
        language: { type: 'string', description: 'e.g. Latin, German, French, English' },
        limit: { type: 'integer' },
      },
    },
  },
  {
    name: 'final_answer',
    description: 'Return your final identification. Call this exactly once, when you are ready to commit to a match (or no match).',
    parameters: {
      type: 'object',
      properties: {
        matched_ubn: { type: 'string', description: 'The matched bph_works.ubn, or empty string for no match.' },
        confidence: { type: 'string', description: 'high | medium | low' },
        reasoning: { type: 'string', description: '1-2 sentences explaining the match (or no match).' },
        evidence: { type: 'string', description: 'Which fields agree (e.g. "title near-identical; year 1707 matches; author Starkey ↔ variant_author Eirenaeus Philalethes (pseudonym)").' },
      },
      required: ['matched_ubn', 'confidence', 'reasoning'],
    },
  },
];

function formatCandidate(c) {
  const fields = [
    `ubn=${c.ubn}`,
    `title="${(c.title || '').slice(0, 100)}"`,
    c.author ? `author="${c.author.slice(0, 60)}"` : null,
    c.year ? `year=${c.year}` : null,
    c.place ? `place="${c.place.slice(0, 30)}"` : null,
    c.printer ? `printer="${c.printer.slice(0, 30)}"` : null,
    c.language ? `lang=${c.language}` : null,
    c.shelf_mark ? `shelf=${c.shelf_mark}` : null,
  ].filter(Boolean);
  return fields.join('  ');
}

function buildPrompt(book, candidates) {
  return `You are a rare books librarian matching a digitised BPH book against the BPH printed-book catalogue (bph_works).

The book has no UBN in its metadata, so we need to identify which catalogue entry (if any) it corresponds to.

DIGITISED BOOK:
- Title:        "${book.display_title || book.title || ''}"
- Original title: "${book.title || ''}"
- Author:       "${book.author || ''}"
- Year:         ${book.year ?? '(unknown)'}
- Language:     ${book.language ?? '(unknown)'}
- Description:  ${book.description ? `"${String(book.description).slice(0, 240)}"` : '(none)'}

CANDIDATES FROM bph_works (top hits from prefilter):
${candidates.length === 0 ? '(none — call search_catalogue to find candidates)' : candidates.map(formatCandidate).join('\n')}

Decide which (if any) is the same work. You may call search_catalogue to refine — try different titles, narrower year windows, or use the printer/place to disambiguate. When you are ready, call final_answer with:
- matched_ubn: the bph_works.ubn of the matched row, or empty string if no candidate is a good match
- confidence: "high" only if multiple independent fields agree (title near-identical AND year matches; or title + author + year all line up). "medium" if you are fairly confident but a key field disagrees mildly. "low" if it is a guess.
- reasoning: 1-2 sentences explaining what convinced you (or why no match).
- evidence: which specific fields agree, with side-by-side comparisons.

Notes for early-modern matching:
- The same work can have very different titles across editions (Latin original vs vernacular translation; short vs descriptive title; word reorder).
- Pseudonyms are common ("Eirenaeus Philalethes" ≈ Starkey, "Basilius Valentinus" ≈ Tholden).
- Year ±5 is usually fine; ±15 only if title is near-identical.
- Author "Unknown" or "anonymous" on the digitised side often matches a bph_works row whose author field is empty too.
- Reject matches where year differs >20 years AND title is not nearly identical.`;
}

async function classifyOne(book) {
  const candidates = await prefilterCandidates(book);
  const genai = getGenAI();
  const model = genai.getGenerativeModel({
    model: MODEL,
    safetySettings: SAFETY_SETTINGS,
    tools: [{ functionDeclarations: toolDeclarations }],
    toolConfig: { functionCallingConfig: { mode: 'ANY' } },
  });

  const history = [{ role: 'user', parts: [{ text: buildPrompt(book, candidates) }] }];

  let finalAnswer = null;
  let toolCalls = 0;
  for (let round = 0; round < MAX_TOOL_ROUNDS && !finalAnswer; round++) {
    // On the last allowed round, tell the model it must commit now —
    // otherwise it can loop forever calling search_catalogue and we get a
    // useless "exceeded rounds" non-answer (~5% of cases in the first run).
    if (round === MAX_TOOL_ROUNDS - 1) {
      history.push({
        role: 'user',
        parts: [{ text: 'You have one round left. Call final_answer now — pick the best candidate from what you have already searched, or return an empty matched_ubn with low confidence if nothing fits.' }],
      });
    }
    const result = await model.generateContent({ contents: history });
    const cand = result.response?.candidates?.[0];
    const parts = cand?.content?.parts || [];

    // Collect any function calls in this turn.
    const calls = parts.filter(p => p.functionCall).map(p => p.functionCall);
    if (calls.length === 0) {
      // Model returned text instead of a tool call — treat as a soft fail.
      const text = parts.map(p => p.text).filter(Boolean).join(' ').trim();
      return { candidates, history, final: { matched_ubn: '', confidence: 'low', reasoning: text || 'model returned no tool call', evidence: '' }, toolCalls };
    }

    history.push({ role: 'model', parts });

    const toolResponses = [];
    for (const call of calls) {
      if (call.name === 'final_answer') {
        finalAnswer = call.args || {};
        break;
      } else if (call.name === 'search_catalogue') {
        toolCalls++;
        const out = await tool_search_catalogue(call.args || {});
        toolResponses.push({
          functionResponse: { name: 'search_catalogue', response: out },
        });
      }
    }

    if (!finalAnswer && toolResponses.length > 0) {
      history.push({ role: 'user', parts: toolResponses });
    }
  }

  if (!finalAnswer) {
    return { candidates, history, final: { matched_ubn: '', confidence: 'low', reasoning: 'exceeded tool-call rounds without final_answer', evidence: '' }, toolCalls };
  }
  return { candidates, history, final: finalAnswer, toolCalls };
}

// ── Apply ────────────────────────────────────────────────────────────

async function applyMatch(book, finalAnswer) {
  const ubn = (finalAnswer.matched_ubn || '').trim();
  if (!ubn) return { applied: false, reason: 'no ubn' };

  // Verify the candidate still exists and is not already linked to a different book.
  const { data: row } = await supabase
    .from('bph_works')
    .select('ubn, sl_book_id, field_provenance')
    .eq('ubn', ubn)
    .maybeSingle();
  if (!row) return { applied: false, reason: `ubn ${ubn} not found in bph_works` };
  if (row.sl_book_id && row.sl_book_id !== book.id) {
    return { applied: false, reason: `ubn ${ubn} already linked to a different book (${row.sl_book_id})` };
  }

  const fp = { ...(row.field_provenance || {}) };
  fp.sl_book_id = { source: 'ai_match', evidence: finalAnswer.evidence || finalAnswer.reasoning || '' };

  const { error } = await supabase
    .from('bph_works')
    .update({
      sl_book_id: book.id,
      sl_book_slug: book.slug || book.id,
      field_provenance: fp,
    })
    .eq('ubn', ubn);
  if (error) return { applied: false, reason: `supabase error: ${error.message}` };
  return { applied: true };
}

// ── Driver ───────────────────────────────────────────────────────────

async function main() {
  console.log(`Mode: ${DRY ? 'DRY-RUN' : 'APPLY'}${LIMIT != null ? `  limit=${LIMIT}` : ''}`);

  const mongo = new MongoClient(MONGODB_URI);
  await mongo.connect();
  const db = mongo.db('bookstore');
  const tenant = await db.collection('tenants').findOne({ slug: 'bph' });
  if (!tenant?.id) throw new Error('BPH tenant not found');

  // Already-linked sl_book_ids — skip these so re-runs are cheap.
  const linkedIds = new Set();
  let from = 0;
  while (true) {
    const { data } = await supabase.from('bph_works').select('sl_book_id').not('sl_book_id', 'is', null).range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const r of data) linkedIds.add(r.sl_book_id);
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`bph_works currently links ${linkedIds.size} MongoDB book ids.`);

  const unknowns = await db.collection('books').find({
    tenantId: tenant.id, visible: true, pages_count: { $gt: 0 }, 'image_source.provider': 'bph',
    $or: [
      { 'dublin_core.dc_identifier': { $exists: false } },
      { 'dublin_core.dc_identifier': null },
      { 'dublin_core.dc_identifier': '' },
    ],
  }, {
    projection: { id: 1, slug: 1, title: 1, display_title: 1, author: 1, year: 1, language: 1, description: 1 },
  }).toArray();

  const queue = unknowns.filter(b => !linkedIds.has(b.id));
  const skipped = unknowns.length - queue.length;
  const batch = LIMIT ? queue.slice(0, LIMIT) : queue;
  console.log(`Unknowns total=${unknowns.length}  already-linked=${skipped}  to-process=${batch.length}\n`);

  const results = [];
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const chunk = batch.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(chunk.map(async (book) => {
      try {
        const { candidates, final, toolCalls } = await classifyOne(book);
        let applied = null;
        if (!DRY && final.confidence === 'high' && final.matched_ubn) {
          applied = await applyMatch(book, final);
        }
        return { book: { id: book.id, slug: book.slug, title: book.title, author: book.author, year: book.year, language: book.language }, candidate_count: candidates.length, final, applied, toolCalls };
      } catch (err) {
        return { book: { id: book.id, title: book.title }, error: err?.message || String(err) };
      }
    }));
    for (const s of settled) {
      const r = s.status === 'fulfilled' ? s.value : { error: String(s.reason) };
      results.push(r);
      const f = r.final || {};
      const tag = r.error ? 'ERR' : (f.confidence || '?').toUpperCase().padEnd(6);
      const action = r.applied?.applied ? '✓ linked' : (r.applied?.reason ? `skip: ${r.applied.reason}` : '');
      console.log(`  [${results.length}/${batch.length}] ${tag} ${f.matched_ubn || '(no match)'}  ${(r.book.title || '').slice(0, 60)}  ${action}`);
    }
    if (i + CONCURRENCY < batch.length) await new Promise(res => setTimeout(res, DELAY_BETWEEN_BATCHES_MS));
  }

  // ── Reports ────────────────────────────────────────────────────────
  fs.mkdirSync('.claude/docs', { recursive: true });
  fs.writeFileSync(REPORT_JSON, JSON.stringify({ run_at: new Date().toISOString(), mode: DRY ? 'dry-run' : 'apply', total: batch.length, results }, null, 2));

  const counts = { high: 0, medium: 0, low: 0, error: 0, no_match: 0 };
  for (const r of results) {
    if (r.error) counts.error++;
    else if (!r.final.matched_ubn) counts.no_match++;
    else if (r.final.confidence === 'high') counts.high++;
    else if (r.final.confidence === 'medium') counts.medium++;
    else counts.low++;
  }

  let md = `# BPH unknowns → catalogue match — ${today}\n\n`;
  md += `Mode: **${DRY ? 'dry-run' : 'apply'}**  •  Processed: ${batch.length}  •  Skipped (already linked): ${skipped}\n\n`;
  md += `| Bucket | Count |\n|---|---|\n`;
  md += `| ✅ high (auto-link${DRY ? ', dry-run' : 'ed'}) | ${counts.high} |\n`;
  md += `| 🟡 medium (needs review) | ${counts.medium} |\n`;
  md += `| 🔴 low | ${counts.low} |\n`;
  md += `| ⚪ no match (likely catalogue gap) | ${counts.no_match} |\n`;
  md += `| ❌ errors | ${counts.error} |\n\n`;

  md += `## 🟡 Medium-confidence matches (review needed)\n\n`;
  for (const r of results.filter(x => x.final?.confidence === 'medium')) {
    md += `### "${(r.book.title || '').slice(0, 80)}" (${r.book.year || '?'})\n`;
    md += `MongoDB id: \`${r.book.id}\`  author=\`${r.book.author || ''}\`\n\n`;
    md += `Proposed UBN: **${r.final.matched_ubn}**  •  ${r.final.reasoning}\n\n`;
    if (r.final.evidence) md += `_Evidence:_ ${r.final.evidence}\n\n`;
    md += `---\n\n`;
  }

  md += `\n## ⚪ No match (likely catalogue gap)\n\n`;
  for (const r of results.filter(x => !x.error && !x.final?.matched_ubn)) {
    md += `- "${(r.book.title || '').slice(0, 80)}" (${r.book.year || '?'}, ${r.book.language || '?'}) — ${r.final?.reasoning || ''}\n`;
  }

  md += `\n## ✅ High-confidence ${DRY ? '(would link)' : '(linked)'}\n\n`;
  for (const r of results.filter(x => x.final?.confidence === 'high')) {
    md += `- \`${r.book.id}\` → ubn=\`${r.final.matched_ubn}\` — ${r.final.evidence || r.final.reasoning}\n`;
  }

  fs.writeFileSync(REPORT_MD, md);
  console.log(`\nReports:\n  ${REPORT_JSON}\n  ${REPORT_MD}`);
  console.log(`\nSummary: high=${counts.high} medium=${counts.medium} low=${counts.low} no_match=${counts.no_match} errors=${counts.error}`);

  await mongo.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
