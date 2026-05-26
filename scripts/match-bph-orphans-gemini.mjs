#!/usr/bin/env node
/**
 * Match MongoDB BPH "no-dc_identifier" orphans to bph_works rows using Gemini.
 *
 * Problem
 * ────────────────────────────────────────────────────────────────────
 * 21 BPH books in MongoDB have no `dublin_core.dc_identifier`, so the
 * numeric-UBN backfill (scripts/backfill-bph-sl-book-ids.mjs) can't link
 * them to bph_works. They show up in BPH search but not in the catalogue
 * total, driving the persistent ~28-book gap between the two counts.
 *
 * Strategy
 * ────────────────────────────────────────────────────────────────────
 * Two-stage:
 *   1. Pre-filter bph_works with year ±3 and language match → typically
 *      30-200 candidate rows per orphan.
 *   2. Send orphan + candidates to Gemini, ask: which UBN (if any) is the
 *      same book? Returns ubn + confidence + reasoning.
 *
 * Output
 *   .claude/docs/bph-orphan-match-YYYY-MM-DD.json  (full structured result)
 *   .claude/docs/bph-orphan-match-YYYY-MM-DD.md    (human review table)
 *
 * Apply step is intentionally separate — this script only proposes matches.
 * After Derek reviews the report, a second pass writes `bph_works.sl_book_id`
 * for the approved matches.
 *
 * Usage
 *   set -a; source .env.production.local; set +a
 *   node scripts/match-bph-orphans-gemini.mjs              # propose
 *   node scripts/match-bph-orphans-gemini.mjs --apply MIN  # apply matches with confidence >= MIN (e.g. 0.85)
 */

import { MongoClient } from 'mongodb';
import { GoogleGenAI } from '@google/genai';
import fs from 'fs';

const MODEL = 'gemini-3.1-flash-lite';
const SUPABASE_URL = 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const MONGODB_URI = process.env.MONGODB_URI;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

const today = new Date().toISOString().slice(0, 10);
const REPORT_JSON = `.claude/docs/bph-orphan-match-${today}.json`;
const REPORT_MD = `.claude/docs/bph-orphan-match-${today}.md`;

const APPLY_IDX = process.argv.indexOf('--apply');
const APPLY = APPLY_IDX >= 0;
const APPLY_MIN_CONF = APPLY ? parseFloat(process.argv[APPLY_IDX + 1] || '0.85') : null;

if (!SUPABASE_KEY) { console.error('SUPABASE_SERVICE_ROLE_KEY required'); process.exit(1); }
if (!MONGODB_URI) { console.error('MONGODB_URI required'); process.exit(1); }
if (!APPLY && !GEMINI_KEY) { console.error('GEMINI_API_KEY required (or run with --apply N to act on existing report)'); process.exit(1); }

const sbHeaders = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

async function fetchLinkedSet() {
  const linked = new Set();
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/bph_works?select=sl_book_id&sl_book_id=not.is.null&order=sl_book_id.asc`, {
      headers: { ...sbHeaders, Range: `${from}-${from + 999}` },
    });
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const x of rows) linked.add(x.sl_book_id);
    if (rows.length < 1000) break;
  }
  return linked;
}

async function fetchCandidates(orphan) {
  // Year window: ±3 if year known, else skip year filter (rare).
  const params = new URLSearchParams({
    select: 'ubn,title,author,year,language,place,publisher,keywords,shelf_mark,sl_book_id',
  });
  if (typeof orphan.year === 'number' && orphan.year > 0) {
    params.append('year', `gte.${orphan.year - 3}`);
    params.append('year', `lte.${orphan.year + 3}`);
  }
  // Cap candidates so the prompt stays small.
  params.set('limit', '400');
  const r = await fetch(`${SUPABASE_URL}/rest/v1/bph_works?${params}`, { headers: sbHeaders });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return await r.json();
}

function buildPrompt(orphan, candidates) {
  const orphanLine = `ORPHAN: title="${orphan.title || ''}" author="${orphan.author || ''}" year=${orphan.year ?? '?'} language=${orphan.language ?? '?'} pages=${orphan.pages_count ?? '?'}`;
  const candLines = candidates.map((c, i) =>
    `[${i}] ubn=${c.ubn} title="${c.title || ''}" author="${c.author || ''}" year=${c.year ?? '?'} language=${c.language ?? '?'} place="${c.place || ''}" publisher="${c.publisher || ''}" shelf="${c.shelf_mark || ''}" ${c.sl_book_id ? '[ALREADY-LINKED]' : ''}`
  ).join('\n');

  return `You are matching a digitised book to its row in a library catalogue.

${orphanLine}

CANDIDATES (year ±3):
${candLines}

Task: Identify which candidate is the SAME WORK (same edition or same printing, allowing for OCR'd vs catalogued title variation, translated/transliterated titles, abbreviated author names, and known author/title variants in early-modern bibliography).

Rules:
- If a candidate is [ALREADY-LINKED], you may STILL pick it (it could be a duplicate Mongo book pointing at the same UBN) — but flag that.
- "Same work" means the catalogue entry describes this exact book (not just a related edition). Different translations or different publishers/years > 1 apart are NOT a match.
- If no candidate is a confident match, return ubn=null.

Return strict JSON only — no markdown, no commentary:
{"ubn": "<string or null>", "confidence": <0..1>, "reason": "<one short sentence>"}`;
}

async function askGemini(genai, prompt) {
  const result = await genai.models.generateContent({
    model: MODEL,
    contents: [{ parts: [{ text: prompt }] }],
    config: { temperature: 0.05, maxOutputTokens: 256 },
  });
  const text = (result.text || '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { ubn: null, confidence: 0, reason: 'no JSON in response', raw: text };
  try {
    const parsed = JSON.parse(match[0]);
    return { ubn: parsed.ubn || null, confidence: Number(parsed.confidence) || 0, reason: String(parsed.reason || '') };
  } catch (e) {
    return { ubn: null, confidence: 0, reason: 'parse error: ' + e.message, raw: text };
  }
}

async function propose() {
  console.log('Loading linked sl_book_id set …');
  const linked = await fetchLinkedSet();

  console.log('Loading no-dc orphans from MongoDB …');
  const mongo = new MongoClient(MONGODB_URI);
  await mongo.connect();
  const tenant = await mongo.db('bookstore').collection('tenants').findOne({ slug: 'bph' });
  const books = await mongo.db('bookstore').collection('books').find({
    tenantId: tenant.id, visible: true, pages_count: { $gt: 0 }
  }, { projection: { id: 1, slug: 1, title: 1, author: 1, year: 1, language: 1, pages_count: 1, 'dublin_core.dc_identifier': 1 } }).toArray();
  const orphans = books.filter(b => !linked.has(b.id) && !b.dublin_core?.dc_identifier);
  await mongo.close();
  console.log(`  ${orphans.length} no-dc orphans\n`);

  const genai = new GoogleGenAI({ apiKey: GEMINI_KEY });
  const results = [];
  for (let i = 0; i < orphans.length; i++) {
    const b = orphans[i];
    process.stdout.write(`[${i + 1}/${orphans.length}] ${(b.title || '').slice(0, 50)} … `);
    try {
      const candidates = await fetchCandidates(b);
      if (candidates.length === 0) {
        results.push({ orphan: b, predicted_ubn: null, confidence: 0, reason: 'no candidates in year window', candidate_count: 0 });
        console.log('no candidates');
        continue;
      }
      const verdict = await askGemini(genai, buildPrompt(b, candidates));
      const matched = verdict.ubn ? candidates.find(c => c.ubn === verdict.ubn) : null;
      results.push({
        orphan: { id: b.id, slug: b.slug, title: b.title, author: b.author, year: b.year, language: b.language, pages: b.pages_count },
        predicted_ubn: verdict.ubn,
        confidence: verdict.confidence,
        reason: verdict.reason,
        candidate_count: candidates.length,
        matched_row: matched ? { ubn: matched.ubn, title: matched.title, author: matched.author, year: matched.year, language: matched.language, already_linked: !!matched.sl_book_id, existing_sl_book_id: matched.sl_book_id || null } : null,
      });
      console.log(`→ ${verdict.ubn || 'none'} (${verdict.confidence})`);
    } catch (e) {
      results.push({ orphan: b, predicted_ubn: null, confidence: 0, reason: 'error: ' + e.message });
      console.log('ERROR ' + e.message);
    }
  }

  // Write reports
  fs.writeFileSync(REPORT_JSON, JSON.stringify({ generated_at: new Date().toISOString(), model: MODEL, results }, null, 2));

  const mdLines = [
    `# BPH orphan-to-catalogue Gemini match — ${today}`,
    '',
    `Model: \`${MODEL}\`  •  Orphans: ${results.length}`,
    '',
    '| # | Orphan | Year | Predicted UBN | Conf | Matched catalogue title | Already linked? | Reason |',
    '|---|---|---|---|---|---|---|---|',
  ];
  results.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  results.forEach((r, i) => {
    const o = r.orphan;
    const m = r.matched_row;
    mdLines.push(
      `| ${i + 1} | ${(o.title || '').slice(0, 50).replace(/\|/g, '\\|')} ${o.author ? `_${(o.author || '').slice(0, 30)}_` : ''} | ${o.year || '?'} | ${r.predicted_ubn || '—'} | ${r.confidence?.toFixed(2) || '0.00'} | ${m ? (m.title || '').slice(0, 50).replace(/\|/g, '\\|') : '—'} | ${m?.already_linked ? `⚠ ${m.existing_sl_book_id}` : ''} | ${(r.reason || '').slice(0, 80).replace(/\|/g, '\\|')} |`
    );
  });
  mdLines.push('', '## Notes', '- ⚠ Already-linked: predicted UBN is already linked to a *different* sl_book_id. Likely a duplicate Mongo book; dedupe rather than re-link.', '- Recommended threshold for auto-apply: confidence ≥ 0.85.', '- All non-applied rows should be reviewed manually before linking.');

  fs.writeFileSync(REPORT_MD, mdLines.join('\n'));
  console.log(`\nReports:\n  ${REPORT_JSON}\n  ${REPORT_MD}\n`);
}

async function apply() {
  const minConf = APPLY_MIN_CONF;
  if (!Number.isFinite(minConf) || minConf <= 0 || minConf > 1) {
    console.error('Usage: --apply <min_confidence>  (e.g. --apply 0.85)');
    process.exit(1);
  }
  if (!fs.existsSync(REPORT_JSON)) {
    console.error(`Report not found: ${REPORT_JSON}\nRun without --apply first.`);
    process.exit(1);
  }
  const { results } = JSON.parse(fs.readFileSync(REPORT_JSON, 'utf8'));
  const toApply = results.filter(r =>
    r.predicted_ubn && r.confidence >= minConf && r.matched_row && !r.matched_row.already_linked
  );
  const skippedLowConf = results.filter(r => r.predicted_ubn && r.confidence < minConf).length;
  const skippedCollide = results.filter(r => r.matched_row?.already_linked).length;
  const skippedNoMatch = results.filter(r => !r.predicted_ubn).length;
  console.log(`Will apply ${toApply.length} updates  (skip: low-conf=${skippedLowConf}  collide=${skippedCollide}  no-match=${skippedNoMatch})`);
  console.log(`Threshold: confidence ≥ ${minConf}\n`);

  let ok = 0, fail = 0;
  for (const r of toApply) {
    const url = `${SUPABASE_URL}/rest/v1/bph_works?ubn=eq.${encodeURIComponent(r.predicted_ubn)}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { ...sbHeaders, Prefer: 'return=representation' },
      body: JSON.stringify({ sl_book_id: r.orphan.id, sl_book_slug: r.orphan.slug || r.orphan.id }),
    });
    if (!res.ok) {
      console.log(`  FAIL ubn=${r.predicted_ubn} (${res.status}): ${await res.text()}`);
      fail++;
    } else {
      const body = await res.json();
      const count = Array.isArray(body) ? body.length : 0;
      console.log(`  OK   ubn=${r.predicted_ubn}  ${r.orphan.title?.slice(0, 50)}  (rows=${count})`);
      ok++;
    }
  }
  console.log(`\nDone. updated=${ok}  failed=${fail}`);
}

(APPLY ? apply : propose)().catch(e => { console.error(e); process.exit(1); });
