#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/fill-english-title-from-inline-gloss-4390.mjs — the free half of #4390: it promotes
// an English gloss already present in `title` and generates nothing, so it cannot reach the ~20K books whose title
// carries no English at all. scripts/workers/pipeline-orchestrator.mjs Phase 1.6 writes `display_title` with the rule
// reused below, but only for books passing through `archive_complete` with preview OCR — the books this script
// exists for arrived by another lane (#7614) and never pass there.
/**
 * fill-display-title-agy-4390 — an English `display_title` for every live non-English book that lacks one
 * (#4390, #7614).
 *
 * WHY. Readers see `display_title || title`. A book that reached the shelf by a side lane (CLI translation, the
 * GPU/Paddle OCR cohorts, scans-only publishing) never passed Phase 1.6, so it shows only its original title:
 * 11,409 Chinese books, 5,292 Latin, and ~3,500 in 60 other languages (measured 2026-10-28, visible + pages_count > 0).
 * `display_title` is THE English gloss (.claude/docs/i18n.md) and is searched at boost 10 (src/lib/atlas-search.ts).
 *
 * HOW.
 *   1. Every title is translated on the agy CLI (Gemini on the subscription, $0), up to 40 titles a call. Books are
 *      grouped by WORK (`work_id`), so every volume of a work gets the same English base title: a work too large
 *      for one call is split, and each later chunk is given the base title the first chunk settled on.
 *      `english_title` is NOT copied across: measured 2026-10-28 it holds shelfmarks ("Reg.lat.1300" for the
 *      Liber Razielis), and #4390 found it disagreeing with display_title on ~28% of a sample.
 *   2. Each answer is checked mechanically (Latin script only, not the original title back, not the author, not a
 *      collection name alone, sane length). A failed check is a recorded skip, never a write.
 *
 * PROVENANCE. The value and its stamp go in ONE updateOne, filtered on display_title still being empty (fill-only:
 * a value another writer set meanwhile is never replaced). `field_provenance.display_title` (+ history) records
 * source, method, engine (cli, model, prompt hash), the input the model saw, the run tag and `review: 'unreviewed'`;
 * a `sweep_log` row is written per book. Every model answer, written or skipped, lands in
 * scripts/output/display-title-4390/<run>.jsonl so a re-run reuses it (`--from-jsonl`) instead of asking again.
 *
 * Usage (dry run by default — it calls the model and writes the JSONL, but writes nothing to Mongo):
 *   node --env-file=.env.production.local scripts/maintenance/fill-display-title-agy-4390.mjs --limit=80
 *   node --env-file=.env.production.local scripts/maintenance/fill-display-title-agy-4390.mjs --apply
 *   ... --language=Latin            only one language
 *   ... --recent-days=14            only books translated in the last N days
 *   ... --from-jsonl=FILE --apply   write answers already kept in FILE, no model calls
 *   ... --concurrency=3 --model=gemini-3.8-flash-low
 *   ... --normalize [--apply]       volumes of one work → the base title most of them carry (no model calls)
 *   ... --backfill-sweep-log --apply  sweep_log rows for titles a stopped run wrote without them
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { gatedTextCall } from '../lib/agy-cli.mjs';
import { provenanceUpdate } from '../lib/field-provenance.mjs';
import { recordSweepActions } from '../lib/sweep-log.mjs';

const args = process.argv.slice(2);
const arg = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const APPLY = args.includes('--apply');
const LIMIT = Number(arg('limit') || 0);
const LANGUAGE = arg('language');
const RECENT_DAYS = Number(arg('recent-days') || 0);
const FROM_JSONL = arg('from-jsonl');
const CONCURRENCY = Number(arg('concurrency') || 3);
const MODEL = arg('model') || 'gemini-3.8-flash-low';
const NORMALIZE = args.includes('--normalize');
const BACKFILL_SWEEP_LOG = args.includes('--backfill-sweep-log');
const PER_CALL = 40;

const SWEEP = 'display-title-agy-4390';
const RUN = arg('run') || `${SWEEP}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}`;
const OUT_DIR = 'scripts/output/display-title-4390';
const OUT = path.join(OUT_DIR, `${RUN}.jsonl`);
const SCRIPT = 'scripts/maintenance/fill-display-title-agy-4390.mjs';

// Any letter outside Latin (with its diacritics), punctuation, digits and spaces: Greek, Cyrillic, Hebrew, Arabic,
// Syriac, Indic, Tibetan, CJK, kana, Hangul … An English title containing one of these is not an English title.
const NON_LATIN_LETTER = /(?![\p{Script=Latin}])\p{L}/u;
// A shelfmark or catalogue number is not a title: "Reg.lat.1300", "Vat. gr. 1065", "MS 12", "Cod. 44", "Hs. or. 18".
const SHELFMARK = /^(?:[A-Z][a-z]{0,5}\.\s?)+(?:[a-z]{1,5}\.\s?)*\d+[a-z]?$|^(?:MS|Ms|Cod|Hs|Hsr)\.?\s/;
const COLLECTION_ONLY = /^(siku quanshu|complete library of the four treasuries|imperial collection.*four treasuries)$/i;

export const PROMPT_RULES = `You give English titles for books in a historical library. For each book below, write the title a scholar would use in an English catalogue.

Rules:
- Conventional English names when they exist (e.g. "Book of Changes", "Physics", "The Consolation of Philosophy"); a faithful literal translation otherwise.
- Translate the WHOLE title. Keep volume, part, juan (卷) and chapter markers, in English with Arabic numerals: "卷三十七 (vol 20)" becomes "juan 37 (vol 20)"; a range "卷二~卷五" becomes "juan 2–5"; 卷上 / 卷中 / 卷下 become "first / middle / last juan".
- Proper names (people, places) in their usual English or romanised form (pinyin for Chinese).
- No shelfmarks, library names, editors, publishers, imprints or edition notes ("Teubner", "Loeb", "critical edition", "1925 copy", a manuscript number).
- Keep the authors or works a title names: "Patrologia Graeca vol. 6: Justinus Martyr et alii" becomes "Patrologia Graeca, Vol. 6: Justin Martyr and Others"; an author in the genitive stays: "Pappi Alexandrini Collectionis, Vol. I" becomes "Pappus of Alexandria: Collection, Vol. 1".
- Long early-modern Latin titles: give the main title, shortened to its sense (about 4 to 15 words), not the whole title page.
- If the title is already English, give it unchanged.
- Books with the same "work" key are volumes of one work: they must share one identical English base title, with only the volume part differing.`;

const ANSWER_SHAPE = `Answer with JSON only, between two marker lines <<<BEGIN>>> and <<<END>>>, nothing outside them:
{"works": {"<work key>": "<English base title of the work>"}, "titles": [{"k": <number>, "t": "<English title of that book>"}]}`;

export function buildPrompt(items, anchors) {
  const lines = items.map((b) => JSON.stringify({ k: b.k, work: b.workKey, title: b.title, author: b.author || undefined, language: b.language || undefined, year: b.year || undefined }));
  const fixed = Object.entries(anchors).filter(([w]) => items.some((b) => b.workKey === w));
  const anchorText = fixed.length
    ? `\n\nThese works already have their English base title; use it exactly:\n${fixed.map(([w, t]) => `${w}: ${t}`).join('\n')}`
    : '';
  return `${PROMPT_RULES}${anchorText}\n\nBooks (one JSON object per line):\n${lines.join('\n')}\n\n${ANSWER_SHAPE}\n\nDo not open, read or write any file and do not use any tool: everything you need is above.`;
}

/** Why an answer may not be written, or null when it passes. */
export function rejectReason(t, book) {
  if (typeof t !== 'string' || !t.trim()) return 'empty';
  const s = t.trim();
  if (s.length < 3 || s.length > 220) return 'length';
  if (NON_LATIN_LETTER.test(s)) return 'non_latin_script';
  if (COLLECTION_ONLY.test(s)) return 'collection_name_only';
  if (SHELFMARK.test(s)) return 'shelfmark';
  if (book.author && s.toLowerCase() === String(book.author).trim().toLowerCase()) return 'is_author';
  // A non-English book whose "English" title is its original title, letter for letter, was not translated.
  // (A title already in English also comes back unchanged; the reader already sees it, so a skip costs nothing.)
  if (s.toLowerCase() === String(book.title || '').trim().toLowerCase()) return 'unchanged_original';
  return null;
}

const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

// "Fayuan Zhulin, juan 19–21 (vol 7)" → "Fayuan Zhulin"; "Mathematical Collection, Vol. 1" → "Mathematical Collection".
// null when the title carries no volume part, so a one-volume work is never cut.
const VOLUME_PART = /^(.+?)(?:,\s*(?:(?:first|middle|last|introductory|supplementary)\s+)?(?:juan|part|vol\.?|volume|book)\b.*|\s+\(vol\.?\s*[\d–-]+\))$/i;
export function baseOf(t) {
  const m = String(t || '').match(VOLUME_PART);
  return m ? m[1].trim() : null;
}
/** The base title most volumes of a work already carry, or null when there is no majority to follow. */
export function majorityBase(titles) {
  const n = new Map();
  for (const t of titles) { const b = baseOf(t); if (b) n.set(b, (n.get(b) || 0) + 1); }
  const [best] = [...n.entries()].sort((a, b) => b[1] - a[1]);
  return best ? best[0] : null;
}

function chunkByWork(books) {
  const byWork = new Map();
  for (const b of books) {
    if (!byWork.has(b.workKey)) byWork.set(b.workKey, []);
    byWork.get(b.workKey).push(b);
  }
  // Large works first in their own chunks (in title order, so volume 1 settles the base title); small works packed.
  const chunks = [];
  let pack = [];
  for (const group of [...byWork.values()].sort((a, b) => b.length - a.length)) {
    group.sort((a, b) => String(a.title).localeCompare(String(b.title), undefined, { numeric: true }));
    if (group.length > PER_CALL / 2) {
      for (let i = 0; i < group.length; i += PER_CALL) chunks.push(group.slice(i, i + PER_CALL));
      continue;
    }
    if (pack.length + group.length > PER_CALL) { chunks.push(pack); pack = []; }
    pack.push(...group);
  }
  if (pack.length) chunks.push(pack);
  return chunks;
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  const filter = {
    visible: true,
    pages_count: { $gt: 0 },
    $or: [{ display_title: null }, { display_title: '' }],
    language: LANGUAGE ? LANGUAGE : { $nin: [null, ''], $not: /^english$/i },
  };
  if (RECENT_DAYS) filter.last_translation_at = { $gte: new Date(Date.now() - RECENT_DAYS * 864e5) };
  let rows = await books.find(filter, { projection: { _id: 1, id: 1, title: 1, author: 1, language: 1, year: 1, published: 1, work_id: 1, last_translation_at: 1 } })
    .sort({ last_translation_at: -1 }).toArray();
  rows = rows.filter((b) => b.title && String(b.title).trim());
  if (LIMIT) rows = rows.slice(0, LIMIT);
  console.log(`${rows.length} live non-English books without display_title${LANGUAGE ? ` (${LANGUAGE})` : ''}${RECENT_DAYS ? `, translated in the last ${RECENT_DAYS} days` : ''}`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const keep = (rec) => fs.appendFileSync(OUT, JSON.stringify(rec) + '\n');
  const tally = { written: 0, skipped: {}, raced: 0, calls: 0, failed_calls: 0, sweep_rows: 0 };
  const sweepRows = [];

  async function write(book, value, stamp) {
    if (!APPLY) return;
    const prov = provenanceUpdate('display_title', { ...stamp, previous_value: null });
    const res = await books.updateOne(
      { _id: book._id, $or: [{ display_title: null }, { display_title: '' }, { display_title: { $exists: false } }] },
      { $set: { display_title: value, ...prov.$set }, $push: prov.$push },
    );
    if (res.modifiedCount === 1) sweepRows.push({ sweep: SWEEP, book_id: book.id, action: 'display-title-filled', detail: { value, method: stamp.method, run: RUN } });
    else tally.raced++;
    return res.modifiedCount === 1;
  }
  // Flushed after every call, not once at the end: a run stopped midway (2026-10-28) had written 6,274 titles and
  // recorded none of their sweep rows.
  async function flushSweepRows() {
    if (!sweepRows.length) return;
    const rowsNow = sweepRows.splice(0);
    await recordSweepActions(db, rowsNow);
    tally.sweep_rows += rowsNow.length;
  }
  const skip = (reason) => { tally.skipped[reason] = (tally.skipped[reason] || 0) + 1; };

  const toModel = (NORMALIZE || BACKFILL_SWEEP_LOG) ? [] : rows;

  // --normalize: every volume of a work this sweep titled gets the base title most of its volumes carry; only the
  // base is replaced, each volume keeps its own juan/vol part. The replaced value is the stamp's previous_value.
  if (NORMALIZE) {
    const mine = await books.find({ 'field_provenance.display_title.sweep': SWEEP, work_id: { $nin: [null, ''] } }, { projection: { _id: 1, id: 1, work_id: 1, display_title: 1 } }).toArray();
    const byWork = new Map();
    for (const d of mine) { const w = String(d.work_id); if (!byWork.has(w)) byWork.set(w, []); byWork.get(w).push(d); }
    for (const [w, vols] of byWork) {
      if (vols.length < 2) continue;
      const base = majorityBase(vols.map((d) => d.display_title));
      if (!base) continue;
      for (const d of vols) {
        const own = baseOf(d.display_title);
        if (!own || own === base) continue;
        const value = base + d.display_title.slice(own.length);
        keep({ run: RUN, book_id: d.id, work: w, method: 'work_base_normalized', previous: d.display_title, answer: value, written: APPLY });
        tally.normalized = (tally.normalized || 0) + 1;
        if (!APPLY) continue;
        const prov = provenanceUpdate('display_title', { source: 'ai_generated', method: 'work_base_normalized', script: SCRIPT, run: RUN, sweep: SWEEP, previous_value: d.display_title, note: `base title taken from the majority of ${vols.length} volumes of work ${w}`, review: 'unreviewed', issue: 4390 });
        const res = await books.updateOne({ _id: d._id, display_title: d.display_title }, { $set: { display_title: value, ...prov.$set }, $push: prov.$push });
        if (res.modifiedCount === 1) sweepRows.push({ sweep: SWEEP, book_id: d.id, action: 'display-title-normalized', detail: { value, previous: d.display_title, run: RUN } });
        else tally.raced++;
      }
      if (sweepRows.length >= 500) await flushSweepRows();
    }
  }

  // --backfill-sweep-log: sweep rows for titles written by a run that stopped before recording them.
  if (BACKFILL_SWEEP_LOG && APPLY) {
    const logged = new Set((await db.collection('sweep_log').find({ sweep: SWEEP, action: 'display-title-filled' }, { projection: { book_id: 1 } }).toArray()).map((r) => r.book_id));
    for (const d of await books.find({ 'field_provenance.display_title.sweep': SWEEP, 'field_provenance.display_title.method': 'agy_title_translation' }, { projection: { id: 1, display_title: 1, 'field_provenance.display_title.run': 1 } }).toArray()) {
      if (!logged.has(d.id)) sweepRows.push({ sweep: SWEEP, book_id: d.id, action: 'display-title-filled', detail: { value: d.display_title, method: 'agy_title_translation', run: d.field_provenance.display_title.run, backfilled: true } });
    }
  }

  // The model, or answers already kept.
  let answers = new Map();
  if (FROM_JSONL) {
    for (const line of fs.readFileSync(FROM_JSONL, 'utf8').split('\n').filter(Boolean)) {
      const r = JSON.parse(line);
      if (r.method === 'agy_title_translation' && r.answer && !r.reject) answers.set(r.book_id, r);
    }
    for (const b of toModel) {
      const r = answers.get(b.id);
      if (!r) { skip('not_in_jsonl'); continue; }
      if (await write(b, r.answer, r.stamp)) tally.written++;
    }
  } else if (!NORMALIZE && !BACKFILL_SWEEP_LOG) {
    toModel.forEach((b, i) => { b.k = i + 1; b.workKey = b.work_id ? String(b.work_id) : `book:${b.id}`; b.year = b.year || b.published || undefined; });
    const chunks = chunkByWork(toModel);
    // Anchors from volumes this sweep already titled, so a resumed run continues the same base title.
    const anchors = {};
    const workIds = [...new Set(toModel.filter((b) => b.work_id).map((b) => b.work_id))];
    for (const d of await books.find({ work_id: { $in: workIds }, 'field_provenance.display_title.sweep': SWEEP }, { projection: { work_id: 1, display_title: 1 } }).toArray()) {
      (anchors[String(d.work_id)] ||= []).push(d.display_title);
    }
    for (const w of Object.keys(anchors)) { const b = majorityBase(anchors[w]); if (b) anchors[w] = b; else delete anchors[w]; }
    // A later chunk of a work waits for that work's first chunk, which settles its base title. Without this the
    // parallel workers each invented one: 白孔六帖 came back as "Six Topic-Books" and "Six Documents" (2026-10-28).
    const firstChunk = new Map(), settled = new Map();
    chunks.forEach((chunk, i) => {
      for (const w of new Set(chunk.map((b) => b.workKey))) {
        if (!firstChunk.has(w)) { firstChunk.set(w, i); let done; settled.set(w, Object.assign(new Promise((r) => { done = r; }), { done })); }
      }
    });
    const waitsOn = (chunk, i) => [...new Set(chunk.map((b) => b.workKey))].filter((w) => firstChunk.get(w) !== i && !anchors[w]).map((w) => settled.get(w));
    const release = (chunk, i) => { for (const w of new Set(chunk.map((b) => b.workKey))) if (firstChunk.get(w) === i) settled.get(w).done(); };
    console.log(`${toModel.length} to translate in ${chunks.length} calls (${MODEL}, ${CONCURRENCY} at a time); ${Object.keys(anchors).length} works anchored from earlier runs`);
    let next = 0, quota = false;
    async function worker() {
      while (!quota && next < chunks.length) {
        const i = next++;
        const chunk = chunks[i];
        await Promise.all(waitsOn(chunk, i));
        try { await translateChunk(chunk); } finally { release(chunk, i); }
      }
    }
    async function translateChunk(chunk) {
      {
        const sent = buildPrompt(chunk, anchors);
        const r = await gatedTextCall(sent, { model: MODEL, task: 'translate', attempts: 2 });
        tally.calls += r.calls;
        if (r.cls === 'quota') { quota = true; console.log(`quota: ${r.err}`); chunk.forEach(() => skip('quota_stop')); return; }
        let parsed = null;
        try { parsed = JSON.parse(String(r.answer || '').replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { /* below */ }
        if (!parsed || !Array.isArray(parsed.titles)) {
          tally.failed_calls++;
          for (const b of chunk) { skip('unparsed_reply'); keep({ run: RUN, book_id: b.id, title: b.title, method: 'agy_title_translation', answer: null, reject: 'unparsed_reply', problem: r.problem || r.cls }); }
          return;
        }
        for (const [w, t] of Object.entries(parsed.works || {})) if (!anchors[w] && typeof t === 'string' && !NON_LATIN_LETTER.test(t)) anchors[w] = t.trim();
        const byK = new Map(parsed.titles.map((x) => [Number(x.k), x.t]));
        for (const b of chunk) {
          const t = typeof byK.get(b.k) === 'string' ? byK.get(b.k).trim() : byK.get(b.k);
          const reject = rejectReason(t, b);
          const stamp = {
            source: 'ai_generated', method: 'agy_title_translation', script: SCRIPT, run: RUN, sweep: SWEEP,
            engine: { cli: 'agy', model: MODEL, prompt_hash: hash(PROMPT_RULES + ANSWER_SHAPE), call_prompt_hash: hash(sent) },
            input: { title: b.title, author: b.author || null, language: b.language || null, work_id: b.work_id || null },
            review: 'unreviewed', issue: 4390,
          };
          keep({ run: RUN, book_id: b.id, title: b.title, language: b.language, work: b.workKey, method: 'agy_title_translation', answer: t ?? null, reject, stamp, written: APPLY && !reject });
          if (reject) { skip(reject); continue; }
          if (await write(b, t, stamp)) tally.written++;
        }
        await flushSweepRows();
        process.stdout.write(`\r${next}/${chunks.length} calls · ${tally.written} written · ${Object.values(tally.skipped).reduce((a, b) => a + b, 0)} skipped   `);
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    console.log('');
  }

  await flushSweepRows();
  console.log(JSON.stringify({ apply: APPLY, run: RUN, kept: OUT, ...tally }, null, 1));
  await client.close();
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
