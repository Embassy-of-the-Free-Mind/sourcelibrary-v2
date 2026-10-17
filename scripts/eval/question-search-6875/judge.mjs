// Question-shaped search (#6875), step 3: build the four arms' top 10 and have Opus (`claude -p`) grade every page in
// their union, blind to arm: one call per question, pages shuffled by a seeded hash, labelled P1…Pn.
//
//   A  search_translations as served (production /api/search, pages_only)
//   B  search_concept as served (production /api/search/semantic, page level)
//   C  Jev re-rank of the whole pool (~1,800 pages: deep keyword lane + semantic lane), top 10, at most 2 per book
//   D  Jev re-rank of the pool's first 300 (interleaved keyword/semantic ranks) plus A and B, top 10, at most 2 per book
//
// Grades: 2 = the page itself gives what was asked for; 1 = on the topic but not what was asked; 0 = not relevant.
// Writes <outdir>/arms.json and <outdir>/judge/<qid>.json (resumable). Claude only via `claude -p` (PR #6732).
//
// PRIOR ART: scripts/eval/cli-translate-check-6523/run.mjs (an Opus judge over `claude -p`); it judges translations
//   page by page, not a pooled, arm-blind relevance set.
//
//   node scripts/eval/question-search-6875/judge.mjs <pooldir> <jevdir> <outdir>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const [POOLS, JEV, OUT] = process.argv.slice(2);
const SMALL_POOL = 300;
const PER_BOOK = 2;
const CONC = Number(process.env.CONC || 3);
const CLAUDE = process.env.CLAUDE_BIN || '/root/.local/bin/claude';
fs.mkdirSync(path.join(OUT, 'judge'), { recursive: true });

const h = (s) => crypto.createHash('sha1').update(s).digest('hex');
function topK(scored, k = 10) {
  const out = []; const per = new Map();
  for (const r of scored) {
    const n = per.get(r.book_id) || 0;
    if (n >= PER_BOOK) continue;
    per.set(r.book_id, n + 1); out.push(r.key);
    if (out.length === k) break;
  }
  return out;
}

const arms = {};
for (const f of fs.readdirSync(POOLS).filter((f) => f.endsWith('.json')).sort()) {
  const P = JSON.parse(fs.readFileSync(path.join(POOLS, f), 'utf8'));
  const jf = path.join(JEV, `${P.id}.jsonl`);
  if (!fs.existsSync(jf)) continue;
  const jev = new Map(fs.readFileSync(jf, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.key, r]));
  const byKey = new Map(P.pool.map((p) => [p.key, p]));
  const scored = P.pool.filter((p) => jev.has(p.key)).map((p) => ({ ...p, jev: jev.get(p.key).jev }))
    .sort((a, b) => b.jev - a.jev || a.rank - b.rank);
  const k = (x) => `${x.book_id}:${x.page_number}`;
  arms[P.id] = {
    q: P.q,
    A: P.A.hits.map(k).filter((x) => byKey.has(x)),
    B: P.B.hits.map(k).filter((x) => byKey.has(x)),
    C: topK(scored),
    D: topK(scored.filter((p) => p.rank < SMALL_POOL || p.lanes.includes('A') || p.lanes.includes('B'))),
    scored_n: scored.length, pool_n: P.pool.length,
  };
}
fs.writeFileSync(path.join(OUT, 'arms.json'), JSON.stringify(arms, null, 1));
console.log('arms for', Object.keys(arms).length, 'questions');

const RUBRIC = `You are judging search results for a library of historical primary sources (alchemy, Hermetica, Kabbalah,
mysticism, early modern science and neighbouring traditions). A reader typed the request below. For EACH page, decide
whether the page itself gives the reader what they asked for.

2 = yes: the page contains a passage of the kind requested (it describes, instructs, argues or depicts the thing asked
    for). A reader would be glad this page came back.
1 = partly: on the same topic, or mentions the thing, but is not the kind of passage asked for (e.g. a passing mention,
    a table of contents, a modern editor's summary, the topic in general rather than the specific thing).
0 = no: not about what was asked, or only shares some words with the request.

Judge the page text only; it may be a translation or, for a few pages, the original language. Do not reward a page for
a famous title. Reply with JSON only, no prose: [{"id":"P1","grade":2,"why":"<at most 15 words>"}, ...] covering every page.`;

function claude(prompt) {
  return new Promise((resolve, reject) => {
    const p = spawn(CLAUDE, ['-p', '--model', 'opus', '--output-format', 'json'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`claude exit ${code}: ${err.slice(0, 300)}`))));
    p.stdin.end(prompt);
  });
}

async function judgeOne(id) {
  const file = path.join(OUT, 'judge', `${id}.json`);
  const P = JSON.parse(fs.readFileSync(path.join(POOLS, `${id}.json`), 'utf8'));
  const byKey = new Map(P.pool.map((p) => [p.key, p]));
  const a = arms[id];
  const keys = [...new Set([...a.A, ...a.B, ...a.C, ...a.D])].sort((x, y) => h(id + x).localeCompare(h(id + y)));
  // A judgement covers one union of pages; if the arms have changed since (a refreshed baseline), judge the new union.
  if (fs.existsSync(file) && keys.every((k) => k in JSON.parse(fs.readFileSync(file, 'utf8')).grades)) return;
  const label = new Map(keys.map((k, i) => [k, `P${i + 1}`]));
  const pages = keys.map((k) => { const p = byKey.get(k); return `=== ${label.get(k)} — ${p.title}${p.year ? ` (${p.year})` : ''}, p. ${p.page_number} ===\n${p.text}`; });
  const prompt = `${RUBRIC}\n\nREQUEST: "${a.q}"\n\n${pages.join('\n\n')}\n\nNow the JSON array for all ${keys.length} pages.`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const t = performance.now();
    try {
      const raw = JSON.parse(await claude(prompt));
      const txt = raw.result || '';
      const arr = JSON.parse(txt.slice(txt.indexOf('['), txt.lastIndexOf(']') + 1));
      const g = new Map(arr.map((x) => [x.id, x]));
      if (keys.some((k) => !g.has(label.get(k)))) throw new Error('missing grades');
      const grades = Object.fromEntries(keys.map((k) => [k, { label: label.get(k), grade: Number(g.get(label.get(k)).grade), why: g.get(label.get(k)).why }]));
      fs.writeFileSync(file, JSON.stringify({ id, q: a.q, n: keys.length, ms: Math.round(performance.now() - t), cost_usd_equiv: raw.total_cost_usd, grades }, null, 1));
      console.log(id, 'judged', keys.length);
      return;
    } catch (e) { console.error(id, 'attempt', attempt, e.message.slice(0, 200)); }
  }
}

const ids = Object.keys(arms);
let i = 0;
await Promise.all(Array.from({ length: CONC }, async () => { while (i < ids.length) await judgeOne(ids[i++]); }));
