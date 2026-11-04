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

// score-arms: every arm on the 70 scored pages ($P/w/pages.json), by the same marks measure, + the blind judge's verdicts
// from each judge dir given (--judge=judge5,judge-fm). → $P/arms.json. Paired gained/lost are against OC (Opus correct).
if (STEP === 'score-arms') {
  const { armText } = await import('./judge-multi.mjs');
  const { by } = kanripoLeaves();
  const W = path.join(P, 'w'); const pages = JSON.parse(fs.readFileSync(path.join(W, 'pages.json'), 'utf8'));
  const ARMS = ['P0', 'OC', 'SC', 'FL', 'FM', 'FR'];
  const judges = (process.argv.find((a) => a.startsWith('--judge='))?.slice(8) || 'judge5').split(',').filter((d) => fs.existsSync(path.join(W, d, 'key.json')));
  const verdict = {}; // `${arm}|${slug}` → verdict word (first judge dir that judged it); swap controls → caught/not
  const swaps = [];
  for (const d of judges) {
    const key = JSON.parse(fs.readFileSync(path.join(W, d, 'key.json'), 'utf8'));
    for (const [uid, k] of Object.entries(key)) {
      let j; try { j = JSON.parse(fs.readFileSync(path.join(W, d, `${uid}.json`), 'utf8')).verdict; } catch { continue; }
      if (!j) continue;
      for (const [l, arm] of Object.entries(k.labels)) {
        if (k.swap?.arm === arm) swaps.push({ judge: d, uid, arm, verdict: j[l]?.verdict, not_this_leaf: j[l]?.not_this_leaf, caught: j[l]?.verdict === 'misleading' || j[l]?.not_this_leaf === true });
        else if (!k.swap && !(`${arm}|${uid}` in verdict)) verdict[`${arm}|${uid}`] = { v: j[l]?.verdict, ntl: j[l]?.not_this_leaf, judge: d };
      }
    }
  }
  const rows = [];
  for (const p of pages) {
    const leaf = by.get(readJsonl(path.join(P, p.per_call, 'manifest.jsonl')).find((m) => m.page_id === p.page_id).pb);
    const draft = armText('P0', p);
    for (const arm of ARMS) {
      const t = armText(arm, p);
      const row = { arm, slug: p.slug, page_id: p.page_id, kind: p.set, per_call: p.per_call, answered: t != null, judge: verdict[`${arm}|${p.slug}`] ?? null };
      if (t != null) Object.assign(row, measure(t, draft, leaf.text)); else row.usable = false;
      rows.push(row);
    }
  }
  const sum = (R) => {
    const n = R.length, u = R.filter((x) => x.usable).length, J = R.filter((x) => x.judge?.v);
    return { n, answered: R.filter((x) => x.answered).length, usable: u, usable_ci: wilson(u, n),
      marks_rec: R.reduce((a, x) => a + Math.min(x.marks ?? 0, x.truth ?? 0), 0) / Math.max(1, R.reduce((a, x) => a + (x.truth ?? 0), 0)),
      marks_prec: R.reduce((a, x) => a + Math.min(x.marks ?? 0, x.truth ?? 0), 0) / Math.max(1, R.reduce((a, x) => a + (x.marks ?? 0), 0)),
      median_cer: median(R.filter((x) => x.cer != null).map((x) => x.cer)),
      judged: J.length, misleading: J.filter((x) => x.judge.v === 'misleading').length, flawed: J.filter((x) => x.judge.v === 'flawed').length, sound: J.filter((x) => x.judge.v === 'sound').length,
      not_this_leaf: J.filter((x) => x.judge.ntl).length };
  };
  const out = { at: new Date().toISOString(), judges, swaps, arms: {}, paired_vs_OC: {} };
  for (const arm of ARMS) {
    const R = rows.filter((x) => x.arm === arm); if (!R.some((x) => x.answered)) continue;
    out.arms[arm] = { zero_60: sum(R.filter((x) => x.kind === 'zero')), keep_10: sum(R.filter((x) => x.kind === 'keep')),
      zero_s1: sum(R.filter((x) => x.kind === 'zero' && x.per_call === 's1')), zero_s10: sum(R.filter((x) => x.kind === 'zero' && x.per_call === 's10')) };
    if (arm !== 'OC') {
      const oc = new Map(rows.filter((x) => x.arm === 'OC').map((x) => [x.slug, x]));
      const Z = R.filter((x) => x.kind === 'zero');
      const mis = (x) => x?.judge?.v === 'misleading';
      out.paired_vs_OC[arm] = { usable_gained: Z.filter((x) => x.usable && !oc.get(x.slug).usable).map((x) => x.slug), usable_lost: Z.filter((x) => !x.usable && oc.get(x.slug).usable).map((x) => x.slug),
        misleading_added: Z.filter((x) => mis(x) && oc.get(x.slug).judge && !mis(oc.get(x.slug))).map((x) => x.slug), misleading_removed: Z.filter((x) => x.judge && !mis(x) && mis(oc.get(x.slug))).map((x) => x.slug),
        usable_diff: (Z.filter((x) => x.usable).length - Z.filter((x) => oc.get(x.slug).usable).length) / Z.length };
    }
  }
  out.rows = rows;
  fs.writeFileSync(path.join(P, 'arms.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ judges, swaps: swaps.map((s) => `${s.arm}:${s.caught ? 'caught' : 'MISSED'}`), arms: Object.fromEntries(Object.entries(out.arms).map(([a, v]) => [a, { zero: `${v.zero_60.usable}/${v.zero_60.n}`, keep: `${v.keep_10.usable}/${v.keep_10.n}`, rec: v.zero_60.marks_rec.toFixed(3), prec: v.zero_60.marks_prec.toFixed(3), mis: `${v.zero_60.misleading}/${v.zero_60.judged}`, keep_mis: `${v.keep_10.misleading}/${v.keep_10.judged}` }])), paired: Object.fromEntries(Object.entries(out.paired_vs_OC).map(([a, v]) => [a, { gained: v.usable_gained.length, lost: v.usable_lost.length, mis_added: v.misleading_added.length, mis_removed: v.misleading_removed.length, diff: v.usable_diff.toFixed(3) }])) }, null, 1));
}

// evidence: arms.json → the router evidence file, in zh-ditto-5274.score.json's shape (one cell, every arm a route,
// k/n strings). wrong_text_pages = misleading by the blind judge; accept = not misleading. → argv[3].
if (STEP === 'evidence') {
  const o = JSON.parse(fs.readFileSync(path.join(P, 'arms.json'), 'utf8'));
  const ROUTE = { P0: ['P0', 'paddle (stored)'], OC: ['P2-r2', 'paddle>opus correct, ditto instruction, stored image (correct.mjs)'], SC: ['P2-r2-sonnet', 'paddle>sonnet correct, ditto instruction, stored image'],
    FL: ['P2-flash-low', 'paddle>agy gemini-3.8-flash-low correct, ditto instruction'], FM: ['P2-flash-medium', 'paddle>agy gemini-3.8-flash-medium correct, ditto instruction'], FR: ['opus-fresh', 'opus fresh read, live first-read prompt, no draft'] };
  const routes = {};
  for (const [arm, v] of Object.entries(o.arms)) {
    const R = o.rows.filter((r) => r.arm === arm && r.kind === 'zero'); const J = R.filter((r) => r.judge?.v);
    const books = new Set(R.map((r) => r.slug.split('-').slice(2, 3)[0])).size;
    const run = R.filter((r) => r.run_rec != null);
    routes[ROUTE[arm][0]] = { n: R.length, books, usable: `${v.zero_60.usable}/${R.length}`, usable_per_call_1: `${v.zero_s1.usable}/${v.zero_s1.n}`, usable_per_call_10: `${v.zero_s10.usable}/${v.zero_s10.n}`,
      ditto_count_recall: +v.zero_60.marks_rec.toFixed(3), ditto_count_precision: +v.zero_60.marks_prec.toFixed(3), ditto_run_recall: run.length ? +(run.reduce((a, r) => a + r.run_rec, 0) / run.length).toFixed(3) : null,
      cer_marks_removed_median: +v.zero_60.median_cer.toFixed(3), served: ROUTE[arm][1],
      ...(J.length && { wrong_text_pages: `${v.zero_60.misleading}/${J.length}`, accept: `${J.length - v.zero_60.misleading}/${J.length}`, judges: [...new Set(J.map((r) => r.judge.judge))] }),
      keep_pages: { usable: `${v.keep_10.usable}/${v.keep_10.n}`, ...(v.keep_10.judged && { wrong_text_pages: `${v.keep_10.misleading}/${v.keep_10.judged}` }) },
      ...(o.paired_vs_OC[arm] && { paired_vs_P2_r2: { usable_gained: o.paired_vs_OC[arm].usable_gained.length, usable_lost: o.paired_vs_OC[arm].usable_lost.length, misleading_added: o.paired_vs_OC[arm].misleading_added.length, misleading_removed: o.paired_vs_OC[arm].misleading_removed.length } }) };
  }
  const file = { generated_by: 'scripts/batch/zh-ditto-5274/pilot.mjs score-arms + evidence (job zh-ditto-correct-5274, #5274; no model calls in this step)',
    provenance: '#5274 production pilot: 60 zero-丨 Paddle pages of 佩文韻府 / 駢字類編 / 韻府拾遺, one per book (30 at --per-call=1, 30 scored inside runs of 10 at --per-call=10; seed 52740), 10 keep pages; books not in the test draw. Marks scored against the Kanripo WYG leaf; Experiment: scripts/eval/experiments/2026-11-04-zh-ditto-pilot-5274.md',
    judge: 'claude-opus-5-5 (claude -p), blind, up to six labelled texts with the Archive image, zh-ditto-restore-5274 verdict words (scripts/batch/zh-ditto-5274/judge-multi.mjs)',
    mapping: 'wrong_text_pages = misleading; accept = not misleading; an arm judged in more than one pass takes its first pass',
    cells: { 'zh-ditto-5274': { task: 'ocr', lang: 'Chinese', pages: 60, controls: { wrong_page: o.swaps.map((s) => ({ id: s.uid, judge: s.judge, arm: ROUTE[s.arm]?.[0] ?? s.arm, accept: !s.caught, passed: s.caught })) }, routes } } };
  fs.writeFileSync(process.argv[3], JSON.stringify(file, null, 1) + '\n');
  console.log(`evidence → ${process.argv[3]}: ${Object.entries(routes).map(([k, v]) => `${k} ${v.usable} usable, ${v.wrong_text_pages ?? '-'} misleading`).join('; ')}`);
}

// side-by-side: per page, the scan link, each arm's marks / CER / verdict and its text differences from the Opus
// correction (OC), as runs of the folded Han text (- in OC only, + in the arm only). Reads $P/arms.json. → argv[3].
if (STEP === 'side-by-side') {
  const { armText } = await import('./judge-multi.mjs');
  const o = JSON.parse(fs.readFileSync(path.join(P, 'arms.json'), 'utf8'));
  const pages = JSON.parse(fs.readFileSync(path.join(P, 'w', 'pages.json'), 'utf8'));
  const NAMES = { P0: 'P0 stored Paddle', OC: 'Opus correct', SC: 'Sonnet correct', FL: 'Flash-low correct', FM: 'Flash-medium correct', FR: 'Opus fresh read' };
  const diff = (a, b) => {   // LCS over characters; returns [{op:'-'|'+', s}] runs
    const A = [...a], B = [...b], n = A.length, m = B.length, L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const out = []; let i = 0, j = 0; const push = (op, ch) => { const t = out[out.length - 1]; if (t?.op === op) t.s += ch; else out.push({ op, s: ch }); };
    while (i < n || j < m) { if (i < n && j < m && A[i] === B[j]) { push('=', A[i]); i++; j++; } else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) { push('+', B[j]); j++; } else { push('-', A[i]); i++; } }
    // a changed span: the runs between two equal runs, shown as -x +y with a few characters of context
    const spans = []; for (let k = 0; k < out.length; k++) { if (out[k].op === '=') continue; let e = k; while (e + 1 < out.length && out[e + 1].op !== '=') e++;
      const del = out.slice(k, e + 1).filter((x) => x.op === '-').map((x) => x.s).join(''), ins = out.slice(k, e + 1).filter((x) => x.op === '+').map((x) => x.s).join('');
      spans.push(`${(out[k - 1]?.s ?? '').slice(-3)}[${del ? `-${del}` : ''}${ins ? `${del ? ' ' : ''}+${ins}` : ''}]`); k = e; }
    return spans;
  };
  const md = ['# #5274 pilot, side by side', '', `Generated ${o.at} by \`scripts/batch/zh-ditto-5274/pilot.mjs side-by-side\`. Per page: each arm's marks (found/leaf), CER with marks removed against the Kanripo leaf, usable by the marks bar, the blind judge's verdict (arm names hidden from the judge), and its differences from the Opus correction over the folded Han text (\`[-x +y]\`: x in Opus only, y in the arm only; up to 12 spans). Judges: ${o.judges.join(', ')}.`, ''];
  for (const p of pages) {
    const R = Object.fromEntries(o.rows.filter((r) => r.slug === p.slug).map((r) => [r.arm, r]));
    md.push(`## ${p.slug} — ${p.fam}, ${p.set === 'keep' ? 'keep page' : 'zero-丨 page'}, ${p.per_call === 's10' ? 'per-call 10' : 'per-call 1'}`, '', `Scan: https://sourcelibrary.org/book/${p.bid}?page=${p.pn}`, '', '| arm | marks | CER | usable | judge | differences from Opus correct |', '|---|---:|---:|---|---|---|');
    const oc = hanOf(armText('OC', p) ?? '');
    for (const arm of Object.keys(NAMES)) {
      const r = R[arm]; if (!r?.answered) continue;
      const d = arm === 'OC' ? '—' : diff(oc, hanOf(armText(arm, p))); const ds = Array.isArray(d) ? (d.length ? `${d.length} spans: ${d.slice(0, 12).join(' ')}${d.length > 12 ? ' …' : ''}` : 'identical') : d;
      md.push(`| ${NAMES[arm]} | ${r.marks}/${r.truth} | ${(r.cer * 100).toFixed(1)}% | ${r.usable ? 'yes' : 'no'} | ${r.judge?.v ?? '—'} | ${ds.replace(/\|/g, '\\|')} |`);
    }
    md.push('');
  }
  fs.mkdirSync(path.dirname(process.argv[3]), { recursive: true });
  fs.writeFileSync(process.argv[3], md.join('\n') + '\n');
  console.log(`${pages.length} pages → ${process.argv[3]}`);
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
