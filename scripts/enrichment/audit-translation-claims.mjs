#!/usr/bin/env node
/**
 * Audit-verification pass — task #20.
 *
 * Background: 2026-05-30 audit (project_verify_translation_agent_findings.md)
 * found ~13% of specific-translator LLM claims are misattributions —
 * real-name scholars credited with translations they didn't actually do.
 * Examples: de Laet/Ogilvie 2014 (Ogilvie didn't translate), O'Meara on
 * Psellos Chaldaean Oracles (O'Meara edited the Greek, didn't translate;
 * Majercik did), Wolff Rational Thoughts 1770 (different Wolff work was
 * translated). These bad claims would propagate to `confirmed_first` and
 * `translation_found` if accepted uncritically.
 *
 * This script audits one specific claim per book against Google Search
 * grounding (Gemini 3.1 Flash Lite). For each needs_review book with a
 * specific-translator claim, it asks: does this exact translation actually
 * exist? Verdicts:
 *   confirmed   — search returns evidence the translation exists
 *   contradicted — search returns evidence the claim is wrong (different
 *                  translator, different work, never published)
 *   inconclusive — search inconclusive, leave needs_review
 *
 * What we DO write to Mongo:
 *   translation_verification.verification_audit {
 *     audited_at, model, audited_claim, verdict, confidence, reasoning,
 *     evidence: [{url, title}], suspected_hallucination, alternative_found
 *   }
 *
 * What we do NOT write here:
 *   The disposition itself is not changed by this script. A separate
 *   commit (apply-audit-verdicts.mjs, sibling script) reads the audit
 *   records and flips disposition. Separation keeps the audit immutable
 *   and lets us review/adjust the decision rule independently.
 *
 * Idempotent: skip books that already have verification_audit.audited_at
 * within the last 30 days unless --force.
 *
 * Cost: ~$0.014/book grounded (Gemini 3.1 Flash Lite + Google grounding).
 * For 1,469 soft-hit books: ~$20 total.
 *
 * Usage:
 *   node scripts/enrichment/audit-translation-claims.mjs --dry-run
 *   node scripts/enrichment/audit-translation-claims.mjs --dry-run --limit 5
 *   node scripts/enrichment/audit-translation-claims.mjs --apply --limit 20
 *   node scripts/enrichment/audit-translation-claims.mjs --apply
 *   node scripts/enrichment/audit-translation-claims.mjs --book-id BOOK_ID --apply
 */

import { GoogleGenAI } from '@google/genai';
import { MongoClient } from 'mongodb';
import fs from 'fs';
import { appendAttempt, makeAttemptId, domainsFromEvidence } from '../lib/ft-attempt-log.mjs';

// ── Config ──────────────────────────────────────────────────────────
const MODEL = 'gemini-3.1-flash-lite';
const CONCURRENCY = 3;
const DELAY_MS = 1000;
const MAX_RETRIES = 2;
const STALE_DAYS = 30;

// ── Env ─────────────────────────────────────────────────────────────
function loadEnv() {
  const env = {};
  for (const file of ['.env.production.local', '.env.local']) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      for (const line of content.split('\n')) {
        const m = line.match(/^([^=#]+)=(.*)$/);
        if (m) {
          let v = m[2].trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
            v = v.slice(1, -1);
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
  for (let i = 2; i <= 10; i++) {
    if (env[`GEMINI_API_KEY_${i}`]) keys.push(env[`GEMINI_API_KEY_${i}`]);
  }
  if (env.GEMINI_API_KEY_TIER3) keys.push(env.GEMINI_API_KEY_TIER3);
  return keys.filter(Boolean);
}

const apiKeys = getApiKeys();
if (apiKeys.length === 0) { console.error('No GEMINI_API_KEY found'); process.exit(1); }
let keyIndex = 0;
function getNextKey() { const k = apiKeys[keyIndex % apiKeys.length]; keyIndex++; return k; }

// ── CLI ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--apply');
const FORCE = args.includes('--force');
const getArg = name => { const i = args.indexOf(name); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; };
const LIMIT = getArg('--limit') ? parseInt(getArg('--limit')) : null;
const BOOK_ID = getArg('--book-id');

// ── Vague-translator detection (same as bulk-flip + harvest) ────────
const VAGUE_RE = /^(various|anonymous|unknown|n\/a|not specified|tbd|none|original|original author).*$|^.*(academic excerpts|various scholars|various academic|various \().*$/i;
const isVague = t => !t || !t.trim() || VAGUE_RE.test(t.trim());

// ── Prompt ──────────────────────────────────────────────────────────
function buildAuditPrompt(book, claim) {
  const bookAuthor = (book.author || '').replace(/\s+/g, ' ').trim();
  const bookTitle = book.display_title || book.title || '';
  return `You are verifying whether a SPECIFIC English translation actually exists. Search the web to confirm or contradict this claim.

ORIGINAL WORK: "${bookTitle}" by ${bookAuthor} (${book.language || 'unknown language'})

CLAIMED TRANSLATION:
- English title: ${claim.english_title || 'unspecified'}
- Translator: ${claim.translator || 'unspecified'}
- Year: ${claim.pub_year || 'unspecified'}
- Publisher: ${claim.publisher || 'unspecified'}

Search the web for this specific translation. Determine one of:
- CONFIRMED: you find evidence (library catalogs, scholarly references, bookseller listings, university press pages) that this exact translation (or close variant — same translator + same work + reasonably close year) exists
- CONTRADICTED: you find evidence that the claim is wrong. Examples:
  * The named translator exists but never translated this work (worked on a different author)
  * The named translator worked on this author but a different work (e.g. O'Meara edited the Greek of Psellos's Chaldean fragments, but Majercik did the English translation — so claiming O'Meara as English translator is wrong)
  * The work was published but in a different year or by a different translator
  * The publication never happened
- INCONCLUSIVE: searches return ambiguous or no informative results

Be especially suspicious of "Various scholars" / "Academic excerpts" framing as it often masks no specific translation existing.

If CONTRADICTED, note whether you found an ALTERNATIVE genuine translation — the search might surface the real one even if the claim is wrong.

Respond JSON only:
{
  "verdict": "confirmed" | "contradicted" | "inconclusive",
  "confidence": "high" | "medium" | "low",
  "reasoning": "1-2 sentences explaining what the search found and why you reached this verdict",
  "suspected_hallucination": null OR {
    "type": "wrong_translator" | "wrong_work" | "wrong_year" | "fabricated" | "other",
    "notes": "brief"
  },
  "alternative_translation_found": null OR {
    "english_title": "...",
    "translator": "...",
    "pub_year": "...",
    "publisher": "...",
    "completeness": "complete" | "partial" | "excerpts" | "unknown"
  }
}`;
}

// ── Grounded audit call ─────────────────────────────────────────────
async function auditClaim(book, claim) {
  const prompt = buildAuditPrompt(book, claim);
  let response;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const ai = new GoogleGenAI({ apiKey: getNextKey() });
      response = await ai.models.generateContent({
        model: MODEL,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
          temperature: 0.1,
        },
      });
      break;
    } catch (err) {
      if (attempt < MAX_RETRIES && /fetch failed|ECONNRESET|timeout|429|503/.test(err.message)) {
        await new Promise(r => setTimeout(r, (attempt + 1) * 2000));
        continue;
      }
      throw err;
    }
  }
  const text = response.text || '';
  const usage = response.usageMetadata || {};
  const candidate = response.candidates?.[0];
  const grounding = candidate?.groundingMetadata;
  const searchQueries = grounding?.webSearchQueries || [];
  const evidence = (grounding?.groundingChunks || [])
    .filter(c => c.web?.uri)
    .map(c => ({ url: c.web.uri, title: c.web.title || '' }));

  let parsed;
  try {
    const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
    parsed = JSON.parse((m ? m[1] : text).trim());
  } catch {
    return { error: 'parse_failed', raw: text.slice(0, 500), searchQueries, evidence };
  }
  return {
    ...parsed,
    searchQueries,
    evidence,
    tokens: { input: usage.promptTokenCount || 0, output: usage.candidatesTokenCount || 0 },
  };
}

// ── Worker pool ─────────────────────────────────────────────────────
async function processInBatches(items, fn, concurrency) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const r = await Promise.allSettled(batch.map(fn));
    results.push(...r);
    if (i + concurrency < items.length) await new Promise(r => setTimeout(r, DELAY_MS));
  }
  return results;
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Translation-claim audit ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'APPLYING'}`);
  console.log(`Model: ${MODEL}, concurrency: ${CONCURRENCY}, api keys: ${apiKeys.length}`);
  if (LIMIT) console.log(`Limit: ${LIMIT}`);
  if (BOOK_ID) console.log(`Book: ${BOOK_ID}`);

  const client = new MongoClient(env.MONGODB_URI, { maxPoolSize: 4 });
  await client.connect();
  const db = client.db(env.MONGODB_DB || 'bookstore');

  // Select books that have specific-translator LLM claims and are not yet audited
  const baseMatch = BOOK_ID
    ? { id: BOOK_ID }
    : {
      'translation_verification.disposition': 'needs_review',
      'translation_verification.llm_knowledge_translations.0': { $exists: true },
    };

  const all = await db.collection('books').find(baseMatch).project({
    id: 1, title: 1, display_title: 1, author: 1, language: 1,
    'translation_verification.disposition': 1,
    'translation_verification.llm_knowledge_translations': 1,
    'translation_verification.verification_audit': 1,
  }).toArray();

  // Filter to those with at least one specific-translator claim AND not already audited
  const staleAfter = Date.now() - STALE_DAYS * 24 * 3600 * 1000;
  const targets = [];
  for (const b of all) {
    const claims = (b.translation_verification?.llm_knowledge_translations || []).filter(c => !isVague(c.translator));
    if (claims.length === 0) continue;
    const prior = b.translation_verification?.verification_audit?.audited_at;
    if (!FORCE && prior && new Date(prior).getTime() > staleAfter) continue;
    targets.push({ book: b, claim: claims[0] });
  }
  console.log(`\nEligible (specific-claim, unaudited): ${targets.length} books`);

  const queue = LIMIT ? targets.slice(0, LIMIT) : targets;
  console.log(`Processing: ${queue.length}\n`);

  let confirmed = 0, contradicted = 0, inconclusive = 0, errors = 0, parseFailed = 0;
  let totalIn = 0, totalOut = 0;
  const errSamples = [];

  await processInBatches(queue, async ({ book, claim }) => {
    const title = (book.display_title || book.title || '').slice(0, 55);
    try {
      const r = await auditClaim(book, claim);
      if (r.error === 'parse_failed') {
        parseFailed++;
        console.log(`  PARSE-FAIL  ${title}`);
        if (errSamples.length < 3) errSamples.push(`parse: ${title} — ${r.raw?.slice(0, 100)}`);
        return;
      }
      totalIn += r.tokens?.input || 0;
      totalOut += r.tokens?.output || 0;
      if (r.verdict === 'confirmed') confirmed++;
      else if (r.verdict === 'contradicted') contradicted++;
      else inconclusive++;

      const tag = r.verdict?.toUpperCase().padEnd(11) || 'UNKNOWN    ';
      console.log(`  ${tag} ${title} (${r.confidence})`);
      if (r.verdict === 'contradicted') {
        console.log(`    halluc=${r.suspected_hallucination?.type || 'unknown'}: ${r.suspected_hallucination?.notes?.slice(0, 100) || ''}`);
        if (r.alternative_translation_found) {
          console.log(`    alt: "${r.alternative_translation_found.english_title?.slice(0, 50)}" by ${r.alternative_translation_found.translator}`);
        }
      }

      if (!DRY_RUN) {
        await db.collection('books').updateOne(
          { _id: book._id },
          {
            $set: {
              'translation_verification.verification_audit': {
                audited_at: new Date(),
                model: MODEL,
                audited_claim: {
                  english_title: claim.english_title,
                  translator: claim.translator,
                  pub_year: claim.pub_year,
                  publisher: claim.publisher,
                },
                verdict: r.verdict,
                confidence: r.confidence,
                reasoning: r.reasoning,
                evidence: r.evidence?.slice(0, 5) || [],
                search_queries: r.searchQueries || [],
                suspected_hallucination: r.suspected_hallucination || null,
                alternative_translation_found: r.alternative_translation_found || null,
              },
            },
          }
        );
        await db.collection('gemini_usage').insertOne({
          timestamp: new Date(),
          type: 'translation_audit',
          mode: 'realtime',
          model: MODEL,
          book_id: book.id,
          input_tokens: r.tokens?.input || 0,
          output_tokens: r.tokens?.output || 0,
          cost_usd: ((r.tokens?.input || 0) / 1_000_000) * 0.15 + ((r.tokens?.output || 0) / 1_000_000) * 3.50,
          status: 'success',
          endpoint: 'script/audit-translation-claims',
        });

        // Keep the search. This audit verified a specific CITED prior via real
        // Google-grounded search — record what was queried, what was consulted,
        // and whether a prior was confirmed, so the evidence outlives the run.
        const isoDate = new Date().toISOString();
        const priorFound = r.verdict === 'confirmed' || !!r.alternative_translation_found;
        const prior = r.verdict === 'confirmed'
          ? { english_title: claim.english_title, translator: claim.translator, pub_year: claim.pub_year, publisher: claim.publisher }
          : (r.alternative_translation_found || null);
        const domains = domainsFromEvidence(r.evidence);
        await appendAttempt(db, {
          attempt_id: makeAttemptId(book.id, 'gemini_verifier', isoDate),
          book_id: book.id,
          date: isoDate,
          method: 'gemini_verifier',
          match_key: 'author_title',
          sources_checked: domains,
          queries: r.searchQueries || [],
          result: priorFound ? 'found' : 'none',
          found_refs: [],
          priors: prior ? [prior] : [],
          evidence_strength: priorFound ? 'moderate' : 'weak',
          independence_score: domains.length ? 0.3 : 0.1,
          model: MODEL,
          notes: `[audit ${r.verdict}/${r.confidence}] ${(r.reasoning || '').slice(0, 300)}`.trim(),
          _src: 'audit-translation-claims',
        });
      }
    } catch (err) {
      errors++;
      console.log(`  ERROR       ${title} — ${err.message?.slice(0, 100)}`);
      if (errSamples.length < 3) errSamples.push(`${title}: ${err.message}`);
    }
  }, CONCURRENCY);

  await client.close();

  console.log('\n=== Summary ===');
  console.log(`  Processed: ${queue.length}`);
  console.log(`  Confirmed:    ${confirmed}`);
  console.log(`  Contradicted: ${contradicted}`);
  console.log(`  Inconclusive: ${inconclusive}`);
  console.log(`  Parse fail:   ${parseFailed}`);
  console.log(`  Errors:       ${errors}`);
  console.log(`  Total tokens: in=${totalIn.toLocaleString()} out=${totalOut.toLocaleString()}`);
  const cost = (totalIn / 1_000_000) * 0.15 + (totalOut / 1_000_000) * 3.50;
  console.log(`  Est. cost:    $${cost.toFixed(2)} (+ Google grounding ~$${(queue.length * 0.014).toFixed(2)})`);
  if (errSamples.length) console.log('  Errors:\n   ' + errSamples.join('\n   '));
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
