#!/usr/bin/env node
/**
 * ft-search-unexamined.mjs — grounded, LOGGED web search for prior translations of
 * FT-badged books that have NO documented search yet (#2916 evidence floor).
 *
 * The gap (measured 2026-06-30): 5,814 FT badges, but only ~11% have a logged
 * search behind them — the other ~5,184 rest on a verdict whose search was thrown
 * away. A "first translation" claim is a claim of ABSENCE, and an absence claim is
 * only as strong as the documented search. This pass goes and searches (Gemini +
 * Google Search), then PERSISTS the actual queries + sources + verdict + the exact
 * prompt to `first_translation_attempts` — append-only, so the evidence endures and
 * any future approach inherits it instead of re-paying.
 *
 * Targets badges with NO attempt carrying `queries` (the un-evidenced set). Reuses
 * the proven grounded prompt from ft-gemini-adjudicate.mjs (source-language rule,
 * grading, container/anthology carve-out). NEVER flips a badge — found priors are
 * demote candidates for sign-off; the container/commentary/multi-book hard cases
 * escalate to the Claude Stage-2 tier (#2880), per the #2922 spot-check finding.
 *
 * SAFE/COST: report-only by default (lists targets, no API spend). --run performs
 * the paid grounded search; --apply also persists to the attempt log. --sample N.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/ft-search-unexamined.mjs --sample 20                 # list 20 targets (free)
 *   node scripts/eval/ft-search-unexamined.mjs --run --apply --sample 20   # search + log 20 (paid, ~$0.5)
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
const MODEL = process.argv.find((a) => a.startsWith('--model='))?.split('=')[1] || 'gemini-3-flash-preview';
const SAMPLE = (() => { const i = process.argv.indexOf('--sample'); return i > -1 ? parseInt(process.argv[i + 1], 10) || 20 : 0; })();
const CONC = parseInt(process.argv.find((a) => a.startsWith('--concurrency='))?.split('=')[1] || '5', 10);
const PROMPT_VERSION = 'ft-search-unexamined/v1-2026-06-30';

const keys = [];
if (process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY);
for (let i = 2; i <= 7; i++) if (process.env[`GEMINI_API_KEY_${i}`]) keys.push(process.env[`GEMINI_API_KEY_${i}`]);
if (process.env.GEMINI_API_KEY_TIER3) keys.push(process.env.GEMINI_API_KEY_TIER3);
let keyIdx = 0;
const nextKey = () => keys[(keyIdx++) % keys.length];
const costOf = (u) => { const i = u.promptTokenCount ?? 0, o = u.candidatesTokenCount ?? 0, t = u.totalTokenCount ?? (i + o); const ii = i || Math.round(t * 0.85), oo = o || Math.round(t * 0.15); return (ii / 1e6) * 0.10 + (oo / 1e6) * 0.40; };

function sourcesFor(lang) {
  const l = (lang || '').toLowerCase();
  if (l.includes('hebrew') || l.includes('arab') || l.includes('syriac') || l.includes('aramaic')) return 'Sefaria, Brill, scholarship, WorldCat';
  if (l.includes('tibet') || l.includes('sanskrit') || l.includes('pali')) return '84000, BDRC, Brill, scholarship, WorldCat';
  if (l.includes('chin') || l.includes('japan') || l.includes('korea')) return 'ctext, scholarship, WorldCat, OpenLibrary';
  return 'Google Books, archive.org, HathiTrust, OpenLibrary, OpenAlex, EEBO, academic scholarship';
}

function buildPrompt(b) {
  return `You are a first-translation adjudicator. Decide whether OUR book is the FIRST English translation of THIS specific text. Use Google Search to investigate, then report the search you actually ran.

OUR BOOK:
- Title: ${b.title}
- Author: ${b.author}
- Source language (the original we scanned): ${b.language}

SOURCE LIBRARY MODEL: our record IS the source-language original AND we produced an English translation of it — a VALID first-translation candidate. The question is: does a PRIOR English translation of THIS text already exist?

RULES (apply in order; you MUST search before concluding absence):
1. WORK IDENTITY: identify the work precisely; SEPARATE it from parent/sibling/derivative works and other editions. A translation of a DIFFERENT work does NOT count.
2. SEARCH tradition-appropriate sources: ${sourcesFor(b.language)}. Search title/author + "English translation" and the work's common English title. SOURCE QUALITY: weight library catalogues, scholarly publishers, digital archives heavily; DISTRUST aggregator/file-sharing/forum/AI-mirror sites.
3. SOURCE-LANGUAGE RULE (decisive): if a COMPLETE modern English translation of THIS WORK exists from ANY source language → not_first, even if our copy is in a different language than that prior used.
4. COVERAGE/SCOPE (critical — the known failure mode): if OUR item is a multi-work container, a multi-VOLUME/multi-book work, or carries an added commentary, a prior that covers only PART (one work/book/volume, or the base text without the commentary) does NOT defeat it → first_complete or needs_review, never not_first.
5. GRADING: only-partial/excerpt prior → first_complete (only if our item is complete). Only pre-1900 English → first_modern. No English at all → first_no_prior.
6. not_applicable only for: visual art; a plain scripture-manuscript of canonical scripture; or our item is itself a non-English translation. unverifiable if sources are catalogue-blind. needs_review if evidence conflicts or identity is unresolved.

Respond with ONLY JSON (you may wrap in \`\`\`json fences):
{"book_id":"${b.id}","work_identified":"<the work, disambiguated>","verdict":"first_no_prior|first_from_source|first_complete|first_modern|not_first|not_applicable|unverifiable|needs_review","prior_translations_found":[{"english_title":"...","translator":"...","pub_year":"1976","completeness":"complete|partial|excerpt|unknown","source_url":"<grounding URL>"}],"evidence_strength":"strong|moderate|weak","our_completeness":"complete|partial|unknown","confidence":"high|medium|low","reasoning":"<=300 chars: the prior or the bounded absence"}
"prior_translations_found" is [] when no prior exists; when non-empty EVERY entry needs a real translator+year you actually found (never a placeholder).`;
}

async function search(b) {
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const ai = new GoogleGenAI({ apiKey: nextKey() });
      const resp = await ai.models.generateContent({ model: MODEL, contents: buildPrompt(b), config: { tools: [{ googleSearch: {} }], temperature: 0.1 } });
      const text = resp.text || '';
      const gm = resp.candidates?.[0]?.groundingMetadata || {};
      const queries = Array.isArray(gm.webSearchQueries) ? gm.webSearchQueries : [];
      const sources_checked = [...new Set((gm.groundingChunks || []).map((c) => c?.web?.title || c?.web?.uri).filter(Boolean))];
      const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
      let parsed; try { parsed = JSON.parse((m ? m[1] : text).trim()); } catch { const mm = text.match(/\{[\s\S]*\}/); if (mm) try { parsed = JSON.parse(mm[0]); } catch {} }
      const cost = costOf(resp.usageMetadata || {});
      if (parsed?.verdict) return { ...parsed, queries, sources_checked, raw: text.slice(0, 800), cost_usd: cost };
      if (attempt === 2) return { verdict: 'needs_review', error: 'parse_failed', queries, sources_checked, raw: text.slice(0, 200), cost_usd: cost };
    } catch (err) {
      const msg = String(err.message || err);
      if (attempt < 2 && /fetch failed|ECONNRESET|timeout|503|500|overloaded|RESOURCE_EXHAUSTED|429/i.test(msg)) { await new Promise((r) => setTimeout(r, (attempt + 1) * 2500)); continue; }
      return { verdict: 'needs_review', error: msg.slice(0, 120), queries: [], sources_checked: [], cost_usd: 0 };
    }
  }
}

async function main() {
  if (RUN && keys.length === 0) { console.error('No GEMINI_API_KEY — set it or omit --run for the free target list.'); process.exit(1); }
  await withMongo(async (db) => { // noTimeout: grounded search over a large set legitimately runs long
    // un-evidenced badge set: FT badge with NO attempt carrying logged queries
    const badges = await db.collection('books').find({ is_first_translation: true, visible: true, pages_translated: { $gt: 0 }, language: { $nin: [null, 'en', 'English', 'english'] } })
      .project({ _id: 0, id: 1, title: 1, author: 1, language: 1, work_id: 1 }).toArray();
    const searched = new Set(await db.collection('first_translation_attempts').distinct('book_id', { queries: { $exists: true, $ne: [] } }));
    const unexamined = badges.filter((b) => !searched.has(b.id) && b.author);
    console.log(`FT badges: ${badges.length} | with a logged search: ${searched.size} | UN-EVIDENCED targets: ${unexamined.length}`);

    let targets = unexamined;
    if (SAMPLE) targets = [...unexamined].sort(() => Math.random() - 0.5).slice(0, SAMPLE);

    if (!RUN) {
      console.log(`\n(free) sample of ${targets.length} target(s):`);
      targets.slice(0, 30).forEach((b) => console.log(`  [${b.language}] ${(b.title || '').slice(0, 56)} — ${b.author}`));
      console.log('\nRe-run with --run --apply to search + log (paid grounded search).');
      return;
    }

    console.log(`\nSearching ${targets.length} target(s) with ${MODEL} (grounded, concurrency ${CONC})…\n`);
    const out = []; let cost = 0, found = 0, logged = 0;
    const queue = [...targets];
    async function worker() {
      while (queue.length) {
        const b = queue.shift();
        const v = await search(b); cost += v.cost_usd || 0;
        const priors = Array.isArray(v.prior_translations_found) ? v.prior_translations_found : [];
        const priorFound = priors.length > 0;
        if (priorFound) found++;
        out.push({ ...b, ...v });
        console.log(`[${(v.verdict || '?').padEnd(14)}|${(v.confidence || '?')}|q${(v.queries || []).length}] ${(b.title || '').slice(0, 46)}`);
        if (priorFound) console.log(`   PRIOR: ${priors[0].translator || '?'}, ${priors[0].pub_year || '?'} — ${(priors[0].english_title || '').slice(0, 44)} (${priors[0].completeness || '?'})`);
        if (v.reasoning) console.log(`   ${v.reasoning.slice(0, 140)}`);

        if (APPLY) {
          const ok = await appendAttempt(db, {
          attempt_id: `${b.id}:ft_search_unexamined:${PROMPT_VERSION}`,
          // match_key/result MUST be legal enum values (attempt-log.ts): the
          // original 'work_search'/'not_found' were off-enum, so every absence
          // this script logged was invisible to deriveVerdictFromAttempts and
          // ranked as NaN in strongestAttempt (#3778). Historical rows keep the
          // old values; only new runs write legal ones.
          book_id: b.id, work_id: b.work_id || null, date: RUN_DATE, method: 'gemini_grounded_search', match_key: 'author_title',
          prompt_version: PROMPT_VERSION, prompt: buildPrompt(b), model: MODEL, raw_response: v.raw || null,
          sources_checked: v.sources_checked || [], queries: v.queries || [],
          result: priorFound ? 'found' : (v.verdict === 'not_applicable' ? 'not_applicable' : 'none'),
          // "Could not tell" must never count as an absence vote: derive
          // excludes verdict:'uncertain' rows from absence/refute counting.
          verdict: (v.verdict === 'unverifiable' || v.verdict === 'needs_review') ? 'uncertain' : v.verdict,
          found_refs: [],
          priors: priors.map((p) => ({ english_title: p.english_title || undefined, translator: p.translator || undefined, pub_year: p.pub_year != null ? String(p.pub_year) : undefined, completeness: p.completeness || undefined, source_url: p.source_url || undefined })),
          adjudication: { verdict: v.verdict, our_completeness: v.our_completeness, confidence: v.confidence },
          evidence_strength: v.evidence_strength || 'weak', independence_score: 0.3,
          notes: `[ft-search-unexamined ${PROMPT_VERSION}] verdict=${v.verdict}, conf=${v.confidence}: ${v.reasoning || ''}`.slice(0, 480),
          });
          if (ok) logged++;
        }
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, Math.min(CONC, queue.length)) }, () => worker()));
    console.log(`\n── ${out.length} searched | ${found} with a prior found | ${logged} logged | cost $${cost.toFixed(4)} ──`);
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const f = path.join(OUT_DIR, `ft-search-unexamined-${DATE}.json`);
    fs.writeFileSync(f, JSON.stringify(out, null, 2));
    console.log(`Wrote ${f}${APPLY ? '\nLogged searches persisted to first_translation_attempts (prompt+queries+sources+raw). Demotes still require sign-off.' : '\n(--run without --apply: searched but NOT logged)'}`);
  }, { noTimeout: true });
}
main().catch((e) => { console.error(e); process.exit(1); });
