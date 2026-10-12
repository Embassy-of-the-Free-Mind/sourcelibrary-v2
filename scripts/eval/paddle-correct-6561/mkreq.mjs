#!/usr/bin/env node
// PRIOR ART: scripts/eval/paddle-table-pilot-6388/mkreq-read.mjs (the pilot's read prompt: live OCR prompt v19.1 +
// table/rod/drawing addendum + ===LAYOUT===/===TRANSCRIPTION===/===END=== sentinels). Reused BYTE FOR BYTE as the redo
// prompt (taken from the pilot's own request file, not re-fetched), so set B's Opus redo is the same prompt as set A's
// reused pilot reads. The correct prompt is the same text with the draft block inserted before the reply format.
//
// #6561 requests. Usage (cwd = $JOB_SCRATCH/w):
//   node <repo>/scripts/eval/paddle-correct-6561/mkreq.mjs <pilot-w-dir>
// Reads: setB.json + alignB.jsonl (draw.mjs, align.mjs), the pilot's pilsample.json, pil-align.jsonl, pil-read-req.jsonl.
// Writes: setA.json, sets.json (A + B with Kanripo leaf), req-<arm>.jsonl, anchors.json, prompt-ref.json.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { makeRng } from '../lib/paired-stats.mjs';
import { foldHan } from '../ground-truth-5935/lib.mjs';

const [, , PILOT] = process.argv;
const SEED = 6561, N_A = 40, N_ANCHOR = 10, PLANTS = 3;
const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const shuffle = (xs, seed) => { const a = [...xs], r = makeRng(seed); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

// ── prompts ──
const pilotPrompt = readJsonl(`${PILOT}/pil-read-req.jsonl`)[0].prompt;
const FMT = '\n**Reply format (required).**';
const OPUS_SUFFIX = '\n\nThe page image to transcribe is the file ./page.jpg in the current directory.';
const iFmt = pilotPrompt.indexOf(FMT), iSuf = pilotPrompt.indexOf(OPUS_SUFFIX);
if (iFmt < 0 || iSuf < 0) throw new Error('pilot prompt shape changed');
const head = pilotPrompt.slice(0, iFmt);            // base v19.1 + addendum (rods, count, drawings)
const fmt = pilotPrompt.slice(iFmt, iSuf);          // the sentinel reply format
const opusSuffix = pilotPrompt.slice(iSuf);         // "open ./page.jpg with the Read tool …"
const agySuffix = '\n\nThe page image to transcribe is the attached file. Output only the three sentinel lines and the transcription between them, with no preamble and no commentary.';
// The draft block. No count of errors, no mention of planted errors or of any reference text (#6553 research notes).
const draftBlock = (draft) => `
**Draft transcription from another OCR engine.** Below, between ===DRAFT=== and ===END DRAFT===, is a draft transcription of this same page made by a different OCR engine. It may contain misread characters, missing or extra characters, lines out of order or text repeated. The IMAGE is the authority: check the draft against the image column by column, keep what the image confirms, correct what it does not, add what the draft left out, and remove anything the page does not print. Do not change a character that the image supports, even where another character would be more usual. Return the complete corrected transcription in the format described above, not a list of changes.
===DRAFT===
${String(draft).trim()}
===END DRAFT===
`;
export const redoPrompt = (route) => head + fmt + (route === 'opus' ? opusSuffix : agySuffix);
export const correctPrompt = (route, draft) => head + draftBlock(draft) + fmt + (route === 'opus' ? opusSuffix : agySuffix);
if (redoPrompt('opus') !== pilotPrompt) throw new Error('redo prompt is not the pilot prompt');

// ── set A: 40 of the pilot's 100 withheld table pages, from those with an own Kanripo leaf (>= 20 chars) ──
const pil = JSON.parse(fs.readFileSync(`${PILOT}/pilsample.json`, 'utf8'));
const palign = new Map(readJsonl(`${PILOT}/pil-align.jsonl`).map((a) => [a.key, a]));
const ownA = pil.filter((s) => { const a = palign.get(s.uid); return a?.status === 'aligned' && a.leaf === 'own' && [...(a.kanripo_text || '')].length >= 20; });
const setA = shuffle(ownA.sort((a, b) => (a.uid < b.uid ? -1 : 1)), SEED).slice(0, N_A).sort((a, b) => (a.uid < b.uid ? -1 : 1))
  .map((s) => ({ uid: `A-${s.uid}`, pilot_uid: s.uid, stratum: 'A', pid: s.pid, bid: s.bid, pn: s.pn, title: s.title, iss: s.iss, reasons: s.reasons, image: s.image, image_url: s.image_url, paddle: s.paddle, kanripo: palign.get(s.uid).kanripo_text, kanripo_raw: palign.get(s.uid).kanripo_raw, kanripo_pb: palign.get(s.uid).ref_pb }));
console.log('set A', setA.length, 'of', ownA.length, 'own-aligned pilot pages');

// ── set B ──
const balign = new Map(readJsonl('alignB.jsonl').map((a) => [a.key, a]));
const setB = JSON.parse(fs.readFileSync('setB.json', 'utf8')).map((s) => {
  const a = balign.get(s.uid); const own = a?.status === 'aligned' && a.leaf === 'own' && [...(a.kanripo_text || '')].length >= 20;
  return { ...s, kanripo: own ? a.kanripo_text : null, kanripo_raw: own ? a.kanripo_raw : null, kanripo_pb: own ? a.ref_pb : null };
});
console.log('set B', setB.length, 'with own leaf', setB.filter((s) => s.kanripo).length);
const sets = [...setA, ...setB];

// ── anchoring: 3 planted substitutions in the Paddle draft on 10 B-rand pages ──
// Only at a character where Paddle agrees with the Kanripo leaf (so the planted reading is wrong by construction), the
// replacement a visually close character. Spread over the page (one per third).
const CONF = { 日: '曰', 曰: '日', 己: '已', 已: '己', 未: '末', 末: '未', 人: '入', 入: '人', 大: '太', 太: '大', 天: '夫', 夫: '天', 土: '士', 士: '土', 王: '玉', 玉: '王', 千: '干', 干: '千', 刀: '力', 力: '刀', 戊: '戌', 戌: '戊', 兩: '雨', 雨: '兩', 白: '自', 自: '白', 甲: '申', 申: '甲', 今: '令', 令: '今', 免: '兔', 兔: '免', 鳥: '烏', 烏: '鳥', 於: '于', 子: '予', 予: '子', 外: '处', 而: '面', 面: '而', 木: '本', 本: '木', 上: '止', 止: '上', 之: '乏', 也: '巳', 其: '共', 共: '其', 以: '似', 為: '烏', 不: '下', 下: '不', 有: '右', 右: '有', 者: '著', 所: '听', 無: '舞', 言: '信', 生: '牛', 牛: '生', 中: '巾', 公: '么', 文: '丈', 丈: '文' };
const anchorPool = shuffle(setB.filter((s) => s.stratum === 'B-rand' && s.kanripo), SEED + 7).slice(0, N_ANCHOR);
const anchors = [];
for (const s of anchorPool) {
  const raw = [...s.paddle];
  // body Han characters (not on a tag line) that have a look-alike and are their own folded form
  const isHan = (ch) => /\p{Script=Han}/u.test(ch);
  const lines = s.paddle.split('\n');
  const cand = []; let off = 0;
  for (const line of lines) {
    const cs = [...line];
    if (!/^\s*</.test(line)) cs.forEach((ch, k) => { if (isHan(ch) && CONF[ch] && foldHan(ch) === ch) cand.push(off + k); });
    off += cs.length + 1;
  }
  // keep candidates whose 4-char left context + char + 4-char right context occur in the leaf verbatim (agreement with Kanripo)
  const leaf = s.kanripo;
  const ok = cand.filter((i) => { const ctx = raw.slice(Math.max(0, i - 3), i + 4).join(''); return [...ctx].every(isHan) && leaf.includes(foldHan(ctx)); });
  if (ok.length < PLANTS) { console.log('anchor skip (too few sites)', s.uid, ok.length); continue; }
  const thirds = [0, 1, 2].map((t) => ok.filter((i) => i >= (t * raw.length) / 3 && i < ((t + 1) * raw.length) / 3));
  const r = makeRng(SEED ^ s.pn);
  const picks = thirds.every((t) => t.length) ? thirds.map((t) => t[Math.floor(r() * t.length)]) : shuffle(ok, SEED ^ s.pn).slice(0, PLANTS).sort((x, y) => x - y);
  const planted = [...raw];
  const plants = picks.map((i) => { const was = raw[i]; planted[i] = CONF[was]; return { at: i, was, now: CONF[was], left: raw.slice(Math.max(0, i - 4), i).join(''), right: raw.slice(i + 1, i + 5).join('') }; });
  anchors.push({ uid: `${s.uid}-anc`, base_uid: s.uid, plants, draft: planted.join('') });
}
console.log('anchors', anchors.length, 'pages,', anchors.reduce((a, x) => a + x.plants.length, 0), 'plants');

// ── request files ──
const W = (f, rows) => fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
const corr = (route) => [...sets.map((s) => ({ uid: s.uid, image: s.image, prompt: correctPrompt(route, s.paddle) })),
  ...anchors.map((x) => ({ uid: x.uid, image: sets.find((s) => s.uid === x.base_uid).image, prompt: correctPrompt(route, x.draft) }))];
W('req-opus-correct.jsonl', corr('opus'));
W('req-agy-correct.jsonl', corr('agy'));
W('req-opus-redo.jsonl', setB.map((s) => ({ uid: s.uid, image: s.image, prompt: redoPrompt('opus') })));
W('req-agy-second.jsonl', setB.map((s) => ({ uid: s.uid, image: s.image, prompt: redoPrompt('agy') })));
fs.writeFileSync('setA.json', JSON.stringify(setA, null, 1));
fs.writeFileSync('sets.json', JSON.stringify(sets, null, 1));
fs.writeFileSync('anchors.json', JSON.stringify(anchors, null, 1));
fs.writeFileSync('prompt-ref.json', JSON.stringify({ source: 'paddle-table-pilot-6388 pil-read-req.jsonl[0].prompt (OCR prompt v19.1 + pilot addendum)', redo_opus_sha: sha(redoPrompt('opus')), head_sha: sha(head), draft_block_template_sha: sha(draftBlock('')), agy_suffix_sha: sha(agySuffix) }, null, 1));
console.log('requests: correct', corr('opus').length, 'per arm; opus-redo', setB.length, '; agy-second', setB.length);
