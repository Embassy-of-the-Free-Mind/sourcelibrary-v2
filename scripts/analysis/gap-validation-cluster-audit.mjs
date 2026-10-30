#!/usr/bin/env node
/**
 * Clustering audit for the n=1000 translation-gap sample (#7778 change 2a).
 *
 * `work_cluster_id` is our own grouping (surname + the first six title words,
 * scripts/catalog-coverage/build.mjs), so the 366,205 denominator is only as good as it is.
 * For every sampled cluster this asks two questions:
 *   OVER-MERGE — do the cluster's member editions hold more than one distinct work?
 *   SPLIT      — are other clusters the same work (title variants that start differently)?
 * Candidates for a split: clusters under the same author key, ranked by rare title words
 * shared with this cluster's titles (IDF over the 366K cluster titles), plus clusters the
 * phase-11 work graph (#7751) already puts in the same work. Splits across author-name
 * forms (Ciceron / Cicero) are NOT searched, so the split rate is a floor.
 *
 * Judge: one `claude -p --model sonnet` call per cluster, no tools, titles only (the
 * subscription; same lean flags as gap-validation-cli-adjudicate.mjs). It sees no stratum
 * and no translation verdict.
 *
 * PRIOR ART: scripts/translation-layer/11-work-graph.mjs — builds a whole work graph and was
 * spot-checked by hand at n=40 (7/40 over-merged); used here as a candidate source, not as
 * the answer. scripts/analysis/gap-validation-cli-adjudicate.mjs — the runner pattern.
 *
 * Reads:  eval-data/gap-validation-n250-frame.json; --editions <ustc-latin-editions.jsonl>
 *         (phase 11 input, one row per USTC edition); optional --work-graph <work-graph.jsonl>
 * Writes: eval-data/gap-validation-cluster-audit.jsonl (one row per cluster; resumable)
 * Usage:  node scripts/analysis/gap-validation-cluster-audit.mjs --editions F [--work-graph F] [--concurrency 4] [--limit N]
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { distinctiveTokens, deaccent } from '../translation-layer/lib.mjs';
import { callGemini } from '../lib/gemini-script-client.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const EVAL = path.join(__dir, 'eval-data');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const EDITIONS = arg('editions');
const WORK_GRAPH = arg('work-graph');
const CONC = Number(arg('concurrency', 4));
const LIMIT = Number(arg('limit', 1e9));
// --judge sonnet (claude -p, the subscription) | flash-lite (gemini-3.1-flash-lite, paid API, through
// gemini-script-client so thinking is off and usage is logged). On 2026-10-30 the Sonnet run stopped at
// 131 clusters when the box's Claude account hit its weekly pace guard; flash-lite judged all 1000.
const JUDGE = arg('judge', 'sonnet');
const OUT = path.join(EVAL, JUDGE === 'sonnet' ? 'gap-validation-cluster-audit.jsonl' : `gap-validation-cluster-audit-${JUDGE}.jsonl`);
const MAX_MEMBERS = 15, MAX_CANDS = 30;
if (!EDITIONS) { console.error('--editions <ustc-latin-editions.jsonl> is required'); process.exit(2); }

const frame = JSON.parse(fs.readFileSync(path.join(EVAL, 'gap-validation-n250-frame.json'), 'utf8')).works;
const norm = (t) => deaccent(t || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const prefix = (cid) => String(cid).split('::')[0];

async function readJsonl(f, onRow) {
  const rl = readline.createInterface({ input: fs.createReadStream(f), crlfDelay: Infinity });
  for await (const l of rl) if (l.trim()) onRow(JSON.parse(l));
}

// --- clusters: members, titles, author key ---
const byCid = new Map();          // cid -> { titles: Map(normTitle -> {title,n,years}), n, sns: [] }
const cidOfSn = new Map();
await readJsonl(EDITIONS, (e) => {
  if (!e.work_cluster_id) return;          // 1 edition with no cluster id
  let c = byCid.get(e.work_cluster_id);
  if (!c) { c = { titles: new Map(), n: 0, sns: [], author: e.author_1 || '' }; byCid.set(e.work_cluster_id, c); }
  c.n++; c.sns.push(e.sn); cidOfSn.set(e.sn, e.work_cluster_id);
  const k = norm(e.title).slice(0, 160);
  const t = c.titles.get(k) || { title: (e.title || '').slice(0, 220), n: 0, years: [] };
  t.n++; if (e.year) t.years.push(e.year); c.titles.set(k, t);
});
console.log(`clusters ${byCid.size.toLocaleString()} from ${EDITIONS}`);

// IDF over one representative title per cluster
const df = new Map();
const repr = (c) => (c.repr ??= [...c.titles.values()].sort((a, b) => b.n - a.n)[0].title);
const reprTok = (c) => (c.tok ??= new Set(distinctiveTokens(repr(c))));
for (const c of byCid.values()) for (const t of reprTok(c)) df.set(t, (df.get(t) || 0) + 1);
const N = byCid.size;
const idf = (t) => Math.log(N / (df.get(t) || 1));
const byPrefix = new Map();
for (const cid of byCid.keys()) { const p = prefix(cid); if (!byPrefix.has(p)) byPrefix.set(p, []); byPrefix.get(p).push(cid); }

// optional: phase-11 work graph, edition sn -> work id
const workOfSn = new Map(), snsOfWork = new Map();
if (WORK_GRAPH && fs.existsSync(WORK_GRAPH)) {
  await readJsonl(WORK_GRAPH, (w) => { snsOfWork.set(w.work, w.ustc_sns || []); for (const sn of w.ustc_sns || []) workOfSn.set(sn, w.work); });
  console.log(`work graph: ${snsOfWork.size.toLocaleString()} works`);
}

function packet(w) {
  const c = byCid.get(w.work_cluster_id);
  const members = [...c.titles.values()].sort((a, b) => b.n - a.n).slice(0, MAX_MEMBERS)
    .map((t) => ({ title: t.title, editions: t.n, years: t.years.length ? `${Math.min(...t.years)}–${Math.max(...t.years)}` : '' }));
  const myTok = new Set(members.flatMap((m) => distinctiveTokens(m.title)));
  const scored = [];
  for (const cid of byPrefix.get(prefix(w.work_cluster_id)) || []) {
    if (cid === w.work_cluster_id) continue;
    const o = byCid.get(cid);
    const tok = reprTok(o);
    let s = 0; for (const t of tok) if (myTok.has(t)) s += idf(t);
    if (s > 0) scored.push({ cid, s });
  }
  scored.sort((a, b) => b.s - a.s);
  const graphCids = new Set();
  for (const sn of c.sns) { const wk = workOfSn.get(sn); if (wk == null) continue; for (const s2 of snsOfWork.get(wk) || []) { const c2 = cidOfSn.get(s2); if (c2 && c2 !== w.work_cluster_id) graphCids.add(c2); } }
  const pick = [...new Set([...[...graphCids].slice(0, 8), ...scored.slice(0, MAX_CANDS).map((x) => x.cid)])].slice(0, MAX_CANDS + 8);
  const candidates = pick.map((cid, i) => { const o = byCid.get(cid); return { id: `C${i + 1}`, cid, title: repr(o), editions: o.n, in_work_graph: graphCids.has(cid) }; });
  return { key: w.key, cid: w.work_cluster_id, author: w.author, n_editions: c.n, n_distinct_titles: c.titles.size, members, candidates, n_scored: scored.length, n_graph: graphCids.size, same_prefix_clusters: (byPrefix.get(prefix(w.work_cluster_id)) || []).length };
}

const prompt = (p) => `You are checking a bibliographic grouping of early-modern printed Latin editions (USTC). Editions were grouped by author + the first six words of the title, which can wrongly MERGE different works and wrongly SPLIT one work.

AUTHOR: ${p.author || 'unknown'}

GROUP (its member editions; distinct titles with edition counts):
${p.members.map((m, i) => `M${i + 1}. [${m.editions} ed., ${m.years}] ${m.title}`).join('\n')}

OTHER GROUPS by the same author key (one title each):
${p.candidates.length ? p.candidates.map((c) => `${c.id}. [${c.editions} ed.] ${c.title}`).join('\n') : '(none)'}

Questions. A "work" is one text: different editions, printings, title-page wordings, added prefaces/commentary or a corrected text of the same text are the SAME work. A translation of it into another language is the same work. A selection, an anthology containing it, a commentary ON it by someone else, or a different text by the same author is a DIFFERENT work.
1. How many distinct works do the GROUP's members hold? List the members that are a different work from M1.
2. Which OTHER GROUPS are the same work as the group's main work (M1)? Only list ones you are confident about from the titles.

Reply with ONE JSON object and nothing else:
{"member_works": <integer >= 1>, "other_work_members": ["M2", ...], "same_work_groups": ["C1", ...], "confidence": "high|medium|low", "note": "<one sentence>"}`;

function parse(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  for (const t of [text.slice(a, b + 1), text.slice(a, b) + '"}']) { try { const o = JSON.parse(t); if (o.member_works != null) return o; } catch { /* next */ } }
  return null;
}
function finish(p, row, text) {
  const v = parse(String(text || ''));
  row.raw = text;
  if (!v) { row.fail = 'no JSON in reply'; return row; }
  const ids = new Set(p.candidates.map((c) => c.id));
  row.member_works = Math.max(1, Number(v.member_works) || 1);
  row.other_work_members = v.other_work_members || [];
  row.same_work_groups = (v.same_work_groups || []).filter((id) => ids.has(id)).map((id) => { const c = p.candidates.find((x) => x.id === id); return { id, cid: c.cid, editions: c.editions, in_work_graph: c.in_work_graph }; });
  row.confidence = v.confidence; row.note = v.note;
  return row;
}
const baseRow = (p) => ({ key: p.key, cid: p.cid, judge: JUDGE, n_editions: p.n_editions, n_distinct_titles: p.n_distinct_titles, n_candidates: p.candidates.length, n_scored: p.n_scored, n_graph: p.n_graph, same_prefix_clusters: p.same_prefix_clusters, date: new Date().toISOString() });
async function runGemini(p) {
  const t0 = Date.now(), row = baseRow(p);
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await callGemini({ model: 'gemini-3.1-flash-lite', prompt: prompt(p), endpoint: 'scripts/analysis/gap-validation-cluster-audit.mjs', type: 'analysis', maxOutputTokens: 1500, promptVersion: 'cluster-audit-7778-v1' });
      row.usage = { in: r.inputTokens, out: r.outputTokens };
      delete row.fail; finish(p, row, r.text); if (!row.fail) break;
    } catch (e) { row.fail = String(e.message || e).slice(0, 200); await new Promise((res) => setTimeout(res, 3000 * attempt)); }
  }
  row.wall_s = Math.round((Date.now() - t0) / 1000);
  fs.appendFileSync(OUT, JSON.stringify(row) + '\n');
  return row;
}
function runOne(p) {
  if (JUDGE !== 'sonnet') return runGemini(p);
  return new Promise((resolve) => {
    const t0 = Date.now();
    const cp = spawn('claude', ['-p', prompt(p), '--model', 'sonnet', '--strict-mcp-config', '--setting-sources', 'local',
      '--disable-slash-commands', '--no-session-persistence', '--tools', '', '--system-prompt', 'You are a careful bibliographer. Answer exactly in the requested JSON.',
      '--output-format', 'json'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    cp.stdout.on('data', (d) => { out += d; }); cp.stderr.on('data', (d) => { err += d; });
    const kill = setTimeout(() => cp.kill('SIGTERM'), 5 * 60 * 1000);
    cp.on('close', (code) => {
      clearTimeout(kill);
      const row = { ...baseRow(p), wall_s: Math.round((Date.now() - t0) / 1000) };
      try { finish(p, row, JSON.parse(out).result); } catch { row.fail = `exit ${code}: ${(err || out).slice(0, 200)}`; }
      fs.appendFileSync(OUT, JSON.stringify(row) + '\n');
      resolve(row);
    });
  });
}

const done = new Set();
if (fs.existsSync(OUT)) for (const l of fs.readFileSync(OUT, 'utf8').split('\n')) if (l.trim()) { try { const r = JSON.parse(l); if (!r.fail) done.add(r.key); } catch { /* skip */ } }
const todo = frame.filter((w) => !done.has(w.key)).slice(0, LIMIT).map(packet);
console.log(`${frame.length} clusters; ${done.size} done; ${todo.length} to run; concurrency ${CONC}`);
let i = 0, n = 0;
async function worker() {
  while (i < todo.length) {
    const r = await runOne(todo[i++]); n++;
    console.log(`${new Date().toISOString().slice(11, 19)} ${n}/${todo.length} ${r.key} works=${r.member_works ?? '-'} same=${r.same_work_groups?.length ?? '-'}/${r.n_candidates} ${r.wall_s}s${r.fail ? ' FAIL ' + r.fail.slice(0, 100) : ''}`);
    if (r.fail && /limit|quota|rate|hit your/i.test(r.fail)) { console.log('usage limit reached; stopping (resume later)'); process.exit(3); }
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
