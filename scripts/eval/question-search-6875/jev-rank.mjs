// Question-shaped search (#6875), step 2: Jev scores every page in each question's pool against the question.
// One call per page, two wordings in it (asks for / does not), score = (w1 + 1 - w2) / 2 as in the animism ranker.
// Appends one row per page to <outdir>/<qid>.jsonl, so a rerun resumes. Stops at CAP_USD (default 4.5).
//
// PRIOR ART: scripts/analysis/experience-map/classify/jev-animism.py — same gateway call and two-wording score; it reads
//   one fixed rubric over a page file, not a per-question rubric over a pool, and is Python with a token file argument.
//
//   GW_ENV=<file with VERCEL_OIDC_TOKEN> node scripts/eval/question-search-6875/jev-rank.mjs <pooldir> <outdir> [qid…]
import fs from 'node:fs';
import path from 'node:path';

const [POOLS, OUT, ...ONLY] = process.argv.slice(2);
const CAP = Number(process.env.CAP_USD || 4.5);
const CONC = Number(process.env.CONC || 48);
const TOK = fs.readFileSync(process.env.GW_ENV, 'utf8').split('\n').find((l) => l.startsWith('VERCEL_OIDC_TOKEN')).split('=').slice(1).join('=').replace(/"/g, '').trim();
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let spent = 0;
for (const f of fs.readdirSync(OUT).filter((f) => f.endsWith('.jsonl') && f !== 'walls.jsonl')) {
  for (const l of fs.readFileSync(path.join(OUT, f), 'utf8').split('\n')) if (l) try { spent += JSON.parse(l).cost || 0; } catch {}
}

export const wordings = (q) => ({
  w1: { type: 'noul', instructions: `A reader searching a library of old books asked for: "${q}". This page contains such a passage: the page itself presents what the reader asked for, not merely the same words or a passing mention of the topic.` },
  w2: { type: 'noul', instructions: `This page contains nothing a reader asking for "${q}" wants: at most it shares some words with the request or touches the topic in passing.` },
});

async function ask(state, questions) {
  for (let i = 0; i < 5; i++) {
    const t = performance.now();
    try {
      const r = await fetch('https://ai-gateway.vercel.sh/typesafe/v1/systemone', {
        method: 'POST', signal: AbortSignal.timeout(60000),
        headers: { Authorization: 'Bearer ' + TOK, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'typesafe-ai/jev', state, questions }),
      });
      if (r.status === 401 || r.status === 403) throw Object.assign(new Error('auth ' + r.status), { fatal: true });
      if (!r.ok) { await sleep(2000 * (i + 1)); continue; }
      const j = await r.json();
      const ms = Math.round(performance.now() - t);
      const cost = Number(j.provider_metadata?.gateway?.marketCost || 0);
      return { w1: j.answers?.w1?.noul, w2: j.answers?.w2?.noul, cost, ms, tokens: j.usage?.input_tokens };
    } catch (e) { if (e.fatal) throw e; await sleep(2000 * (i + 1)); }
  }
  return null;
}

const files = fs.readdirSync(POOLS).filter((f) => f.endsWith('.json')).sort();
for (const f of files) {
  const { id, q, pool } = JSON.parse(fs.readFileSync(path.join(POOLS, f), 'utf8'));
  if (ONLY.length && !ONLY.includes(id)) continue;
  const outFile = path.join(OUT, `${id}.jsonl`);
  const done = new Set(fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).key) : []);
  const todo = pool.filter((p) => !done.has(p.key));
  if (!todo.length) { console.log(id, 'done'); continue; }
  const questions = wordings(q);
  const out = fs.openSync(outFile, 'a');
  const t0 = performance.now(); let n = 0, qcost = 0, idx = 0;
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (idx < todo.length && spent < CAP) {
      const p = todo[idx++];
      const r = await ask(`${p.title}${p.year ? ` (${p.year})` : ''}\n\n${p.text}`, questions);
      if (!r || r.w1 == null || r.w2 == null) continue;
      spent += r.cost; qcost += r.cost; n++;
      fs.writeSync(out, JSON.stringify({ key: p.key, w1: r.w1, w2: r.w2, jev: +((r.w1 + 1 - r.w2) / 2).toFixed(4), cost: r.cost, ms: r.ms, tokens: r.tokens }) + '\n');
    }
  }));
  fs.closeSync(out);
  const wall = Math.round(performance.now() - t0);
  fs.appendFileSync(path.join(OUT, 'walls.jsonl'), JSON.stringify({ id, n, wall_ms: wall, conc: CONC, cost: qcost }) + '\n');
  console.log(id, `scored ${n}/${todo.length} in ${(wall / 1000).toFixed(1)}s $${qcost.toFixed(4)} total $${spent.toFixed(3)}`);
  if (spent >= CAP) { console.log('CAP reached'); break; }
}
