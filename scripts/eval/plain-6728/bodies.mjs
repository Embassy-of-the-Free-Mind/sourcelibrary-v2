#!/usr/bin/env node
// PRIOR ART: scripts/eval/pro-translate-6545/arms.py (failed reads counted, not scored; the chatter guard on what is
// left) — the same rule, in node so the tag strip is prompts.mjs bodyOf() for every arm and cli-chatter.mjs is called
// directly; scripts/eval/pro-translate-6545/chatter.mjs exposed that guard to Python.
/**
 * #6728 — $0. Reads $W/arms/<TAG>.jsonl for the given tags; writes $W/bodies.json:
 *   { body: {tag: {uid: body}}, dnr: {tag: {uid: why}}, stats: {tag: {uid: {raw_chars, body_chars, tags, out_tok, think_tok, secs}}} }
 * A read is NOT read (dnr) when it has no text, is not a clean marker reply (cli-translate.mjs apply refuses those),
 * fails the chatter guard, or has an empty body. Everything else is judged on bodyOf(text).
 *   node scripts/eval/plain-6728/bodies.mjs G-CUR G-PLAIN G-CUR2 O-CUR O-PLAIN O-CUR2
 */
import fs from 'node:fs';
import { cliChatterReason } from '../../lib/cli-chatter.mjs';
import { bodyOf, tagChars } from './prompts.mjs';

const W = process.env.W6728 || `${process.env.JOB_SCRATCH}/w`;
const out = { body: {}, dnr: {}, stats: {} };
for (const tag of process.argv.slice(2)) {
  const f = `${W}/arms/${tag}.jsonl`;
  if (!fs.existsSync(f)) continue;
  const rows = {};
  for (const l of fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); if (r.text || !rows[r.uid]) rows[r.uid] = r; }
  out.body[tag] = {}; out.dnr[tag] = {}; out.stats[tag] = {};
  for (const [uid, r] of Object.entries(rows)) {
    const t = r.text || '';
    const body = bodyOf(t);
    out.stats[tag][uid] = { raw_chars: t.length, body_chars: body.length, tags: tagChars(t), out_tok: r.usage?.output_tokens ?? null, think_tok: r.usage?.thinking_tokens ?? null, secs: r.secs, calls: r.calls, problem: r.problem };
    const why = !t.trim() ? (r.problem || 'empty') : r.problem ? `wrapper: ${r.problem}` : cliChatterReason(t) ? `chatter: ${cliChatterReason(t)}` : body.length < 20 ? 'empty body' : null;
    if (why) out.dnr[tag][uid] = why; else out.body[tag][uid] = body;
  }
  console.log(`${tag}: ${Object.keys(out.body[tag]).length} read, ${Object.keys(out.dnr[tag]).length} not read ${JSON.stringify(Object.values(out.dnr[tag]).reduce((a, w) => ({ ...a, [w]: (a[w] || 0) + 1 }), {}))}`);
}
fs.writeFileSync(`${W}/bodies.json`, JSON.stringify(out));
