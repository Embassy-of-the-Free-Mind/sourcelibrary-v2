#!/usr/bin/env node
// PRIOR ART: scripts/eval/judge-compare-7611/run.mjs (the 540 items, texts, stored Opus verdicts, adjudicatePrompt, the
// scorer's statistics — reused; this file adds DETECTOR arms that are not verdict prompts). scripts/eval/two-read-garble-5313.mjs
// (#5313: a re-read diff as a screen, against text-only judge labels; its agreement ratio is not a word-level hunk list,
// so it cannot point an adjudicator at spots). scripts/batch/cli-ocr.mjs `read --correct-prompt` (the live correction
// call, restated here because cli-ocr.mjs runs on import and writes a lane registry row). Folding: scripts/lib/latin-diffqa.mjs,
// scripts/lib/tibetan-yatags-guard.mjs, scripts/lib/correction-diff-guard.mjs (ABBR marks, not exported: restated), and
// the kyūjitai/shinjitai pairs of scripts/eval/benchmark-score.mjs (runs on import: restated).
/**
 * Correction diff (C), re-read diff (R) and strict Opus (S) as transcription detectors (#7611, 2026-11-02).
 * Preregistration: scripts/eval/experiments/2026-11-02-detector-tasks-7611.md.
 *
 *   node --env-file=… detect.mjs setup  --out=DIR --from=<#7807/#7918 jc dir>   (copies items/texts/verdicts; builds the prompts)
 *   node --env-file=… detect.mjs call   --arm=C|R|S --out=DIR [--concurrency=3]
 *   node detect.mjs diff --out=DIR                                               (scores C and R; $0)
 *   node --env-file=… detect.mjs adjudicate --out=DIR [--concurrency=3]
 *   node detect.mjs score --out=DIR
 *
 * Read-only on production: Mongo is read for the live OCR prompt only. Nothing is written to Mongo.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { judgePrompt, opusCall, parseVerdict } from '../route-judge-6740/judge.mjs';
import { parseJson } from '../translate-cli-lane-7075/sample.mjs';
import { scorePlant } from '../lib/plant-ocr-errors.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { wilson } from '../lib/agreement-stats.mjs';
import { wordTokens, classifyHunk, fold as latinFold } from '../../lib/latin-diffqa.mjs';
import { syllableTokens, alignSyllables } from '../../lib/tibetan-yatags-guard.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const h = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const OUT = path.resolve(arg('out') || path.join(process.env.JOB_SCRATCH || os.tmpdir(), 'dt'));
const P = (f) => path.join(OUT, f);
const J = (f) => JSON.parse(fs.readFileSync(P(f), 'utf8'));
const W = (f, x) => fs.writeFileSync(P(f), JSON.stringify(x, null, 1) + '\n');
const readJsonl = (f) => (fs.existsSync(f) ? (f.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(f)).toString() : fs.readFileSync(f, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const PLANTED = path.join(ROOT, 'scripts/eval/judge-planted-7611/results/2026-10-29');

export const MODEL_AGY = 'gemini-3.8-flash-low';   // cli-ocr-lane.mjs CORRECT_MODEL / FIRST_READ_MODEL
export const TEMPLATE_HASH = '0601ef30e816f7a7';     // fc-prompt.mjs, the live correction template (= GPU_TEMPLATE)
const IMG_OPUS = 'the file ./page.jpg in your working directory (open it with Read before you answer)';
// cli-ocr.mjs imageInstruction, variant sentinels-6523 (its default), with cli-chatter.mjs OCR_SENTINEL_INSTRUCTION.
const imageSentence = async () => `\n\nThe page image to transcribe is attached: @./page.jpg Transcribe it in the format above. ${(await import('../../lib/cli-chatter.mjs')).OCR_SENTINEL_INSTRUCTION}\n`;

// ── items ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export function stratum(x) {
  if (x.set === 'planted') return 'plant';
  if (x.author === 'GPU' && x.lang === 'Tibetan') return 'Tibetan GPU';
  if (/Chinese/.test(x.lang) && (x.author === 'GPU' || x.author === 'GPU>GEM')) return 'Chinese GPU, GPU>GEM';
  if (x.author === 'GPU>GEM') return 'Latin, Italian GPU>GEM';
  if (x.author === 'GEM' && /Hebrew|Arabic/.test(x.lang)) return 'Hebrew, Arabic';
  if (x.author === 'GEM') return 'Gemini reads';
  return 'other';
}
/** The preregistered frame: real transcription items, the 60-item plant subset (C, S), the 36 clean pages (S), the 36
 *  plant pages (R reads each once). */
function frame() {
  const items = J('items.json').filter((x) => x.task === 'ocr');
  const real = items.filter((x) => x.set === 'real');
  const planted = items.filter((x) => x.set === 'planted');
  const order = planted.filter((x) => x.kind !== 'A').map((x) => [h(`plantsub:7611:${x.id}`), x]).sort((a, b) => a[0].localeCompare(b[0])).map(([, x]) => x);
  const sub = []; const per = {};
  for (const x of order) if ((per[x.kind] = (per[x.kind] ?? 0) + 1) <= 15) sub.push(x);
  const clean = planted.filter((x) => x.kind === 'A');
  const plantPages = [...new Map(planted.map((x) => [x.page_id, x])).values()];
  return { items, real, planted, sub, clean, plantPages };
}

// ── setup ───────────────────────────────────────────────────────────────────────────────────────────────────────────
async function setup() {
  const from = arg('from'); if (!from) { console.error('--from=<jc dir>'); process.exit(2); }
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of ['items.json', 'frame.json', 'texts.json.gz', 'adjudications.jsonl', 'verdicts-flash-medium.jsonl', 'verdicts-flash.jsonl', 'verdicts-opus-repeat.jsonl']) fs.copyFileSync(path.join(from, f), P(f));
  // The live correction template (fc-prompt.mjs refuses if the live OCR prompt moved) and the live OCR prompt.
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/eval/flash-reread-5924/fc-prompt.mjs'), P('fc-correct-prompt.txt')], { encoding: 'utf8', env: process.env });
  if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
  const built = JSON.parse(r.stdout.trim().split('\n').pop());
  if (built.template_hash !== TEMPLATE_HASH) { console.error(`template ${built.template_hash} is not the live lane's ${TEMPLATE_HASH}`); process.exit(1); }
  const { MongoClient } = await import('mongodb'); const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const { liveOcrPrompt } = await import('../../lib/live-ocr-prompt.mjs');
  const { base, ref } = await liveOcrPrompt(c.db('bookstore')); await c.close();
  fs.writeFileSync(P('ocr-prompt-base.txt'), base);
  const F = frame();
  W('setup.json', { at: new Date().toISOString(), correction_template: built, ocr_prompt: ref, n: { real: F.real.length, plant_subset: F.sub.length, clean: F.clean.length, plant_pages: F.plantPages.length },
    plant_subset_by_kind: Object.fromEntries(Object.entries(Object.groupBy(F.sub, (x) => x.kind)).map(([k, v]) => [k, v.length])),
    strata: Object.fromEntries(Object.entries(Object.groupBy(F.real, stratum)).map(([k, v]) => [k, v.length])) });
  console.log(fs.readFileSync(P('setup.json'), 'utf8'));
}

// ── calls ───────────────────────────────────────────────────────────────────────────────────────────────────────────
async function image(pageId, url) {
  const dir = P('img'); fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${pageId}.jpg`);
  if (fs.existsSync(f)) return fs.readFileSync(f);
  const res = await fetch(url); if (!res.ok) throw new Error(`image_${res.status}`);
  const b = Buffer.from(await res.arrayBuffer()); fs.writeFileSync(f, b); return b;
}
async function poolQuota() {
  const { parseQuota } = await import('../../lib/agy-pools.mjs');
  for (let i = 0; i < 6; i++) { const q = parseQuota(spawnSync('agy', ['-p', '/quota', '--output-format', 'json'], { encoding: 'utf8', timeout: 90e3, env: process.env }).stdout || ''); if (q) return q; }
  return null;
}
async function agyRead(prompt, jpeg) {
  const agy = await import('../../lib/agy-cli.mjs');
  const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'dt-agy-'));
  try {
    fs.writeFileSync(path.join(ws, 'page.jpg'), jpeg);
    const log = agy.installToolGate(ws);
    const r = await agy.agyCall(['-p', prompt, '--model', MODEL_AGY, ...agy.CLI_SAFE_ARGS], ws);
    const u = agy.unwrapRead(r.text);
    return { ...r, answer: u.text, wrapper: u.problem, tools: agy.gateCalls(log) };
  } finally { fs.rmSync(ws, { recursive: true, force: true }); }
}
/** S: judgePrompt with its accept question replaced by the strict rule (preregistered wording). */
export const STRICT_ACCEPT = '- accept: false if the candidate has ANY word-level difference from the page (a wrong word, a wrong letter that makes another word, a wrong number or numeral), ANY dropped or added word or line, or ANY wrong name, title, running title, heading or folio number, however small. Spelling conventions never fail a page: variant or old/new character forms, abbreviations kept or written out, long s written as s, u/v and i/j, ligatures, accents written or not, punctuation, tsheg and shad, line breaks, hyphenation and the library\'s markup. Otherwise true.';
export function strictPrompt(input, imageRef) {
  const p = judgePrompt(input, imageRef);
  const lines = p.split('\n'); const i = lines.findIndex((l) => l.startsWith('- accept: would a reader'));
  if (i < 0) throw new Error('judgePrompt accept line moved: the strict rule no longer applies');
  lines[i] = STRICT_ACCEPT; return lines.join('\n');
}

async function call() {
  const arm = arg('arm'); if (!['C', 'R', 'S'].includes(arm)) { console.error('--arm=C|R|S'); process.exit(2); }
  const F = frame();
  const texts = JSON.parse(zlib.gunzipSync(fs.readFileSync(P('texts.json.gz'))));
  const work = arm === 'C' ? [...F.real, ...F.sub].map((x) => ({ key: x.id, x }))
    : arm === 'R' ? [...F.real.map((x) => ({ key: x.id, x })), ...F.plantPages.map((x) => ({ key: `page:${x.page_id}`, x }))]
    : [...F.real, ...F.sub, ...F.clean].map((x) => ({ key: x.id, x }));
  const vf = P(`out-${arm}.jsonl`);
  const prior = readJsonl(vf);
  const good = new Set(prior.filter((r) => r.ok).map((r) => r.key));
  const tries = new Map(); for (const r of prior) tries.set(r.key, (tries.get(r.key) ?? 0) + 1);
  const todo = work.filter((w) => !good.has(w.key) && (tries.get(w.key) ?? 0) < 3);
  const conc = Math.max(1, Math.min(6, Number(arg('concurrency') || 3)));
  const tpl = fs.readFileSync(P('fc-correct-prompt.txt'), 'utf8'), base = fs.readFileSync(P('ocr-prompt-base.txt'), 'utf8'), imgS = await imageSentence();
  const limits = await import('../../lib/model-limits.mjs');
  const q0 = arm !== 'S' ? await poolQuota() : null;
  if (arm !== 'S' && !q0) { console.error('no quota reading: the stop rule cannot run'); process.exit(3); }
  if (q0 && (q0.weekly < 0.15 || (q0.fiveHour ?? 1) < 0.30)) { console.error(`pool below the stop line at start: ${JSON.stringify(q0)}`); process.exit(3); }
  console.log(`${arm}: ${todo.length} of ${work.length} to call; quota ${JSON.stringify(q0 && { weekly: q0.weekly, fiveHour: q0.fiveHour })}`);
  let stop = null, next = 0, calls = 0, checkAt = 0;
  const one = async ({ key, x }) => {
    let jpeg; try { jpeg = await image(x.page_id, x.image_url); } catch (e) { fs.appendFileSync(vf, JSON.stringify({ key, arm, ok: false, cls: e.message }) + '\n'); return; }
    const t0 = Date.now(); calls++;
    let row;
    if (arm === 'S') {
      const T = texts[x.id];
      const prompt = strictPrompt({ task: 'ocr', lang: x.lang, text: T.text, reference: T.reference }, IMG_OPUS);
      const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'dt-opus-'));
      try {
        fs.writeFileSync(path.join(ws, 'page.jpg'), jpeg);
        const r = await opusCall(prompt, ws);
        if (r.cls === 'quota') { stop = 'claude quota'; limits.noteLimitHit?.('claude', { reason: r.text.slice(0, 200) }); return; }
        const v = parseVerdict(r.text);
        row = { key, arm, ok: !!v, verdict: v, cls: v ? null : (r.cls || 'unparsed'), raw: v ? undefined : String(r.text).slice(0, 400), model: r.model, usage: r.usage, list_usd: r.cost, prompt_sha: h(prompt).slice(0, 16) };
      } finally { fs.rmSync(ws, { recursive: true, force: true }); }
    } else {
      const prompt = arm === 'C' ? `${tpl.split('{draft}').join(texts[x.id].text)} @./page.jpg` : base + imgS;
      const r = await agyRead(prompt, jpeg);
      if (r.cls === 'quota') { stop = `quota: ${String(r.err || r.text).slice(0, 160)}`; return; }
      const answer = String(r.answer || '').trim();
      const kind = arm === 'C' && /^UNCHANGED\.?$/i.test(answer) ? 'unchanged' : arm === 'C' && /^CONTAIN\s*:/i.test(answer) && !/<page-type>/.test(answer) ? 'contain' : 'text';
      const ok = !r.cls && !!answer && (!r.wrapper || kind !== 'text');
      row = { key, arm, ok, kind, text: answer, wrapper: r.wrapper, cls: r.cls || (ok ? null : r.wrapper || 'empty'), raw: ok ? undefined : String(r.text).slice(0, 400), tools: r.tools, usage: r.usage, model: MODEL_AGY, prompt_sha: h(prompt).slice(0, 16) };
    }
    Object.assign(row, { id: x.id, page_id: x.page_id, secs: Math.round((Date.now() - t0) / 1000), at: new Date().toISOString() });
    fs.appendFileSync(vf, JSON.stringify(row) + '\n');
    console.log(`  ${key} ${x.set}/${x.author} ${x.kind ?? ''} ${x.lang}: ${row.ok ? (arm === 'S' ? `accept=${row.verdict.accept} ${row.verdict.fidelity}` : `${row.kind} ${row.text.length}c`) : row.cls} ${row.secs}s`);
  };
  const worker = async () => {
    while (!stop && next < todo.length) {
      if (arm !== 'S' && calls - checkAt >= 25) {
        checkAt = calls; const q = await poolQuota();
        if (q && (q.weekly < 0.15 || (q.fiveHour ?? 1) < 0.30)) { stop = `pool guard: weekly ${q.weekly}, 5h ${q.fiveHour}`; break; }
        console.log(`  [quota after ${calls}: weekly ${q?.weekly}, 5h ${q?.fiveHour}]`);
      }
      if (arm === 'S') { const b = limits.claudeBlocked({ weeklyMax: 85, sessionMax: 95 }); if (b) { stop = b.reason; break; } }
      await one(todo[next++]);
    }
  };
  await Promise.all(Array.from({ length: conc }, worker));
  const q1 = arm !== 'S' ? await poolQuota() : null;
  const runs = fs.existsSync(P('runs.json')) ? J('runs.json') : [];
  runs.push({ at: new Date().toISOString(), arm, calls, stop, quota_before: q0 && { weekly: q0.weekly, fiveHour: q0.fiveHour }, quota_after: q1 && { weekly: q1.weekly, fiveHour: q1.fiveHour } });
  W('runs.json', runs);
  console.log(`${arm}: ${calls} calls; ${stop ? `STOPPED: ${stop}` : 'done'}`);
  if (stop) process.exit(3);
}

// ── folding and the word diff ────────────────────────────────────────────────────────────────────────────────────────
const META_RE = /<(language|script|scan-quality|page-type|columns|meta|vocab|image-desc|warning|detected-images|split-position|lang|summary|keywords)\b[^>]*>[\s\S]*?<\/\1>/g;
const mask = (t) => String(t).normalize('NFC').replace(META_RE, (m) => ' '.repeat(m.length)).replace(/<[^<>\n]{0,200}>/g, (m) => ' '.repeat(m.length));
// benchmark-score.mjs KYU_SHIN (kyūjitai → shinjitai), restated; plus the two pairs the #7918 adjudicator called variants.
const KYU_SHIN = '氣気觸触發発傳伝禮礼醫医體体國国學学會会當当對対經経藥薬寶宝齊斉齋斎變変邊辺圓円廣広應応惡悪榮栄營営藝芸壓圧鹽塩澤沢擇択譯訳驛駅釋釈澁渋濕湿實実寫写收収從従縱縦讀読續続賣売讓譲亂乱亞亜圍囲爲為僞偽衞衛舊旧兒児條条處処與与齒歯齡齢壽寿圖図團団晝昼點点黨党燈灯獨独樂楽靈霊勞労勵励歷歴曆暦龍竜隸隷兩両獵猟錄録麥麦滿満萬万默黙彌弥譽誉餘余豫予嚴厳髓髄隨随數数樞枢聲声靜静濟済劑剤攝摂淺浅錢銭賤賎踐践纖繊專専戰戦禪禅單単彈弾斷断遲遅廳庁徵徴聽聴鎭鎮鐵鉄轉転屆届縣県驗験險険檢検劍剣顯顕權権勸勧觀観歡歓鑛鉱鑄鋳絲糸獸獣敍叙將将奬奨狀状乘乗剩剰淨浄燒焼稱称證証囑嘱眞真盡尽竊窃說説拜拝廢廃佛仏拂払辯弁辨弁步歩豐豊每毎黑黒龜亀假仮價価繪絵壞壊懷懐覺覚舉挙歸帰據拠徑径輕軽莖茎繼継惠恵鷄鶏缺欠儉倹圈圏獻献效効號号碎砕櫻桜參参慘惨產産蠶蚕贊賛殘残辭辞肅粛緖緒涉渉疊畳醉酔雙双壯壮莊荘裝装藏蔵臟臓總総騷騒增増屬属帶帯滯滞臺台擔担膽胆蟲虫貳弐惱悩腦脳霸覇髮髪拔抜晚晩蠻蛮濱浜搖揺樣様謠謡來来賴頼覽覧樓楼灣湾淚涙沒没稻稲廐厩冨富鬪闘關関陷陥隱隠靑青淸清敎教卽即槪概旣既溉漑硏研卷巻內内册冊咒呪曾曽溫温縕緼醬醤獎奨妝粧姊姉曉暁迴回廻回瀧滝籠篭鬭闘巳已弟第';
const KYU = new Map(); for (let i = 0; i + 1 < KYU_SHIN.length; i += 2) KYU.set(KYU_SHIN[i], KYU_SHIN[i + 1]);
const ABBR = /[̃̄̅̆̑ͣ-ͯꝑꝓꝗꝙꝯꝰ⁹ᵈᵉ;~&⁊]/u;   // correction-diff-guard.mjs ABBR, plus & and ⁊ (et)
const abbrBase = (t) => t.normalize('NFD').replace(/[ꝑꝓ]/g, 'p').replace(/[ꝗꝙ]/g, 'q').replace(/[ꝯꝰ⁹;~&⁊]/g, '').replace(/ᵈ/g, 'd').replace(/ᵉ/g, 'e').replace(/\p{M}/gu, '').toLowerCase().replace(/ſ/g, 's').replace(/v/g, 'u').replace(/j/g, 'i').replace(/[^\p{L}\p{N}]/gu, '');
const isSubseq = (x, y) => { let k = 0; for (const ch of y) if (ch === x[k]) k++; return k === x.length; };
const UMLAUT = { a: 'ä', o: 'ö', u: 'ü', A: 'Ä', O: 'Ö', U: 'Ü' };

export function scriptOf(lang) { return /Tibetan/.test(lang) ? 'tibt' : /Chinese|Japanese/.test(lang) ? 'hani' : /Hebrew|Arabic|Syriac|Persian/.test(lang) ? 'semitic' : 'latn'; }
/** [{tok, key, start, end}] of the printed text, folded per script (preregistered). */
export function tokensOf(text, lang) {
  const s = scriptOf(lang);
  if (s === 'latn') {
    const t = String(text).normalize('NFC').replace(/([aouAOU])ͤ/g, (_, v) => UMLAUT[v]).replace(/<(note|detected-images|split-position|lang|summary|keywords)\b[^>]*>[\s\S]*?<\/\1>/g, (m) => (m.startsWith('<note') ? m : ' '.repeat(m.length)));
    return wordTokens(t).map((x) => ({ tok: x.tok, key: x.key, start: x.start, end: x.end })).filter((x) => x.key);
  }
  const m = mask(text);
  if (s === 'tibt') return syllableTokens(m).map((x) => ({ tok: x.syl, key: x.syl.replace(/མྱ/gu, 'མ').replace(/[^ༀ-࿿]/gu, ''), start: x.start, end: x.end })).filter((x) => x.key);
  if (s === 'hani') { const out = []; for (const mm of m.matchAll(/[\p{Script=Han}〇]|\p{N}+/gu)) out.push({ tok: mm[0], key: KYU.get(mm[0]) || mm[0], start: mm.index, end: mm.index + mm[0].length }); return out; }
  const out = [];
  for (const mm of m.matchAll(/\S+/gu)) {
    const key = mm[0].normalize('NFD').replace(/\p{M}/gu, '').replace(/ـ/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '');
    if (key) out.push({ tok: mm[0], key, start: mm.index, end: mm.index + mm[0].length });
  }
  return out;
}
/** Hunks of the folded alignment, equal-length runs split word by word (latin-diffqa diffWords' rule), each classified. */
export function diffTexts(stored, other, lang) {
  const A = tokensOf(stored, lang), B = tokensOf(other, lang);
  const pairs = alignSyllables(A.map((x) => x.key), B.map((x) => x.key));
  const raw = []; let cur = null;
  for (const [i, j] of pairs) {
    const eq = i !== null && j !== null && A[i].key === B[j].key;
    if (eq) { if (cur) { raw.push(cur); cur = null; } continue; }
    cur ??= { a: [], b: [] };
    if (i !== null) cur.a.push(i); if (j !== null) cur.b.push(j);
  }
  if (cur) raw.push(cur);
  // Insertions carry their stored anchor (the stored token before them) so a spot can be shown in place.
  const anchorOf = (hk) => { if (hk.a.length) return hk.a[0]; let k = -1; for (const [i, j] of pairs) { if (j === hk.b[0]) break; if (i !== null) k = i; } return k + 0.5; };
  const split = raw.flatMap((hk) => (hk.a.length > 1 && hk.a.length === hk.b.length ? hk.a.map((i, m) => ({ a: [i], b: [hk.b[m]] })) : [hk]));
  const latn = scriptOf(lang) === 'latn';
  const hunks = split.map((hk) => {
    const at = hk.a.map((i) => A[i].tok), bt = hk.b.map((j) => B[j].tok);
    let cls = 'RISKY', why = 'change';
    if (latn) {
      [cls, why] = classifyHunk(at, bt);
      if (cls === 'RISKY') {
        const as = at.join(''), bs = bt.join('');
        if ((ABBR.test(as) && at.length && bt.length && isSubseq(abbrBase(as), abbrBase(bs))) || (ABBR.test(bs) && at.length && bt.length && isSubseq(abbrBase(bs), abbrBase(as)))) { cls = 'LOW'; why = 'abbreviation'; }
      }
    }
    return { a: hk.a, b: hk.b, at, bt, anchor: anchorOf(hk), counted: cls === 'RISKY', why, size: Math.max(hk.a.length, hk.b.length) };
  });
  const counted = hunks.filter((x) => x.counted);
  return { n: A.length, A, B, hunks, counted, score: A.length ? (100 * counted.reduce((s, x) => s + x.size, 0)) / A.length : (B.length ? 100 : 0) };
}

/** Diff stage: per (arm, item) the score and the counted hunks (spans of the stored text). */
function diff() {
  const F = frame();
  const texts = JSON.parse(zlib.gunzipSync(fs.readFileSync(P('texts.json.gz'))));
  const best = (arm) => { const m = new Map(); for (const r of readJsonl(P(`out-${arm}.jsonl`))) if (r.ok || !m.has(r.key) || !m.get(r.key).ok) { if (!m.get(r.key)?.ok) m.set(r.key, r); } return m; };
  const C = best('C'), R = best('R');
  const out = {};
  const one = (arm, x, r) => {
    if (!r?.ok) return { missing: true, cls: r?.cls ?? 'not called' };
    if (r.kind === 'unchanged') return { score: 0, kind: 'unchanged', n: tokensOf(texts[x.id].text, x.lang).length, hunks: [] };
    if (r.kind === 'contain') return { score: Infinity, kind: 'contain', claim: r.text.slice(0, 300), hunks: [] };
    const d = diffTexts(texts[x.id].text, r.text, x.lang);
    const ctx = (i) => d.A.slice(Math.max(0, Math.floor(i) - 4), Math.max(0, Math.floor(i) + 5)).map((t) => t.tok).join(' ');
    return { score: d.score, kind: 'text', n: d.n, low: d.hunks.length - d.counted.length, hunks: d.counted.map((k) => ({ a: k.a, anchor: k.anchor, stored: k.at.join(' '), alt: k.bt.join(' '), why: k.why, ctx: ctx(k.anchor) })) };
  };
  for (const x of [...F.real, ...F.planted]) {
    const rr = x.set === 'planted' ? R.get(`page:${x.page_id}`) : R.get(x.id);
    out[x.id] = { C: C.has(x.id) ? one('C', x, C.get(x.id)) : null, R: one('R', x, rr) };
  }
  const json = JSON.stringify(out, (k, v) => (v === Infinity ? 'Infinity' : v));
  fs.writeFileSync(P('diffs.json.gz'), zlib.gzipSync(json));
  const s = (arm) => Object.values(out).map((o) => o[arm]).filter((o) => o && !o.missing);
  console.log(JSON.stringify({ C: { n: s('C').length, unchanged: s('C').filter((o) => o.kind === 'unchanged').length, contain: s('C').filter((o) => o.kind === 'contain').length }, R: { n: s('R').length } }));
}

const STAGES = { setup, call, diff };
export { STAGES, frame, readJsonl, P, J, W, h, OUT };
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const s = STAGES[process.argv[2]];
  if (!s) { console.error(`stages: ${Object.keys(STAGES).join(', ')}`); process.exit(2); }
  await s();
}
