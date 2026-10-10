#!/usr/bin/env node
/**
 * tradition-4773.mjs — label every book with 1–2 traditions from the closed list of 31 map
 * labels (src/lib/taxonomy/traditions.json) and store them as `books.tradition: string[]` (#4773).
 *
 * PRIOR ART: scripts/maintenance/faceted-tagger.mjs + `books.faceted_tags.tradition` — a 20-value
 * school vocabulary (hermetic, paracelsian, masonic…) on 23.7K books, 6.1K of them live, with
 * "classical" on 11.1K and "manichaean" on 1.3K; a different question (school of thought) and too
 * thin to rank on. enrich-worker.mjs Phase 7.6 (collection assignment) — the same evidence and
 * model, realtime, 25 books per call; #4773 proposed piggybacking on it, but that phase sees only
 * books in its statuses, so the backfill is this standalone pass. Batch submit/collect shape
 * follows scripts/eval/langid-5777.mjs.
 *
 * WHAT READS THE FIELD. The search diversity re-rank (src/lib/search/diversity.ts) counts
 * results per tradition family. Nothing else: no cron, no badge, no catalogue sync.
 *
 * PROVENANCE. A sweep records a ROW (field-sprawl.md): every write adds a `sweep_log` row
 * (sweep `tradition-4773`, action `set-tradition`) with the labels, model, prompt version and
 * Batch job. The field holds only the labels.
 *
 * MONEY. gemini-3.1-flash-lite through the Batch API. --submit prints the estimate from the real
 * request text, needs --approved-usd ≥ estimate, refuses above HARD_CAP_USD, and asks the spend
 * gate under the lane label `tradition-4773` (envelope: set-scope.mjs --tag tradition-4773
 * --books tradition-4773 --budget 5 --lanes tradition-4773 --meter-endpoints maintenance/tradition-4773).
 * Usage is written at submit (estimate) and replaced with billed tokens at collect.
 *
 * Phases (each resumable; state in --work, default /data/scratch/sl/claude-jobs/cross-tradition-fix-work/tradition):
 *   --pick [--only-missing]   books with pages                      FREE → picks.jsonl
 *   --submit --approved-usd X [--retry]                             PAID → batch.json
 *   --collect [--wait-min M]                                        FREE → raw.jsonl
 *   --sample N [--seed S]     N random labelled books to read       FREE → sample.md
 *   --apply [--dry-run]       write books.tradition + sweep_log rows
 *
 *   node --env-file=.env.production.local scripts/maintenance/tradition-4773.mjs --pick
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { priceFor, BATCH_MULTIPLIER } from '../lib/model-pricing.mjs';
import { uploadBatchInputFile, createThenDeleteInput, streamBatchResponses } from '../lib/gemini-batch-input-file.mjs';
import { budgetAllowsDispatchScoped } from '../lib/spend-guard.mjs';
import { recordSweepActions } from '../lib/sweep-log.mjs';
import { logUsage, completeBatchUsage } from '../workers/lib/supabase-usage-logger.mjs';

export const SWEEP = 'tradition-4773';
export const PROMPT_VERSION = 'tradition-4773-v1';
export const MODEL = 'gemini-3.1-flash-lite';
const ENDPOINT = 'maintenance/tradition-4773';
const HARD_CAP_USD = 5;
const PER_REQUEST = 25;
const API = 'https://generativelanguage.googleapis.com/v1beta';

const VOCAB = JSON.parse(fs.readFileSync(new URL('../../src/lib/taxonomy/traditions.json', import.meta.url), 'utf8'));
export const LABELS = VOCAB.labels.map((l) => l.label);
const LABEL_SET = new Set(LABELS);

export const SYSTEM_PROMPT = `You are a librarian assigning each book in a digital library of historical primary sources to the tradition it belongs to.

TRADITIONS (a closed list; use these exact strings):
${LABELS.map((l) => `- ${l}`).join('\n')}

RULES:
1. Assign 1 or 2 traditions per book. Most books get 1. Give 2 only when the work really stands in two (a Latin Kabbalah by a Renaissance Christian: "Kabbalistic & Hasidic" and "Renaissance & Early Modern Europe").
2. A translation belongs to the tradition of its SOURCE: a German Bhagavad Gita is "Indian", a Latin Avicenna is "Arabic", an English Zohar is "Kabbalistic & Hasidic".
3. A study, commentary or history belongs to the tradition it studies. A modern edition of an ancient text belongs to the ancient text's tradition.
4. For European works with no older source, choose by when the work was WRITTEN: "Medieval Latin" (about 500–1400), "Renaissance & Early Modern Europe" (about 1400–1750), "Modern European" (after about 1750). European settler writing in the Americas or elsewhere follows the same rule.
5. "Buddhist" is for Buddhist texts of India, Central Asia and those not better placed in "Tibetan", "Chinese", "Japanese", "Korean & Vietnamese" or "Southeast Asian". A Chinese Buddhist sutra gets "Chinese" and "Buddhist".
6. "Hermetic & Gnostic" is for the ancient Hermetica, Gnostic and related texts and for works whose main subject is that lineage (alchemy and magic of 1400–1750 are "Renaissance & Early Modern Europe", with "Hermetic & Gnostic" second only if the work is expressly Hermetic).
7. If the metadata does not let you tell (an empty or generic title with nothing else), return an empty list. Never invent a label.

Respond with a JSON array, one entry per book, in input order: {"i": <index>, "t": ["<label>", ...]}
No explanation.`;

const args = process.argv.slice(2);
const has = (f) => args.includes(`--${f}`);
const opt = (f, d) => { const i = args.indexOf(`--${f}`); return i >= 0 ? args[i + 1] : d; };
const WORK = opt('work', '/data/scratch/sl/claude-jobs/cross-tradition-fix-work/tradition');
const inWork = (f) => path.join(WORK, f);
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** One line of evidence per book: what a cataloguer would read off the record. */
export function bookLine(b, i) {
  const parts = [`${i}. ${clip(b.title, 160) || '(no title)'}`];
  const dt = clip(b.display_title, 120);
  if (dt && dt !== clip(b.title, 120)) parts.push(`EN: ${dt}`);
  if (b.author) parts.push(`by ${clip(b.author, 80)}`);
  const year = b.year ?? b.published;
  if (year) parts.push(`(${clip(year, 20)})`);
  if (b.language) parts.push(`lang: ${clip(b.language, 30)}`);
  if (b.original_language && b.original_language !== b.language) parts.push(`orig: ${clip(b.original_language, 30)}`);
  if (b.place_published) parts.push(`place: ${clip(b.place_published, 40)}`);
  const tags = [...(b.collections || []), ...(b.categories || [])].slice(0, 6);
  if (tags.length) parts.push(`tags: ${tags.map((t) => clip(t, 40)).join(', ')}`);
  const summary = clip(typeof b.summary === 'string' ? b.summary : b.summary?.data, 160);
  if (summary) parts.push(`about: ${summary}`);
  return parts.join(' | ');
}

/** Labels outside the closed list are dropped (and counted); at most two kept, in the model's order. */
export function cleanLabels(t) {
  const out = [], dropped = [];
  for (const raw of Array.isArray(t) ? t : []) {
    const l = String(raw).trim();
    if (LABEL_SET.has(l)) { if (!out.includes(l)) out.push(l); } else dropped.push(l);
  }
  return { labels: out.slice(0, 2), dropped };
}

export function parseAnswer(text) {
  const m = String(text || '').replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '').trim();
  try { const v = JSON.parse(m); return Array.isArray(v) ? v : null; } catch { return null; }
}

async function withDb(fn) {
  const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
  try { return await fn(client.db(process.env.MONGODB_DB || 'bookstore')); } finally { await client.close(); }
}

async function phasePick() {
  fs.mkdirSync(WORK, { recursive: true });
  await withDb(async (db) => {
    const filter = { pages_count: { $gt: 0 } };
    const books = await db.collection('books').find(filter, {
      projection: { _id: 0, id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1, original_language: 1, place_published: 1, collections: 1, categories: 1, 'summary.data': 1, tradition: 1, visible: 1 },
    }).toArray();
    const rows = books.filter((b) => b.id && (!has('only-missing') || b.tradition === undefined)).sort((a, b) => (a.id < b.id ? -1 : 1));
    fs.writeFileSync(inWork('picks.jsonl'), rows.map((b) => JSON.stringify(b)).join('\n') + '\n');
    console.log(`picks.jsonl: ${rows.length} books (pages_count > 0${has('only-missing') ? ', no tradition yet' : ''}); live ${rows.filter((b) => b.visible === true).length}`);
  });
}

const recPath = () => inWork('batch.json');
const loadRec = () => (fs.existsSync(recPath()) ? JSON.parse(fs.readFileSync(recPath(), 'utf8')) : { model: MODEL, prompt_version: PROMPT_VERSION, jobs: [] });
const saveRec = (rec) => fs.writeFileSync(recPath(), JSON.stringify(rec, null, 1) + '\n');
const keyEnv = () => (process.env.GEMINI_API_KEY_TIER3 ? 'GEMINI_API_KEY_TIER3' : 'GEMINI_API_KEY');

async function phaseSubmit() {
  const rec = loadRec();
  if (rec.jobs.some((j) => !j.collected_at)) throw new Error('uncollected job(s) in batch.json; run --collect first');
  if (rec.jobs.length && !has('retry')) throw new Error('already submitted; --retry sends only the books with no answer yet');
  const answered = new Set(readJsonl(inWork('raw.jsonl')).map((r) => r.book_id));
  const todo = readJsonl(inWork('picks.jsonl')).filter((b) => !answered.has(b.id));
  if (!todo.length) { console.log('nothing to submit'); return; }
  const attempt = rec.jobs.reduce((m, j) => Math.max(m, j.attempt || 1), 0) + 1;
  const lines = [];
  for (let c = 0; c * PER_REQUEST < todo.length; c++) {
    const chunk = todo.slice(c * PER_REQUEST, (c + 1) * PER_REQUEST);
    lines.push(JSON.stringify({
      key: `a${attempt}-${c}:${chunk.map((b) => b.id).join(',')}`,
      request: {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: `Books:\n${chunk.map((b, i) => bookLine(b, i)).join('\n')}` }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 2000, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } },
      },
    }));
  }
  const body = lines.join('\n');
  // ~3.6 characters per token over mixed Latin-script metadata (CJK titles run denser: the
  // estimate is padded 25%); ~22 output tokens per book.
  const p = priceFor(MODEL);
  const inTok = Math.ceil((body.length / 3.6) * 1.25), outTok = todo.length * 22;
  const estimate = BATCH_MULTIPLIER * ((inTok / 1e6) * p.input + (outTok / 1e6) * p.output);
  const spent = rec.jobs.reduce((s, j) => s + (j.cost_usd || 0), 0);
  const approved = Number(opt('approved-usd', 0));
  console.log(`${todo.length} books in ${lines.length} requests (${(body.length / 1e6).toFixed(1)} MB); ESTIMATE (Batch, ${MODEL}): $${estimate.toFixed(3)}; spent so far $${spent.toFixed(3)}`);
  if (has('estimate-only')) return;
  if (!(approved >= estimate)) throw new Error(`--approved-usd ${approved} is below the estimate $${estimate.toFixed(3)}`);
  if (spent + estimate > HARD_CAP_USD) throw new Error(`spent $${spent.toFixed(2)} + estimate $${estimate.toFixed(2)} passes the hard cap $${HARD_CAP_USD}`);
  const key = process.env[keyEnv()];
  if (!key) throw new Error(`${keyEnv()} not set`);
  await withDb(async (db) => {
    const gate = await budgetAllowsDispatchScoped(db, SWEEP);
    if (!gate.allowed || (gate.envelopeIds && !gate.envelopeIds.has(SWEEP))) throw new Error('spend gate closed for tradition-4773 (set the envelope with set-scope.mjs; see the header)');
    const name = `tradition-4773-a${attempt}`;
    const fileName = await uploadBatchInputFile(body, name, key);
    const job = await createThenDeleteInput({
      fileName, apiKey: key,
      create: async () => {
        const r = await fetch(`${API}/models/${MODEL}:batchGenerateContent?key=${key}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batch: { display_name: name, input_config: { file_name: fileName } } }),
        });
        if (!r.ok) throw new Error(`batch create ${r.status} ${(await r.text()).slice(0, 500)}`);
        return r.json();
      },
    });
    rec.key_env = keyEnv();
    rec.jobs.push({ attempt, job_name: job.name, requests: lines.length, books: todo.length, estimate_usd: +estimate.toFixed(4), approved_usd: approved, submitted_at: new Date().toISOString() });
    saveRec(rec);
    await logUsage({ type: 'enrichment', mode: 'batch', model: MODEL, book_id: SWEEP, page_count: todo.length, cost_usd: +estimate.toFixed(4), status: 'submitted', batch_job_id: job.name, endpoint: ENDPOINT, triggered_by: 'manual', prompt_version: PROMPT_VERSION }, db);
    console.log(`submitted ${job.name}`);
  });
}

async function phaseCollect() {
  const rec = loadRec();
  const key = process.env[rec.key_env];
  const waitMax = Number(opt('wait-min', 0)) * 60e3, t0 = Date.now();
  const p = priceFor(MODEL);
  for (;;) {
    let pending = 0;
    for (const j of rec.jobs) {
      if (j.collected_at) continue;
      const data = await (await fetch(`${API}/${j.job_name}?key=${key}`)).json();
      const state = data.metadata?.state || data.state;
      const rf = data.metadata?.output?.responsesFile || data.response?.responsesFile;
      console.log(`${j.job_name} ${state} ${JSON.stringify(data.metadata?.batchStats || {})}`);
      if (!rf && /FAILED|CANCELLED|EXPIRED/.test(state || '')) {
        Object.assign(j, { collected_at: new Date().toISOString(), state, answered: 0, cost_usd: 0, dead: JSON.stringify(data.error || '').slice(0, 200) });
        saveRec(rec);
        await completeBatchUsage({ batch_job_id: j.job_name, model: MODEL, input_tokens: 0, output_tokens: 0, status: 'failed', error_message: state, insertIfMissing: false });
        continue;
      }
      if (!rf) { pending++; continue; }
      let inTok = 0, outTok = 0, answered = 0, failedRequests = 0, droppedLabels = 0;
      const out = fs.createWriteStream(inWork('raw.jsonl'), { flags: 'a' });
      for await (const r of streamBatchResponses(rf, key)) {
        const k = r.key || r.metadata?.key || '';
        const ids = k.slice(k.indexOf(':') + 1).split(',');
        const resp = r.response, u = resp?.usageMetadata || {};
        inTok += u.promptTokenCount || 0;
        outTok += (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
        const text = (resp?.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('');
        const arr = r.error || !resp ? null : parseAnswer(text);
        if (!arr) { failedRequests++; continue; }
        for (const e of arr) {
          const id = ids[Number(e?.i)];
          if (!id) continue;
          const { labels, dropped } = cleanLabels(e.t);
          droppedLabels += dropped.length;
          out.write(JSON.stringify({ book_id: id, tradition: labels, ...(dropped.length ? { dropped } : {}), job: j.job_name }) + '\n');
          answered++;
        }
      }
      await new Promise((res) => out.end(res));
      const cost = BATCH_MULTIPLIER * ((inTok / 1e6) * p.input + (outTok / 1e6) * p.output);
      Object.assign(j, { collected_at: new Date().toISOString(), state, answered, failed_requests: failedRequests, dropped_labels: droppedLabels, in_tokens: inTok, out_tokens: outTok, cost_usd: +cost.toFixed(5) });
      saveRec(rec);
      await completeBatchUsage({ batch_job_id: j.job_name, model: MODEL, input_tokens: inTok, output_tokens: outTok, status: 'success', type: 'enrichment', mode: 'batch', book_id: SWEEP, page_count: answered, endpoint: ENDPOINT });
      console.log(`collected ${answered} books (${failedRequests} failed requests, ${droppedLabels} labels outside the list) $${cost.toFixed(4)}`);
    }
    if (!pending) { console.log(`all collected; billed $${rec.jobs.reduce((s, j) => s + (j.cost_usd || 0), 0).toFixed(4)}`); return; }
    if (Date.now() - t0 > waitMax) { console.log(`${pending} job(s) pending; re-run --collect`); return; }
    await new Promise((r) => setTimeout(r, 60e3));
  }
}

/** Last answer per book wins (a retry replaces a first answer only for books that had none). */
function answers() {
  const m = new Map();
  for (const r of readJsonl(inWork('raw.jsonl'))) if (!m.has(r.book_id)) m.set(r.book_id, r);
  return m;
}

function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function phaseSample() {
  const n = Number(opt('sample', 30)), rnd = mulberry32(Number(opt('seed', 4773)));
  const ans = answers();
  const picks = readJsonl(inWork('picks.jsonl')).filter((b) => ans.has(b.id));
  const pool = has('live') ? picks.filter((b) => b.visible === true) : picks;
  const chosen = [];
  const idx = pool.map((_, i) => i);
  for (let k = 0; k < Math.min(n, idx.length); k++) { const j = k + Math.floor(rnd() * (idx.length - k)); [idx[k], idx[j]] = [idx[j], idx[k]]; chosen.push(pool[idx[k]]); }
  const md = chosen.map((b, i) => `${i + 1}. \`${b.id}\` **${JSON.stringify(ans.get(b.id).tradition)}** — ${bookLine(b, '').replace(/^\. /, '')}`).join('\n');
  fs.writeFileSync(inWork('sample.md'), md + '\n');
  console.log(md);
}

async function phaseApply() {
  const ans = answers();
  const dry = has('dry-run');
  const dist = {};
  for (const r of ans.values()) for (const l of r.tradition.length ? r.tradition : ['(none)']) dist[l] = (dist[l] || 0) + 1;
  console.log(`${ans.size} labelled books`, dist);
  if (dry) return;
  await withDb(async (db) => {
    const rows = [...ans.values()];
    let written = 0, same = 0;
    for (let i = 0; i < rows.length; i += 1000) {
      // Resumable: a book whose stored labels already equal the answer is skipped, so a
      // second run writes no duplicate sweep_log rows.
      const slice = rows.slice(i, i + 1000);
      const stored = new Map((await db.collection('books').find({ id: { $in: slice.map((r) => r.book_id) } }, { projection: { _id: 0, id: 1, tradition: 1 } }).toArray()).map((b) => [b.id, b.tradition]));
      const chunk = slice.filter((r) => stored.has(r.book_id) && JSON.stringify(stored.get(r.book_id)) !== JSON.stringify(r.tradition));
      same += slice.length - chunk.length;
      if (!chunk.length) continue;
      // An empty list is stored too: "read and no tradition discernible" is not "never read".
      const res = await db.collection('books').bulkWrite(chunk.map((r) => ({ updateOne: { filter: { id: r.book_id }, update: { $set: { tradition: r.tradition } } } })), { ordered: false });
      await recordSweepActions(db, chunk.map((r) => ({ sweep: SWEEP, book_id: r.book_id, action: 'set-tradition', detail: { tradition: r.tradition, model: MODEL, prompt_version: PROMPT_VERSION, batch_job: r.job, ...(r.dropped ? { dropped: r.dropped } : {}) } })));
      written += res.matchedCount;
      console.log(`  ${written} written, ${same} already stored`);
    }
    console.log(`books.tradition written on ${written} books (one sweep_log row each); ${same} already stored or gone`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (has('pick')) await phasePick();
  else if (has('submit')) await phaseSubmit();
  else if (has('collect')) await phaseCollect();
  else if (has('sample')) phaseSample();
  else if (has('apply')) await phaseApply();
  else console.log('usage: --pick | --submit --approved-usd X [--retry] [--estimate-only] | --collect [--wait-min M] | --sample N | --apply [--dry-run]');
  process.exit(0);
}
