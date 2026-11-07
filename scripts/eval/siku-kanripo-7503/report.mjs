#!/usr/bin/env node
// PRIOR ART: scripts/eval/lib/agreement-stats.mjs (bootstrapItems, wilson — imported); paddle-table-6388/cer.mjs
// (per-arm CER summary for 30 pages; here per book and per flag class over whole volumes).
//
// #7503: summarise align.mjs's pages.jsonl + books.json: alignment, CER with a by-book bootstrap CI, every page
// without a leaf put in a class (by text shape, checked by eye on a sample), what Kanripo text would change on
// the dice ≥ 0.9 pages, and (if given) the QA verdicts joined to CER.
//   node scripts/eval/siku-kanripo-7503/report.mjs --in=DIR --dir=KANRIPO_CACHE [--qa=qa.jsonl] > summary.json
import fs from 'node:fs';
import path from 'node:path';
import { bootstrapItems, wilson } from '../lib/agreement-stats.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { workInfo, pbPages } from '../zh-skqs-5568-kanripo.mjs';

const arg = (n, d) => process.argv.find((x) => x.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const IN = arg('in');
const rows = fs.readFileSync(path.join(IN, 'pages.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const books = JSON.parse(fs.readFileSync(path.join(IN, 'books.json'), 'utf8'));
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); if (!s.length) return null; const k = s.length >> 1; return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);

// ── classify every page that has text but no leaf ──
const dupLeaf = {};   // work → Set of pb whose folded text repeats an earlier leaf (a Kanripo transcription defect)
for (const b of books.filter((x) => x.status === 'done')) {
  if (dupLeaf[b.work]) continue;
  const w = await workInfo(b.work);
  const pbs = await pbPages(b.work, w.witness, w.juan_files);
  const seen = new Map(); dupLeaf[b.work] = { set: new Set(), pbs };
  for (const p of pbs) { if (p.text.length < 30) continue; if (seen.has(p.text)) { dupLeaf[b.work].set.add(p.pb); dupLeaf[b.work].set.add(seen.get(p.text)); } else seen.set(p.text, p.pb); }
}
const bookOf = Object.fromEntries(books.map((b) => [b.book_id, b]));
const medChars = {};
for (const b of books) medChars[b.book_id] = med(rows.filter((r) => r.book_id === b.book_id && r.status === 'aligned').map((r) => r.chars));
function classify(r) {
  const b = bookOf[r.book_id];
  if (b.status === 'no-kanripo') return 'no-kanripo-repo';
  if (!b.aligned) return 'kanripo-lacks-these-juan';
  const t = r.body_head || '';   // align.mjs keeps the first 200 body characters of an unaligned page
  if (/校對官|謄錄|詳校官|總校官|覆勘/.test(t)) return 'proofreader-slip';
  if (/謹案|考證|刊本訛|原本.{0,3}訛/.test(t)) return 'kaozheng-notes';
  // the leaf this page should be, from its in-sequence neighbours
  const br = rows.filter((x) => x.book_id === r.book_id && x.status === 'aligned' && !x.flag_out_of_sequence);
  const prev = br.filter((x) => x.pn < r.pn).at(-1), next = br.find((x) => x.pn > r.pn);
  const D = dupLeaf[b.work];
  const exp = prev ? D.pbs[prev.idx + (r.pn - prev.pn)] : next ? D.pbs[next.idx - (next.pn - r.pn)] : null;
  if (/圖/.test(t.slice(0, 40)) && r.chars < 400 && r.dice < 0.3) return 'diagram';
  // in sequence, on the leaf it should be, but below the Dice bar (Kanripo &KR entities, a short leaf, extra text)
  if (exp && r.pb === exp.pb) return 'right-leaf-low-dice';
  if (exp && D.set.has(exp.pb)) return 'kanripo-duplicated-leaf';
  if (exp && exp.text.length < 20) return 'kanripo-leaf-empty';
  if (medChars[r.book_id] && r.chars > 2.5 * medChars[r.book_id]) return 'multi-leaf-image';
  if (r.dice >= 0.5) return 'near-threshold';
  if (r.pn <= 3) return 'front-matter';
  return 'other';
}
for (const r of rows) if (r.status === 'unaligned' || r.status === 'no-kanripo') r.class = classify(r);

// ── CER ──
const scope = (pilotOnly) => rows.filter((r) => !pilotOnly || r.pilot);
function cerBlock(rs) {
  const al = rs.filter((r) => r.status === 'aligned');
  const byBook = {}; for (const r of al) (byBook[r.book_id] ||= []).push(r.cer);
  const items = Object.values(byBook);
  const rng = makeRng(7503);
  const ci = bootstrapItems(items, (s) => med(s.flat()), rng, 2000);
  const over = al.filter((r) => r.cer > 0.1).length;
  return {
    pages: rs.length, text_pages: rs.filter((r) => r.status !== 'short').length, aligned: al.length,
    aligned_share_of_text_pages: r3(al.length / rs.filter((r) => r.status !== 'short').length),
    median_cer: r3(med(al.map((r) => r.cer))), median_cer_ci_by_book: ci.map(r3), mean_cer: r3(al.reduce((a, r) => a + r.cer, 0) / al.length),
    cer_gt_0_1: over, cer_gt_0_1_share: r3(over / al.length), cer_gt_0_1_wilson: wilson(over, al.length),
    cer_gt_0_25: al.filter((r) => r.cer > 0.25).length, cer_ge_0_5: al.filter((r) => r.cer >= 0.5).length,
    per_book: Object.entries(byBook).map(([k, v]) => ({ book_id: k, title: bookOf[k].title, n: v.length, median_cer: r3(med(v)), gt_0_1: v.filter((x) => x > 0.1).length })),
  };
}
// ── what Kanripo would change (dice ≥ 0.9) ──
function changeBlock(rs) {
  const hi = rs.filter((r) => r.status === 'aligned' && r.dice >= 0.9);
  const edits = hi.map((r) => r.edits + r.omitted);
  const pairs = new Map();
  for (const r of hi) for (const [o, k] of r.runs || []) { const key = `${o}→${k}`; pairs.set(key, (pairs.get(key) || 0) + 1); }
  const top = [...pairs].sort((a, b) => b[1] - a[1]).slice(0, 40);
  const single = [...pairs].filter(([k]) => [...k.split('→')[0]].length === 1 && [...k.split('→')[1]].length === 1);
  return { pages: hi.length, chars_kanripo: hi.reduce((a, r) => a + r.k_chars, 0), char_edits_total: edits.reduce((a, b) => a + b, 0),
    edits_per_page_median: med(edits), edits_per_100_chars: r3(100 * edits.reduce((a, b) => a + b, 0) / hi.reduce((a, r) => a + r.k_chars, 0)),
    pages_identical: edits.filter((e) => e === 0).length,
    single_char_substitutions: single.reduce((a, [, n]) => a + n, 0), distinct_single_char_pairs: single.length, top_runs_paddle_to_kanripo: top };
}
const flagCount = (rs) => { const m = {}; for (const r of rs) if (r.class) m[r.class] = (m[r.class] || 0) + 1; return m; };
const seqFlags = {}; for (const b of books) for (const f of b.flags || []) seqFlags[f.kind] = (seqFlags[f.kind] || 0) + 1;
const out = {
  all: { ...cerBlock(scope(false)), unaligned_by_class: flagCount(scope(false)), kanripo_change: changeBlock(scope(false)) },
  pilot: { ...cerBlock(scope(true)), unaligned_by_class: flagCount(scope(true)), kanripo_change: changeBlock(scope(true)) },
  sequence_flags: seqFlags,
  out_of_sequence_pages: rows.filter((r) => r.flag_out_of_sequence).length,
  same_leaf_pairs: books.reduce((a, b) => a + (b.flags || []).filter((f) => f.kind === 'same-leaf').length, 0),
  key_not_book_scoped: rows.filter((r) => r.key_scoped === false).length,
  screen_agreement: { agree: books.reduce((a, b) => a + (b.screen_agrees || 0), 0), compared: books.reduce((a, b) => a + (b.screen_compared || 0), 0) },
  unaligned_pages: rows.filter((r) => r.class).map((r) => ({ book_id: r.book_id, pn: r.pn, pilot: r.pilot, chars: r.chars, dice: r.dice ?? null, class: r.class })),
};
if (arg('qa')) {
  const qa = fs.readFileSync(arg('qa'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  out.qa_join = qa.map((q) => { const r = rows.find((x) => x.page_id === q.page_id || (x.book_id === q.book_id && x.pn === q.pn)); return { ...q, status: r?.status, class: r?.class ?? null, cer: r?.cer ?? null, dice: r?.dice ?? null }; });
}
fs.writeFileSync(path.join(IN, 'pages-classified.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(JSON.stringify(out, null, 1));
