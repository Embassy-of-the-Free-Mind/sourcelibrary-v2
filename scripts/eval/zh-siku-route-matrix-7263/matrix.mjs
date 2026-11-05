#!/usr/bin/env node
// PRIOR ART: scripts/eval/zh-ditto-restore-5274/score.mjs (hanOf, bodyCer against the Kanripo leaf: importing it runs it, so its
// one-line hanOf is copied); zh-skqs-5568-kanripo.mjs (workInfo, pbPages, best: imported); zh-gemini-reocr-7263/analyze.mjs and
// zh-print-arms-7263/analyze.mjs read one sitting's accepted k/n, with no English, no mixed route and no prereg rule, so neither fits.
/**
 * The Siku route matrix (#7263, PREREGISTRATION.md). DIR holds setA/, setB/, print/{one,ten}/, each plan.json + texts/.
 *   node --env-file=... matrix.mjs kr     --dir=DIR    Kanripo leaf per page (highest Dice over S, P, O): DIR/leaves.json
 *   node                matrix.mjs cer    --dir=DIR    DIR/cer.json: CER per arm and page, marks kept and marks removed
 *   node                matrix.mjs sample --dir=DIR    DIR/en/sample.json: every English arm's text per page, leaf, set
 *   node                matrix.mjs score  --dir=DIR --results=R   the rule, tables, side-by-side, ledger: R/*
 * Before score: DIR/signal-setB.json (signal.py apply), DIR/judge-baseline.json (verdict rows per dir before this job), DIR/stale.json. Read only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { bodyText, foldHan, bodyCer, median } from '../ground-truth-5935/lib.mjs';
import { words7824 } from '../correction-pass-7818/lib.mjs';
import { mcnemar } from '../zh-translation-paired-5274/run.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const DIR = path.resolve(arg('dir', process.env.JOB_SCRATCH || '.'));
const RES = path.resolve(arg('results', path.join(HERE, 'results')));
const rj = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const sha16 = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 16);
const r3 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
const SETS = ['setA', 'setB'], PRINT = ['print/one', 'print/ten'];
const plan = (d) => rj(path.join(DIR, d, 'plan.json'));
const txt = (d, k, a) => { const f = path.join(DIR, d, 'texts', `${k}.${a}.txt`); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null; };

// zh-ditto-restore-5274/score.mjs
const unTable = (t) => t.split('\n').filter((l) => !/^\s*\|?[\s:|-]*-{3,}[\s:|-]*\|?\s*$/.test(l)).map((l) => (/^\s*\|.*\|\s*$/.test(l) ? l.replace(/\|/g, '\n') : l)).join('\n');
const hanOf = (t) => foldHan(bodyText(unTable(String(t || ''))).replace(/[｜|│┃〡]/g, '丨'));
const noMarks = (q) => q.replace(/丨/g, '');

export const ARMS = { S: 'lite', P: 'P', F: 'F', PO: 'PO', O: 'O', FF: 'FF', PFL: 'PFL', SFL: 'SFL' };
const EN_ARMS = { tS: 'S', tP: 'P', tF: 'F', tPO: 'PO', tO: 'O', tPFL: 'PFL' };

async function kr() {
  process.argv = [...process.argv.filter((x) => !x.startsWith('--dir=')), `--dir=${path.join(DIR, 'kr')}`]; process.env.KR_DIR = path.join(DIR, 'kr');
  const K = await import('../zh-skqs-5568-kanripo.mjs');
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const books = c.db('bookstore').collection('books'), out = {};
  for (const d of SETS) for (const s of plan(d).selected) {
    const id = String((await books.findOne({ id: s.book_id }, { projection: { work_id: 1 } }))?.work_id || '').replace(/^kr:/, '');
    if (!/^KR/.test(id)) { out[s.key] = { set: d, why: 'no kanripo work_id' }; continue; }
    const w = await K.workInfo(id);
    if (w.witness !== 'WYG') { out[s.key] = { set: d, kr: id, why: 'no WYG branch' }; continue; }
    const pages = await K.pbPages(id, 'WYG', w.juan_files);
    let top = null, by = null;
    for (const a of ['lite', 'P', 'O']) { const t = txt(d, s.key, a); if (!t) continue; const m = K.best(K.fold(t), pages); if (m && (!top || m.dice > top.dice)) { top = m; by = a; } }
    if (!top || top.dice < 0.6) { out[s.key] = { set: d, kr: id, why: 'no leaf at Dice 0.6', dice: r3(top?.dice) }; continue; }
    const clean = (x) => String(x ?? '').replace(/¶/g, '').replace(/\n+/g, '\n').trim();
    out[s.key] = { set: d, kr: id, sha: w.witness_sha, pb: pages[top.i].pb, dice: r3(top.dice), second: r3(top.second), by, leaf: clean(pages[top.i].raw), before: clean(pages[top.i - 1]?.raw).slice(-40), after: clean(pages[top.i + 1]?.raw).slice(0, 40) };
    console.log(s.key, id, out[s.key].pb, out[s.key].dice);
  }
  await c.close();
  fs.writeFileSync(path.join(DIR, 'leaves.json'), JSON.stringify(out, null, 1));
  for (const d of SETS) { const v = Object.values(out).filter((x) => x.set === d); console.log(d, `${v.filter((x) => x.leaf).length}/${v.length} with a leaf`, JSON.stringify(v.filter((x) => !x.leaf).reduce((o, x) => ((o[x.why] = (o[x.why] || 0) + 1), o), {}))); }
}

function cer() {
  const L = rj(path.join(DIR, 'leaves.json')), rows = [];
  for (const d of SETS) for (const s of plan(d).selected) {
    const l = L[s.key]; if (!l?.leaf) continue;
    const ref = hanOf(l.leaf), W = hanOf(l.before) + ref + hanOf(l.after);   // the ±40 edges: a leaf's break may fall a few characters off
    for (const [a, file] of Object.entries(ARMS)) {
      const t = txt(d, s.key, file);
      if (t == null) { rows.push({ set: d, key: s.key, arm: a, cer: null, cer_nomark: null, why: 'no text' }); continue; }
      const q = hanOf(t);
      rows.push({ set: d, key: s.key, arm: a, cer: r3(bodyCer(q, W, { expected: [...ref].length }).cer), cer_nomark: r3(bodyCer(noMarks(q), noMarks(W), { expected: [...noMarks(ref)].length }).cer), han: [...q].length, leaf_han: [...ref].length });
    }
  }
  fs.writeFileSync(path.join(DIR, 'cer.json'), JSON.stringify(rows));
  for (const d of [...SETS, 'all']) console.log(d, Object.keys(ARMS).map((a) => { const x = rows.filter((r) => r.arm === a && (d === 'all' || r.set === d) && r.cer_nomark != null); return `${a} ${r3(median(x.map((r) => r.cer_nomark)))}/${x.length}`; }).join('  '));
}

function sample() {
  const L = rj(path.join(DIR, 'leaves.json')), pages = [];
  for (const d of SETS) for (const s of plan(d).selected) {
    const p = { page_id: s.page_id, book_id: s.book_id, page_number: s.page_number, slug: s.key, set: d, pb: L[s.key]?.pb ?? null, leaf: L[s.key]?.leaf ?? null };
    for (const a of Object.values(EN_ARMS)) p[a] = txt(d, s.key, ARMS[a]);
    pages.push(p);
  }
  fs.mkdirSync(path.join(DIR, 'en'), { recursive: true });
  fs.writeFileSync(path.join(DIR, 'en/sample.json'), JSON.stringify({ arms: EN_ARMS, drawn_at: new Date().toISOString(), pages }, null, 1));
  const distinct = pages.reduce((n, p) => n + new Set(Object.values(EN_ARMS).filter((a) => p[a] != null).map((a) => sha16(p[a]))).size, 0);
  console.log(`${pages.length} pages; ${distinct} distinct source texts to translate; ${pages.filter((p) => p.leaf).length} with a leaf`);
}


/** How many of the frame's pages hold English that a re-read would leave stale (a read-only count, by the cohort rule of draw.mjs). */
async function stale() {
  const zlib = await import('node:zlib'), { MongoClient } = await import('mongodb');
  const SIKU_HOLDS = /^(paddle-zh-5600-ocr-only|paddle-zh-6388-ocr-only|paddle-zh-6388-excluded|gpu-backlog-5660)$/;   // draw.mjs: it runs on import
  const isSiku = (b) => SIKU_HOLDS.test(String(b.hold?.reason ?? '')) || /·卷|\(vol \d+\)/.test(String(b.title || ''));
  const fr = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(HERE, '../zh-gemini-reocr-7263/results/frame.json.gz')))).rows.filter(isSiku).map((r) => r.book_id);
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const pages = c.db('bookstore').collection('pages'), MODELS = ['gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview', 'gemini-3.1-flash-lite'];
  let frame = 0, withEn = 0;
  for (let i = 0; i < fr.length; i += 500) { const q = { book_id: { $in: fr.slice(i, i + 500) }, 'ocr.model': { $in: MODELS } }; frame += await pages.countDocuments(q); withEn += await pages.countDocuments({ ...q, 'translation.data': { $type: 'string', $ne: '' } }); }
  await c.close();
  fs.writeFileSync(path.join(DIR, 'stale.json'), JSON.stringify({ at: new Date().toISOString(), books: fr.length, pages_read_by_gemini: frame, pages_with_english: withEn }));
  console.log(fr.length, frame, withEn);
}

// ── score: the preregistered rule, from the files only ──
const major = (d) => d.severity === 'misleads' || d.severity === 'wrong_text';
const wrongTextV = (v) => (v?.defects || []).some((d) => d.severity === 'wrong_text');
const tally = (xs) => xs.reduce((o, x) => ((o[x] = (o[x] || 0) + 1), o), {});
const sortO = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));
const FILE = { S: 'served', P: 'P', F: 'F', PO: 'PO', O: 'O', FF: 'FF', PFL: 'PFL', SFL: 'SFL' };
const SIG = (d) => rj(path.join(DIR, `signal-${d}.json`));
const LABEL = { S: 'S stored', P: 'P Paddle', F: 'F Opus fresh', PO: 'PO Paddle > Opus', O: 'O stored > Opus', FF: 'FF Flash low fresh', PFL: 'PFL Paddle > Flash low', SFL: 'SFL stored > Flash low', 'M-PO': 'M-PO mixed, sent to PO', 'M-O': 'M-O mixed, sent to O' };

/** One sitting's transcription verdict per text: `key:sha`, the id judgeItems gives. Later rows of an id win. */
function ocrVerdicts(d) {
  const by = new Map(), rows = jsonl(path.join(DIR, d, 'verdicts.jsonl'));
  for (const r of rows) if (r.verdict) by.set(r.id, r);
  return { by, rows };
}
function ocrRow(d, V, s, arm) {
  const t = txt(d, s.key, FILE[arm]);
  if (t == null) return { arm, key: s.key, no_text: true, accept: false, wrong: false, severe: 0, chars: 0, defects: [] };
  const r = V.by.get(`${s.key}:${sha16(t)}`);
  const chars = [...hanOf(t)].length;
  if (!r) return { arm, key: s.key, no_verdict: true, accept: false, wrong: false, severe: 0, chars, defects: [] };
  return { arm, key: s.key, accept: !!r.verdict.accept, fidelity: r.verdict.fidelity, wrong: wrongTextV(r.verdict), severe: (r.verdict.defects || []).filter(major).length, chars, defects: r.verdict.defects || [], note: r.verdict.reader_note, id: r.id };
}
function sum(rows) {
  const ds = rows.flatMap((r) => r.defects), chars = rows.reduce((a, r) => a + r.chars, 0);
  return { n: rows.length, accepted: rows.filter((r) => r.accept).length, wrong_text_pages: rows.filter((r) => r.wrong).length, no_text: rows.filter((r) => r.no_text).length, no_verdict: rows.filter((r) => r.no_verdict).length,
    severe: rows.reduce((a, r) => a + r.severe, 0), severe_per_1k_chars: chars ? +((1000 * rows.reduce((a, r) => a + r.severe, 0)) / chars).toFixed(2) : null,
    fidelity: tally(rows.filter((r) => r.fidelity != null).map((r) => r.fidelity)), severity: tally(ds.map((d) => d.severity)), classes: sortO(tally(ds.map((d) => d.class))) };
}
/** The English side: per arm and page, the verdict, its words and each major defect's traced cause. */
function english() {
  const E = path.join(DIR, 'en'), key = rj(path.join(E, 'key.json')), packet = rj(path.join(E, 'packet.json'));
  const texts = new Map(packet.items.map((i) => [i.id, i.text]));
  const vs = new Map(jsonl(path.join(E, 'verdicts-opus.jsonl')).filter((r) => r.verdict).map((r) => [r.id, r]));
  const causes = new Map(jsonl(path.join(E, 'trace.jsonl')).map((t) => [t.tid, t]));
  const row = (k) => {
    const v = vs.get(k.judged_as)?.verdict; if (!v) return { arm: k.arm, page_id: k.page_id, set: k.set, no_verdict: true, accept: false, wm: false, nn: false, major: 0, words: 0, cause: {}, defects: [] };
    const cause = {};
    (v.defects || []).forEach((d, j) => { if (major(d)) { const c = causes.get(`${k.judged_as}:${j}`)?.cause ?? 'untraced'; cause[c] = (cause[c] || 0) + 1; } });
    return { arm: k.arm, page_id: k.page_id, set: k.set, id: k.judged_as, accept: !!v.accept, fidelity: v.fidelity, wm: wrongTextV(v), nn: (v.defects || []).some((d) => major(d) && /name|number/.test(d.kind || '')), major: (v.defects || []).filter(major).length, words: words7824(texts.get(k.judged_as)), cause, defects: v.defects || [], note: v.reader_note };
  };
  const items = key.filter((k) => k.kind === 'item').map(row), at = new Map(items.map((r) => [`${r.arm}:${r.page_id}`, r]));
  const wp = key.filter((k) => k.kind === 'wrong_page').map((k) => ({ arm: k.arm, id: k.judged_as, accept: vs.get(k.judged_as)?.verdict?.accept ?? null, fidelity: vs.get(k.judged_as)?.verdict?.fidelity ?? null }));
  const rp = key.filter((k) => k.kind === 'repeat').map((k) => ({ arm: k.arm, a: vs.get(k.judged_as)?.verdict, b: vs.get(k.of)?.verdict })).filter((x) => x.a && x.b);
  return { at, wp, rp, key };
}
function enSum(rows, leafPages) {
  const ds = rows.flatMap((r) => r.defects), words = rows.reduce((a, r) => a + r.words, 0), add = (k) => rows.filter((r) => leafPages.has(r.page_id)).reduce((a, r) => a + (r.cause[k] || 0), 0);
  return { n: rows.length, accepted: rows.filter((r) => r.accept).length, wrong_meaning_pages: rows.filter((r) => r.wm).length, name_number_pages: rows.filter((r) => r.nn).length, major: rows.reduce((a, r) => a + r.major, 0), major_per_1k_words: words ? +((1000 * rows.reduce((a, r) => a + r.major, 0)) / words).toFixed(2) : null, words, no_verdict: rows.filter((r) => r.no_verdict).length,
    source_caused: add('source'), translator: add('translator'), unclear: add('unclear') + add('unparsed') + add('untraced'),
    fidelity: tally(rows.filter((r) => r.fidelity != null).map((r) => r.fidelity)), severity: tally(ds.map((d) => d.severity)), classes: sortO(tally(ds.map((d) => d.class))), kinds: tally(ds.filter(major).map((d) => d.kind || 'other')) };
}
const pairOf = (rowsA, rowsB) => { const b = new Map(rowsB.map((r) => [r.key ?? r.page_id, r])); let gained = 0, lost = 0; for (const r of rowsA) { const o = b.get(r.key ?? r.page_id); if (!o) continue; if (r.accept && !o.accept) gained++; if (!r.accept && o.accept) lost++; } return { gained, lost, mcnemar_p: +mcnemar(gained, lost).toFixed(3) }; };

/** Fee × quota share: the 2026-11-03 cheap-arms method. Opus by list cost against the pilot's 1-a-call page ($5.72); agy by list cost against the #7611 call ($0.00055). */
function prices(pSets) {
  const OPUS_1K = 5.72, ACCOUNT_WEEK = 534 / 11.6, POOL_WEEK = 55, FRAME = 93277;
  const pilot = rj(path.join(HERE, '../zh-print-arms-7263/input/pilot-score.json')), pilotOne = pilot.sets.one.list_usd / pilot.sets.one.pages;
  const flashList = (u) => ((u.input - (u.cache_read || 0)) * 0.75 + (u.cache_read || 0) * 0.075 + (u.output + (u.thinking || 0)) * 3.75) / 1e6;
  const calls = (d, sub) => jsonl(path.join(DIR, d, sub, 'calls.jsonl'));
  const opus = (subs) => { const c = subs.flatMap(([d, sub]) => calls(d, sub)), pages = new Set(c.map((x) => `${x.book_id ?? ''}:${x.key ?? x.call_id}`)).size || 1; const list = c.reduce((a, x) => a + (x.usage?.list_cost_usd || 0), 0); return { calls: c.length, pages, list_usd_per_page: +(list / pages).toFixed(4), per_1k: +((OPUS_1K * list) / pages / pilotOne).toFixed(2) }; };
  const agy = (subs) => { const c = subs.flatMap(([d, sub]) => calls(d, sub)).filter((x) => x.usage), pages = new Set(c.map((x) => x.key ?? `${x.book_id}:${(x.pages || []).join()}`)).size || 1; const m = c.reduce((a, x) => a + flashList(x.usage), 0) / (c.length || 1); return { calls: c.length, pages, mean_list_usd: +m.toFixed(4), per_1k: +(1000 * 0.00055 * (m / 0.0084) * (c.length / pages)).toFixed(2) }; };
  const tr = jsonl(path.join(DIR, 'en/translations.jsonl')).filter((r) => r.usage), trM = tr.reduce((a, r) => a + flashList(r.usage), 0) / (tr.length || 1), TR = +(1000 * 0.00055 * (trM / 0.0084)).toFixed(2);
  const sets = (sub) => SETS.map((d) => [d, sub]);
  const raw = { F: opus(sets('set-F')), PO: opus(sets('set-PO')), O: opus([['setB', 'set']]), FF: agy(sets('set-FF')), PFL: agy([['setB', 'set-PFL']]), SFL: agy([['setB', 'set-SFL']]) };
  const PADDLE = 0.09, ocr = { S: { opus: 0, agy: 0, paddle: 0 }, P: { opus: 0, agy: 0, paddle: PADDLE }, F: { opus: raw.F.per_1k, agy: 0, paddle: 0 }, PO: { opus: raw.PO.per_1k, agy: 0, paddle: PADDLE }, O: { opus: raw.O.per_1k, agy: 0, paddle: 0 }, FF: { opus: 0, agy: raw.FF.per_1k, paddle: 0 }, PFL: { opus: 0, agy: raw.PFL.per_1k, paddle: PADDLE }, SFL: { opus: 0, agy: raw.SFL.per_1k, paddle: 0 } };
  for (const [m, a] of [['M-PO', 'PO'], ['M-O', 'O']]) ocr[m] = { opus: +(pSets.share * ocr[a].opus).toFixed(2), agy: raw.PFL.per_1k, paddle: PADDLE };
  const out = { method: 'fee × quota share, the 2026-11-03 cheap-arms record: Opus = $5.72 × list cost a page ÷ the pilot\'s 1-a-call list cost; agy = $0.00055 × list cost a call ÷ $0.0084; Paddle $0.09. M pays PFL on every page (the signal needs it) and the Opus arm on the share sent.', measured: raw, translation_per_1k: TR, translation_calls: tr.length, m_share_sent_set_b: pSets.share, arms: {} };
  for (const [a, p] of Object.entries(ocr)) {
    const ocrK = +(p.opus + p.agy + p.paddle).toFixed(2), allK = +(ocrK + TR).toFixed(2);
    out.arms[a] = { ocr_per_1k: ocrK, with_translation_per_1k: allK, frame_usd: Math.round((allK * FRAME) / 1000), opus_account_weeks: +((p.opus * FRAME) / 1000 / ACCOUNT_WEEK).toFixed(1), agy_pool_weeks: +(((p.agy + TR) * FRAME) / 1000 / POOL_WEEK).toFixed(1) };
  }
  return out;
}
function applyRule(table, M, setBTable) {
  const armNames = Object.keys(table), best = { wm: Math.min(...armNames.map((a) => table[a].wrong_meaning_pages)), sc: Math.min(...armNames.map((a) => table[a].source_caused)) };
  const bestB = { wm: Math.min(...armNames.map((a) => setBTable[a].wrong_meaning_pages)), sc: Math.min(...armNames.map((a) => setBTable[a].source_caused)) };
  const q = (t, b, margin) => { const wm = t.wrong_meaning_pages <= b.wm + margin, sc = t.source_caused <= b.sc * 1.25; return { within_wrong_meaning: wm, within_source_caused: sc, disagree: wm !== sc, qualifies: sc }; };   // "Where those two disagree, Kanripo governs"
  return { best_all_60: { wrong_meaning: best.wm, source_caused: best.sc, arms_wm: armNames.filter((a) => table[a].wrong_meaning_pages === best.wm), arms_sc: armNames.filter((a) => table[a].source_caused === best.sc) }, best_set_b: { wrong_meaning: bestB.wm, source_caused: bestB.sc },
    arms: Object.fromEntries(armNames.map((a) => [a, q(table[a], best, 3)])), mixed: Object.fromEntries(Object.entries(M).map(([m, t]) => [m, { scaled_margin_1: q(t, bestB, 1), literal_margin_3: q(t, bestB, 3) }])) };
}

function score() {
  const { mix } = { mix: rj(path.join(DIR, 'signal-setB.json')) };
  const O = {}, en = english(), L = rj(path.join(DIR, 'leaves.json')), cer = rj(path.join(DIR, 'cer.json'));
  const selected = {}, ocr = {};
  for (const d of [...SETS, ...PRINT]) { selected[d] = plan(d).selected; const V = ocrVerdicts(d); ocr[d] = {}; for (const a of Object.keys(FILE)) ocr[d][a] = selected[d].map((s) => ocrRow(d, V, s, a)); }
  const armsOcr = Object.keys(FILE);
  // Transcription
  const held = (s) => !!(s.hold || s.status === 'held');
  for (const a of armsOcr) O[a] = { siku: sum([...ocr.setA[a], ...ocr.setB[a]]), setA: sum(ocr.setA[a]), setB: sum(ocr.setB[a]), setA_held: sum(ocr.setA[a].filter((_, i) => held(selected.setA[i]))), setA_unheld: sum(ocr.setA[a].filter((_, i) => !held(selected.setA[i]))), print: sum([...ocr['print/one'][a], ...ocr['print/ten'][a]].filter((r) => !r.no_text && !r.no_verdict)) };
  const sigB = new Map(mix.rows.map((r) => [r.key, r])), share = mix.rows.filter((r) => r.send).length / mix.rows.length;
  const mOcr = {}; for (const [m, a] of [['M-PO', 'PO'], ['M-O', 'O']]) { const rows = selected.setB.map((s, i) => (sigB.get(s.key).send ? ocr.setB[a][i] : ocr.setB.PFL[i])); mOcr[m] = sum(rows); }
  const sigA = new Map(SIG('setA').rows.map((r) => [r.key, { ...r, send: r.signal >= mix.cutoff }]));
  const mOcrA = {}; for (const [m, a] of [['M-PO', 'PO'], ['M-O', 'O']]) mOcrA[m] = { ...sum(selected.setA.map((s, i) => (sigA.get(s.key)?.send ? ocr.setA[a][i] : ocr.setA.PFL[i]))), label: 'hypothesis-forming: the cutoff was chosen on these pages' };
  // CER
  const cerArm = (a, set) => { const x = cer.filter((r) => r.arm === a && (!set || r.set === set) && r.cer_nomark != null); return { n: x.length, median_nomark: r3(median(x.map((r) => r.cer_nomark))), mean_nomark: r3(x.reduce((s, r) => s + r.cer_nomark, 0) / (x.length || 1)), median_marks: r3(median(x.map((r) => r.cer))) }; };
  const cerT = Object.fromEntries(armsOcr.map((a) => [a, { all: cerArm(a), setA: cerArm(a, 'setA'), setB: cerArm(a, 'setB') }]));
  const mCer = {}; for (const [m, a] of [['M-PO', 'PO'], ['M-O', 'O']]) { const xs = selected.setB.map((s) => cer.find((r) => r.key === s.key && r.arm === (sigB.get(s.key).send ? a : 'PFL'))?.cer_nomark).filter((x) => x != null); mCer[m] = { n: xs.length, median_nomark: r3(median(xs)), mean_nomark: r3(xs.reduce((u, x) => u + x, 0) / (xs.length || 1)) }; }
  // English
  const allPages = SETS.flatMap((d) => selected[d].map((s) => ({ ...s, set: d }))), leafPages = new Set(allPages.filter((s) => L[s.key]?.leaf).map((s) => s.page_id));
  const enRow = (a, s) => en.at.get(`${a}:${s.page_id}`) ?? { arm: a, page_id: s.page_id, set: s.set, no_text: true, accept: false, wm: false, nn: false, major: 0, words: 0, cause: {}, defects: [] };
  const enArms = Object.keys(EN_ARMS), table = {}, tableB = {}, tableA = {}, held60 = {};
  for (const a of enArms) { const rows = allPages.map((s) => enRow(a, s)); table[a] = enSum(rows, leafPages); tableB[a] = enSum(rows.filter((r) => r.set === 'setB'), leafPages); tableA[a] = enSum(rows.filter((r) => r.set === 'setA'), leafPages); held60[a] = { held: enSum(allPages.filter((s) => s.set === 'setA' && held(s)).map((s) => enRow(a, s)), leafPages), unheld: enSum(allPages.filter((s) => s.set === 'setA' && !held(s)).map((s) => enRow(a, s)), leafPages) }; }
  const pB = allPages.filter((s) => s.set === 'setB');
  const mEn = {}; for (const [m, a] of [['M-PO', 'tPO'], ['M-O', 'tO']]) mEn[m] = enSum(pB.map((s) => enRow(sigB.get(s.key).send ? a : 'tPFL', s)), leafPages);
  const pA = allPages.filter((s) => s.set === 'setA'), mEnA = {}; for (const [m, a] of [['M-PO', 'tPO'], ['M-O', 'tO']]) mEnA[m] = { ...enSum(pA.map((s) => enRow(sigA.get(s.key)?.send ? a : 'tPFL', s)), leafPages), label: 'hypothesis-forming: the cutoff was chosen on these pages' };
  const rule = applyRule(table, mEn, tableB);
  const pr = prices({ share });
  for (const a of [...Object.values(EN_ARMS), 'M-PO', 'M-O']) {
    const t = table[Object.keys(EN_ARMS).find((k) => EN_ARMS[k] === a)] ?? mEn[a]; const P = pr.arms[a];
    P.usd_per_accepted_en_page_per_1k = t.accepted ? +((P.with_translation_per_1k * t.n) / t.accepted).toFixed(2) : null;
  }
  const qualifying = [...enArms.filter((a) => rule.arms[a].qualifies).map((a) => ({ route: EN_ARMS[a], usd: pr.arms[EN_ARMS[a]].with_translation_per_1k })), ...Object.keys(mEn).filter((m) => rule.mixed[m].scaled_margin_1.qualifies).map((m) => ({ route: m, usd: pr.arms[m].with_translation_per_1k }))].sort((a, b) => a.usd - b.usd);
  // PO against O and F
  const siku = (a) => [...ocr.setA[a], ...ocr.setB[a]], print = (a) => [...ocr['print/one'][a], ...ocr['print/ten'][a]];
  const enAll = (a) => allPages.map((s) => enRow(a, s));
  const po = { siku_transcription: { PO_vs_O: pairOf(siku('PO'), siku('O')), PO_vs_F: pairOf(siku('PO'), siku('F')) }, print_transcription: { PO_vs_O: pairOf(print('PO'), print('O')), PO_vs_F: pairOf(print('PO'), print('F')) }, siku_english: { tPO_vs_tO: pairOf(enAll('tPO'), enAll('tO')), tPO_vs_tF: pairOf(enAll('tPO'), enAll('tF')) } };
  const printWrong = { PO: { accepted: `${print('PO').filter((r) => r.accept).length}/60`, wrong_text: print('PO').filter((r) => r.wrong).length }, O: { accepted: `${print('O').filter((r) => r.accept).length}/60`, wrong_text: print('O').filter((r) => r.wrong).length }, F: { accepted: `${print('F').filter((r) => r.accept).length}/60`, wrong_text: print('F').filter((r) => r.wrong).length } };
  // Controls and noise floor: a control accepted voids that sitting
  const controls = {}, retest = {};
  for (const d of [...SETS, ...PRINT]) {
    const { rows } = ocrVerdicts(d), byId = new Map(rows.filter((r) => r.verdict).map((r) => [r.id, r]));
    controls[d] = rows.filter((r) => r.set === 'wrong_page' && r.verdict && /#matrix$|^wp-/.test(r.id)).map((r) => ({ id: r.id, accept: r.verdict.accept, fidelity: r.verdict.fidelity }));
    const again = rows.filter((r) => r.set === 'abs' && r.verdict && /#matrix$/.test(r.id));
    retest[d] = { n: again.length, accept_agree: again.filter((r) => byId.get(r.id.replace(/#matrix$/, ''))?.verdict.accept === r.verdict.accept).length, within_one_fidelity: again.filter((r) => Math.abs((byId.get(r.id.replace(/#matrix$/, ''))?.verdict.fidelity ?? 99) - r.verdict.fidelity) <= 1).length };
  }
  const en_controls = { wrong_page: en.wp, repeat_n: en.rp.length, repeat_accept_agree: en.rp.filter((x) => x.a.accept === x.b.accept).length, repeat_within_one: en.rp.filter((x) => Math.abs(x.a.fidelity - x.b.fidelity) <= 1).length };
  const voids = [...Object.entries(controls).filter(([, c]) => c.some((x) => x.accept)).map(([d]) => d), ...(en.wp.some((x) => x.accept) ? ['english'] : [])];
  // Ledger: every Opus call this job made
  const ledger = { cap: 1000, reads: { F: pr.measured.F.calls, PO: pr.measured.PO.calls + PRINT.reduce((a, d) => a + jsonl(path.join(DIR, d, 'set-PO/calls.jsonl')).length, 0), O_setB: pr.measured.O.calls, F_print_prior_job: 0 }, transcription_judge: 0, english_judge: jsonl(path.join(DIR, 'en/verdicts-opus.jsonl')).filter((r) => r.usage || r.verdict).length };
  ledger.reads.F = jsonl(path.join(DIR, 'setA/set-F/calls.jsonl')).length + jsonl(path.join(DIR, 'setB/set-F/calls.jsonl')).length;
  const seed = rj(path.join(DIR, 'judge-baseline.json'));
  for (const d of [...SETS, ...PRINT]) ledger.transcription_judge += jsonl(path.join(DIR, d, 'verdicts.jsonl')).filter((r) => r.verdict || r.usage).length - (seed[d] ?? 0);
  ledger.total = ledger.reads.F + ledger.reads.PO + ledger.reads.O_setB + ledger.transcription_judge + ledger.english_judge;
  const stale = fs.existsSync(path.join(DIR, 'stale.json')) ? rj(path.join(DIR, 'stale.json')) : null;
  const out = { at: new Date().toISOString(), issue: 7263, prereg: 'scripts/eval/zh-siku-route-matrix-7263/PREREGISTRATION.md', cutoff: mix.cutoff, m_sent_set_b: mix.rows.filter((r) => r.send).length, voids, controls, retest, en_controls, transcription: O, m_transcription: mOcr, m_transcription_setA: mOcrA, cer: cerT, m_cer: mCer, english: table, english_setA: tableA, english_setB: tableB, english_setA_held_split: held60, m_english: mEn, m_english_setA: mEnA, rule, qualifying_by_price: qualifying, cheapest_qualifying: qualifying[0] ?? null, po, print_three: printWrong, price: pr, stale_english: stale, ledger };
  fs.mkdirSync(RES, { recursive: true });
  fs.writeFileSync(path.join(RES, 'score.json'), JSON.stringify(out, null, 1));
  const rate = (e) => { const n = Object.entries(e.fidelity).reduce((x, [, c]) => x + c, 0), per = (k) => +((1000 * (e.severity[k] || 0)) / e.words).toFixed(2); return { pages: e.n, words: e.words, misleads_per_1k: per('misleads'), wrong_text_per_1k: per('wrong_text'), fidelity_mean: +(Object.entries(e.fidelity).reduce((x, [f, c]) => x + f * c, 0) / n).toFixed(2) }; };
  const rates = (g) => Object.fromEntries(Object.entries(g).map(([a, e]) => [a, rate(e)]));
  fs.writeFileSync(path.join(RES, 'defect-rates.json'), JSON.stringify({ about: '#7263: per route, misleads and wrong_text defects per 1,000 English words and mean fidelity, blind Opus judge with the scan, one fixed translator (3.8 Flash low). all60 = sets A + B; m_setB = the mixed route on set B.', cells: { all60: rates(out.english), m_setB: rates(out.m_english) } }, null, 1));
  fs.writeFileSync(path.join(RES, 'ledger.json'), JSON.stringify(ledger, null, 1));
  sideBySide(selected, ocr, en, enRow, sigB);
  evidence(out, allPages);
  const line = (a, t, P) => `${(LABEL[a] || a).padEnd(26)} en ${t.accepted}/${t.n} wm ${t.wrong_meaning_pages} nn ${t.name_number_pages} maj/1k ${t.major_per_1k_words} src ${t.source_caused} tr ${t.translator} unc ${t.unclear} | $${P.with_translation_per_1k} opus-wk ${P.opus_account_weeks} agy-wk ${P.agy_pool_weeks} $/acc ${P.usd_per_accepted_en_page_per_1k}`;
  for (const a of enArms) console.log(line(EN_ARMS[a], table[a], pr.arms[EN_ARMS[a]]), JSON.stringify(rule.arms[a]));
  for (const m of Object.keys(mEn)) console.log(line(m, mEn[m], pr.arms[m]), JSON.stringify(rule.mixed[m]));
  for (const a of armsOcr) console.log(`${a} tr siku ${O[a].siku.accepted}/${O[a].siku.n} wt ${O[a].siku.wrong_text_pages} sev/1k ${O[a].siku.severe_per_1k_chars} A ${O[a].setA.accepted} B ${O[a].setB.accepted} | print ${O[a].print.accepted}/${O[a].print.n} wt ${O[a].print.wrong_text_pages} | CER ${cerT[a].all.median_nomark}`);
  console.log('M tr', JSON.stringify(mOcr, (k, v) => (['severity', 'classes', 'fidelity'].includes(k) ? undefined : v)));
  console.log('cheapest', JSON.stringify(out.cheapest_qualifying), 'voids', voids, 'ledger', ledger.total, JSON.stringify(po));
}

function sideBySide(selected, ocr, en, enRow, sigB) {
  const lines = (t) => String(t ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const md = ['# zh-siku-route-matrix side by side (#7263)', '', 'Generated by matrix.mjs score. Lines that differ from the O text, capped at 6 an arm. Verdicts: blind Opus judge; `tr` is the transcription verdict, `en` the English verdict of that arm\'s text translated by one fixed translator. M: `sent` is the frozen signal at or above 0.178392 (set B only).', ''];
  const vs = (r) => (r.no_text ? 'no text' : r.no_verdict ? 'no verdict' : `${r.accept ? 'accept' : 'reject'} f${r.fidelity}${r.wrong ?? r.wm ? ' WRONG' : ''}${r.severe ?? r.major ? ` major ${r.severe ?? r.major}` : ''}`);
  for (const d of SETS) selected[d].forEach((s, i) => {
    const num = s.page_number, sent = d === 'setB' ? ` · M: ${sigB.get(s.key)?.send ? 'sent' : 'PFL served'} (signal ${r3(sigB.get(s.key)?.signal)})` : '';
    md.push(`## ${d} ${s.title} · p.${num}`, '', `[scan](${s.image}) · [reader](https://sourcelibrary.org/book/${s.book_id}/page/${num}) · page ${s.page_id}${sent}`, '', '| arm | tr | en |', '|---|---|---|');
    for (const a of Object.keys(FILE)) { const k = Object.keys(EN_ARMS).find((x) => EN_ARMS[x] === a); md.push(`| ${LABEL[a]} | ${vs(ocr[d][a][i])} | ${k ? vs(enRow(k, { ...s, set: d })) : 'not translated'} |`); }
    md.push('');
    const ref = new Set(lines(txt(d, s.key, 'O')));
    for (const a of ['S', 'F', 'PO', 'PFL']) { const t = txt(d, s.key, FILE[a]); if (t == null) continue; const dl = lines(t).filter((l) => !ref.has(l)); md.push(`**${a}** ${dl.length ? `${dl.length} lines differ from O` : 'same lines as O'}`); if (dl.length) md.push('```', ...dl.slice(0, 6).map((l) => l.slice(0, 160)), '```'); }
    md.push('');
  });
  fs.writeFileSync(path.join(RES, 'side-by-side.md'), md.join('\n') + '\n');
}

/** The router's score file, in the shape of zh-print-arms-7263's. rules.json does not name it: the brief changes no table. */
function evidence(out, allPages) {
  const ROUTE = { S: 'gemini-stored', P: 'paddle-zh-read', F: 'opus-read', PO: 'paddle>opus', O: 'gemini>opus', FF: 'agy-flash-low-read', PFL: 'paddle>agy-flash-low', SFL: 'gemini>agy-flash-low' };
  const routes = Object.fromEntries(Object.entries(out.transcription).map(([a, t]) => [ROUTE[a], { n: t.siku.n, books: t.siku.n, accept: `${t.siku.accepted}/${t.siku.n}`, wrong_text_pages: `${t.siku.wrong_text_pages}/${t.siku.n}`, severe_per_1k_chars: t.siku.severe_per_1k_chars, classes: t.siku.classes }]));
  const en = Object.fromEntries(Object.entries(out.english).map(([a, t]) => [`${ROUTE[EN_ARMS[a]]}>agy-text@1`, { n: t.n, books: t.n, accept: `${t.accepted}/${t.n}`, wrong_text_pages: `${t.wrong_meaning_pages}/${t.n}`, major_per_1k_words: t.major_per_1k_words, kanripo_source_caused: t.source_caused }]));
  const f = path.join(HERE, '../estimator/router-table/evidence/zh-siku-route-matrix-7263.score.json');
  fs.writeFileSync(f, JSON.stringify({ generated_by: 'scripts/eval/zh-siku-route-matrix-7263/matrix.mjs', provenance: '#7263 zh-siku-route-matrix: 60 Siku pages of the Gemini-read frame, one a book, reader x draft; PREREGISTRATION.md', judge: 'claude-opus-5-5 (claude -p), route-judge-6740 judgePrompt against the page image; Opus judges Opus, Kanripo beside it', mapping: 'wrong_text = a wrong_text defect; accept = the judge accepts', cells: { 'chinese-gemini-siku-matrix-7263': { task: 'ocr', lang: 'Chinese', pages: 60, frame: 'Siku stratum, Gemini-read', controls: out.controls, routes }, 'chinese-gemini-siku-matrix-7263-en': { task: 'translation', lang: 'Chinese', pages: 60, frame: 'the same pages; the arm\'s text translated by agy 3.8 Flash low, one page a call', controls: out.en_controls, routes: en } } }, null, 1));
}

/** This job's per-page verdicts as origin:test rows (judge-rows.mjs testRow, #8135): the texts judged new here, not #8017's arms on set A
 *  or PR #8114's on print, which their own tests hold. Read by: nothing live (readers default to origin != test; the nightly
 *  sampler counts them only to keep these books out of its draw history, verdictQuery tests:true); build.py picks them up only if
 *  rules.json names the evidence, and it does not. Insert only. */
async function testRows() {
  const { testRow, ROUTE_JUDGE, COLLECTION } = await import('../lib/judge-rows.mjs');
  const ROUTE = { S: 'gemini-stored', P: 'paddle-zh-read', F: 'opus-read', PO: 'paddle>opus', O: 'gemini>opus', FF: 'agy-flash-low-read', PFL: 'paddle>agy-flash-low', SFL: 'gemini>agy-flash-low' };
  const record = 'scripts/eval/experiments/2026-11-04-zh-siku-route-matrix-7263.md', evidence = 'scripts/eval/estimator/router-table/evidence/zh-siku-route-matrix-7263.score.json', now = new Date().toISOString();
  const judge = (v) => ({ instrument: ROUTE_JUDGE, model: v.model ?? 'claude-opus-5-5', prompt_sha: v.prompt_sha ?? null });
  const rows = [];
  const NEW = { setA: ['F', 'FF', 'PO'], setB: Object.keys(FILE), 'print/one': ['PO'], 'print/ten': ['PO'] };
  for (const [d, arms] of Object.entries(NEW)) {
    const V = ocrVerdicts(d), stratum = d.replace('/', '-');
    for (const s of plan(d).selected) for (const a of arms) {
      const t = txt(d, s.key, FILE[a]); if (t == null) continue;
      const h = sha16(t), r = V.by.get(`${s.key}:${h}`); if (!r) continue;
      rows.push(testRow({ kind: 'item', book_id: s.book_id, page_id: s.page_id, page_number: s.page_number, selection: 'random', cell: 'chinese-gemini-siku-matrix-7263', route: ROUTE[a], lang: 'Classical Chinese', task: 'ocr',
        test: { id: 'zh-siku-route-matrix-7263', issue: 7263, record, arm: a, evidence, stratum, verdict_id: r.id }, settings: { pages_per_call: 1, draft_source: { PO: 'paddle', PFL: 'paddle', O: s.stored_model, SFL: s.stored_model }[a] ?? null },
        judge: judge(r), verdict: r.verdict, cost: { judge_list_usd: r.list_usd ?? null }, judged_at: r.at, backfilled_at: now, text_hash: h }));
    }
  }
  const E = path.join(DIR, 'en'), vs = new Map(jsonl(path.join(E, 'verdicts-opus.jsonl')).filter((r) => r.verdict).map((r) => [r.id, r])), byPage = new Map(SETS.flatMap((d) => plan(d).selected.map((s) => [s.page_id, { ...s, set: d }])));
  for (const k of rj(path.join(E, 'key.json')).filter((x) => x.kind === 'item')) {
    const r = vs.get(k.judged_as), s = byPage.get(k.page_id); if (!r) continue;
    rows.push(testRow({ kind: 'item', book_id: s.book_id, page_id: s.page_id, page_number: s.page_number, selection: 'random', cell: 'chinese-gemini-siku-matrix-7263-en', route: `${ROUTE[EN_ARMS[k.arm]]}>agy-text@1`, lang: 'Classical Chinese', task: 'translation',
      test: { id: 'zh-siku-route-matrix-7263', issue: 7263, record, arm: k.arm, evidence, stratum: s.set, verdict_id: k.judged_as }, settings: { pages_per_call: 1, prev_page_context: false, model: 'gemini-3.8-flash-low' },
      judge: { instrument: `${ROUTE_JUDGE} (translation, scan and no transcription: zh-ocr-gap-translation-5274 prompt)`, model: r.model ?? 'claude-opus-5-5' }, verdict: r.verdict, outcome: { accept: !!r.verdict.accept, wrong_text: wrongTextV(r.verdict), mapped_by: 'own fields (accept; any defect of severity wrong_text)' }, cost: { judge_list_usd: r.list_usd ?? null }, judged_at: r.at, backfilled_at: now }));
  }
  console.log(rows.length, 'rows', JSON.stringify(tally(rows.map((r) => `${r.task}:${r.route}`))));
  if (!process.argv.includes('--apply')) { console.log('DRY: --apply to insert'); return; }
  const { MongoClient } = await import('mongodb');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  // all origins: an insert handle, no read
  try { const col = c.db('bookstore').collection(COLLECTION); let n = 0; for (const r of rows) n += (await col.updateOne({ _id: r._id }, { $setOnInsert: r }, { upsert: true })).upsertedCount; console.log(`${COLLECTION}: ${n} inserted`); } finally { await c.close(); }
}

export { rj, jsonl, sha16, r3, plan, txt, hanOf, noMarks, EN_ARMS, SETS, PRINT, DIR, RES, HERE, words7824, median, execFileSync };

const stages = { kr, cer, sample, stale, score, 'test-rows': testRows };
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const st = stages[process.argv[2]];
  if (!st) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
  await st();
}
