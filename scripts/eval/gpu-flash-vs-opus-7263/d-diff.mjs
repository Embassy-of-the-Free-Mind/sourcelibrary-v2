#!/usr/bin/env node
// PRIOR ART: scripts/eval/euro-gpu-correct-7567/e2-correct.mjs (#7567 E2: the agy Flash-low correction call over the
// panel, its two-draft template `twoDraftTemplate`, quota floor, output layout). Copied here, not imported (that file
// runs on import), with what #7263 adds: the word-level DIFF between the two drafts placed in the prompt (arm D), and a
// second pass that checks the first pass's own output against the drafts' diff and the image (arm D2).
/**
 * d-diff.mjs — #7263 arms D / D2 through agy (gemini-3.8-flash-low, MAIN pool), one page per call, image attached.
 *
 *   node d-diff.mjs --arm=D --round=1 --only=<slug file> [--conc=4] [--floor=0.25]
 *   node d-diff.mjs --arm=D2 --round=1 --from=<arm dir of D> --only=<slug file>
 *
 * Drafts: $J/drafts/X.jsonl (draft 1, the language's best E1 engine) and $J/drafts/Y.jsonl (draft 2, the next-best).
 * Writes $J/e2/<arm>-r<round>/<slug>.json with `final` = the text a reader would get (the correction, draft 1 when
 * UNCHANGED, '' on CONTAIN / no answer). The template is chosen by --round (TEMPLATES below; each DEV round recorded).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { diffArrays } from 'diff';
import { agyCall, installToolGate, gateCalls, unwrapRead, CLI_SAFE_ARGS } from '../../lib/agy-cli.mjs';
import { parseAnswer } from '../../batch/ocr-convergence/correct.mjs';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const J = process.env.J || '/root/jobs/gpu-flash-vs-opus-7263';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const ARM = arg('arm'); const ROUND = Number(arg('round', '1'));
if (!['D', 'D2'].includes(ARM)) { console.error('--arm=D|D2'); process.exit(2); }
if (process.env.AGY_HOME) { console.error('AGY_HOME is set: this job runs on the main pool only'); process.exit(2); }
const OUT = path.join(J, 'e2', `${ARM}-r${ROUND}`); fs.mkdirSync(OUT, { recursive: true });
const CONC = Number(arg('conc', '4')); const FLOOR = Number(arg('floor', '0.25'));
const MODEL = 'gemini-3.8-flash-low';
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

// ---- template: the #6740 correction template (0601ef30) made two-draft as #7567 arm d did, plus the diff block ----
const TPL = fs.readFileSync(path.join(HERE, '..', 'euro-gpu-correct-7567', 'prompts', 'agy-0601ef30e816f7a7.txt'), 'utf8');
const swap = (s, a, b) => { if (!s.includes(a)) throw new Error(`template phrase missing: ${a.slice(0, 60)}`); return s.split(a).join(b); };
function twoDraftTemplate() {
  let t = TPL;
  t = swap(t, 'The draft, between the lines DRAFT START and DRAFT END below, is the transcription a library currently gives readers for that page, made by an OCR engine. It may contain',
    'Two drafts follow, between the lines DRAFT 1 START and DRAFT 1 END and the lines DRAFT 2 START and DRAFT 2 END: two independent transcriptions of that page, each made by a different OCR engine. Where they disagree, neither is presumed right: the image decides. Each may contain');
  t = swap(t, 'Check the draft against the image line by line', 'Check the drafts against the image line by line');
  t = swap(t, '`UNCHANGED` (that word alone) — the draft is a faithful', '`UNCHANGED` (that word alone) — DRAFT 1 is a faithful');
  t = swap(t, '— the draft is not this leaf\'s text', '— neither draft is this leaf\'s text');
  t = swap(t, 'even where the draft uses older tags', 'even where a draft uses older tags');
  t = swap(t, 'Keep the draft\'s conventions and layout', 'Keep DRAFT 1\'s conventions and layout');
  t = swap(t, 'add what the draft left out', 'add what the drafts left out');
  t = swap(t, 'DRAFT START\n{draft}\nDRAFT END', 'DRAFT 1 START\n{draft}\nDRAFT 1 END\n\nDRAFT 2 START\n{draft2}\nDRAFT 2 END\n\n{diff}');
  return t;
}
// Round texts. r1: the diff as a numbered list of disagreements, each to be settled on the image.
const DIFF_INTRO = {
  1: 'WHERE THE DRAFTS DISAGREE. The two drafts were aligned word by word; below, numbered in reading order, is every place where they differ (spelling, letters, words, lines one draft has and the other lacks). Settle EACH listed place by looking at that spot in the image: write what the page prints there, which may be draft 1, draft 2 or neither. Places where the drafts agree can still both be wrong (the engines share habits: long s read as f, u/v, dropped marginal notes), so still read the whole page, but the listed places are where most errors are.',
};
const TEMPLATE = twoDraftTemplate();

// D2: one more pass over D's own output (round r of D2 reads D-r<from round>).
const PASS2 = (() => {
  let t = TPL;
  t = swap(t, '**This call: correct one existing transcription against the page image.** The image, attached at the end of this message, is a page of one book. The draft, between the lines DRAFT START and DRAFT END below, is the transcription a library currently gives readers for that page, made by an OCR engine.',
    '**This call: check a corrected transcription against the page image.** The image, attached at the end of this message, is a page of one book. The draft, between the lines DRAFT START and DRAFT END below, is a corrected transcription of that page, made by reconciling two OCR engines\' readings against the image. Below it is the list of places where those two engines disagreed, and which reading the draft kept.');
  t = swap(t, 'DRAFT START\n{draft}\nDRAFT END', 'DRAFT START\n{draft}\nDRAFT END\n\n{diff}');
  return t;
})();

/** A GPU engine's raw reply as text (fences off, CHURRO's XML as lines) — e2-correct.mjs draftText, unchanged. */
function draftText(t) {
  t = String(t || '').replace(/^\s*```[a-zA-Z]*\s*$/gm, '');
  if (/<HistoricalDocument|<Metadata>/.test(t)) {
    t = t.replace(/<Metadata>[\s\S]*?<\/Metadata>/g, '').replace(/<\/(Line|Paragraph|Heading|PageNumber|Header|Footer)>/g, '\n')
      .replace(/<[^>\n]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n\s*\n\s*\n+/g, '\n\n')
      .split('\n').map((l) => l.trim()).join('\n');
  }
  return t.trim();
}
const loadDrafts = (e) => Object.fromEntries(fs.readFileSync(path.join(J, 'drafts', `${e}.jsonl`), 'utf8').split('\n').filter(Boolean)
  .map((l) => JSON.parse(l)).map((r) => [r.page_id || r.slug, draftText(r.text)]));
const X = loadDrafts('X'); const Y = loadDrafts('Y');

// ---- the diff ----
const TAGLINE = /^\s*<(scan-quality|language|script|page-type|vocab|meta|warning|columns|page-num|sig|header)\b[^>]*>.*<\/\1>\s*$/i;
const words = (t) => String(t).split('\n').filter((l) => !TAGLINE.test(l)).join('\n').split(/\s+/).filter(Boolean);
const key = (w) => w.normalize('NFC').toLowerCase().replace(/ſ/g, 's').replace(/[^\p{L}\p{N}]/gu, '');
const MAXD = 150;
/** Numbered disagreements between a and b ({A,B} labels), each with 3 words of shared context before it. */
function diffList(a, b, la, lb) {
  const A = words(a); const B = words(b);
  const parts = diffArrays(A, B, { comparator: (x, y) => key(x) === key(y) });
  const out = []; let ctx = []; let i = 0;
  while (i < parts.length) {
    const p = parts[i];
    if (!p.added && !p.removed) { ctx = p.value.slice(-3); i++; continue; }
    let ra = []; let rb = [];
    while (i < parts.length && (parts[i].added || parts[i].removed)) { if (parts[i].removed) ra = ra.concat(parts[i].value); else rb = rb.concat(parts[i].value); i++; }
    const clip = (w) => (w.length > 25 ? `${w.slice(0, 12).join(' ')} … (${w.length} words) … ${w.slice(-6).join(' ')}` : w.join(' ')) || '(nothing)';
    out.push(`${out.length + 1}. after "${ctx.join(' ')}": ${la} «${clip(ra)}» | ${lb} «${clip(rb)}»`);
  }
  return out;
}
function diffBlock(a, b, la, lb, intro) {
  const d = diffList(a, b, la, lb);
  if (!d.length) return `${intro}\n(The two texts agree word for word.)`;
  const shown = d.slice(0, MAXD);
  return `${intro}\n${shown.join('\n')}${d.length > MAXD ? `\n(… and ${d.length - MAXD} more places; the texts differ widely: read the whole page against the image.)` : ''}`;
}

function quota() {
  const r = spawnSync('agy', ['-p', '/quota', '--output-format', 'json'], { encoding: 'utf8', timeout: 60000 });
  try { return JSON.parse(r.stdout).command.data.groups.find((x) => /gemini/i.test(x.name)).buckets.find((b) => b.window === 'weekly').remaining_fraction; } catch { return null; }
}

const panel = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'euro-gpu-correct-7567', 'panel.json'), 'utf8')).pages;
const only = arg('only') ? new Set(fs.readFileSync(arg('only'), 'utf8').split('\n').filter(Boolean)) : null;
const FROM = ARM === 'D2' ? arg('from') : null;
if (ARM === 'D2' && !FROM) { console.error('--from=<D arm dir> required'); process.exit(2); }
const prior = (s) => { try { return JSON.parse(fs.readFileSync(path.join(FROM, `${s}.json`), 'utf8')); } catch { return null; } };
const ok = (t) => t && t.replace(/\W/g, '').length >= 30;
const todo = panel.filter((p) => (!only || only.has(p.slug)) && !fs.existsSync(path.join(OUT, `${p.slug}.json`)) && ok(X[p.slug]) && ok(Y[p.slug])
  && (ARM === 'D' || ok(prior(p.slug)?.final)));
const tplNow = ARM === 'D' ? TEMPLATE : PASS2;
fs.mkdirSync(path.join(J, 'e2', 'prompts'), { recursive: true });
fs.writeFileSync(path.join(J, 'e2', 'prompts', `${ARM}-r${ROUND}-${hash(tplNow + (DIFF_INTRO[ROUND] || ''))}.txt`), `${tplNow}\n\n---- {diff} intro ----\n${DIFF_INTRO[ROUND] || ''}`);
console.log(`${ARM} r${ROUND}: ${todo.length} pages, template ${hash(tplNow + (DIFF_INTRO[ROUND] || ''))}`);

function sentFor(p) {
  if (ARM === 'D') {
    const diff = diffBlock(X[p.slug], Y[p.slug], 'DRAFT 1', 'DRAFT 2', DIFF_INTRO[ROUND]);
    return { sent: `${TEMPLATE.split('{draft}').join(X[p.slug]).split('{draft2}').join(Y[p.slug]).split('{diff}').join(diff)} @./page.jpg`, d1: X[p.slug] };
  }
  const own = prior(p.slug).final;
  // The engines' disagreements, each with what the draft (D's output) kept at that place: the diff of draft 1 vs
  // draft 2, then each side's agreement with D's output, by the same word alignment.
  const intro = 'WHERE THE TWO ENGINES DISAGREED, and what the draft above kept. Each numbered line gives the two engines\' readings at a place they differed. Look at each place in the image and make sure the draft has what the page prints there (it may be either reading or neither). Also check the rest of the draft for any word, number or line the page does not support, and anything the page prints that the draft lacks.';
  const diff = diffBlock(X[p.slug], Y[p.slug], 'ENGINE 1', 'ENGINE 2', intro);
  return { sent: `${PASS2.split('{draft}').join(own).split('{diff}').join(diff)} @./page.jpg`, d1: own };
}

// --dump-sent=DIR: write the exact prompt each listed page was (or would be) sent as DIR/<slug>.txt and stop, with no
// call. write-back.mjs uses it to hash-check a read's provenance against its record (`sent_hash`).
if (arg('dump-sent')) {
  fs.mkdirSync(arg('dump-sent'), { recursive: true });
  for (const p of panel.filter((q) => (!only || only.has(q.slug)) && ok(X[q.slug]) && ok(Y[q.slug]) && (ARM === 'D' || ok(prior(q.slug)?.final)))) fs.writeFileSync(path.join(arg('dump-sent'), `${p.slug}.txt`), sentFor(p).sent);
  process.exit(0);
}

let stop = null; let n = 0; let sinceQuota = 1e9; const qlog = path.join(J, 'e2', 'quota.jsonl');
async function one(p) {
  const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', `d-${ARM}-`));
  fs.copyFileSync(path.join(J, 'img', `${p.slug}.jpg`), path.join(ws, 'page.jpg'));
  const gate = installToolGate(ws);
  const { sent, d1 } = sentFor(p);
  let res = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await agyCall(['-p', sent, '--model', MODEL, ...CLI_SAFE_ARGS], ws);
    if (r.cls === 'quota') { stop = `agy quota: ${r.err}`; break; }
    const { text, problem } = unwrapRead(r.text);
    const meta = { slug: p.slug, arm: ARM, round: ROUND, model: MODEL, secs: Math.round(r.secs * 10) / 10, usage: r.usage, template_hash: hash(tplNow + (DIFF_INTRO[ROUND] || '')),
      sent_hash: hash(sent), sent_chars: sent.length, attempt, tool_calls: gateCalls(gate), cls: r.cls, wrapper: problem };
    if (r.cls || problem) { res = { ...meta, outcome: 'no-answer', reason: r.cls || problem, raw: (r.text || '').slice(0, 2000) }; if (!attempt) continue; break; }
    const ans = parseAnswer(text);
    res = { ...meta, ...ans };
    if (ans.outcome === 'no-answer' && !attempt) continue;
    break;
  }
  fs.rmSync(ws, { recursive: true, force: true });
  if (!res || stop) return null;
  res.final = res.outcome === 'corrected' ? res.text : res.outcome === 'unchanged' ? d1 : '';
  return res;
}
const queue = [...todo];
await Promise.all(Array.from({ length: CONC }, async () => {
  while (queue.length && !stop) {
    if (sinceQuota >= 40) {
      sinceQuota = 0; const q = quota();
      fs.appendFileSync(qlog, JSON.stringify({ at: new Date().toISOString(), arm: `${ARM}-r${ROUND}`, done: n, weekly_remaining: q }) + '\n');
      if (q != null && q < FLOOR) { stop = `weekly remaining ${q} < floor ${FLOOR}`; break; }
    }
    const p = queue.shift(); sinceQuota++;
    const res = await one(p);
    if (!res) break;
    res.finished_at = new Date().toISOString();
    fs.writeFileSync(path.join(OUT, `${p.slug}.json`), JSON.stringify(res, null, 1));
    if (++n % 10 === 0) console.log(`  ${ARM}: ${n}/${todo.length} (${p.slug}: ${res.outcome}, ${res.secs}s)`);
  }
}));
console.log(`${ARM} r${ROUND}: ${n} pages answered${stop ? `; STOPPED: ${stop}` : ''}`);
if (stop) process.exit(3);
