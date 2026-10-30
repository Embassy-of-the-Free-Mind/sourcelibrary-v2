#!/usr/bin/env node
// PRIOR ART: scripts/eval/lane-judge-sampler.mjs findWrites/drawPages — draws from the pages the lane WROTE (its
// stamps), so it never sees a page the corrector left (UNCHANGED, CONTAIN, refused): the conditioned frame #7818 is
// about. This draws from the lane's own ledger (every page it PROCESSED) instead; its revision-row and hash checks
// are the sampler's, re-done here per page.
/**
 * Arm P frame (#7818, PREREGISTRATION §P). The #7558 correction lane's ledger on gex45
 * (/root/jobs/cli-ocr-correct/correct-ledger.jsonl: one row per page it processed, outcome written / unchanged /
 * contain / other), cut at LEDGER_CUTOFF, German and French books only; one page per book, books in a seeded order.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/correction-pass-7818/frame.mjs draw [--out=DIR]
 *   ... frame.mjs reads    fetch the lane's own correction reads of the drawn pages + a replica sample (ssh gex45)
 *   ... frame.mjs replica  servedCorrection() on the lane's own reads against the ledger outcome (§W3 check)
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { OUT, J, W, sha, jsonl, SEED, makeRng, shuffle, servedCorrection, arg } from './lib.mjs';
import { scriptClass } from '../lane-judge-sampler.mjs';
import { bookHand } from '../../lib/ocr-trust-gate.mjs';
import { LITE_MODELS } from '../../batch/cli-ocr-lane.mjs';
import { textHash } from '../../lib/page-text-writer.mjs';

export const GEX45 = 'root@65.108.136.89';
export const LANE_DIR = '/root/jobs/cli-ocr-correct';
export const LEDGER_CUTOFF = '2026-10-30T12:00:00Z';
export const PER_LANGUAGE = 60;
export const LANGS = [['de', /^German/], ['fr', /^French/]];
const REASON = /^#7558 correction lane/;
const LEDGER = path.join(OUT, 'frame', 'correct-ledger.gex45.jsonl');

async function draw() {
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  if (!fs.existsSync(LEDGER)) { const r = spawnSync('scp', ['-q', `${GEX45}:${LANE_DIR}/correct-ledger.jsonl`, LEDGER]); if (r.status) throw new Error('scp ledger failed'); }
  const ledgerSha = sha(fs.readFileSync(LEDGER));
  const rows = jsonl(LEDGER).filter((r) => r.at < LEDGER_CUTOFF);
  const byPage = new Map(); for (const r of rows) byPage.set(r.page_id, r);   // the last row a page got (each is tried once)
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
  try {
    const bookIds = [...new Set([...byPage.values()].map((r) => r.book_id))];
    const books = new Map((await db.collection('books').find({ id: { $in: bookIds } }, { projection: { id: 1, title: 1, language: 1, year: 1, visible: 1, pages_count: 1, 'pipeline_auto.held': 1 } }).toArray()).map((b) => [b.id, b]));
    const judged = new Set((await db.collection('lane_judge_verdicts').find({ kind: { $in: ['item', 'draft'] } }, { projection: { page_id: 1 } }).toArray()).map((r) => r.page_id));
    const frame = {}, drawn = [], log = {};
    for (const [lc, re] of LANGS) {
      const mine = [...byPage.values()].filter((r) => re.test(books.get(r.book_id)?.language || ''));
      const n = (o) => mine.filter((r) => r.outcome === o).length;
      const byBook = new Map(); for (const r of mine) { if (!byBook.has(r.book_id)) byBook.set(r.book_id, []); byBook.get(r.book_id).push(r); }
      frame[lc] = { pages: mine.length, books: byBook.size, written: n('written'), unchanged: n('unchanged'), contain: n('contain'), other: n('other'),
        changed_share_pages: +(n('written') / mine.length).toFixed(4),
        changed_share_books_mean: +([...byBook.values()].reduce((a, ps) => a + ps.filter((r) => r.outcome === 'written').length / ps.length, 0) / byBook.size).toFixed(4) };
      const L = log[lc] = { books_tried: 0, books_taken: 0, book_hidden_or_held: 0, pages_tried: 0, page_missing: 0, rewritten_since: 0, no_revision: 0, draft_not_lite: 0, not_print: 0, sampler_judged: 0 };
      const rnd = makeRng(SEED.frame + (lc === 'de' ? 1 : 2));
      const order = shuffle([...byBook.keys()].sort(), rnd);
      for (const b of order) {
        if (L.books_taken >= PER_LANGUAGE) break;
        L.books_tried++;
        const bk = books.get(b);
        const pages = shuffle(byBook.get(b).slice().sort((x, y) => (x.page_id < y.page_id ? -1 : 1)), rnd);
        if (!bk?.visible || !(bk.pages_count > 0) || bk.pipeline_auto?.held) { L.book_hidden_or_held++; continue; }
        const prof = { printed: 0, handwritten: 0, mixed: 0 };
        for (const r of await db.collection('pages').aggregate([{ $match: { book_id: b, script_type: { $in: ['printed', 'handwritten', 'mixed'] } } }, { $group: { _id: '$script_type', n: { $sum: 1 } } }]).toArray()) prof[r._id] = r.n;
        for (const r of pages) {
          L.pages_tried++;
          if (judged.has(r.page_id)) { L.sampler_judged++; continue; }
          const p = await db.collection('pages').findOne({ id: r.page_id }, { projection: { id: 1, book_id: 1, page_number: 1, script_type: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1, crop: 1, ocr: 1 } });
          if (!p || typeof p.ocr?.data !== 'string') { L.page_missing++; continue; }
          let draft, rev = null;
          if (r.outcome === 'written') {
            rev = await db.collection('page_revisions').find({ page_id: p.id, field: 'ocr', reason: REASON, aborted: { $ne: true } }, { projection: { id: 1, run_id: 1, created_at: 1, next_hash: 1, data: 1, model: 1 } }).sort({ created_at: -1 }).limit(1).next();
            if (!rev) { L.no_revision++; continue; }
            if (rev.next_hash !== textHash(p.ocr)) { L.rewritten_since++; continue; }
            if (!LITE_MODELS.includes(rev.model) || typeof rev.data !== 'string') { L.draft_not_lite++; continue; }
            draft = rev.data;
          } else {
            if (!LITE_MODELS.includes(p.ocr.model)) { L.draft_not_lite++; continue; }
            if (p.ocr.updated_at && new Date(p.ocr.updated_at) > new Date(r.at)) { L.rewritten_since++; continue; }
            draft = p.ocr.data;
          }
          const sc = scriptClass(p.ocr.data, p.script_type, bookHand(prof));
          if (!['print', 'mixed'].includes(sc.script_type)) { L.not_print++; continue; }
          const served = p.ocr.data;
          fs.mkdirSync(path.join(OUT, 'texts'), { recursive: true });
          fs.writeFileSync(path.join(OUT, 'texts', `P-${p.id}.draft.txt`), draft);
          fs.writeFileSync(path.join(OUT, 'texts', `P-${p.id}.served.txt`), served);
          drawn.push({ arm: 'P', lang: lc, language: bk.language, page_id: p.id, book_id: b, page_number: p.page_number, title: String(bk.title || '').slice(0, 80), year: bk.year ?? null,
            outcome: r.outcome, why: r.why, ledger_at: r.at, ...sc, image: (await import('../../lib/page-image-url.mjs')).getPageSource(p),
            draft_sha: sha(draft).slice(0, 16), served_sha: sha(served).slice(0, 16), same: draft.trim() === served.trim(),
            revision: rev && { id: rev.id, run_id: rev.run_id ?? null, created_at: rev.created_at, draft_model: rev.model }, served_model: p.ocr.model, served_pipeline: p.ocr.pipeline ?? null });
          L.books_taken++;
          break;
        }
      }
      const got = drawn.filter((d) => d.lang === lc);
      L.sample = { pages: got.length, written: got.filter((d) => d.outcome === 'written').length, unchanged: got.filter((d) => d.outcome === 'unchanged').length, contain: got.filter((d) => d.outcome === 'contain').length, other: got.filter((d) => d.outcome === 'other').length, same_text: got.filter((d) => d.same).length };
    }
    const out = { at: new Date().toISOString(), ledger: { host: GEX45, path: `${LANE_DIR}/correct-ledger.jsonl`, sha256: ledgerSha, rows: rows.length, cutoff: LEDGER_CUTOFF }, seed: SEED.frame, per_language: PER_LANGUAGE, frame, log, drawn };
    W('frame/frame.json', out);
    console.log(JSON.stringify({ frame, log }, null, 1));
  } finally { await c.close(); }
}

/** The lane's own read files (meta, txt, prompt) of the drawn pages and of a seeded replica sample, by ssh. */
async function reads() {
  const F = J('frame/frame.json');
  const rows = jsonl(LEDGER).filter((r) => r.at < LEDGER_CUTOFF);
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const langOf = new Map((await c.db('bookstore').collection('books').find({ id: { $in: [...new Set(rows.map((r) => r.book_id))] } }, { projection: { id: 1, language: 1 } }).toArray()).map((b) => [b.id, b.language]));
  await c.close();
  const eligible = rows.filter((r) => /^(German|French)/.test(langOf.get(r.book_id) || ''));
  const replica = shuffle(eligible.sort((a, b) => (a.page_id < b.page_id ? -1 : 1)), makeRng(SEED.frame + 9)).slice(0, Number(arg('replica-n') || 400));
  const want = [...new Set([...F.drawn.map((d) => `${d.book_id}/${d.page_id}`), ...replica.map((r) => `${r.book_id}/${r.page_id}`)])];
  const dir = path.join(OUT, 'lane-reads'); fs.mkdirSync(dir, { recursive: true });
  const list = want.map((k) => `${k}.meta.json\n${k}.txt\n${k}.prompt.txt`).join('\n');
  // The day folders hold one dir per book; find each wanted file under any day folder (2026-10-30-opus is Latin only).
  const script = `cd ${LANE_DIR} && while read f; do for d in 2026-10-2*/; do [ -f "$d$f" ] && echo "$d$f" && break; done; done | tar -cz -T -`;
  const r = spawnSync('ssh', [GEX45, script], { input: list, maxBuffer: 1 << 30 });
  if (r.status) throw new Error(`ssh tar: ${r.stderr}`);
  spawnSync('tar', ['-xz', '-C', dir], { input: r.stdout });
  W('frame/replica-sample.json', replica);
  console.log(`reads: ${want.length} pages wanted; files under ${dir}`);
}

/** §W3: the restated served-text rules on the lane's own reads must reproduce the lane's ledger outcome. */
async function replica() {
  const sample = J('frame/replica-sample.json'), dir = path.join(OUT, 'lane-reads');
  const find = (b, p, ext) => { for (const d of fs.readdirSync(dir)) { const f = path.join(dir, d, b, `${p}.${ext}`); if (fs.existsSync(f)) return f; } return null; };
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const books = new Map((await c.db('bookstore').collection('books').find({ id: { $in: [...new Set(sample.map((r) => r.book_id))] } }, { projection: { id: 1, language: 1, original_language: 1, languages: 1 } }).toArray()).map((b) => [b.id, b]));
  await c.close();
  const { bookLanguages } = await import('../../lib/reread-lane-gate.mjs');
  let n = 0, agree = 0, noFile = 0; const mism = [], conf = {};
  for (const r of sample) {
    const fm = find(r.book_id, r.page_id, 'meta.json'), ft = find(r.book_id, r.page_id, 'txt'), fp = find(r.book_id, r.page_id, 'prompt.txt');
    if (!fm || !ft || !fp) { noFile++; continue; }
    const meta = JSON.parse(fs.readFileSync(fm, 'utf8')), prompt = fs.readFileSync(fp, 'utf8');
    const draft = prompt.match(/\nDRAFT START\n([\s\S]*)\nDRAFT END\n/)?.[1];
    if (draft == null) { noFile++; continue; }
    // Ledger reasons that come from the page's state at apply time, not from the read, are outside the replica.
    if (/no longer the stored OCR|OCR was rewritten after this read|not_read/.test(r.why)) continue;
    const got = servedCorrection({ exit: meta.exit, wrapper: meta.wrapper, text: fs.readFileSync(ft, 'utf8') }, draft, { languages: bookLanguages(books.get(r.book_id)) });
    n++;
    const k = `${r.outcome}->${got.outcome}`; conf[k] = (conf[k] ?? 0) + 1;
    if (got.outcome === r.outcome) agree++; else if (mism.length < 30) mism.push({ page_id: r.page_id, ledger: r.why, replica: got.why });
  }
  const res = { n, agree, rate: n ? +(agree / n).toFixed(4) : null, no_file: noFile, confusion: conf, mismatches: mism, bar: 0.98 };
  W('frame/replica-check.json', res);
  console.log(JSON.stringify(res, null, 1));
}

const stages = { draw, reads, replica };
if (!stages[process.argv[2]]) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
await stages[process.argv[2]]();
