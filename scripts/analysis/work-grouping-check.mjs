#!/usr/bin/env node
/**
 * "Same work?" on the Part B pairs of translation-share-sample.mjs (#7751): wrong-merge and missed-merge rates of the
 * phase-11 work graph, per language.
 *
 * PRIOR ART: the over-merge sample in #7751 (40 multi-edition Latin works, two member titles compared by hand) — the
 * same question, read by a model so it runs for six languages. scripts/lib/agy-cli.mjs gatedTextCall is the call
 * (no tools: the two titles are the whole input). One pair per call, so no pair anchors another.
 *
 * Reads:  scripts/output/translation-share/<lang>-grouping.json
 * Writes: scripts/output/translation-share/<lang>-grouping-verdicts.jsonl (resumable)
 *
 * Usage: AGY_HOME=/root/.agy-james node scripts/analysis/work-grouping-check.mjs --lang german [--concurrency 6]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gatedTextCall, firstJson } from '../lib/agy-cli.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(__dir, '../../scripts/output/translation-share');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const LANG = String(arg('lang', 'latin')).toLowerCase();
const CONC = Number(arg('concurrency', 6));
const MODEL = arg('model', 'gemini-3.8-flash-low');
const OUT = path.join(DIR, `${LANG}-grouping-verdicts.jsonl`);

const g = JSON.parse(fs.readFileSync(path.join(DIR, `${LANG}-grouping.json`), 'utf8'));
const pairs = [...g.merged.map((p) => ({ ...p, kind: 'merged' })), ...g.missed.map((p) => ({ ...p, kind: 'missed' }))];
const done = new Set(fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.same).map((r) => r.key) : []);
const todo = pairs.filter((p) => !done.has(p.key));
console.log(`${LANG}: ${pairs.length} pairs; ${done.size} done; ${todo.length} to run`);

// Blind to which list a pair came from: both kinds get the same question.
const ed = (e) => `AUTHOR: ${e.author || 'anonymous'}\nTITLE: ${e.title}\nPRINTED: ${e.year ?? 'unknown'}`;
const prompt = (p) => `You are a bibliographer. Below are two early-modern printed editions from a catalogue. Decide whether they are editions of the SAME WORK (the same text, possibly reprinted, retitled, translated within the same language, or with different front matter) or DIFFERENT WORKS (e.g. two different books by the same author, a different part or volume of a series, a different sermon, ordinance or occasional piece, or a commentary on the work rather than the work).

EDITION A
${ed(p.a)}

EDITION B
${ed(p.b)}

Reply with ONE JSON object and nothing else: {"same": "same|different|unsure", "reason": "<one sentence>"}`;

let i = 0, n = 0;
async function worker() {
  while (i < todo.length) {
    const p = todo[i++];
    const r = await gatedTextCall(prompt(p), { model: MODEL, task: 'translate', attempts: 2 });
    const v = firstJson(r.text) || {};
    const row = { key: p.key, kind: p.kind, lang: LANG, a: p.a, b: p.b, same: ['same', 'different', 'unsure'].includes(v.same) ? v.same : null,
      reason: v.reason || null, model: `agy-${MODEL}`, date: new Date().toISOString(), ...(r.cls && { fail: r.cls }) };
    fs.appendFileSync(OUT, JSON.stringify(row) + '\n');
    console.log(`${++n}/${todo.length} ${p.key} ${p.kind} ${row.same ?? 'FAIL ' + (r.cls || 'no json')}`);
    if (r.cls === 'quota') { console.log('quota: stopping'); process.exit(3); }
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
