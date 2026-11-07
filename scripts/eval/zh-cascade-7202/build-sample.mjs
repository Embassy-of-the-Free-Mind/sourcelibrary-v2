#!/usr/bin/env node
// PRIOR ART: scripts/eval/xlref-t5/assemble.py + run-arms.mjs (#5695 T5: the 24 classical Chinese reference pages and
// their single-page v13 prompt, reused here as-is) and scripts/eval/pareto-6182/units.mjs (prebuilt one-page requests so
// every arm sends the byte-identical prompt). Neither draws Siku pages: the 40 come from the #5600 Paddle cohort's own
// apply logs and its Kanripo QA screen (scripts/workers/paddle-zh-lane.mjs qaScreen, ocr.qa_screen on each page).
/**
 * build-sample.mjs — the page sample and the prebuilt requests of #7202 (a cheap-model cascade for classical Chinese).
 * Eval only: reads Mongo, the #5600 cohort logs and Kanripo; writes NOTHING to the database.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/zh-cascade-7202/build-sample.mjs \
 *        --work $JOB_SCRATCH/work [--seed 7202] [--dry-run]
 *
 * Writes <work>/records.jsonl (one judge record per page, no candidates yet), <work>/units.jsonl (one request per page:
 * the v13 prompt, the same prompt + the residue rule for the OpenRouter arms, max_out) and <work>/sample.json (the draw).
 *
 * THE DRAW (preregistered on #7202). T5: the 24 Chinese records of scripts/eval/results/xlref-t5-2026-10/work/records-arms.jsonl,
 * their source_text exactly as T5's arms translated it. Siku: mulberry32(seed) over the #5600 cohort
 * (/root/paddle-zh-5600/{qa-flagged,applied}.jsonl); books whose title matches SEAL are excluded (Paddle misreads seal
 * script, #5660). Flagged stratum: books in the shuffled order of qa-flagged books, one flagged page (Dice < 0.6) drawn per
 * book. Clean stratum: books the screen read (applied-books qa_screened > 0), not already drawn, shuffled; one applied page
 * drawn per book. A drawn page is ACCEPTED when, in Mongo now: its OCR is the Paddle read (ocr.source 'paddle'), it has
 * >= 100 Han characters, no translation, and its book carries no hold other than the cohort's own `paddle-zh-5600-ocr-only`; and for the clean stratum, ocr.qa_screen says screened and
 * not flagged. The first 20 accepted books per stratum are the sample; a rejected draw moves to the next book.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { MongoClient } from 'mongodb';
import { resetSeed, seededRand } from '../lib/paired-stats.mjs';
import { buildTranslationPrompt, loadTranslationPrompts, PAGE_BREAK_SCOPED } from '../../lib/translate-core.mjs';
import { maxOutputTokensFor } from '../../lib/translate-batch-seam.mjs';
import { isHeld } from '../../lib/pipeline-hold.mjs';
import { pbPages } from '../zh-skqs-5568-kanripo.mjs';
import { RESIDUE_RULE } from './gates.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const WORK = opt('work'); const SEED = Number(opt('seed', 7202)); const N_PER = 20;
const COHORT = '/root/paddle-zh-5600';
const T5 = new URL('../results/xlref-t5-2026-10/work/records-arms.jsonl', import.meta.url).pathname;
const COHORT_HOLD = 'paddle-zh-5600-ocr-only';
const SEAL = /六書|說文|汗簡|古文四聲|篆|隸|字源|錢錄|西清/;
if (!WORK) { console.error('--work required'); process.exit(1); }
fs.mkdirSync(WORK, { recursive: true });
const han = (s) => [...String(s || '')].filter((c) => /\p{Script=Han}/u.test(c)).length;
const jl = async (f, fn) => { const rl = readline.createInterface({ input: fs.createReadStream(f) }); for await (const l of rl) if (l.trim()) fn(JSON.parse(l)); };

resetSeed(SEED);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(seededRand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ── the cohort's logs ─────────────────────────────────────────────────────────────────────────────────────────
const flaggedBy = new Map(), titleOf = new Map();
await jl(path.join(COHORT, 'qa-flagged.jsonl'), (r) => { if (r.dice < 0.6) { (flaggedBy.get(r.bid) || flaggedBy.set(r.bid, []).get(r.bid)).push(r); titleOf.set(r.bid, r.title); } });
const screened = new Set();
await jl(path.join(COHORT, 'applied-books.jsonl'), (r) => { if (r.qa_screened > 0) screened.add(r.bid); });
const appliedBy = new Map();
await jl(path.join(COHORT, 'applied.jsonl'), (r) => { if (screened.has(r.bid) && (r.han ?? 0) >= 100) (appliedBy.get(r.bid) || appliedBy.set(r.bid, []).get(r.bid)).push(r); });
for (const v of flaggedBy.values()) v.sort((a, b) => a.pn - b.pn);
for (const v of appliedBy.values()) v.sort((a, b) => a.pn - b.pn);
const flaggedBooks = shuffle([...flaggedBy.keys()].sort());
const cleanBooks = shuffle([...appliedBy.keys()].sort());
console.log(`cohort: ${flaggedBy.size} books with a flagged page, ${screened.size} screened books, ${appliedBy.size} with an applied page of >= 100 Han`);

const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const db = client.db('bookstore');
const prompts = await loadTranslationPrompts(db);
const rejected = [];
async function accept(bid, row, stratum) {
  const book = await db.collection('books').findOne({ id: bid });
  if (!book) return rejected.push({ bid, why: 'book not found' }) && null;
  if (SEAL.test(book.title || '')) return rejected.push({ bid, why: 'seal-script title' }) && null;
  // Every cohort book carries the #5600 hold until its translation is decided (this experiment informs that decision).
  if (isHeld(book) && book.pipeline_auto.hold.reason !== COHORT_HOLD) return rejected.push({ bid, why: `held: ${book.pipeline_auto.hold.reason}` }) && null;
  const p = await db.collection('pages').findOne({ book_id: bid, page_number: row.pn }, { projection: { id: 1, page_number: 1, ocr: 1, 'translation.data': 1 } });
  if (!p?.ocr?.data) return rejected.push({ bid, pn: row.pn, why: 'no OCR' }) && null;
  if (p.ocr.source !== 'paddle') return rejected.push({ bid, pn: row.pn, why: `ocr.source ${p.ocr.source}` }) && null;
  if (p.translation?.data) return rejected.push({ bid, pn: row.pn, why: 'already translated' }) && null;
  if (han(p.ocr.data) < 100) return rejected.push({ bid, pn: row.pn, why: '< 100 Han' }) && null;
  const qa = p.ocr.qa_screen;
  if (qa?.status !== 'screened' || !qa.pb) return rejected.push({ bid, pn: row.pn, why: 'not screened' }) && null;
  if (stratum === 'flagged' && !qa.flagged) return rejected.push({ bid, pn: row.pn, why: 'no longer flagged' }) && null;
  if (stratum === 'clean' && qa.flagged) return rejected.push({ bid, pn: row.pn, why: 'flagged' }) && null;
  return { book, page: p, qa };
}
const siku = [];
for (const [stratum, books, rowsOf] of [['flagged', flaggedBooks, flaggedBy], ['clean', cleanBooks, appliedBy]]) {
  let n = 0;
  for (const bid of books) {
    if (n >= N_PER) break;
    if (siku.some((s) => s.book.id === bid)) continue;
    const rows = rowsOf.get(bid);
    const row = rows[Math.floor(seededRand() * rows.length)];
    const a = await accept(bid, row, stratum);
    if (!a) continue;
    siku.push({ stratum, ...a }); n++;
  }
  console.log(`${stratum}: ${n} accepted`);
}

// ── Kanripo's WYG text at the page's best-matching pb: the check on the source ──────────────────────────────────
async function kanripoText(qa) {
  const krId = qa.repo.replace(/^kanripo\//, '');
  const m = qa.pb.match(/_(\d{3})-(\d+)([ab])$/);
  const pages = await pbPages(krId, 'WYG', [Number(m[1])]);
  const i = pages.findIndex((x) => x.pb === qa.pb);
  return i < 0 ? null : pages[i].raw.replace(/¶/g, '').replace(/\n{2,}/g, '\n').trim();
}

const records = [], units = [];
const neighbours = async (bookId, pn) => {
  const near = await db.collection('pages').find({ book_id: bookId, page_number: { $in: [pn - 1, pn + 1] } }, { projection: { page_number: 1, 'ocr.data': 1 } }).toArray();
  return { prev: near.find((x) => x.page_number === pn - 1)?.ocr?.data, next: near.find((x) => x.page_number === pn + 1)?.ocr?.data };
};
const addUnit = async (set, book, pn, source) => {
  const { prev, next } = await neighbours(book.id, pn);
  const built = buildTranslationPrompt({ prompts, book, ocrText: source, prevOcrText: prev || undefined, nextOcrText: next || undefined, pageBreak: PAGE_BREAK_SCOPED });
  const uid = `${book.id}_${String(pn).padStart(5, '0')}`;
  units.push({ uid, set, book_id: book.id, page_number: pn, prompt: built.prompt, prompt_or: `${built.prompt}\n\n${RESIDUE_RULE}`, prompt_ref: built.promptRef, max_out: maxOutputTokensFor([{ ocr: { data: source } }]), source_han: han(source) });
  return { prev, next };
};
const tail = (s) => (s ? s.slice(-300) : undefined), head = (s) => (s ? s.slice(0, 300) : undefined);

for (const l of fs.readFileSync(T5, 'utf8').split('\n').filter(Boolean)) {
  const r = JSON.parse(l);
  if (r.lang !== 'Chinese') continue;
  const book = await db.collection('books').findOne({ id: r.book_id });
  await addUnit('t5', book, r.page_number, r.source_text);
  const { candidates, ...rest } = r;
  records.push({ ...rest, track: 'T5-zh', stratum: 'T5', candidates: [] });
}
for (const s of siku) {
  const kr = await kanripoText(s.qa);
  const { prev, next } = await addUnit('siku', s.book, s.page.page_number, s.page.ocr.data);
  records.push({
    track: 'siku', stratum: s.stratum, lang: 'Chinese', book_id: s.book.id, page_number: s.page.page_number, title: s.book.title,
    source_text: s.page.ocr.data, ocr_hash: s.page.ocr.content_hash ?? null,
    reference_text: kr || '(no Kanripo text found at this pb)',
    reference_meta: { kind: 'source_witness', title: `Kanripo ${s.qa.repo} ${s.qa.ref} @ ${s.qa.pb}`, translator: 'Kanripo project (WYG digital transcription, Chinese — a second witness of the source, not a translation)',
      year: null, licence: 'CC BY-SA (Kanripo organisation statement)', private: false, style: 'literal', canonical: false, located: s.qa.pb,
      url: `https://github.com/${s.qa.repo}/blob/${s.qa.ref}/${s.qa.pb.replace(/-\d+[ab]$/, '')}.txt`,
      coverage_note: `Kanripo alignment Dice ${s.qa.dice} (runner-up ${s.qa.runner_up}); ${s.qa.flagged ? 'FLAGGED (< 0.6): the Kanripo page may be a different passage, or the OCR may be wrong' : 'aligned (>= 0.6)'}` },
    qa_screen: { dice: s.qa.dice, flagged: !!s.qa.flagged, pb: s.qa.pb },
    source_prev_tail: tail(prev), source_next_head: head(next), candidates: [],
  });
}
await client.close();
const w = (f, rows) => fs.writeFileSync(path.join(WORK, f), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
w('records.jsonl', records); w('units.jsonl', units);
fs.writeFileSync(path.join(WORK, 'sample.json'), JSON.stringify({ seed: SEED, built: new Date().toISOString(), cohort: COHORT,
  cohort_counts: { flagged_books: flaggedBy.size, screened_books: screened.size }, t5: records.filter((r) => r.track === 'T5-zh').length,
  siku: siku.map((s) => ({ stratum: s.stratum, book_id: s.book.id, title: s.book.title, page_number: s.page.page_number, page_id: s.page.id, dice: s.qa.dice, pb: s.qa.pb })), rejected }, null, 1));
console.log(`${records.length} records (${units.filter((u) => u.set === 't5').length} T5 + ${units.filter((u) => u.set === 'siku').length} Siku), ${rejected.length} draws rejected → ${WORK}`);
