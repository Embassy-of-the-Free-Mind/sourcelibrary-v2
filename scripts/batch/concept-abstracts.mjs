#!/usr/bin/env node
/**
 * PRIOR ART: scripts/workers/lib/enrich-batch-lane.mjs — batch generateContent with
 * price-at-submit / completeBatchUsage-at-collect, reader-view priority and the
 * held / withheld / bad-read exclusions, but it writes book-level enrichment, not a
 * per-page field. scripts/workers/embed-gemini.mjs `--batch/--collect` (#6161) — the
 * asyncBatchEmbedContent shape and the "upsert only if the text still hashes to what
 * was sent" rule, but for `page_translations`. scripts/eval/embed-granularity/
 * arm-c-abstracts.mjs — the pilot (realtime, a scratch pool, no store). This lane
 * combines the three for #6173 stage 1; none of them could be pointed at it.
 *
 * ── What it does ──────────────────────────────────────────────────────────────
 *
 * The concept-abstract lane, stage 1 (#6173): a 2–4 sentence abstract of each page's
 * ideas, in neutral language, written by flash-lite through the Gemini Batch API,
 * stored on the page (`pages.concept_abstract`, with a gemini-engine/1 provenance
 * block) and embedded into the Supabase `page_concepts` table, which has its own
 * HNSW index and RPCs (scripts/migration/add-page-concepts.sql). It is NOT wired
 * into public search; `/api/search?lane=concept` reads it for judging.
 *
 * The abstract is DERIVED METADATA (`derived-metadata-lane.md`): an index key made
 * from the page text, never shown or quoted as the page. So:
 *   - held books and books carrying a bad-read flag are never selected, and are
 *     re-checked when results are written;
 *   - pages flagged `ocr.unreadable`, pages whose translation is withheld, and
 *     pages whose translation is older than their OCR (`translation_stale`,
 *     `translationStaleness`) are never sent. Withheld is judged per PAGE, not per
 *     book as the enrich lane does: that lane summarises the whole book, this one
 *     writes one key per page, and a book-level rule dropped 12 of the pilot's 97
 *     gold books (the Taoist Canon among them) for their withheld pages;
 *   - every abstract records the hash of the exact page text it was made from
 *     (`input.source_text_hash`); a page whose text changed between submit and
 *     collect is not written, and a later text change makes the stored abstract
 *     detectably stale.
 *
 * ── Subcommands (state in --dir and in Mongo `concept_abstract_jobs`) ─────────
 *
 *   select   --dir D [--budget-usd 46] [--books 2000] [--gold gold.json]
 *            Pick books by reader views (books.read_count) across the eight pilot
 *            traditions, round-robin so each tradition gets its turn, plus every
 *            book the pilot's gold set touches. One edition per work. Writes
 *            D/books.json, D/pages.jsonl (one line per page: ids, tradition, the
 *            text as it will be sent and its hash) and D/selection.json.
 *   submit   --dir D [--job-requests 4000] [--max-usd 50] [--hard-usd 55]
 *            Batch jobs of PAGES_PER_CALL pages per request. Asks the spend gate
 *            (label 'concept-abstract submit') per job, prices each job at submit
 *            on gemini_usage (one row per book), and stops at --max-usd counting
 *            everything this run has committed (generation + embedding).
 *   collect  --dir D   Write finished jobs' abstracts to pages (re-checking every
 *            exclusion), close the usage rows with billed tokens. Free; idempotent.
 *   embed    --dir D   Batch-embed the stored abstracts (not NONE) with the page
 *            model (gemini-embedding-2-preview, 768-d, plain text).
 *   embed-collect --dir D   Collect embedding jobs into D/vectors/*.f32 + ids.
 *   load     --dir D [--rows-per-sec 40]   Insert vectors into page_concepts at a
 *            capped rate (Supabase writes are the shared bottleneck).
 *   status   --dir D   Counts, money committed and billed.
 *
 *   node --env-file=.env.production.local scripts/batch/concept-abstracts.mjs <cmd> --dir D
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { withMongo } from '../lib/mongo.mjs';
import { NOT_HELD } from '../lib/pipeline-hold.mjs';
import { pageEmbeddingInput, EMBED_MODEL, EMBED_DIMS } from '../lib/page-embedding-text.mjs';
import { translationStaleness } from '../lib/stale-translation.mjs';
import { budgetAllowsDispatchScoped } from '../lib/spend-guard.mjs';
import { contentHash, batchJobProvenance, engineFromBatchJob, codeVersion, host } from '../lib/write-provenance.mjs';
import { createThenDeleteInput, uploadBatchInputFile, streamBatchResponses } from '../lib/gemini-batch-input-file.mjs';
import { estimateTextTokens, usdForTokens } from '../lib/embedding-usage.mjs';
import { logUsage, completeBatchUsage, calculateUsageCost, outputTokensFrom } from '../workers/lib/supabase-usage-logger.mjs';
import {
  CONCEPT_ABSTRACT_MODEL as MODEL, CONCEPT_ABSTRACT_PROMPT_VERSION as PROMPT_VERSION, CONCEPT_ABSTRACT_PAGES_PER_CALL as PER_CALL,
  CONCEPT_ABSTRACT_GEN_CONFIG as GEN_CONFIG, CONCEPT_ABSTRACT_HEAD as HEAD, abstractInputText, buildConceptAbstractPrompt,
  parseConceptAbstracts, isNoneAbstract,
} from '../lib/concept-abstract.mjs';

const args = process.argv.slice(2);
const CMD = args[0];
const arg = (k, d) => { const i = args.indexOf(k); return i === -1 ? d : args[i + 1]; };
const DIR = arg('--dir');
if (!DIR) { console.error('--dir D required'); process.exit(1); }
fs.mkdirSync(DIR, { recursive: true });

export const RUN = arg('--run', 'concept-abstract-6173-s1');
const CALL_SITE = 'scripts/batch/concept-abstracts.mjs';
const ENDPOINT = 'batch/concept-abstracts';
const GATE_LABEL = 'concept-abstract';
const JOBS = 'concept_abstract_jobs';
const API = 'https://generativelanguage.googleapis.com/v1beta';
// Project 3 (keys 3/5/7/10 list the same batch jobs). The #5729 embedding backfill
// runs on TIER3's project, where more than ~3 concurrent embedding jobs get cancelled.
const KEY = process.env.GEMINI_API_KEY_3 || process.env.GEMINI_API_KEY;
const PAGE_MIN_CHARS = 200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── The eight pilot traditions (scripts/eval/embed-granularity/build-pool.mjs) ──
// Collection slugs, first match wins; the label names are the pilot's final ones.
const TRADITIONS = [
  ['jewish-kabbalistic', ['kabbalah', 'jewish-kabbalistic-mysticism']],
  ['islamic-sufi', ['sufism-islamic-mysticism', 'sufi-eastern-mysticism', 'islamic-philosophy', 'falsafa', 'quran-islamic-theology', 'islam']],
  ['chinese-daoist-confucian', ['daoist-classics', 'confucian-classics', 'confucianism']],
  ['buddhist', ['zen-chan', 'theravada', 'chinese-buddhist-texts', 'buddhism', 'indian-buddhist-jain', 'buddhist-studies', 'vajrayana']],
  ['hindu-indic', ['vedanta-darshana', 'yoga', 'yoga-tantra-mysticism', 'vedic-literature', 'hinduism', 'indian-philosophy']],
  ['christian', ['christian-mysticism-sub', 'german-speculative-mysticism', 'behmenist-underground']],
  ['hermetic-esoteric', ['corpus-hermeticum', 'hermetica', 'spiritual-alchemy', 'rosicrucian-tradition', 'alchemy']],
  ['greek-roman', ['neoplatonism', 'platonic-tradition', 'stoicism', 'stoic-moral-philosophy', 'aristotelian-tradition', 'classical-philosophy']],
];
const shelfOf = (collections) => {
  for (const [t, slugs] of TRADITIONS) if ((collections || []).some((c) => slugs.includes(c))) return t;
  return null;
};

/** Book-level exclusions: held, quarantined, bad-read flags (enrich-batch-lane's set). */
const ELIGIBLE_BOOK = {
  visible: true,
  pages_count: { $gt: 0 },
  pages_translated: { $gt: 0 },
  content_type: { $ne: 'artwork' },
  ...NOT_HELD,
  'pipeline_auto.status': { $nin: ['held', 'loop_quarantine_hold'] },
  needs_resplit: { $in: [null, false] },
  source_unrecoverable: { $in: [null, false] },
  spread_translation_crisis: { $in: [null, false] },
  translation_stale_reason: { $in: [null, ''] },
};
/**
 * Books mid-pipeline are left out (their pages are about to change, and an
 * envelope on them would meter their OCR/translation spend too — #6150).
 */
const SETTLED_STATUSES = ['complete', 'enriched'];
const booksOf = (db) => db.collection('books');
const pagesOf = (db) => db.collection('pages');

const PAGE_PROJECTION = { id: 1, book_id: 1, page_number: 1, 'translation.data': 1, 'translation.updated_at': 1, 'translation.edited_at': 1, 'translation.source': 1, 'ocr.data': 1, 'ocr.updated_at': 1, 'ocr.unreadable': 1, translation_withheld: 1, translation_stale: 1 };

/** The text this lane sends for a page, or null with the reason it is skipped. */
function pageInput(page, english) {
  if (!(page.page_number > 0)) return { skip: 'front' };
  if (page.ocr?.unreadable) return { skip: 'unreadable' };
  if (page.translation_withheld) return { skip: 'withheld' };
  if (page.translation_stale || translationStaleness(page).stale) return { skip: 'stale-translation' };
  const composed = pageEmbeddingInput(page);
  if (!composed) return { skip: 'empty' };
  if (!composed.hasTranslation && !english) return { skip: 'untranslated' };
  const text = abstractInputText(composed.text);
  if (text.length < PAGE_MIN_CHARS) return { skip: 'short' };
  return { text, source_field: composed.hasTranslation ? 'translation' : 'ocr' };
}

// Pilot ratios, re-measured from the first collected job before money moves at scale.
const HEAD_TOKENS = 330;
const OUT_TOKENS_PER_PAGE = 62;
const estPageInTokens = (chars) => Math.ceil(chars / 4.3) + HEAD_TOKENS / PER_CALL;
const estPageUsd = (chars) => calculateUsageCost(MODEL, estPageInTokens(chars), OUT_TOKENS_PER_PAGE, true)
  + usdForTokens(80, { batch: true }); // the abstract's own embedding, ~75 tokens

// ── select ──────────────────────────────────────────────────────────────────
async function select(db) {
  const budget = Number(arg('--budget-usd', 46));
  const maxBooks = Number(arg('--books', 2000));
  const maxBookPages = Number(arg('--max-book-pages', 1000));
  const goldFile = arg('--gold', 'scripts/eval/embed-granularity/gold.json');
  const gold = JSON.parse(fs.readFileSync(goldFile, 'utf8'));
  const goldTrad = new Map();
  for (const q of gold.queries) for (const p of q.passages) goldTrad.set(p.book_id, p.tradition);

  const proj = { id: 1, title: 1, display_title: 1, author: 1, year: 1, language: 1, collections: 1, work_id: 1, read_count: 1, pages_translated: 1, 'pipeline_auto.status': 1 };
  const all = await booksOf(db).find({ ...ELIGIBLE_BOOK, $or: [{ collections: { $in: TRADITIONS.flatMap(([, s]) => s) } }, { id: { $in: [...goldTrad.keys()] } }] })
    .project(proj).toArray();
  console.log(`${all.length} eligible books on the eight shelves or in the gold set`);
  const queues = new Map(TRADITIONS.map(([t]) => [t, []]));
  const forced = [];
  for (const b of all) {
    const t = goldTrad.get(b.id) || shelfOf(b.collections);
    if (!t || !queues.has(t)) { if (goldTrad.has(b.id)) forced.push({ ...b, tradition: goldTrad.get(b.id) }); continue; }
    if (goldTrad.has(b.id)) forced.push({ ...b, tradition: t });
    else if (SETTLED_STATUSES.includes(b.pipeline_auto?.status)) queues.get(t).push({ ...b, tradition: t });
  }
  for (const q of queues.values()) q.sort((a, b) => (b.read_count || 0) - (a.read_count || 0) || (b.pages_translated || 0) - (a.pages_translated || 0));

  const out = fs.createWriteStream(path.join(DIR, 'pages.jsonl'));
  const chosen = [];
  const seenWork = new Set();
  const skips = {};
  let usd = 0; let pages = 0;
  const take = async (b, isGold) => {
    if (b.work_id && seenWork.has(String(b.work_id)) && !isGold) return 'dup-work';
    if (!isGold && usd + (b.pages_translated || 0) * 0.00005 > budget) return 'over-budget';
    const english = /^english$/i.test(b.language || '');
    const rows = [];
    for await (const p of pagesOf(db).find({ book_id: b.id }).project(PAGE_PROJECTION).sort({ page_number: 1 })) {
      const r = pageInput(p, english);
      if (r.skip) { skips[r.skip] = (skips[r.skip] || 0) + 1; continue; }
      rows.push({ page_id: String(p.id ?? p._id), book_id: b.id, page_number: p.page_number, tradition: b.tradition, source_field: r.source_field, text_hash: contentHash(r.text), text: r.text });
    }
    if (!rows.length) return 'no-pages';
    if (!isGold && rows.length > maxBookPages) return 'too-long';
    const cost = rows.reduce((s, r) => s + estPageUsd(r.text.length), 0);
    if (!isGold && usd + cost > budget) return 'over-budget';
    for (const r of rows) out.write(JSON.stringify(r) + '\n');
    usd += cost; pages += rows.length;
    if (b.work_id) seenWork.add(String(b.work_id));
    chosen.push({ book_id: b.id, tradition: b.tradition, gold: isGold, title: b.display_title || b.title || '', author: b.author || '', year: b.year ?? null, language: b.language || '', read_count: b.read_count || 0, pages: rows.length, est_usd: +cost.toFixed(4) });
    return null;
  };
  for (const b of forced) {
    const why = await take(b, true);
    if (why) console.log(`  gold book ${b.id} not taken: ${why}`);
  }
  console.log(`gold books: ${chosen.length}, ${pages} pages, est $${usd.toFixed(2)}`);
  const goldIds = new Set(forced.map((b) => b.id));
  const reasons = {};
  // Round-robin: each tradition takes its next most-read book in turn, so a
  // shelf of 2,000 books cannot crowd out one of 160.
  let open = true;
  while (open && chosen.length < maxBooks && usd < budget) {
    open = false;
    for (const [t] of TRADITIONS) {
      const q = queues.get(t);
      while (q.length) {
        const b = q.shift();
        if (goldIds.has(b.id) || chosen.some((c) => c.book_id === b.id)) continue;
        const why = await take(b, false);
        if (!why) { open = true; break; }
        reasons[why] = (reasons[why] || 0) + 1;
        if (why === 'over-budget') continue; // a smaller book may still fit
      }
      if (chosen.length >= maxBooks) break;
    }
    if (chosen.length % 100 < TRADITIONS.length) console.log(`  ${chosen.length} books, ${pages} pages, est $${usd.toFixed(2)}`);
  }
  await new Promise((r) => out.end(r));
  const byTrad = {};
  for (const c of chosen) { const x = byTrad[c.tradition] ||= { books: 0, pages: 0, gold_books: 0 }; x.books++; x.pages += c.pages; x.gold_books += c.gold ? 1 : 0; }
  const summary = { run: RUN, at: new Date(), books: chosen.length, pages, est_usd: +usd.toFixed(2), budget_usd: budget, by_tradition: byTrad, book_skips: reasons, page_skips: skips, min_page_chars: PAGE_MIN_CHARS, max_book_pages: maxBookPages, settled_statuses: SETTLED_STATUSES };
  fs.writeFileSync(path.join(DIR, 'books.json'), JSON.stringify(chosen, null, 1));
  fs.writeFileSync(path.join(DIR, 'selection.json'), JSON.stringify(summary, null, 1));
  console.log(JSON.stringify(summary, null, 1));
}

// ── helpers over D/pages.jsonl ────────────────────────────────────────────────
async function* readPages() {
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(DIR, 'pages.jsonl')), crlfDelay: Infinity });
  for await (const l of rl) if (l.trim()) yield JSON.parse(l);
}
/** Requests: PER_CALL consecutive pages of one book. Deterministic from pages.jsonl. */
async function* readRequests() {
  let cur = []; let n = 0;
  for await (const p of readPages()) {
    if (cur.length && (cur.length >= PER_CALL || cur[0].book_id !== p.book_id)) { yield { n: n++, pages: cur }; cur = []; }
    cur.push(p);
  }
  if (cur.length) yield { n: n++, pages: cur };
}

async function committedUsd(db) {
  const rows = await db.collection(JOBS).find({ run: RUN }).project({ est_usd: 1, actual_usd: 1, status: 1 }).toArray();
  return rows.reduce((s, j) => s + (j.status === 'collected' || j.status === 'embedded' ? (j.actual_usd ?? j.est_usd ?? 0) : /failed/.test(j.status) ? (j.actual_usd ?? 0) : (j.est_usd || 0)), 0);
}

async function gateOpen(db, bookIds) {
  const g = await budgetAllowsDispatchScoped(db, `${GATE_LABEL} submit`);
  if (!g.allowed) return false;
  if (!g.envelopeIds) return true; // the global dial has room
  const allowed = new Set([...g.envelopeIds].map(String));
  const outside = bookIds.filter((id) => !allowed.has(id));
  if (outside.length) console.log(`  gate: ${outside.length} of this job's books are outside every open envelope`);
  return outside.length === 0;
}

async function createJob(kind, model, body, displayName) {
  const fileName = await uploadBatchInputFile(body, displayName, KEY);
  const verb = kind === 'embed' ? 'asyncBatchEmbedContent' : 'batchGenerateContent';
  return createThenDeleteInput({
    fileName, apiKey: KEY,
    create: async () => {
      for (let attempt = 0; ; attempt++) {
        const r = await fetch(`${API}/models/${model}:${verb}?key=${KEY}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batch: { display_name: displayName, input_config: { file_name: fileName } } }),
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok) return j;
        if (r.status === 429 && attempt < 3) { await sleep(60000 * (attempt + 1)); continue; }
        const e = new Error(`batch create ${r.status}: ${JSON.stringify(j).slice(0, 300)}`); e.status = r.status; throw e;
      }
    },
  });
}

async function batchState(name) {
  const r = await (await fetch(`${API}/${name}?key=${KEY}`)).json();
  return { state: r.metadata?.state || r.state || 'UNKNOWN', responsesFile: r.response?.responsesFile || r.metadata?.output?.responsesFile || null, stats: r.metadata?.batchStats || null };
}

// ── submit ──────────────────────────────────────────────────────────────────
async function submit(db) {
  const jobReqs = Number(arg('--job-requests', 4000));
  const maxUsd = Number(arg('--max-usd', 50));
  const hardUsd = Number(arg('--hard-usd', 55));
  const maxJobs = Number(arg('--max-jobs', 1e9));
  const jobs = db.collection(JOBS);
  await jobs.createIndex({ run: 1, status: 1 }).catch(() => {});
  const done = new Set((await jobs.find({ run: RUN, kind: 'generate', status: { $nin: ['failed', 'create_failed'] } }).project({ request_range: 1 }).toArray())
    .flatMap((j) => { const out = []; for (let k = j.request_range[0]; k <= j.request_range[1]; k++) out.push(k); return out; }));
  const cv = await codeVersion();
  let batch = []; let submitted = 0;
  const flush = async () => {
    if (!batch.length) return true;
    const reqs = batch; batch = [];
    const perBook = new Map();
    const lines = reqs.map((r) => {
      const texts = r.pages.map((p) => p.text);
      const prompt = buildConceptAbstractPrompt(texts);
      const b = perBook.get(r.pages[0].book_id) || { pages: 0, inTok: 0 };
      b.pages += r.pages.length; b.inTok += Math.ceil(prompt.length / 4.3);
      perBook.set(r.pages[0].book_id, b);
      return JSON.stringify({ key: String(r.n), request: { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: GEN_CONFIG } });
    });
    const estUsd = [...perBook.values()].reduce((s, b) => s + calculateUsageCost(MODEL, b.inTok, b.pages * OUT_TOKENS_PER_PAGE, true), 0);
    const committed = await committedUsd(db);
    if (committed + estUsd > maxUsd || committed + estUsd > hardUsd) { console.log(`STOP: committed $${committed.toFixed(2)} + this job $${estUsd.toFixed(2)} > cap $${maxUsd}`); return false; }
    const bookIds = [...perBook.keys()];
    if (!(await gateOpen(db, bookIds))) { console.log('STOP: spend gate closed for this job'); return false; }
    const jobId = `ca-${RUN}-${Date.now().toString(36)}`;
    const provenance = batchJobProvenance({
      call_site: CALL_SITE, model: MODEL, generationConfig: GEN_CONFIG,
      prompt: { id: null, name: 'concept-abstract', version: PROMPT_VERSION, hash: contentHash(HEAD), text: HEAD },
      run: { code_version: cv, host: host(), job_id: jobId, run: RUN },
    });
    let created;
    try {
      created = await createJob('generate', MODEL, lines.join('\n') + '\n', jobId);
    } catch (e) {
      console.error(`  ${jobId}: create failed: ${e.message}`);
      return false;
    }
    await jobs.insertOne({
      _id: jobId, run: RUN, kind: 'generate', gemini_name: created.name, model: MODEL, status: 'submitted', created_at: new Date(),
      request_range: [reqs[0].n, reqs[reqs.length - 1].n], requests: reqs.length, pages: reqs.reduce((s, r) => s + r.pages.length, 0),
      book_ids: bookIds, est_usd: +estUsd.toFixed(4), provenance, key_project: 'GEMINI_API_KEY_3',
    });
    for (const [bookId, b] of perBook) {
      await logUsage({
        type: 'concept_abstract', mode: 'batch', model: MODEL, book_id: bookId, page_count: b.pages, batch_job_id: `${jobId}:${bookId}`,
        input_tokens: 0, output_tokens: 0, status: 'submitted', endpoint: ENDPOINT, prompt_version: PROMPT_VERSION,
        cost_usd: +calculateUsageCost(MODEL, b.inTok, b.pages * OUT_TOKENS_PER_PAGE, true).toFixed(6),
      }, db);
    }
    submitted++;
    console.log(`submitted ${jobId} → ${created.name}: ${reqs.length} requests, ${reqs.reduce((s, r) => s + r.pages.length, 0)} pages, ${bookIds.length} books, est $${estUsd.toFixed(3)} (committed before: $${committed.toFixed(2)})`);
    return submitted < maxJobs;
  };
  for await (const r of readRequests()) {
    if (done.has(r.n)) continue;
    batch.push(r);
    if (batch.length >= jobReqs) { if (!(await flush())) return; }
  }
  await flush();
}

// ── collect ─────────────────────────────────────────────────────────────────
async function stillEligibleBooks(db, bookIds) {
  return new Set((await booksOf(db).find({ id: { $in: bookIds }, ...ELIGIBLE_BOOK }).project({ id: 1 }).toArray()).map((b) => b.id));
}

async function collect(db) {
  const jobs = db.collection(JOBS);
  const todo = await jobs.find({ run: RUN, kind: 'generate', status: 'submitted' }).sort({ created_at: 1 }).toArray();
  if (!todo.length) { console.log('nothing to collect'); return; }
  // request n → its pages, for the open jobs only
  const want = new Map();
  for (const j of todo) for (let k = j.request_range[0]; k <= j.request_range[1]; k++) want.set(k, j._id);
  const reqPages = new Map();
  for await (const r of readRequests()) if (want.has(r.n)) reqPages.set(r.n, r.pages);
  for (const job of todo) {
    const st = await batchState(job.gemini_name);
    if (/FAILED|CANCELLED|EXPIRED/.test(st.state)) {
      await jobs.updateOne({ _id: job._id }, { $set: { status: 'failed', state: st.state, collected_at: new Date() } });
      for (const id of job.book_ids) await completeBatchUsage({ batch_job_id: `${job._id}:${id}`, model: MODEL, input_tokens: 0, output_tokens: 0, status: 'failed', error_message: st.state, insertIfMissing: false }, db);
      console.log(`${job._id}: ${st.state} — its requests go back to submit`);
      continue;
    }
    if (!/SUCCEEDED/.test(st.state) || !st.responsesFile) { console.log(`${job._id}: ${st.state} ${JSON.stringify(st.stats || {})}`); continue; }
    const claim = await jobs.updateOne({ _id: job._id, status: 'submitted' }, { $set: { status: 'collecting', collecting_at: new Date() } });
    if (!claim.modifiedCount) continue;
    const eligible = await stillEligibleBooks(db, job.book_ids);
    const perBook = new Map();
    const c = { responses: 0, parsed: 0, unparsed: 0, errors: 0, written: 0, none: 0, changed: 0, dropped_book: 0 };
    const out = fs.createWriteStream(path.join(DIR, 'abstracts.jsonl'), { flags: 'a' });
    let ops = [];
    const flushOps = async () => { if (ops.length) { await pagesOf(db).bulkWrite(ops, { ordered: false }); ops = []; } };
    for await (const line of streamBatchResponses(st.responsesFile, KEY)) {
      c.responses++;
      const n = Number(line.key ?? line.metadata?.key);
      const pages = reqPages.get(n);
      const usage = line.response?.usageMetadata;
      const bookId = pages?.[0]?.book_id;
      if (bookId) { const b = perBook.get(bookId) || { inTok: 0, outTok: 0, pages: 0 }; b.inTok += usage?.promptTokenCount || 0; b.outTok += outputTokensFrom(usage); perBook.set(bookId, b); }
      if (!pages) { c.errors++; continue; }
      if (line.error || !line.response) { c.errors++; continue; }
      const text = line.response.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
      const abstracts = parseConceptAbstracts(text, pages.length);
      if (!abstracts) { c.unparsed++; continue; }
      c.parsed++;
      if (!eligible.has(bookId)) { c.dropped_book += pages.length; continue; }
      // Re-read the pages: write only where the text still hashes to what was sent.
      const live = new Map((await pagesOf(db).find({ id: { $in: pages.map((p) => p.page_id) } }).project(PAGE_PROJECTION).toArray()).map((p) => [String(p.id), p]));
      const english = true; // the sent text already passed the language rule at select
      const sentPrompt = buildConceptAbstractPrompt(pages.map((p) => p.text));
      pages.forEach((p, j) => {
        const lp = live.get(p.page_id);
        const now = lp && pageInput(lp, english);
        if (!now || now.skip || contentHash(now.text) !== p.text_hash) { c.changed++; return; }
        const data = abstracts[j];
        const none = isNoneAbstract(data);
        const engine = engineFromBatchJob(job, {
          batch_job_id: job._id, collected_by: CALL_SITE, response: line.response,
          prompt_sent_hash: contentHash(sentPrompt), prompt_sent_chars: sentPrompt.length,
          input: { source_field: p.source_field, source_text_hash: p.text_hash, source_text_chars: p.text.length, request_key: String(n), position: j + 1, of: pages.length },
        });
        const ca = { data, none, content_hash: contentHash(data), source: 'batch_api', run: RUN, prompt_version: PROMPT_VERSION, model: MODEL, updated_at: new Date(), engine };
        ops.push({ updateOne: { filter: { id: lp.id, book_id: p.book_id }, update: { $set: { concept_abstract: ca } } } });
        out.write(JSON.stringify({ page_id: p.page_id, book_id: p.book_id, page_number: p.page_number, tradition: p.tradition, abstract: data, none, content_hash: ca.content_hash, job: job._id }) + '\n');
        c.written++; if (none) c.none++;
        const b = perBook.get(bookId); b.pages++;
      });
      if (ops.length >= 500) await flushOps();
    }
    await flushOps();
    await new Promise((r) => out.end(r));
    let actual = 0;
    for (const id of job.book_ids) {
      const b = perBook.get(id) || { inTok: 0, outTok: 0, pages: 0 };
      actual += calculateUsageCost(MODEL, b.inTok, b.outTok, true);
      await completeBatchUsage({ batch_job_id: `${job._id}:${id}`, model: MODEL, input_tokens: b.inTok, output_tokens: b.outTok, status: b.inTok ? 'success' : 'failed', type: 'concept_abstract', mode: 'batch', book_id: id, page_count: b.pages, endpoint: ENDPOINT }, db);
    }
    const tok = [...perBook.values()].reduce((s, b) => ({ in: s.in + b.inTok, out: s.out + b.outTok }), { in: 0, out: 0 });
    await jobs.updateOne({ _id: job._id }, { $set: { status: 'collected', state: st.state, collected_at: new Date(), actual_usd: +actual.toFixed(4), counts: c, tokens: tok } });
    console.log(`${job._id}: collected ${JSON.stringify(c)} billed $${actual.toFixed(4)} (est $${job.est_usd}) tokens in ${tok.in} out ${tok.out}`);
  }
}

// ── embed (Batch API, the page model) ───────────────────────────────────────
async function* readAbstracts() {
  const f = path.join(DIR, 'abstracts.jsonl');
  if (!fs.existsSync(f)) return;
  const seen = new Set();
  const rl = readline.createInterface({ input: fs.createReadStream(f), crlfDelay: Infinity });
  for await (const l of rl) { if (!l.trim()) continue; const r = JSON.parse(l); if (seen.has(r.page_id)) continue; seen.add(r.page_id); yield r; }
}

async function embed(db) {
  const jobPages = Number(arg('--job-pages', 20000));
  const maxRunning = Number(arg('--max-running', 2));
  const maxUsd = Number(arg('--max-usd', 50));
  const jobs = db.collection(JOBS);
  const inJobs = new Set((await jobs.find({ run: RUN, kind: 'embed', status: { $nin: ['failed', 'create_failed'] } }).project({ page_ids: 1 }).toArray()).flatMap((j) => j.page_ids));
  let batch = [];
  const flush = async () => {
    if (!batch.length) return true;
    const running = await jobs.countDocuments({ run: RUN, kind: 'embed', status: 'submitted' });
    if (running >= maxRunning) { console.log(`STOP: ${running} embedding jobs open (--max-running ${maxRunning}); collect first`); return false; }
    const rows = batch; batch = [];
    const perBook = new Map();
    const lines = rows.map((r) => {
      const b = perBook.get(r.book_id) || { pages: 0, tokens: 0 };
      b.pages++; b.tokens += estimateTextTokens(r.abstract); perBook.set(r.book_id, b);
      return JSON.stringify({ key: `${r.page_id}|${r.content_hash}`, request: { content: { parts: [{ text: r.abstract }] }, outputDimensionality: EMBED_DIMS } });
    });
    const estUsd = [...perBook.values()].reduce((s, b) => s + usdForTokens(b.tokens, { batch: true }), 0);
    const committed = await committedUsd(db);
    if (committed + estUsd > maxUsd) { console.log(`STOP: committed $${committed.toFixed(2)} + $${estUsd.toFixed(2)} > $${maxUsd}`); return false; }
    if (!(await gateOpen(db, [...perBook.keys()]))) { console.log('STOP: spend gate closed'); return false; }
    const jobId = `cae-${RUN}-${Date.now().toString(36)}`;
    const created = await createJob('embed', EMBED_MODEL, lines.join('\n') + '\n', jobId);
    await jobs.insertOne({ _id: jobId, run: RUN, kind: 'embed', gemini_name: created.name, model: EMBED_MODEL, status: 'submitted', created_at: new Date(), page_ids: rows.map((r) => r.page_id), pages: rows.length, book_ids: [...perBook.keys()], est_usd: +estUsd.toFixed(4), key_project: 'GEMINI_API_KEY_3' });
    for (const [bookId, b] of perBook) {
      await logUsage({ type: 'embedding', mode: 'batch', model: EMBED_MODEL, book_id: bookId, page_count: b.pages, batch_job_id: `${jobId}:${bookId}`, input_tokens: 0, output_tokens: 0, status: 'submitted', endpoint: `${ENDPOINT}/embed`, cost_usd: +usdForTokens(b.tokens, { batch: true }).toFixed(6) }, db);
    }
    console.log(`submitted ${jobId} → ${created.name}: ${rows.length} abstracts, est $${estUsd.toFixed(4)}`);
    return true;
  };
  for await (const r of readAbstracts()) {
    if (r.none || inJobs.has(r.page_id)) continue;
    batch.push(r);
    if (batch.length >= jobPages && !(await flush())) return;
  }
  await flush();
}

async function embedCollect(db) {
  const jobs = db.collection(JOBS);
  const vdir = path.join(DIR, 'vectors');
  fs.mkdirSync(vdir, { recursive: true });
  for (const job of await jobs.find({ run: RUN, kind: 'embed', status: 'submitted' }).sort({ created_at: 1 }).toArray()) {
    const st = await batchState(job.gemini_name);
    if (/FAILED|CANCELLED|EXPIRED/.test(st.state)) {
      await jobs.updateOne({ _id: job._id }, { $set: { status: 'failed', state: st.state } });
      for (const id of job.book_ids) await completeBatchUsage({ batch_job_id: `${job._id}:${id}`, model: EMBED_MODEL, input_tokens: 0, output_tokens: 0, status: 'failed', error_message: st.state, insertIfMissing: false }, db);
      console.log(`${job._id}: ${st.state}`); continue;
    }
    if (!/SUCCEEDED/.test(st.state) || !st.responsesFile) { console.log(`${job._id}: ${st.state} ${JSON.stringify(st.stats || {})}`); continue; }
    const ids = []; const vecs = [];
    const perBook = new Map(job.book_ids.map((id) => [id, { tokens: 0, pages: 0 }]));
    const bookOfPage = new Map();
    for await (const r of readAbstracts()) bookOfPage.set(r.page_id, r.book_id);
    let failed = 0;
    for await (const line of streamBatchResponses(st.responsesFile, KEY)) {
      const [pageId, hash] = String(line.key ?? line.metadata?.key ?? '').split('|');
      const b = perBook.get(bookOfPage.get(pageId));
      if (b) b.tokens += line.response?.usageMetadata?.promptTokenCount || 0;
      const v = line.response?.embedding?.values;
      if (line.error || !v || v.length !== EMBED_DIMS) { failed++; continue; }
      const n = Math.hypot(...v) || 1;
      ids.push({ page_id: pageId, content_hash: hash });
      vecs.push(Float32Array.from(v, (x) => x / n));
      if (b) b.pages++;
    }
    const buf = Buffer.alloc(vecs.length * EMBED_DIMS * 4);
    vecs.forEach((v, i) => Buffer.from(v.buffer).copy(buf, i * EMBED_DIMS * 4));
    fs.writeFileSync(path.join(vdir, `${job._id}.f32`), buf);
    fs.writeFileSync(path.join(vdir, `${job._id}.ids.json`), JSON.stringify(ids));
    let actual = 0;
    for (const [id, b] of perBook) {
      actual += usdForTokens(b.tokens, { batch: true });
      await completeBatchUsage({ batch_job_id: `${job._id}:${id}`, model: EMBED_MODEL, input_tokens: b.tokens, output_tokens: 0, cost_usd: +usdForTokens(b.tokens, { batch: true }).toFixed(6), status: b.tokens ? 'success' : 'failed', type: 'embedding', mode: 'batch', book_id: id, page_count: b.pages, endpoint: `${ENDPOINT}/embed` }, db);
    }
    await jobs.updateOne({ _id: job._id }, { $set: { status: 'embedded', state: st.state, collected_at: new Date(), actual_usd: +actual.toFixed(4), counts: { vectors: ids.length, failed } }, $unset: { page_ids: '' } });
    console.log(`${job._id}: ${ids.length} vectors, ${failed} failed, billed $${actual.toFixed(4)}`);
  }
}

// ── load into Supabase page_concepts ────────────────────────────────────────
async function load(db) {
  const rps = Number(arg('--rows-per-sec', 40));
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query('SET statement_timeout = 120000');
  const vdir = path.join(DIR, 'vectors');
  const loadedFile = path.join(DIR, 'loaded.json');
  const loaded = new Set(fs.existsSync(loadedFile) ? JSON.parse(fs.readFileSync(loadedFile, 'utf8')) : []);
  const meta = new Map();
  for await (const r of readAbstracts()) meta.set(r.page_id, r);
  for (const f of fs.readdirSync(vdir).filter((x) => x.endsWith('.ids.json')).sort()) {
    const jobId = f.replace('.ids.json', '');
    if (loaded.has(jobId)) continue;
    const ids = JSON.parse(fs.readFileSync(path.join(vdir, f), 'utf8'));
    const raw = fs.readFileSync(path.join(vdir, `${jobId}.f32`));
    const all = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
    // The abstract on the page must still be the one that was embedded.
    let skipped = 0; let written = 0; const t0 = Date.now();
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      const live = new Map((await pagesOf(db).find({ id: { $in: chunk.map((x) => x.page_id) } }).project({ id: 1, page_number: 1, 'concept_abstract.content_hash': 1, 'concept_abstract.data': 1 }).toArray()).map((p) => [String(p.id), p]));
      const params = []; const tuples = [];
      chunk.forEach((x, j) => {
        const p = live.get(x.page_id); const m = meta.get(x.page_id);
        if (!p || !m || p.concept_abstract?.content_hash !== x.content_hash) { skipped++; return; }
        const v = all.subarray((i + j) * EMBED_DIMS, (i + j + 1) * EMBED_DIMS);
        const vals = [x.page_id, m.book_id, p.page_number, p.concept_abstract.data, x.content_hash, PROMPT_VERSION, MODEL, RUN, `[${Array.from(v).join(',')}]`];
        tuples.push(`(${vals.map((val) => { params.push(val); return `$${params.length}`; }).join(', ')})`);
      });
      if (tuples.length) {
        await client.query(`INSERT INTO page_concepts (page_id, book_id, page_number, abstract, abstract_hash, prompt_version, model, run, embedding)
          VALUES ${tuples.join(', ')}
          ON CONFLICT (page_id) DO UPDATE SET book_id = EXCLUDED.book_id, page_number = EXCLUDED.page_number, abstract = EXCLUDED.abstract,
            abstract_hash = EXCLUDED.abstract_hash, prompt_version = EXCLUDED.prompt_version, model = EXCLUDED.model, run = EXCLUDED.run,
            embedding = EXCLUDED.embedding, updated_at = now()`, params);
        written += tuples.length;
      }
      const wait = (written / rps) * 1000 - (Date.now() - t0);
      if (wait > 0) await sleep(wait);
    }
    loaded.add(jobId);
    fs.writeFileSync(loadedFile, JSON.stringify([...loaded]));
    console.log(`${jobId}: ${written} rows loaded, ${skipped} skipped (abstract changed or missing), ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  await client.end();
}

async function status(db) {
  const rows = await db.collection(JOBS).find({ run: RUN }).project({ page_ids: 0, provenance: 0, book_ids: 0 }).sort({ created_at: 1 }).toArray();
  const sum = (k, f) => rows.filter(f).reduce((s, j) => s + (j[k] || 0), 0);
  for (const j of rows) console.log(`${j._id} ${j.kind} ${j.status} pages ${j.pages} est $${j.est_usd} actual $${j.actual_usd ?? '-'} ${j.counts ? JSON.stringify(j.counts) : ''}`);
  console.log(`committed $${(await committedUsd(db)).toFixed(2)}; billed so far $${sum('actual_usd', () => true).toFixed(2)}; generate pages submitted ${sum('pages', (j) => j.kind === 'generate' && !/failed/.test(j.status))}`);
}

await withMongo(async (db) => {
  if (CMD === 'select') return select(db);
  if (CMD === 'submit') return submit(db);
  if (CMD === 'collect') return collect(db);
  if (CMD === 'embed') return embed(db);
  if (CMD === 'embed-collect') return embedCollect(db);
  if (CMD === 'load') return load(db);
  if (CMD === 'status') return status(db);
  console.error('usage: select | submit | collect | embed | embed-collect | load | status  --dir D');
  process.exit(1);
}, { timeoutMs: 7_200_000 });
