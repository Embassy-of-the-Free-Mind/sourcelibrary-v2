#!/usr/bin/env node
/**
 * What do two passes over the SAME leaf actually disagree ABOUT? (#3473)
 *
 * Agreement is one number and it hides distinct failure classes. Two texts can
 * score identically low because one omitted a block, or because both read every
 * word and emitted them in a different ORDER. Those need different fixes, so
 * they need different names.
 *
 * The discriminator is cheap: compare BAG overlap (Jaccard on word multisets)
 * against SEQUENCE agreement (normalized Levenshtein). High bag + low sequence
 * means the same words came out in a different order — reading-order ambiguity,
 * not legibility. Low bag means content is present on one side and absent on the
 * other — an inclusion-policy difference or a genuine miss.
 *
 * Runs on the clean population only: same leaf, same model, same prompt, no
 * degenerate/refusal/commentary side. Free — Mongo reads, no model calls.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/disagreement-classes.mjs <corpus.jsonl> [--n=200]
 */
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { stripEditorialWrappers } from '../lib/strip-editorial-wrappers.mjs';

const argv = process.argv.slice(2);
const JSONL = argv.find(a => !a.startsWith('--'));
const N = parseInt((argv.find(a => a.startsWith('--n=')) || '--n=200').split('=')[1]);
const DATE = new Date().toISOString().slice(0, 10);
const SITE = 'https://sourcelibrary.org';

// Page FURNITURE removed with its content: a running header repeated on both
// sides inflates bag overlap and is not what either pass got wrong.
const FURNITURE = /<(header|sig|page-num|catchword)>[\s\S]*?<\/\1>/gi;
const words = t => stripEditorialWrappers(t || '').replace(FURNITURE, ' ')
  .replace(/<[^>]+>/g, ' ').toLowerCase().normalize('NFD')
  .replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 1);

function bagJaccard(A, B) {
  const ca = new Map(), cb = new Map();
  for (const w of A) ca.set(w, (ca.get(w) || 0) + 1);
  for (const w of B) cb.set(w, (cb.get(w) || 0) + 1);
  let inter = 0, uni = 0;
  for (const k of new Set([...ca.keys(), ...cb.keys()])) {
    const a = ca.get(k) || 0, b = cb.get(k) || 0;
    inter += Math.min(a, b); uni += Math.max(a, b);
  }
  return uni ? inter / uni : null;
}
function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, j) => j), cur = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

async function main() {
  const pool = [];
  const rl = readline.createInterface({ input: fs.createReadStream(JSONL) });
  for await (const line of rl) {
    const x = JSON.parse(line);
    if (x.eligibility !== 'eligible' || x.leaf_shift !== false) continue;
    if (!x.prior_model || x.prior_model !== x.current_model) continue;
    if (!x.prior_prompt || x.prior_prompt !== x.current_prompt) continue;
    if (x.prior_degenerate || x.current_degenerate || x.prior_refusal || x.current_refusal
      || x.prior_meta || x.current_meta || x.near_zero_overlap) continue;
    if (x.agreement_primary >= 0.85) continue;
    pool.push(x);
  }
  const stride = Math.max(1, Math.floor(pool.length / N));
  const sample = pool.filter((_, i) => i % stride === 0).slice(0, N);
  console.log(`unstable clean pool ${pool.length.toLocaleString()} → sampling ${sample.length}`);

  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  const rows = [];
  let multi = 0;
  for (let i = 0; i < sample.length; i += 200) {
    const chunk = sample.slice(i, i + 200);
    const ids = chunk.map(r => r.page_id);
    const [pages, revs] = await Promise.all([
      db.collection('pages').find({ id: { $in: ids } }, { projection: { id: 1, 'ocr.data': 1 } }).maxTimeMS(120000).toArray(),
      db.collection('page_revisions').find({ page_id: { $in: ids }, field: 'ocr' }, { projection: { page_id: 1, data: 1, created_at: 1 } }).maxTimeMS(120000).toArray(),
    ]);
    const pm = new Map(pages.map(p => [p.id, p.ocr?.data || '']));
    // ONLY pages with exactly one stored revision. A page with a longer chain
    // has several consecutive transitions and picking an arbitrary revision
    // compares non-adjacent passes -- which produced rows reading stored
    // agreement 0.80 against recomputed 0.005 before this restriction. With one
    // revision the pair is unambiguous: prior = that revision, current = live.
    const count = new Map();
    for (const r of revs) count.set(r.page_id, (count.get(r.page_id) || 0) + 1);
    const rm = new Map();
    for (const r of revs) if (count.get(r.page_id) === 1) rm.set(r.page_id, r.data);
    multi += [...count.values()].filter(v => v > 1).length;
    for (const x of chunk) {
      const cur = pm.get(x.page_id), pri = rm.get(x.page_id);
      if (!cur || !pri) continue;                 // skips multi-revision pages
      if (x.is_live !== true) continue;           // current side must be pages.ocr
      const A = words(pri), B = words(cur);
      if (A.length < 30 || B.length < 30) continue;
      const bag = bagJaccard(A, B);
      const seq = 1 - lev(A.slice(0, 700), B.slice(0, 700)) / Math.max(A.slice(0, 700).length, B.slice(0, 700).length);
      rows.push({ ...x, bag, seq, wa: A.length, wb: B.length, gap: bag - seq });
    }
  }
  await c.close();

  // Classes. Order matters: a length-imbalanced pair is an omission whatever its
  // bag score, so that test comes first.
  const cls = r => {
    const ratio = Math.min(r.wa, r.wb) / Math.max(r.wa, r.wb);
    if (ratio < 0.7) return 'omission — one side has substantially more text';
    if (r.bag >= 0.6 && r.gap >= 0.2) return 'REORDERING — same words, different sequence';
    if (r.bag >= 0.6) return 'local substitution — same words, same order, glyph-level differences';
    if (r.bag < 0.3) return 'divergent content — the two passes share few words';
    return 'mixed — partial overlap, no dominant mode';
  };
  const tally = {};
  for (const r of rows) { const k = cls(r); (tally[k] ||= []).push(r); }
  // GUARD: recomputed sequence agreement must track the corpus's stored number.
  // If it does not, the pair being compared is not the pair the corpus scored,
  // and every class below is meaningless. This check is what caught the
  // multi-revision bug; it stays so the next mispairing is loud.
  const diffs = rows.map(r => Math.abs(r.seq - r.agreement_primary));
  const bad = diffs.filter(d => d > 0.25).length;
  console.log(`\nPAIRING GUARD: mean |recomputed seq - stored agreement| = ${(diffs.reduce((a, b) => a + b, 0) / diffs.length).toFixed(3)}; ${bad}/${rows.length} exceed 0.25`);
  if (bad / rows.length > 0.1) console.log('  ** WARNING: pairing is suspect; do not read the classes below **');
  console.log(`  ${multi} sampled pages skipped for having more than one stored revision`);
  console.log(`\nclassified ${rows.length} unstable same-leaf pairs\n`);
  console.log('| class | n | share | median agr | median bag | median seq |');
  console.log('|---|---:|---:|---:|---:|---:|');
  const med = (a, f) => { const s = a.map(f).sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const out = [];
  for (const [k, v] of Object.entries(tally).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`| ${k} | ${v.length} | ${(100 * v.length / rows.length).toFixed(1)}% | ${med(v, r => r.agreement_primary).toFixed(2)} | ${med(v, r => r.bag).toFixed(2)} | ${med(v, r => r.seq).toFixed(2)} |`);
    out.push({ class: k, n: v.length, share: +(100 * v.length / rows.length).toFixed(1),
      median_agreement: +med(v, r => r.agreement_primary).toFixed(3), median_bag: +med(v, r => r.bag).toFixed(3), median_seq: +med(v, r => r.seq).toFixed(3),
      examples: v.slice(0, 4).map(r => ({ book: r.book_slug, language: r.language, page_number: r.page_number,
        agreement: r.agreement_primary, bag: +r.bag.toFixed(3), seq: +r.seq.toFixed(3), words: [r.wa, r.wb],
        reader_url: r.book_slug ? `${SITE}/book/${r.book_slug}/page/${r.page_id}` : null })) });
  }
  const dir = path.join('scripts', 'eval', 'results');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `disagreement-classes-${DATE}.json`), JSON.stringify({ date: DATE, sampled: rows.length, pool: pool.length, classes: out }, null, 1));
  console.log(`\n→ scripts/eval/results/disagreement-classes-${DATE}.json`);
}
main().catch(e => { console.error(e); process.exit(1); });
