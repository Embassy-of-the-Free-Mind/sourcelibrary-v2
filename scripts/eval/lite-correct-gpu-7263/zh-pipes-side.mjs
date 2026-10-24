#!/usr/bin/env node
// PRIOR ART: scripts/eval/paddle-correct-6561/score.mjs (the committed scorer; its hanOf reads every bar form,
// including a markdown table's ASCII |, as the ditto mark 丨) and the #6667 "table pipes removed" side check, which
// was never committed as code. This is that side check: the same CER (bodyCer vs the Kanripo leaf) after deleting
// markdown table syntax (separator rows, ASCII |). The production OCR prompt v19.1 asks for markdown tables, so a
// corrector that follows it is charged a 丨 per cell by the committed scorer. Side check only; the committed scorer
// stays the headline. Usage (cwd = zh scratch): node zh-pipes-side.mjs → stdout table + zh-pipes-side.json
import fs from 'node:fs';
import { bodyText, foldHan, bodyCer, median, mean, makeRng } from '../ground-truth-5935/lib.mjs';
// score.mjs extract(), copied (importing score.mjs would run the whole scorer)
function extract(row) {
  const t = String(row?.text || '');
  if (!t.trim()) return { text: '' };
  const m = t.match(/===TRANSCRIPTION===[ \t]*\n?([\s\S]*?)(?:\n?===END===|$)/);
  return { text: m ? m[1] : t };
}

const DITTO = /[｜│┃]/g; // ASCII | is NOT folded here
const unTable = (t) => t.split('\n').filter((l) => !/^\s*\|?[\s:|-]*-{3,}[\s:|-]*\|?\s*$/.test(l)).map((l) => (/^\s*\|/.test(l) ? l.replace(/\|/g, '\n') : l)).join('\n');
const hanOf = (t) => foldHan(bodyText(unTable(t)).replace(DITTO, '丨').replace(/\|/g, '丨'));
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const last = (f) => new Map(readJsonl(f).map((r) => [r.uid, r]));
const sets = JSON.parse(fs.readFileSync('sets.json', 'utf8'));
const ARMS = ['opus-correct', 'flashhigh-correct', 'sonnet-correct', 'haiku-correct', 'lite-correct', 'lite-noimg-correct', 'lite-p2-correct'];
const M = Object.fromEntries(ARMS.map((a) => [a, last(`out-${a}.jsonl`)]));
const cer = (text, leaf) => +bodyCer(hanOf(text), leaf, { expected: [...leaf].length }).cer.toFixed(4);
const out = {};
for (const st of ['A', 'B-rand', 'B-dis']) {
  const S = sets.filter((s) => s.stratum === st && s.kanripo);
  out[st] = {};
  const pad = new Map(S.map((s) => [s.uid, cer(s.paddle, s.kanripo)]));
  out[st].paddle = { scored: S.length, cer_median: median([...pad.values()]), cer_mean: +mean([...pad.values()]).toFixed(4) };
  for (const a of ARMS) {
    const rows = S.map((s) => ({ s, x: extract(M[a].get(s.uid)) })).filter((r) => r.x.text.trim());
    const c = rows.map((r) => ({ b: r.s.bid, c: cer(r.x.text, r.s.kanripo), d: cer(r.x.text, r.s.kanripo) - pad.get(r.s.uid) }));
    const byBook = new Map(); for (const x of c) (byBook.get(x.b) || byBook.set(x.b, []).get(x.b)).push(x.d);
    const books = [...byBook.values()], r = makeRng(7263), draws = [];
    for (let k = 0; k < 4000; k++) { let t = 0, n = 0; for (let i = 0; i < books.length; i++) { const g = books[Math.floor(r() * books.length)]; for (const d of g) { t += d; n++; } } draws.push(t / n); }
    draws.sort((p, q) => p - q);
    out[st][a] = { scored: c.length, cer_median: +median(c.map((x) => x.c)).toFixed(4), cer_mean: +mean(c.map((x) => x.c)).toFixed(4), delta_mean: +mean(c.map((x) => x.d)).toFixed(4), ci95: [+draws[100].toFixed(4), +draws[3899].toFixed(4)], better: c.filter((x) => x.d < -0.005).length, worse: c.filter((x) => x.d > 0.005).length, ge50: c.filter((x) => x.c >= 0.5).length };
  }
}
fs.writeFileSync('zh-pipes-side.json', JSON.stringify(out, null, 1));
for (const [st, o] of Object.entries(out)) { console.log('==', st); for (const [a, v] of Object.entries(o)) console.log(a.padEnd(20), JSON.stringify(v)); }
