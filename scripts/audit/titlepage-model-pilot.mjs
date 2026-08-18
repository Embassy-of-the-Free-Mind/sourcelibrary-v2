#!/usr/bin/env node
/**
 * PAID PILOT: read the title page with a model, and make every answer CITE.
 *
 * The regex pilot (`titlepage-ocr-pilot.mjs`) returned a hard negative: it fires
 * on ~5% of title pages, and when it fires it captures offices and dedicatees
 * ("Consiliario Aulico Hassiaco" = Wolff's post; "Papa Leone" = a dedicatee)
 * because a pattern cannot tell an office from a person in the same grammatical
 * slot. Reading a title page is a reading task.
 *
 * THE PROVENANCE REQUIREMENT IS THE POINT, not a nicety. `ai_metadata.author`
 * is a bare assertion — no pointer to what it was read from — and that is the
 * whole reason #3949 had to exist: with no evidence attached, a description
 * about a different book is indistinguishable from a good one until someone
 * builds a detector to guess. So every name here must come back with:
 *
 *   role          author | editor | translator | printer | dedicatee | patron
 *   quoted_line   the EXACT text on the page it was read from
 *   book + page   a stable pointer to the scan a human can open
 *   model + prompt_version + run date
 *
 * A proposal that cannot quote its own line is discarded here, unread. That
 * turns "the model says Bodin" into "page 3 says *auctore Ioanne Bodino*", which
 * is checkable by a person in ten seconds and stays checkable in a year.
 *
 * WRITES NOTHING TO MONGO. Output is a JSONL of evidence under scripts/output/.
 * Writing to a store a cron reads is actuation, not recording — the nightly
 * first-translation loop removed three public badges seven hours after a session
 * reported "nothing written" (#3776).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * RESULT, 2026-08-13, n=100 per population.
 *
 *   gemini-3.1-flash-lite   CONTROL fired 46/100, agreed 40 → precision 87.0%
 *                           TARGET  yield 24/100
 *                           53 pages correctly reported NO author named
 *                           25 proposals DROPPED for an unverifiable quote
 *                           ~645 input / ~107 output tokens per book
 *
 * Against the regex pass on the same populations (3.3% yield, fires on ~5% of
 * pages, captures offices and dedicatees) this is a different instrument.
 *
 * ADJUDICATING THE 6 DISAGREEMENTS raises real precision to ~91%: TWO of them
 * are the model being right and the CATALOGUE being wrong — *Magia adamica* is
 * signed "By Eugenius Philalethes", which is Vaughan's own pseudonym, and the
 * Mahabharata page names Vyasa where the catalogue records its translators. The
 * remaining four are ONE fixable class: a name inside a QUOTATION, epigraph or
 * scriptural citation read as the author ("Paulus" from a sermon's proof-text,
 * "Terentius" from an epigraph, and ten biblical book names lifted out of a
 * medieval commentary's citations). Next prompt version should exclude names
 * appearing inside quoted or cited matter.
 *
 * THE gemini-3-flash-preview ARM IS INVALID — do not read it as a comparison.
 * 44 of 100 responses failed to parse, so its "100% on 14" describes the 56
 * calls that survived, not the model. It emits reasoning before the JSON and
 * 1200 maxOutputTokens truncates it. Re-run with a raised cap and an explicit
 * thinkingBudget before comparing anything.
 *
 * PROJECTION for the ~4,846-book target population at flash-lite rates:
 * ~3.1M input / ~520K output tokens, and roughly 1,160 candidates at ~90%
 * precision. Every one of them arrives with a page number and a quoted line.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/titlepage-model-pilot.mjs --n=100
 *   node --env-file=.env.production.local scripts/audit/titlepage-model-pilot.mjs --n=100 --models=lite,preview
 */
import { MongoClient } from 'mongodb';
import { GoogleGenAI } from '@google/genai';
import { writeFileSync, mkdirSync } from 'node:fs';
import { titlePageOf } from '../lib/title-page-ocr.mjs';
import { sameNameForm, foldOrtho } from '../lib/name-equivalence.mjs';

const N = Number((process.argv.find((a) => a.startsWith('--n=')) || '').split('=')[1] || 100);
const MODELS_ARG = (process.argv.find((a) => a.startsWith('--models=')) || '').split('=')[1] || 'lite,preview';
const PROMPT_VERSION = 'titlepage-role-v1';
const MODEL_IDS = { lite: 'gemini-3.1-flash-lite', preview: 'gemini-3-flash-preview' };
const API_KEY = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('No GEMINI_API_KEY'); process.exit(1); }

const PROMPT = `You are reading the TITLE PAGE of an early-modern printed book, transcribed by OCR.

List every PERSON named on the page. For each, give the role the page's own grammar assigns — this is the whole task, so be strict about it:

- "author"     the person who WROTE the work. Latin puts them in the genitive ("Auli Gellii Noctium Atticarum libri" = Gellius wrote it) or after "auctore".
- "editor"     corrected, emended, annotated, "recognitus", "emendatus", "a/ab X emendatus" (ablative + participle = X only corrected it).
- "translator" "interprete", "traduit par", "tradotto da", "vertaald door".
- "printer"    printed, published, "apud X", "excudebat X", "appresso X", "chez X".
- "dedicatee"  the work is dedicated TO them.
- "patron"     a ruler or official named in a privilege, licence or approbation.

CRITICAL: an OFFICE or a PLACE is not a person's name. "Consiliario Aulico Hassiaco" is a post, not a name. "Illustrissima Signoria di Vinegia" is a state. "Papa Leone" in a dedication is a dedicatee, never the author. Do not invent a role to fill the author slot — if nobody on the page is named as the author, return an empty list. A page with no author named is a NORMAL and CORRECT answer.

Give the name in its NOMINATIVE form (the dictionary form) as name_nominative, and also the form exactly as printed as name_as_printed.

Return ONLY JSON:
{"names":[{"name_nominative":"...","name_as_printed":"...","role":"author","quoted_line":"<the exact text on the page you read this from>","confidence":"high|medium|low"}]}

Every entry MUST include quoted_line copied verbatim from the page text. An entry without it will be discarded.`;

const ai = new GoogleGenAI({ apiKey: API_KEY });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readTitlePage(model, prose, tries = 3) {
  let res;
  for (let i = 0; i < tries; i++) {
    try {
      res = await ai.models.generateContent({
        model,
        contents: `${PROMPT}\n\n--- TITLE PAGE TEXT ---\n${prose.slice(0, 6000)}`,
        config: { temperature: 0, maxOutputTokens: 1200 },
      });
      break;
    } catch (e) {
      // A transient `fetch failed` dropped 4 calls on the first full run. Silent
      // loss here is not neutral: it shrinks the denominator invisibly and makes
      // the pilot look more decisive than it is.
      if (i === tries - 1) throw e;
      await sleep(1500 * (i + 1));
    }
  }
  let text = (res.text ?? '').trim();
  if (text.startsWith('```')) text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  let parsed;
  try { parsed = JSON.parse(text); } catch { return { names: [], parse_failed: true, usage: res.usageMetadata }; }
  const names = Array.isArray(parsed?.names) ? parsed.names : [];
  return { names, usage: res.usageMetadata };
}

/**
 * A proposal must quote a line that is ACTUALLY ON THE PAGE. This is the guard
 * that makes the provenance real rather than decorative: a fabricated citation
 * is the exact failure mode a "cite your evidence" instruction invites, and
 * checking it costs a substring test.
 */
function quoteIsOnPage(quote, prose) {
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  const q = norm(quote);
  if (q.length < 6) return false;
  return norm(prose).includes(q);
}

function agrees(extracted, knownName, knownDoc) {
  if (!extracted) return false;
  if (sameNameForm(extracted, knownName)) return true;
  for (const v of knownDoc?.variants ?? []) if (sameNameForm(extracted, v)) return true;
  const a = foldOrtho(extracted).split(' ');
  const b = foldOrtho(knownName).split(' ');
  return a.some((x) => x.length >= 5 && b.some((y) => y.length >= 5 && (x.startsWith(y.slice(0, 5)) || y.startsWith(x.slice(0, 5)))));
}

const mc = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });
await mc.connect();
const db = mc.db('bookstore');
const books = db.collection('books');
const pagesCol = db.collection('pages');
const authorsCol = db.collection('authors');
const TEXT_VISIBLE = { visible: true, resource_type: { $exists: false }, pages_ocr: { $gt: 0 } };

const anchored = await authorsCol.find(
  { $or: [{ viaf_id: { $nin: [null, ''] } }, { wikidata_id: { $nin: [null, ''] } }] },
  { projection: { _id: 1, canonical_name: 1, variants: 1 } },
).toArray();
const byId = new Map(anchored.map((a) => [a._id, a]));

const control = await books.aggregate([
  { $match: { ...TEXT_VISIBLE, author_id: { $in: [...byId.keys()] }, author: { $type: 'string', $ne: '' } } },
  { $sample: { size: N } }, { $project: { id: 1, title: 1, author: 1, author_id: 1 } },
]).toArray();
const target = await books.aggregate([
  { $match: { ...TEXT_VISIBLE, $or: [{ author_id: { $in: [null] } }, { author_id: { $exists: false } }] } },
  { $sample: { size: N } }, { $project: { id: 1, title: 1, author: 1 } },
]).toArray();

// Resolve every title page BEFORE any model call, then close Mongo.
//
// The first full run died on `MongoNetworkTimeoutError` partway through: the
// driver's connection sat idle through hundreds of multi-second model calls and
// was reaped. Interleaving a fast store with a slow API is the bug — batch the
// store work, finish with it, then go slow. It is also several times quicker.
async function resolvePages(rows, label) {
  const out = [];
  let missing = 0;
  for (const b of rows) {
    const tp = await titlePageOf(pagesCol, b);
    if (!tp) { missing++; continue; }
    out.push({ book: b, tp });
  }
  console.log(`  ${label}: ${out.length} title pages resolved, ${missing} without OCR pages`);
  return { rows: out, missing };
}

console.log('resolving title pages…');
const controlPages = await resolvePages(control, 'control');
const targetPages = await resolvePages(target, 'target');
await mc.close();
console.log('Mongo closed; starting model calls.\n');

const runAt = new Date().toISOString();
const evidence = [];
const stats = {};

for (const key of MODELS_ARG.split(',').map((s) => s.trim()).filter(Boolean)) {
  const model = MODEL_IDS[key];
  if (!model) continue;
  const s = { model, control: { fired: 0, agree: 0, disagree: 0, no_author: 0, no_page: 0, quote_rejected: 0, parse_failed: 0 }, target: { fired: 0, no_author: 0, no_page: 0, quote_rejected: 0 }, tokens_in: 0, tokens_out: 0 };
  const disagreements = [];

  s.control.no_page = controlPages.missing;
  s.target.no_page = targetPages.missing;
  for (const [pop, prepared] of [['control', controlPages.rows], ['target', targetPages.rows]]) {
    for (const { book: b, tp } of prepared) {
      let out;
      try { out = await readTitlePage(model, tp.prose); }
      catch (e) { s[pop].call_failed = (s[pop].call_failed ?? 0) + 1; console.error('  model error after retries:', e.message?.slice(0, 80)); continue; }
      s.tokens_in += out.usage?.promptTokenCount ?? 0;
      s.tokens_out += out.usage?.candidatesTokenCount ?? 0;
      if (out.parse_failed) { s[pop].parse_failed = (s[pop].parse_failed ?? 0) + 1; continue; }

      // Discard anything that cannot quote a line that is really on the page.
      const cited = out.names.filter((x) => quoteIsOnPage(x.quoted_line, tp.prose));
      const dropped = out.names.length - cited.length;
      if (dropped) s[pop].quote_rejected += dropped;

      const authors = cited.filter((x) => String(x.role).toLowerCase() === 'author');
      if (!authors.length) { s[pop].no_author++; continue; }
      s[pop].fired++;

      for (const a of authors) {
        evidence.push({
          run_at: runAt, model, prompt_version: PROMPT_VERSION, population: pop,
          book_id: b.id, page_number: tp.page_number, page_picked_via: tp.via,
          title: String(b.title).slice(0, 120), catalogued_author: b.author ?? null,
          proposed: a.name_nominative, as_printed: a.name_as_printed,
          role: a.role, quoted_line: a.quoted_line, model_confidence: a.confidence,
        });
      }
      if (pop === 'control') {
        const known = byId.get(b.author_id);
        const hit = authors.find((a) => agrees(a.name_nominative, b.author, known));
        if (hit) s.control.agree++;
        else {
          s.control.disagree++;
          if (disagreements.length < 12) disagreements.push({ title: String(b.title).slice(0, 50), known: b.author, got: authors.map((a) => `${a.name_nominative} «${String(a.quoted_line).slice(0, 46)}»`).join(' | ') });
        }
      }
    }
  }
  s.disagreements = disagreements;
  stats[key] = s;
}

mkdirSync('scripts/output', { recursive: true });
const outPath = `scripts/output/titlepage-model-pilot-${runAt.slice(0, 10)}.jsonl`;
writeFileSync(outPath, evidence.map((e) => JSON.stringify(e)).join('\n') + '\n');

console.log(`\n══ title-page attribution by model — pilot (n=${N} per population) ══`);
console.log(`   prompt ${PROMPT_VERSION} · every proposal must quote a line verified present on the page\n`);
for (const [key, s] of Object.entries(stats)) {
  const judged = s.control.agree + s.control.disagree;
  console.log(`── ${s.model}`);
  console.log(`   CONTROL  named an author on ${s.control.fired}/${control.length}`);
  console.log(`            agrees ${s.control.agree}  disagrees ${s.control.disagree}   ← PRECISION ${judged ? ((100 * s.control.agree) / judged).toFixed(1) + '%' : 'n/a'}`);
  console.log(`            page names no author: ${s.control.no_author}   no OCR page: ${s.control.no_page}   parse fail: ${s.control.parse_failed ?? 0}`);
  console.log(`            proposals DROPPED for an unverifiable quote: ${s.control.quote_rejected}`);
  console.log(`   TARGET   named an author on ${s.target.fired}/${target.length}   ← YIELD ${((100 * s.target.fired) / target.length).toFixed(1)}%`);
  console.log(`            page names no author: ${s.target.no_author}   quote-rejected: ${s.target.quote_rejected}`);
  console.log(`   tokens   in ${s.tokens_in.toLocaleString()}  out ${s.tokens_out.toLocaleString()}`);
  if (s.disagreements.length) {
    console.log('   disagreements (some are the extractor, some are the CATALOGUE):');
    for (const d of s.disagreements) {
      console.log(`     ${d.title}`);
      console.log(`        catalogued: ${d.known}`);
      console.log(`        page says : ${d.got}`);
    }
  }
  console.log();
}
console.log(`evidence written: ${outPath}  (${evidence.length} rows) — NOT written to Mongo`);
