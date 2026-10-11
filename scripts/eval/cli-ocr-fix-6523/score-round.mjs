#!/usr/bin/env node
/**
 * score-round.mjs — score one #6523 iteration round (a run-cli-arm.py raw file) with the unchanged instrument.
 *
 *   node scripts/eval/cli-ocr-fix-6523/score-round.mjs --raw R.jsonl --round r1 --lever "…" [--set dev|held] [--engine E]
 *
 * PRIOR ART: ocr-pareto-6293/import-cli-arm.py lays a CLI arm into the #6293 bench (safety-filter cut, CLI_EMPTY meter)
 * and benchmark-score.mjs scores it; this does both for a 30-page dev set without touching that bench. The text laid
 * down is extractTranscription() of the reply (scripts/lib/cli-chatter.mjs), the same rule rescore-extract.mjs applies
 * to every stored engine on the charts. Per round it appends one row to $JOB_SCRATCH/rounds.jsonl:
 *   empties · refusals (blocked, or the reply is chat with no transcription) · over-half-wrong · mean CER on the
 *   failed-20 · mean CER on the good-10 · retries · gate denials. CER per page follows build-ocr-pareto.mjs's ONE
 *   FAILURE RULE: missing, refused or unaligned → 1.0; capped at 1.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extractTranscription } from '../../lib/cli-chatter.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const RAW = opt('raw'), ROUND = opt('round'), LEVER = opt('lever', ''), SET = opt('set', 'dev');
const ENGINE = opt('engine', 'cli-round');
const J = process.env.JOB_SCRATCH || '/tmp';
const SRC = '/mnt/HC_Volume_105839809/jobs/ocr-pareto-6293/bench';
const BLOCK = "This request was blocked by Gemini's filters";
const sets = JSON.parse(fs.readFileSync(path.join(__dirname, 'sets.json'), 'utf8'));
const failed = new Set(sets.dev_failed.map(x => x.uid)), good = new Set(sets.dev_good.map(x => x.uid));
const uids = SET === 'dev' ? [...failed, ...good] : sets.held_out;
const rows = new Map();
for (const l of fs.readFileSync(RAW, 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); rows.set(r.uid, r); }

const bench = path.join(J, `bench-${ROUND}`);
fs.rmSync(bench, { recursive: true, force: true });
const meters = {};
const info = {};
for (const uid of uids) {
  const [st, slug] = uid.split('|');
  const d = path.join(bench, st), od = path.join(d, 'out', ENGINE), ld = path.join(d, 'out', 'gemini-3.1-flash-lite');
  fs.mkdirSync(od, { recursive: true }); fs.mkdirSync(ld, { recursive: true });
  fs.symlinkSync(path.join(SRC, st, `${slug}.jpg`), path.join(d, `${slug}.jpg`));
  fs.copyFileSync(path.join(SRC, st, 'out', 'gemini-3.1-flash-lite', `${slug}.txt`), path.join(ld, `${slug}.txt`));
  const r = rows.get(uid);
  if (!r) { info[uid] = { missing: true }; continue; }
  let raw = r.text || '';
  const blocked = raw.includes(BLOCK);
  if (blocked) raw = raw.slice(0, raw.indexOf(BLOCK)).replace(/<[^>\n]*$/, '').trimEnd();
  const ex = extractTranscription(raw);
  fs.writeFileSync(path.join(od, `${slug}.txt`), ex.text);
  (meters[od] ||= []).push({ slug, engine: ENGINE, finishReason: blocked ? 'SAFETY' : raw.trim() ? 'STOP' : 'CLI_EMPTY', chars: ex.text.length });
  info[uid] = { empty: !raw.trim(), blocked, chat_only: !!raw.trim() && !ex.text, removed: ex.steps, attempts: r.attempts, nudged: !!r.nudged, gate_denials: r.gate_denials ?? null, secs: r.secs };
}
for (const [od, ms] of Object.entries(meters)) fs.writeFileSync(path.join(od, '_meter.jsonl'), ms.map(m => JSON.stringify(m)).join('\n') + '\n');
const out = path.join(J, `scored-${ROUND}`);
fs.rmSync(out, { recursive: true, force: true });
const strata = [...new Set(uids.map(u => u.split('|')[0]))];
execFileSync('node', [path.join(__dirname, '..', 'benchmark-score.mjs'), `--root=${bench}`, `--stratum=${strata.join(',')}`, `--out=${out}`], { stdio: ['ignore', 'ignore', 'inherit'], maxBuffer: 1 << 26 });
const cer = {};
for (const f of fs.readdirSync(out).filter(f => /-\d{4}-\d{2}-\d{2}\.json$/.test(f) && !f.startsWith('summary'))) {
  const st = f.replace(/-\d{4}-\d{2}-\d{2}\.json$/, '');
  for (const p of JSON.parse(fs.readFileSync(path.join(out, f), 'utf8')).pages) {
    const c = p.engines?.[ENGINE];
    if (!c) continue;
    const isFailed = c.missing || c.refused || (st.startsWith('ref-') && !c.aligned) || c.cer == null;
    cer[`${st}|${p.slug}`] = isFailed ? 1 : Math.min(1, c.cer);
  }
}
const per = uids.map(u => ({ uid: u, group: failed.has(u) ? 'failed' : good.has(u) ? 'good' : 'held', cer: cer[u] ?? 1, ...info[u] }));
const mean = xs => xs.length ? Math.round(1000 * xs.reduce((a, b) => a + b, 0) / xs.length) / 1000 : null;
const row = { round: ROUND, lever: LEVER, set: SET, n: per.length,
  empties: per.filter(p => p.empty || p.missing).length, refusals: per.filter(p => p.blocked || p.chat_only).length,
  over_half_wrong: per.filter(p => p.cer > 0.5).length,
  mean_cer_failed20: mean(per.filter(p => p.group === 'failed').map(p => p.cer)), mean_cer_good10: mean(per.filter(p => p.group === 'good').map(p => p.cer)),
  mean_cer_all: mean(per.map(p => p.cer)), retried: per.filter(p => (p.attempts || 1) > 1).length, nudged: per.filter(p => p.nudged).length,
  gate_denials: per.reduce((s, p) => s + (p.gate_denials || 0), 0), extractor_changed: per.filter(p => p.removed?.length).length };
fs.writeFileSync(path.join(J, `per-page-${ROUND}.json`), JSON.stringify(per, null, 1));
if (!args.includes('--no-log')) fs.appendFileSync(path.join(J, 'rounds.jsonl'), JSON.stringify(row) + '\n');
console.log(JSON.stringify(row));
