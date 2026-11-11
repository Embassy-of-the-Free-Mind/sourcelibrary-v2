// ROLLOUT, reads + pick (#7119, gate passed 2026-10-23): for every written leaf page of Whish 147, four candidate reads
// and a J-text pick. Candidate 1 is the stored fresh read (reads/fresh/<key>.txt of ../whish147-best-attempt-2026-10-22/
// reads.tar.gz, copied to reads/opus-1/); then 2 more Opus reads and 1 Fable read with fresh.mjs's FRESH_PROMPT and
// leafPieces imported unchanged (same prompt hash, same crops); then the J-text judge (judge.mjs) over all four.
// No database writes here; apply.mjs writes. Stops at 85% weekly or on a usage limit, with no further calls.
//   JOB_SCRATCH=<dir> node bestof.mjs --plan            (the page list -> plan.json)
//   JOB_SCRATCH=<dir> node bestof.mjs [--only=A|B] [--concurrency=3]
// PRIOR ART: ../whish147-best-attempt-2026-10-22/fresh.mjs (one read per leaf, its prompt and crops reused);
// ../whish147-stability-recall-2026-10-23/run.mjs (the same read repeated on 12 leaves; lib.mjs is its harness).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { SCRATCH, sealedCall, UsageLimit } from './lib.mjs';
import { FRESH_PROMPT, leafPieces } from '../whish147-best-attempt-2026-10-22/fresh.mjs';
import { judge, HERE } from './judge.mjs';
import { weeklyPct } from '../../../batch/refused-pages.mjs';

const args = process.argv.slice(2);
const arg = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const BOOK = '6ad845ec6037414ddef152af';
const MAP = JSON.parse(fs.readFileSync(path.join(HERE, '../whish147-best-attempt-2026-10-22/manuscript-map.json'), 'utf8'));
const STORED = path.join(SCRATCH, 'tarx', 'reads', 'fresh');
// --no-fable (from 2026-10-23 08:15, after 9 leaves): a Fable read cost ~8x an Opus read on this account's weekly
// meter ($1.86 vs $0.23 list per read), enough to stop the run near 80 of 303 leaves; 3 Opus + J-text also passed
// the gate (0.20). A Fable read already made for a leaf stays a candidate.
const NO_FABLE = args.includes('--no-fable');
export const READS = [['opus-2', 'opus'], ['opus-3', 'opus'], ...(NO_FABLE ? [] : [['fable-1', 'fable']])];
export const CANDS = ['opus-1', 'opus-2', 'opus-3', 'fable-1'];

function handOf(n) {
  const e = MAP.map.find((m) => n >= m.pages[0] && n <= m.pages[1]);
  return e ? { hand: e.hand, what: e.what } : { hand: null, what: null };
}

/** inv.json (page inventory from Mongo) -> plan.json: every page with a reason, rollout pages in hand order. */
function plan() {
  const inv = JSON.parse(fs.readFileSync(path.join(SCRATCH, 'inv.json'), 'utf8')).filter((x) => x.n > 0);
  const out = [];
  for (const x of inv) {
    const { hand, what } = handOf(x.n);
    let skip = null;
    if (x.n === 4) skip = 'English label (later hand, Latin script)';
    else if (x.method === 'contents-leaf-read') skip = 'contents leaf: kept as the #7106 read (lists, not running text), as apply-fresh did';
    else if (!hand || /blank|board/.test(what || '')) skip = `no writing to read (${what})`;
    else if (!x.key) skip = 'not a leaf page';
    out.push({ n: x.n, id: x.id, key: x.key, hand, what, primary: x.primary, half: x.half, skip });
  }
  const order = (x) => (x.hand === 'A' ? 0 : 1) * 1000 + x.n;
  const todo = out.filter((x) => !x.skip).sort((a, b) => order(a) - order(b));
  fs.writeFileSync(path.join(HERE, 'plan.json'), JSON.stringify({ todo, skipped: out.filter((x) => x.skip) }, null, 1));
  console.log(`${todo.length} leaves to read (A ${todo.filter((x) => x.hand === 'A').length}, B ${todo.filter((x) => x.hand === 'B').length}); ${out.length - todo.length} skipped`);
}

async function img(n) {
  const f = path.join(SCRATCH, 'img', `${n}.jpg`);
  if (fs.existsSync(f)) return;
  const r = await fetch(`https://images.sourcelibrary.org/archived/${BOOK}/${n}.jpg`, { headers: { 'User-Agent': 'sourcelibrary-whish147-job/1.0' } });
  if (!r.ok) throw new Error(`image ${n}: HTTP ${r.status}`);
  fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
}

/** Copy the stored fresh read in as candidate opus-1, after checking it was made from these exact crops and prompt. */
function stored(key, files) {
  const meta = JSON.parse(fs.readFileSync(path.join(STORED, `${key}.meta.json`), 'utf8'));
  const sha = files.map((f) => createHash('sha256').update(fs.readFileSync(f)).digest('hex'));
  const same = meta.images.length === sha.length && meta.images.every((im, i) => im.sha256 === sha[i]);
  const prompt = FRESH_PROMPT(files.length);
  const ph = createHash('sha256').update(prompt).digest('hex').slice(0, 16);
  const d = path.join(HERE, 'reads', 'opus-1');
  fs.mkdirSync(d, { recursive: true });
  fs.copyFileSync(path.join(STORED, `${key}.txt`), path.join(d, `${key}.txt`));
  fs.writeFileSync(path.join(d, `${key}.meta.json`), JSON.stringify({ ...meta, stage: 'opus-1', copied_from: `whish147-best-attempt-2026-10-22/reads.tar.gz:reads/fresh/${key}`, same_crops: same, same_prompt: meta.prompt_hash === ph }, null, 1));
  return { ok: meta.ok, same_crops: same, same_prompt: meta.prompt_hash === ph };
}

async function leaf(t, picks) {
  const [n, l] = t.key.split('-');
  await img(Number(n));
  const { files } = await leafPieces(Number(n), l);
  const st = stored(t.key, files);
  const reads = {};
  for (const [stage, model] of READS) {
    const pct = weeklyPct();
    if (pct != null && pct >= 85) throw new UsageLimit(`weekly ${pct}% >= 85%`);
    const r = await sealedCall({ stage, id: t.key, model, prompt: FRESH_PROMPT(files.length), images: files });
    reads[stage] = { ok: r.meta.ok, err: r.meta.error_class, model: r.meta.model, secs: r.meta.secs, cached: !!r.cached };
  }
  const done = (c) => { const m = path.join(HERE, 'reads', c, `${t.key}.meta.json`); return fs.existsSync(m) && JSON.parse(fs.readFileSync(m, 'utf8')).ok; };
  const cand = Object.fromEntries(CANDS.filter((c) => c === 'opus-1' ? st.ok : (reads[c]?.ok || done(c))).map((c) => [c, path.join(HERE, 'reads', c, `${t.key}.txt`)]));
  let pick = null, keyMap = null, err = null;
  if (Object.keys(cand).length === 1) pick = Object.keys(cand)[0];
  else if (Object.keys(cand).length) ({ pick, keyMap, error: err } = await judge({ stage: 'pick', key: t.key, kind: 'text', files: cand }));
  picks[t.key] = { n: t.n, hand: t.hand, stored: st, reads, candidates: Object.keys(cand), pick, keyMap, error: err ?? null };
  console.log(`${new Date().toISOString().slice(11, 19)} p${t.n} ${t.key} (${t.hand}): ${Object.entries(reads).map(([k, v]) => `${k}=${v.ok ? 'ok' : v.err}`).join(' ')} -> ${pick}`);
}

async function run() {
  const P = JSON.parse(fs.readFileSync(path.join(HERE, 'plan.json'), 'utf8'));
  const only = arg('only');
  const picksF = path.join(HERE, 'picks.json');
  const picks = fs.existsSync(picksF) ? JSON.parse(fs.readFileSync(picksF, 'utf8')) : {};
  const q = P.todo.filter((t) => (!only || t.hand === only) && !(picks[t.key]?.pick));
  console.log(`${q.length} leaves to do`);
  let stop = null;
  const save = () => fs.writeFileSync(picksF, JSON.stringify(picks, null, 1));
  await Promise.all(Array.from({ length: Number(arg('concurrency') || 3) }, async () => {
    while (q.length && !stop) {
      const t = q.shift();
      try { await leaf(t, picks); save(); } catch (e) {
        if (e instanceof UsageLimit) { stop = e.message; console.log(`STOP: ${e.message}`); break; }
        console.error(`p${t.n} ${t.key} failed: ${e.stack || e}`);
        picks[t.key] = { n: t.n, hand: t.hand, pick: null, error: String(e.message || e).slice(0, 300) }; save();
      }
    }
  }));
  save();
  if (stop) { fs.writeFileSync(path.join(SCRATCH, 'STOPPED'), stop); process.exit(3); }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) { if (args.includes('--plan')) plan(); else await run(); }
