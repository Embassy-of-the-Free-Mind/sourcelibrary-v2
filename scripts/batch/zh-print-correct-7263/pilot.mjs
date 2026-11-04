#!/usr/bin/env node
// PRIOR ART: scripts/eval/zh-gemini-reocr-7263/draw.mjs and arms.mjs (the draw and the plan.json + texts/ shape
// router-confirm/confirm.mjs judges, restated: draw.mjs takes one page a book only, at 1 a call); router-confirm/confirm.mjs
// judge and scripts/eval/correction-pass-7818/lib.mjs judgeAbsolute (the blind judge, run unchanged);
// correct.mjs and cli-ocr.mjs apply (the reader and the dry apply, run unchanged). scripts/lib/leaf-shift.mjs votes on printed
// numbers, which these pages mostly do not print, so the neighbour test here compares Han bigrams with the stored texts.
/**
 * #7263 job zh-print-correct-7263: the pilot before any write. Read-only on Mongo (the corrections go to disk and R2).
 *   draw     --books=books.json --pages=pages.jsonl.gz --out=DIR [--seed=7263]   sets one/ and ten/, one judged page a book
 *   collect  --out=DIR                                                           served text per judged page, plan.json per set
 *   score    --out=DIR                                                           the bar, own-leaf on every ten/ page
 * A set `one` book is corrected one page a call. A set `ten` book has a call of 10 consecutive owed pages, of which one
 * page, at a seeded position, is judged. Served text is what `cli-ocr.mjs apply --emit-written` would write; a page it
 * refuses, or an UNCHANGED, CONTAIN or no answer, serves the stored text.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { MongoClient } from 'mongodb';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { bodyCharCount } from '../../lib/paddle-print-lane.mjs';
import { makeRng } from '../../eval/lib/paired-stats.mjs';
import { wrongText } from '../../eval/correction-pass-7818/lib.mjs';
import { bigrams, dice } from './bigrams.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const OUT = path.resolve(arg('out'));
const SEED = Number(arg('seed', 7263));
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const SETS = { one: 30, ten: 30 };

async function draw() {
  const books = rj(arg('books')).books.filter((b) => !b.gate && b.owed > 0);
  const rows = zlib.gunzipSync(fs.readFileSync(arg('pages'))).toString().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.state === 'owed');
  const ev = new Set();
  for (const f of ['plan-print.json.gz', 'plan-siku.json.gz']) for (const s of JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL(`../../eval/zh-gemini-reocr-7263/results/${f}`, import.meta.url)))).selected) ev.add(s.page_id);
  const byBook = new Map(); for (const r of rows) if (!ev.has(r.page_id)) (byBook.get(r.book_id) ?? byBook.set(r.book_id, []).get(r.book_id)).push(r);
  const rnd = makeRng(SEED);
  // Books with probability proportional to owed pages, no replacement (exponential keys), as #8008's draw.
  const order = books.filter((b) => byBook.has(b.book_id)).sort((a, b) => a.book_id.localeCompare(b.book_id)).map((b) => ({ b, key: -Math.log(1 - rnd()) / byBook.get(b.book_id).length })).sort((x, y) => x.key - y.key).map((x) => x.b);
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  const picked = { one: [], ten: [] }; const skipped = {};
  for (const b of order) {
    const ps = byBook.get(b.book_id).sort((x, y) => x.page_number - y.page_number);
    // A book's set alternates by the draw, unless it is too short for a call of 10.
    const consecutive = []; for (let i = 0; i + 9 < ps.length; i++) if (ps[i + 9].page_number - ps[i].page_number === 9) consecutive.push(i);
    const want = picked.ten.length <= picked.one.length && consecutive.length ? 'ten' : 'one';
    const set = picked[want].length < SETS[want] ? want : (picked.one.length < SETS.one ? 'one' : consecutive.length && picked.ten.length < SETS.ten ? 'ten' : null);
    if (!set) continue;
    const r2 = makeRng(SEED + parseInt(b.book_id.slice(-6), 16));
    let call, judged;
    if (set === 'ten') { const st = consecutive[Math.floor(r2() * consecutive.length)]; call = ps.slice(st, st + 10); judged = call[Math.floor(r2() * 10)]; } else { judged = ps[Math.floor(r2() * ps.length)]; call = [judged]; }
    const doc = await db.collection('pages').findOne({ id: judged.page_id }, { projection: { id: 1, book_id: 1, page_number: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1, crop: 1 } });
    const image = getPageSource(doc)?.replace(/\s+/g, '');
    if (!image) { skipped['no image'] = (skipped['no image'] ?? 0) + 1; continue; }
    const res = await fetch(image).catch(() => null); const n = res?.ok ? (await res.arrayBuffer()).byteLength : 0;
    if (n < 2000) { skipped['image fetch'] = (skipped['image fetch'] ?? 0) + 1; continue; }
    picked[set].push({ b, call, judged, image });
    if (picked.one.length >= SETS.one && picked.ten.length >= SETS.ten) break;
  }
  await c.close();
  for (const [set, list] of Object.entries(picked)) {
    const dir = path.join(OUT, set); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.jsonl'), list.flatMap((x) => x.call.map((p) => JSON.stringify({ page_id: p.page_id, book_id: x.b.book_id, slug: x.b.slug, page_number: p.page_number, why: 'zh-print-correct-7263 pilot', stored_model: p.model }))).join('\n') + '\n');
    fs.writeFileSync(path.join(dir, 'judged.json'), JSON.stringify(list.map((x) => ({ page_id: x.judged.page_id, book_id: x.b.book_id, title: x.b.title, page_number: x.judged.page_number, position: x.call.indexOf(x.judged) + 1, image: x.image, model: x.judged.model, status: x.b.hold ?? x.b.status, views: x.b.views, en: x.judged.en })), null, 1));
    console.log(`${set}: ${list.length} books, ${list.reduce((t, x) => t + x.call.length, 0)} pages to correct; positions judged ${list.map((x) => x.call.indexOf(x.judged) + 1).join(',')}`);
  }
  console.log(`skipped ${JSON.stringify(skipped)}; books in the draw order ${order.length}`);
}

function collect() {
  for (const set of Object.keys(SETS)) {
    const dir = path.join(OUT, set), judged = rj(path.join(dir, 'judged.json'));
    const written = new Map(jsonl(path.join(dir, 'written.jsonl')).map((r) => [r.page_id, r.text]));
    const J = path.join(dir, 'judge'); fs.mkdirSync(path.join(J, 'texts'), { recursive: true });
    const tally = {}; const selected = [];
    for (const j of judged) {
      const meta = fs.existsSync(path.join(dir, 'reads', `${j.page_id}.meta.json`)) ? rj(path.join(dir, 'reads', `${j.page_id}.meta.json`)) : { outcome: 'not read' };
      const stored = fs.readFileSync(path.join(dir, 'stored', `${j.page_id}.txt`), 'utf8');
      const text = written.get(j.page_id) ?? stored;
      const why = written.has(j.page_id) ? 'written' : meta.outcome === 'corrected' ? 'refused by apply' : meta.outcome;
      tally[why] = (tally[why] ?? 0) + 1;
      const key = `P-${j.page_id}`;
      fs.writeFileSync(path.join(J, 'texts', `${key}.O.txt`), text);
      selected.push({ key, book_id: j.book_id, title: j.title, page_id: j.page_id, page_number: j.page_number, image: j.image, block: [j.page_id], served: why, position: j.position, han: bodyCharCount(text) });
    }
    fs.writeFileSync(path.join(J, 'plan.json'), JSON.stringify({ at: new Date().toISOString(), cell: `zh-print-pilot/${set}`, lang_name: 'Chinese', arms: [{ arm: 'O', route: `gemini>opus@${set === 'one' ? 1 : 10}`, kind: 'correct' }], rule: { within: 0.08, wrong_text_max: 0.04 }, selected }, null, 1));
    console.log(set, JSON.stringify(tally));
  }
}

function score() {
  const out = {};
  for (const set of Object.keys(SETS)) {
    const dir = path.join(OUT, set), P = rj(path.join(dir, 'judge', 'plan.json'));
    const vs = jsonl(path.join(dir, 'judge', 'verdicts.jsonl'));
    const abs = new Map(vs.filter((v) => v.set === 'abs' && v.verdict).map((v) => [v.key, v]));
    const rows = P.selected.map((s) => { const v = abs.get(s.key)?.verdict; return { key: s.key, page_id: s.page_id, page_number: s.page_number, title: s.title, served: s.served, position: s.position, accept: v?.accept ?? null, fidelity: v?.fidelity ?? null, wrong: v ? wrongText(v) : null, not_leaf: v ? (v.defects || []).some((d) => /not_this_leaf|wrong.?leaf|I4|neighbou?r/i.test(`${d.class} ${d.kind} ${d.severity}`)) : null, summary: v?.summary ?? v?.why ?? null, defects: (v?.defects || []).filter((d) => d.severity === 'wrong_text' || d.severity === 'misleads').slice(0, 4) }; });
    const ctl = vs.filter((v) => v.set === 'wrong_page' && v.verdict);
    // Own leaf on every corrected page of the set, by Han bigrams with the stored text of this page and of its neighbours in the call.
    const man = jsonl(path.join(dir, 'manifest.jsonl')); const leaf = []; const byBook = new Map();
    for (const m of man) (byBook.get(m.book_id) ?? byBook.set(m.book_id, []).get(m.book_id)).push(m);
    const R = (id) => path.join(dir, 'reads', `${id}.txt`), S = (id) => path.join(dir, 'stored', `${id}.txt`);
    for (const ms of byBook.values()) {
      ms.sort((a, b) => a.page_number - b.page_number);
      ms.forEach((m, i) => {
        if (!fs.existsSync(R(m.page_id)) || !fs.existsSync(S(m.page_id))) return;
        const t = fs.readFileSync(R(m.page_id), 'utf8'); if (!t) return;
        const b = bigrams(t), own = dice(b, bigrams(fs.readFileSync(S(m.page_id), 'utf8')));
        const near = [ms[i - 1], ms[i + 1]].filter(Boolean).filter((n) => fs.existsSync(S(n.page_id))).map((n) => dice(b, bigrams(fs.readFileSync(S(n.page_id), 'utf8'))));
        leaf.push({ page_id: m.page_id, page_number: m.page_number, own: +own.toFixed(3), neighbour: +Math.max(0, ...near).toFixed(3), position: i + 1 });
      });
    }
    const metas = man.map((m) => { const f = path.join(dir, 'reads', `${m.page_id}.meta.json`); return fs.existsSync(f) ? rj(f) : null; }).filter(Boolean);
    const outcomes = {}; for (const m of metas) outcomes[m.outcome] = (outcomes[m.outcome] ?? 0) + 1;
    const calls = jsonl(path.join(dir, 'calls.jsonl'));
    out[set] = { judged: rows.filter((r) => r.accept != null).length, n: rows.length, accepted: rows.filter((r) => r.accept).length, wrong_text: rows.filter((r) => r.wrong).length, not_this_leaf: rows.filter((r) => r.not_leaf).length, mean_fidelity: +(rows.reduce((t, r) => t + (r.fidelity ?? 0), 0) / Math.max(1, rows.filter((r) => r.fidelity != null).length)).toFixed(2), served: rows.reduce((t, r) => ({ ...t, [r.served]: (t[r.served] ?? 0) + 1 }), {}), controls: { n: ctl.length, accepted: ctl.filter((v) => v.verdict.accept).length }, outcomes, calls: calls.length, pages: metas.length, list_usd: +calls.reduce((t, c) => t + (c.usage?.list_cost_usd ?? 0), 0).toFixed(2), own_leaf: { checked: leaf.length, own_below_neighbour: leaf.filter((l) => l.neighbour > l.own).length, own_below_05: leaf.filter((l) => l.own < 0.5).length, flagged: leaf.filter((l) => l.neighbour > l.own || l.own < 0.5) }, rows };
  }
  const both = Object.values(out);
  const res = { at: new Date().toISOString(), bar: 'at least 50/60 accepted, no more than 4 wrong-text', accepted: both.reduce((t, s) => t + s.accepted, 0), judged: both.reduce((t, s) => t + s.judged, 0), wrong_text: both.reduce((t, s) => t + s.wrong_text, 0), sets: out };
  res.pass = res.judged >= 60 && res.accepted >= 50 && res.wrong_text <= 4 && both.every((s) => s.controls.accepted === 0);
  fs.writeFileSync(path.join(OUT, 'score.json'), JSON.stringify(res, null, 1));
  console.log(JSON.stringify({ ...res, sets: Object.fromEntries(Object.entries(out).map(([k, s]) => [k, { ...s, rows: undefined, own_leaf: { ...s.own_leaf, flagged: s.own_leaf.flagged.slice(0, 12) } }])) }, null, 1));
}

const stage = process.argv[2];
if (stage === 'draw') await draw(); else if (stage === 'collect') collect(); else if (stage === 'score') score(); else { console.error('stages: draw | collect | score'); process.exit(2); }
