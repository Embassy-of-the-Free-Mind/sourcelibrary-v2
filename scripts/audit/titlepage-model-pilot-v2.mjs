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
 *   node --env-file=.env.production.local scripts/audit/titlepage-model-pilot-v2.mjs --imprint --draw|--build|--submit|--collect   (#7201, see below)
 */
import { MongoClient } from 'mongodb';
import { GoogleGenAI } from '@google/genai';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { attributionWindow, attributionWindowOf } from '../lib/title-page-ocr.mjs';
import { sameNameForm, foldOrtho } from '../lib/name-equivalence.mjs';
import { quoteIsOnPage, quoteSupportsName } from '../lib/titlepage-imprint.mjs';

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

// quoteIsOnPage / quoteSupportsName live in scripts/lib/titlepage-imprint.mjs (shared with --imprint, #7201).

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

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * --imprint (#7201): the FULL imprint, and an IMAGE mode for books with no OCR.
 *
 * Same contract as the author pilot above: every field cites its page and its quoted line, and a field that
 * cannot is dropped before anyone sees it (guards in scripts/lib/titlepage-imprint.mjs). Fields: title, names
 * with role, date, place, printer/publisher, edition statement, and which page is the title page.
 *
 *   text   books with OCR: the typed attribution window (attributionWindowOf), as in the author pilot.
 *   image  books with NO OCR: the first leaves as images (typed covers/blanks skipped where a type is known).
 *
 * Model: gemini-3.1-flash-lite only, through the Batch API. Steps, each re-runnable:
 *   --imprint --draw [--seed=7201 --n-image=100 --n-text=100 --exclude=<old imprint-sample.json>]   seeded draw, stratified by language × century
 *   --imprint --build                                           window + images per book, request file, ESTIMATE
 *   --imprint --submit [--cap=10]                               refuses if spent + estimate > cap
 *   --imprint --collect                                         results → guards → evidence JSONL
 *   --imprint --recheck                                         re-run the guards over stored replies (no model call)
 *   --imprint --packet [--chunks=4]                             labelling sheets for the by-eye check
 *   --imprint --score                                           precision / recall from labels-*.jsonl
 * Output goes to --out-dir (default scripts/output/titlepage-imprint). WRITES NOTHING TO `books`: the only
 * Mongo writes are the `batch_jobs` eval registration (eval-batch-registry.mjs) and the gemini_usage row.
 * ═══════════════════════════════════════════════════════════════════════════
 */
if (process.argv.includes('--imprint')) {
  const { IMPRINT_FIELDS: IMPRINT_FIELDS_LIST, GUARD_VERSION, imprintPrompt, IMPRINT_SCHEMA, IMPRINT_PROMPT_VERSION, parseImprintReply, checkImprint, imageWindow, boundedImageUrl } = await import('../lib/titlepage-imprint.mjs');
  const { getPageSource } = await import('../lib/page-image-url.mjs');
  const { makeRng } = await import('../eval/lib/paired-stats.mjs');
  const { priceFor, BATCH_MULTIPLIER, noThinkingConfig } = await import('../lib/model-pricing.mjs');
  const { uploadBatchInputFile, createThenDeleteInput, streamBatchResponses } = await import('../lib/gemini-batch-input-file.mjs');
  const { registerEvalBatch, closeEvalBatch } = await import('../lib/eval-batch-registry.mjs');
  const sharp = (await import('sharp')).default;
  const fs = await import('node:fs');
  const path = await import('node:path');

  const opt = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=').slice(1).join('=') : d; };
  const MODEL = 'gemini-3.1-flash-lite';
  const ENDPOINT = 'scripts/audit/titlepage-model-pilot-v2.mjs --imprint';
  const OUT = opt('out-dir', 'scripts/output/titlepage-imprint');
  const SAMPLE = path.join(OUT, 'imprint-sample.json');
  const MANIFEST = path.join(OUT, 'imprint-manifest.json');
  const REQUESTS = path.join(OUT, 'imprint-requests.jsonl');
  const LEDGER = path.join(OUT, 'imprint-ledger.json');
  const EVIDENCE = path.join(OUT, 'imprint-evidence.jsonl');
  const IMG_DIR = path.join(OUT, 'img');
  const IMAGE_PAGES = Number(opt('image-pages', 8));
  // Gemini 3.x bills an image at its default media resolution as ~1,120 input tokens; the estimate uses that and
  // --collect reports what was actually billed.
  const TOKENS_PER_IMAGE = 1120;
  fs.mkdirSync(IMG_DIR, { recursive: true });
  const readJson = (f, d) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : d);
  const ledger = () => readJson(LEDGER, { cap_usd: Number(opt('cap', 10)), jobs: [] });
  const spentOf = (L) => L.jobs.reduce((s, j) => s + (j.cost_usd ?? j.estimate_usd ?? 0), 0);
  const scansOnly = { $or: [{ pages_ocr: 0 }, { pages_ocr: { $exists: false } }, { pages_ocr: null }] };

  const centuryOf = (b) => {
    const y = Number.isInteger(b.year) ? b.year : Number((String(b.published ?? '').match(/(?<!\d)(1[0-9]{3}|20[0-2][0-9])(?!\d)/) || [])[1]);
    if (!y) return 'undated';
    if (y < 1500) return 'pre-1500';
    if (y >= 1900) return '1900+';
    return `${Math.floor(y / 100) + 1}c`;
  };

  /**
   * Seeded, stratified by language × century, PROPORTIONAL to the pool (largest remainder), so the precision it
   * measures is the precision a full run over that pool would see. Each stratum's shuffled tail is kept as its
   * reserve: a book whose leaves cannot be fetched is replaced from its own stratum, not from anywhere.
   */
  function stratifiedDraw(pool, n, rng, langOf) {
    const strata = new Map();
    for (const b of pool) {
      const k = `${langOf(b)}|${centuryOf(b)}`;
      if (!strata.has(k)) strata.set(k, []);
      strata.get(k).push(b);
    }
    const keys = [...strata.keys()].sort();
    for (const k of keys) {
      const a = strata.get(k);
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    }
    const quota = keys.map((k) => ({ k, exact: (n * strata.get(k).length) / pool.length }));
    for (const q of quota) q.take = Math.floor(q.exact);
    let left = n - quota.reduce((s, q) => s + q.take, 0);
    for (const q of [...quota].sort((x, y) => (y.exact - y.take) - (x.exact - x.take) || (x.k < y.k ? -1 : 1))) { if (left-- <= 0) break; q.take++; }
    const picks = []; const reserve = {};
    for (const q of quota) {
      const a = strata.get(q.k);
      for (const b of a.slice(0, q.take)) picks.push({ id: b.id, stratum: q.k });
      reserve[q.k] = a.slice(q.take, q.take + 10).map((b) => b.id);
    }
    return { picks, reserve, strata: Object.fromEntries(keys.map((k) => [k, strata.get(k).length])) };
  }

  const fetchJpeg = async (url) => {
    const res = await fetch(boundedImageUrl(url), { headers: { 'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org) titlepage-imprint-7201' }, signal: AbortSignal.timeout(45000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return sharp(buf).rotate().resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  };

  const mc2 = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 });

  if (process.argv.includes('--draw')) {
    await mc2.connect();
    const B = mc2.db('bookstore').collection('books');
    const proj = { projection: { _id: 0, id: 1, language: 1, year: 1, published: 1, visible: 1, 'pipeline_auto.hold.reason': 1 } };
    // --exclude=<earlier imprint-sample.json>[,…]: a FRESH draw never re-reads a book an earlier draw labelled.
    const excluded = new Set(String(opt('exclude', '')).split(',').filter(Boolean)
      .flatMap((f) => { const x = readJson(f, null); if (!x) throw new Error(`--exclude: no sample at ${f}`); return [...x.image, ...x.text].map((p) => p.id); }));
    const notExcluded = (b) => !excluded.has(b.id);
    const imagePool = (await B.find({ pages_count: { $gte: 4 }, resource_type: { $exists: false }, ...scansOnly }, proj).toArray()).filter(notExcluded);
    const textPool = (await B.find({ visible: true, resource_type: { $exists: false }, pages_ocr: { $gt: 0 } }, proj).toArray()).filter(notExcluded);
    await mc2.close();
    if (excluded.size) console.log(`excluded ${excluded.size} books drawn before`);
    // #7176 published the hidden Latin/Chinese scans-only books (16,266, held as `scans-only-publish-7176`).
    const in7176 = (b) => b.pipeline_auto?.hold?.reason === 'scans-only-publish-7176' || (b.visible === true && /^(latin|chinese)$/i.test(b.language ?? ''));
    const topLangs = (pool) => { const c = {}; for (const b of pool) c[b.language ?? 'unknown'] = (c[b.language ?? 'unknown'] ?? 0) + 1; return new Set(Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([l]) => l)); };
    const seed = Number(opt('seed', 7201));
    const rng = makeRng(seed);
    const nImage = Number(opt('n-image', 100)); const nText = Number(opt('n-text', 100));
    const n7176 = Number(opt('n-7176', Math.round(nImage * 0.4)));
    const pool7176 = imagePool.filter(in7176); const poolOther = imagePool.filter((b) => !in7176(b));
    const L1 = topLangs(pool7176), L2 = topLangs(poolOther), L3 = topLangs(textPool);
    const langIn = (L) => (b) => (L.has(b.language ?? 'unknown') ? b.language ?? 'unknown' : 'other');
    const d1 = stratifiedDraw(pool7176, n7176, rng, langIn(L1));
    const d2 = stratifiedDraw(poolOther, nImage - n7176, rng, langIn(L2));
    const d3 = stratifiedDraw(textPool, nText, rng, langIn(L3));
    const sample = {
      issue: 7201, seed, drawn_at: new Date().toISOString(),
      pools: { image_7176: pool7176.length, image_other: poolOther.length, text: textPool.length },
      image: [...d1.picks.map((p) => ({ ...p, group: '7176' })), ...d2.picks.map((p) => ({ ...p, group: 'scans-only-other' }))],
      text: d3.picks.map((p) => ({ ...p, group: 'transcribed' })),
      reserve: { '7176': d1.reserve, 'scans-only-other': d2.reserve, transcribed: d3.reserve },
      strata: { '7176': d1.strata, 'scans-only-other': d2.strata, transcribed: d3.strata },
    };
    fs.writeFileSync(SAMPLE, JSON.stringify(sample, null, 1));
    console.log(`pools: #7176 scans-only ${pool7176.length}, other scans-only ${poolOther.length}, transcribed ${textPool.length}`);
    console.log(`drew ${sample.image.length} image + ${sample.text.length} text (seed ${seed}) → ${SAMPLE}`);
    process.exit(0);
  }

  if (process.argv.includes('--build')) {
    const sample = readJson(SAMPLE, null);
    if (!sample) { console.error(`no sample at ${SAMPLE}; run --draw first`); process.exit(1); }
    await mc2.connect();
    const db2 = mc2.db('bookstore');
    const B = db2.collection('books'); const P = db2.collection('pages');
    const pproj = { projection: { _id: 0, id: 1, page_number: 1, page_type: 1, photo: 1, archived_photo: 1, photo_original: 1, cropped_photo: 1, split_from_spread: 1, enhanced_photo: 1, 'ocr.data': 1, 'ocr.text': 1 } };
    const manifest = { built_at: new Date().toISOString(), prompt_version: IMPRINT_PROMPT_VERSION, model: MODEL, books: [], skipped: [] };
    const out = fs.createWriteStream(REQUESTS);
    const genCfg = { temperature: 0, maxOutputTokens: 2500, responseMimeType: 'application/json', responseSchema: IMPRINT_SCHEMA, ...(noThinkingConfig(MODEL) ? { thinkingConfig: noThinkingConfig(MODEL) } : {}) };
    let estIn = 0;
    const saveImages = async (bookId, pages) => {
      const got = [];
      for (const p of pages) {
        const f = path.join(IMG_DIR, bookId, `${p.page_number}.jpg`);
        if (!fs.existsSync(f)) {
          const url = getPageSource(p);
          if (!url) continue;
          try { const jpg = await fetchJpeg(url); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, jpg); } catch (e) { continue; }
        }
        got.push({ page_number: p.page_number, file: f, url: getPageSource(p) });
      }
      return got;
    };
    for (const mode of ['image', 'text']) {
      const want = (mode === 'image' ? sample.image : sample.text).length;
      const queue = (mode === 'image' ? sample.image : sample.text).map((x) => ({ ...x }));
      const reserves = sample.reserve;
      let kept = 0;
      while (queue.length && kept < want) {
        const s = queue.shift();
        const book = await B.findOne({ id: s.id }, { projection: { _id: 0, id: 1, title: 1, author: 1, published: 1, year: 1, place_published: 1, publisher: 1, language: 1, pages_count: 1, pages_ocr: 1, slug: 1 } });
        const replace = (why) => {
          manifest.skipped.push({ id: s.id, mode, stratum: s.stratum, why });
          const r = reserves[s.group]?.[s.stratum];
          if (r?.length) queue.unshift({ ...s, id: r.shift(), replaced: s.id });
        };
        if (!book) { replace('book not found'); continue; }
        const pages = await P.find({ book_id: book.id, page_number: { $gte: 1, $lte: 20 } }, pproj).sort({ page_number: 1 }).toArray();
        if (mode === 'image') {
          const win = imageWindow(pages, IMAGE_PAGES);
          const imgs = await saveImages(book.id, win);
          if (imgs.length < Math.min(3, win.length) || !imgs.length) { replace(`only ${imgs.length}/${win.length} leaves fetchable`); continue; }
          const parts = [{ text: imprintPrompt('image') }];
          for (const im of imgs) parts.push({ text: `PAGE ${im.page_number}` }, { inline_data: { mime_type: 'image/jpeg', data: fs.readFileSync(im.file).toString('base64') } });
          out.write(JSON.stringify({ key: `${mode}:${book.id}`, request: { contents: [{ parts }], generationConfig: genCfg } }) + '\n');
          estIn += 1400 + imgs.length * (TOKENS_PER_IMAGE + 5);
          manifest.books.push({ ...s, mode, book, shown: imgs.map((i) => ({ page_number: i.page_number, url: i.url })), images: imgs.map((i) => i.page_number) });
        } else {
          const win = attributionWindow(pages, 5);
          if (!win.length) { replace('no OCR window'); continue; }
          // For the by-eye check: the image of every page the model read.
          const imgs = await saveImages(book.id, pages.filter((p) => win.some((w) => w.page_number === p.page_number)));
          const prose = tp_render(win);
          const text = `${imprintPrompt('text')}\n\n${prose}`;
          out.write(JSON.stringify({ key: `${mode}:${book.id}`, request: { contents: [{ parts: [{ text }] }], generationConfig: genCfg } }) + '\n');
          estIn += Math.ceil(text.length / 3.2);
          manifest.books.push({ ...s, mode, book, shown: win.map((w) => ({ page_number: w.page_number, page_type: w.page_type, prose: w.prose.slice(0, 2600) })), images: imgs.map((i) => i.page_number) });
        }
        kept++;
        if (kept % 10 === 0) console.log(`  ${mode}: ${kept}/${want}`);
      }
    }
    await new Promise((r) => out.end(r));
    await mc2.close();
    const p = priceFor(MODEL);
    const estOut = manifest.books.length * 450;
    const est = BATCH_MULTIPLIER * ((estIn / 1e6) * p.input + (estOut / 1e6) * p.output);
    manifest.estimate = { requests: manifest.books.length, input_tokens: estIn, output_tokens: estOut, usd_batch: +est.toFixed(4), price: p };
    fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 1));
    console.log(`built ${manifest.books.length} requests (${manifest.skipped.length} replaced), ${(fs.statSync(REQUESTS).size / 1e6).toFixed(1)} MB`);
    console.log(`ESTIMATE: ~${estIn.toLocaleString()} in / ~${estOut.toLocaleString()} out tokens → ~$${est.toFixed(3)} at Batch rates (${MODEL} $${p.input}/$${p.output} per M, ×${BATCH_MULTIPLIER})`);
    process.exit(0);
  }

  if (process.argv.includes('--submit')) {
    const m = readJson(MANIFEST, null);
    if (!m) { console.error('run --build first'); process.exit(1); }
    const L = ledger();
    const est = m.estimate.usd_batch * 1.5; // 50% headroom on an estimate that has not met a bill yet
    if (spentOf(L) + est > L.cap_usd) { console.error(`REFUSING: spent $${spentOf(L).toFixed(4)} + ~$${est.toFixed(4)} > cap $${L.cap_usd}`); process.exit(2); }
    const keyEnv = process.env.GEMINI_API_KEY_TIER3 ? 'GEMINI_API_KEY_TIER3' : 'GEMINI_API_KEY';
    const key = process.env[keyEnv];
    const body = fs.readFileSync(REQUESTS);
    const fileName = await uploadBatchInputFile(body, 'titlepage-imprint-7201', key);
    const job = await createThenDeleteInput({ fileName, apiKey: key, create: async () => {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchGenerateContent?key=${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ batch: { display_name: 'titlepage-imprint-7201', input_config: { file_name: fileName } } }) });
      if (!r.ok) throw new Error(`batch create ${r.status} ${(await r.text()).slice(0, 500)}`);
      return r.json();
    } });
    await mc2.connect();
    await registerEvalBatch(mc2.db('bookstore'), { jobName: job.name, id: `titlepage-imprint-7201-${Date.now()}`, submittedBy: 'scripts/audit/titlepage-model-pilot-v2.mjs', model: MODEL, pageCount: m.books.length, issue: 7201 });
    await mc2.close();
    L.jobs.push({ job_name: job.name, key_env: keyEnv, model: MODEL, prompt_version: IMPRINT_PROMPT_VERSION, requests: m.books.length, estimate_usd: +est.toFixed(4), submitted_at: new Date().toISOString() });
    fs.writeFileSync(LEDGER, JSON.stringify(L, null, 1));
    console.log(`submitted ${job.name}: ${m.books.length} requests, estimate $${est.toFixed(4)} (cap $${L.cap_usd})`);
    process.exit(0);
  }

  if (process.argv.includes('--collect')) {
    const m = readJson(MANIFEST, null);
    const byKey = new Map(m.books.map((b) => [`${b.mode}:${b.book.id}`, b]));
    const L = ledger();
    const p = priceFor(MODEL);
    const { logUsage } = await import('../workers/lib/supabase-usage-logger.mjs');
    for (const j of L.jobs) {
      if (j.collected_at) continue;
      const key = process.env[j.key_env];
      const data = await (await fetch(`https://generativelanguage.googleapis.com/v1beta/${j.job_name}?key=${key}`)).json();
      const state = data.metadata?.state || data.state;
      console.log(`${j.job_name} ${state}`);
      if (/FAILED|CANCELLED|EXPIRED/.test(state || '')) { j.collected_at = new Date().toISOString(); j.failed = state; j.cost_usd = 0; continue; }
      const rf = data.metadata?.output?.responsesFile || data.response?.responsesFile;
      if (!rf) continue;
      const rows = [];
      let inTok = 0, outTok = 0;
      for await (const r of streamBatchResponses(rf, key)) {
        const k = r.key || r.metadata?.key;
        const b = byKey.get(k);
        if (!b) continue;
        const u = r.response?.usageMetadata || {};
        inTok += u.promptTokenCount || 0; outTok += (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
        const text = (r.response?.candidates?.[0]?.content?.parts || []).filter((x) => !x.thought).map((x) => x.text || '').join('');
        const parsed = parseImprintReply(text);
        const row = { run_at: new Date().toISOString(), model: MODEL, prompt_version: j.prompt_version, job: j.job_name, mode: b.mode, group: b.group, stratum: b.stratum, book_id: b.book.id, catalogue: b.book, shown: b.shown.map((s) => s.page_number), usage: { in: u.promptTokenCount || 0, out: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) } };
        if (parsed.parse_failed) { row.parse_failed = true; row.raw = text.slice(0, 2000); row.finish = r.response?.candidates?.[0]?.finishReason ?? r.error ?? null; rows.push(row); continue; }
        const pagesMap = new Map(b.shown.map((s) => [s.page_number, b.mode === 'text' ? s.prose : null]));
        Object.assign(row, { raw_reply: parsed, guard_version: GUARD_VERSION }, checkImprint(parsed, { mode: b.mode, pages: pagesMap }));
        rows.push(row);
      }
      fs.writeFileSync(EVIDENCE, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
      j.collected_at = new Date().toISOString(); j.responses = rows.length; j.in_tokens = inTok; j.out_tokens = outTok;
      j.cost_usd = +(BATCH_MULTIPLIER * ((inTok / 1e6) * p.input + (outTok / 1e6) * p.output)).toFixed(5);
      try { await logUsage({ type: 'eval', mode: 'batch', model: MODEL, page_count: rows.length, input_tokens: inTok, output_tokens: outTok, cost_usd: j.cost_usd, batch_job_id: j.job_name, endpoint: ENDPOINT, triggered_by: 'manual', prompt_version: j.prompt_version }); } catch (e) { console.warn(`logUsage failed: ${e.message}`); }
      await mc2.connect();
      await closeEvalBatch(mc2.db('bookstore'), j.job_name, { evidence: EVIDENCE, usage: { input_tokens: inTok, output_tokens: outTok, cost_usd: j.cost_usd } });
      await mc2.close();
      const pf = rows.filter((r) => r.parse_failed).length;
      console.log(`collected ${rows.length} (${pf} parse failures): ${inTok.toLocaleString()} in / ${outTok.toLocaleString()} out → $${j.cost_usd}`);
    }
    fs.writeFileSync(LEDGER, JSON.stringify(L, null, 1));
    console.log(`spent $${spentOf(L).toFixed(4)} of $${L.cap_usd}; pending ${L.jobs.filter((x) => !x.collected_at).length}`);
    process.exit(0);
  }


  // --recheck: re-run the CURRENT guards over the stored replies. No model call; the replies are what was paid for.
  if (process.argv.includes('--recheck')) {
    const m = readJson(MANIFEST, null);
    const byKey = new Map(m.books.map((b) => [`${b.mode}:${b.book.id}`, b]));
    const rows = fs.readFileSync(EVIDENCE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    let changed = 0;
    for (const r of rows) {
      if (r.parse_failed) continue;
      const b = byKey.get(`${r.mode}:${r.book_id}`);
      const before = JSON.stringify([r.fields, r.names]);
      Object.assign(r, { guard_version: GUARD_VERSION }, checkImprint(r.raw_reply, { mode: r.mode, pages: new Map(b.shown.map((s) => [s.page_number, r.mode === 'text' ? s.prose : null])) }));
      if (JSON.stringify([r.fields, r.names]) !== before) changed++;
    }
    fs.writeFileSync(EVIDENCE, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
    console.log(`rechecked ${rows.length} replies with ${GUARD_VERSION}; ${changed} changed`);
    process.exit(0);
  }

  // --packet: one labelling sheet per book for the by-eye check. The labeller opens every image listed and
  // labels each field right / wrong / missed / absent (see LABELS below). Proposals the guards DROPPED are
  // shown too, marked, so "missed" can be split into "the model never said it" and "a guard threw it away".
  if (process.argv.includes('--packet')) {
    const rows = fs.readFileSync(EVIDENCE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const m = readJson(MANIFEST, null);
    const byId = new Map(m.books.map((b) => [`${b.mode}:${b.book.id}`, b]));
    const chunks = Number(opt('chunks', 4));
    const sheets = rows.map((r) => {
      const b = byId.get(`${r.mode}:${r.book_id}`);
      const imgs = (b.images || []).map((n) => `${n}: ${path.resolve(IMG_DIR, r.book_id, `${n}.jpg`)}`);
      const f = (o, k) => (o ? JSON.stringify(o) : 'null');
      return [
        `### ${r.mode.toUpperCase()} ${r.book_id}  (${r.group}, ${r.stratum})`,
        `reader: https://sourcelibrary.org/book/${r.book_id}?page=${r.title_page ?? r.shown[0]}`,
        `catalogue: title=${JSON.stringify(String(r.catalogue.title ?? '').slice(0, 140))} author=${JSON.stringify(r.catalogue.author ?? null)} published=${JSON.stringify(r.catalogue.published ?? null)} year=${r.catalogue.year ?? null} language=${r.catalogue.language}`,
        `pages shown to the model: ${r.shown.join(', ')}`,
        `IMAGES TO OPEN (page: file):\n  ${imgs.join('\n  ') || '(none fetched)'}`,
        r.parse_failed ? 'MODEL REPLY: PARSE FAILED' : [
          `model title_page: ${r.title_page}`,
          ...IMPRINT_FIELDS_LIST.map((k) => `KEPT ${k}: ${f(r.fields?.[k])}`),
          ...(r.names || []).map((n, i) => `KEPT name[${i}]: ${JSON.stringify({ name: n.name_nominative, as_printed: n.name_as_printed, role: n.role, page: n.page, quoted_line: n.quoted_line })}`),
          ...(r.rejected || []).map((x) => `DROPPED by guard (${x.reason}) ${x.field}: ${JSON.stringify(x.proposal)}`),
        ].join('\n'),
      ].join('\n');
    });
    for (let c = 0; c < chunks; c++) {
      const part = sheets.filter((_, i) => i % chunks === c);
      fs.writeFileSync(path.join(OUT, `packet-${c + 1}.md`), part.join('\n\n') + '\n');
    }
    console.log(`${sheets.length} sheets in ${chunks} packets under ${OUT}`);
    process.exit(0);
  }

  // --score: precision / recall per field and mode from the by-eye labels (labels-*.jsonl in --out-dir; the rubric
  // is in the experiment note). A field label is right | wrong | missed | absent for the KEPT value, plus
  // `dropped_label` for a proposal a guard threw away; a name is right | role_error | wrong, `dropped` if a guard
  // threw it away. Guarded precision counts kept values only; "no guard" adds the dropped ones back.
  //   precision = right / (right + wrong)      recall = right / (right + missed + wrong-where-the-page-states-it)
  if (process.argv.includes('--score')) {
    const labels = fs.readdirSync(OUT).filter((f) => /^labels-.*\.jsonl$/.test(f)).sort()
      .flatMap((f) => fs.readFileSync(path.join(OUT, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)));
    const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}% (${a}/${b})` : 'n/a');
    const wilsonLo = (a, b) => { if (!b) return ''; const z = 1.96, p = a / b; return (100 * (p + z * z / (2 * b) - z * Math.sqrt((p * (1 - p) + z * z / (4 * b)) / b)) / (1 + z * z / b)).toFixed(1); };
    const table = [];
    for (const mode of ['image', 'text', 'all']) {
      const L = labels.filter((l) => mode === 'all' || l.mode === mode);
      for (const k of IMPRINT_FIELDS_LIST) {
        const c = { right: 0, wrong: 0, missed: 0, absent: 0, wrong_truth: 0, dropped_right: 0, dropped_wrong: 0 };
        for (const l of L) {
          const v = l.fields?.[k]; if (!v) continue;
          c[v.label] = (c[v.label] ?? 0) + 1;
          if (v.label === 'wrong' && v.truth_present) c.wrong_truth++;
          if (v.dropped_label === 'right') c.dropped_right++; else if (v.dropped_label === 'wrong') c.dropped_wrong++;
        }
        table.push({ mode, field: k, right: c.right, wrong: c.wrong, missed: c.missed, absent: c.absent, precision: pct(c.right, c.right + c.wrong), lo95: wilsonLo(c.right, c.right + c.wrong), recall: pct(c.right, c.right + c.missed + c.wrong_truth), dropped: `${c.dropped_right} right / ${c.dropped_wrong} wrong`, no_guard_precision: pct(c.right + c.dropped_right, c.right + c.wrong + c.dropped_right + c.dropped_wrong) });
      }
      const a = { right: 0, role_error: 0, wrong: 0, missed: 0, dr: 0, dx: 0 };
      const o = { right: 0, role_error: 0, wrong: 0 };
      for (const l of L) {
        for (const n of l.names || []) {
          if (n.dropped) { if (n.role_proposed === 'author') { if (n.label === 'right') a.dr++; else a.dx++; } continue; }
          if (n.role_proposed === 'author') a[n.label] = (a[n.label] ?? 0) + 1; else o[n.label] = (o[n.label] ?? 0) + 1;
        }
        a.missed += l.authors_missed?.length ?? 0;
      }
      table.push({ mode, field: 'author', right: a.right, wrong: a.wrong, role_error: a.role_error, missed: a.missed, precision: pct(a.right, a.right + a.role_error + a.wrong), lo95: wilsonLo(a.right, a.right + a.role_error + a.wrong), recall: pct(a.right, a.right + a.missed), dropped: `${a.dr} right / ${a.dx} wrong`, no_guard_precision: pct(a.right + a.dr, a.right + a.role_error + a.wrong + a.dr + a.dx) });
      table.push({ mode, field: 'other roles', right: o.right, wrong: o.wrong, role_error: o.role_error, precision: pct(o.right, o.right + o.role_error + o.wrong) });
    }
    console.log(`labels: ${labels.length} books (${labels.filter((l) => l.mode === 'image').length} image, ${labels.filter((l) => l.mode === 'text').length} text)`);
    console.table(table);
    fs.writeFileSync(path.join(OUT, 'imprint-score.json'), JSON.stringify(table, null, 1));
    process.exit(0);
  }

  console.error('--imprint needs one of --draw | --build | --submit | --collect | --recheck | --packet | --score');
  process.exit(1);
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
