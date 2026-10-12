#!/usr/bin/env node
// PRIOR ART: scripts/eval/paddle-table-pilot-6388/mkreview.mjs + kcheck.mjs (a by-image reviewer with planted controls,
// then a Kanripo cross-check of what it called invented). That reviews a whole reading; this asks a narrower question
// per edit: at this spot, does the page print the draft's character or the leaf's? none — no span-level read-off exists.
//
// #6561 recitation check. An arm "moved toward Kanripo" where its text holds before+leaf+after and not
// before+paddle+after (score.json `toward`). Whether the IMAGE supports that move is settled by a model of the OTHER
// family, blind: the two readings are shown as A/B in seeded order, the leaf is never mentioned. Opus-made edits are
// judged by Gemini 3.8 Flash high (agy), Gemini-made edits by Opus (claude -p). Each page also carries one control item
// at a spot where Paddle, the leaf and every arm agree, against a look-alike character (the right answer is known).
//
//   node readoff.mjs build   → ro-req-gem.jsonl (agy), ro-req-opus.jsonl (claude), ro-items.json
//   node readoff.mjs score   → readoff.json   (reads ro-out-gem.jsonl + ro-out-gem-b.jsonl, the gem requests run as two halves, and ro-out-opus.jsonl)
import fs from 'node:fs';
import { makeRng } from '../lib/paired-stats.mjs';
import { bodyText, foldHan } from '../ground-truth-5935/lib.mjs';

const MODE = process.argv[2];
const MAX_ITEMS = 12;
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const LOOK = { 日: '曰', 曰: '日', 己: '已', 已: '己', 未: '末', 末: '未', 人: '入', 入: '人', 大: '太', 太: '大', 天: '夫', 夫: '天', 土: '士', 士: '土', 王: '玉', 玉: '王', 千: '干', 干: '千', 戊: '戌', 戌: '戊', 白: '自', 自: '白', 今: '令', 令: '今', 子: '予', 予: '子', 而: '面', 木: '本', 本: '木', 上: '止', 止: '上', 其: '共', 共: '其', 不: '下', 下: '不', 有: '右', 右: '有', 生: '牛', 牛: '生', 中: '巾', 文: '丈' };
const show = (s) => (s ? `「${s}」` : '(nothing: the characters before and after are adjacent)');

const head = `You are checking one page of a printed classical Chinese book (vertical columns read right to left) against its image.
Each numbered item quotes a short passage from this page with one place marked ［？］, and offers two readings, A and B, for that place.
Find the passage on the page image and say which reading the page actually PRINTS at ［？］. Judge only by the strokes printed on this page, character by character, including variant, abbreviated or unusual forms. Do not choose the reading that is more common or that you know from another edition of the text. If neither reading matches what is printed, answer "neither"; if you cannot find the passage, answer "not found".
Reply with JSON only, no other text: {"items":[{"n":1,"choice":"A"},{"n":2,"choice":"neither"}, ...]} with one entry per item and choice one of "A", "B", "neither", "not found".

Items:
`;

if (MODE === 'build') {
  const score = JSON.parse(fs.readFileSync('score.json', 'utf8'));
  const sets = new Map(JSON.parse(fs.readFileSync('sets.json', 'utf8')).map((s) => [s.uid, s]));
  const items = [];
  const byPage = new Map();
  for (const t of score.toward) (byPage.get(t.uid) || byPage.set(t.uid, []).get(t.uid)).push(t);
  const reqGem = [], reqOpus = [];
  for (const [uid, ts] of byPage) {
    const s = sets.get(uid);
    const rng = makeRng(6561 ^ [...uid].reduce((a, c) => a * 31 + c.codePointAt(0), 7));
    // control: a 9-char window of the Paddle body that the leaf prints verbatim, centre char has a look-alike
    const P = [...foldHan(bodyText(s.paddle))];
    const ctlSites = [];
    for (let i = 4; i < P.length - 4; i++) if (LOOK[P[i]]) { const w = P.slice(i - 4, i + 5).join(''); if (s.kanripo.includes(w)) ctlSites.push(i); }
    const ci = ctlSites.length ? ctlSites[Math.floor(rng() * ctlSites.length)] : null;
    const control = ci == null ? null : { before: P.slice(ci - 4, ci).join(''), after: P.slice(ci + 1, ci + 5).join(''), paddle: P[ci], kanripo: P[ci], fake: LOOK[P[ci]], control: true };
    for (const [fam, armsOf, req] of [['gem', ['opus-correct', 'opus-redo'], reqGem], ['opus', ['pro-correct', 'flashhigh-correct'], reqOpus]]) {
      const mine = ts.filter((t) => t.by.some((a) => armsOf.includes(a))).slice(0, MAX_ITEMS);
      if (!mine.length) continue;
      const list = control ? [...mine, control] : mine;
      // control goes in a seeded position
      if (control) { const k = Math.floor(rng() * list.length); list.splice(list.length - 1, 1); list.splice(k, 0, control); }
      const lines = list.map((t, k) => {
        const real = t.control ? t.kanripo : t.paddle, alt = t.control ? t.fake : t.kanripo;
        const flip = rng() < 0.5; const A = flip ? alt : real, B = flip ? real : alt;
        items.push({ uid, judge: fam, n: k + 1, control: !!t.control, before: t.before, after: t.after, paddle: t.paddle, kanripo: t.kanripo, fake: t.fake ?? null, A_is: flip ? (t.control ? 'fake' : 'kanripo') : (t.control ? 'true' : 'paddle'), by: t.by ?? [] });
        return `${k + 1}. ${t.before}［？］${t.after}\n   A: ${show(A)}\n   B: ${show(B)}`;
      });
      const prompt = head + lines.join('\n') + (fam === 'opus' ? '\n\nThe page image is the file ./page.jpg in the current directory. Open it with the Read tool (the only tool you may use), then reply with the JSON only.' : '\n\nThe page image is the attached file. Reply with the JSON only.');
      req.push({ uid: `${uid}~${fam}`, image: s.image, prompt });
    }
  }
  const W = (f, rows) => fs.writeFileSync(f, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  W('ro-req-gem.jsonl', reqGem); W('ro-req-opus.jsonl', reqOpus);
  fs.writeFileSync('ro-items.json', JSON.stringify(items, null, 1));
  console.log('pages', byPage.size, 'gem calls', reqGem.length, 'opus calls', reqOpus.length, 'items', items.length, 'controls', items.filter((i) => i.control).length);
} else if (MODE === 'score') {
  const items = JSON.parse(fs.readFileSync('ro-items.json', 'utf8'));
  const outs = new Map();
  for (const [fam, f] of [['gem', 'ro-out-gem.jsonl'], ['gem', 'ro-out-gem-b.jsonl'], ['opus', 'ro-out-opus.jsonl']]) for (const r of readJsonl(f)) {
    if (!r.text) continue; const m = r.text.match(/\{[\s\S]*\}/); let j = null; try { j = JSON.parse(m[0]); } catch { /* unparseable */ }
    if (j?.items) outs.set(r.uid, new Map(j.items.map((x) => [x.n, x.choice])));
  }
  const res = items.map((it) => {
    const ch = outs.get(`${it.uid}~${it.judge}`)?.get(it.n);
    const picked = ch === 'A' ? it.A_is : ch === 'B' ? (it.control ? (it.A_is === 'fake' ? 'true' : 'fake') : (it.A_is === 'paddle' ? 'kanripo' : 'paddle')) : ch ? ch : 'no answer';
    return { ...it, picked };
  });
  const ctl = res.filter((r) => r.control);
  const real = res.filter((r) => !r.control);
  const tally = (rs) => rs.reduce((o, r) => ((o[r.picked] = (o[r.picked] || 0) + 1), o), {});
  // per arm: of its toward-Kanripo edits that the other family judged, the share where the image shows Paddle's reading
  const perArm = {};
  for (const arm of ['opus-correct', 'opus-redo', 'pro-correct', 'flashhigh-correct']) {
    const fam = arm.startsWith('opus') ? 'gem' : 'opus';
    const rs = real.filter((r) => r.judge === fam && r.by.includes(arm));
    const ans = rs.filter((r) => ['paddle', 'kanripo', 'neither'].includes(r.picked));
    perArm[arm] = { judged: rs.length, answered: ans.length, ...tally(rs), unsupported_share: ans.length ? +(ans.filter((r) => r.picked === 'paddle').length / ans.length).toFixed(3) : null };
  }
  const out = { controls: { gem: tally(ctl.filter((r) => r.judge === 'gem')), opus: tally(ctl.filter((r) => r.judge === 'opus')) }, per_arm: perArm, items: res };
  fs.writeFileSync('readoff.json', JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ controls: out.controls, per_arm: perArm }, null, 1));
}
