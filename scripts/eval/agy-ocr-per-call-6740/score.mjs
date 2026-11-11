#!/usr/bin/env node
// PRIOR ART: scripts/eval/agy-per-call-7503/score.mjs and tokens.mjs (PR #7518: the same table for translation, from
// its own packet key and a block runner's calls.jsonl of another shape); ground-truth-5935/lib.mjs bodyCer (imported).
// Neither has a cross-page check over OCR text against a reference or a draft.
/**
 *   node scripts/eval/agy-ocr-per-call-6740/score.mjs --scratch=DIR      -> results.json here + the table on stdout
 *
 * Per task x arm: accepted (Opus judge; a page with no read is not accepted), wrong_text pages, T1 mean/median CER
 * against the own Kanripo leaf, cross-page faults (mechanical, header of the experiments file), quota per page from
 * every call's agy usage (index = input + 6 x (output + thinking), the #7518 assumption), and the paired difference in
 * accepted pages against A1 with a 95% bootstrap over the 15 books. Controls: judge catch and cross-page check catch.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { bodyText, foldHan, bodyCer, makeRng, wilson, mean, median } from '../ground-truth-5935/lib.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const S = arg('scratch');
const draw = JSON.parse(fs.readFileSync(path.join(HERE, 'draw.json'), 'utf8'));
const key = JSON.parse(fs.readFileSync(path.join(S, 'judge/key.json'), 'utf8'));
const controls = JSON.parse(fs.readFileSync(path.join(HERE, 'controls.json'), 'utf8'));
const items = new Map(JSON.parse(fs.readFileSync(path.join(S, 'judge/items.json'), 'utf8')).map((i) => [i.id, i]));
const verdicts = new Map(fs.readFileSync(path.join(S, 'judge/verdicts.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.verdict).map((r) => [r.id, r.verdict]));
const gzl = (f) => zlib.gunzipSync(fs.readFileSync(path.join(S, f))).toString('utf8').trim().split('\n').map((l) => JSON.parse(l));
const refs = new Map(gzl('kanripo.jsonl.gz').map((r) => [r.page_id, r]));
const drafts = new Map(gzl('drafts.jsonl.gz').map((r) => [r.page_id, r.draft]));
const W = 6;
const byEye = fs.existsSync(path.join(HERE, 'by-eye.json')) ? JSON.parse(fs.readFileSync(path.join(HERE, 'by-eye.json'), 'utf8')) : {};
const ARMS = ['A1', 'A1b', 'B2', 'C3'].filter((a) => fs.existsSync(path.join(S, 'T1', a)) || fs.existsSync(path.join(S, 'T2', a)));
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);

// verdict of (task, arm, page)
const vOf = new Map();
for (const [id, k] of Object.entries(key)) for (const arm of k.arms) vOf.set(`${k.task}|${arm}|${k.page_id}`, { id, v: verdicts.get(id) ?? null });

// ── cross-page checks ────────────────────────────────────────────────────────
const bigrams = (s) => { const m = new Map(); for (let i = 0; i + 1 < s.length; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
const dice = (a, b) => { const A = bigrams(a), B = bigrams(b); let x = 0, na = 0, nb = 0; for (const v of A.values()) na += v; for (const v of B.values()) nb += v; for (const [g, v] of A) x += Math.min(v, B.get(g) || 0); return na + nb ? (2 * x) / (na + nb) : 0; };
const RUN = 8;
/** T1: Han runs of >= RUN that are in the other page's leaf and not in the own leaf; swap by bigram dice. */
function crossT1(text, own, other) {
  const Q = foldHan(bodyText(text));
  const marked = new Array(Q.length).fill(false);
  for (let i = 0; i + RUN <= Q.length; i++) { const g = Q.slice(i, i + RUN); if (other.includes(g) && !own.includes(g)) for (let j = i; j < i + RUN; j++) marked[j] = true; }
  const foreign = marked.filter(Boolean).length;
  const dOwn = dice(Q, own), dOther = dice(Q, other);
  const runs = []; let cur = '';
  for (let i = 0; i < Q.length; i++) { if (marked[i]) cur += Q[i]; else if (cur) { runs.push(cur); cur = ''; } } if (cur) runs.push(cur);
  return { empty: Q.length < 5, swap: dOther > dOwn, foreign_chars: foreign, runs, dice_own: r3(dOwn), dice_other: r3(dOther) };
}
const norm = (l) => l.toLowerCase().replace(/<[^>]*>/g, ' ').replace(/[^\p{L}]/gu, '');
const tri = (s) => { const t = new Set(); for (let i = 0; i + 3 <= s.length; i++) t.add(s.slice(i, i + 3)); return t; };
const g8 = (s) => { const t = new Set(); for (let i = 0; i + 8 <= s.length; i++) t.add(s.slice(i, i + 8)); return t; };
const jac = (a, b) => { let x = 0; for (const g of a) if (b.has(g)) x++; return a.size + b.size - x ? x / (a.size + b.size - x) : 0; };
/**
 * T2: lines of >= 25 letters whose letter 8-grams are >= 70% in the other page's draft and < 30% in the own draft.
 * (Amended before the final score: the pre-registered line-to-line trigram Jaccard missed a planted bleed, because the
 * reads and the drafts break lines differently, and German trigrams are common to any two pages; containment of
 * 8-grams in the whole draft depends on neither.)
 */
function crossT2(text, own, other) {
  const lines = String(text || '').split('\n').map(norm).filter((l) => l.length >= 25);
  const D = g8(norm(String(own || ''))), E = g8(norm(String(other || '')));
  const share = (t, set) => { let x = 0; for (const g of t) if (set.has(g)) x++; return t.size ? x / t.size : 0; };
  const foreign = lines.filter((l) => { const t = g8(l); return share(t, E) >= 0.7 && share(t, D) < 0.3; }).map((l) => l.slice(0, 60));
  const Q = tri(norm(String(text || ''))), Dt = tri(norm(String(own || ''))), Et = tri(norm(String(other || '')));
  return { empty: norm(String(text || '')).length < 20, swap: jac(Q, Et) > jac(Q, Dt), foreign_lines: foreign.length, runs: foreign, j_own: r3(jac(Q, Dt)), j_other: r3(jac(Q, Et)) };
}
const cross = (task, text, pid, partner) => (task === 'T1' ? crossT1(text, refs.get(pid).leaf, refs.get(partner).leaf) : crossT2(text, drafts.get(pid), drafts.get(partner)));
const faulty = (c) => c.empty || c.swap || (c.foreign_chars ?? c.foreign_lines) > 0;
/**
 * A flag on a block page that a one-per-call read of the same page also raises is the detector's noise (the Kanripo
 * page break falls a column off the scan's; a draft and a read share a running head), not a block fault: the
 * pre-registered baseline. Novel = empty/swap that neither 1/call read shows, or a foreign run (T1: an 8-Han window;
 * T2: a line) that neither 1/call read of the page contains.
 */
function novel(task, c, baseTexts, baseCross) {
  if (c.empty && !baseCross.every((b) => b.empty)) return true;
  if (c.swap && !baseCross.some((b) => b.swap)) return true;
  if (task === 'T1') {
    const B = baseTexts.map((t) => foldHan(bodyText(t)));
    return c.runs.some((r) => { for (let i = 0; i + RUN <= r.length; i++) if (!B.some((b) => b.includes(r.slice(i, i + RUN)))) return true; return false; });
  }
  const B = baseTexts.map((t) => g8(norm(t)));
  return c.runs.some((l) => { const t = g8(l); return !B.some((b) => { let x = 0; for (const g of t) if (b.has(g)) x++; return x / t.size >= 0.7; }); });
}

// ── per arm ──────────────────────────────────────────────────────────────────
const out = { scored_at: new Date().toISOString(), weight_output: W, weight_note: 'assumed (#7518), not a measured agy rate', tasks: {} };
const pageRows = [];
for (const task of ['T1', 'T2']) {
  const T = (out.tasks[task] = { arms: {} });
  const books = draw[task].books;
  for (const arm of ARMS) {
    const dir = path.join(S, task, arm);
    if (!fs.existsSync(dir)) continue;
    const rows = [];
    for (const b of books) for (const [j, p] of b.pages.entries()) {
      const partner = b.pages[1 - j].page_id;
      const meta = JSON.parse(fs.readFileSync(path.join(dir, `${p.page_id}.meta.json`), 'utf8'));
      const text = fs.readFileSync(path.join(dir, `${p.page_id}.txt`), 'utf8');
      const jv = vOf.get(`${task}|${arm}|${p.page_id}`);
      const v = jv?.v;
      const c = cross(task, text, p.page_id, partner);
      let cer = null;
      if (task === 'T1') { const r = refs.get(p.page_id); const Q = foldHan(bodyText(text)); cer = Q.length ? bodyCer(Q, r.window, { expected: r.leaf.length }).cer : 1; }
      const baseArms = ['A1', 'A1b'].filter((a) => a !== arm);
      const baseTexts = baseArms.map((a) => { try { return fs.readFileSync(path.join(S, task, a, `${p.page_id}.txt`), 'utf8'); } catch { return ''; } });
      const blockFault = faulty(c) && novel(task, c, baseTexts, baseTexts.map((t) => cross(task, t, p.page_id, partner)));
      rows.push({ task, arm, book_id: b.book_id, page_id: p.page_id, page_number: p.page_number, pos: j, item: jv?.id ?? null, read: !!text.trim(), judged: !!v,
        accept: !!v?.accept, fidelity: v?.fidelity ?? null, wrong_text: !!v?.defects?.some((d) => d.severity === 'wrong_text'), defects: v?.defects?.map((d) => d.class) ?? [],
        cer: r3(cer), cross: c, cross_flag: faulty(c), cross_fault: blockFault && byEye[`${task}|${arm}|${p.page_id}`]?.verdict !== 'cleared', cross_flag_novel: blockFault, by_eye: byEye[`${task}|${arm}|${p.page_id}`]?.verdict ?? null, unchanged: meta.unchanged, contain: meta.contain, alone: meta.alone, problem: meta.problem ?? null, failed: !!meta.failed });
    }
    pageRows.push(...rows);
    // tokens: every call this arm made
    const calls = fs.readFileSync(path.join(dir, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const t = { input: 0, output: 0, thinking: 0, cache_read: 0 };
    for (const cl of calls) for (const k of Object.keys(t)) t[k] += Number(cl.usage?.[k] || 0);
    const n = rows.length;
    const q = (f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, `quota-${f}.json`), 'utf8')).buckets.find((x) => x.id === 'gemini-weekly')?.remaining; } catch { return null; } };
    const acc = rows.filter((r) => r.accept).length;
    T.arms[arm] = {
      pages: n, read: rows.filter((r) => r.read).length, judged: rows.filter((r) => r.judged).length, accepted: acc, accepted_ci: wilson(acc, n).map(r3),
      wrong_text: rows.filter((r) => r.wrong_text).length, fidelity_mean: r3(mean(rows.filter((r) => r.fidelity).map((r) => r.fidelity))),
      cer_mean: task === 'T1' ? r3(mean(rows.map((r) => r.cer))) : null, cer_median: task === 'T1' ? r3(median(rows.map((r) => r.cer))) : null,
      cross_flag_pages: rows.filter((r) => r.cross_flag).length, cross_flag_novel_pages: rows.filter((r) => r.cross_flag_novel).length, cross_fault_pages: rows.filter((r) => r.cross_fault).length, cross_fault_ids: rows.filter((r) => r.cross_fault).map((r) => r.page_id),
      unchanged: rows.filter((r) => r.unchanged).length, contain: rows.filter((r) => r.contain).length, failed: rows.filter((r) => r.failed).length, refused_block_pages: rows.filter((r) => r.alone).length,
      calls: calls.length, failed_calls: calls.filter((c) => c.cls).length,
      tokens_per_page: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Math.round(v / n)])),
      quota_index: Math.round((t.input + W * (t.output + t.thinking)) / n), quota_index_uncached: Math.round((t.input - t.cache_read + W * (t.output + t.thinking)) / n),
      weekly_remaining: { start: q('start'), end: q('end') },
    };
  }
  const base = T.arms.A1;
  for (const a of Object.values(T.arms)) { a.quota_rel_A1 = r3(a.quota_index / base.quota_index); a.quota_rel_A1_uncached = r3(a.quota_index_uncached / base.quota_index_uncached); }
  // paired difference in accepted share vs A1, bootstrap over books
  const byBook = (arm) => new Map(books.map((b) => [b.book_id, pageRows.filter((r) => r.task === task && r.arm === arm && r.book_id === b.book_id).reduce((s, r) => s + (r.accept ? 1 : 0), 0)]));
  const A = byBook('A1');
  for (const arm of Object.keys(T.arms).filter((a) => a !== 'A1')) {
    const X = byBook(arm), ids = books.map((b) => b.book_id), n = ids.length * 2;
    const d = (sample) => sample.reduce((s, id) => s + X.get(id) - A.get(id), 0) / (sample.length * 2);
    const rng = makeRng(6740), boots = [];
    for (let i = 0; i < 4000; i++) boots.push(d(Array.from({ length: ids.length }, () => ids[Math.floor(rng() * ids.length)])));
    boots.sort((x, y) => x - y);
    T.arms[arm].accept_diff_vs_A1 = { pts: r3(100 * d(ids)), ci95: [r3(100 * boots[100]), r3(100 * boots[3899])], n };
    if (task === 'T1') {
      // Paired CER on the pages BOTH arms read (a refused page is CER 1 and would dominate a 30-page mean).
      const cerOf = (a) => new Map(pageRows.filter((r) => r.task === task && r.arm === a && r.read).map((r) => [r.page_id, r.cer]));
      const ca = cerOf('A1'), cx = cerOf(arm);
      const pairs = books.map((b) => b.pages.filter((p) => ca.has(p.page_id) && cx.has(p.page_id)).map((p) => cx.get(p.page_id) - ca.get(p.page_id)));
      const md = (bs) => { const f = bs.flat(); return f.length ? f.reduce((x, y) => x + y, 0) / f.length : 0; };
      const r2 = makeRng(67402), bc = [];
      for (let i = 0; i < 4000; i++) bc.push(md(Array.from({ length: pairs.length }, () => pairs[Math.floor(r2() * pairs.length)])));
      bc.sort((x, y) => x - y);
      T.arms[arm].cer_diff_vs_A1_both_read = { pages: pairs.flat().length, mean_pts: r3(100 * md(pairs)), ci95: [r3(100 * bc[100]), r3(100 * bc[3899])] };
    }
  }
  // controls
  T.controls = controls.filter((c) => c.task === task).map((c) => {
    const v = verdicts.get(c.id); const it = items.get(c.id);
    const cc = cross(task, it.text, c.page_id, c.partner_id);
    return { id: c.id, kind: c.kind, judged: !!v, caught_by_judge: !!v && (!v.accept || v.defects?.some((d) => d.severity === 'wrong_text')), accept: v?.accept ?? null, caught_by_cross_check: c.kind === 'bleed' ? faulty(cc) : null };
  });
  T.controls_caught = `${T.controls.filter((c) => c.caught_by_judge).length}/${T.controls.length}`;
  T.bleed_controls_cross_check = `${T.controls.filter((c) => c.caught_by_cross_check).length}/${T.controls.filter((c) => c.kind === 'bleed').length}`;
}
fs.writeFileSync(path.join(HERE, 'results.json'), JSON.stringify(out, null, 1) + '\n');
fs.writeFileSync(path.join(HERE, 'pages.jsonl.gz'), zlib.gzipSync(pageRows.map((r) => JSON.stringify(r)).join('\n') + '\n'));
console.log('task | arm | accepted (Wilson 95%) | diff vs A1 [95% by book] | wrong text | CER mean / median | cross-page flags | calls | in / out tok per page | quota idx (rel A1) | uncached rel');
for (const [task, T] of Object.entries(out.tasks)) {
  for (const [arm, a] of Object.entries(T.arms)) console.log(`${task} | ${arm} | ${a.accepted}/${a.pages} [${a.accepted_ci.map((x) => Math.round(100 * x)).join('–')}] | ${a.accept_diff_vs_A1 ? `${a.accept_diff_vs_A1.pts} [${a.accept_diff_vs_A1.ci95.join(', ')}]` : '—'} | ${a.wrong_text} | ${a.cer_mean ?? '—'} / ${a.cer_median ?? '—'} | ${a.cross_fault_pages} | ${a.calls} | ${a.tokens_per_page.input} / ${a.tokens_per_page.output} | ${a.quota_index} (${a.quota_rel_A1}) | ${a.quota_rel_A1_uncached}`);
  for (const [arm, a] of Object.entries(T.arms)) if (a.cer_diff_vs_A1_both_read) console.log(`${task} ${arm} paired CER vs A1 on ${a.cer_diff_vs_A1_both_read.pages} pages both read: ${a.cer_diff_vs_A1_both_read.mean_pts} pts [${a.cer_diff_vs_A1_both_read.ci95.join(', ')}]`);
  console.log(`${task} controls caught by judge ${T.controls_caught}; bleed controls by cross check ${T.bleed_controls_cross_check}`);
}
