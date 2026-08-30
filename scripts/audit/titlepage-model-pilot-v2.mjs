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
 * V2 RESULT, 2026-08-14, n=100 per population, gemini-3.1-flash-lite.
 *
 *                     v1 (one page)   v2 (window)
 *   control fired        46/100          61/100
 *   precision            87.0%           90.2%
 *   target yield         24.0%           27.0%
 *   "no author named"    53              37
 *   quote-rejected       25              50
 *
 * WHY IT MOVED — Derek's observation, and it measured out (n=150 books):
 *   41% of books carry MORE THAN ONE page tagged title-page (half-title,
 *      engraved title, letterpress title). Taking the FIRST usually took the
 *      half-title, which by definition carries a short title and no author.
 *   18% have no title-page tag at all, so a single pick fell back silently.
 *   And the title page is not the only attribution surface: a DEDICATION is
 *      normally signed by the author, a PREFACE often is, a COLOPHON names
 *      printer and author. For incunabula and manuscripts it is decisive — the
 *      title page is a 16th-century invention, so earlier books have only the
 *      incipit and explicit.
 * Reading a WINDOW of typed pages instead of one guess converted 16 of those
 * "no author named" verdicts into found authors, and raised precision at the
 * same time: more evidence, not looser rules.
 *
 * The quote guard also got STRICTER and its rejections doubled: a quote must now
 * appear on the page the model CITED, not merely somewhere in the window. A
 * citation pointing at the wrong page is worse than none, because it looks
 * checkable.
 *
 * ADJUDICATING THE 6 DISAGREEMENTS puts real precision near 93%: two are the
 * model right and the CATALOGUE wrong (an Aldine volume catalogued to Manuzio
 * the printer where the page names Ovid; More's Lucian, where Lucian wrote the
 * Opuscula). The residue is now ONE class and it is not a prompt bug: the
 * TRANSLATOR OF THIS EDITION read as the author (Yonge for Bohn's Philo,
 * Musschenbroek for the Tentamina). That is the original-vs-edition distinction
 * this corpus already struggles with elsewhere, and it needs the work graph, not
 * a better sentence in the prompt.
 *
 * Cost: ~1,480 input / ~100 output tokens per book. Projection for the ~4,846
 * target books: ~7.2M in / ~480K out, ~1,300 candidates at ~90% precision.
 *
 * STOP TUNING HERE. Precision is measured against a 100-book control; another
 * prompt iteration judged on the same control is overfitting, not improvement.
 * ═══════════════════════════════════════════════════════════════════════════
 * V1 RESULT, 2026-08-13, n=100 per population.
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
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { attributionWindowOf } from '../lib/title-page-ocr.mjs';
import { sameNameForm, foldOrtho } from '../lib/name-equivalence.mjs';

const N = Number((process.argv.find((a) => a.startsWith('--n=')) || '').split('=')[1] || 100);
const MODELS_ARG = (process.argv.find((a) => a.startsWith('--models=')) || '').split('=')[1] || 'lite,preview';
const LANGS = (process.argv.find((a) => a.startsWith('--languages=')) || '').split('=')[1];
const PROMPT_FILE = (process.argv.find((a) => a.startsWith('--prompt-file=')) || '').split('=')[1];
const PROMPT_VERSION = 'titlepage-role-v3-namedquote';
const MODEL_IDS = { lite: 'gemini-3.1-flash-lite', preview: 'gemini-3-flash-preview' };
const API_KEY = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;
if (!API_KEY) { console.error('No GEMINI_API_KEY'); process.exit(1); }

const PROMPT = `You are reading the FRONT MATTER of an early-modern printed book, transcribed by OCR. You are given SEVERAL pages, each labelled with its page number and the page type the transcriber assigned.

Decide who the book says WROTE it, reading across all the pages given.

Why several pages: 41% of these books carry more than one title page (a half-title, an engraved title, then the full letterpress title) and the half-title names no author. The dedication and preface are usually SIGNED by the author. For an incunable or a manuscript there may be no title page at all, and the incipit or colophon is the only attribution that exists.

For each PERSON named, give the role the text's own grammar assigns:

- "author"     WROTE the work. Latin genitive ("Auli Gellii Noctium Atticarum libri" = Gellius wrote it), or after "auctore", or the signature at the end of a dedication or preface.
- "editor"     corrected, emended, annotated: "recognitus", "emendatus", "a/ab X emendatus" (ablative + participle = X only corrected it).
- "translator" "interprete", "traduit par", "tradotto da", "vertaald door".
- "printer"    "apud X", "excudebat X", "appresso X", "chez X".
- "dedicatee"  the work is dedicated TO them.
- "patron"     named in a privilege, licence or approbation.
- "respondent" defends a dissertation's theses under a presiding praeses.

CRITICAL RULES

1. An OFFICE or a PLACE is not a name. "Consiliario Aulico Hassiaco" is a post. "Illustrissima Signoria di Vinegia" is a state.
2. IGNORE NAMES INSIDE QUOTED OR CITED MATTER. A scriptural proof-text, an epigraph, a marginal citation or a reference to another book names its own author, not this book's. "Paulus" in "in welcher Sinn auch der Paulus schreibet" is a citation. "Terent. Eunuchus." is a reference. "Ezechiel", "Iob", "Matthaeus" appearing beside chapter-and-verse numbers are cited books. None of these is the author of the book in front of you.
3. A pseudonym printed on the page IS the author as the book gives it ("By Eugenius Philalethes"). Report it as printed.
4. ACADEMIC DISPUTATIONS name two people and they are not equals. The PRAESES presides and is conventionally the author ("praeside D. Felice Platero"); the RESPONDENS merely defends the theses in the hall ("defendere conabitur M. Hieronymus Heroldus", "respondens", "tuebitur", "sub praesidio"). Use role "respondent" for the defender, never "author".
5. If nobody is named as the author, return an empty list. That is a NORMAL and CORRECT answer, and far better than a guess.

Give the name in NOMINATIVE (dictionary) form as name_nominative, and as printed as name_as_printed. Cite the PAGE NUMBER you read it from.

Return ONLY JSON:
{"names":[{"name_nominative":"...","name_as_printed":"...","role":"author","page":<the page number>,"quoted_line":"<exact text from THAT page>","confidence":"high|medium|low"}]}

quoted_line must be copied verbatim from the page you cite in "page". An entry whose quote is not found on the page it cites will be discarded.`;

/** Render the candidate window as labelled pages. */
function tp_render(win) {
  return win.map((w) => `--- PAGE ${w.page_number} [${w.page_type}${w.untyped_fallback ? ', UNTYPED GUESS' : ''}] ---\n${w.prose.slice(0, 2600)}`).join('\n\n');
}

const ACTIVE_PROMPT = PROMPT_FILE ? readFileSync(new URL(PROMPT_FILE, import.meta.url), 'utf8') : PROMPT;
const ai = new GoogleGenAI({ apiKey: API_KEY });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readTitlePage(model, prose, tries = 3) {
  let res;
  for (let i = 0; i < tries; i++) {
    try {
      res = await ai.models.generateContent({
        model,
        contents: `${ACTIVE_PROMPT}\n\n${prose}`,
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
  const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  const q = norm(quote);
  if (q.length < 4) return false;
  return norm(prose).includes(q);
}

/**
 * Does the quoted line actually NAME the person it is cited for?
 *
 * The on-page check above proves the quote is real. It does not prove the quote
 * is EVIDENCE. A line can be verbatim from the page and still not mention the
 * person: Francisco Hernández was cited to "Médico e Historiador de Su Majestad
 * Felipe II, Rey de España y de las Indias" — true text, no name in it. That is
 * worse than no citation, because it looks checkable.
 *
 * Returns true / false / null, and NULL IS NOT FALSE. The first cut of this
 * check flagged 7 rows and 5 were its own blindness, not bad citations —
 * "Boetii" vs "Boethius" (th/t), "ABDALLAH BEN AHMED" vs "Abd Allah ibn Ahmad"
 * (transliteration), and a Devanagari quote that folds to nothing. Rejecting
 * those would discard correct evidence for being written in another script,
 * which is the same mistake as reading an empty token set as disagreement.
 */
function quoteSupportsName(quote, name) {
  const latinShare = (x) => {
    const L = String(x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/\p{L}/gu) || [];
    return L.length ? L.filter((ch) => /[a-zA-Z]/.test(ch)).length / L.length : 0;
  };
  // Either side substantially non-Latin: fold() empties it, so abstain.
  if (latinShare(quote) < 0.6 || latinShare(name) < 0.6) return null;
  const q = foldOrtho(quote);
  const parts = foldOrtho(name).split(' ').filter((w) => w.length >= 4);
  if (!q || !parts.length) return null;
  // A 4-char prefix absorbs declension and abbreviation without merging people:
  // "boethius" -> "boet" matches "opera boetii"; "allah" matches "abdallah".
  return parts.some((p) => q.includes(p.slice(0, 4)));
}

/**
 * THIS COMPARATOR CANNOT JUDGE A NON-LATIN CORPUS, and it will not tell you so.
 *
 * `foldOrtho` strips non-Latin to the empty string, so a bare CJK catalogued
 * name — 薛己, 魏源, 吳士玉, 章潢 — folds to "" and scores as a MISMATCH against
 * a correct romanised proposal, by construction. On the non-Latin control, 12 of
 * 30 rows had one side fold to empty; only 17 were genuinely judgeable, and the
 * headline it produced (42.9%) was a floor rather than an estimate. Hand
 * adjudication put the real figure nearer 52%.
 *
 * Two of the rows it scored as disagreements were the prompt working perfectly:
 *   茅元儀 → Mao Yuanyi   from 「防風茅元儀輯」  (輯 = compiled)
 *   江少虞 → Jiang Shaoyu from 「宋江少虞撰」   (撰 = composed)
 *
 * Before quoting any non-Latin precision number, give this function a way to
 * compare across scripts — a romanisation table, or the thesaurus variants,
 * which already hold both forms for many people. Until then every non-Latin
 * figure out of this file is a LOWER BOUND and must be reported as one.
 */
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

/**
 * PIN THE SAMPLE, or no two runs are comparable.
 *
 * $sample draws a fresh 100 books every run, so a change in the headline mixes
 * the effect of the change with sampling noise — and at n~55 fired the standard
 * error on precision is around 4 points, which is larger than any improvement
 * measured here so far. The v1-to-v2 comparison in this branch was reported as
 * if it were an effect; it was two different sets of books and cannot carry that
 * claim. Pinning is the fix: draw once, reuse, and compare prompts on identical
 * books.
 */
const SAMPLE_FILE = (process.argv.find((a) => a.startsWith('--sample-file=')) || '').split('=')[1] || 'scripts/output/titlepage-pilot-sample.json';
let pinned = null;
if (existsSync(SAMPLE_FILE)) {
  pinned = JSON.parse(readFileSync(SAMPLE_FILE, 'utf8'));
  if (pinned.n !== N) { console.log(`  pinned sample is n=${pinned.n}, requested ${N} — ignoring the pin`); pinned = null; }
  else console.log(`  reusing pinned sample from ${SAMPLE_FILE} (drawn ${pinned.drawn_at})`);
}

const control = pinned ? await books.find({ id: { $in: pinned.control } }, { projection: { id: 1, title: 1, author: 1, author_id: 1 } }).toArray() : await books.aggregate([
  { $match: { ...TEXT_VISIBLE, author_id: { $in: [...byId.keys()] }, author: { $type: 'string', $ne: '' }, ...(LANGS ? { language: { $in: LANGS.split(',').map((x) => x.trim()) } } : {}) } },
  { $sample: { size: N } }, { $project: { id: 1, title: 1, author: 1, author_id: 1 } },
]).toArray();
const target = pinned ? await books.find({ id: { $in: pinned.target } }, { projection: { id: 1, title: 1, author: 1 } }).toArray() : await books.aggregate([
  { $match: { ...TEXT_VISIBLE, $or: [{ author_id: { $in: [null] } }, { author_id: { $exists: false } }], ...(LANGS ? { language: { $in: LANGS.split(',').map((x) => x.trim()) } } : {}) } },
  { $sample: { size: N } }, { $project: { id: 1, title: 1, author: 1 } },
]).toArray();

if (!pinned) {
  mkdirSync('scripts/output', { recursive: true });
  writeFileSync(SAMPLE_FILE, JSON.stringify({ n: N, drawn_at: new Date().toISOString(), control: control.map((b) => b.id), target: target.map((b) => b.id) }, null, 1));
  console.log(`  drew a NEW sample and pinned it to ${SAMPLE_FILE} — later runs will reuse it`);
}

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
    const win = await attributionWindowOf(pagesCol, b);
    if (!win.length) { missing++; continue; }
    out.push({ book: b, win });
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
    for (const { book: b, win } of prepared) {
      const rendered = tp_render(win);
      let out;
      try { out = await readTitlePage(model, rendered); }
      catch (e) { s[pop].call_failed = (s[pop].call_failed ?? 0) + 1; console.error('  model error after retries:', e.message?.slice(0, 80)); continue; }
      s.tokens_in += out.usage?.promptTokenCount ?? 0;
      s.tokens_out += out.usage?.candidatesTokenCount ?? 0;
      if (out.parse_failed) { s[pop].parse_failed = (s[pop].parse_failed ?? 0) + 1; continue; }

      // Discard anything that cannot quote a line that is really on the page.
      const proseByPage = new Map(win.map((w) => [String(w.page_number), w.prose]));
      const allProse = win.map((w) => w.prose).join(' \n ');
      // The quote must be on the page the model CITED. Checking against the whole
      // window would let it cite p1 for a line printed on p7 — a citation that
      // points at the wrong page is worse than none, because it looks checkable.
      const cited = out.names.filter((x) => {
        const onCited = proseByPage.has(String(x.page)) && quoteIsOnPage(x.quoted_line, proseByPage.get(String(x.page)));
        if (onCited) return true;
        if (quoteIsOnPage(x.quoted_line, allProse)) { x.page_mismatch = true; }
        return false;
      });
      const dropped = out.names.length - cited.length;
      if (dropped) s[pop].quote_rejected += dropped;

      // Second gate: the quote must NAME the person. Unjudged (null) passes but
      // is recorded, so "we could not check this one" never reads as "checked".
      const supported = cited.filter((x) => {
        const v = quoteSupportsName(x.quoted_line, x.name_nominative);
        x.quote_supports = v;
        if (v === false) { s[pop].quote_unsupported = (s[pop].quote_unsupported ?? 0) + 1; return false; }
        if (v === null) s[pop].quote_unjudged = (s[pop].quote_unjudged ?? 0) + 1;
        return true;
      });
      const authors = supported.filter((x) => String(x.role).toLowerCase() === 'author');
      if (!authors.length) { s[pop].no_author++; continue; }
      s[pop].fired++;

      for (const a of authors) {
        evidence.push({
          run_at: runAt, model, prompt_version: PROMPT_VERSION, population: pop,
          book_id: b.id, page_number: Number(a.page), page_type: (win.find((w) => String(w.page_number) === String(a.page)) || {}).page_type ?? null,
          window_pages: win.map((w) => `${w.page_number}:${w.page_type}`).join(','),
          title: String(b.title).slice(0, 120), catalogued_author: b.author ?? null,
          proposed: a.name_nominative, as_printed: a.name_as_printed,
          role: a.role, quoted_line: a.quoted_line, model_confidence: a.confidence,
          quote_supports_name: a.quote_supports,
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
  console.log(`            proposals DROPPED, quote not on cited page : ${s.control.quote_rejected}`);
  console.log(`            proposals DROPPED, quote does not name them: ${s.control.quote_unsupported ?? 0}`);
  console.log(`            kept but UNJUDGED (other script)           : ${s.control.quote_unjudged ?? 0}`);
  console.log(`   TARGET   named an author on ${s.target.fired}/${target.length}   ← YIELD ${((100 * s.target.fired) / target.length).toFixed(1)}%`);
  console.log(`            page names no author: ${s.target.no_author}   quote not on page: ${s.target.quote_rejected}   does not name them: ${s.target.quote_unsupported ?? 0}   unjudged: ${s.target.quote_unjudged ?? 0}`);
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
