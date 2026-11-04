#!/usr/bin/env node
// PRIOR ART: scripts/eval/zh-ditto-restore-5274/{draw,prep,score}.mjs (the test this pilot follows: one page per book,
// the Kanripo WYG leaf through ocr.qa_screen.pb at dice ≥ 0.6, marks recall/precision, placed runs, CER with marks
// removed, the usable bar of its PREREG.md; imported where it exports, else the same rule restated). They score fixed
// arm dirs and write into the eval's committed results, and have no per-call=10 set or own-leaf/neighbour check, which
// is this pilot's question (#5021: multi-page calls can slide text onto the next page).
/**
 * pilot.mjs — the #5274 pilot through correct.mjs. Files only, READ-ONLY on Mongo.
 *   node --env-file=… scripts/batch/zh-ditto-5274/pilot.mjs draw   → $P/s1/manifest.jsonl, $P/s10/manifest.jsonl, $P/draw.json
 *   node --env-file=… scripts/batch/zh-ditto-5274/pilot.mjs score  → $P/score.json (+ $P/w for judge.mjs)
 * $P = $JOB_SCRATCH/pilot. Kanripo clones in $JOB_SCRATCH/kr. Census from frame.mjs.
 *   s1:  30 zero-丨 pages, one per book, + 10 keep pages (≥ 90% of their leaf's marks), one per book, --per-call=1.
 *   s10: 30 zero-丨 pages, one per book (other books), each inside a run of 10 zero pages of its book: --per-call=10.
 * Books: not held, not in the eval's draw. Seed 52740.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { makeRng } from '../../eval/lib/paired-stats.mjs';
import { bodyText, foldHan, bodyCer, median, wilson } from '../../eval/ground-truth-5935/lib.mjs';
import { fold } from '../../eval/zh-skqs-5568-kanripo.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const J = process.env.JOB_SCRATCH; const P = path.join(J, 'pilot');
const STEP = process.argv[2];
const SEED = 52740;
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const shuffle = (xs, seed) => { const a = [...xs], r = makeRng(seed); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** Every Kanripo leaf in file order: pb → { i, raw, text } and the ordered list (for the neighbour check). */
export function kanripoLeaves(dir = path.join(J, 'kr')) {
  const order = [], by = new Map();
  for (const r of ['KR3k0059', 'KR3k0056', 'KR3k0060']) for (const f of fs.readdirSync(path.join(dir, r)).filter((x) => x.endsWith('.txt')).sort()) {
    const parts = fs.readFileSync(path.join(dir, r, f), 'utf8').replace(/^#.*$/gm, '').split(/<pb:([^>]+)>/);
    for (let i = 1; i < parts.length; i += 2) { const x = { pb: parts[i], i: order.length, raw: parts[i + 1], text: fold(parts[i + 1]) }; order.push(x); by.set(x.pb, x); }
  }
  return { order, by };
}

// score.mjs's measures (zh-ditto-restore-5274), restated: that file runs on import.
const unTable = (t) => t.split('\n').filter((l) => !/^\s*\|?[\s:|-]*-{3,}[\s:|-]*\|?\s*$/.test(l)).map((l) => (/^\s*\|.*\|\s*$/.test(l) ? l.replace(/\|/g, '\n') : l)).join('\n');
export const hanOf = (t) => foldHan(bodyText(unTable(String(t || ''))).replace(/[｜|│┃〡]/g, '丨'));
const runs = (q) => [...q.matchAll(/丨+/g)].map((m) => ({ n: m[0].length, l: q[m.index - 1] ?? '', r: q[m.index + m[0].length] ?? '' }));
const nMarks = (q) => (q.match(/丨/g) || []).length;
const noMarks = (q) => q.replace(/丨/g, '');
function placed(armQ, leafQ) {
  const A = runs(armQ), L = runs(leafQ), used = new Set(); let hit = 0;
  for (const x of L) { const i = A.findIndex((y, k) => !used.has(k) && y.n === x.n && ((x.l && y.l === x.l) || (x.r && y.r === x.r))); if (i >= 0) { used.add(i); hit++; } }
  return { recall: L.length ? hit / L.length : null, precision: A.length ? hit / A.length : null };
}
export function measure(text, draft, leafText) {
  const q = hanOf(text), p0 = hanOf(draft), n = nMarks(q), truth = nMarks(leafText);
  const pl = placed(q, leafText);
  const cer = bodyCer(noMarks(q), noMarks(leafText), { expected: [...noMarks(leafText)].length }).cer;
  const p0cer = bodyCer(noMarks(p0), noMarks(leafText), { expected: [...noMarks(leafText)].length }).cer;
  const rec = truth ? Math.min(n, truth) / truth : null, prec = n ? Math.min(n, truth) / n : null;
  // PREREG.md's usable bar: marks recall and precision ≥ 0.9, placed-run recall ≥ 0.8, CER (marks out) ≤ P0 + 0.5 pt.
  const usable = truth > 0 ? rec >= 0.9 && prec >= 0.9 && (pl.recall ?? 0) >= 0.8 && cer <= p0cer + 0.005 : cer <= p0cer + 0.005 && n <= 1;
  return { marks: n, truth, rec, prec, run_rec: pl.recall, run_prec: pl.precision, cer, p0cer, yi_extra: (q.match(/一/g) || []).length - (leafText.match(/一/g) || []).length, usable };
}

if (STEP === 'draw') {
  const census = zlib.gunzipSync(fs.readFileSync(path.join(J, 'census.jsonl.gz'))).toString().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const evalDraw = JSON.parse(fs.readFileSync(path.join(HERE, '../../eval/results/zh-ditto-restore-5274/draw.json'), 'utf8')).pages;
  const evalBooks = new Set(evalDraw.map((d) => d.bid));
  const ok = census.filter((r) => !r.held && !r.edited && !evalBooks.has(r.bid) && r.leaf_marks != null);
  const byBook = new Map(); for (const r of census) (byBook.get(r.bid) ?? byBook.set(r.bid, []).get(r.bid)).push(r);
  for (const v of byBook.values()) v.sort((a, b) => a.pn - b.pn);
  const used = new Set(); const s1 = [], s10 = [], keep = [];
  const r = makeRng(SEED + 7);
  for (const x of shuffle(ok.filter((q) => q.marks === 0 && q.leaf_marks > 0), SEED)) {
    if (used.has(x.bid)) continue;
    if (s1.length < 30) { used.add(x.bid); s1.push(x); continue; }
    if (s10.length >= 30) break;
    // a run of 10 of this book's zero-丨 pages, in page order, holding x at a seeded position: the call the bulk run
    // makes (correct.mjs groups a book's manifest pages in page order, ten a call)
    const bp = byBook.get(x.bid).filter((q) => q.marks === 0 && !q.edited && q.leaf_marks !== 0); const at = bp.indexOf(x); const k = Math.floor(r() * 10);
    const run = bp.slice(Math.max(0, at - k), Math.max(0, at - k) + 10);
    if (run.length < 10) continue;
    used.add(x.bid); s10.push({ ...x, run: run.map((q) => q.pid) });
  }
  for (const x of shuffle(ok.filter((q) => q.marks >= 5 && q.leaf_marks > 0 && q.marks / q.leaf_marks >= 0.9), SEED + 1)) { if (keep.length >= 10) break; if (used.has(x.bid)) continue; used.add(x.bid); keep.push(x); }
  const row = (x, set, scored = true) => ({ page_id: x.pid, book_id: x.bid, page_number: x.pn, set, scored, fam: x.fam, pb: x.pb, leaf_marks: x.leaf_marks, stored_marks: x.marks });
  fs.mkdirSync(path.join(P, 's1'), { recursive: true }); fs.mkdirSync(path.join(P, 's10'), { recursive: true });
  fs.writeFileSync(path.join(P, 's1', 'manifest.jsonl'), [...s1.map((x) => row(x, 'zero')), ...keep.map((x) => row(x, 'keep'))].map((x) => JSON.stringify(x)).join('\n') + '\n');
  const pid2 = new Map(census.map((q) => [q.pid, q]));
  fs.writeFileSync(path.join(P, 's10', 'manifest.jsonl'), s10.flatMap((x) => x.run.map((id) => row(pid2.get(id), 'zero', id === x.pid))).map((x) => JSON.stringify(x)).join('\n') + '\n');
  fs.writeFileSync(path.join(P, 'draw.json'), JSON.stringify({ seed: SEED, s1: s1.map((x) => x.pid), keep: keep.map((x) => x.pid), s10: s10.map((x) => ({ scored: x.pid, run: x.run })) }, null, 1));
  console.log(`s1 ${s1.length} zero + ${keep.length} keep; s10 ${s10.length} scored in ${s10.length} runs of 10 (${s10.length * 10} pages); fam s1 ${JSON.stringify(Object.groupBy(s1, (x) => x.fam), (k, v) => (Array.isArray(v) ? v.length : v))} s10 ${JSON.stringify(Object.groupBy(s10, (x) => x.fam), (k, v) => (Array.isArray(v) ? v.length : v))}`);
}

if (STEP === 'score') {
  const { order, by } = kanripoLeaves();
  const out = { at: new Date().toISOString(), sets: {}, pages: [] };
  for (const set of ['s1', 's10']) {
    const dir = path.join(P, set);
    for (const m of readJsonl(path.join(dir, 'manifest.jsonl'))) {
      const meta = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'reads', `${m.page_id}.meta.json`), 'utf8')); } catch { return null; } })();
      const draft = fs.existsSync(path.join(dir, 'stored', `${m.page_id}.txt`)) ? fs.readFileSync(path.join(dir, 'stored', `${m.page_id}.txt`), 'utf8') : null;
      const leaf = by.get(m.pb);
      const row = { set, kind: m.set, scored: m.scored, page_id: m.page_id, book_id: m.book_id, pn: m.page_number, fam: m.fam, outcome: meta?.outcome ?? 'not reached', reason: meta?.reason ?? null, call_position: meta?.call_position ?? null, call_pages: meta?.call_pages ?? null };
      if (meta?.outcome === 'corrected' || meta?.outcome === 'unchanged') {
        const text = meta.outcome === 'corrected' ? fs.readFileSync(path.join(dir, 'reads', `${m.page_id}.txt`), 'utf8') : draft;
        Object.assign(row, measure(text, draft, leaf.text));
        // own leaf vs the neighbours: a slid page reads closer to the next (or previous) leaf than to its own
        const prev = order[leaf.i - 1], next = order[leaf.i + 1];
        const c = (L) => (L ? bodyCer(noMarks(hanOf(text)), noMarks(L.text), { expected: [...noMarks(L.text)].length }).cer : null);
        row.cer_prev = c(prev); row.cer_next = c(next);
        row.own_leaf = row.cer < Math.min(row.cer_prev ?? 9, row.cer_next ?? 9);
        // shared-words floor of cli-ocr.mjs apply (5+ letter runs) and its 25% words cap, against the draft
        row.chars = text.length; row.draft_chars = draft.length;
      } else row.usable = false;
      out.pages.push(row);
    }
  }
  const sum = (R) => {
    const n = R.length, u = R.filter((x) => x.usable).length;
    return { n, usable: u, usable_ci: wilson(u, n), outcomes: Object.fromEntries(Object.entries(Object.groupBy(R, (x) => x.outcome)).map(([k, v]) => [k, v.length])),
      own_leaf: R.filter((x) => x.own_leaf).length, not_own_leaf: R.filter((x) => x.own_leaf === false).map((x) => `${x.page_id}@${x.call_position}`),
      marks_rec: R.reduce((a, x) => a + Math.min(x.marks ?? 0, x.truth ?? 0), 0) / Math.max(1, R.reduce((a, x) => a + (x.truth ?? 0), 0)),
      marks_prec: R.reduce((a, x) => a + Math.min(x.marks ?? 0, x.truth ?? 0), 0) / Math.max(1, R.reduce((a, x) => a + (x.marks ?? 0), 0)),
      median_cer: median(R.filter((x) => x.cer != null).map((x) => x.cer)), median_p0cer: median(R.filter((x) => x.p0cer != null).map((x) => x.p0cer)),
      yi_extra_mean: R.filter((x) => x.yi_extra != null).reduce((a, x) => a + x.yi_extra, 0) / Math.max(1, R.filter((x) => x.yi_extra != null).length) };
  };
  out.sets['s1 zero (per-call 1)'] = sum(out.pages.filter((x) => x.set === 's1' && x.kind === 'zero'));
  out.sets['s1 keep (per-call 1)'] = sum(out.pages.filter((x) => x.set === 's1' && x.kind === 'keep'));
  out.sets['s10 scored (per-call 10)'] = sum(out.pages.filter((x) => x.set === 's10' && x.scored));
  out.sets['s10 all pages (per-call 10)'] = sum(out.pages.filter((x) => x.set === 's10'));
  for (let pos = 1; pos <= 10; pos++) { const R = out.pages.filter((x) => x.set === 's10' && x.call_position === pos); if (R.length) out.sets[`s10 position ${pos}`] = (({ n, usable, own_leaf, median_cer }) => ({ n, usable, own_leaf, median_cer }))(sum(R)); }
  fs.writeFileSync(path.join(P, 'score.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out.sets, null, 1));
}

// judge-prep: the 70 scored pages in judge.mjs's layout ($P/w: pages.json, p0/, C/, img/ia/), so the eval's blind judge
// runs unchanged with JOB_SCRATCH=$P: `judge.mjs P0,C`. C is the served correction (UNCHANGED = the draft).
if (STEP === 'judge-prep') {
  const { MongoClient } = await import('mongodb');
  const W = path.join(P, 'w'); for (const d of ['p0', 'C', 'img/ia']) fs.mkdirSync(path.join(W, d), { recursive: true });
  const rows = [];
  for (const set of ['s1', 's10']) for (const m of readJsonl(path.join(P, set, 'manifest.jsonl'))) if (m.scored) rows.push({ ...m, dir: path.join(P, set) });
  const c = await MongoClient.connect(process.env.MONGODB_URI);
  const docs = new Map((await c.db('bookstore').collection('pages').find({ id: { $in: rows.map((r) => r.page_id) } }, { projection: { _id: 0, id: 1, photo_original: 1 } }).toArray()).map((d) => [d.id, d]));
  await c.close();
  const pages = [];
  for (const m of rows) {
    const meta = JSON.parse(fs.readFileSync(path.join(m.dir, 'reads', `${m.page_id}.meta.json`), 'utf8'));
    const draft = fs.readFileSync(path.join(m.dir, 'stored', `${m.page_id}.txt`), 'utf8');
    if (!['corrected', 'unchanged'].includes(meta.outcome)) { console.log(m.page_id, meta.outcome, 'not judged'); continue; }
    const slug = `${m.set}-${path.basename(m.dir)}-${m.book_id.slice(-8)}-p${m.page_number}`;
    fs.writeFileSync(path.join(W, 'p0', `${slug}.txt`), draft);
    fs.writeFileSync(path.join(W, 'C', `${slug}.json`), JSON.stringify({ outcome: meta.outcome, text: meta.outcome === 'corrected' ? fs.readFileSync(path.join(m.dir, 'reads', `${m.page_id}.txt`), 'utf8') : draft }));
    const f = path.join(W, 'img/ia', `${slug}.jpg`);
    if (!fs.existsSync(f)) {
      const url = docs.get(m.page_id)?.photo_original;
      let buf = null;
      for (let t = 0; t < 4 && !buf; t++) { try { const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120000) }); if (r.ok) buf = Buffer.from(await r.arrayBuffer()); } catch { /* retried */ } if (!buf) await new Promise((s) => setTimeout(s, 3000 * (t + 1))); }
      // the Archive's file, as the test judged; the stored copy the corrector saw when the Archive does not answer
      fs.writeFileSync(f, buf ?? fs.readFileSync(path.join(m.dir, 'reads', `ws-${m.page_id}`, `${m.page_id}.jpg`)));
    }
    pages.push({ slug, set: m.set, page_id: m.page_id, bid: m.book_id, pn: m.page_number, fam: m.fam, per_call: path.basename(m.dir) });
  }
  fs.writeFileSync(path.join(W, 'pages.json'), JSON.stringify(pages, null, 1));
  console.log(`${pages.length} pages ready for judge.mjs P0,C`);
}
