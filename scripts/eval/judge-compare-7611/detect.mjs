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
// Deviation 1 (declared; from the first 34 diffs, before any label or score): the Siku variant pairs of
// scripts/eval/grounding-6871/skqs-real.py VARIANTS, restated, plus 擧舉 栢柏 呌叫 臯皐 攷考 両兩 seen in those diffs.
const VAR_FROM = '徳増䘮録説衞庿蔵逺嵗圎曽黄爲𤣥摠盖却卽旣敎毎靑呉别兾竒着隂恊擧栢呌臯攷両', VAR_TO = '德增喪錄說衛廟藏遠歲圓曾黃為玄總蓋卻即既教每青吳別冀奇著陰協舉柏叫皐考兩';
const VAR = new Map([...VAR_FROM].map((c, i) => [c, [...VAR_TO][i]]));
const hanKey = (c) => { const v = VAR.get(c) || c; return KYU.get(v) || v; };
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
  if (s === 'hani') { const out = []; for (const mm of m.matchAll(/[\p{Script=Han}〇]|\p{N}+/gu)) if (mm[0] !== '丨') out.push({ tok: mm[0], key: hanKey(mm[0]), start: mm.index, end: mm.index + mm[0].length }); return out; }   // 丨: the ditto mark (paddle-correct-6561), layout
  const out = [];
  for (const mm of m.matchAll(/\S+/gu)) {
    const key = mm[0].normalize('NFD').replace(/\p{M}/gu, '').replace(/[ـ\u05BE]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '');
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
  // Deviation 2 (declared, as deviation 1): in every script a hunk whose keys join to the same string is a join/split
  // (a tsheg or space dropped or added: ཕྱིནཔ / ཕྱིན པ), and a run of ≥ 3 tokens (≥ 4 Han) deleted here that the other
  // text holds elsewhere, or inserted here that this text holds elsewhere, is MOVED (column or note order), not a change.
  const SEP = '\u0001', AK = SEP + A.map((x) => x.key).join(SEP) + SEP, BK = SEP + B.map((x) => x.key).join(SEP) + SEP;
  const minRun = scriptOf(lang) === 'hani' ? 4 : 3;
  const hunks = split.map((hk) => {
    const at = hk.a.map((i) => A[i].tok), bt = hk.b.map((j) => B[j].tok);
    const ak = hk.a.map((i) => A[i].key), bk = hk.b.map((j) => B[j].key);
    let cls = 'RISKY', why = 'change';
    if (ak.join('') === bk.join('')) { cls = 'LOW'; why = 'join-split'; }
    else if (!bk.length && ak.length >= minRun && BK.includes(SEP + ak.join(SEP) + SEP)) { cls = 'LOW'; why = 'moved'; }
    else if (!ak.length && bk.length >= minRun && AK.includes(SEP + bk.join(SEP) + SEP)) { cls = 'LOW'; why = 'moved'; }
    else if (latn) {
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

// ── labels and the N-review adjudication ───────────────────────────────────────────────────────────────────────────
const loadDiffs = () => JSON.parse(zlib.gunzipSync(fs.readFileSync(P('diffs.json.gz'))).toString(), (k, v) => (v === 'Infinity' ? Infinity : v));
const firstOk = (arm) => { const m = new Map(); for (const r of readJsonl(P(`out-${arm}.jsonl`))) if (r.ok && !m.has(r.key)) m.set(r.key, r); return m; };
const firstVerdicts = (f) => { const m = new Map(); for (const r of readJsonl(f)) if (r.verdict && !m.has(r.id)) m.set(r.id, r.verdict); return m; };
/** The existing label of a real item (preregistered): an earlier adjudication's accept (run.mjs ADJ_BORROW order), else
 *  stored Opus (which Flash-medium agrees with wherever no adjudication ran). */
function existingLabels(texts) {
  const adj = readJsonl(P('adjudications.jsonl')).filter((r) => r.adj);
  const m = new Map();
  for (const who of ['argon', 'flash', 'flash-medium', 'flash-high']) for (const r of adj) if (r.judge === who && !m.has(r.id)) m.set(r.id, r);
  return (id) => (m.has(id) ? { accept: m.get(id).adj.accept, from: `adjudication:${m.get(id).judge}`, adj: m.get(id).adj } : { accept: texts[id]?.opus?.accept, from: 'opus=medium' });
}
const MAX_SPOTS = 40;
/** C's and R's counted hunks merged into unattributed spots; letters A/B in seeded order. */
function spotsFor(id, d) {
  const by = new Map();
  for (const arm of ['C', 'R']) for (const k of d[arm]?.hunks ?? []) {
    const key = k.a.length ? `a:${k.a.join(',')}` : `ins:${k.anchor}`;
    const s = by.get(key) ?? by.set(key, { key, anchor: k.anchor, stored: k.stored, ctx: k.ctx, alts: [] }).get(key);
    const same = s.alts.find((x) => x.text === k.alt);
    if (same) same.arms.push(arm); else s.alts.push({ text: k.alt, arms: [arm] });
  }
  let spots = [...by.values()];
  const both = (s) => s.alts.some((x) => x.arms.length === 2) || s.alts.length === 2;
  const total = spots.length;
  // Deviation 3 (declared): past the cap, spots both propose, then C's (the fix accounting needs them), then R's.
  const hasC = (s) => s.alts.some((x) => x.arms.includes('C'));
  const tier = (s) => (both(s) ? 0 : hasC(s) ? 1 : 2);
  spots = spots.sort((a, b) => tier(a) - tier(b) || a.anchor - b.anchor).slice(0, MAX_SPOTS).sort((a, b) => a.anchor - b.anchor);
  spots.forEach((s, i) => {
    s.n = i + 1;
    if (s.alts.length === 2 && parseInt(h(`alt:${id}:${s.key}`).slice(0, 2), 16) % 2) s.alts.reverse();
    s.alts.forEach((a, j) => { a.letter = 'AB'[j]; });
  });
  return { spots, total, cut: total - spots.length };
}
export function adjudicateNPrompt(it, text, reviews, spots, imageRef) {
  const show = (v) => JSON.stringify({ accept: v.accept, fidelity: v.fidelity, defects: (v.defects || []).map((d) => ({ class: d.class, quote: d.quote, severity: d.severity, what: d.what })) }, null, 1);
  const spotLine = (s) => `${s.n}. candidate: «${s.stored || '(nothing here)'}»${s.stored ? '' : ` (between: «${s.ctx}»)`}${s.stored ? `  [context: «${s.ctx}»]` : ''}\n   ${s.alts.map((a) => `reading ${a.letter}: «${a.text || '(nothing: the page has no text here)'}»`).join('\n   ')}`;
  return `Several reviewers checked the same candidate transcription of one page of a historical ${it.lang} book against the page image, and they do not all agree on whether it can be published. You decide, from the image.

The page image is attached: ${imageRef}

CANDIDATE TRANSCRIPTION:
"""
${text}
"""

${reviews.map((r, i) => `REVIEW ${i + 1}:\n${show(r)}`).join('\n\n')}
${spots.length ? `
SPOTS: other readers of the same image wrote something different at these places in the candidate. For each, look at the image and say what the page prints there: the candidate's text, reading A, reading B, something else ("other"), or "unclear" if the image does not show it.
${spots.map(spotLine).join('\n')}
` : ''}
The publishing bar: every line of the page, in order, the right words and numerals (spelling conventions and markup aside), with nothing that matters lost, added or changed. Spelling conventions are: variant or old/new character forms, abbreviations kept or written out, long s as s, u/v and i/j, ligatures, accents, punctuation, tsheg and shad, line breaks and hyphenation.
Check each defect any review names${spots.length ? ' and each spot' : ''} against the image: is it really there, and does it matter? Then answer with one JSON object only:
{"accept": bool (your own verdict on the candidate), "real_defects": [{"from": "review number" | "spot number" | "new", "class": "O6", "quote": "...", "matters": bool}], "false_defects": [{"from": "review number", "quote": "...", "why": "a few words"}],${spots.length ? ' "spots": [{"n": 1, "page_prints": "candidate" | "A" | "B" | "other" | "unclear", "matters": bool (does the difference between the candidate and the page matter here; false when only a spelling convention differs)}],' : ''} "note": "one line"}`;
}
const parseAdjN = (t, nSpots) => parseJson(t, (v) => typeof v.accept === 'boolean' && (!nSpots || Array.isArray(v.spots)));

function adjudicationPlan() {
  const F = frame();
  const texts = JSON.parse(zlib.gunzipSync(fs.readFileSync(P('texts.json.gz'))));
  const D = loadDiffs(), S = firstOk('S'), M = firstVerdicts(P('verdicts-flash-medium.jsonl')), L = existingLabels(texts);
  const plan = [];
  for (const x of F.real) {
    const d = D[x.id], l = L(x.id), s = S.get(x.id)?.verdict;
    // A page is planned once all three arms have answered (rounds can run while the arms finish); --final takes the rest.
    if (!process.argv.includes('--final') && (!d.C || d.C.missing || d.R.missing || !s)) continue;
    const fC = d.C && !d.C.missing ? (d.C.kind === 'contain' || d.C.hunks.length > 0) : null, fR = d.R && !d.R.missing ? d.R.hunks.length > 0 : null, fS = s ? !s.accept : null;
    const disagree = [fC, fR, fS].some((f) => f != null && f !== !l.accept);
    const cChanged = !!(d.C && !d.C.missing && d.C.hunks.length);
    if (!disagree && !cChanged) continue;
    const reviews = [texts[x.id].opus, M.get(x.id), s, l.adj && { accept: l.adj.accept, defects: (l.adj.real_defects || []).map((r) => ({ class: r.class, quote: r.quote, severity: r.matters ? 'misleads' : 'cosmetic', what: 'named by an earlier check' })) }].filter(Boolean);
    const order = reviews.map((r, i) => [h(`rev:${x.id}:${i}`), r]).sort((a, b) => a[0].localeCompare(b[0])).map(([, r]) => r);
    plan.push({ x, reviews: order, ...spotsFor(x.id, d), why: { disagree, cChanged, flags: { C: fC, R: fR, S: fS }, label0: l.accept } });
  }
  return { plan, texts };
}

async function adjudicate() {
  const { plan, texts } = adjudicationPlan();
  const vf = P('adjudications-new.jsonl');
  const prior = readJsonl(vf); const done = new Set(prior.filter((r) => r.adj).map((r) => r.id));
  const tries = new Map(); for (const r of prior) tries.set(r.id, (tries.get(r.id) ?? 0) + 1);
  const todo = plan.filter((p) => !done.has(p.x.id) && (tries.get(p.x.id) ?? 0) < 3).slice(0, Number(arg('max') || 300));
  console.log(`adjudicate: ${plan.length} pages planned (${plan.filter((p) => p.why.disagree).length} disagreements, ${plan.filter((p) => p.why.cChanged).length} with C changes; ${plan.reduce((s, p) => s + p.cut, 0)} spots cut at ${MAX_SPOTS}); ${todo.length} to go`);
  const limits = await import('../../lib/model-limits.mjs');
  let next = 0, stop = null;
  const worker = async () => {
    while (!stop && next < todo.length) {
      const b = limits.claudeBlocked({ weeklyMax: 85, sessionMax: 95 }); if (b) { stop = b.reason; break; }
      const p = todo[next++];
      const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'dt-adj-'));
      try {
        fs.writeFileSync(path.join(ws, 'page.jpg'), await image(p.x.page_id, p.x.image_url));
        const prompt = adjudicateNPrompt(p.x, texts[p.x.id].text, p.reviews, p.spots, IMG_OPUS);
        const r = await opusCall(prompt, ws);
        if (r.cls === 'quota') { stop = 'claude quota'; break; }
        const v = parseAdjN(r.text, p.spots.length);
        fs.appendFileSync(vf, JSON.stringify({ id: p.x.id, author: p.x.author, lang: p.x.lang, book_id: p.x.book_id, why: p.why, n_reviews: p.reviews.length,
          spots: p.spots.map((s) => ({ n: s.n, key: s.key, stored: s.stored, alts: s.alts })), spots_total: p.total, spots_cut: p.cut,
          adj: v, raw: v ? undefined : String(r.text).slice(0, 400), model: r.model, usage: r.usage, list_usd: r.cost, prompt_sha: h(prompt).slice(0, 16), at: new Date().toISOString() }) + '\n');
        console.log(`  ${p.x.id} ${stratum(p.x)}: ${v ? `accept=${v.accept} (label0 ${p.why.label0}) spots ${p.spots.length}${p.cut ? `+${p.cut} cut` : ''}` : 'unparsed'}`);
      } finally { fs.rmSync(ws, { recursive: true, force: true }); }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(4, Number(arg('concurrency') || 3))) }, worker));
  if (stop) { console.log(`STOPPED: ${stop}`); process.exit(3); }
}

// ── scoring ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const kn = (k, n) => ({ k, n, rate: n ? +(k / n).toFixed(3) : null, wilson95: n ? wilson(k, n).map((x) => +x.toFixed(3)) : null });
const kappa = (pairs) => { const n = pairs.length; if (!n) return null; const po = pairs.filter(([a, b]) => a === b).length / n, pa = pairs.filter(([a]) => a).length / n, pb = pairs.filter(([, b]) => b).length / n; const pe = pa * pb + (1 - pa) * (1 - pb); return pe === 1 ? null : +((po - pe) / (1 - pe)).toFixed(3); };
/** AUC of a score against a boolean label (ties count half). */
function auc(rows) {
  const pos = rows.filter((r) => r.y).map((r) => r.s), neg = rows.filter((r) => !r.y).map((r) => r.s);
  if (!pos.length || !neg.length) return null;
  let w = 0; for (const p of pos) for (const q of neg) w += p > q ? 1 : p === q ? 0.5 : 0;
  return +(w / (pos.length * neg.length)).toFixed(3);
}
function pr(rows) {   // rows: {flag, y}  (y = has an error that matters)
  const tp = rows.filter((r) => r.flag && r.y).length, fl = rows.filter((r) => r.flag).length, P1 = rows.filter((r) => r.y).length;
  return { n: rows.length, errors: P1, flagged: fl, recall: kn(tp, P1), precision: kn(tp, fl), kappa: kappa(rows.map((r) => [!!r.flag, !!r.y])) };
}
/** Preregistered: the threshold maximising recall with precision ≥ 0.70 on the calibration half (ties: the higher
 *  threshold), else the one maximising F1. Flag = score ≥ t; t > 0. */
function pickThreshold(rows) {
  const ts = [...new Set(rows.map((r) => r.s).filter((s) => s > 0))].sort((a, b) => a - b);
  let best = null, bestF1 = null;
  for (const t of ts) {
    const f = rows.map((r) => ({ flag: r.s >= t, y: r.y })); const tp = f.filter((r) => r.flag && r.y).length, fl = f.filter((r) => r.flag).length, P1 = f.filter((r) => r.y).length;
    const rec = P1 ? tp / P1 : 0, prec = fl ? tp / fl : 0, f1 = rec + prec ? (2 * rec * prec) / (rec + prec) : 0;
    if (prec >= 0.70 && (!best || rec > best.rec || (rec === best.rec && t > best.t))) best = { t, rec, prec, rule: 'max recall at precision >= 0.70' };
    if (!bestF1 || f1 > bestF1.f1) bestF1 = { t, rec, prec, f1, rule: 'max F1 (no threshold reached precision 0.70)' };
  }
  return best ?? bestF1;
}
const AGY_RATES = { input: 0.75, output: 3.75 };
const listUsd = (u) => (u ? ((u.input_tokens || 0) * AGY_RATES.input + (u.cache_read_tokens || 0) * AGY_RATES.input * 0.1 + (u.output_tokens || 0) * AGY_RATES.output) / 1e6 : null);

function score() {
  const F = frame();
  const texts = JSON.parse(zlib.gunzipSync(fs.readFileSync(P('texts.json.gz'))));
  const plants = JSON.parse(fs.readFileSync(path.join(PLANTED, 'plants.json'), 'utf8'));
  const D = loadDiffs(), S = firstOk('S'), M = firstVerdicts(P('verdicts-flash-medium.jsonl')), L = existingLabels(texts);
  const NEW = new Map(readJsonl(P('adjudications-new.jsonl')).filter((r) => r.adj).map((r) => [r.id, r]));
  const out = { generated_at: new Date().toISOString(), labels: {}, arms: {}, plants: {}, strata: {}, cost: {}, fix: {} };
  // Labels: the new adjudication's accept where one ran, else the existing label.
  const label = (id) => (NEW.has(id) ? { accept: NEW.get(id).adj.accept, from: 'new' } : L(id));
  const real = F.real.map((x) => {
    const d = D[x.id], l = label(x.id);
    const cs = d.C && !d.C.missing ? d.C.score : null, rs = d.R && !d.R.missing ? d.R.score : null;
    const half = null;
    return { id: x.id, x, st: stratum(x), book: x.book_id, y: l.accept === false, from: l.from, C: cs, R: rs, S: S.get(x.id)?.verdict ? !S.get(x.id).verdict.accept : null, opus: !texts[x.id].opus.accept, medium: M.has(x.id) ? !M.get(x.id).accept : null, half };
  });
  // Halves: within each stratum, by h('half:7611:'+id), alternating.
  for (const [, rows] of Object.entries(Object.groupBy(real, (r) => r.st))) rows.map((r) => [h(`half:7611:${r.id}`), r]).sort((a, b) => a[0].localeCompare(b[0])).forEach(([, r], i) => { r.half = i % 2; });
  out.labels = { n: real.length, errors_that_matter: real.filter((r) => r.y).length, from: Object.fromEntries(Object.entries(Object.groupBy(real, (r) => r.from)).map(([k, v]) => [k, v.length])),
    flipped_by_new: real.filter((r) => r.from === 'new' && (L(r.id).accept === false) !== r.y).length,
    flipped_to_fail: real.filter((r) => r.from === 'new' && L(r.id).accept !== false && r.y).length, flipped_to_pass: real.filter((r) => r.from === 'new' && L(r.id).accept === false && !r.y).length,
    by_stratum: Object.fromEntries(Object.entries(Object.groupBy(real, (r) => r.st)).map(([k, v]) => [k, { n: v.length, errors: v.filter((r) => r.y).length }])) };
  const strata = [...new Set(real.map((r) => r.st))].sort();
  const report = (rows, flagOf) => ({ all: pr(rows.map((r) => ({ flag: flagOf(r), y: r.y }))), by_stratum: Object.fromEntries(strata.map((s) => [s, pr(rows.filter((r) => r.st === s).map((r) => ({ flag: flagOf(r), y: r.y })))])) });
  // C and R: thresholds on one half, scored on the other (both directions); the primary is calibrate-on-0, test-on-1.
  const thr = {};
  for (const arm of ['C', 'R']) {
    const have = real.filter((r) => r[arm] != null);
    const fit = (h0) => pickThreshold(have.filter((r) => r.half === h0).map((r) => ({ s: r[arm], y: r.y })));
    const t0 = fit(0), t1 = fit(1); thr[arm] = t0.t;
    out.arms[arm] = { n: have.length, missing: real.length - have.length,
      threshold: { primary: t0, reverse: t1 },
      held_out: report(have.filter((r) => r.half === 1), (r) => r[arm] >= t0.t), held_out_reverse: report(have.filter((r) => r.half === 0), (r) => r[arm] >= t1.t),
      all_at_primary: report(have, (r) => r[arm] >= t0.t),
      any_change: report(have, (r) => r[arm] > 0),
      auc: { all: auc(have.map((r) => ({ s: r[arm], y: r.y }))), by_stratum: Object.fromEntries(strata.map((s) => [s, auc(have.filter((r) => r.st === s).map((r) => ({ s: r[arm], y: r.y })))])) },
      score_quantiles: Object.fromEntries([0.25, 0.5, 0.75, 0.9].map((q) => { const xs = have.map((r) => r[arm]).filter(Number.isFinite).sort((a, b) => a - b); return [q, +xs[Math.floor(q * (xs.length - 1))].toFixed(2)]; })) };
  }
  for (const [arm, f] of [['S', (r) => r.S], ['opus', (r) => r.opus], ['medium', (r) => r.medium]]) {
    const have = real.filter((r) => f(r) != null);
    out.arms[arm] = { n: have.length, all: report(have, f), held_out: report(have.filter((r) => r.half === 1), f) };
  }
  // CS: C flags at its primary threshold, S confirms.
  { const have = real.filter((r) => r.C != null && r.S != null); const f = (r) => r.C >= thr.C && r.S;
    out.arms.CS = { n: have.length, held_out: report(have.filter((r) => r.half === 1), f), all: report(have, f), c_flag_share: +(have.filter((r) => r.C >= thr.C).length / have.length).toFixed(3) }; }
  // Plants.
  const planted = (arm, xs) => {
    const rows = xs.map((x) => {
      const p = plants[x.page_id][x.kind];
      if (arm === 'S') { const v = S.get(x.id)?.verdict; if (!v) return null; return x.kind === 'A' ? { kind: 'A', flag: !v.accept } : { kind: x.kind, ...scorePlant(v, p) }; }
      const d = D[x.id]?.[arm]; if (!d || d.missing) return null;
      const flag = d.score >= thr[arm];
      if (x.kind === 'A') return { kind: 'A', flag, any: d.score > 0 };
      const words = (s) => String(s).split(/\s+/).map(latinFold).filter(Boolean);
      const after = new Set(words(p.after)), before = words(p.before);
      const named = d.kind === 'contain' ? false : x.kind === 'D'
        ? d.hunks.some((k) => { const alt = new Set(words(k.alt)); return before.filter((w) => alt.has(w)).length >= before.length / 2; })
        : d.hunks.some((k) => words(k.stored).some((w) => after.has(w)));
      return { kind: x.kind, caught: flag, named, caught_any: d.score > 0 };
    }).filter(Boolean);
    const E = rows.filter((r) => r.kind !== 'A'), A = rows.filter((r) => r.kind === 'A');
    return { caught: kn(E.filter((r) => r.caught).length, E.length), named: kn(E.filter((r) => r.named).length, E.length), ...(arm !== 'S' && { caught_any_change: kn(E.filter((r) => r.caught_any).length, E.length) }),
      by_kind: Object.fromEntries(['B', 'C', 'D', 'E'].map((k) => { const g = E.filter((r) => r.kind === k); return [k, kn(g.filter((r) => r.caught).length, g.length)]; })),
      clean_flagged: kn(A.filter((r) => r.flag).length, A.length), ...(arm !== 'S' && A.length && { clean_any_change: kn(A.filter((r) => r.any).length, A.length) }) };
  };
  out.plants = { C: planted('C', F.sub), R: planted('R', F.planted), R_on_C_subset: planted('R', F.sub), S: planted('S', [...F.sub, ...F.clean]) };
  // C's fix accounting from the new adjudications' spots.
  { const tally = { spots_with_c: 0, fixed: 0, introduced: 0, fixed_trivial: 0, introduced_r_agreed: 0, other: 0, unclear: 0, missing: 0, cut_spots: 0 }; const per = {}; const pages = { better: 0, worse: 0, mixed: 0, same: 0 };
    for (const r of real) {
      const a = NEW.get(r.id); if (!a || !D[r.id]?.C?.hunks?.length) continue;
      const ans = new Map((a.adj.spots || []).map((s) => [Number(s.n), s]));
      const P2 = per[r.st] ??= { fixed: 0, introduced: 0 }; let f = 0, i = 0;
      tally.cut_spots += a.spots_cut;
      for (const s of a.spots) {
        const c = s.alts.find((x) => x.arms.includes('C')); if (!c) continue;
        tally.spots_with_c++;
        const v = ans.get(s.n); if (!v) { tally.missing++; continue; }
        if (v.page_prints === c.letter) { if (v.matters) { tally.fixed++; P2.fixed++; f++; } else tally.fixed_trivial++; }
        // The adjudicator's `matters` is about candidate vs page, so it is false wherever the page prints the candidate:
        // a C change there is counted as introduced (counted hunks are already non-convention), split by whether R agreed.
        else if (v.page_prints === 'candidate') { tally.introduced++; P2.introduced++; i++; if (s.alts.some((x) => x.arms.includes('C') && x.arms.includes('R'))) tally.introduced_r_agreed++; }
        else if (v.page_prints === 'unclear') tally.unclear++; else tally.other++;
      }
      pages[f && i ? 'mixed' : f ? 'better' : i ? 'worse' : 'same']++;
    }
    out.fix = { ...tally, net: tally.fixed - tally.introduced, by_stratum: per, pages }; }
  // Cost per page.
  { const low = readJsonl(P('verdicts-flash.jsonl')).filter((r) => r.usage).map((r) => listUsd(r.usage)); const lowMean = low.reduce((s, x) => s + x, 0) / low.length;
    const opusBase = readJsonl(P('verdicts-opus-repeat.jsonl')).map((r) => r.list_usd).filter((x) => x > 0); const opusMean = opusBase.reduce((s, x) => s + x, 0) / opusBase.length;
    for (const arm of ['C', 'R', 'S']) {
      const rows = readJsonl(P(`out-${arm}.jsonl`)); const ok = rows.filter((r) => r.ok).length;
      if (arm === 'S') { const us = rows.map((r) => r.list_usd).filter((x) => x > 0); const m = us.reduce((s, x) => s + x, 0) / us.length;
        out.cost.S = { calls: rows.length, ok, list_usd_mean: +m.toFixed(5), opus_judge_list_usd_mean: +opusMean.toFixed(5), ratio: +(m / opusMean).toFixed(3), usd_per_call: +(0.0022 * m / opusMean).toFixed(5), usd_per_page: +(0.0022 * m / opusMean * rows.length / ok).toFixed(5) }; continue; }
      const us = rows.filter((r) => r.usage).map((r) => listUsd(r.usage)); const m = us.reduce((s, x) => s + x, 0) / us.length;
      const tok = (f) => +(rows.filter((r) => r.usage).reduce((s, r) => s + (r.usage[f] || 0), 0) / us.length).toFixed(0);
      out.cost[arm] = { calls: rows.length, ok, tokens: { input: tok('input_tokens'), output: tok('output_tokens'), thinking: tok('thinking_tokens'), cache_read: tok('cache_read_tokens') }, list_usd_mean: +m.toFixed(6), flash_low_judge_list_usd_mean: +lowMean.toFixed(6), ratio_to_low: +(m / lowMean).toFixed(3), usd_per_call: +(0.00055 * m / lowMean).toFixed(6), usd_per_page: +(0.00055 * m / lowMean * rows.length / ok).toFixed(6) };
    }
    out.cost.CS = { usd_per_page: +(out.cost.C.usd_per_page + out.arms.CS.c_flag_share * out.cost.S.usd_per_page).toFixed(5), c_flag_share: out.arms.CS.c_flag_share };
    out.cost.opus_stored = { usd_per_page: 0.0022 }; out.cost.medium = { usd_per_page: 0.00248, note: '#7918 cost.json' };
    const adjRows = readJsonl(P('adjudications-new.jsonl')); out.cost.adjudications = { calls: adjRows.length, parsed: NEW.size };
    out.cost.all_books_237k = Object.fromEntries(['C', 'R', 'S', 'CS'].map((a) => [a, Math.round(237e3 * out.cost[a].usd_per_page)])); }
  // Decision (preregistered).
  const plantOk = (p) => p && p.caught.n && p.caught.k / p.caught.n >= 141 / 144;
  const dec = {};
  for (const arm of ['C', 'R', 'S', 'CS']) {
    const rep = arm === 'S' ? out.arms.S.all.all : out.arms[arm].held_out.all;
    const pl = arm === 'CS' ? null : out.plants[arm];
    const plantsPass = arm === 'CS' ? (plantOk(out.plants.C) && plantOk(out.plants.S)) : plantOk(pl);
    dec[arm] = { plants: arm === 'CS' ? 'needs both C and S' : `${pl.caught.k}/${pl.caught.n}`, plants_ok: !!plantsPass, recall: rep.recall.rate, recall_ok: rep.recall.rate >= 0.85, precision: rep.precision.rate, precision_ok: rep.precision.rate >= 0.70, usd_per_page: out.cost[arm].usd_per_page };
    dec[arm].passes = dec[arm].plants_ok && dec[arm].recall_ok && dec[arm].precision_ok;
  }
  const passing = Object.entries(dec).filter(([, v]) => v.passes).sort((a, b) => a[1].usd_per_page - b[1].usd_per_page);
  out.decision = { arms: dec, recommended: passing[0]?.[0] ?? null };
  W('score.json', out);
  console.log(JSON.stringify(out, null, 1));
}

const STAGES = { setup, call, diff, adjudicate, score, plan: () => { const { plan } = adjudicationPlan(); console.log(JSON.stringify({ pages: plan.length, disagree: plan.filter((p) => p.why.disagree).length, c_changed: plan.filter((p) => p.why.cChanged).length, spots: plan.reduce((s, p) => s + p.spots.length, 0), cut: plan.reduce((s, p) => s + p.cut, 0) })); } };
export { STAGES, frame, readJsonl, P, J, W, h, OUT, adjudicationPlan };
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const s = STAGES[process.argv[2]];
  if (!s) { console.error(`stages: ${Object.keys(STAGES).join(', ')}`); process.exit(2); }
  await s();
}
