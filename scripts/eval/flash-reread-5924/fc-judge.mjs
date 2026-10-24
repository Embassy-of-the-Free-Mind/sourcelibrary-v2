#!/usr/bin/env node
// PRIOR ART: scripts/batch/reread-gate.mjs (blind A/B by Opus through claude -p) and ./C-TASK.md (the Step C words) —
//   both are Opus judges; this is the second-family check #7258 could not run: agy gemini-3.8-flash-low judging the
//   Opus correction against lite, blind, one page per call (PREREGISTRATION-flash-correct.md (d)).
// fc-judge.mjs — 60 pages drawn with Mulberry32(1036) (Fisher–Yates over the 209 pages #7258's C2 showed, in sample
//   order; the first 60), X/Y from Mulberry32(1037) per drawn page. Per page: a fresh gated workspace holding only the
//   image, the C-TASK definitions, both texts inline, and a JSON answer between <<<BEGIN>>>/<<<END>>>. One re-call on
//   an unparseable reply; quota sleeps and retries. Writes $JOB_SCRATCH/judge/<slug>.{raw.txt,json}, keys/d-key.json.
import fs from 'node:fs'; import path from 'node:path';
import { agyCall, installToolGate, gateCalls, unwrapRead, CLI_SAFE_ARGS } from '../../lib/agy-cli.mjs';
import { sample, lite, servedO } from './fc-pairs.mjs';
const J = process.env.JOB_SCRATCH, HERE = path.dirname(new URL(import.meta.url).pathname), MODEL = 'gemini-3.8-flash-low';
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const c2 = JSON.parse(fs.readFileSync(path.join(HERE, 'results/oc-step-c2.json'), 'utf8'));
const shown = c2.filter(r => r.shown).map(r => r.slug);
const r1 = mulberry32(1036), pool = [...shown];
for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r1() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
const drawn = new Set(pool.slice(0, 60));
const pages = sample.books.flatMap(b => b.pages).filter(p => drawn.has(p.slug));
const r2 = mulberry32(1037), key = {};
for (const p of pages) key[p.slug] = r2() < 0.5 ? 'XO' : 'YO';
fs.mkdirSync(path.join(J, 'keys'), { recursive: true }); fs.mkdirSync(path.join(J, 'judge'), { recursive: true });
fs.writeFileSync(path.join(J, 'keys', 'd-key.json'), JSON.stringify(key));

const TASK = `You are a careful reader of early modern printed Latin. Judge two transcriptions of the SAME printed page, labelled X and Y, against the page image attached at the end of this message. You do not know where either came from.

Per transcription, a verdict:
- misleading: a reader is misled about what the page says: a meaning change (a wrong word, number, name or negation that changes the sense), an omitted passage (a line or more of the page's text missing), or another leaf's text served as this one's.
- flawed: errors, but the gist is right: spelling, single letters, punctuation, normalisation that does not change the sense.
- sound: faithful to the page.
Metadata tags (<header>, <page-num>, <margin>, <vocab> ...) are part of a transcription; judge them, but layout and tag differences alone are minor.

Then a preference: X better / Y better / tie, and whether the loser's defect is material (it changes or drops meaning the other read gets right) or minor (spelling, punctuation, tags, layout).

Answer with one JSON object and nothing else:
{"X": {"verdict": "misleading|flawed|sound", "errors": ["<words as transcribed> -> <what the print has>", ...]}, "Y": {...}, "prefer": "X|Y|tie", "loser_material": true|false, "why": "<one line, quoting the decisive words>"}
Write the JSON between two marker lines, <<<BEGIN>>> and <<<END>>>. Output nothing outside the markers: no preamble, no plan, no summary, no offers, no questions.`;

const one = async (p) => {
  const out = path.join(J, 'judge', `${p.slug}.json`);
  if (fs.existsSync(out)) return;
  const L = lite(p.slug), O = servedO(p.page_id, L), [x, y] = key[p.slug] === 'XO' ? [O, L] : [L, O];
  const ws = path.join(J, 'judge', `ws-${p.slug}`); fs.rmSync(ws, { recursive: true, force: true }); fs.mkdirSync(ws, { recursive: true });
  fs.copyFileSync(path.join(J, 'draw', `${p.slug}.jpg`), path.join(ws, 'page.jpg'));
  const gate = installToolGate(ws);
  const sent = `${TASK}\n\nTRANSCRIPTION X START\n${x}\nTRANSCRIPTION X END\n\nTRANSCRIPTION Y START\n${y}\nTRANSCRIPTION Y END\n\nThe page image: @./page.jpg`;
  let calls = 0, parsed = null, r;
  for (let attempt = 0; attempt < 2 && !parsed;) {
    r = await agyCall(['-p', sent, '--model', MODEL, ...CLI_SAFE_ARGS], ws); if (!r.not_called) calls++;
    if (r.cls === 'quota') { console.log(`  quota at ${p.slug}: sleeping until ${r.locked_until || '+30 min'}`); await new Promise(s => setTimeout(s, Math.max(60_000, (Date.parse(r.locked_until || '') || Date.now() + 1_800_000) - Date.now()))); continue; }
    attempt++;
    const u = unwrapRead(r.text);
    try { const j = JSON.parse(u.text.replace(/^```(?:json)?\s*|\s*```$/g, '')); if (j.X?.verdict && j.Y?.verdict && j.prefer) parsed = j; } catch { /* re-call once */ }
  }
  fs.writeFileSync(path.join(J, 'judge', `${p.slug}.raw.txt`), r?.text || '');
  fs.writeFileSync(out, JSON.stringify({ slug: p.slug, calls, cls: r?.cls ?? null, tool_calls: gateCalls(gate), usage: r?.usage ?? null, answer: parsed }, null, 1));
  fs.rmSync(ws, { recursive: true, force: true });
  console.log(`  ${p.slug} ${parsed ? `${parsed.prefer} X=${parsed.X.verdict} Y=${parsed.Y.verdict}` : `UNPARSED ${r?.cls || ''}`} (${calls} call${calls === 1 ? '' : 's'})`);
};
console.log(`${pages.length} pages; ${MODEL}; 3 at a time`);
const q = [...pages];
await Promise.all([0, 1, 2].map(async () => { while (q.length) await one(q.shift()); }));
