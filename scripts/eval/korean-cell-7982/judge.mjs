#!/usr/bin/env node
// PRIOR ART: scripts/eval/results/agy-reread-4850/judge.mjs and scripts/eval/confidence-7866/judge.mjs (the runner: blind
// absolute verdicts, one text a call with the page image, seeded order, paceCheck, resume from the verdict file; the
// wrong-page control). The instrument is imported unchanged: correction-pass-7818 lib.mjs judgeAbsolute (route-judge-6740
// judgePrompt, Opus via claude -p). scripts/eval/lib/plant-ocr-errors.mjs plants into European print only (langCode has
// la/de/fr), so the two CJK plants (D a dropped line, S three characters swapped) are defined here.
/**
 * #7982 judge stage (scripts/eval/experiments/2026-11-03-korean-ocr-cell-7982.md §Judge). Nothing here writes to Mongo.
 *   node scripts/eval/korean-cell-7982/judge.mjs collect     arm texts → OUT/arms/<arm>/<page>.txt, OUT/items.json
 *   node scripts/eval/korean-cell-7982/judge.mjs main        every distinct (page, text) once, blind
 *   node scripts/eval/korean-cell-7982/judge.mjs controls    wrong-page (2 per arm) and planted (up to 6)
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { judgeAbsolute, paceCheck, makeRng } from '../confidence-7866/lib.mjs';
import { OUT, J, W, jsonl, SEED } from './lib.mjs';

export const ARMS = ['stored', 'agy-flash-low-read', 'paddle-vl', 'qwen3-vl-8b'];
const CALL_CAP = 160;
const VF = path.join(OUT, 'verdicts.jsonl');
const sha = (s) => createHash('sha256').update(s).digest('hex');
/** The text a reader would see once the library's tags are removed (the usable-output test, prereg §Arms). */
export const bare = (t) => String(t || '').replace(/<[^>]+>/g, '').replace(/\s+/g, '');
export const usable = (t) => bare(t).length >= 20;
const armFile = (arm, pid) => path.join(OUT, 'arms', arm, `${pid}.txt`);

function collect() {
  const { drawn } = J('draw.json');
  const put = (arm, pid, t) => { fs.mkdirSync(path.dirname(armFile(arm, pid)), { recursive: true }); fs.writeFileSync(armFile(arm, pid), t ?? ''); };
  const gpu = (f) => Object.fromEntries(jsonl(path.join(OUT, 'gpu', 'out', f)).map((r) => [r.page_id, r.error ? '' : r.text]));
  const pv = gpu('PV.jsonl'), q = gpu('Q.jsonl');
  const items = [], status = {};
  for (const d of drawn) {
    const meta = path.join(OUT, 'arms', 'agy-read', `${d.page_id}.meta.json`);
    const m = fs.existsSync(meta) ? JSON.parse(fs.readFileSync(meta, 'utf8')) : null;
    const agyTxt = path.join(OUT, 'arms', 'agy-read', `${d.page_id}.txt`);
    put('agy-flash-low-read', d.page_id, m && m.exit === 0 && fs.existsSync(agyTxt) ? fs.readFileSync(agyTxt, 'utf8') : '');
    put('paddle-vl', d.page_id, pv[d.page_id] ?? '');
    put('qwen3-vl-8b', d.page_id, q[d.page_id] ?? '');
    const byText = new Map();
    for (const arm of ARMS) {
      const t = fs.readFileSync(armFile(arm, d.page_id), 'utf8');
      const ok = usable(t);
      status[arm] = status[arm] || { usable: 0, none: 0 }; status[arm][ok ? 'usable' : 'none']++;
      if (!ok) continue;
      const h = sha(t.trim());
      if (!byText.has(h)) byText.set(h, { id: `k${sha(`${d.page_id}:${h}`).slice(0, 12)}`, page: d.page_id, book: d.book, stratum: d.stratum, text_sha: h.slice(0, 16), arms: [] });
      byText.get(h).arms.push(arm);
    }
    items.push(...byText.values());
  }
  W('items.json', items);
  console.log(`items: ${items.length}; usable by arm ${JSON.stringify(status)}`);
}

const textOf = (it) => fs.readFileSync(armFile(it.arms[0], it.page), 'utf8');
const img = (pid) => fs.readFileSync(path.join(OUT, 'img', `${pid}.jpg`));
const callsSoFar = () => jsonl(VF).filter((r) => r.verdict || r.usage).length;

async function runQueue(jobs) {
  const limits = await import('../../lib/model-limits.mjs');
  const state = {};
  const max = CALL_CAP - callsSoFar();
  let calls = 0, i = 0, stop = null;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (!stop && i < jobs.length) {
      if (calls >= max) { stop = `call cap ${CALL_CAP}`; break; }
      const why = await paceCheck(limits, state);
      if (why) { stop = why; break; }
      const job = jobs[i++]; if (!job) break;
      calls++;
      const r = await judgeAbsolute({ lang: 'Korean', text: job.text }, img(job.page));
      if (r.cls === 'quota') { stop = 'claude quota'; break; }
      const { text, ...rest } = job;
      fs.appendFileSync(VF, JSON.stringify({ ...rest, ...r, at: new Date().toISOString() }) + '\n');
      const v = r.verdict;
      console.log(`  ${job.set} ${job.id} ${job.page} [${(job.arms || []).join(',')}]: ${v ? `accept=${v.accept} f${v.fidelity} wt=${(v.defects || []).filter((x) => x.severity === 'wrong_text').length}` : `unparsed ${r.cls ?? ''}`}`);
    }
  }));
  console.log(stop ? `STOPPED: ${stop}` : `done (${calls} calls)`);
}

const done = () => new Set(jsonl(VF).filter((r) => r.verdict).map((r) => r.id));

async function main() {
  const its = J('items.json'), seen = done();
  const jobs = its.filter((it) => !seen.has(it.id)).map((it) => ({ set: 'main', ...it, text: textOf(it) }));
  const r = makeRng(SEED.queue);
  for (let k = jobs.length - 1; k > 0; k--) { const j = Math.floor(r() * (k + 1)); [jobs[k], jobs[j]] = [jobs[j], jobs[k]]; }
  console.log(`${jobs.length} main verdicts to make`);
  await runQueue(jobs);
}

/** Body lines: not a tag line, at least 4 characters, not the first or last such line. */
function bodyIdx(lines) {
  const ix = lines.map((l, i) => [l.trim(), i]).filter(([l]) => l && !/^</.test(l) && !/>$/.test(l) && bare(l).length >= 4).map(([, i]) => i);
  return ix.slice(1, -1);
}
/** D: drop one body line of >= 8 characters near the middle. S: replace 3 consecutive CJK characters in a middle body line. */
export function plantCJK(text, kind, donor, rng) {
  const lines = text.split('\n'), body = bodyIdx(lines);
  if (kind === 'D') {
    const c = body.filter((i) => bare(lines[i]).length >= 8);
    if (!c.length) return null;
    const i = c[Math.floor(c.length / 2)];
    return { text: lines.filter((_, k) => k !== i).join('\n'), plant: { kind, line: i, before: lines[i], after: '' } };
  }
  const CJK = /[㐀-鿿가-힯]{3}/u;
  const c = body.filter((i) => CJK.test(lines[i]));
  const pool = (donor.match(/[㐀-鿿가-힯]/gu) || []);
  if (!c.length || pool.length < 20) return null;
  const i = c[Math.floor(c.length / 2)], line = lines[i];
  const m = [...line.matchAll(/[㐀-鿿가-힯]{3}/gu)];
  const at = m[Math.floor(m.length / 2)];
  let rep = '';
  for (let t = 0; t < 50 && (rep.length < 3 || rep === at[0]); t++) { const s = Math.floor(rng() * (pool.length - 3)); rep = pool.slice(s, s + 3).join(''); }
  const nl = line.slice(0, at.index) + rep + line.slice(at.index + 3);
  const out = [...lines]; out[i] = nl;
  return { text: out.join('\n'), plant: { kind, line: i, before: at[0], after: rep } };
}
export const caught = (v) => !v.accept || (v.defects || []).some((d) => d.severity === 'wrong_text' || d.severity === 'misleads');

async function controls() {
  const its = J('items.json'), vs = jsonl(VF).filter((r) => r.set === 'main' && r.verdict);
  const vOf = new Map(vs.map((r) => [r.id, r.verdict]));
  const seen = new Set(jsonl(VF).filter((r) => r.verdict && r.set !== 'main').map((r) => r.id));
  const jobs = [];
  // wrong-page: 2 per arm, another drawn book's text of the same arm on this page's image
  const rw = makeRng(SEED.wrongPage);
  for (const arm of ARMS) {
    const own = its.filter((it) => it.arms.includes(arm));
    for (let k = 0; k < 2 && own.length >= 2; k++) {
      const a = own[Math.floor(rw() * own.length)];
      let b; do { b = own[Math.floor(rw() * own.length)]; } while (b.book === a.book);
      const id = `w-${arm}-${k}`;
      if (!seen.has(id)) jobs.push({ set: 'wrong', id, page: a.page, arms: [arm], text_from: b.page, text: textOf(b) });
    }
  }
  // planted: up to 6, on accepted main texts, D and S alternating
  const rp = makeRng(SEED.planted);
  const acc = its.filter((it) => vOf.get(it.id)?.accept).sort((a, b) => (a.id < b.id ? -1 : 1));
  for (let k = acc.length - 1; k > 0; k--) { const j = Math.floor(rp() * (k + 1)); [acc[k], acc[j]] = [acc[j], acc[k]]; }
  let slot = 0;
  for (const it of acc) {
    if (slot >= 6) break;
    const kind = slot % 2 ? 'S' : 'D';
    const donor = its.find((x) => x.book !== it.book && x.arms.includes(it.arms[0])) ?? its.find((x) => x.book !== it.book);
    const pl = plantCJK(textOf(it), kind, textOf(donor), rp);
    if (!pl) continue;
    const id = `p-${slot}-${it.id}`; slot++;
    if (!seen.has(id)) jobs.push({ set: 'planted', id, page: it.page, arms: it.arms, planted_from: it.id, plant: pl.plant, text: pl.text });
  }
  console.log(`${jobs.length} control verdicts to make (planted slots ${slot}, accepted texts ${acc.length})`);
  await runQueue(jobs);
}

const cmd = process.argv[2];
if (cmd === 'collect') collect();
else if (cmd === 'main') await main();
else if (cmd === 'controls') await controls();
else console.log('usage: judge.mjs collect|main|controls');
