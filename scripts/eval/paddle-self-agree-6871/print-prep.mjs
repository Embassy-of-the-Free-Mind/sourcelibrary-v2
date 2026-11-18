#!/usr/bin/env node
/**
 * Stage 2 (PREREG-print.md): flags from the GPU arms, then the blind judged sample.
 * PRIOR ART: scripts/eval/paddle-zh-qa-6388/ (the Opus review rubric, adapted in prompt-print.txt, and its planted
 * controls: a 6-char insertion, a 6-char deletion and a 4-char substitution per copy) and score.mjs here (the signal).
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local print-prep.mjs [--dir /root/jobs/paddle-self-agree-6871/print]
 * Writes DIR/flags.json (every drawn page with d), DIR/judge/requests.jsonl + images, DIR/judge/key.json (the group of
 * each opaque id: read only by print-score.mjs). Reads Mongo; writes nothing there.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withMongo } from '../../lib/mongo.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { bodyText, foldHan } from '../ground-truth-5935/lib.mjs';
import { cer } from '../zh-skqs-5568-kanripo.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const DIR = arg('dir', '/root/jobs/paddle-self-agree-6871/print'), LANE = '/root/jobs/paddle-print-6101';
const FLAG = 0.05, N_GROUP = 40, N_CTRL = 5, SEED = 6873;
const DITTO = /[｜|│┃]/g;
const han = (t) => foldHan(bodyText(t).replace(DITTO, '丨'));
const dis = (a, b) => (a == null || b == null ? null : (cer(a, b) + cer(b, a)) / 2);
const leafText = (root, bid, leaves) => { const ts = leaves.map((n) => { const f = path.join(root, bid, `${n}.txt`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; }); return ts.some((t) => t == null) ? null : ts.join('\n'); };

const pages = JSON.parse(fs.readFileSync(path.join(DIR, 'pages.json'), 'utf8')).map((p) => {
  const stored = leafText(path.join(LANE, 'out'), p.bid, p.leaves), off = leafText(path.join(DIR, 'OFF/out'), p.bid, p.leaves), on = leafText(path.join(DIR, 'ON/out'), p.bid, p.leaves);
  const hs = stored == null ? null : han(stored), ho = off == null ? null : han(off), hn = on == null ? null : han(on);
  return { ...p, han: hs ? [...hs].length : 0, d: dis(hs, hn), d_fresh: dis(ho, hn), drift: dis(hs, ho) };
});
const ok = pages.filter((p) => p.d != null);
fs.writeFileSync(path.join(DIR, 'flags.json'), JSON.stringify(pages, null, 1));
const flagged = ok.filter((p) => p.d >= FLAG);
console.log(`${ok.length}/${pages.length} pages scored; flagged ${flagged.length} (${(100 * flagged.length / ok.length).toFixed(1)}%)`);

const rnd = makeRng(SEED);
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const J = path.join(DIR, 'judge'); fs.mkdirSync(path.join(J, 'img'), { recursive: true });
const prompt = fs.readFileSync(path.join(HERE, 'prompt-print.txt'), 'utf8');

await withMongo(async (db) => {
  async function pick(pool, n, used) {
    const out = [];
    for (const p of shuffle(pool)) {
      if (out.length >= n) break;
      if (used.has(p.bid)) continue;
      const d = await db.collection('pages').findOne({ id: p.pid }, { projection: { 'ocr.data': 1, 'ocr.source': 1, 'ocr.revision': 1, photo_original: 1 } });
      const text = d?.ocr?.data;
      // still the lane's text: the stored read and the page's text agree (no edit or later lane since)
      if (!text || dis(han(text), han(leafText(path.join(LANE, 'out'), p.bid, p.leaves))) > 0.02) continue;
      const img = path.join(J, 'img', `${p.pid}.jpg`);
      if (!fs.existsSync(img)) { const r = await fetch(p.image); if (!r.ok) continue; fs.writeFileSync(img, Buffer.from(await r.arrayBuffer())); }
      used.add(p.bid); out.push({ ...p, text, img });
    }
    return out;
  }
  const used = new Set();
  const F = await pick(flagged, N_GROUP, used), U = await pick(ok.filter((p) => p.d < FLAG), N_GROUP + N_CTRL, used);
  const C = U.splice(N_GROUP, N_CTRL).map((p) => ({ ...p, ...plant(p.text) }));
  const all = shuffle([...F.map((p) => ({ ...p, group: 'flagged' })), ...U.map((p) => ({ ...p, group: 'unflagged' })), ...C.map((p) => ({ ...p, group: 'control' }))]);
  const key = {}, reqs = [];
  all.forEach((p, i) => {
    const uid = `p${String(i + 1).padStart(3, '0')}`;
    key[uid] = { group: p.group, pid: p.pid, bid: p.bid, pn: p.pn, d: p.d, planted: p.planted || null };
    reqs.push({ uid, image: p.img, prompt: prompt.replace('{TRANSCRIPTION}', p.planted ? p.textPlanted : p.text) });
  });
  fs.writeFileSync(path.join(J, 'key.json'), JSON.stringify(key, null, 1));
  fs.writeFileSync(path.join(J, 'requests.jsonl'), reqs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  console.log(`judge set: flagged ${F.length}, unflagged ${U.length}, controls ${C.length} → ${J}`);
});

// three planted spans in the body (#6388 controls): insert 6 Han, delete 6, substitute 4
function plant(text) {
  const lines = text.split('\n'); const bodyIdx = lines.map((l, i) => [l, i]).filter(([l]) => [...l].filter((c) => /\p{Script=Han}/u.test(c)).length >= 12 && !/^</.test(l)).map(([, i]) => i);
  const FILL = '天地玄黃宇宙洪荒日月盈昃辰宿列張';
  const pickLine = () => bodyIdx[Math.floor(rnd() * bodyIdx.length)];
  const planted = [];
  const ins = pickLine(); { const l = [...lines[ins]]; const at = 2 + Math.floor(rnd() * (l.length - 4)); const s = FILL.slice(0, 6); l.splice(at, 0, ...s); lines[ins] = l.join(''); planted.push({ kind: 'insert', text: s }); }
  const del = pickLine(); { const l = [...lines[del]]; const at = Math.floor(rnd() * Math.max(1, l.length - 6)); planted.push({ kind: 'delete', text: l.slice(at, at + 6).join('') }); l.splice(at, 6); lines[del] = l.join(''); }
  const sub = pickLine(); { const l = [...lines[sub]]; const at = Math.floor(rnd() * Math.max(1, l.length - 4)); const s = [...FILL.slice(6, 10)]; planted.push({ kind: 'substitute', was: l.slice(at, at + 4).join(''), text: s.join('') }); l.splice(at, 4, ...s); lines[sub] = l.join(''); }
  return { planted, textPlanted: lines.join('\n') };
}
