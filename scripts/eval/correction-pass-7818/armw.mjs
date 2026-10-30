#!/usr/bin/env node
// PRIOR ART: scripts/eval/harvest-wikisource-gt.mjs (the harvest, run unchanged but for --ref-chars, which keeps the
// whole page as the reference), scripts/batch/realtime-ocr.mjs callGemini (the production Flash-Lite request: live OCR
// prompt, temperature 0.1, 16384 tokens, thinking 0; made here through scripts/lib/gemini-script-client.mjs so it is
// metered), scripts/eval/flash-reread-5924/fc-prompt.mjs (the lane's correction template, built the way
// cli-ocr-lane.mjs builds it). No Wikisource page is ever written anywhere but OUT.
/**
 * Arm W (#7818, PREREGISTRATION §W): human-proofread Wikisource pages (de, fr; 1500-1850; level 4, else 3) that we do
 * not hold; a Flash-Lite draft on the production OCR request; the lane's agy Flash-low correction of that draft.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/correction-pass-7818/armw.mjs harvest
 *   ... armw.mjs holdings     drop works we hold (title + year match against books)
 *   ... armw.mjs drafts       Flash-Lite drafts (paid API, flash-lite only, hard cap $3)
 *   ... armw.mjs correct [--agy-home=DIR]    the lane's correction of each draft (agy, subscription)
 *   Amendment 1, W-G (GPU draft, then the #7567 arm-c correction over the stored lite draft):
 *   ... armw.mjs gpu-collect   PERO drafts made on gex45 (pero-draft.py, the #7263 TEST's CPU config) -> texts/W-<slug>.gpu.txt
 *   ... armw.mjs gpu-correct [--agy-home=DIR]   agy Flash-low on the GPU template, served by servedArmc (E3 put-back)
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MongoClient } from 'mongodb';
import { OUT, ROOT, J, W, sha, SEED, arg, imageFor, correctionRead, servedCorrection, servedArmc, shuffle, makeRng } from './lib.mjs';
import { CORRECT_MODEL, GPU_TEMPLATE } from '../../batch/cli-ocr-lane.mjs';
import { contentHash } from '../../lib/write-provenance.mjs';

export const PER_LANGUAGE = 40;
export const WIKIS = ['de', 'fr'];
export const YEARS = [1500, 1850];
export const DRAFT_MODEL = 'gemini-3.1-flash-lite';
export const COST_CAP_USD = 3;
const PRICE = { input: 0.25, output: 1.5 };   // scripts/lib/model-pricing.mjs gemini-3.1-flash-lite, $ per 1M tokens
const LANG = { de: 'German', fr: 'French' };

function harvest() {
  for (const wiki of WIKIS) for (const level of [4, 3]) {
    const dir = path.join(OUT, 'ws', `L${level}`);
    if (fs.existsSync(path.join(dir, `${wiki}-${YEARS[0]}-${YEARS[1]}.json`))) continue;
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/eval/harvest-wikisource-gt.mjs'), `--wiki=${wiki}`, `--from=${YEARS[0]}`, `--to=${YEARS[1]}`, `--level=${level}`,
      `--max=${PER_LANGUAGE * 2}`, `--seed=${SEED.wikisource}`, '--ref-chars=0', `--out=${dir}`], { stdio: 'inherit' });
    if (r.status) throw new Error(`harvest ${wiki} L${level} exited ${r.status}`);
  }
}

const fold = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/ſ/g, 's');
const titleWords = (s) => fold(s).split(/[^a-z]+/).filter((w) => w.length >= 4).slice(0, 6);
/**
 * A work is HELD when a book in `books` (any visibility) has a year within 2 of it and shares at least 60% of the
 * first six 4+-letter title words (and at least two). Level-4 pages first, in harvest order; then level-3 pages of works
 * not yet taken; first PER_LANGUAGE per language.
 */
async function holdings() {
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
  const kept = [], dropped = [];
  try {
    for (const wiki of WIKIS) {
      const pages = [4, 3].flatMap((L) => { const f = path.join(OUT, 'ws', `L${L}`, `${wiki}-${YEARS[0]}-${YEARS[1]}.json`); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).pages : []; });
      const works = new Set(); let n = 0;
      for (const p of pages) {
        if (n >= PER_LANGUAGE || works.has(p.commons_file)) continue;
        const tw = titleWords(p.work);
        let held = null;
        if (tw.length >= 2) {
          const cands = await db.collection('books').find({ year: { $gte: p.year - 2, $lte: p.year + 2 }, title: { $regex: tw[0].slice(0, 6), $options: 'i' } }, { projection: { id: 1, title: 1, year: 1 } }).limit(200).toArray();
          held = cands.find((b) => { const bw = new Set(titleWords(b.title)); const k = tw.filter((w) => bw.has(w)).length; return k >= 2 && k / tw.length >= 0.6; }) ?? null;
        }
        if (held) { dropped.push({ slug: p.slug, work: p.work, year: p.year, held_as: { id: held.id, title: String(held.title).slice(0, 80), year: held.year } }); continue; }
        works.add(p.commons_file); n++;
        kept.push({ arm: 'W', lang: wiki, language: LANG[wiki], ...p, ref_sha: sha(p.reference).slice(0, 16), ref_chars: p.reference.length });
      }
    }
  } finally { await c.close(); }
  W('ws/set.json', { at: new Date().toISOString(), rule: 'held = a book within 2 years sharing >= 60% (and >= 2) of the first six 4+-letter title words', kept, dropped });
  console.log(`kept ${kept.length} (${WIKIS.map((w) => `${w} ${kept.filter((k) => k.lang === w).length}`).join(', ')}); dropped as held ${dropped.length}`);
}

async function drafts() {
  const { callGemini } = await import('../../lib/gemini-script-client.mjs');
  const { liveOcrPrompt } = await import('../../lib/live-ocr-prompt.mjs');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const { base, ref } = await liveOcrPrompt(c.db('bookstore')); await c.close();
  const set = J('ws/set.json').kept;
  const ledger = path.join(OUT, 'ws', 'drafts.jsonl');
  const done = new Map((fs.existsSync(ledger) ? fs.readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []).map((r) => [r.slug, r]));
  let usd = [...done.values()].reduce((a, r) => a + (r.usd || 0), 0);
  fs.mkdirSync(path.join(OUT, 'texts'), { recursive: true });
  for (const p of set) {
    if (done.get(p.slug)?.text_chars) continue;
    if (usd >= COST_CAP_USD) { console.log(`cost cap $${COST_CAP_USD} reached: stop`); break; }
    const img = await imageFor(`W-${p.slug}`, p.image_url);
    let res, err = null;
    try {
      res = await callGemini({ model: DRAFT_MODEL, prompt: base, imageParts: img, endpoint: 'scripts/eval/correction-pass-7818/armw.mjs', temperature: 0.1, maxOutputTokens: 16384, thinkingBudget: 0, type: 'ocr', triggeredBy: 'eval-7818' });
    } catch (e) { err = String(e.message || e).slice(0, 200); }
    const cost = res ? (res.inputTokens * PRICE.input + (res.outputTokens + (res.thinkingTokens || 0)) * PRICE.output) / 1e6 : 0;
    usd += cost;
    const text = res?.text ?? '';
    if (text) fs.writeFileSync(path.join(OUT, 'texts', `W-${p.slug}.draft.txt`), text);
    const row = { slug: p.slug, model: DRAFT_MODEL, prompt: ref, prompt_sha: sha(base).slice(0, 16), finish: res?.finishReason ?? null, input_tokens: res?.inputTokens ?? 0, output_tokens: res?.outputTokens ?? 0, usd: +cost.toFixed(5), text_chars: text.length, image_sha: sha(img).slice(0, 16), err, at: new Date().toISOString() };
    fs.appendFileSync(ledger, JSON.stringify(row) + '\n');
    console.log(`  ${p.slug}: ${text.length} chars ${row.finish ?? err ?? ''} $${cost.toFixed(4)} (total $${usd.toFixed(3)})`);
  }
  console.log(`drafts: total $${usd.toFixed(3)}`);
}

async function correct() {
  if (arg('agy-home')) process.env.AGY_HOME = path.resolve(arg('agy-home'));
  const TPL = path.join(OUT, 'ws', 'fc-correct-prompt.txt');
  if (!fs.existsSync(TPL)) { const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/eval/flash-reread-5924/fc-prompt.mjs'), TPL], { stdio: 'inherit', env: process.env }); if (r.status) throw new Error('fc-prompt.mjs refused'); }
  const template = fs.readFileSync(TPL, 'utf8');
  const set = J('ws/set.json').kept;
  const ledger = path.join(OUT, 'ws', 'corrections.jsonl');
  const done = new Set(fs.existsSync(ledger) ? fs.readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !r.quota).map((r) => r.slug) : []);
  for (const p of shuffle(set, makeRng(SEED.queue))) {
    if (done.has(p.slug)) continue;
    const df = path.join(OUT, 'texts', `W-${p.slug}.draft.txt`);
    if (!fs.existsSync(df)) continue;
    const draft = fs.readFileSync(df, 'utf8');
    const img = await imageFor(`W-${p.slug}`, p.image_url);
    const ws = path.join(OUT, 'ws', 'agy', p.slug); fs.rmSync(ws, { recursive: true, force: true });
    const r = await correctionRead({ template, draft, imageBuf: img, ws, key: p.slug, model: CORRECT_MODEL });
    if (r.quota) { console.log(`quota (${r.err}; until ${r.locked_until}): stop, the next run resumes`); break; }
    const s = servedCorrection(r, draft, { languages: [p.language] });
    fs.writeFileSync(path.join(OUT, 'texts', `W-${p.slug}.read.txt`), r.text);
    fs.writeFileSync(path.join(OUT, 'texts', `W-${p.slug}.served.txt`), s.served);
    fs.appendFileSync(ledger, JSON.stringify({ slug: p.slug, model: CORRECT_MODEL, template_hash: contentHash(template), outcome: s.outcome, why: s.why, exit: r.exit, cls: r.cls, wrapper: r.wrapper, calls: r.calls, nudged: r.nudged, rereads: r.rereads, prompt_sha: r.prompt_sha, usage: r.usage, agy_home: process.env.AGY_HOME || null, at: new Date().toISOString() }) + '\n');
    fs.rmSync(ws, { recursive: true, force: true });
    console.log(`  ${p.slug}: ${s.outcome} (${s.why})`);
  }
}

export const GEX45 = 'root@65.108.136.89', WG_REMOTE = '/root/jobs/correction-pass-7818/wg';
/** The PERO drafts (scripts/batch/pero-draft.py <img dir> <out> --device=cpu, run on gex45 over OUT/wg/img). */
async function gpuCollect() {
  const f = path.join(OUT, 'wg', 'pero-drafts.json');
  if (!fs.existsSync(f)) { const r = spawnSync('scp', ['-q', `${GEX45}:${WG_REMOTE}/pero-drafts.json`, f]); if (r.status) throw new Error('scp pero-drafts.json failed'); }
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  let n = 0, short = 0, badImage = 0;
  for (const p of J('ws/set.json').kept) {
    const x = d[p.slug]; if (!x) continue;
    const img = path.join(OUT, 'img', `W-${p.slug}.jpg`);
    if (!fs.existsSync(img) || sha(fs.readFileSync(img)) !== x.image_sha256) { badImage++; continue; }
    if (String(x.text || '').replace(/\W/g, '').length < 30) { short++; continue; }   // the GPU-draft read's own floor
    fs.writeFileSync(path.join(OUT, 'texts', `W-${p.slug}.gpu.txt`), x.text); n++;
  }
  W('wg/collect.json', { engine: d._engine, drafts: n, under_30_word_chars: short, image_mismatch: badImage });
  console.log(`gpu-collect: ${n} drafts (${short} under 30 word characters, ${badImage} image mismatches); engine ${JSON.stringify(d._engine)?.slice(0, 200)}`);
}

async function gpuCorrect() {
  if (arg('agy-home')) process.env.AGY_HOME = path.resolve(arg('agy-home'));
  const template = fs.readFileSync(path.join(ROOT, GPU_TEMPLATE.file), 'utf8');
  if (contentHash(template) !== GPU_TEMPLATE.hash) throw new Error(`GPU template hash ${contentHash(template)} is not the lane's ${GPU_TEMPLATE.hash}`);
  const set = J('ws/set.json').kept;
  const ledger = path.join(OUT, 'wg', 'corrections.jsonl');
  const done = new Set(fs.existsSync(ledger) ? fs.readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => r.slug) : []);
  for (const p of shuffle(set, makeRng(SEED.queue + 3))) {
    const gf = path.join(OUT, 'texts', `W-${p.slug}.gpu.txt`), lf = path.join(OUT, 'texts', `W-${p.slug}.draft.txt`);
    if (done.has(p.slug) || !fs.existsSync(gf) || !fs.existsSync(lf)) continue;
    const gpu = fs.readFileSync(gf, 'utf8'), lite = fs.readFileSync(lf, 'utf8');
    const ws = path.join(OUT, 'wg', 'agy', p.slug); fs.rmSync(ws, { recursive: true, force: true });
    const r = await correctionRead({ template, draft: gpu, imageBuf: await imageFor(`W-${p.slug}`, p.image_url), ws, key: p.slug, model: CORRECT_MODEL });
    if (r.quota) { console.log(`quota (${r.err}): stop, the next run resumes`); break; }
    const s = servedArmc(r, lite, { languages: [p.language], language: p.language });
    fs.writeFileSync(path.join(OUT, 'texts', `W-${p.slug}.gpuread.txt`), r.text);
    fs.writeFileSync(path.join(OUT, 'texts', `W-${p.slug}.gpuserved.txt`), s.served);
    fs.appendFileSync(ledger, JSON.stringify({ slug: p.slug, model: CORRECT_MODEL, template_hash: GPU_TEMPLATE.hash, outcome: s.outcome, why: s.why, put_back: s.put_back ?? null, flags: s.flags ?? null, exit: r.exit, cls: r.cls, wrapper: r.wrapper, calls: r.calls, prompt_sha: r.prompt_sha, agy_home: process.env.AGY_HOME || null, at: new Date().toISOString() }) + '\n');
    fs.rmSync(ws, { recursive: true, force: true });
    console.log(`  ${p.slug}: ${s.outcome} (${s.why})`);
  }
}

const stages = { harvest, holdings, drafts, correct, 'gpu-collect': gpuCollect, 'gpu-correct': gpuCorrect };
if (!stages[process.argv[2]]) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
await stages[process.argv[2]]();
