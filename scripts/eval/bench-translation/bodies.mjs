#!/usr/bin/env node
// PRIOR ART: scripts/eval/plain-6728/bodies.mjs — the not-read rule (no text, wrapper problem, chatter, empty body),
// the <summary>-after-<<<END>>> repair and bodyOf() are its code; it reads only run-arm.mjs rows. This also reads
// pareto-6182/run-arms.mjs's Batch rows (lite: {text, in, out, thinking, finish}), so every engine is scored the same way.
/**
 * bodies.mjs — $0. Reads $W/arms/<engine>-<arm>.jsonl for every file there; writes $W/bodies.json:
 *   { body: {tag: {uid: body}}, dnr: {tag: {uid: why}}, stats: {tag: {uid: {raw_chars, body_chars, tags, out_tok, think_tok, secs}}} }
 *   node scripts/eval/bench-translation/bodies.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { cliChatterReason } from '../../lib/cli-chatter.mjs';
import { bodyOf, tagChars } from './prompts.mjs';

const W = process.env.BENCH_W || `${process.env.JOB_SCRATCH}/w`;
const out = { body: {}, dnr: {}, stats: {} };
for (const f of fs.readdirSync(path.join(W, 'arms')).filter((x) => /^(lite|flash38|opus)-(v13|v13b|v20|plain)\.jsonl$/.test(x)).sort()) {
  const tag = f.replace(/\.jsonl$/, '');
  const rows = {};
  for (const l of fs.readFileSync(path.join(W, 'arms', f), 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); if (r.text || !rows[r.uid]) rows[r.uid] = r; }
  out.body[tag] = {}; out.dnr[tag] = {}; out.stats[tag] = {};
  for (const [uid, r] of Object.entries(rows)) {
    let t = r.text || '';
    if (r.problem === 'text outside the markers') {   // plain-6728/bodies.mjs: house tags after <<<END>>> are format, not chatter
      const m = String(r.raw || '').match(/^\s*<<<\s*BEGIN\s*>>>([\s\S]*?)<<<\s*END\s*>>>([\s\S]*)$/);
      if (m && m[2].trim() && !m[2].replace(/<(\w+)[^>]*>[\s\S]*?<\/\1>/g, '').trim()) { t = `${m[1].trim()}\n\n${m[2].trim()}`; r.problem = null; }
    }
    const batch = r.job != null;   // a run-arms.mjs Batch row
    if (batch && r.finish && r.finish !== 'STOP') r.problem = `finish ${r.finish}`;
    const body = bodyOf(t);
    const outTok = batch ? (r.out ?? 0) + (r.thinking ?? 0) : r.usage?.output_tokens ?? null;
    out.stats[tag][uid] = { raw_chars: t.length, body_chars: body.length, tags: tagChars(t), out_tok: outTok, think_tok: batch ? r.thinking ?? 0 : r.usage?.thinking_tokens ?? null,
      in_tok: batch ? r.in ?? null : r.usage?.input_tokens ?? null, usd: r.usd_batch ?? null, secs: r.secs ?? null, problem: r.problem ?? null };
    const why = !t.trim() ? (r.problem || 'empty') : r.problem ? `wrapper: ${r.problem}` : cliChatterReason(t) ? `chatter: ${cliChatterReason(t)}` : body.length < 20 ? 'empty body' : null;
    if (why) out.dnr[tag][uid] = why; else out.body[tag][uid] = body;
  }
  console.log(`${tag}: ${Object.keys(out.body[tag]).length} read, ${Object.keys(out.dnr[tag]).length} not read ${JSON.stringify(Object.values(out.dnr[tag]).reduce((a, w) => ({ ...a, [w]: (a[w] || 0) + 1 }), {}))}`);
}
fs.writeFileSync(path.join(W, 'bodies.json'), JSON.stringify(out));
