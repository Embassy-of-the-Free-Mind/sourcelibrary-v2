#!/usr/bin/env node
// PRIOR ART: run-chains.mjs of #6740 (PR #7468, `correct --by=agy`: the one-page agy Flash-low correction of a stored
// draft, agyCall + tool gate + unwrapRead + parseAnswer, template agy-0601ef30e816f7a7 from fc-prompt.mjs). That runner
// is keyed to the Pareto benches and their stored drafts; this one is that call, unchanged for one draft, over the #7567
// panel and any draft engine, plus two variants the issue's E2 needs: two drafts in one call (arm d) and a fresh read
// with no draft (arm e). cli-ocr.mjs correct mode needs Mongo pages; these pages are partly not ours (DTA, Wikisource).
/**
 * e2-correct.mjs — #7567 E2 arms through agy (Gemini 3.8 Flash low, MAIN pool), one page per call, image + draft(s).
 *
 *   node e2-correct.mjs --arm=<name> --drafts=<ENG[,ENG2]> --out=<dir> [--only=<slug file>] [--conc=4] [--floor=0.40]
 *     --drafts=L        one draft (arms a, a2, b, c): the #6740 template byte for byte, draft in {draft}
 *     --drafts=G,CH     two drafts (arm d): the same template with the draft sentence and block made plural
 *     --drafts=none     fresh read (arm e): the template's own OCR prompt (everything before "**This call"), no draft
 *     --no-image        the control Derek asked for (inbox 2026-10-27T21:15Z): the same prompt and draft(s), the attachment
 *                       (` @./page.jpg`) dropped and no image in the workspace — does the corrector read the page or recite?
 *                       Taken literally agy hunts for the file and answers CONTAIN / UNCHANGED (3/3 in the smoke test), which
 *                       measures nothing; --no-image=told puts one sentence where the attachment was (NOIMG_TOLD below).
 *   Drafts come from $J/drafts/<ENG>.jsonl ({page_id, text}); the image from $J/img/<slug>.jpg.
 *   --panel=FILE      (#7567 E5) another panel (e5-draw.mjs's panel.json) instead of E0's; its pages run interleaved, the
 *                     k-th page of every book before any book's (k+1)-th, so a quota stop leaves a balanced sample.
 *   Writes <out>/<arm>/<slug>.json. Before every 40 calls it reads `agy -p /quota`; it stops when the Gemini weekly
 *   remaining_fraction is under --floor (brief: 0.40). Never sets AGY_HOME (the main pool is agy's default home).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { agyCall, installToolGate, gateCalls, unwrapRead, CLI_SAFE_ARGS } from '../../lib/agy-cli.mjs';
import { parseAnswer } from '../../batch/ocr-convergence/correct.mjs';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const J = process.env.J || '/root/jobs/euro-gpu-correct-7567';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const ARM = arg('arm'); const DRAFTS = (arg('drafts') || '').split(',').filter((x) => x && x !== 'none');
const OUT = path.join(arg('out', path.join(J, 'e2')), ARM); fs.mkdirSync(OUT, { recursive: true });
const CONC = Number(arg('conc', '4')); const FLOOR = Number(arg('floor', '0.40'));
const MODEL = 'gemini-3.8-flash-low';
const NOIMG = process.argv.some((a) => a === '--no-image' || a.startsWith('--no-image='));
const NOIMG_TOLD = process.argv.includes('--no-image=told')
  ? ' (The page image could not be attached to this call. Correct the draft as well as you can without it; do not answer CONTAIN because the image is missing.)' : '';
if (NOIMG && !DRAFTS.length) { console.error('--no-image needs a draft'); process.exit(2); }
if (!ARM) { console.error('--arm required'); process.exit(2); }
if (process.env.AGY_HOME) { console.error(`AGY_HOME is set (${process.env.AGY_HOME}): this job runs on the main pool only`); process.exit(2); }

const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const TPL = fs.readFileSync(path.join(HERE, 'prompts', 'agy-0601ef30e816f7a7.txt'), 'utf8');
const CUT = TPL.indexOf('**This call: correct one existing transcription');
if (CUT < 0) { console.error('template changed: no correction block'); process.exit(1); }
const BASE = TPL.slice(0, CUT);
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
  t = swap(t, 'DRAFT START\n{draft}\nDRAFT END', 'DRAFT 1 START\n{draft}\nDRAFT 1 END\n\nDRAFT 2 START\n{draft2}\nDRAFT 2 END');
  return t;
}
const FRESH = `${BASE}Write your transcription of the page between two marker lines, <<<BEGIN>>> and <<<END>>>. Output nothing outside the markers: no preamble, no plan, no summary, no offers, no questions.\n\nThe page image:`;
const TEMPLATE = DRAFTS.length === 0 ? FRESH : DRAFTS.length === 1 ? TPL : twoDraftTemplate();
fs.mkdirSync(path.join(J, 'e2', 'prompts'), { recursive: true });
fs.writeFileSync(path.join(J, 'e2', 'prompts', `${ARM}-${hash(TEMPLATE)}.txt`), TEMPLATE);

/** A GPU engine's raw reply as a draft a reader would be shown: fences off, CHURRO's XML as lines of text. */
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
const D = DRAFTS.map(loadDrafts);

function quota() {
  const r = spawnSync('agy', ['-p', '/quota', '--output-format', 'json'], { encoding: 'utf8', timeout: 60000 });
  try {
    const g = JSON.parse(r.stdout).command.data.groups.find((x) => /gemini/i.test(x.name));
    return g.buckets.find((b) => b.window === 'weekly').remaining_fraction;
  } catch { return null; }
}

const PANEL = arg('panel');
let panel = JSON.parse(fs.readFileSync(PANEL || path.join(HERE, 'panel.json'), 'utf8')).pages;
if (PANEL) {
  const k = {}; panel = panel.map((p) => ({ ...p, _k: (k[p.book_id] = (k[p.book_id] ?? -1) + 1) }))
    .sort((a, b) => a._k - b._k || a.lang.localeCompare(b.lang) || a.book_id.localeCompare(b.book_id));
}
const only = arg('only') ? new Set(fs.readFileSync(arg('only'), 'utf8').split('\n').filter(Boolean)) : null;
const todo = panel.filter((p) => (!only || only.has(p.slug)) && !fs.existsSync(path.join(OUT, `${p.slug}.json`))
  && D.every((d) => d[p.slug] && d[p.slug].replace(/\W/g, '').length >= 30)
  && fs.existsSync(path.join(J, 'img', `${p.slug}.jpg`)));   // E5: two BSB pages served a tiny image and were never fetched
console.log(`${ARM}: ${todo.length} pages (drafts ${DRAFTS.join('+') || 'none'}), template ${hash(TEMPLATE)}`);

let stop = null; let n = 0; let sinceQuota = 1e9; const qlog = path.join(J, 'e2', 'quota.jsonl');
async function one(p) {
  const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', `e2-${ARM}-`));
  if (!NOIMG) fs.copyFileSync(path.join(J, 'img', `${p.slug}.jpg`), path.join(ws, 'page.jpg'));
  const gate = installToolGate(ws);
  const sent = `${TEMPLATE.split('{draft}').join(D[0]?.[p.slug] ?? '').split('{draft2}').join(D[1]?.[p.slug] ?? '')}${NOIMG ? NOIMG_TOLD : ' @./page.jpg'}`;
  let res = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await agyCall(['-p', sent, '--model', MODEL, ...CLI_SAFE_ARGS], ws);
    if (r.cls === 'quota') { stop = `agy quota: ${r.err}`; break; }
    const { text, problem } = unwrapRead(r.text);
    const meta = { slug: p.slug, arm: ARM, drafts: DRAFTS, no_image: NOIMG ? (NOIMG_TOLD ? 'told' : 'literal') : false, model: MODEL, secs: Math.round(r.secs * 10) / 10, usage: r.usage,
      template_hash: hash(TEMPLATE), sent_hash: hash(sent), attempt, tool_calls: gateCalls(gate), cls: r.cls, wrapper: problem };
    if (r.cls || problem) { res = { ...meta, outcome: 'no-answer', reason: r.cls || problem, raw: (r.text || '').slice(0, 2000) }; if (!attempt) continue; break; }
    const ans = DRAFTS.length ? parseAnswer(text) : (text.trim() ? { outcome: 'read', text } : { outcome: 'no-answer', reason: 'empty' });
    res = { ...meta, ...ans };
    if (ans.outcome === 'no-answer' && !attempt) continue;
    break;
  }
  fs.rmSync(ws, { recursive: true, force: true });
  if (!res || stop) return null;
  // The text a reader would get from this arm: a correction, the first draft when UNCHANGED, nothing on CONTAIN/no-answer.
  res.final = res.outcome === 'corrected' || res.outcome === 'read' ? res.text : res.outcome === 'unchanged' ? D[0][p.slug] : '';
  return res;
}
const queue = [...todo];
await Promise.all(Array.from({ length: CONC }, async () => {
  while (queue.length && !stop) {
    if (sinceQuota >= 40) {
      sinceQuota = 0; const q = quota();
      fs.appendFileSync(qlog, JSON.stringify({ at: new Date().toISOString(), arm: ARM, done: n, weekly_remaining: q }) + '\n');
      if (q != null && q < FLOOR) { stop = `weekly remaining ${q} < floor ${FLOOR}`; break; }
    }
    const p = queue.shift(); sinceQuota++;
    const res = await one(p);
    if (!res) break;
    res.finished_at = new Date().toISOString();
    fs.writeFileSync(path.join(OUT, `${p.slug}.json`), JSON.stringify(res, null, 1));
    if (++n % 20 === 0) console.log(`  ${ARM}: ${n}/${todo.length} (${p.slug}: ${res.outcome}, ${res.secs}s)`);
  }
}));
console.log(`${ARM}: ${n} pages answered${stop ? `; STOPPED: ${stop}` : ''}`);
if (stop) process.exit(3);
