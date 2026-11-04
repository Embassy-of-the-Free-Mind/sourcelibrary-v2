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
 * Read only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { bodyText, foldHan, bodyCer, median } from '../ground-truth-5935/lib.mjs';
import { words7824 } from '../correction-pass-7818/lib.mjs';

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

export { rj, jsonl, sha16, r3, plan, txt, hanOf, noMarks, EN_ARMS, SETS, PRINT, DIR, RES, HERE, words7824, median, execFileSync };

const stages = { kr, cer, sample };
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const st = stages[process.argv[2]];
  if (!st) { console.error(`stages: ${Object.keys(stages).join(' | ')}`); process.exit(2); }
  await st();
}
