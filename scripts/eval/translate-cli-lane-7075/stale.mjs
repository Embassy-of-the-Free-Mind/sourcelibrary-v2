#!/usr/bin/env node
// PRIOR ART: scripts/batch/greek-reocr-5813/compare.mjs (the agreement this frame is cut on, reused unchanged) and its
// minor-stale.json (the 57,575-page list, which lives only on the job box that ran #5813, so the frame is rebuilt here
// from page_revisions); sample.mjs beside this file (the blind X/Y fidelity judge, which asks "which is better", not
// "did the meaning move"). None asks whether re-translating a page whose OCR barely changed changes its English.
/**
 * Are the Greek pages whose OCR changed only slightly (agreement ≥ 0.95) worth re-translating? (#7075, #5813)
 *
 *   node --env-file=.env.production.local scripts/eval/translate-cli-lane-7075/stale.mjs draw --out=DIR [--n=20]
 *   node --env-file=.env.production.local scripts/batch/cli-translate.mjs read --page-ids-file=DIR/stale-page-ids.json --out=DIR/stale-new --ocr-checked="..."
 *   node --env-file=.env.production.local scripts/eval/translate-cli-lane-7075/stale.mjs judge --out=DIR --judge=gemini|opus
 *   node scripts/eval/translate-cli-lane-7075/stale.mjs score --out=DIR
 *
 * DRAW. Visible Greek books (the router's label rule). Pages with a real translation older than their OCR
 * (translationStaleness: OCR_NEWER), OCR of at least 300 characters, a translatable page type. In a seeded order, one
 * page per book: the OCR it replaced is the latest `page_revisions` OCR row, and the page is kept only when
 * compare.mjs's agreement between that row and the current OCR is ≥ 0.95, the #5813 "minor change" class. The stale
 * frame is counted, and the agreement is reported per page; the 57,575 are not re-derived.
 *
 * JUDGE. Per page the CURRENT OCR, the stored English (made from the old OCR) and the new read of the current OCR, as
 * A and B on a seeded side. The judge says: "same" (the same statements), "wording" (different words, same meaning) or
 * "meaning" (a statement, name, number or negation differs, or text is added or missing), and which is more faithful
 * to the current OCR. Nothing is written to the database.
 *
 * BASELINE (`--baseline`, on judge and score): the same judge over sample.mjs's pages, whose OCR did NOT change since
 * their English was made (sample.json, new-gemini/). The stale rate means something only beside this one: how often
 * a re-read changes the meaning when the source is the same, i.e. how much of the change is the reader, not the OCR.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const STAGE = process.argv[2];
const OUT = arg('out') && path.resolve(arg('out'));
const h = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const W = (f, x) => fs.writeFileSync(path.join(OUT, f), JSON.stringify(x, null, 1));
const MINOR = 0.95;
const BASE = process.argv.includes('--baseline');
const SAMPLE = BASE ? 'sample.json' : 'stale-sample.json', READS = BASE ? 'new-gemini' : 'stale-new', TAG = BASE ? 'baseline' : 'stale';

async function draw() {
  const { MongoClient } = await import('mongodb');
  const { prefixRegex } = await import('../../lib/translation-routing.mjs');
  const { SKIP_TRANSLATION_PAGE_TYPES } = await import('../../lib/translate-core.mjs');
  const { translationStaleness, STALE_REASONS } = await import('../../lib/stale-translation.mjs');
  const { agreement } = await import('../../batch/greek-reocr-5813/compare.mjs');
  const n = Number(arg('n') || 20);
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  const re = prefixRegex(['greek'], ['ancient']);
  const books = (await db.collection('books').find({ visible: true, pages_count: { $gt: 0 }, language: { $regex: 'greek', $options: 'i' } }, { projection: { id: 1, title: 1, language: 1 } }).toArray()).filter((b) => re.test(b.language));
  const toDate = (f) => ({ $convert: { input: f, to: 'date', onError: null, onNull: null } });
  const cand = await db.collection('pages').aggregate([
    { $match: { book_id: { $in: books.map((b) => b.id) }, page_number: { $gt: 0 }, page_type: { $nin: SKIP_TRANSLATION_PAGE_TYPES }, 'ocr.data': { $type: 'string' }, 'translation.data': { $type: 'string' } } },
    { $match: { $expr: { $and: [
      { $gte: [{ $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, { $strLenCP: '$ocr.data' }, 0] }, 300] },
      { $lt: [toDate('$translation.updated_at'), toDate('$ocr.updated_at')] }] } } },
    { $project: { _id: 0, id: 1, book_id: 1, page_number: 1, 'ocr.updated_at': 1, 'ocr.model': 1, 'translation.updated_at': 1, 'translation.model': 1, 'translation.source': 1, 'translation.data': { $substrCP: [{ $ifNull: ['$translation.data', ''] }, 0, 400] } } },
  ], { allowDiskUse: true }).toArray();
  // The aggregation's date test is a prefilter; translate-core's own rule (margin, placeholders) decides.
  const stale = cand.filter((p) => translationStaleness(p).reason === STALE_REASONS.OCR_NEWER).sort((a, b) => h(a.id).localeCompare(h(b.id)));
  const byBook = new Map();
  for (const p of stale) byBook.set(p.book_id, [...(byBook.get(p.book_id) ?? []), p]);
  const order = [...byBook].sort((a, b) => h(a[0]).localeCompare(h(b[0])));
  const picked = [], looked = [];
  const P = db.collection('pages'), R = db.collection('page_revisions');
  for (let round = 0; picked.length < n && round < 3; round++) {
    for (const [, list] of order) {
      if (picked.length >= n) break;
      const p = list[round]; if (!p) continue;
      const prev = await R.find({ page_id: p.id, field: 'ocr', data: { $type: 'string' } }).sort({ created_at: -1 }).limit(1).project({ data: 1, created_at: 1, model: 1, source: 1 }).next();
      const cur = await P.findOne({ id: p.id }, { projection: { 'ocr.data': 1 } });
      if (!prev) { looked.push({ page_id: p.id, skip: 'no OCR revision' }); continue; }
      const a = agreement(cur.ocr.data, prev.data);
      looked.push({ page_id: p.id, agreement: +a.agreement.toFixed(4) });
      if (a.agreement >= MINOR && a.agreement < 1) picked.push({ page_id: p.id, book_id: p.book_id, page_number: p.page_number, agreement: +a.agreement.toFixed(4), ocr_model: p.ocr?.model ?? null, old_model: p.translation?.model ?? null, old_updated_at: p.translation?.updated_at ?? null, prev_ocr_model: prev.model ?? null, prev_ocr_superseded: prev.created_at });
    }
  }
  await c.close();
  const title = new Map(books.map((b) => [b.id, b.title]));
  for (const p of picked) p.title = title.get(p.book_id);
  picked.sort((a, b) => a.book_id.localeCompare(b.book_id) || a.page_number - b.page_number);
  fs.mkdirSync(OUT, { recursive: true });
  const ag = looked.filter((l) => l.agreement != null);
  W('stale-sample.json', { n, drawn_at: new Date().toISOString(), frame: { greek_books: books.length, stale_pages: stale.length, stale_books: byBook.size,
    looked: looked.length, no_revision: looked.length - ag.length, minor: ag.filter((l) => l.agreement >= MINOR && l.agreement < 1).length, identical: ag.filter((l) => l.agreement === 1).length, below: ag.filter((l) => l.agreement < MINOR).length },
    looked, pages: picked });
  W('stale-page-ids.json', picked.map((p) => p.page_id));
  console.log(`stale frame: ${stale.length} pages in ${byBook.size} Greek books; looked at ${looked.length}, kept ${picked.length} with ${MINOR} ≤ agreement < 1`);
}

const judgePrompt = (it) => `A library publishes English translations beside historical Greek pages. This page's OCR transcription was corrected slightly; translation A was made from the OLD transcription and translation B from the CURRENT one shown below (or the other way round — do not assume which is which).

CURRENT SOURCE (Greek OCR):
"""
${it.source}
"""

TRANSLATION A:
"""
${it.A}
"""

TRANSLATION B:
"""
${it.B}
"""

Compare A and B with each other. Ignore formatting, markup tags, notes and summaries outside the page text. Answer:
- "same": they make the same statements, sentence for sentence;
- "wording": the words differ but every statement, name, number and negation means the same;
- "meaning": at least one statement, name, number or negation differs, or text is added or missing in one of them.
Also say which is more faithful to the CURRENT SOURCE, or "tie".

Answer with one JSON object only: {"change": "same" | "wording" | "meaning", "more_faithful": "A" | "B" | "tie", "reason": "one sentence naming the most important difference, or none"}`;

async function judge() {
  const who = arg('judge');
  if (!['opus', 'gemini'].includes(who)) { console.error('--judge=opus|gemini'); process.exit(2); }
  const { MongoClient } = await import('mongodb');
  const s = J(SAMPLE);
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const pages = new Map((await c.db('bookstore').collection('pages').find({ id: { $in: s.pages.map((p) => p.page_id) } }, { projection: { id: 1, 'ocr.data': 1, 'translation.data': 1, 'translation.updated_at': 1 } }).toArray()).map((p) => [p.id, p]));
  await c.close();
  const file = path.join(OUT, `${TAG}-verdicts-${who}.jsonl`);
  const done = new Set(fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).page_id) : []);
  const agy = who === 'gemini' ? await import('../../lib/agy-cli.mjs') : null;
  const { claudeCall, parseJson } = await import('./sample.mjs');
  for (const sp of s.pages) {
    if (done.has(sp.page_id)) continue;
    const p = pages.get(sp.page_id);
    let fresh = null;
    try { const m = JSON.parse(fs.readFileSync(path.join(OUT, READS, `${sp.page_id}.meta.json`), 'utf8')); if (m.exit === 0) fresh = fs.readFileSync(path.join(OUT, READS, `${sp.page_id}.txt`), 'utf8').trim(); } catch { /* no read */ }
    if (!p || !fresh || +new Date(p.translation?.updated_at) !== +new Date(sp.old_updated_at)) { console.log(`  skip ${sp.page_id}: ${!fresh ? 'no new read' : 'stored English changed'}`); continue; }
    const newIsA = parseInt(h(`stale-side:${sp.page_id}`).slice(0, 8), 16) % 2 === 0;
    const prompt = judgePrompt({ source: p.ocr.data, A: newIsA ? fresh : p.translation.data, B: newIsA ? p.translation.data : fresh });
    let text;
    if (agy) {
      const r = await agy.gatedTextCall(prompt + agy.TRANSLATE_SUFFIX.replace(/translation/gi, 'answer'), { model: 'gemini-3.8-flash-high', task: 'translate' });
      if (r.cls === 'quota') { console.log('agy quota: stopping'); break; }
      text = r.answer || r.text;
    } else {
      const r = await claudeCall(prompt);
      if (r.limit) { console.log('usage limit: stopping'); break; }
      text = r.text;
    }
    const v = parseJson(text, (x) => ['same', 'wording', 'meaning'].includes(x.change));
    fs.appendFileSync(file, JSON.stringify({ page_id: sp.page_id, judge: who, new_is: newIsA ? 'A' : 'B', verdict: v, raw: v ? undefined : String(text).slice(0, 500) }) + '\n');
    console.log(`  ${sp.page_number} ${sp.page_id}: ${v ? `${v.change}, more faithful ${v.more_faithful === 'tie' ? 'tie' : (v.more_faithful === (newIsA ? 'A' : 'B') ? 'new' : 'old')}` : 'unparsed'}`);
  }
}

function score() {
  const s = J(SAMPLE);
  const report = { frame: s.frame, judges: {} };
  for (const who of ['gemini', 'opus']) {
    const f = path.join(OUT, `${TAG}-verdicts-${who}.jsonl`);
    if (!fs.existsSync(f)) continue;
    const rows = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.verdict);
    const change = { same: 0, wording: 0, meaning: 0 }, faithful = { new: 0, old: 0, tie: 0 }, pages = {};
    for (const r of rows) {
      const v = r.verdict, better = v.more_faithful === 'tie' ? 'tie' : v.more_faithful === r.new_is ? 'new' : 'old';
      change[v.change]++; faithful[better]++;
      pages[r.page_id] = { change: v.change, more_faithful: better, reason: v.reason };
    }
    report.judges[who] = { n: rows.length, change, more_faithful: faithful, pages };
  }
  W(`${TAG}-score.json`, report);
  for (const [who, j] of Object.entries(report.judges)) console.log(`${who}: n=${j.n} ${JSON.stringify(j.change)} more faithful ${JSON.stringify(j.more_faithful)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (!OUT) { console.error('--out=DIR required'); process.exit(2); }
  await ({ draw, judge, score }[STAGE] ?? (() => { console.error('stages: draw | judge | score'); process.exit(2); }))();
}
