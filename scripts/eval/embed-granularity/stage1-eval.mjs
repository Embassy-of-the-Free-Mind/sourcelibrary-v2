#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/embed-granularity/run-arms.mjs + score.mjs — the pilot's
 * arms and measures over a 12K-page local pool. Stage 1 (#6173) is the same
 * 25 queries over the ~1,200 books / ~345K pages that now hold a concept
 * abstract, so the page lane is ranked in Supabase (exact, inside the stage-1
 * book set) and the concept lane from the stage-1 vectors on disk; the pilot's
 * judgments are keyed by its own pool rows and cannot be reused, so every
 * non-gold top-10 page is judged again (pack / judgments).
 *
 *   node --env-file=.env.production.local scripts/eval/embed-granularity/stage1-eval.mjs <cmd> --dir D --lane-dir L
 *     queries     embed the 25 gold queries (production request) → D/queries.json
 *     page-dump   read the stage-1 books' page_translations vectors once → D/page-vecs.*
 *     page-lane   top 100 per query, exact, over those vectors → D/page-lane.json
 *     concept-lane top 100 per query from L/vectors (the stage-1 abstracts) → D/concept-lane.json
 *     arms        a, c, a_quota, c_quota, ac_rrf top-10s → D/rankings.json
 *     pack        D/judge-pack-*.json: every non-gold top-10 page, arm and rank hidden, shuffled
 *     score       relevant = gold passage or grade 2; measures and paired CIs as the pilot
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withMongo } from '../../lib/mongo.mjs';
import { pageEmbeddingInput } from '../../lib/page-embedding-text.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { arg, embedAll, normalise, DIMS } from './lib.mjs';

const CMD = process.argv[2];
const DIR = arg('--dir');
const LANE = arg('--lane-dir', '/mnt/HC_Volume_105839809/embed-next-6173/concept');
const here = path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(DIR, { recursive: true });
const gold = JSON.parse(fs.readFileSync(path.join(here, 'gold.json'), 'utf8')).queries;
const books = JSON.parse(fs.readFileSync(path.join(LANE, 'books.json'), 'utf8'));
const shelf = new Map(books.map((b) => [b.book_id, b.tradition]));
const J = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const W = (f, x) => fs.writeFileSync(path.join(DIR, f), JSON.stringify(x, null, 1));
const key = (b, p) => `${b}:${p}`;

if (CMD === 'queries') {
  const { vecs } = await embedAll(gold.map((q) => q.query), { label: 'q' });
  W('queries.json', Object.fromEntries(gold.map((q, k) => [q.qid, Array.from(vecs.subarray(k * DIMS, (k + 1) * DIMS))])));
  console.log('queries embedded');
}

if (CMD === 'page-dump') {
  // Read the stage-1 books' page vectors ONCE (one pass over ~1,200 books), so the
  // 25 queries rank locally instead of scanning the shared table 25 times.
  const { default: pg } = await import('pg');
  const c = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query('SET statement_timeout = 300000');
  const ids = books.map((b) => b.book_id);
  const doneFile = path.join(DIR, 'page-dump.done.json');
  const done = new Set(fs.existsSync(doneFile) ? JSON.parse(fs.readFileSync(doneFile, 'utf8')) : []);
  const fd = fs.openSync(path.join(DIR, 'page-vecs.f32'), 'a');
  const meta = fs.createWriteStream(path.join(DIR, 'page-vecs.jsonl'), { flags: 'a' });
  for (let k = 0; k < ids.length; k += 10) {
    const chunk = ids.slice(k, k + 10).filter((x) => !done.has(x));
    if (!chunk.length) continue;
    const r = await c.query('SELECT page_id, book_id, page_number, embedding::text AS e FROM page_translations WHERE book_id = ANY($1) AND embedding IS NOT NULL', [chunk]);
    const buf = Buffer.alloc(r.rows.length * DIMS * 4);
    r.rows.forEach((row, n) => { const v = normalise(JSON.parse(row.e)); Buffer.from(v.buffer).copy(buf, n * DIMS * 4); });
    fs.writeSync(fd, buf);
    for (const row of r.rows) meta.write(JSON.stringify({ page_id: row.page_id, book_id: row.book_id, page_number: row.page_number }) + '\n');
    chunk.forEach((x) => done.add(x));
    fs.writeFileSync(doneFile, JSON.stringify([...done]));
    if (k % 100 === 0) console.log(`  ${done.size}/${ids.length} books`);
  }
  await new Promise((r) => meta.end(r)); fs.closeSync(fd); await c.end();
  console.log('page vectors dumped');
}

if (CMD === 'page-lane') {
  const Q = J('queries.json');
  const meta = fs.readFileSync(path.join(DIR, 'page-vecs.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const b = fs.readFileSync(path.join(DIR, 'page-vecs.f32'));
  const M = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  if (M.length !== meta.length * DIMS) throw new Error(`vector file ${M.length / DIMS} rows, meta ${meta.length}`);
  console.log(`${meta.length} page vectors over ${new Set(meta.map((m) => m.book_id)).size} books`);
  const out = {};
  for (const q of gold) {
    const qv = normalise(Q[q.qid]);
    const sc = new Float32Array(meta.length);
    for (let i = 0; i < meta.length; i++) { let s = 0; const off = i * DIMS; for (let d = 0; d < DIMS; d++) s += M[off + d] * qv[d]; sc[i] = s; }
    const order = [...sc.keys()].sort((x, y) => sc[y] - sc[x]).slice(0, 100);
    out[q.qid] = order.map((i) => ({ ...meta[i], sim: +sc[i].toFixed(5) }));
  }
  W('page-lane.json', out);
}

if (CMD === 'concept-lane') {
  const Q = J('queries.json');
  const meta = new Map();
  for (const l of fs.readFileSync(path.join(LANE, 'abstracts.jsonl'), 'utf8').split('\n')) if (l) { const r = JSON.parse(l); meta.set(r.page_id, r); }
  const vdir = path.join(LANE, 'vectors');
  const ids = []; const mats = [];
  for (const f of fs.readdirSync(vdir).filter((x) => x.endsWith('.ids.json')).sort()) {
    const id = JSON.parse(fs.readFileSync(path.join(vdir, f), 'utf8'));
    const b = fs.readFileSync(path.join(vdir, f.replace('.ids.json', '.f32')));
    ids.push(...id); mats.push(new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4));
  }
  const M = new Float32Array(ids.length * DIMS); let o = 0; for (const m of mats) { M.set(m, o); o += m.length; }
  // One vector per page: the last one written for its current abstract.
  const latest = new Map(); ids.forEach((x, k) => { if (meta.get(x.page_id)?.content_hash === x.content_hash) latest.set(x.page_id, k); });
  const rows = [...latest.entries()];
  console.log(`${rows.length} concept vectors over ${new Set(rows.map(([p]) => meta.get(p).book_id)).size} books`);
  const out = {};
  for (const q of gold) {
    const qv = normalise(Q[q.qid]);
    const sc = rows.map(([p, k]) => { let s = 0; const off = k * DIMS; for (let d = 0; d < DIMS; d++) s += M[off + d] * qv[d]; return [p, s]; });
    sc.sort((x, y) => y[1] - x[1]);
    out[q.qid] = sc.slice(0, 100).map(([p, s]) => ({ page_id: p, book_id: meta.get(p).book_id, page_number: meta.get(p).page_number, sim: +s.toFixed(5) }));
  }
  W('concept-lane.json', out);
  W('concept-lane-meta.json', { vectors: rows.length, books: new Set(rows.map(([p]) => meta.get(p).book_id)).size });
}

/** At most `cap` per tradition (shelf label), in rank order (the pilot's quota). */
const quota = (list, cap = 2) => { const n = {}; return list.filter((r) => { const t = shelf.get(r.book_id) || 'other'; n[t] = (n[t] || 0) + 1; return n[t] <= cap; }); };
/** Reciprocal-rank fusion, k = 60. */
const rrf = (a, b) => {
  const s = new Map(); const byId = new Map();
  for (const l of [a, b]) l.forEach((r, k) => { s.set(r.page_id, (s.get(r.page_id) || 0) + 1 / (60 + k + 1)); byId.set(r.page_id, r); });
  return [...s.entries()].sort((x, y) => y[1] - x[1]).map(([p]) => byId.get(p));
};

if (CMD === 'arms') {
  const A = J('page-lane.json'); const C = J('concept-lane.json');
  const out = {};
  for (const q of gold) out[q.qid] = { a: A[q.qid].slice(0, 10), c: C[q.qid].slice(0, 10), a_quota: quota(A[q.qid]).slice(0, 10), c_quota: quota(C[q.qid]).slice(0, 10), ac_rrf: rrf(A[q.qid], C[q.qid]).slice(0, 10) };
  W('rankings.json', out);
  const overlap = gold.map((q) => out[q.qid].a.filter((r) => out[q.qid].c.some((x) => x.page_id === r.page_id)).length);
  console.log(`a ∩ c in top 10: mean ${(overlap.reduce((s, x) => s + x, 0) / overlap.length).toFixed(2)}`);
}

if (CMD === 'pack') {
  const R = J('rankings.json');
  const goldKeys = new Map(gold.map((q) => [q.qid, new Set(q.passages.map((p) => key(p.book_id, p.page_number)))]));
  const items = [];
  for (const q of gold) {
    const seen = new Set();
    for (const list of Object.values(R[q.qid])) for (const r of list) {
      const k = key(r.book_id, r.page_number);
      if (goldKeys.get(q.qid).has(k) || seen.has(k)) continue;
      seen.add(k); items.push({ qid: q.qid, query: q.query, page_id: r.page_id, book_id: r.book_id, page_number: r.page_number });
    }
  }
  await withMongo(async (db) => {
    for (let k = 0; k < items.length; k += 200) {
      const chunk = items.slice(k, k + 200);
      const pages = await db.collection('pages').find({ id: { $in: chunk.map((x) => x.page_id) } }).project({ id: 1, 'translation.data': 1, 'ocr.data': 1 }).toArray();
      const byId = new Map(pages.map((p) => [String(p.id), p]));
      const bk = await db.collection('books').find({ id: { $in: [...new Set(chunk.map((x) => x.book_id))] } }).project({ id: 1, title: 1, display_title: 1, author: 1 }).toArray();
      const bm = new Map(bk.map((b) => [b.id, b]));
      for (const x of chunk) {
        x.text = (pageEmbeddingInput(byId.get(x.page_id) || {})?.text || '').slice(0, 4000);
        const b = bm.get(x.book_id) || {};
        x.book = `${b.display_title || b.title || ''} — ${b.author || ''}`.slice(0, 200);
        x.shelf = shelf.get(x.book_id) || 'other';
      }
    }
  });
  const rng = makeRng(61731);
  for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
  // Group by query inside each pack so a judge reads one concept at a time.
  const byQ = {}; for (const x of items) (byQ[x.qid] ||= []).push(x);
  const qids = Object.keys(byQ).sort();
  const packs = [[], [], [], []];
  qids.forEach((q, k) => packs[k % 4].push(...byQ[q]));
  packs.forEach((p, k) => W(`judge-pack-${k}.json`, p.map((x, n) => ({ n, ...x }))));
  console.log(`${items.length} pages to judge in 4 packs: ${packs.map((p) => p.length).join(', ')}`);
}

if (CMD === 'score') {
  const R = J('rankings.json');
  const judged = {};
  for (const f of fs.readdirSync(DIR).filter((x) => /^judged-\d+\.json$/.test(x))) for (const j of J(f)) judged[`${j.qid}|${key(j.book_id, j.page_number)}`] = j;
  const arms = Object.keys(R[gold[0].qid]);
  const M = ['rel_trad@10', 'P@10', 'gold_trad@10', 'trad@10', 'books@10'];
  const per = Object.fromEntries(arms.map((a) => [a, Object.fromEntries(M.map((m) => [m, []]))]));
  let unjudged = 0; const detail = {};
  for (const q of gold) {
    const g = new Map(q.passages.map((p) => [key(p.book_id, p.page_number), p.tradition]));
    detail[q.qid] = {};
    for (const a of arms) {
      const top = R[q.qid][a].slice(0, 10);
      const relT = new Set(); let rel = 0; const goldT = new Set();
      const rows = top.map((r) => {
        const k = key(r.book_id, r.page_number);
        let grade = null; let t = null;
        if (g.has(k)) { grade = 'gold'; t = g.get(k); goldT.add(t); } else if (judged[`${q.qid}|${k}`]) { const j = judged[`${q.qid}|${k}`]; grade = j.grade; if (grade === 2) t = j.tradition || shelf.get(r.book_id); } else unjudged++;
        if (t) { rel++; if (t !== 'other') relT.add(t); }
        return { ...r, grade, t: t || shelf.get(r.book_id) };
      });
      per[a]['rel_trad@10'].push(relT.size); per[a]['P@10'].push(rel / 10);
      per[a]['gold_trad@10'].push(goldT.size / q.traditions.length);
      per[a]['trad@10'].push(new Set(top.map((r) => shelf.get(r.book_id)).filter((t) => t && t !== 'other')).size);
      per[a]['books@10'].push(new Set(top.map((r) => r.book_id)).size);
      detail[q.qid][a] = rows;
    }
  }
  const mean = (x) => x.reduce((s, v) => s + v, 0) / x.length;
  const rng = makeRng(6173);
  const ci = (x, y) => { const d = x.map((v, k) => v - y[k]); const B = []; for (let b = 0; b < 10000; b++) { let s = 0; for (let k = 0; k < d.length; k++) s += d[Math.floor(rng() * d.length)]; B.push(s / d.length); } B.sort((p, q) => p - q); return { diff: mean(d), lo: B[250], hi: B[9750], wins: d.filter((v) => v > 0).length, losses: d.filter((v) => v < 0).length }; };
  console.log(`unjudged top-10 slots: ${unjudged}`);
  console.log(`| arm | ${M.join(' | ')} | queries with ≤1 relevant tradition |\n|---|${M.map(() => '---').join('|')}|---|`);
  for (const a of arms) console.log(`| ${a} | ${M.map((m) => mean(per[a][m]).toFixed(2)).join(' | ')} | ${per[a]['rel_trad@10'].filter((v) => v <= 1).length} |`);
  const cmp = [];
  console.log('\n| pair | measure | diff | 95% CI | better/worse |\n|---|---|---|---|---|');
  for (const [x, y] of [['c', 'a'], ['c_quota', 'a'], ['c_quota', 'c'], ['a_quota', 'a'], ['ac_rrf', 'a'], ['c', 'a_quota']]) for (const m of ['rel_trad@10', 'P@10', 'gold_trad@10']) {
    const r = ci(per[x][m], per[y][m]); cmp.push({ x, y, measure: m, ...r });
    console.log(`| ${x} − ${y} | ${m} | ${r.diff >= 0 ? '+' : ''}${r.diff.toFixed(2)} | [${r.lo.toFixed(2)}, ${r.hi.toFixed(2)}] | ${r.wins}/${r.losses} |`);
  }
  const TR = ['greek-roman', 'christian', 'hermetic-esoteric', 'jewish-kabbalistic', 'islamic-sufi', 'hindu-indic', 'buddhist', 'chinese-daoist-confucian'];
  console.log(`\n| arm | ${TR.join(' | ')} |\n|---|${TR.map(() => '---').join('|')}|`);
  const byT = {};
  for (const a of arms) { byT[a] = Object.fromEntries(TR.map((t) => [t, gold.filter((q) => detail[q.qid][a].some((r) => (r.grade === 'gold' || r.grade === 2) && r.t === t)).length])); console.log(`| ${a} | ${TR.map((t) => byT[a][t]).join(' | ')} |`); }
  const outFile = arg('--json');
  const res = { arms, means: Object.fromEntries(arms.map((a) => [a, Object.fromEntries(M.map((m) => [m, +mean(per[a][m]).toFixed(4)]))])), comparisons: cmp, by_tradition: byT, per_query: Object.fromEntries(gold.map((q, k) => [q.qid, Object.fromEntries(arms.map((a) => [a, Object.fromEntries(M.map((m) => [m, per[a][m][k]]))]))])), top10: detail, unjudged };
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(res));
}
