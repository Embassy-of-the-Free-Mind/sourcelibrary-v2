#!/usr/bin/env node
/**
 * Gemini-grounded first-translation adjudicator (issue #2564).
 *
 * The cheap, scalable Tier-2 instrument: replaces the Claude Code agent with a
 * Gemini call using Google Search grounding (so it reaches tradition-appropriate
 * sources — 84000/BDRC/CTEXT/Sefaria — via web search, NOT just Western
 * catalogs). ~$0.01/book vs the Claude-subscription agents, no Claude rate limit,
 * Batch API halves it again. Same prompt + verdict taxonomy as the agent runs,
 * so verdicts are directly comparable for instrument validation.
 *
 * Reuses the grounding pattern from scripts/enrichment/verify-translation-claims.mjs.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/ft-gemini-adjudicate.mjs <worklist.json> <out.json> [--concurrency=6]
 */
import { GoogleGenAI } from '@google/genai';
import { readFileSync, writeFileSync } from 'fs';

const MODEL = 'gemini-3-flash-preview';   // grounded search model (matches the working enrichment script)
const MAX_RETRIES = 3;

const worklistFile = process.argv[2];
const outFile = process.argv[3];
const CONC = parseInt(process.argv.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '6', 10);
if (!worklistFile || !outFile) { console.error('usage: ft-gemini-adjudicate.mjs <worklist.json> <out.json> [--concurrency=N]'); process.exit(1); }

// ── Gemini key rotation (mirror the enrichment script) ──────────────────────
const keys = [];
if (process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY);
for (let i = 2; i <= 7; i++) if (process.env[`GEMINI_API_KEY_${i}`]) keys.push(process.env[`GEMINI_API_KEY_${i}`]);
if (process.env.GEMINI_API_KEY_TIER3) keys.push(process.env.GEMINI_API_KEY_TIER3);
if (keys.length === 0) { console.error('No GEMINI_API_KEY found'); process.exit(1); }
let keyIdx = 0;
const nextKey = () => keys[(keyIdx++) % keys.length];

// flash pricing (approx, for cost logging only). genai usage fields vary by
// version — fall back across the known names so the estimate isn't zero.
const costOf = (u) => {
  const inTok = u.promptTokenCount ?? u.promptTokens ?? u.inputTokenCount ?? 0;
  const outTok = u.candidatesTokenCount ?? u.candidatesTokens ?? u.outputTokenCount ?? 0;
  const tot = u.totalTokenCount ?? (inTok + outTok);
  // if only total is present, assume ~85% input for grounded calls
  const i = inTok || Math.round(tot * 0.85), o = outTok || Math.round(tot * 0.15);
  return (i / 1e6) * 0.10 + (o / 1e6) * 0.40;
};

function sourcesFor(lang) {
  const l = (lang || '').toLowerCase();
  if (l.includes('tibet')) return '84000.co, BDRC/library.bdrc.io, Lotsawa House, treasuryoflives.org, rigpawiki';
  if (l.includes('chin') || l.includes('japan') || l.includes('korea')) return 'CTEXT (ctext.org), CBETA, sinological scholarship, WorldCat';
  if (l.includes('sanskrit') || l.includes('tamil') || l.includes('pali')) return 'GRETIL, SuttaCentral, Clay Sanskrit Library, indological scholarship';
  if (l.includes('hebrew') || l.includes('arab') || l.includes('syriac') || l.includes('aramaic')) return 'Sefaria, Brill, scholarship, WorldCat';
  return 'Google Books, archive.org, HathiTrust, OpenLibrary, OpenAlex, EEBO, academic scholarship';
}

function buildPrompt(b) {
  return `You are a first-translation adjudicator. Decide whether OUR book is the FIRST English translation of THIS specific text. Use Google Search to investigate.

OUR BOOK:
- Title: ${b.t}
- Author: ${b.a}
- Language of our text (the SOURCE-language original we scanned): ${b.l}

IMPORTANT — SOURCE LIBRARY MODEL: our record IS the source-language original (its language is ${b.l}, e.g. Latin/German/Chinese) AND we have produced an English translation of it. This is a VALID first-translation candidate. Do NOT mark not_applicable merely because our text is in the original language — that is what a first translation translates FROM. The question is: does a PRIOR English translation of THIS text already exist?

RULES (apply in order; you MUST run searches before concluding absence):
1. WORK IDENTITY: identify the work precisely and SEPARATE it from parent/sibling/derivative works and other editions/recensions. A translation of a DIFFERENT work (even a closely related one) does NOT count against us.
2. SEARCH: query TRADITION-APPROPRIATE sources: ${sourcesFor(b.l)}. Search title/author + "English translation", and the work's common English title. Never answer "no prior" without having actually searched.
3. SOURCE-LANGUAGE RULE (DECISIVE — this is the most common error, be strict): If a complete modern English translation of THIS WORK exists from ANY source language, the verdict is **not_first** — even when our copy is in a different language than the source that prior translation used (e.g. our Latin De Mundo when Forster translated De Mundo from the Greek -> not_first, NOT first_from_source; our Latin Sibylline Oracles when Terry translated them from Greek -> not_first). Use **first_from_source** ONLY in the narrow case where our specific text is itself a distinct, separately-citable intermediary work that has never been Englished while the underlying work has. When uncertain between not_first and first_from_source, choose not_first.
4. GRADING (only after confirming a prior exists): if the ONLY English of the work is partial/excerpt/abridged -> first_complete, but ONLY if our item is verified complete (else not_first or needs_review). If the ONLY English is pre-1900 -> first_modern. If NO English of the work exists in any form -> first_no_prior.
5. NOT_APPLICABLE only for: visual art (maps/charts/engravings, no translatable prose); a scripture-manuscript copy of canonical scripture; a multi-work container/anthology/opera-omnia (claim ill-defined); OR our item is itself a NON-English translation (e.g. a Dutch edition of a Portuguese work). A plain source-language original we translated is NOT one of these.
6. If competent sources are catalogue-blind and you cannot bound the search -> unverifiable. If evidence conflicts or work identity is unresolved -> needs_review.
7. EVIDENCE STRENGTH: 'strong' ONLY if a prior was positively found, OR absence was confirmed in competent tradition-appropriate sources; 'moderate' for a well-searched but bounded absence; 'weak' if you could not search competent sources. Be conservative — a blind Western-catalogue miss on a non-Western text is 'weak', not proof of a first.

Respond with ONLY a JSON object (you may wrap it in \`\`\`json fences):
{"book_id":"${b.id}","verdict":"first_no_prior|first_from_source|first_complete|first_modern|not_first|not_applicable|unverifiable|needs_review","prior_relationship":"same_text|same_work_diff_edition|different_source_language|related_distinct_work|partial|adaptation|none","evidence_strength":"strong|moderate|weak","our_completeness":"complete|partial|unknown","match_key":"work_id|author_title|transliteration|none","prior_found":true|false,"confidence":"high|medium|low","reason":"<= 280 chars"}
evidence_strength: strong = prior positively found OR absence confirmed in competent sources; moderate = well-searched bounded absence; weak = only a blind/uncertain search.`;
}

async function adjudicate(b) {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const ai = new GoogleGenAI({ apiKey: nextKey() });
      const resp = await ai.models.generateContent({
        model: MODEL,
        contents: buildPrompt(b),
        config: { tools: [{ googleSearch: {} }], temperature: 0.1, thinkingConfig: { thinkingBudget: -1 } },
      });
      const text = resp.text || '';
      const usage = resp.usageMetadata || {};
      const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
      let parsed;
      try { parsed = JSON.parse((m ? m[1] : text).trim()); }
      catch { const mm = text.match(/\{[\s\S]*\}/); if (mm) { try { parsed = JSON.parse(mm[0]); } catch {} } }
      if (!parsed || !parsed.verdict) {
        if (attempt < MAX_RETRIES) continue;
        return { book_id: b.id, verdict: 'needs_review', error: 'parse_failed', raw: text.slice(0, 200), cost_usd: costOf(usage) };
      }
      return { ...parsed, book_id: b.id, cost_usd: costOf(usage) };
    } catch (err) {
      const msg = String(err.message || err);
      if (attempt < MAX_RETRIES && /fetch failed|ECONNRESET|timeout|503|500|overloaded|RESOURCE_EXHAUSTED|429/i.test(msg)) {
        await new Promise(r => setTimeout(r, (attempt + 1) * 2500));
        continue;
      }
      return { book_id: b.id, verdict: 'needs_review', error: msg.slice(0, 120) };
    }
  }
}

// ── concurrency-limited run ─────────────────────────────────────────────────
const work = JSON.parse(readFileSync(worklistFile, 'utf8'));
const results = new Array(work.length);
let done = 0, cost = 0, next = 0;
async function worker() {
  while (next < work.length) {
    const i = next++;
    const r = await adjudicate(work[i]);
    results[i] = r;
    cost += r.cost_usd || 0;
    done++;
    if (done % 10 === 0 || done === work.length) console.error(`  ${done}/${work.length}  ($${cost.toFixed(2)})`);
  }
}
console.error(`Gemini adjudication: ${work.length} books, model=${MODEL}, concurrency=${CONC}`);
await Promise.all(Array.from({ length: Math.min(CONC, work.length) }, worker));

const tally = {};
for (const r of results) if (r) tally[r.verdict] = (tally[r.verdict] || 0) + 1;
writeFileSync(outFile, JSON.stringify(results.filter(Boolean), null, 0));
console.error(`\nDONE. ${results.filter(Boolean).length}/${work.length} adjudicated. Total cost ~$${cost.toFixed(2)}`);
console.error('tally:', JSON.stringify(tally));
