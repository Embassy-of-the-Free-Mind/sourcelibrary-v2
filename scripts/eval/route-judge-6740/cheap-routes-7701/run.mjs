#!/usr/bin/env node
// PRIOR ART: scripts/eval/route-judge-6740/first-read-7701/{gate,evidence}.mjs (#7701's arm A/B gate and router evidence:
// the written set from a dry apply, Beta(1+k,1+n-k), by-script evidence) and judge.mjs's packet/score (wrong-page controls,
// one verdict per distinct text). They do not fit as is: judge.mjs's packet judges every delivered output and knows no
// written set, no GPU-draft put-back and no planted control; gate.mjs reads one route per cell. This runs the #7701
// cheap-route cells (RULE.md beside the results) around judge.mjs's own `judge` stage, which it calls unchanged.
/**
 * #7701 cheap routes (job cheap-routes-7701): German read@4 alone / >correct / >correct@4, French read@1 / @4, Latin
 * arm c (PERO > agy, one and four a call). Every route of a cell ran on the SAME 30 pages (judge.mjs draw + correct).
 *
 *   node --env-file=… run.mjs written  --out=DIR     dry applies: the text each route would WRITE on each drawn page
 *   node --env-file=… run.mjs packet   --out=DIR     blind, shuffled items (written texts) + 2 wrong-page controls a route
 *   ROUTE_JUDGE_WEEKLY_MAX=99 node judge.mjs judge --out=DIR            (judge.mjs, unchanged)
 *   node run.mjs plant   --out=DIR                    2 planted items a cell (plant-ocr-errors.mjs) on accepted outputs
 *   ROUTE_JUDGE_WEEKLY_MAX=99 node judge.mjs judge --out=DIR            (the planted items)
 *   node run.mjs score   --out=DIR [--prior=<#7701 DIR>]   RULE.md's measures and decision -> DIR/score.json
 *   node run.mjs evidence --out=DIR                   router evidence (unsplit + by-script, with paired counts)
 *   node --env-file=… run.mjs apply --out=DIR [--apply]   write each page's best accepted read under the lane's guards
 * Read-only except `apply --apply` (cli-ocr.mjs apply: revisions, compare-and-set, first reads only; holds kept).
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeRng } from '../../lib/paired-stats.mjs';
import { plantError, scorePlant } from '../../lib/plant-ocr-errors.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const STAGE = process.argv[2];
const OUT = path.resolve(arg('out') || '.');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const h = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const J = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const W = (f, x) => fs.writeFileSync(path.join(OUT, f), JSON.stringify(x, null, 1));
const jsonl = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const slug = (route) => route.replace(/[^a-z0-9]+/gi, '_');
const dirOf = (cell, route) => path.join(OUT, 'corr', cell, slug(route));
const CLI_OCR = path.join(ROOT, 'scripts/batch/cli-ocr.mjs');
const AGY_USD = 0.00087;              // the #6740 fee basis: $200 a month, 4.36e-6 of a month a call
const GPU_USD_PER_SEC = 249 / (30 * 86400);   // gex45 at $249 a month
const GPU_SECS_PER_PAGE = 3;          // PERO on the card beside another tenant: 1-5 s a page (#7567 E1), central 3

// kind: read = a fresh read (written by apply --first-read-only --print-only); corr = a correction of `base`'s read
// (written on base's written pages: its text where it gave one, else base's read); gpu = a GPU draft corrected
// (written by the GPU-draft apply with --diff-guard=gpu-draft). live = the route production runs today.
export const CELLS = {
  'de-blank-r2': { lang: 'German', prior: 'de-blank', live: 'agy-flash-low@4>agy-flash-low', routes: {
    'agy-flash-low@4': { kind: 'read' }, 'agy-flash-low@4>agy-flash-low': { kind: 'corr', base: 'agy-flash-low@4' }, 'agy-flash-low@4>agy-flash-low@4': { kind: 'corr', base: 'agy-flash-low@4' } } },
  'fr-blank-r2': { lang: 'French', live: 'agy-flash-low', routes: { 'agy-flash-low': { kind: 'read' }, 'agy-flash-low@4': { kind: 'read' } } },
  'la-armc': { lang: 'Latin', live: null, routes: { 'pero>agy-flash-low': { kind: 'gpu' }, 'pero>agy-flash-low@4': { kind: 'gpu' } } },
};
// A dry apply skips a page the live lane read after this test read it: the page was unread when read, so it counts.
const LATER_READ = /the page has OCR now|OCR was rewritten after this read/;

function dryApply(cell, route, ids, extra) {
  const dir = dirOf(cell, route), emit = path.join(dir, 'written-dry.jsonl'), only = path.join(dir, 'only-drawn.json');
  fs.rmSync(emit, { force: true }); fs.writeFileSync(only, JSON.stringify(ids));
  const r = spawnSync(process.execPath, ['--no-warnings', CLI_OCR, 'apply', `--out=${dir}`, `--only=${only}`, '--reason=#7701 cheap-routes cell test (dry run)', `--emit-written=${emit}`, ...extra], { cwd: ROOT, env: process.env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`apply ${cell}/${route}: exit ${r.status}\n${r.stderr?.slice(-2000)}`);
  const sum = JSON.parse(fs.readFileSync(path.join(dir, 'apply-summary-dry.json'), 'utf8'));
  return { rows: new Map(jsonl(emit).map((x) => [x.page_id, x.text])), skipped: sum.skipped_pages || {}, diff_guard: sum.diff_guard ?? null };
}
const readText = (cell, route, id) => {
  const d = dirOf(cell, route);
  try { const m = JSON.parse(fs.readFileSync(path.join(d, `${id}.meta.json`), 'utf8')); if (m.exit !== 0 || m.error_class || m.wrapper) return null; } catch { return null; }
  const t = fs.readFileSync(path.join(d, `${id}.txt`), 'utf8').trim(); return t || null;
};

/** written: per cell x route x drawn page, the text the lane would write ({ text } or { why } when not written). */
function written() {
  // --cell=X: this cell only; the other cells' rows already in written.json are kept
  const s = J('sample.json'), out = fs.existsSync(path.join(OUT, 'written.json')) ? J('written.json') : {};
  for (const [cell, C] of Object.entries(CELLS).filter(([c]) => !arg('cell') || arg('cell') === c)) {
    const ids = s.cells[cell].pages.map((p) => p.page_id);
    out[cell] = {};
    for (const [route, R] of Object.entries(C.routes).filter(([, r]) => r.kind !== 'corr')) {
      const extra = R.kind === 'read' ? ['--first-read-only', '--print-only'] : ['--diff-guard=gpu-draft', '--print-only'];
      const d = dryApply(cell, route, ids, extra);
      out[cell][route] = Object.fromEntries(ids.map((id) => {
        if (d.rows.has(id)) return [id, { text: d.rows.get(id) }];
        const why = d.skipped[id] ?? 'not read';
        if (LATER_READ.test(why) && readText(cell, route, id) && R.kind === 'read') return [id, { text: readText(cell, route, id), later_read: why }];
        return [id, { why }];
      }));
      if (d.diff_guard) out[cell][`${route}#diff_guard`] = d.diff_guard;
    }
    for (const [route, R] of Object.entries(C.routes).filter(([, r]) => r.kind === 'corr')) {
      out[cell][route] = Object.fromEntries(ids.map((id) => {
        const b = out[cell][R.base][id];
        if (!b.text) return [id, { why: `${R.base}: ${b.why}` }];
        const t = readText(cell, route, id);
        if (!t || /^UNCHANGED\.?$/i.test(t) || (/^CONTAIN\s*:/i.test(t) && !/<page-type>/.test(t))) return [id, { text: b.text, fell_back: t ? t.slice(0, 80) : 'no correction' }];
        return [id, { text: t }];
      }));
    }
    for (const [route] of Object.entries(C.routes)) {
      const v = Object.values(out[cell][route]);
      console.log(`${cell} ${route}: written ${v.filter((x) => x.text).length}/${v.length}${v.some((x) => x.fell_back) ? `, ${v.filter((x) => x.fell_back).length} served the base read` : ''}`);
    }
  }
  W('written.json', out);
}

function shuffled(xs, salt) { return [...xs].sort((a, b) => h(salt + JSON.stringify(a.id ?? a)).localeCompare(h(salt + JSON.stringify(b.id ?? b)))); }

async function packet() {
  const { MongoClient } = await import('mongodb');
  const { getPageSource } = await import('../../../lib/page-image-url.mjs');
  const s = J('sample.json'), wr = J('written.json');
  const all = Object.keys(CELLS).flatMap((c) => s.cells[c].pages.map((p) => p.page_id));
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const pages = new Map((await c.db('bookstore').collection('pages').find({ id: { $in: all } }, { projection: { id: 1, book_id: 1, page_number: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1, crop: 1 } }).toArray()).map((p) => [p.id, p]));
  await c.close();
  const items = new Map(), key = [];
  const add = (cell, route, sp, kind, text, extra = {}) => {
    const tag = kind === 'item' ? `${cell}:${sp.page_id}:${h(text.trim())}` : `${kind}:${cell}:${route}:${sp.page_id}:${extra.other ?? ''}`;
    const id = `j${h(tag).slice(0, 10)}`;
    if (!items.has(id)) items.set(id, { id, task: 'ocr', lang: CELLS[cell].lang, image_url: getPageSource(pages.get(sp.page_id)), text });
    key.push({ id: `k${h(`${kind}:${cell}:${route}:${sp.page_id}:${extra.other ?? ''}`).slice(0, 10)}`, judged_as: id, cell, route, kind, page_id: sp.page_id, book_id: sp.book_id, page_number: sp.page_number, ...extra });
  };
  if (fs.existsSync(path.join(OUT, 'key.json')) && J('key.json').some((k) => k.kind === 'planted')) throw new Error('packet: planted items exist; rebuilding would drop them');
  // a cell with no written rows yet (its reads still running) is left out; ids are content hashes, so a later rebuild
  // with it keeps every verdict already made
  for (const [cell, C] of Object.entries(CELLS).filter(([c]) => wr[c])) {
    const sps = s.cells[cell].pages;
    for (const route of Object.keys(C.routes)) {
      const ok = sps.filter((sp) => wr[cell][route][sp.page_id]?.text);
      for (const sp of ok) add(cell, route, sp, 'item', wr[cell][route][sp.page_id].text);
      // two wrong-page controls: this page's image, this route's written text of a page of ANOTHER book
      const rng = makeRng(parseInt(h(`wp-${cell}-${route}`).slice(0, 8), 16));
      for (let i = 0; i < 2 && ok.length > 2; i++) {
        const a = ok[Math.floor(rng() * ok.length)]; let b = a;
        while (b.book_id === a.book_id) b = ok[Math.floor(rng() * ok.length)];
        add(cell, route, a, 'wrong_page', wr[cell][route][b.page_id].text, { other: b.page_id });
      }
    }
  }
  W('packet.json', { built_at: new Date().toISOString(), items: shuffled([...items.values()], 'pk-7701') });
  W('key.json', key);
  console.log(`${items.size} items to judge (${key.filter((k) => k.kind === 'wrong_page').length} wrong-page controls), ${key.length} key rows`);
}

const verdicts = () => new Map(jsonl(path.join(OUT, 'verdicts-opus.jsonl')).filter((r) => r.verdict).map((r) => [r.id, r.verdict]));

/** plant: two planted items a cell, on outputs the judge accepted (kinds rotating B, C, D, E across the cells). */
function plant() {
  const key = J('key.json'), pk = J('packet.json'), V = verdicts();
  if (key.some((k) => k.kind === 'planted')) { console.log('planted items already in the packet'); return; }
  const kinds = ['B', 'C', 'D', 'E'];
  let slot = 0;
  for (const cell of Object.keys(CELLS)) {
    const acc = shuffled([...new Map(key.filter((k) => k.cell === cell && k.kind === 'item' && V.get(k.judged_as)?.accept).map((k) => [k.judged_as, k])).values()], `plant-${cell}`);
    let got = 0;
    for (const k of acc) {
      if (got >= 2) break;
      const it = pk.items.find((x) => x.id === k.judged_as);
      for (let tries = 0; tries < 4; tries++) {
        const kind = kinds[(slot + tries) % 4];
        const p = plantError(it.text, { kind, lang: CELLS[cell].lang, seed: parseInt(h(`${k.judged_as}${kind}`).slice(0, 8), 16) });
        if (!p) continue;
        const id = `j${h(`planted:${k.judged_as}:${kind}`).slice(0, 10)}`;
        pk.items.push({ id, task: 'ocr', lang: CELLS[cell].lang, image_url: it.image_url, text: p.text });
        key.push({ id: `k${h(`planted:${cell}:${k.route}:${k.page_id}:${kind}`).slice(0, 10)}`, judged_as: id, cell, route: k.route, kind: 'planted', page_id: k.page_id, book_id: k.book_id, source_item: k.judged_as, plant: p.plant });
        got++; slot++; break;
      }
    }
    console.log(`${cell}: ${got} planted`);
  }
  pk.items = shuffled(pk.items, 'pk-7701-planted');
  W('packet.json', pk); W('key.json', key);
}

// ── score ──
function betaP(k, n, thr, seed) {
  const rnd = makeRng(seed);
  const normal = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const gamma = (a) => { if (a < 1) return gamma(a + 1) * rnd() ** (1 / a); const d = a - 1 / 3, c = 1 / Math.sqrt(9 * d); for (;;) { let x, v; do { x = normal(); v = 1 + c * x; } while (v <= 0); v = v ** 3; const u = rnd(); if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v; } };
  return { gamma, p: (() => { let hit = 0; const N = 40000; for (let i = 0; i < N; i++) { const a = gamma(1 + k), b = gamma(1 + n - k); if (a / (a + b) >= thr) hit++; } return +(hit / N).toFixed(3); })() };
}
/** Paired: Dirichlet(1 + both, 1 + a_only, 1 + b_only, 1 + neither); P(acc_a >= acc_b - within). The router's rule. */
function pairedP(c, within, seed) {
  const { gamma } = betaP(0, 0, 0, seed);
  let hit = 0; const N = 40000;
  for (let i = 0; i < N; i++) { const g = [c.both, c.a_only, c.b_only, c.neither].map((x) => gamma(1 + x)); const t = g.reduce((a, b) => a + b); if ((g[1] - g[2]) / t >= -within) hit++; }
  return +(hit / N).toFixed(3);
}
const wt = (v) => (v?.defects || []).some((d) => d.severity === 'wrong_text');
const cls = (d) => String(d.class || '').toUpperCase().match(/^[IOTDE]\d+/)?.[0] ?? 'E2';

/** agy calls a page for a route: every call its read made (block calls once, one-page calls by their meta), over pages read. */
function callsPerPage(cell, route) {
  const d = dirOf(cell, route);
  if (!fs.existsSync(d)) return null;
  const metas = fs.readdirSync(d).filter((f) => f.endsWith('.meta.json')).map((f) => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')));
  const block = jsonl(path.join(d, 'calls.jsonl')).reduce((t, c) => t + (c.calls ?? 1), 0);
  const single = metas.filter((m) => !m.call_id).reduce((t, m) => t + (m.calls ?? 1), 0);
  return { calls: block + single, pages: metas.length, per_page: +((block + single) / Math.max(1, metas.length)).toFixed(3) };
}

/** #7701's German cell (de-blank), its A and B verdicts on its written pages, for the n = 60 A-against-B comparison. */
function priorGerman(P) {
  const key = JSON.parse(fs.readFileSync(path.join(P, 'key.json'))), s = JSON.parse(fs.readFileSync(path.join(P, 'sample.json')));
  const V = new Map(jsonl(path.join(P, 'verdicts-opus.jsonl')).filter((r) => r.verdict).map((r) => [r.id, r.verdict]));
  const skipped = JSON.parse(fs.readFileSync(path.join(P, 'dry-de-blank.json'))).skipped_pages || {};
  const vOf = (route, id) => { const k = key.find((x) => x.cell === 'de-blank' && x.route === route && x.kind === 'item' && x.page_id === id); return k && V.get(k.judged_as); };
  return s.cells['de-blank'].pages.filter((p) => !(p.page_id in skipped)).map((p) => {
    const a = vOf('agy-flash-low@4', p.page_id), b = vOf('agy-flash-low@4>agy-flash-low', p.page_id) ?? a;
    return { page_id: p.page_id, book_id: p.book_id, A: a, B: b };
  });
}

function score() {
  const s = J('sample.json'), key = J('key.json'), wr = J('written.json'), V = verdicts();
  const vOf = (cell, route, id) => { const k = key.find((x) => x.cell === cell && x.route === route && x.kind === 'item' && x.page_id === id); return k ? V.get(k.judged_as) ?? null : null; };
  const out = { scored_at: new Date().toISOString(), rule: 'RULE.md (committed before the judge stage)', judge: 'claude-opus-5-5 (claude -p), route-judge-6740 judgePrompt against the page image, blind, shuffled', cells: {} };
  let seed = 7701;
  for (const [cell, C] of Object.entries(CELLS)) {
    const sps = s.cells[cell].pages, R = {};
    const ctrl = (route) => key.filter((k) => k.cell === cell && k.route === route && k.kind === 'wrong_page').map((k) => V.get(k.judged_as));
    for (const route of Object.keys(C.routes)) {
      const rows = sps.map((sp) => { const w = wr[cell][route][sp.page_id]; const v = w?.text ? vOf(cell, route, sp.page_id) : null;
        return { page_id: sp.page_id, book_id: sp.book_id, written: !!w?.text, judged: !!v, accept: !!v?.accept, wt: wt(v), fidelity: v?.fidelity ?? null, why: w?.why ?? null, fell_back: !!w?.fell_back, classes: [...new Set((v?.defects || []).map(cls))],
          wrong_text: (v?.defects || []).filter((d) => d.severity === 'wrong_text').map((d) => `${d.class}: ${String(d.quote).slice(0, 80)} — ${d.what ?? ''}`.slice(0, 200)) }; });
      const wrt = rows.filter((r) => r.written && r.judged);
      const k = wrt.filter((r) => r.accept).length, n = wrt.length, w = wrt.filter((r) => r.wt).length;
      const cs = ctrl(route), cp = callsPerPage(cell, route);
      const base = C.routes[route].base ? callsPerPage(cell, C.routes[route].base) : null;
      const per = (cp?.per_page ?? 0) + (base?.per_page ?? 0);
      const gpuUsd = C.routes[route].kind === 'gpu' ? GPU_SECS_PER_PAGE * GPU_USD_PER_SEC : 0;
      const accDrawn = rows.filter((r) => r.accept).length / rows.length;
      R[route] = { all_drawn: { accept: `${rows.filter((r) => r.accept).length}/${rows.length}`, wrong_text: `${rows.filter((r) => r.wt).length}/${rows.length}` },
        written: { accept: `${k}/${n}`, wrong_text: `${w}/${n}`, p_acc_ge_080: betaP(k, n, 0.8, seed++).p, wrong_text_ok: n > 0 && w / n <= 0.04 },
        control: { wrong_page: cs.map((v) => v ? { accept: v.accept, fidelity: v.fidelity } : null), passed: cs.length === 2 && cs.every((v) => v && !v.accept && Number(v.fidelity) <= 2) },
        not_written: rows.filter((r) => !r.written).reduce((t, r) => { const x = String(r.why).replace(/:.*/, '').slice(0, 60); t[x] = (t[x] || 0) + 1; return t; }, {}),
        served_base_read: rows.filter((r) => r.fell_back).length,
        agy_calls_per_page: +per.toFixed(3), calls: { route: cp, base },
        usd_per_accepted_page: accDrawn ? +((per * AGY_USD + gpuUsd) / accDrawn).toFixed(5) : null,
        wrong_text_pages: rows.filter((r) => r.wt).map((r) => ({ page_id: r.page_id, written: r.written, defects: r.wrong_text })), _rows: rows };
      R[route].eligible = R[route].written.wrong_text_ok && R[route].written.p_acc_ge_080 >= 0.9 && R[route].control.passed;
    }
    // planted controls (two a cell)
    const pl = key.filter((k) => k.cell === cell && k.kind === 'planted').map((k) => ({ kind: k.plant.kind, route: k.route, ...(V.get(k.judged_as) ? scorePlant(V.get(k.judged_as), k.plant) : { unjudged: true }) }));
    // paired, on the pages both routes wrote and the judge read
    const pair = (a, b, extra = []) => {
      const ra = new Map(R[a]._rows.map((r) => [r.page_id, r])), both = R[b]._rows.filter((r) => r.written && r.judged && ra.get(r.page_id)?.written && ra.get(r.page_id)?.judged).map((r) => [ra.get(r.page_id), r]);
      const rowsP = [...both.map(([x, y]) => ({ a: x.accept, b: y.accept, book: x.book_id })), ...extra];
      const c = { n: rowsP.length, both: rowsP.filter((r) => r.a && r.b).length, a_only: rowsP.filter((r) => r.a && !r.b).length, b_only: rowsP.filter((r) => !r.a && r.b).length, neither: rowsP.filter((r) => !r.a && !r.b).length, books: new Set(rowsP.map((r) => r.book)).size };
      return { ...c, p_a_within_008: pairedP(c, 0.08, seed++), rule: `P(acc_${a} >= acc_${b} - 0.08) >= 0.9, Dirichlet(1 + counts)` };
    };
    const paired = {};
    if (cell === 'de-blank-r2') {
      const P = arg('prior') || '/root/jobs/ocr-first-7701/rt';
      const pg = fs.existsSync(path.join(P, 'key.json')) ? priorGerman(P).filter((r) => r.A && r.B) : [];
      const A = 'agy-flash-low@4', B = 'agy-flash-low@4>agy-flash-low', Cc = 'agy-flash-low@4>agy-flash-low@4';
      paired[`${A}|${B}`] = { ...pair(A, B, pg.map((r) => ({ a: r.A.accept, b: r.B.accept, book: r.book_id }))), with_7701_pages: pg.length };
      // A over n = 60 (#7701's written pages + these): k/n and wrong text pooled
      const pooledA = { k: R[A]._rows.filter((r) => r.written && r.judged && r.accept).length + pg.filter((r) => r.A.accept).length, n: R[A]._rows.filter((r) => r.written && r.judged).length + pg.length, w: R[A]._rows.filter((r) => r.written && r.judged && r.wt).length + pg.filter((r) => wt(r.A)).length };
      const pooledB = { k: R[B]._rows.filter((r) => r.written && r.judged && r.accept).length + pg.filter((r) => r.B.accept).length, n: R[B]._rows.filter((r) => r.written && r.judged).length + pg.length, w: R[B]._rows.filter((r) => r.written && r.judged && r.wt).length + pg.filter((r) => wt(r.B)).length };
      for (const [r, x] of [[A, pooledA], [B, pooledB]]) R[r].written_n60 = { accept: `${x.k}/${x.n}`, wrong_text: `${x.w}/${x.n}`, p_acc_ge_080: betaP(x.k, x.n, 0.8, seed++).p, wrong_text_ok: x.w / x.n <= 0.04 };
      paired[`${Cc}|${B}`] = pair(Cc, B);
      paired[`${Cc}|${A}`] = pair(Cc, A);
    }
    if (cell === 'fr-blank-r2') paired['agy-flash-low@4|agy-flash-low'] = pair('agy-flash-low@4', 'agy-flash-low');
    if (cell === 'la-armc') paired['pero>agy-flash-low@4|pero>agy-flash-low'] = pair('pero>agy-flash-low@4', 'pero>agy-flash-low');
    // RULE.md decision
    const elig = (r) => (cell === 'de-blank-r2' && R[r].written_n60 ? R[r].written_n60.wrong_text_ok && R[r].written_n60.p_acc_ge_080 >= 0.9 && R[r].control.passed : R[r].eligible);
    const replaces = (a, b) => elig(a) && (paired[`${a}|${b}`]?.p_a_within_008 ?? 0) >= 0.9;
    let decision;
    const voided = pl.length >= 2 && pl.every((x) => !x.unjudged && !x.caught);
    if (voided) decision = { pick: null, why: 'both planted controls missed: the cell is void' };
    else if (cell === 'de-blank-r2') {
      const cand = [C.live, ...['agy-flash-low@4', 'agy-flash-low@4>agy-flash-low@4'].filter((r) => replaces(r, C.live))];
      const pick = [...cand].sort((x, y) => R[x].usd_per_accepted_page - R[y].usd_per_accepted_page)[0];
      decision = { pick, candidates: cand, why: `routes that replace ${C.live} by RULE.md 2, cheapest per accepted page` };
    } else if (cell === 'fr-blank-r2') {
      const r4 = 'agy-flash-low@4';
      decision = { pick: replaces(r4, C.live) ? r4 : C.live, why: replaces(r4, C.live) ? `${r4} is eligible and paired within 0.08 of ${C.live}` : `${r4} does not replace ${C.live} (eligible ${elig(r4)}, paired P ${paired[`${r4}|${C.live}`].p_a_within_008})` };
    } else {
      const c1 = 'pero>agy-flash-low', c4 = 'pero>agy-flash-low@4';
      decision = !elig(c1) && !elig(c4) ? { pick: null, why: `neither arm is eligible (c1: wrong text ${R[c1].written.wrong_text}, P(acc>=0.8) ${R[c1].written.p_acc_ge_080}; c4: ${R[c4].written.wrong_text}, ${R[c4].written.p_acc_ge_080})` }
        : elig(c1) && replaces(c4, c1) ? { pick: c4, why: 'c4 eligible and paired within 0.08 of c1' } : { pick: elig(c1) ? c1 : c4, why: 'the eligible arm' };
    }
    for (const r of Object.values(R)) delete r._rows;
    out.cells[cell] = { lang: C.lang, live: C.live, frame: s.cells[cell].frame, routes: R, paired, planted: { n: pl.length, caught: pl.filter((x) => x.caught).length, detail: pl }, decision };
    console.log(`\n${cell}: decision ${decision.pick} (${decision.why})`);
    for (const [r, x] of Object.entries(R)) console.log(`  ${r}: written ${x.written.accept} wt ${x.written.wrong_text} P80 ${x.written.p_acc_ge_080}${x.written_n60 ? ` | n60 ${x.written_n60.accept} wt ${x.written_n60.wrong_text} P80 ${x.written_n60.p_acc_ge_080}` : ''} | all ${x.all_drawn.accept} | ctrl ${x.control.passed} | ${x.agy_calls_per_page} calls/pg $${x.usd_per_accepted_page}/acc`);
    for (const [p, x] of Object.entries(paired)) console.log(`  paired ${p}: ${x.a_only} vs ${x.b_only} of ${x.n} (both ${x.both}) P ${x.p_a_within_008}`);
    console.log(`  planted ${pl.filter((x) => x.caught).length}/${pl.length}`);
  }
  W('score.json', out);
}

/** Router evidence: unsplit and by-script (the read's own <script> tag: every judged written page here is tagged printed). */
function evidence() {
  const sc = J('score.json'), s = J('sample.json'), key = J('key.json'), wr = J('written.json'), V = verdicts();
  const EV = path.join(ROOT, 'scripts/eval/estimator/router-table/evidence');
  const vOf = (cell, route, id) => { const k = key.find((x) => x.cell === cell && x.route === route && x.kind === 'item' && x.page_id === id); return k ? V.get(k.judged_as) ?? null : null; };
  const agg = (rows) => { const n = rows.length, k = rows.filter((r) => r.v?.accept).length, w = rows.filter((r) => wt(r.v)).length; const cl = {};
    for (const r of rows) for (const c of new Set((r.v?.defects || []).map(cls))) cl[c] = (cl[c] || 0) + 1;
    return { n, books: new Set(rows.map((r) => r.book_id)).size, accept: `${k}/${n}`, wrong_text_pages: `${w}/${n}`, classes_k_of_n: Object.fromEntries(Object.entries(cl).sort((a, b) => b[1] - a[1]).map(([c, v]) => [c, `${v}/${n}`])) }; };
  const un = { generated_by: 'scripts/eval/route-judge-6740/cheap-routes-7701/run.mjs evidence (job cheap-routes-7701, #7701; no model calls in this step)',
    provenance: '#7701 cheap-route cell tests: judge.mjs draw --cells=de-blank-r2,fr-blank-r2,la-armc (30 new books each, the first-read lane frame), correct (agy gemini-3.8-flash-low, AGY_HOME .agy-james), PERO-OCR drafts (pero-draft.py); written = the dry apply of each route as the lane writes it (run.mjs written); Opus judge blind against the image, wrong-page and planted controls (RULE.md)',
    judge: 'claude-opus-5-5 (claude -p), route-judge-6740 judgePrompt against the page image', cells: {} };
  const bys = { generated_by: un.generated_by, cells: {} };
  for (const [cell, C] of Object.entries(CELLS)) {
    const routes = {};
    for (const route of Object.keys(C.routes)) {
      const rows = s.cells[cell].pages.filter((sp) => wr[cell][route][sp.page_id]?.text).map((sp) => ({ ...sp, v: vOf(cell, route, sp.page_id) })).filter((r) => r.v);
      routes[`${route}-written`] = { ...agg(rows), note: 'the drawn pages the route writes (run.mjs written: the dry apply), judged; a page not written stays scans-only' };
    }
    const paired = Object.fromEntries(Object.entries(sc.cells[cell].paired).map(([p, x]) => [p.split('|').map((r) => `${r}-written`).join('|'), { n: x.n, both: x.both, a_only: x.a_only, b_only: x.b_only, neither: x.neither, books: x.books, ...(x.with_7701_pages && { with_7701_pages: x.with_7701_pages }) }]));
    un.cells[cell] = { task: 'ocr', lang: C.lang, frame: s.cells[cell].frame, routes, paired };
    bys.cells[`${cell}|print`] = { routes, paired };
  }
  fs.writeFileSync(path.join(EV, 'cheap-routes-7701.score.json'), JSON.stringify(un, null, 1) + '\n');
  fs.writeFileSync(path.join(EV, 'by-script', 'cheap-routes-7701.score.json'), JSON.stringify(bys, null, 1) + '\n');
  console.log('wrote evidence/cheap-routes-7701.score.json and by-script/');
}

/**
 * apply: each drawn page gets its best ACCEPTED written read (highest fidelity; a tie goes to the cheaper route), written
 * by cli-ocr.mjs apply under that route's guards (first reads only, printed only; the GPU route with its put-back),
 * stamped with the route's lane. A correction read here (B, C) was made over an eval draft, which apply refuses to
 * write; where only a correction was accepted the page is left to the live lane. Holds are untouched.
 */
function apply() {
  const sc = J('score.json'), key = J('key.json'), wr = J('written.json'), V = verdicts(), s = J('sample.json');
  const LANES = { read: 'agy-first-read-7701', gpu: 'pero-agy-first-read-7701' };
  const cost = (cell, route) => sc.cells[cell].routes[route].usd_per_accepted_page ?? 1;
  const plan = {};
  for (const [cell, C] of Object.entries(CELLS)) for (const sp of s.cells[cell].pages) {
    // the GPU lane's stamp is credited to pero>agy-flash-low (one a call) by the nightly sampler: only that arm is written
    const cands = Object.entries(C.routes).filter(([route, R]) => R.kind !== 'corr' && (R.kind !== 'gpu' || route === 'pero>agy-flash-low')).map(([route]) => {
      const k = key.find((x) => x.cell === cell && x.route === route && x.kind === 'item' && x.page_id === sp.page_id); const v = k && V.get(k.judged_as);
      return v?.accept && !wt(v) && wr[cell][route][sp.page_id]?.text && !wr[cell][route][sp.page_id].later_read ? { route, f: Number(v.fidelity) } : null; }).filter(Boolean)
      .sort((a, b) => b.f - a.f || cost(cell, a.route) - cost(cell, b.route));
    if (cands[0]) (plan[`${cell}\t${cands[0].route}`] ??= []).push(sp.page_id);
  }
  const APPLY = process.argv.includes('--apply'), res = {};
  for (const [k, ids] of Object.entries(plan)) {
    const [cell, route] = k.split('\t'), R = CELLS[cell].routes[route], dir = dirOf(cell, route), lane = LANES[R.kind];
    // the GPU route's read was stamped with the eval's lane id in its meta; the write is stamped with this lane's own
    if (R.kind === 'gpu') for (const id of ids) { const f = path.join(dir, `${id}.meta.json`), m = JSON.parse(fs.readFileSync(f, 'utf8')); if (m.lane !== lane) fs.writeFileSync(f, JSON.stringify({ ...m, lane, lane_was: m.lane }, null, 1)); }
    const only = path.join(dir, 'only-best.json'); fs.writeFileSync(only, JSON.stringify(ids));
    const extra = R.kind === 'read' ? ['--first-read-only', '--print-only', `--lane=${lane}`] : ['--diff-guard=gpu-draft', '--print-only'];
    const r = spawnSync(process.execPath, ['--no-warnings', CLI_OCR, 'apply', `--out=${dir}`, `--only=${only}`, `--reason=#7701 cheap-routes cell test: the judge-accepted best read of a page with no OCR (job cheap-routes-7701)`, ...extra, ...(APPLY ? ['--apply'] : [])], { cwd: ROOT, env: process.env, encoding: 'utf8' });
    const tail = r.stdout.trim().split('\n').filter((l) => /^(written|would write)/.test(l)).pop();
    res[k] = { pages: ids.length, lane, exit: r.status, summary: tail };
    console.log(`${cell} ${route}: ${ids.length} best reads -> ${tail} (lane ${lane})`);
  }
  W(`apply-${APPLY ? 'done' : 'dry'}.json`, res);
}

const stages = { written, packet, plant, score, evidence, apply };
if (!stages[STAGE]) { console.error(`usage: run.mjs ${Object.keys(stages).join('|')} --out=DIR`); process.exit(2); }
await stages[STAGE]();
