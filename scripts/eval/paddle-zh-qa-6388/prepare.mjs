#!/usr/bin/env node
// PRIOR ART: scripts/eval/ground-truth-5935/kanripo.mjs (the Kanripo leaf rule and body CER, reused here page by page
// instead of over a 1,000-book frame) and scripts/eval/ocr-prereg-6388/reads.mjs (image fetch, opaque request files
// for run-cli-arm.py). Neither plants errors or builds a blind review packet.
//
// #6388 Paddle zh QA, after the draw: stored texts, Kanripo CER, the CONTROL set, the blind request packet.
// READ-ONLY on Mongo; GitHub raw reads for Kanripo (cached). $0, no model call.
//
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/paddle-zh-qa-6388/prepare.mjs <stage>
//     texts     stored ocr.data of the 60 drawn pages               → texts.jsonl (+ images under $JOB_SCRATCH/img)
//     kanripo   Kanripo CER per drawn page (5935 leaf rule)         → kanripo.jsonl
//     controls  10 planted-error copies + 5 byte-identical repeats  → controls.json
//     packet    75 opaque requests in a seeded order                → $JOB_SCRATCH/requests.jsonl, packet-map.json
//
// CONTROL RULE (fixed before any reviewer runs)
//   Plant bases: walk the ALL frame in makeRng(6390) order, skipping the 60 drawn books; take each book's page by the
//   draw's page rule; keep it when its Kanripo leaf is its own (Dice ≥ 0.8), its body has ≥ 120 Han characters and its
//   body CER against Kanripo is ≤ 0.02. First 10 kept.
//   Plants (each page, seeded by makeRng(6392 ^ h(page id))), on body lines only (never <header>/<page-num>):
//     P1 invented  — 6 Han characters inserted at ~25 % of the body (taken from the NEXT base page's body, so they are
//                    real SKQS text, not noise);
//     P2 omitted   — 6 consecutive Han characters deleted at ~55 %;
//     P3 invented  — 4 consecutive characters replaced by 4 donor characters at ~85 % (a wrong reading in place).
//   Repeats: 5 of the 60 drawn pages by makeRng(6391), sent again byte-identically (same prompt, same image).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { makeRng } from '../lib/paired-stats.mjs';
import { workInfo, pbPages } from '../zh-skqs-5568-kanripo.mjs';
import { bodyText, foldHan, bodyCer, isInterior } from '../ground-truth-5935/lib.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SCRATCH = process.env.JOB_SCRATCH || '/tmp/paddle-qa-6388';
const IMG = path.join(SCRATCH, 'img');
fs.mkdirSync(IMG, { recursive: true });
const H = f => path.join(HERE, f);
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const readJsonl = f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const writeJsonl = (f, rows) => fs.writeFileSync(f, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
const hseed = (s, id) => s ^ parseInt(createHash('sha256').update(String(id)).digest('hex').slice(0, 8), 16);
const shuffle = (xs, seed) => { const a = [...xs], r = makeRng(seed); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
export const imgPath = uid => path.join(IMG, uid.replace(/[^\w.-]/g, '_') + '.jpg');
const LANE = 'paddle-zh-2026-10', QA_TRUST = 0.6;
const HAN = /\p{Script=Han}/u;

async function mongo() { const c = await MongoClient.connect(process.env.MONGODB_URI); return { c, db: c.db('bookstore') }; }
async function fetchImage(url, f) {
  if (fs.existsSync(f) && fs.statSync(f).size > 1000) return true;
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) return false;
  const b = Buffer.from(await res.arrayBuffer());
  if (b.length < 1000) return false;
  fs.writeFileSync(f, b); return true;
}

/** Kanripo CER of one stored page by the #5935 leaf rule. Returns {status, ...}. */
async function kanripoScore(db, pageId) {
  const p = await db.collection('pages').findOne({ id: pageId }, { projection: { _id: 0, book_id: 1, page_number: 1, 'ocr.data': 1, 'ocr.qa_screen': 1 } });
  const qa = p.ocr?.qa_screen;
  if (qa?.status !== 'screened') return { status: 'not-screened', reason: qa?.reason ?? qa?.status ?? 'no qa_screen' };
  const krId = String(qa.repo || '').replace(/^kanripo\//, '');
  const w = await workInfo(krId);
  const juanOf = pb => Number(String(pb || '').match(/_(\d{3})-\d+[ab]$/)?.[1]);
  const j = juanOf(qa.pb);
  const pbs = await pbPages(krId, 'WYG', (w.juan_files || []).filter(x => Math.abs(x - j) <= 1));
  const idx = pb => pbs.findIndex(x => x.pb === pb);
  const nb = await db.collection('pages').find({ book_id: p.book_id, page_number: { $in: [p.page_number - 1, p.page_number + 1] } }, { projection: { _id: 0, page_number: 1, 'ocr.qa_screen': 1 } }).toArray();
  const at = k => nb.find(x => x.page_number === k);
  const trusted = q => q?.ocr?.qa_screen?.status === 'screened' && q.ocr.qa_screen.dice >= QA_TRUST ? idx(q.ocr.qa_screen.pb) : -1;
  let k = -1, leaf = null;
  if (qa.dice >= QA_TRUST) { k = idx(qa.pb); leaf = 'own'; }
  else {
    const a = trusted(at(p.page_number - 1)), b = trusted(at(p.page_number + 1));
    if (a >= 0 && b >= 0 && b - a === 2) { k = a + 1; leaf = 'neighbours'; }
    else if (a >= 0 && b < 0) { k = a + 1; leaf = 'one-neighbour'; }
    else if (b >= 0 && a < 0) { k = b - 1; leaf = 'one-neighbour'; }
  }
  if (k < 0 || k >= pbs.length) return { status: 'unaligned', dice: qa.dice, pb: qa.pb };
  const W = pbs.slice(Math.max(0, k - 1), k + 2).map(x => x.text).join('');
  const Q = foldHan(bodyText(p.ocr.data));
  const s = bodyCer(Q, W, { expected: pbs[k].text.length });
  return { status: 'scored', repo: `kanripo/${krId}`, ref_pb: pbs[k].pb, leaf, dice: qa.dice, q_chars: s.q_chars, expected: pbs[k].text.length, d: s.d, omitted: s.omitted, cer: +s.cer.toFixed(4), kanripo_raw: String(pbs[k].raw || '').replace(/\s+/g, '').slice(0, 1200) };
}

const stage = process.argv[2];
if (stage === 'texts') {
  const d = readJson(H('draw.json'));
  const { c, db } = await mongo();
  const rows = [];
  for (const r of d.rows) {
    const p = await db.collection('pages').findOne({ id: r.page_id }, { projection: { _id: 0, 'ocr.data': 1, 'ocr.content_hash': 1, 'ocr.pipeline': 1 } });
    if (!await fetchImage(r.image, imgPath(r.uid))) throw new Error(`image failed ${r.uid} — promote a spare by hand and record it`);
    rows.push({ uid: r.uid, page_id: r.page_id, pipeline: p.ocr.pipeline, content_hash: p.ocr.content_hash, text: p.ocr.data });
  }
  await c.close();
  writeJsonl(H('texts.jsonl'), rows);
  console.log('texts', rows.length, 'hash changed since draw:', rows.filter((x, i) => x.content_hash !== d.rows[i].ocr_hash).length);
} else if (stage === 'kanripo') {
  const d = readJson(H('draw.json'));
  const { c, db } = await mongo();
  const out = [];
  for (const r of d.rows) {
    let s; try { s = await kanripoScore(db, r.page_id); } catch (e) { s = { status: 'error', error: String(e.message).slice(0, 200) }; }
    out.push({ uid: r.uid, ...s });
    console.log(r.uid, s.status, s.cer ?? '', s.leaf ?? '');
  }
  await c.close();
  writeJsonl(H('kanripo.jsonl'), out);
  const st = out.reduce((m, x) => ((m[x.status] = (m[x.status] || 0) + 1), m), {});
  console.log(JSON.stringify(st));
} else if (stage === 'controls') {
  const d = readJson(H('draw.json'));
  const drawn = new Set(d.rows.map(r => r.book_id));
  const { c, db } = await mongo();
  const ev = await db.collection('book_events').find({ type: 'paddle_zh_reocr', 'details.pages_written': { $gt: 0 } }, { projection: { _id: 0, book_id: 1 } }).toArray();
  const frame = [...new Set(ev.map(e => e.book_id))].sort();
  const bases = [], tried = [];
  for (const id of shuffle(frame, 6390)) {
    if (bases.length >= 11) break; // the 11th is only the donor for the 10th
    if (drawn.has(id)) continue;
    const b = await db.collection('books').findOne({ id }, { projection: { _id: 0, pages_count: 1, title: 1 } });
    if (!b) continue;
    const pages = await db.collection('pages').find({ book_id: id, 'ocr.pipeline': LANE }, { projection: { _id: 0, id: 1, page_number: 1 } }).toArray();
    const n = b.pages_count || Math.max(0, ...pages.map(p => p.page_number));
    const pool = pages.filter(p => isInterior(p.page_number, n)).sort((x, y) => x.page_number - y.page_number);
    if (!pool.length) continue;
    const pg = pool[Math.floor(makeRng(hseed(6388, id))() * pool.length)];
    const p = await db.collection('pages').findOne({ id: pg.id }, { projection: { _id: 0, id: 1, page_number: 1, archived_photo: 1, 'ocr.data': 1, 'ocr.engine.input.image_url': 1, 'ocr.qa_screen': 1 } });
    const qa = p.ocr?.qa_screen;
    const bodyHan = [...bodyText(p.ocr.data)].filter(ch => HAN.test(ch)).length;
    let why = null, k = null;
    if (qa?.status !== 'screened' || !(qa.dice >= 0.8)) why = `dice ${qa?.dice ?? qa?.status}`;
    else if (bodyHan < 120) why = `body han ${bodyHan}`;
    else { k = await kanripoScore(db, p.id); if (k.status !== 'scored' || k.leaf !== 'own' || k.cer > 0.02) why = `kanripo ${k.status} ${k.cer ?? ''}`; }
    tried.push({ book_id: id, page_number: p.page_number, kept: !why, why });
    if (why) continue;
    bases.push({ book_id: id, title: String(b.title || '').slice(0, 80), page_id: p.id, page_number: p.page_number, image: p.ocr?.engine?.input?.image_url || p.archived_photo, text: p.ocr.data, kanripo_cer: k.cer });
  }
  await c.close();
  // Plants
  const bodyLineIdx = lines => lines.map((l, i) => (/^\s*</.test(l) ? -1 : i)).filter(i => i >= 0);
  const plants = [];
  for (let i = 0; i < 10; i++) {
    const base = bases[i], donorText = bases[i + 1].text;
    const donor = [...bodyText(donorText)].filter(ch => HAN.test(ch));
    const rng = makeRng(hseed(6392, base.page_id));
    const lines = base.text.split('\n');
    // Han positions in body lines, as [line, col]
    const pos = [];
    for (const li of bodyLineIdx(lines)) [...lines[li]].forEach((ch, ci) => { if (HAN.test(ch)) pos.push([li, ci]); });
    const chars = lines.map(l => [...l]);
    // A span never runs past its line: the start is pulled back so the full n characters fit.
    const at = (f, n) => { const [li, ci] = pos[Math.min(pos.length - 8, Math.floor(pos.length * f + rng() * 4))]; return [li, Math.max(0, Math.min(ci, chars[li].length - n))]; };
    const spans = [];
    // Apply from the END so earlier positions stay valid.
    const d0 = Math.floor(rng() * (donor.length - 12));
    // P3 invented-in-place at ~85 %
    { const [li, ci] = at(0.85, 4); const n = Math.min(4, chars[li].length - ci); const was = chars[li].slice(ci, ci + n).join(''); let rep = donor.slice(d0, d0 + n); if (rep.join('') === was) rep = donor.slice(d0 + 5, d0 + 5 + n); chars[li].splice(ci, n, ...rep); spans.push({ id: 'P3', type: 'invented', kind: 'substituted', line: li, col: ci, planted: rep.join(''), original: was, before: chars[li].slice(Math.max(0, ci - 6), ci).join('') }); }
    // P2 omitted at ~55 %
    { const [li, ci] = at(0.55, 6); const n = Math.min(6, chars[li].length - ci); const was = chars[li].slice(ci, ci + n).join(''); chars[li].splice(ci, n); spans.push({ id: 'P2', type: 'omitted', kind: 'deleted', line: li, col: ci, planted: '', original: was, before: chars[li].slice(Math.max(0, ci - 6), ci).join('') }); }
    // P1 invented insertion at ~25 %
    { const [li, ci] = at(0.25, 0); const ins = donor.slice(d0 + 6, d0 + 12); chars[li].splice(ci, 0, ...ins); spans.push({ id: 'P1', type: 'invented', kind: 'inserted', line: li, col: ci, planted: ins.join(''), original: '', before: chars[li].slice(Math.max(0, ci - 6), ci).join('') }); }
    plants.push({ uid: `plant|${base.book_id}|${base.page_number}`, ...base, original_text: base.text, text: chars.map(cs => cs.join('')).join('\n'), spans: spans.reverse() });
  }
  const repeats = shuffle(d.rows.map(r => r.uid), 6391).slice(0, 5);
  const out = { rule: 'see header of prepare.mjs', bases_tried: tried, plants, repeats };
  fs.writeFileSync(H('controls.json'), JSON.stringify(out, null, 1) + '\n');
  for (const p of plants) await fetchImage(p.image, imgPath(p.uid));
  console.log('plants', plants.length, 'tried', tried.length, 'repeats', repeats.join(' '));
} else if (stage === 'packet') {
  const texts = new Map(readJsonl(H('texts.jsonl')).map(r => [r.uid, r]));
  const ctl = readJson(H('controls.json'));
  const items = [
    ...[...texts.values()].map(r => ({ uid: r.uid, role: 'sample', text: r.text })),
    ...ctl.plants.map(p => ({ uid: p.uid, role: 'plant', text: p.text })),
    ...ctl.repeats.map(u => ({ uid: u, role: 'repeat', text: texts.get(u).text })),
  ];
  const order = shuffle(items, 6393);
  const prompt = fs.readFileSync(H('prompt.txt'), 'utf8');
  const map = [], reqs = [];
  order.forEach((it, i) => {
    const qid = `q${String(i + 1).padStart(3, '0')}`;
    const img = path.join(SCRATCH, 'packet', `${qid}.jpg`);
    fs.mkdirSync(path.dirname(img), { recursive: true });
    fs.copyFileSync(imgPath(it.uid), img);
    map.push({ qid, uid: it.uid, role: it.role, text_sha: createHash('sha256').update(it.text).digest('hex').slice(0, 16) });
    reqs.push({ uid: qid, image: img, prompt: prompt.replace('{TRANSCRIPTION}', it.text) });
  });
  writeJsonl(path.join(SCRATCH, 'requests.jsonl'), reqs);
  fs.writeFileSync(H('packet-map.json'), JSON.stringify({ seed: 6393, prompt_sha: createHash('sha256').update(prompt).digest('hex').slice(0, 16), items: map }, null, 1) + '\n');
  console.log('packet', reqs.length);
} else {
  console.log('stages: texts | kanripo | controls | packet');
}
