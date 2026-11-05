#!/usr/bin/env node
// PRIOR ART: scripts/batch/claude-ocr.mjs — the Opus read (live OCR prompt + language slot, `callInstruction`,
// `splitPages`, the sealed `claudeCall`), imported here unchanged. That script reads Mongo pages only and groups up to
// 10 pages of a book per call; the #7567 panel is partly not ours (DTA, Wikisource) and arm O is one page per call, so
// this drives the same call over the panel's images on disk. cli-ocr.mjs apply still writes (via write-back.mjs).
/**
 * o-read.mjs — #7263 arm O: Opus reads the page image directly, one page per call.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local o-read.mjs [--only=<slug file>] [--conc=3] [--max-weekly=85]
 *
 * Reads $J/img/<slug>.jpg; writes $J/O/<slug>.json {slug, outcome: read|no-answer, final, text, usage, secs, sent_hash}.
 * Before every 20 calls it reads the climits meter for this box's login and stops at --max-weekly (brief: 85%).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { claudeCall, callInstruction, splitPages, languageInstruction } from '../../batch/claude-ocr.mjs';
import { liveOcrPrompt } from '../../lib/live-ocr-prompt.mjs';
import { ocrReadProblem } from '../../lib/cli-chatter.mjs';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const J = process.env.J || '/root/jobs/gpu-flash-vs-opus-7263';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(J, 'O'); fs.mkdirSync(path.join(OUT, 'prompts'), { recursive: true });
const CONC = Number(arg('conc', '3')); const MAXW = Number(arg('max-weekly', '85'));
const LANG = { la: 'Latin', en: 'English', de: 'German', fr: 'French', it: 'Italian' };
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

function weeklyPct() {
  try {
    const me = JSON.parse(fs.readFileSync('/root/.claude.json', 'utf8')).oauthAccount.emailAddress;
    const d = JSON.parse(fs.readFileSync('/root/.claude-limits/latest.json', 'utf8'));
    const a = d.accounts.find((x) => x.email === me && x.ok);
    return a?.limits.find((l) => l.key === 'weekly_all:all')?.percent ?? null;
  } catch { return null; }
}

const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 60000 }); await client.connect();
const db = client.db('bookstore');
const prompts = {};
for (const [k, name] of Object.entries(LANG)) prompts[k] = await liveOcrPrompt(db, languageInstruction(name));
await client.close();
fs.writeFileSync(path.join(OUT, 'prompt-ref.json'), JSON.stringify(prompts.la.ref));

const panel = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'euro-gpu-correct-7567', 'panel.json'), 'utf8')).pages;
const only = arg('only') ? new Set(fs.readFileSync(arg('only'), 'utf8').split('\n').filter(Boolean)) : null;
const done = (s) => { try { return JSON.parse(fs.readFileSync(path.join(OUT, `${s}.json`), 'utf8')).outcome === 'read'; } catch { return false; } };
const todo = panel.filter((p) => (!only || only.has(p.slug)) && !done(p.slug));
console.log(`O: ${todo.length} pages, prompt ${prompts.la.ref.name} v${prompts.la.ref.version}, ${CONC} at a time`);

let stop = null; let n = 0; let since = 1e9;
async function one(p) {
  const sent = prompts[p.lang].base + callInstruction(1);
  const sh = hash(sent); const pf = path.join(OUT, 'prompts', `${sh}.txt`); if (!fs.existsSync(pf)) fs.writeFileSync(pf, sent);
  const img = fs.readFileSync(path.join(J, 'img', `${p.slug}.jpg`));
  let res = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'o-read-'));
    fs.writeFileSync(path.join(dir, 'p01.jpg'), img);
    const r = await claudeCall(sent, 'opus', dir);
    fs.rmSync(dir, { recursive: true, force: true });
    if (r.cls === 'usage_limit') { stop = `usage limit: ${r.err}`; return null; }
    const texts = r.cls ? null : splitPages(r.text, 1);
    const text = texts?.[0] ?? '';
    const problem = r.cls || (!texts ? 'page_marker_mismatch' : ocrReadProblem(text) || (text.replace(/\W/g, '').length < 30 ? 'too_short' : null));
    res = { slug: p.slug, arm: 'O', model: r.model, secs: Math.round(r.secs * 10) / 10, usage: r.usage, sent_hash: sh, prompt_ref: prompts[p.lang].ref,
      image_sha256: crypto.createHash('sha256').update(img).digest('hex'), attempt, outcome: problem ? 'no-answer' : 'read', reason: problem, text, raw: problem ? r.text.slice(0, 3000) : undefined };
    if (!problem) break;
  }
  res.final = res.outcome === 'read' ? res.text : '';
  return res;
}
const queue = [...todo];
await Promise.all(Array.from({ length: CONC }, async () => {
  while (queue.length && !stop) {
    if (since >= 20) { since = 0; const w = weeklyPct(); fs.appendFileSync(path.join(J, 'meter.jsonl'), JSON.stringify({ at: new Date().toISOString(), arm: 'O', done: n, weekly_pct: w }) + '\n'); if (w != null && w >= MAXW) { stop = `weekly ${w}% >= ${MAXW}%`; break; } }
    const p = queue.shift(); since++;
    const res = await one(p);
    if (!res) break;
    res.finished_at = new Date().toISOString();
    fs.writeFileSync(path.join(OUT, `${p.slug}.json`), JSON.stringify(res, null, 1));
    if (++n % 10 === 0) console.log(`  O: ${n}/${todo.length} (${p.slug}: ${res.outcome}, ${res.secs}s)`);
  }
}));
console.log(`O: ${n} pages${stop ? `; STOPPED: ${stop}` : ''}`);
if (stop) process.exit(3);
