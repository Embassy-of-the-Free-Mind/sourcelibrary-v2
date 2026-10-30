#!/usr/bin/env node
// PRIOR ART: ./judge.mjs (the route-judge: judgePrompt, opusCall, parseVerdict, clusterCI's book bootstrap and the
//   wrong-page control are used here unchanged) — it draws its own pages and runs its own correctors; it has no notion
//   of a lane's PRODUCTION output. ./fresh-gate-7517.mjs scores a judge DIR against the router rule, not a lane. This
//   draws pages the #7558 correction lane (scripts/batch/cli-ocr-lane.mjs correct) has already been through and judges
//   what the library now SERVES on them, so the route's acceptance is measured where it runs (#7263, Derek 2026-10-28).
/**
 * Production acceptance of the live lite>agy-flash-low route (#7263). No agy call; Opus is the judge only.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/route-judge-6740/lane-accept-7263.mjs draw  --out=DIR
 *   node scripts/eval/route-judge-6740/lane-accept-7263.mjs judge --out=DIR [--concurrency=3]
 *   node --env-file=... scripts/eval/route-judge-6740/lane-accept-7263.mjs drafts --out=DIR   (after judge: rejected written pages)
 *   node scripts/eval/route-judge-6740/lane-accept-7263.mjs score --out=DIR
 *   node scripts/eval/route-judge-6740/lane-accept-7263.mjs evidence --out=DIR   (router-table evidence, print pages only)
 *
 * FRAME. The lane's ledger on this box (--ledger, default /root/jobs/cli-ocr-correct/correct-ledger.jsonl: every page
 * the gex45 run tried, with its outcome; the other box's shard keeps its own). Books whose language is German or French.
 * Two pages a book (seeded; pages in a book are one observation, so CIs are by book), drawn from ALL of the book's
 * ledgered pages, because the route serves the lane's correction where it wrote one and the Flash-Lite draft where the
 * corrector answered UNCHANGED or CONTAIN or a guard refused the correction. What is judged is the page's CURRENT
 * ocr.data, checked to be the lane's output (written: the 0601ef30e816f7a7 template stamp; else: still the lite draft).
 * TOP-UP (German, --topup=DIR): the agy corrections job german-agy-paired-7263 made this morning on #7568 wave 1's
 * German pages with the same template, never written (cli-ocr.mjs read output; UNCHANGED / CONTAIN = the draft). Two
 * pages a book. These carry no lane guard and are reported apart as well as pooled.
 *
 * JUDGE. judge.mjs's prompt and call, one output per call, the page image attached, blind to route and source, in a
 * hashed order; two wrong-page controls per language. Where a WRITTEN correction is rejected, the draft it replaced
 * (page_revisions, the lane's row) is judged too, for worse-than-draft. SCRIPT TYPE per page (Derek 2026-10-28):
 * pages.script_type, the ocr.data <script> tag winning a conflict or filling a gap, else the book's majority, else
 * unknown; every k/n is split print / manuscript.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { judgePrompt, opusCall, parseVerdict } from './judge.mjs';
import { makeRng } from '../lib/paired-stats.mjs';
import { contentHash } from '../../lib/write-provenance.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const STAGE = process.argv[2], OUT = arg('out') && path.resolve(arg('out'));
if (!OUT) { console.error('--out=DIR required'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const h = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const W = (f, x) => fs.writeFileSync(path.join(OUT, f), JSON.stringify(x, null, 1));
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const TEMPLATE = '0601ef30e816f7a7';
const LITE = ['gemini-3.1-flash-lite', 'gemini-3.1-flash-lite-preview'];
const LEDGER = arg('ledger') || '/root/jobs/cli-ocr-correct/correct-ledger.jsonl';
const LANGS = { German: /^German\b/, French: /^French$/ };
const PER_BOOK = 2;
const VERDICTS = path.join(OUT, 'verdicts-opus.jsonl');
const wt = (v) => (v.defects || []).some((d) => d.severity === 'wrong_text');

function scriptOf(p, bookMajority) {
  const tag = /<script>\s*([a-z]+)/i.exec(p.ocr?.data || '')?.[1]?.toLowerCase();
  const norm = (x) => (!x ? null : /hand|manu/.test(x) ? 'manuscript' : /print/.test(x) ? 'print' : null);
  return norm(tag) ?? norm(p.script_type) ?? bookMajority ?? 'unknown';
}

async function draw() {
  const { MongoClient } = await import('mongodb');
  const { getPageSource } = await import('../../lib/page-image-url.mjs');
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  const ledger = jsonl(LEDGER);
  const books = await db.collection('books').find({ id: { $in: [...new Set(ledger.map((r) => r.book_id))] } }, { projection: { id: 1, title: 1, language: 1, visible: 1 } }).toArray();
  const lang = (b) => Object.keys(LANGS).find((l) => LANGS[l].test(b.language || ''));
  const pages = [];
  const majority = async (bookId) => {
    const t = await db.collection('pages').aggregate([{ $match: { book_id: bookId, script_type: { $in: ['printed', 'handwritten'] } } }, { $group: { _id: '$script_type', n: { $sum: 1 } } }]).toArray();
    const top = t.sort((a, b) => b.n - a.n)[0]?._id; return top === 'handwritten' ? 'manuscript' : top === 'printed' ? 'print' : null;
  };
  const proj = { id: 1, book_id: 1, page_number: 1, script_type: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1, ocr: 1 };
  for (const b of books.filter((x) => lang(x) && x.visible)) {
    const rows = ledger.filter((r) => r.book_id === b.id).sort((x, y) => h(`7263:${x.page_id}`).localeCompare(h(`7263:${y.page_id}`)));
    const maj = await majority(b.id);
    let got = 0;
    for (const r of rows) {
      if (got >= PER_BOOK) break;
      const p = await db.collection('pages').findOne({ id: r.page_id }, { projection: proj });
      if (!p?.ocr?.data) continue;
      const lane = p.ocr.prompt_version === TEMPLATE && /#7558 correction lane/.test(p.ocr.engine?.run?.reason || '');
      if (r.outcome === 'written' ? !lane : !LITE.includes(p.ocr.model)) { console.log(`  ${b.id} p${r.page_number}: stored OCR is not the lane's output any more; skipped`); continue; }
      let draft = null;
      if (r.outcome === 'written') draft = (await db.collection('page_revisions').find({ page_id: p.id, field: 'ocr', reason: /#7558 correction lane/ }).sort({ created_at: -1 }).limit(1).toArray())[0]?.data ?? null;
      pages.push({ source: 'lane', lang: lang(b), book_id: b.id, title: (b.title || '').slice(0, 80), page_id: p.id, page_number: p.page_number, outcome: r.outcome, why: r.why,
        script: scriptOf(p, maj), script_type_field: p.script_type ?? null, image_url: getPageSource(p), text: p.ocr.data, text_sha: h(p.ocr.data).slice(0, 16), draft });
      got++;
    }
  }
  // Top-up: this job's agy corrections of #7568's German pages (never written).
  const T = arg('topup');
  if (T) {
    const sample = JSON.parse(fs.readFileSync('scripts/eval/flash-reread-5924/results-7568/de/sample.json', 'utf8'));
    const laneBooks = new Set(pages.map((p) => p.book_id));
    for (const b of sample.books.filter((x) => !laneBooks.has(x.book_id))) {
      const maj = await majority(b.book_id);
      const pick = [...b.pages].sort((x, y) => h(`7263:${x.page_id}`).localeCompare(h(`7263:${y.page_id}`)));
      let got = 0;
      for (const sp of pick) {
        if (got >= PER_BOOK) break;
        let m; try { m = JSON.parse(fs.readFileSync(path.join(T, `${sp.page_id}.meta.json`), 'utf8')); } catch { continue; }
        const p = await db.collection('pages').findOne({ id: sp.page_id }, { projection: proj });
        if (!p?.ocr?.data || m.exit !== 0 || m.error_class || m.wrapper || m.draft?.text_hash !== contentHash(p.ocr.data)) continue;
        const t = fs.readFileSync(path.join(T, `${sp.page_id}.txt`), 'utf8').trim();
        const outcome = /^UNCHANGED\.?$/i.test(t) ? 'unchanged' : /^CONTAIN\s*:/i.test(t) && t.length < 600 ? 'contain' : 'corrected';
        const text = outcome === 'corrected' ? t : p.ocr.data;
        pages.push({ source: 'topup', lang: 'German', book_id: b.book_id, title: (b.title || '').slice(0, 80), page_id: p.id, page_number: p.page_number, outcome, why: outcome === 'contain' ? t.slice(0, 200) : null,
          script: scriptOf(p, maj), script_type_field: p.script_type ?? null, image_url: getPageSource(p), text, text_sha: h(text).slice(0, 16), draft: outcome === 'corrected' ? p.ocr.data : null, agy_calls: m.calls ?? 1 });
        got++;
      }
    }
  }
  await c.close();
  W('sample.json', { drawn_at: new Date().toISOString(), ledger: LEDGER, ledger_rows: ledger.length, per_book: PER_BOOK, pages });
  const t = {}; for (const p of pages) { const k = `${p.lang}/${p.source}/${p.script}`; t[k] ??= { pages: 0, books: new Set() }; t[k].pages++; t[k].books.add(p.book_id); }
  for (const [k, v] of Object.entries(t)) console.log(k, `${v.pages} pages, ${v.books.size} books`);
}

/** Judge items: every drawn page's served text, the rejected written pages' drafts (stage drafts), two controls per language. */
function items(withDrafts) {
  const s = J('sample.json'), it = [];
  for (const p of s.pages) it.push({ id: `j${h(`served:${p.page_id}:${p.text_sha}`).slice(0, 10)}`, kind: 'served', page_id: p.page_id, task: 'ocr', lang: p.lang, image_url: p.image_url, text: p.text });
  for (const l of Object.keys(LANGS)) {
    const ps = s.pages.filter((p) => p.lang === l);
    for (let i = 0; i < 2 && ps.length > 4; i++) {
      const a = ps[i], o = ps.find((x, j) => j >= Math.floor(ps.length / 2) + i && x.book_id !== a.book_id);
      it.push({ id: `j${h(`control:${a.page_id}:${o.page_id}`).slice(0, 10)}`, kind: 'control', page_id: a.page_id, other: o.page_id, task: 'ocr', lang: l, image_url: a.image_url, text: o.text });
    }
  }
  if (withDrafts) {
    const V = verdicts();
    for (const p of s.pages) {
      const v = V.get(`j${h(`served:${p.page_id}:${p.text_sha}`).slice(0, 10)}`);
      if (p.draft && v && (!v.accept || wt(v))) it.push({ id: `j${h(`draft:${p.page_id}:${h(p.draft)}`).slice(0, 10)}`, kind: 'draft', page_id: p.page_id, task: 'ocr', lang: p.lang, image_url: p.image_url, text: p.draft });
    }
  }
  return it.sort((a, b) => h(`order:${a.id}`).localeCompare(h(`order:${b.id}`)));
}
const verdicts = () => new Map(jsonl(VERDICTS).filter((r) => r.verdict).map((r) => [r.id, r.verdict]));

async function judge(withDrafts) {
  const limits = await import('../../lib/model-limits.mjs');
  const WEEKLY = Number(process.env.ROUTE_JUDGE_WEEKLY_MAX || 85), SESSION = Number(process.env.ROUTE_JUDGE_SESSION_MAX || 95);
  const done = new Set(verdicts().keys()), tries = new Map();
  for (const r of jsonl(VERDICTS)) if (!r.verdict) tries.set(r.id, (tries.get(r.id) ?? 0) + 1);
  const todo = items(withDrafts).filter((x) => !done.has(x.id) && (tries.get(x.id) ?? 0) < 3);
  console.log(`opus: ${todo.length} items to judge`);
  let stop = null, i = 0;
  const one = async (it) => {
    const b = limits.claudeBlocked({ weeklyMax: WEEKLY, sessionMax: SESSION });
    if (b) { stop = b; return; }
    const ws = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'la-opus-'));
    try {
      const res = await fetch(it.image_url);
      if (!res.ok) { fs.appendFileSync(VERDICTS, JSON.stringify({ id: it.id, verdict: null, raw: `image HTTP ${res.status}` }) + '\n'); return; }
      fs.writeFileSync(path.join(ws, 'page.jpg'), Buffer.from(await res.arrayBuffer()));
      const t0 = Date.now();
      const r = await opusCall(judgePrompt(it, 'the file ./page.jpg in your working directory (open it with Read before you answer)'), ws);
      if (r.cls === 'quota') { limits.noteLimitHit('claude', { reason: r.text.slice(0, 200) }); stop = { reason: 'quota reply' }; return; }
      const v = parseVerdict(r.text);
      fs.appendFileSync(VERDICTS, JSON.stringify({ id: it.id, kind: it.kind, page_id: it.page_id, judge: 'opus', model: r.model, cls: r.cls, verdict: v, raw: v ? undefined : String(r.text).slice(0, 500), usage: r.usage, list_usd: r.cost, secs: Math.round((Date.now() - t0) / 1000), at: new Date().toISOString() }) + '\n');
      console.log(`  ${it.kind} ${it.id}: ${v ? `accept=${v.accept} ${v.fidelity}` : `unparsed ${r.cls ?? ''}`}`);
    } finally { fs.rmSync(ws, { recursive: true, force: true }); }
  };
  const conc = Math.max(1, Math.min(4, Number(arg('concurrency') || 3)));
  await Promise.all(Array.from({ length: conc }, async () => { while (!stop && i < todo.length) await one(todo[i++]); }));
  if (stop) { console.log(`BLOCKED (${stop.reason ?? JSON.stringify(stop)})`); process.exit(3); }
}

function clusterCI(rows, seed) {   // judge.mjs clusterCI: book bootstrap, 4000 draws; by page under 3 books
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const books = [...new Set(rows.map((r) => r.book))], byPage = books.length < 3;
  const units = byPage ? rows.map((r) => [r.v]) : books.map((b) => rows.filter((r) => r.book === b).map((r) => r.v));
  if (!units.length) return { ci95: null, unit: byPage ? 'page' : 'book', units: 0 };
  const rnd = makeRng(seed);
  const boots = Array.from({ length: 4000 }, () => { const s = []; for (let i = 0; i < units.length; i++) s.push(...units[Math.floor(rnd() * units.length)]); return mean(s); }).sort((a, b) => a - b);
  return { ci95: [+boots[100].toFixed(3), +boots[3899].toFixed(3)], unit: byPage ? 'page' : 'book', units: units.length };
}

function score() {
  const s = J('sample.json'), V = verdicts(), its = items(true);
  const vOf = (kind, pid) => V.get(its.find((x) => x.kind === kind && x.page_id === pid)?.id);
  const rows = s.pages.map((p) => ({ ...p, v: vOf('served', p.page_id), dv: p.draft ? vOf('draft', p.page_id) : null })).filter((r) => r.v);
  const stat = (rs, seed) => {
    const n = rs.length, k = rs.filter((r) => r.v.accept).length, w = rs.filter((r) => wt(r.v)).length;
    const cls = {}; for (const r of rs) for (const c of new Set((r.v.defects || []).map((d) => d.class))) cls[c] = (cls[c] || 0) + 1;
    const wcls = {}; for (const r of rs) for (const c of new Set((r.v.defects || []).filter((d) => d.severity === 'wrong_text').map((d) => d.class))) wcls[c] = (wcls[c] || 0) + 1;
    const srt = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).map(([c, x]) => [c, `${x}/${n}`]));
    return { n, books: new Set(rs.map((r) => r.book_id)).size, accept: `${k}/${n}`, accept_rate: n ? +(k / n).toFixed(3) : null, accept_ci: clusterCI(rs.map((r) => ({ book: r.book_id, v: +r.v.accept })), seed),
      wrong_text_pages: `${w}/${n}`, wrong_text_ci: clusterCI(rs.map((r) => ({ book: r.book_id, v: +wt(r.v) })), seed + 1),
      fidelity_mean: n ? +(rs.reduce((a, r) => a + Number(r.v.fidelity), 0) / n).toFixed(2) : null, wrong_text_classes: srt(wcls), classes_k_of_n: srt(cls),
      outcomes: rs.reduce((o, r) => ({ ...o, [r.outcome]: (o[r.outcome] || 0) + 1 }), {}) };
  };
  const out = { generated_at: new Date().toISOString(), judge: 'claude-opus-5-5 (claude -p), judge.mjs judgePrompt, one output per call against the page image', ledger: s.ledger, cells: {} };
  let seed = 7263;
  for (const l of Object.keys(LANGS)) {
    const R = rows.filter((r) => r.lang === l); if (!R.length) continue;
    const cell = { all: stat(R, seed += 10), by_script: {}, by_source: {}, by_outcome: {} };
    for (const sc of ['print', 'manuscript', 'unknown']) { const x = R.filter((r) => r.script === sc); if (x.length) cell.by_script[sc] = stat(x, seed += 10); }
    for (const so of ['lane', 'topup']) { const x = R.filter((r) => r.source === so); if (x.length) cell.by_source[so] = stat(x, seed += 10); }
    for (const so of ['lane', 'topup']) for (const sc of ['print', 'manuscript', 'unknown']) { const x = R.filter((r) => r.source === so && r.script === sc); if (x.length) cell.by_source[`${so}/${sc}`] = stat(x, seed += 10); }
    for (const oc of [...new Set(R.map((r) => r.outcome))]) cell.by_outcome[oc] = stat(R.filter((r) => r.outcome === oc), seed += 10);
    const ctl = its.filter((x) => x.kind === 'control' && x.lang === l).map((x) => V.get(x.id)).filter(Boolean);
    cell.controls = { n: ctl.length, passed: ctl.length > 0 && ctl.every((v) => !v.accept && Number(v.fidelity) <= 2) };
    const corr = R.filter((r) => r.draft);
    cell.made_worse = { corrections_judged: corr.length, rejected: corr.filter((r) => !r.v.accept || wt(r.v)).length, drafts_judged: corr.filter((r) => r.dv).length,
      worse_than_draft: corr.filter((r) => r.dv && ((r.dv.accept && !r.v.accept) || (!wt(r.dv) && wt(r.v)))).map((r) => ({ page_id: r.page_id, book_id: r.book_id, page_number: r.page_number, source: r.source, draft: { accept: r.dv.accept, fidelity: r.dv.fidelity }, served: { accept: r.v.accept, fidelity: r.v.fidelity }, note: r.v.reader_note })) };
    cell.rejected_pages = R.filter((r) => !r.v.accept || wt(r.v)).map((r) => ({ page_id: r.page_id, book_id: r.book_id, page_number: r.page_number, source: r.source, outcome: r.outcome, script: r.script, fidelity: r.v.fidelity, wrong_text: wt(r.v), note: r.v.reader_note,
      defects: (r.v.defects || []).filter((d) => d.severity !== 'cosmetic').slice(0, 4) }));
    out.cells[l] = cell;
  }
  out.judge_calls = jsonl(VERDICTS).length; out.judge_list_usd_equiv = +jsonl(VERDICTS).reduce((a, r) => a + (r.list_usd || 0), 0).toFixed(2);
  out.topup_agy_calls = s.pages.filter((p) => p.source === 'topup').reduce((a, p) => a + (p.agy_calls || 0), 0);
  W('score.json', out);
  for (const [l, c] of Object.entries(out.cells)) {
    console.log(`${l}: accept ${c.all.accept} [${c.all.accept_ci.ci95}] wrong ${c.all.wrong_text_pages} books ${c.all.books} controls ${c.controls.passed ? 'PASS' : 'FAIL'} worse-than-draft ${c.made_worse.worse_than_draft.length}`);
    for (const [k, x] of Object.entries({ ...c.by_script, ...c.by_source, ...c.by_outcome })) console.log(`   ${k}: ${x.accept} [${x.accept_ci.ci95}] wrong ${x.wrong_text_pages} (${x.books} books)`);
  }
}

/** Route-judge-format evidence for build.py: print pages only (the cells are print cells; manuscripts reported apart). */
function evidence() {
  const s = J('sample.json'), V = verdicts(), its = items(true);
  const vOf = (pid) => V.get(its.find((x) => x.kind === 'served' && x.page_id === pid)?.id);
  const route = (rs, served) => {
    const n = rs.length, cls = {}, wcls = {};
    for (const r of rs) {
      for (const c of new Set((r.v.defects || []).map((d) => d.class))) cls[c] = (cls[c] || 0) + 1;
      for (const c of new Set((r.v.defects || []).filter((d) => d.severity === 'wrong_text').map((d) => d.class))) wcls[c] = (wcls[c] || 0) + 1;
    }
    const srt = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]).map(([c, x]) => [c, `${x}/${n}`]));
    return { served, n, books: new Set(rs.map((r) => r.book_id)).size, accept: `${rs.filter((r) => r.v.accept).length}/${n}`, wrong_text_pages: `${rs.filter((r) => wt(r.v)).length}/${n}`,
      fidelity_mean: +(rs.reduce((a, r) => a + Number(r.v.fidelity), 0) / n).toFixed(2), wrong_text_classes: srt(wcls), classes_k_of_n: srt(cls), outcomes: rs.reduce((o, r) => ({ ...o, [r.outcome]: (o[r.outcome] || 0) + 1 }), {}) };
  };
  const rows = s.pages.map((p) => ({ ...p, v: vOf(p.page_id) })).filter((r) => r.v && r.script === 'print');
  const cells = {};
  for (const [l, cell] of [['German', 'de-lite'], ['French', 'fr-lite']]) {
    const R = rows.filter((r) => r.lang === l), routes = {};
    const lane = R.filter((r) => r.source === 'lane'), top = R.filter((r) => r.source === 'topup');
    if (lane.length) routes['lite>agy-flash-low'] = route(lane, "what the library serves after the #7558 correction lane (cli-ocr-lane.mjs correct, agy gemini-3.8-flash-low, template 0601ef30e816f7a7, every apply guard): the written correction, or the Flash-Lite draft where the corrector answered UNCHANGED / CONTAIN or a guard refused the write");
    if (top.length) routes['lite>agy-flash-low-unguarded'] = route(top, 'the same corrector and template on #7568 wave 1 German pages (cli-ocr.mjs read, never written, no apply guard): the correction, or the draft on UNCHANGED / CONTAIN');
    cells[cell] = { task: 'ocr', lang: l, script: 'print', routes };
  }
  const f = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../estimator/router-table/evidence/lane-accept-7263.score.json');
  fs.writeFileSync(f, JSON.stringify({ generated_by: 'scripts/eval/route-judge-6740/lane-accept-7263.mjs evidence (2026-10-28, #7263, job german-agy-paired-7263)',
    provenance: `the gex45 #7558 correction-lane ledger (${s.ledger}, ${s.ledger_rows} rows at ${s.drawn_at}), 2 pages a book from every ledgered outcome, the page's CURRENT ocr.data; the German top-up from this job's agy reads on #7568 wave 1 pages`,
    judge: 'claude-opus-5-5 (claude -p), judge.mjs judgePrompt (the route-judge prompt), one output per call against the page image; two wrong-page controls per language, both passed',
    mapping: 'accept = the judge accepts; wrong_text = any wrong_text defect. Print pages only (pages.script_type / <script> tag / book majority); manuscript pages are in the experiment file, not here', cells }, null, 1) + '\n');
  console.log(f); for (const [c, x] of Object.entries(cells)) for (const [r, y] of Object.entries(x.routes)) console.log(c, r, y.accept, y.wrong_text_pages, y.books);
}

if (STAGE === 'draw') await draw();
else if (STAGE === 'evidence') evidence();
else if (STAGE === 'judge') await judge(false);
else if (STAGE === 'drafts') await judge(true);
else if (STAGE === 'score') score();
else { console.error('stages: draw | judge | drafts | score | evidence'); process.exit(2); }
