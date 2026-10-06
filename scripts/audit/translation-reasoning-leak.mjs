#!/usr/bin/env node
// PRIOR ART: scripts/lib/page-integrity.mjs `ocrReasoningLeak()` (taxonomy O15) reads the head of the OCR
// for the model's reasoning; scripts/audit/page-integrity.mjs runs it over the local mirror, which this box
// does not hold. Nothing looked for the same leak in the TRANSLATION, where a reader meets it as plain
// English (#6056: Tsangpa Gyare p.20, "Wait, the prompt says: Style: warm museum label"). The rule lives
// beside its OCR sibling as `translationReasoningLeak()`; this file is only the walk and the report.
// scripts/audit/quality-sprint-classes.mjs samples per BOOK and never reads page text, so a class that
// sits on one page in a thousand cannot go through it.
/**
 * translation-reasoning-leak — pages whose stored English is the model's own reasoning (#6056, #5918).
 * Model-free. READ-ONLY on Mongo (secondary preferred); writes files only.
 *
 *   node --env-file=.env.production.local scripts/audit/translation-reasoning-leak.mjs walk [--out DIR] [--batch 20000] [--conc 4]
 *   node --env-file=.env.production.local scripts/audit/translation-reasoning-leak.mjs report [--out DIR] [--to DIR]
 *
 * walk    Every `pages` record, in `_id` order, ONE `_id` TYPE AT A TIME (`pages._id` is ObjectId on some
 *         rows and a string on others; a range query never crosses the two). Each step bounds a range of
 *         --batch ids on the `_id` index and asks the server for the pages in it whose `translation.data`
 *         matches PREFILTER — a deliberately wide net, so page text leaves Atlas only for candidates.
 *         The ranges are planned once and run --conc at a time; candidates are appended to
 *         <out>/candidates.jsonl and each finished range is marked in <out>/checkpoint.json: kill it and run
 *         it again with the same arguments. About 16 s a range from the job box (29M pages ≈ 1.6 h at 4).
 * report  Applies translationReasoningLeak() to the candidates, joins each book's visibility, and writes
 *         summary.json and pages.jsonl (ids, page numbers, the matched phrase: no page text) to --to.
 *
 * The count is a FLOOR: the rule is a list of phrases read off real hits, and a leak worded another way is
 * not in the net. PREFILTER must stay a superset of the rule (tests/unit/page-integrity.test.ts pins it).
 */
import { MongoClient } from 'mongodb';
import { mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { translationReasoningLeak, translationPipelineTalk, TRANSLATION_LEAK_PREFILTER } from '../lib/page-integrity.mjs';

const [mode, ...args] = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('out', 'scripts/output/translation-reasoning-leak');
if (!['walk', 'report'].includes(mode)) { console.error('usage: translation-reasoning-leak.mjs walk|report [--out DIR]'); process.exit(1); }
if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set.'); process.exit(1); }
mkdirSync(OUT, { recursive: true });
const CAND = join(OUT, 'candidates.jsonl'), CKPT = join(OUT, 'checkpoint.json');
const TEXT_CAP = 60000; // a self-talk loop runs to 200K+ characters; the rule needs the phrases, not the loop

const client = await MongoClient.connect(process.env.MONGODB_URI, { readPreference: 'secondaryPreferred' });
const db = client.db('bookstore');

if (mode === 'walk') {
  const BATCH = Number(opt('batch', 20000)), CONC = Number(opt('conc', 4));
  const { ObjectId } = await import('mongodb');
  const pages = db.collection('pages');
  const ck = existsSync(CKPT) ? JSON.parse(readFileSync(CKPT, 'utf8')) : { batch: BATCH, planned: false, ranges: [] };
  const save = () => writeFileSync(CKPT, JSON.stringify(ck));
  const cast = (type, v) => (v == null ? null : type === 'objectId' ? new ObjectId(v) : v);
  if (!ck.planned) {
    // Plan first: range bounds read off the _id index alone, one type at a time.
    ck.ranges = [];
    for (const type of ['string', 'objectId']) {
      let last = null;
      for (;;) {
        const lower = last == null ? { $type: type } : { $gt: last, $type: type };
        const edge = await pages.find({ _id: lower }, { projection: { _id: 1 } }).sort({ _id: 1 }).hint({ _id: 1 }).skip(BATCH - 1).limit(1).toArray();
        ck.ranges.push({ type, gt: last == null ? null : String(last), lte: edge.length ? String(edge[0]._id) : null, done: false, candidates: 0 });
        if (!edge.length) break; // the last range of a type is open-ended: pages added during the walk fall in it
        last = edge[0]._id;
      }
      console.log(`planned ${type}: ${ck.ranges.filter((r) => r.type === type).length} ranges of ${BATCH}`);
    }
    ck.planned = true; save();
  }
  const todo = ck.ranges.filter((r) => !r.done);
  const t0 = Date.now(); let n = 0;
  const one = async (r) => {
    const range = { $type: r.type };
    if (r.gt != null) range.$gt = cast(r.type, r.gt);
    if (r.lte != null) range.$lte = cast(r.type, r.lte);
    const hits = await pages.find(
      { _id: range, 'translation.data': { $regex: TRANSLATION_LEAK_PREFILTER.source, $options: 'i' } },
      { projection: { book_id: 1, page_number: 1, 'translation.data': 1, 'translation.model': 1, 'translation.prompt_version': 1, 'translation.updated_at': 1, 'translation.source': 1 } },
    ).hint({ _id: 1 }).toArray();
    if (hits.length) {
      appendFileSync(CAND, hits.map((p) => JSON.stringify({
        _id: String(p._id), book_id: p.book_id, page_number: p.page_number, len: p.translation.data.length,
        model: p.translation.model ?? null, prompt_version: p.translation.prompt_version ?? null,
        source: p.translation.source ?? null, updated_at: p.translation.updated_at ?? null,
        text: p.translation.data.slice(0, TEXT_CAP),
      })).join('\n') + '\n');
    }
    // Candidates are appended BEFORE the range is marked done: a kill in between re-reads the range, and
    // `report` drops the repeats by _id.
    r.candidates = hits.length; r.done = true; save();
    if (++n % 20 === 0) console.log(`${n}/${todo.length} ranges, ${ck.ranges.reduce((s, x) => s + x.candidates, 0)} candidates, ${Math.round((Date.now() - t0) / 1000)}s`);
  };
  let next = 0;
  await Promise.all(Array.from({ length: CONC }, async () => { while (next < todo.length) await one(todo[next++]); }));
  ck.tail = {};
  for (const type of ['string', 'objectId']) {
    const lastRange = ck.ranges.filter((r) => r.type === type).at(-1);
    ck.tail[type] = await pages.countDocuments({ _id: lastRange.gt == null ? { $type: type } : { $gt: cast(type, lastRange.gt), $type: type } }, { hint: { _id: 1 } });
  }
  save();
  console.log('WALK COMPLETE');
}

if (mode === 'report') {
  const TO = opt('to', OUT);
  mkdirSync(TO, { recursive: true });
  const ck = JSON.parse(readFileSync(CKPT, 'utf8'));
  const seen = new Set(), rows = [], talk = [];
  for (const line of readFileSync(CAND, 'utf8').split('\n')) {
    if (!line) continue;
    const r = JSON.parse(line);
    if (seen.has(r._id)) continue; // a range re-read after a kill appends its candidates twice
    seen.add(r._id);
    const v = translationReasoningLeak(r.text);
    if (v) rows.push({ ...r, text: undefined, kind: v.kind, phrase: v.phrase, reader_visible: v.readerVisible });
    else if (translationPipelineTalk(r.text)) talk.push({ book_id: r.book_id, page_number: r.page_number });
  }
  const ids = [...new Set(rows.map((r) => r.book_id))];
  const books = new Map();
  for (let i = 0; i < ids.length; i += 500) {
    for (const b of await db.collection('books').find({ id: { $in: ids.slice(i, i + 500) } }, { projection: { id: 1, visible: 1, pages_count: 1, language: 1, title: 1, display_title: 1, hidden_reason: 1 } }).toArray()) books.set(b.id, b);
  }
  for (const r of rows) {
    const b = books.get(r.book_id);
    // A reader reaches a page of a live book at page_number > 0 (≤ 0 is the soft-hide convention).
    r.live = !!(b && b.visible === true && b.pages_count > 0 && r.page_number > 0);
    r.language = b?.language ?? null;
    r.title = (b?.display_title || b?.title || '').slice(0, 80);
    r.url = `https://sourcelibrary.org/book/${r.book_id}?page=${r.page_number}`;
  }
  const tally = (list, f) => list.reduce((m, r) => { const k = f(r) ?? 'none'; m[k] = (m[k] || 0) + 1; return m; }, {});
  const live = rows.filter((r) => r.live), shown = live.filter((r) => r.reader_visible);
  // The headline: what a reader of a public book meets as the page's English.
  const STRONG = new Set(['reasoning', 'assistant-reply']);
  const head = shown.filter((r) => STRONG.has(r.kind));
  const summary = {
    issue: 6056, measured_at: new Date().toISOString(),
    walk_complete: ck.ranges.every((r) => r.done),
    pages_scanned: Object.fromEntries(['string', 'objectId'].map((t) => [t, (ck.ranges.filter((r) => r.type === t && r.done).length - 1) * ck.batch + (ck.tail?.[t] ?? 0)])),
    prefilter_candidates: seen.size,
    leaked_pages: rows.length, leaked_books: new Set(rows.map((r) => r.book_id)).size,
    live_leaked_pages: live.length, live_leaked_books: new Set(live.map((r) => r.book_id)).size,
    live_reader_visible_pages: shown.length, live_reader_visible_books: new Set(shown.map((r) => r.book_id)).size,
    headline_pages: head.length, headline_books: new Set(head.map((r) => r.book_id)).size,
    headline_by_kind: tally(head, (r) => r.kind), headline_by_language: tally(head, (r) => r.language),
    headline_by_model: tally(head, (r) => r.model), headline_by_month: tally(head, (r) => (r.updated_at ? String(r.updated_at).slice(0, 7) : null)),
    live_reader_visible_by_kind: tally(shown, (r) => r.kind),
    by_kind: tally(rows, (r) => r.kind), live_by_kind: tally(live, (r) => r.kind),
    by_model: tally(rows, (r) => r.model), by_prompt_version: tally(rows, (r) => String(r.prompt_version)),
    by_month: tally(rows, (r) => (r.updated_at ? String(r.updated_at).slice(0, 7) : null)),
    // Not reasoning: a translator's note that cites "the OCR" or "the <gloss> tags" in the page body. Counted, never listed.
    side_pipeline_talk_in_body: { pages: talk.length, books: new Set(talk.map((r) => r.book_id)).size },
    note: 'A floor: phrase rules read off real hits. headline = reasoning or assistant-reply, in the page body, on a live book at page_number > 0. reader_visible = the phrase survives removal of the <meta>/<summary>/<keywords>/<vocab> blocks.',
  };
  rows.sort((a, b) => (b.live - a.live) || (b.reader_visible - a.reader_visible) || a.book_id.localeCompare(b.book_id) || a.page_number - b.page_number);
  writeFileSync(join(TO, 'summary.json'), JSON.stringify(summary, null, 1));
  writeFileSync(join(TO, 'pages.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(JSON.stringify(summary, null, 1));
}

await client.close();
