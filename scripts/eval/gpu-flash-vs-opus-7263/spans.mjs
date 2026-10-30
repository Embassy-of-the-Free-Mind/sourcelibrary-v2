#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740 and tib-flash-correct `pass/diffqa.mjs` (#6740: changed spans of a correction
// put to a judge with the leaf; LOW/RISKY classes) — that is Tibetan syllables against a draft; here it is Latin-script
// words between two finished reads. The word alignment is d-diff.mjs's (diff's diffArrays, the same folding key); the
// sealed Opus call is claude-ocr.mjs `claudeCall`, imported.
/**
 * spans.mjs — #7263 metric 4: page metrics hide word swaps. For a page, every word-level place where arm A and arm B
 * disagree (after folding case, punctuation and ſ) is put to Opus with the image, blind: the two readings are labelled
 * 1 and 2 in an order drawn per span. Opus answers per span which the page prints: 1, 2, both_wrong, cant_tell.
 *
 *   node spans.mjs --a=draft:f --b=e2/D-r1 --only=<slug file> [--conc=3] [--max-spans=40]
 * Writes $J/spans-<a>-<b>/<slug>.json {spans:[{n, ctx, a, b, first}], answer:{n: '1'|'2'|...}, tally:{a, b, both_wrong, cant_tell}}.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { diffArrays } from 'diff';
import { claudeCall } from '../../batch/claude-ocr.mjs';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const J = process.env.J || '/root/jobs/gpu-flash-vs-opus-7263';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const A = arg('a', 'O'); const B = arg('b'); const CONC = Number(arg('conc', '3')); const MAXS = Number(arg('max-spans', '40'));
const OUT = path.join(J, `spans-${A}-${B.replace(/\W/g, '_')}`); fs.mkdirSync(OUT, { recursive: true });
const LANG = { la: 'Latin', en: 'English', de: 'German', fr: 'French', it: 'Italian' };
const DRAFTS = {};
const final = (spec, s) => {
  if (spec.startsWith('draft:')) { const k = spec.slice(6); DRAFTS[k] ??= Object.fromEntries(fs.readFileSync(path.join(J, 'drafts', `${k}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.page_id, r.text || ''])); return DRAFTS[k][s] || ''; }
  try { return JSON.parse(fs.readFileSync(path.join(J, spec, `${s}.json`), 'utf8')).final || ''; } catch { return ''; }
};

const TAGLINE = /^\s*<(scan-quality|language|script|page-type|vocab|meta|warning|columns|page-num|sig|header|image-desc)\b[^>]*>.*<\/\1>\s*$/i;
const words = (t) => String(t).split('\n').filter((l) => !TAGLINE.test(l)).join('\n').replace(/<\/?[a-z-]+[^>]*>/gi, ' ').split(/\s+/).filter(Boolean);
const key = (w) => w.normalize('NFC').toLowerCase().replace(/ſ/g, 's').replace(/[^\p{L}\p{N}]/gu, '');
function spans(a, b) {
  const parts = diffArrays(words(a), words(b), { comparator: (x, y) => key(x) === key(y) });
  const out = []; let ctx = []; let i = 0;
  while (i < parts.length) {
    const p = parts[i];
    if (!p.added && !p.removed) { ctx = p.value.slice(-4); i++; continue; }
    let ra = []; let rb = [];
    while (i < parts.length && (parts[i].added || parts[i].removed)) { if (parts[i].removed) ra = ra.concat(parts[i].value); else rb = rb.concat(parts[i].value); i++; }
    if (key(ra.join('')) === key(rb.join(''))) continue;          // a split or joined word, not a different reading
    const clip = (w) => (w.length > 30 ? `${w.slice(0, 15).join(' ')} … (${w.length} words) … ${w.slice(-8).join(' ')}` : w.join(' ')) || '(nothing)';
    out.push({ ctx: ctx.join(' '), a: clip(ra), b: clip(rb), words: Math.max(ra.length, rb.length) });
  }
  return out;
}

const panel = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(HERE, '..', 'euro-gpu-correct-7567', 'panel.json'), 'utf8')).pages.map((p) => [p.slug, p]));
const slugs = fs.readFileSync(arg('only'), 'utf8').split('\n').filter(Boolean).filter((s) => !fs.existsSync(path.join(OUT, `${s}.json`)));
console.log(`spans ${A} vs ${B}: ${slugs.length} pages`);
let stop = null;
async function one(s) {
  const ta = final(A, s); const tb = final(B, s);
  if (!ta || !tb) return { slug: s, skipped: 'an arm has no text' };
  let sp = spans(ta, tb);
  const total = sp.length;
  // Math.imul, not the multiply in double arithmetic (#5373, tests/unit/paired-stats-prng.test.ts). The 2026-10-28 run drew with the
  // double form; its draws are recorded per span (`first`, and which spans were kept) in its outputs, so it is reproducible from them.
  const rng = (seed) => { let x = parseInt(crypto.createHash('sha256').update(seed).digest('hex').slice(0, 8), 16); return () => ((x = ((Math.imul(1103515245, x) + 12345) >>> 0) % 2147483648) / 2147483648); };
  const r = rng(`7263${s}`);
  if (sp.length > MAXS) sp = sp.map((x, i) => [r(), x, i]).sort((p, q) => p[0] - q[0]).slice(0, MAXS).sort((p, q) => p[2] - q[2]).map((p) => p[1]);
  sp = sp.map((x, i) => ({ n: i + 1, ...x, first: r() < 0.5 ? 'a' : 'b' }));
  if (!sp.length) return { slug: s, spans: [], total, tally: { a: 0, b: 0, both_wrong: 0, cant_tell: 0 } };
  const p = panel[s];
  const prompt = `You are checking two transcriptions of one printed page against the page image. The book: ${p.title || 'unknown'} (${p.year || 'date unknown'}; ${LANG[p.lang]}).
Open the page image with the Read tool: this.jpg (in the current directory). Read it closely.

The two transcriptions agree almost everywhere. Below is every place where they differ (up to ${MAXS}), in reading order. Each line gives a few words of the text just before the place, then reading 1 and reading 2 at that place. "(nothing)" means that transcription has no words there. Find each place in the image and say what the page prints there.
Spelling as printed matters (a different word, letter, number, name or a missing/extra word is a real difference). Treat long s (ſ) as s, u/v and i/j as the same letter, and expanded vs kept abbreviations as equal.

${sp.map((x) => `${x.n}. after "${x.ctx}": reading 1 «${x.first === 'a' ? x.a : x.b}» | reading 2 «${x.first === 'a' ? x.b : x.a}»`).join('\n')}

For each place answer "1" (the page prints reading 1), "2" (reading 2), "both_wrong" (the page prints something else), or "cant_tell" (illegible or not on this page). Reply with ONE JSON object and nothing else: {"spans":{${sp.map((x) => `"${x.n}":"1"`).join(',')}}}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'spans-'));
    fs.copyFileSync(path.join(J, 'img', `${s}.jpg`), path.join(dir, 'this.jpg'));
    const res = await claudeCall(prompt, 'opus', dir);
    fs.rmSync(dir, { recursive: true, force: true });
    if (res.cls === 'usage_limit') { stop = res.err; return null; }
    let ans = null;
    try { const t = res.text; ans = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)).spans; } catch { /* retry */ }
    if (!ans || !sp.every((x) => ans[String(x.n)])) continue;
    const tally = { a: 0, b: 0, both_wrong: 0, cant_tell: 0 };
    for (const x of sp) { const v = ans[String(x.n)]; const who = v === '1' ? x.first : v === '2' ? (x.first === 'a' ? 'b' : 'a') : (v in tally ? v : 'cant_tell'); x.verdict = who; tally[who]++; }
    return { slug: s, lang: p.lang, a: A, b: B, total, spans: sp, tally, usage: res.usage, secs: res.secs };
  }
  return { slug: s, failed: 'no parseable answer' };
}
const queue = [...slugs];
await Promise.all(Array.from({ length: CONC }, async () => {
  while (queue.length && !stop) {
    const s = queue.shift(); const res = await one(s);
    if (!res) break;
    fs.writeFileSync(path.join(OUT, `${s}.json`), JSON.stringify(res, null, 1));
  }
}));
const all = fs.readdirSync(OUT).map((f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'))).filter((x) => x.tally);
const T = { a: 0, b: 0, both_wrong: 0, cant_tell: 0 }; for (const x of all) for (const k in T) T[k] += x.tally[k];
console.log(`${all.length} pages; spans judged: ${A} right ${T.a}, ${B} right ${T.b}, both wrong ${T.both_wrong}, can't tell ${T.cant_tell}${stop ? `; STOPPED ${stop}` : ''}`);
