#!/usr/bin/env node
/**
 * ft-prior-adjudicate.mjs — LLM PAIRWISE adjudication of catalog prior-matches (#2916).
 *
 * The design insight (Derek, 2026-06-30): structural matching is RECALL; an LLM is
 * PRECISION. A free, gate-free match against `translation_catalogs` surfaces every
 * candidate `(badge ↔ prior)` pair — completeness is NOT a gate (an `unknown`-
 * completeness row is still a real prior; we just never recorded if it's complete).
 * Then an LLM judges each pair: is the catalog entry actually a COMPLETE English
 * translation of OUR exact work? It instantly knows Findlen's "The Last Man Who
 * Knew Everything" is a book ABOUT Kircher (not a translation of Musurgia), and
 * that Kerns' "Secret of Secrets" IS a complete prior — the discrimination the
 * old completeness gate couldn't make. Completeness becomes an OUTPUT the LLM
 * determines (and backfills the catalog), not a precondition for looking.
 *
 * CHEAP, not the blind tier: the pair is pre-surfaced, so adjudication is pairwise
 * judgment from metadata — most cases need NO web search (Findlen = 0 tool calls).
 * Default model gemini-3.1-flash-lite, no grounding. ~$0.001-0.003 per pair.
 *
 * SAFE: report/dry-run by default. --run calls the LLM. --apply also records the
 * verdict in `first_translation_attempts` (never flips a badge — demotes stay
 * Derek's sign-off). --sample N adjudicates a random N (validation batch).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/ft-prior-adjudicate.mjs                    # generate candidate pairs (free, no LLM)
 *   node scripts/eval/ft-prior-adjudicate.mjs --run --sample 15  # adjudicate a 15-pair validation batch
 *   node scripts/eval/ft-prior-adjudicate.mjs --run              # adjudicate all pairs
 *   node scripts/eval/ft-prior-adjudicate.mjs --run --apply      # + record verdicts as evidence
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { withMongo } from '../lib/mongo.mjs';
import { appendAttempt } from '../lib/ft-attempt-log.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'output');
const DATE = new Date().toISOString().slice(0, 10);
const RUN_DATE = new Date().toISOString();
const RUN = process.argv.includes('--run');
const APPLY = process.argv.includes('--apply');
const MODEL = process.argv.find((a) => a.startsWith('--model='))?.split('=')[1] || 'gemini-3.1-flash-lite';
const SAMPLE = (() => { const i = process.argv.indexOf('--sample'); return i > -1 ? parseInt(process.argv[i + 1], 10) || 15 : 0; })();

// ── Gemini key rotation (mirror ft-gemini-adjudicate.mjs) ───────────────────────
const keys = [];
if (process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY);
for (let i = 2; i <= 7; i++) if (process.env[`GEMINI_API_KEY_${i}`]) keys.push(process.env[`GEMINI_API_KEY_${i}`]);
if (process.env.GEMINI_API_KEY_TIER3) keys.push(process.env.GEMINI_API_KEY_TIER3);
let keyIdx = 0;
const nextKey = () => keys[(keyIdx++) % keys.length];
const costOf = (u) => {
  const i = u.promptTokenCount ?? u.inputTokenCount ?? 0;
  const o = u.candidatesTokenCount ?? u.outputTokenCount ?? 0;
  const tot = u.totalTokenCount ?? (i + o);
  const ii = i || Math.round(tot * 0.7), oo = o || Math.round(tot * 0.3);
  return (ii / 1e6) * 0.10 + (oo / 1e6) * 0.40; // flash-lite ~ $0.10/$0.40 per Mtok
};

// ── gate-free structural match (RECALL; completeness is NOT a gate) ──────────────
function normalise(s) { return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim(); }
const STOP = new Set(['the', 'and', 'with', 'from', 'that', 'this', 'for', 'english', 'translation', 'translated', 'works', 'text', 'liber', 'libri', 'opus', 'opera', 'book', 'books', 'volume', 'tractatus', 'von', 'der', 'des', 'de', 'la', 'le', 'und']);
const sig = (s) => normalise(s).split(/\s+/).filter((t) => t.length >= 4 && !STOP.has(t));
const covDir = (a, b) => { const ta = sig(a), tb = new Set(sig(b)); return ta.length ? ta.filter((t) => tb.has(t)).length / ta.length : 0; };
const cov = (a, b) => Math.max(covDir(a, b), covDir(b, a));
const cleanAuthor = (a) => (a || '').replace(/\([^)]*\)/g, ' ').replace(/\b(translation|ed|trans|edition|editor|attributed|pseudo)\b/gi, ' ').trim();
const surname = (a) => { const r = cleanAuthor(a); if (r.includes(',')) return normalise(r.split(',')[0]); const p = normalise(r).split(/\s+/).filter(Boolean); return p[p.length - 1] || ''; };
const LANG = { latin: 'la', greek: 'grc', 'ancient greek': 'grc', hebrew: 'he', sanskrit: 'sa', chinese: 'zh', german: 'de', french: 'fr', italian: 'it', arabic: 'ar', syriac: 'syc', dutch: 'nl', armenian: 'hy' };
const iso = (l) => { l = normalise(l); return LANG[l] || LANG[l.split(/[-\/, ]/)[0]] || l || 'unknown'; };
const GENERIC = /various|multiple|anonymous|collective|unknown/i;

function buildPrompt(p) {
  return `You are auditing a "First English Translation" badge. We have ONE specific work, and ONE candidate prior English translation pulled from a catalogue by a fuzzy title+author match. Decide what the candidate ACTUALLY is.

OUR BADGED WORK:
- Title: ${p.book_title}
- Author: ${p.book_author}
- Source language: ${p.book_language}

CANDIDATE PRIOR (from our catalogue, may be a wrong/loose match):
- English title: ${p.cat_title}
- Translator: ${p.cat_translator || 'unknown'}
- Year: ${p.cat_year || 'unknown'}
- Source/publisher: ${p.cat_source || 'unknown'}

Judge from your knowledge (no web search needed for the obvious cases):
1. RELATIONSHIP — is the candidate an English TRANSLATION of OUR EXACT work? Beware: a book ABOUT the author or work (biography, study, essay collection — e.g. "The Last Man Who Knew Everything" is ABOUT Kircher, not a translation), a translation of a DIFFERENT or related work, a SCHOLARLY EDITION OF THE ORIGINAL-LANGUAGE TEXT (not an English rendering), a specific single volume/book of a multi-volume work, or a different-source-language translation — none of these defeat our badge.
2. COMPLETENESS — if it IS a translation of our work, is it COMPLETE, or partial/excerpt/preface-only?
3. VERDICT (apply strictly): defeats_badge = true ONLY when the candidate is a COMPLETE English translation of OUR EXACT work. A PARTIAL/excerpt/preface-only prior does NOT defeat a "first COMPLETE translation" badge → defeats_badge = false (note it as context). If you are unsure whether it is the same work or whether it is complete, set defeats_badge = false and confidence = "low" (it will escalate to deeper verification — do NOT guess "high").

Return ONLY JSON:
{"relationship":"translation_of_this_work|about_not_translation|different_work|edition_of_original|single_volume_of_set|different_source_language|uncertain","completeness":"complete|partial|excerpt|preface_only|unknown|na","defeats_badge":true|false,"confidence":"high|medium|low","reasoning":"<= 240 chars"}`;
}

async function adjudicate(p) {
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const ai = new GoogleGenAI({ apiKey: nextKey() });
      const resp = await ai.models.generateContent({ model: MODEL, contents: buildPrompt(p), config: { temperature: 0.1 } });
      const text = resp.text || '';
      const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
      let parsed; try { parsed = JSON.parse((m ? m[1] : text).trim()); } catch { const mm = text.match(/\{[\s\S]*\}/); if (mm) try { parsed = JSON.parse(mm[0]); } catch {} }
      if (parsed?.relationship) return { ...parsed, cost_usd: costOf(resp.usageMetadata || {}) };
      if (attempt === 2) return { relationship: 'uncertain', defeats_badge: false, confidence: 'low', error: 'parse_failed', raw: text.slice(0, 160), cost_usd: costOf(resp.usageMetadata || {}) };
    } catch (err) {
      const msg = String(err.message || err);
      if (attempt < 2 && /fetch failed|ECONNRESET|timeout|503|500|overloaded|RESOURCE_EXHAUSTED|429/i.test(msg)) { await new Promise((r) => setTimeout(r, (attempt + 1) * 2500)); continue; }
      return { relationship: 'uncertain', defeats_badge: false, confidence: 'low', error: msg.slice(0, 120), cost_usd: 0 };
    }
  }
}

async function main() {
  if (RUN && keys.length === 0) { console.error('No GEMINI_API_KEY found — set it or omit --run for the free candidate pass.'); process.exit(1); }
  await withMongo(async (db) => {
    // 1) gate-free candidate generation
    const cat = await db.collection('translation_catalogs').find({ source: { $ne: 'ft_verification_discovery' } })
      .project({ _id: 1, canonical_author: 1, author: 1, author_surname: 1, english_title: 1, canonical_work: 1, completeness: 1, source_language: 1, translator: 1, pub_year: 1, source: 1, url: 1, source_url: 1 }).toArray();
    const idx = new Map();
    for (const r of cat) { const sn = r.author_surname ? normalise(r.author_surname) : surname(r.canonical_author || r.author); if (sn && sn.length >= 3) (idx.get(sn) || idx.set(sn, []).get(sn)).push(r); }

    const books = await db.collection('books').find({ is_first_translation: true, visible: true, pages_translated: { $gt: 0 }, language: { $nin: [null, 'en', 'English', 'english'] } })
      .project({ _id: 0, id: 1, title: 1, author: 1, language: 1, work_id: 1 }).toArray();

    const pairs = [];
    for (const b of books) {
      if (!b.author || GENERIC.test(b.author)) continue;
      const cand = idx.get(surname(b.author)); if (!cand) continue;
      const biso = iso(b.language);
      let best = null;
      for (const r of cand) {
        const tc = Math.max(cov(b.title, r.english_title || ''), cov(b.title, r.canonical_work || ''));
        if (tc < 0.6) continue;
        if (biso !== normalise(r.source_language)) continue; // same-work source-lang stays (the LLM still re-checks)
        if (!best || tc > best.tc) best = { r, tc };
      }
      if (best) pairs.push({
        book_id: b.id, work_id: b.work_id || null, book_title: b.title, book_author: b.author, book_language: b.language,
        catalog_id: String(best.r._id), cat_title: best.r.english_title || best.r.canonical_work, cat_translator: best.r.translator,
        cat_year: best.r.pub_year, cat_source: best.r.source, cat_completeness: best.r.completeness || 'unknown',
        cat_url: best.r.url || best.r.source_url || null, title_coverage: +best.tc.toFixed(2),
      });
    }
    console.log(`Gate-free candidate pairs (badge ↔ catalog prior): ${pairs.length}`);

    let toRun = pairs;
    if (SAMPLE) toRun = [...pairs].sort(() => Math.random() - 0.5).slice(0, SAMPLE);

    if (!RUN) {
      const f = path.join(OUT_DIR, `ft-prior-candidates-${DATE}.json`);
      fs.mkdirSync(OUT_DIR, { recursive: true }); fs.writeFileSync(f, JSON.stringify(pairs, null, 2));
      console.log(`\n(free candidate pass — no LLM) wrote ${pairs.length} pairs → ${f}`);
      console.log('Re-run with --run [--sample N] to adjudicate.');
      return;
    }

    // 2) LLM pairwise adjudication
    console.log(`Adjudicating ${toRun.length} pair(s) with ${MODEL}…\n`);
    const out = []; let cost = 0;
    for (const p of toRun) {
      const v = await adjudicate(p); cost += v.cost_usd || 0;
      out.push({ ...p, ...v });
      const flag = v.defeats_badge ? 'DEFEATS' : '— keep ';
      console.log(`[${flag}|${(v.confidence || '?').padEnd(6)}|${(v.relationship || '?')}] "${(p.book_title || '').slice(0, 40)}"`);
      console.log(`   prior: ${p.cat_translator || '?'}, ${p.cat_year || '?'} "${(p.cat_title || '').slice(0, 44)}" → ${v.completeness || '?'}`);
      console.log(`   ${v.reasoning || v.error || ''}`);
    }
    const defeats = out.filter((o) => o.defeats_badge && o.confidence !== 'low');
    console.log(`\n── ${out.length} adjudicated | ${defeats.length} confidently DEFEAT the badge (demote candidates) | cost $${cost.toFixed(4)} ──`);

    const f = path.join(OUT_DIR, `ft-prior-adjudicated-${DATE}.json`);
    fs.mkdirSync(OUT_DIR, { recursive: true }); fs.writeFileSync(f, JSON.stringify(out, null, 2));
    console.log(`Wrote ${f}`);

    if (APPLY) {
      let logged = 0;
      for (const o of out) {
        if (!o.defeats_badge || o.confidence === 'low') continue;
        const ok = await appendAttempt(db, {
          attempt_id: `${o.book_id}:llm_prior_adjudicate:${o.catalog_id}`,
          book_id: o.book_id, work_id: o.work_id, date: RUN_DATE, method: 'llm_prior_adjudicate', match_key: 'author_title',
          sources_checked: ['translation_catalogs'], queries: [[o.book_author, o.book_title].filter(Boolean).join(' ')],
          result: 'found', found_refs: [o.catalog_id],
          priors: [{ english_title: o.cat_title || undefined, translator: o.cat_translator || undefined, pub_year: o.cat_year != null ? String(o.cat_year) : undefined, completeness: o.completeness || undefined, source_url: o.cat_url || undefined }],
          evidence_strength: o.confidence === 'high' ? 'moderate' : 'weak', independence_score: 0.4, model: MODEL,
          notes: `[llm-prior-adjudicate] ${o.relationship}, completeness=${o.completeness}, conf=${o.confidence}: ${o.reasoning || ''}`.slice(0, 480),
        });
        if (ok) logged++;
      }
      console.log(`Recorded ${logged} demote-candidate attempts (idempotent). Demotes still require sign-off.`);
    }
  });
}
main().catch((e) => { console.error(e); process.exit(1); });
