#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/judge.mjs (the router tests: draw, translate, packet, judge, score; its German
// translation cell reads claude-translate.mjs output and judges it against the image with judgePrompt). It draws from
// the live pages and their STORED OCR; this test translates the #6560 arm-A corrections, which were never written, so
// it draws from this experiment's scratch and hands claude-translate.mjs the corrected text with --ocr-file. The
// judge prompt, the wrong-page controls and the score.json shape (read by router-table/build.py) are route-judge's;
// the planted reversals are tengyur-characterize/plants.mjs plantReversal, as the #6182 / #6545 packets plant them.
/**
 * Tibetan translation router test (#6948, #6740; Derek's inbox note 2026-10-27 10:33Z): on the corrected Tibetan of
 * the profile experiment (arm A, since no arm passed), agy gemini-3.8-flash-low at 4 pages a call
 * (claude-translate.mjs --cli=agy) against Opus `claude -p` at 10 pages a call, judged by one blind Opus judge against
 * the page image and the corrected transcription, with planted reversals.
 *
 *   node --env-file=.env.production.local translate-router.mjs draw  --root=$JOB_SCRATCH   # tr/sample.json, ids, ocr file
 *   node --env-file=.env.production.local scripts/batch/claude-translate.mjs read --cli=agy --per-call=4 \
 *        --page-ids-file=$JOB_SCRATCH/tr/ids-agy.json --ocr-file=$JOB_SCRATCH/tr/ocr.json --out=$JOB_SCRATCH/tr/agy --fresh
 *   node --env-file=.env.production.local scripts/batch/claude-translate.mjs read --per-call=10 \
 *        --page-ids-file=$JOB_SCRATCH/tr/ids-opus.json --ocr-file=$JOB_SCRATCH/tr/ocr.json --out=$JOB_SCRATCH/tr/opus --fresh
 *   node translate-router.mjs judge-req --root=$JOB_SCRATCH   # tr/judge-req.jsonl -> replicate-6547/run-claude-arm.py
 *   node translate-router.mjs score --root=$JOB_SCRATCH --out=score.json
 *
 * A block is the test page and the pages after it in its book (4 for agy, 10 for Opus), so each call has the
 * production shape; only the test page is judged, and only its OCR is the correction (the rest are stored OCR).
 * Page-break drift: block-drift.mjs cannot see a caseless script, so the judge's T4 (block shift) and T5 (leak /
 * lookahead) defects are counted per route.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { syllableTokens } from '../../../lib/tibetan-yatags-guard.mjs';
import { makePlanters } from '../../tengyur-characterize/plants.mjs';
import { rng as seeded } from '../../tengyur-characterize/common.mjs';

const CMD = process.argv[2];
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const ROOT = arg('root') || process.env.JOB_SCRATCH;
const TR = path.join(ROOT, 'tr');
const readJsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)) : []);
const hash = (t) => createHash('sha256').update(String(t)).digest('hex').slice(0, 12);
const ROUTES = { 'agy-flash-low@4': { dir: 'agy', block: 4 }, 'opus-cli@10': { dir: 'opus', block: 10 } };
const N = 30;
function rngFor(s) {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const shuffle = (xs, rng) => { for (let i = xs.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [xs[i], xs[j]] = [xs[j], xs[i]]; } return xs; };

if (CMD === 'draw') {
  const { MongoClient } = await import('mongodb');
  fs.mkdirSync(TR, { recursive: true });
  const pages = readJsonl(path.join(ROOT, 'set', 'pages.jsonl'));
  const A = new Map(readJsonl(path.join(ROOT, 'out', 'A.jsonl')).filter((r) => r.text?.trim()).map((r) => [r.uid, r.text.trim().normalize('NFC')]));
  const spanA = JSON.parse(fs.readFileSync(path.join(ROOT, 'judge', 'span-A-key.json'), 'utf8'));
  const drafts = new Map(readJsonl(path.join(ROOT, 'req', 'drafts.jsonl')).map((r) => [r.uid, r.draft]));
  const rng = rngFor('6560|tr-router|draw');
  // one page per book from the 72; a page arm A changed by over 25% is not a correction the lane would take
  const byBook = new Map();
  for (const p of pages.sort((a, b) => a.page_number - b.page_number)) if (A.has(p.uid) && !spanA[p.uid]?.wreck) (byBook.get(p.book_id) ?? byBook.set(p.book_id, []).get(p.book_id)).push(p);
  const pick = [...byBook].sort(([a], [b]) => a.localeCompare(b)).map(([, ps]) => ({ ...shuffle(ps, rng)[0], from: 'set' }));
  // fill to 30 from the planted folios of books not drawn, where arm A caught every planted syllable
  const plants = JSON.parse(fs.readFileSync('scripts/eval/results/tibetan-correct-6560/plants.json', 'utf8'));
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  const extra = [];
  for (const fid of shuffle(Object.keys(plants.plants).sort(), rng)) {
    if (pick.length + extra.length >= N) break;
    const uid = `plant|${fid}`, text = A.get(uid);
    const m = fid.match(/^([0-9a-f]{24})_(\d+)$/);
    if (!text || !m || byBook.has(m[1])) continue;
    const draft = drafts.get(uid), lines = draft.split('\n');
    const toks = syllableTokens(text).map((x) => x.syl);
    // caught = the planted syllable is not in the output's context window (judge.mjs score's survival rule, simplified)
    const survives = plants.plants[fid].plants.some((q) => toks.join(' ').includes([...q.prev.slice(-1), q.planted, ...q.next.slice(0, 1)].join(' ')));
    if (survives) continue;
    const p = await db.collection('pages').findOne({ book_id: m[1], page_number: Number(m[2]) }, { projection: { id: 1 } });
    if (!p) continue;
    void lines;
    extra.push({ uid, page_id: p.id, book_id: m[1], page_number: Number(m[2]), group: 'planted-folio (arm A caught every plant)', from: 'plants' });
  }
  const sample = [...pick.map((p) => ({ uid: p.uid, page_id: p.page_id, book_id: p.book_id, page_number: p.page_number, group: p.group, from: 'set' })), ...extra];
  // the block after each test page: the next pages of its book that have OCR
  const ids = { agy: [], opus: [] }, ocr = {};
  for (const s of sample) {
    const next = await db.collection('pages').find({ book_id: s.book_id, page_number: { $gt: s.page_number, $lte: s.page_number + 9 }, 'ocr.data': { $exists: true } }, { projection: { id: 1, page_number: 1 } }).sort({ page_number: 1 }).toArray();
    const run = [s.page_id];
    for (const n of next) { if (n.page_number !== s.page_number + run.length) break; run.push(n.id); }
    s.block_agy = run.slice(0, 4); s.block_opus = run.slice(0, 10);
    ids.agy.push(...s.block_agy); ids.opus.push(...s.block_opus);
    ocr[s.page_id] = A.get(s.uid);
  }
  await c.close();
  fs.writeFileSync(path.join(TR, 'sample.json'), JSON.stringify({ built_at: new Date().toISOString(), n: sample.length, books: new Set(sample.map((s) => s.book_id)).size,
    source: 'arm A (the current #6560 prompt) corrections from the profile experiment, never written; no arm passed its rule', pages: sample }, null, 1));
  fs.writeFileSync(path.join(TR, 'ids-agy.json'), JSON.stringify(ids.agy));
  fs.writeFileSync(path.join(TR, 'ids-opus.json'), JSON.stringify(ids.opus));
  fs.writeFileSync(path.join(TR, 'ocr.json'), JSON.stringify(ocr));
  console.log(`draw: ${sample.length} test pages in ${new Set(sample.map((s) => s.book_id)).size} books (${extra.length} planted folios); agy ${ids.agy.length} pages, opus ${ids.opus.length} pages`);
} else if (CMD === 'judge-req') {
  const { judgePrompt } = await import('../../route-judge-6740/judge.mjs');
  const S = JSON.parse(fs.readFileSync(path.join(TR, 'sample.json'), 'utf8'));
  const ocr = JSON.parse(fs.readFileSync(path.join(TR, 'ocr.json'), 'utf8'));
  const img = new Map(readJsonl(path.join(ROOT, 'req', 'A.jsonl')).map((r) => [r.uid, r.image]));
  const P = makePlanters(seeded(6948));
  const rng = rngFor('6560|tr-router|judge');
  const reqs = [], key = {};
  const add = (uid, s, text, meta) => {
    reqs.push({ uid, image: img.get(s.uid), prompt: judgePrompt({ task: 'translation', lang: 'Tibetan', source: ocr[s.page_id], text }, 'the file ./page.jpg in your working directory (open it with Read before you answer)') });
    key[uid] = { page_id: s.page_id, book_id: s.book_id, page_number: s.page_number, ...meta };
  };
  const tr = (route, pid) => { try { return fs.readFileSync(path.join(TR, ROUTES[route].dir, `${pid}.txt`), 'utf8').trim(); } catch { return ''; } };
  for (const [i, s] of S.pages.entries()) {
    for (const route of Object.keys(ROUTES)) { const t = tr(route, s.page_id); if (t) add(`${s.page_id}|${route}`, s, t, { route, kind: 'item' }); }
    // a planted reversal in one route's English per page, the route alternating (seeded order of pages)
    const route = Object.keys(ROUTES)[i % 2], t = tr(route, s.page_id);
    const pl = t && P.plantReversal(t);
    if (pl) add(`${s.page_id}|${route}|planted`, s, t.replace(pl.old, pl.new), { route, kind: 'planted', plant: pl });
  }
  // wrong-page controls, 2 per route: this page's image, another test page's English from the same route
  for (const route of Object.keys(ROUTES)) {
    const have = shuffle(S.pages.filter((s) => tr(route, s.page_id)), rng);
    for (let k = 0; k < 2 && have.length > 2; k++) add(`${have[k].page_id}|${route}|control`, have[k], tr(route, have[k + 1 + (k % 2)].page_id), { route, kind: 'control' });
  }
  shuffle(reqs, rng);
  fs.writeFileSync(path.join(TR, 'judge-req.jsonl'), reqs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(TR, 'judge-key.json'), JSON.stringify(key));
  console.log(`judge-req: ${reqs.length} requests (${Object.values(key).filter((k) => k.kind === 'item').length} items, ${Object.values(key).filter((k) => k.kind === 'planted').length} planted, ${Object.values(key).filter((k) => k.kind === 'control').length} controls)`);
} else if (CMD === 'score') {
  const key = JSON.parse(fs.readFileSync(path.join(TR, 'judge-key.json'), 'utf8'));
  const S = JSON.parse(fs.readFileSync(path.join(TR, 'sample.json'), 'utf8'));
  const parseJ = (t) => { const m = String(t || '').match(/\{[\s\S]*\}/); if (!m) return null; try { const v = JSON.parse(m[0]); return typeof v.accept === 'boolean' && Number(v.fidelity) >= 1 && Number(v.fidelity) <= 5 ? v : null; } catch { return null; } };
  const V = Object.fromEntries(readJsonl(path.join(TR, 'judge-out.jsonl')).filter((r) => r.text).map((r) => [r.uid, parseJ(r.text)]));
  const wt = (v) => (v?.defects || []).filter((d) => d.severity === 'wrong_text');
  const cls = (d) => String(d.class || '').toUpperCase().match(/^[IOTDE]\d+/)?.[0] ?? 'E2';
  const words = (s) => new Set(String(s).toLowerCase().match(/[a-z]{3,}/g) || []);
  const routes = {};
  const calls = {};
  for (const route of Object.keys(ROUTES)) {
    const metas = fs.readdirSync(path.join(TR, ROUTES[route].dir)).filter((f) => f.endsWith('.meta.json')).map((f) => JSON.parse(fs.readFileSync(path.join(TR, ROUTES[route].dir, f), 'utf8')));
    const callRows = readJsonl(path.join(TR, ROUTES[route].dir, 'calls.jsonl'));
    calls[route] = { calls: callRows.length, pages_read: metas.filter((m) => m.exit === 0).length, test_pages_read: S.pages.filter((s) => metas.some((m) => m.page_id === s.page_id && m.exit === 0)).length };
    const items = Object.entries(key).filter(([, k]) => k.route === route && k.kind === 'item');
    const v = items.map(([uid, k]) => ({ k, v: V[uid] })).filter((x) => x.v);
    const n = v.length;
    const classes = {};
    for (const x of v) for (const c of new Set((x.v.defects || []).map(cls))) classes[c] = (classes[c] || 0) + 1;
    const wtPages = v.filter((x) => wt(x.v).length);
    const wtClasses = {};
    for (const x of wtPages) for (const c of new Set(wt(x.v).map(cls))) wtClasses[c] = (wtClasses[c] || 0) + 1;
    // planted reversals: caught when the judge rejects the planted copy, or quotes the planted sentence in a defect
    const pl = Object.entries(key).filter(([, k]) => k.route === route && k.kind === 'planted').map(([uid, k]) => {
      const p = V[uid]; if (!p) return null;
      const changed = [...words(k.plant.new)].filter((w) => !words(k.plant.old).has(w));
      const quoted = (p.defects || []).some((d) => { const q = words(d.quote || ''); return changed.some((w) => q.has(w)) || [...words(k.plant.new)].filter((w) => q.has(w)).length >= 4; });
      return { page: `${k.book_id}:${k.page_number}`, caught: quoted || !p.accept, quoted, rejected: !p.accept, how: k.plant.how };
    }).filter(Boolean);
    const ctl = Object.entries(key).filter(([, k]) => k.route === route && k.kind === 'control').map(([uid]) => V[uid]).filter(Boolean);
    const drift = v.filter((x) => (x.v.defects || []).some((d) => /^T[45]$/.test(cls(d))));
    routes[route] = {
      served: 'experiment read (never served)', n, books: new Set(v.map((x) => x.k.book_id)).size,
      accept: `${v.filter((x) => x.v.accept).length}/${n}`, accept_rate: Math.round(100 * v.filter((x) => x.v.accept).length / Math.max(1, n)) / 100,
      wrong_text_pages: `${wtPages.length}/${n}`, wrong_text_classes: Object.fromEntries(Object.entries(wtClasses).sort((a, b) => b[1] - a[1]).map(([c, k]) => [c, `${k}/${n}`])),
      classes_k_of_n: Object.fromEntries(Object.entries(classes).sort((a, b) => b[1] - a[1]).map(([c, k]) => [c, `${k}/${n}`])),
      fidelity_mean: Math.round(100 * v.reduce((s, x) => s + Number(x.v.fidelity), 0) / Math.max(1, n)) / 100,
      page_break_drift: { pages: `${drift.length}/${n}`, examples: drift.slice(0, 4).map((x) => ({ page: `${x.k.book_id}:${x.k.page_number}`, what: (x.v.defects || []).filter((d) => /^T[45]$/.test(cls(d))).map((d) => `${cls(d)} ${d.what ?? ''}`).join('; ') })) },
      planted_reversals: { n: pl.length, caught: pl.filter((x) => x.caught).length, quoted: pl.filter((x) => x.quoted).length, rows: pl },
      controls: { n: ctl.length, passed: ctl.length > 0 && ctl.every((c) => !c.accept && Number(c.fidelity) <= 2) },
      examples: wtPages.slice(0, 4).flatMap((x) => wt(x.v).slice(0, 1).map((d) => ({ page: `${x.k.book_id}:${x.k.page_number}`, class: cls(d), quote: d.quote, what: d.what }))),
      ...calls[route],
    };
  }
  // paired on pages both routes translated and the judge read
  const both = S.pages.filter((s) => V[`${s.page_id}|agy-flash-low@4`] && V[`${s.page_id}|opus-cli@10`]);
  const paired = { pages: both.length, agy_only: both.filter((s) => V[`${s.page_id}|agy-flash-low@4`].accept && !V[`${s.page_id}|opus-cli@10`].accept).length,
    opus_only: both.filter((s) => !V[`${s.page_id}|agy-flash-low@4`].accept && V[`${s.page_id}|opus-cli@10`].accept).length,
    fidelity_diff_mean: Math.round(100 * both.reduce((t, s) => t + Number(V[`${s.page_id}|agy-flash-low@4`].fidelity) - Number(V[`${s.page_id}|opus-cli@10`].fidelity), 0) / Math.max(1, both.length)) / 100 };
  const out = { generated_at: new Date().toISOString(), judge: 'claude -p --model opus, sealed (replicate-6547/run-claude-arm.py), route-judge judgePrompt task translation, image + corrected transcription',
    cells: { 'tibetan-tr': { task: 'translation', lang: 'Tibetan', frame: { pages: S.n, books: S.books, source: S.source, block: 'the test page first, then the next pages of its book: 4 a call (agy), 10 a call (Opus)' }, paired, routes } } };
  if (arg('out')) fs.writeFileSync(arg('out'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ paired, routes: Object.fromEntries(Object.entries(routes).map(([r, x]) => [r, { accept: x.accept, wrong_text: x.wrong_text_pages, fidelity: x.fidelity_mean, drift: x.page_break_drift.pages, planted: `${x.planted_reversals.caught}/${x.planted_reversals.n}`, controls: x.controls.passed, calls: x.calls, test_pages_read: x.test_pages_read }])) }, null, 1));
} else {
  console.error('usage: translate-router.mjs draw|judge-req|score --root=DIR (see the header)');
  process.exit(2);
}
