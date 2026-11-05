#!/usr/bin/env node
// PRIOR ART: ./fc-judge.mjs (the #5924 second-family judge: agy gemini-3.8-flash-low, one page per call, a gated
//   workspace holding only the image, the C-TASK definitions, both texts inline, a JSON answer between markers) — it
//   judges Opus correction vs lite on the Latin sample; this judges C vs R (#7568 (d)) for one language, same call.
// w-judge2.mjs — LANG7568=<lang>. 30 pages drawn with Mulberry32(seed + 3) (Fisher–Yates over the pages where C's
//   served text differs from R, in sample order; the first 30), X/Y from Mulberry32(seed + 4). Writes
//   $JOB_SCRATCH/<lang>/judge2/<slug>.{raw.txt,json} and keys/j2-key.json.
import fs from 'node:fs'; import path from 'node:path';
import { agyCall, installToolGate, gateCalls, unwrapRead, CLI_SAFE_ARGS } from '../../lib/agy-cli.mjs';
import { lite, servedC, readR } from './w-packets.mjs';
import { LANGS } from './w-draw.mjs';
const L = process.env.LANG7568, S = path.join(process.env.JOB_SCRATCH, L), HERE = path.dirname(new URL(import.meta.url).pathname), MODEL = 'gemini-3.8-flash-low';
const NAME = { zh: 'Chinese', de: 'German', el: 'Greek', sa: 'Sanskrit', ar: 'Arabic' }[L];
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const sample = JSON.parse(fs.readFileSync(path.join(HERE, 'results-7568', L, 'sample.json'), 'utf8'));
const all = sample.books.flatMap(b => b.pages);
const text = (p) => { const l = lite(p.slug); return { C: servedC(p.page_id, l).text, R: readR(p.page_id).text }; };
const pool = all.filter(p => { const t = text(p); return t.C !== t.R; }).map(p => p.slug);
const r1 = mulberry32(LANGS[L].seed + 3);
for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r1() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
const drawn = new Set(pool.slice(0, 30));
const pages = all.filter(p => drawn.has(p.slug));
const r2 = mulberry32(LANGS[L].seed + 4), key = {};
for (const p of pages) key[p.slug] = r2() < 0.5 ? 'XC' : 'YC';
fs.mkdirSync(path.join(S, 'keys'), { recursive: true }); fs.mkdirSync(path.join(S, 'judge2'), { recursive: true });
fs.writeFileSync(path.join(S, 'keys', 'j2-key.json'), JSON.stringify(key));

const TASK = `You are a careful reader of ${NAME} printed books. Judge two transcriptions of the SAME printed page, labelled X and Y, against the page image attached at the end of this message. You do not know where either came from.

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
  const out = path.join(S, 'judge2', `${p.slug}.json`);
  if (fs.existsSync(out)) return;
  const t = text(p), [x, y] = key[p.slug] === 'XC' ? [t.C, t.R] : [t.R, t.C];
  const ws = path.join(S, 'judge2', `ws-${p.slug}`); fs.rmSync(ws, { recursive: true, force: true }); fs.mkdirSync(ws, { recursive: true });
  fs.copyFileSync(path.join(S, 'draw', `${p.slug}.jpg`), path.join(ws, 'page.jpg'));
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
  fs.writeFileSync(path.join(S, 'judge2', `${p.slug}.raw.txt`), r?.text || '');
  fs.writeFileSync(out, JSON.stringify({ slug: p.slug, calls, cls: r?.cls ?? null, tool_calls: gateCalls(gate), usage: r?.usage ?? null, answer: parsed }, null, 1));
  fs.rmSync(ws, { recursive: true, force: true });
  console.log(`  ${p.slug} ${parsed ? `${parsed.prefer} X=${parsed.X.verdict} Y=${parsed.Y.verdict}` : `UNPARSED ${r?.cls || ''}`} (${calls} call${calls === 1 ? '' : 's'})`);
};
console.log(`${L}: ${pages.length} pages (of ${pool.length} where C ≠ R); ${MODEL}; 3 at a time`);
const q = [...pages];
await Promise.all([0, 1, 2].map(async () => { while (q.length) await one(q.shift()); }));
