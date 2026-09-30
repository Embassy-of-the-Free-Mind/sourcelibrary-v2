#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-batch-shadow-judge.mjs — the blinded junction packet with the
// source and the same-lane A/A pair in one packet (seeded flips, key apart from the packet); it reads
// the SEAM lane's runs (`drafts`/`repairs`/`seams`) and cannot read a chained SHADOW run (`pages` on
// the run, no seams array, every consecutive page is a junction). `readerText`, `similarity`,
// `assessSeam` are imported from translation-batch-continuity-ab.mjs, the stats from lib/paired-stats,
// the device resolver from lib/page-break-devices, the detectors from lib/page-integrity and
// lib/block-drift — none reimplemented. translation-page-break-fix-ab.mjs draws from a fixed key.
/**
 * translation-chained-vs-realtime — speed test B (2026-09-30, #4681): does the chained Batch lane
 * produce production's text at page breaks with the #5103 devices on both sides, and what does it
 * cost and take per book? Pre-registration: PREREGISTRATION-translation-chained-vs-realtime.md.
 *
 * Arms on the same books: R = realtime worker (served, pages.translation), C and C2 = chained
 * shadow runs (translate_batch_runs, mode 'chained-shadow', tag C / C2, texts on run.pages).
 *
 *   --packet --books=id,…  FREE  per book ≤6 device + ≤2 plain mid-flow junctions; pairs C/R and
 *                                C/C2 on the SAME junctions, blinded, with the source; 8 judge chunks;
 *                                plus the deterministic per-page checks and body similarity
 *   --score                FREE  verdict files → fidelity/fluency tallies per pair, defects by type
 *                                at device junctions, the pre-registered rule
 *   --ops --books=id,…     FREE  operational table: rounds, cancels, strikes, latency, refusals,
 *                                $/page by the meter per arm (Supabase gemini_usage by endpoint)
 *
 * Nothing here writes to pages or spends. Files land in scripts/eval/results/ under --tag
 * (default translation-chained-vs-realtime).
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { readerText, similarity, assessSeam } from './translation-batch-continuity-ab.mjs';
import { resetSeed, seededRand, binomTwoSided } from './lib/paired-stats.mjs';
import { resolvePageBreak } from '../lib/page-break-devices.mjs';
import { echoedSource, openingWords } from '../lib/page-integrity.mjs';
import { duplicatedAcrossBoundary } from '../lib/block-drift.mjs';
import { RUNS_COLLECTION } from '../lib/translate-batch-seam.mjs';
import { SHADOW_MODE } from '../lib/translate-batch-chained.mjs';

const args = process.argv.slice(2);
const arg = (n) => args.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? null;
const has = (n) => args.includes(`--${n}`);

const RESULTS = new URL('./results/', import.meta.url).pathname;
const TAG = arg('tag') || 'translation-chained-vs-realtime';
const PACKET_FILE = path.join(RESULTS, `${TAG}-judge-packet.jsonl`);
const KEY_FILE = path.join(RESULTS, `${TAG}-judge-key.json`);
const CHECKS_FILE = path.join(RESULTS, `${TAG}-page-checks.json`);
const OPS_FILE = path.join(RESULTS, `${TAG}-ops.json`);
const JUDGES = Number(arg('judges') || 8);
const DEVICE_PER_BOOK = 6, PLAIN_PER_BOOK = 2;
const EXCERPT = 1200;
const SEED = 0x5eed ^ 0x2026;
const MIN_HALF = 120;
const ARMS = { C: arg('c') || 'C', C2: arg('c2') || 'C2' };

const tail = (t) => (t.length > EXCERPT ? '…' + t.slice(-EXCERPT) : t);
const head = (t) => (t.length > EXCERPT ? t.slice(0, EXCERPT) + '…' : t);
const junction = (prev, seam) => `${tail(readerText(prev))}\n\n———— page break ————\n\n${head(readerText(seam))}`;
const med = (xs) => { const v = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
const pct = (xs, p) => { const v = xs.filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.min(v.length - 1, Math.floor(v.length * p))] : null; };

async function loadBook(db, bookId) {
  const book = await db.collection('books').findOne({ id: bookId }, { projection: { id: 1, title: 1, language: 1 } });
  const runs = await db.collection(RUNS_COLLECTION).find({ book_id: bookId, mode: SHADOW_MODE }).sort({ created_at: -1 }).toArray();
  const runOf = (tag) => runs.find((r) => r.tag === tag) || null;
  const rc = runOf(ARMS.C), rc2 = runOf(ARMS.C2);
  if (!rc) throw new Error(`${bookId}: no shadow run tagged ${ARMS.C}`);
  const texts = (r) => new Map((r?.pages || []).map((p) => [p.page_number, p.text]));
  const pages = await db.collection('pages')
    .find({ book_id: bookId, page_number: { $gt: 0 } }, { projection: { id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'translation.data': 1, 'translation.source': 1, 'translation.health_blocked': 1 } })
    .sort({ page_number: 1 }).toArray();
  const R = new Map(pages.filter((p) => p.translation?.data && p.translation.source !== 'skip').map((p) => [p.page_number, p.translation.data]));
  return { book, rc, rc2, C: texts(rc), C2: texts(rc2), R, pages };
}

// ── --packet ────────────────────────────────────────────────────────────────
async function buildPacket(db, bookIds) {
  if (fs.existsSync(KEY_FILE)) throw new Error(`${KEY_FILE} exists — a rebuilt packet invalidates judged verdicts; move it aside deliberately`);
  resetSeed(SEED);
  const entries = [], key = [], checks = [], skipped = [];
  for (const bookId of bookIds) {
    const { book, C, C2, R, pages } = await loadBook(db, bookId);
    const byNum = new Map(pages.map((p) => [p.page_number, p]));
    // Candidate junctions: consecutive page numbers, both pages translated in every arm.
    const cands = [];
    for (const p of pages) {
      const q = byNum.get(p.page_number + 1);
      if (!q || !p.ocr?.data || !q.ocr?.data) continue;
      const have = (m) => m.has(p.page_number) && m.has(q.page_number);
      if (!have(C) || !have(R)) continue;
      let brk; try { brk = resolvePageBreak(p.ocr.data, q.ocr.data); } catch { brk = {}; }
      const device = brk.kind != null || brk.catchword != null;
      const seam = assessSeam(p.ocr.data, q.ocr.data);
      const halves = [C, R, C2].filter((m, i) => i < 2 || have(C2)).flatMap((m) => [m.get(p.page_number), m.get(q.page_number)]);
      if (halves.some((t) => readerText(t).trim().length < MIN_HALF)) continue;
      cands.push({ prev: p, next: q, device, kind: brk.kind || (brk.catchword ? 'catchword' : null), midflow: seam.ok, hasC2: have(C2) });
    }
    const pick = (xs, n) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(seededRand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); };
    const chosen = [...pick(cands.filter((c) => c.device), DEVICE_PER_BOOK), ...pick(cands.filter((c) => !c.device && c.midflow), PLAIN_PER_BOOK)];
    if (!chosen.length) skipped.push({ bookId, reason: `no junction with text in every arm (cands ${cands.length})` });
    for (const c of chosen) {
      const lanes = { C: [C.get(c.prev.page_number), C.get(c.next.page_number)], R: [R.get(c.prev.page_number), R.get(c.next.page_number)], C2: [C2.get(c.prev.page_number), C2.get(c.next.page_number)] };
      const source = `${tail(readerText(c.prev.ocr.data))}\n\n———— page break ————\n\n${head(readerText(c.next.ocr.data))}`;
      for (const pair of c.hasC2 ? ['C/R', 'C/C2'] : ['C/R']) {
        const [x, y] = pair.split('/');
        const flip = seededRand() < 0.5;
        const jx = junction(...lanes[x]), jy = junction(...lanes[y]);
        const entry = { id: null, language: book.language, source, left: flip ? jy : jx, right: flip ? jx : jy };
        entries.push(entry);
        key.push({ id: null, entry, book_id: bookId, prev_page: c.prev.page_number, next_page: c.next.page_number, pair, device: c.device, kind: c.kind, midflow: c.midflow, left: flip ? y : x, right: flip ? x : y,
          seam_len: Object.fromEntries([x, y].map((l) => [l, readerText(lanes[l][1]).length])) });
      }
    }
    // Deterministic checks on every page with text in C and R (and C2 where present).
    for (const p of pages) {
      const row = { book_id: bookId, page: p.page_number, ocr_len: (p.ocr?.data || '').length };
      for (const [arm, m] of Object.entries({ C, R, C2 })) {
        const t = m.get(p.page_number);
        if (!t) continue;
        const e = echoedSource({ ocr: p.ocr?.data, tr: t, lang: book.language });
        const prev = byNum.get(p.page_number - 1);
        const next = byNum.get(p.page_number + 1);
        // Block-shift (crude, names/numbers only across languages): does this page's translation share more of
        // its OWN OCR's opening words than the NEXT page's? A shifted block reads next_open > own_open.
        const opens = (o) => new Set(openingWords(o || '', 12, { withHeader: false }).map((w) => String(w).toLowerCase()));
        const trOpen = new Set(readerText(t).split(/\s+/).slice(0, 40).map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')).filter((w) => w.length > 3));
        const overlap = (o) => { const s = opens(o); let n = 0; for (const w of s) if (trOpen.has(w)) n++; return s.size ? n / s.size : null; };
        row[arm] = {
          len: readerText(t).length, ratio_to_ocr: p.ocr?.data ? +(readerText(t).length / p.ocr.data.length).toFixed(3) : null,
          echo: e.judged ? !!e.echo : null,
          own_open: overlap(p.ocr?.data), next_open: next ? overlap(next.ocr?.data) : null,
          dup_prev: prev && m.get(prev.page_number) ? !!duplicatedAcrossBoundary(m.get(prev.page_number), t) : null,
        };
      }
      if (row.C && row.R) { row.sim_C_R = +similarity(C.get(p.page_number), R.get(p.page_number)).toFixed(3); row.len_C_over_R = +(row.C.len / Math.max(1, row.R.len)).toFixed(3); }
      if (row.C && row.C2) row.sim_C_C2 = +similarity(C.get(p.page_number), C2.get(p.page_number)).toFixed(3);
      if (row.C || row.R) checks.push(row);
    }
    console.log(`${bookId}: ${C.size} C, ${C2.size} C2, ${R.size} R pages; ${cands.length} candidate junctions (${cands.filter((c) => c.device).length} device) → ${chosen.length} drawn`);
  }
  for (let i = entries.length - 1; i > 0; i--) { const j = Math.floor(seededRand() * (i + 1)); [entries[i], entries[j]] = [entries[j], entries[i]]; }
  entries.forEach((e, i) => { e.id = `j${String(i + 1).padStart(3, '0')}`; });
  for (const k of key) { k.id = k.entry.id; delete k.entry; }
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(PACKET_FILE, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  fs.writeFileSync(KEY_FILE, JSON.stringify({ seed: SEED, books: bookIds, arms: ARMS, skipped, key }, null, 1));
  fs.writeFileSync(CHECKS_FILE, JSON.stringify(checks, null, 1));
  for (let i = 0; i < JUDGES; i++) {
    const chunk = entries.filter((_, j) => j % JUDGES === i);
    fs.writeFileSync(path.join(RESULTS, `${TAG}-judge-chunk-${i + 1}.jsonl`), chunk.map((e) => JSON.stringify(e)).join('\n') + '\n');
  }
  const n = (pair) => key.filter((k) => k.pair === pair).length;
  console.log(`wrote ${entries.length} blinded junctions (${n('C/R')} C/R, ${n('C/C2')} C/C2; ${key.filter((k) => k.device && k.pair === 'C/R').length} device C/R) → ${JUDGES} chunks; key ${KEY_FILE}`);
  console.log(`page checks ${checks.length} rows → ${CHECKS_FILE}; median sim C~R ${med(checks.map((c) => c.sim_C_R))?.toFixed(3)}, C~C2 ${med(checks.map((c) => c.sim_C_C2))?.toFixed(3)}, len C/R ${med(checks.map((c) => c.len_C_over_R))}`);
  for (const s of skipped) console.log('  skipped', JSON.stringify(s));
}

// ── --score ─────────────────────────────────────────────────────────────────
function score() {
  const { key } = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
  const byId = new Map(key.map((k) => [k.id, k]));
  const files = fs.readdirSync(RESULTS).filter((f) => f.startsWith(`${TAG}-judge-verdicts`) && f.endsWith('.json'));
  const verdicts = files.flatMap((f) => JSON.parse(fs.readFileSync(path.join(RESULTS, f), 'utf8')));
  const seen = new Set();
  const rows = verdicts.filter((v) => byId.has(v.id) && !seen.has(v.id) && seen.add(v.id));
  const report = { judged: rows.length, expected: key.length, files: files.length };
  const tally = (sel, field) => {
    const wins = {}; let ties = 0, n = 0;
    for (const v of rows) { const k = byId.get(v.id); if (!sel(k)) continue; n++; const s = String(v[field] || '').trim().toUpperCase(); if (s !== 'LEFT' && s !== 'RIGHT') { ties++; continue; } wins[k[s.toLowerCase()]] = (wins[k[s.toLowerCase()]] || 0) + 1; }
    return { n, ties, wins };
  };
  const defects = (sel, side) => { const out = {}; for (const v of rows) { const k = byId.get(v.id); if (!sel(k)) continue; const arm = k.left === side ? 'left_defects' : k.right === side ? 'right_defects' : null; if (!arm) continue; for (const d of v[arm] || []) out[d.type] = (out[d.type] || 0) + 1; } return out; };
  for (const pair of ['C/R', 'C/C2']) {
    const [x, y] = pair.split('/');
    for (const field of ['fidelity', 'fluency']) {
      const t = tally((k) => k.pair === pair, field);
      const wx = t.wins[x] || 0, wy = t.wins[y] || 0, decided = wx + wy;
      report[`${pair} ${field}`] = { n: t.n, ties: t.ties, [x]: wx, [y]: wy, decided, [`${y}_share`]: decided ? +(wy / decided).toFixed(3) : null, larger_share: decided ? +(Math.max(wx, wy) / decided).toFixed(3) : null, p_two_sided: decided ? +binomTwoSided(Math.min(wx, wy), decided).toFixed(3) : null };
    }
    const dev = (k) => k.pair === pair && k.device;
    const td = tally(dev, 'fidelity');
    report[`${pair} fidelity (device junctions)`] = { n: td.n, ties: td.ties, ...td.wins, defects: { [x]: defects(dev, x), [y]: defects(dev, y) } };
  }
  const test = report['C/R fidelity'], floor = report['C/C2 fidelity'];
  const heavy = (d) => (d.OMISSION || 0) + (d.DUPLICATION || 0) + (d.UNTRANSLATED || 0);
  const dC = heavy(report['C/R fidelity (device junctions)'].defects.C), dR = heavy(report['C/R fidelity (device junctions)'].defects.R);
  const fl = report['C/C2 fidelity (device junctions)'].defects;
  const floorDiff = Math.abs(heavy(fl.C || {}) - heavy(fl.C2 || {}));
  const rule = {
    share_R: test.R_share, share_floor: floor.larger_share,
    share_ok: test.R_share != null && floor.larger_share != null ? test.R_share <= Math.max(0.6, floor.larger_share + 0.1) : null,
    device_defects: { C: dC, R: dR, floor_diff: floorDiff }, defects_ok: dC <= dR + floorDiff,
  };
  rule.seams_inside_floor = rule.share_ok === true && rule.defects_ok;
  report.rule = rule;
  console.log(JSON.stringify(report, null, 1));
  console.log(`\nC vs R fidelity = C ${test.C}–R ${test.R}–tie ${test.ties} (n ${test.n}); floor C vs C2 = ${floor.C}–${floor.C2}–${floor.ties} (n ${floor.n}); seams ${rule.seams_inside_floor ? 'INSIDE' : 'NOT inside'} the floor`);
  fs.writeFileSync(path.join(RESULTS, `${TAG}-report-${new Date().toISOString().slice(0, 10)}.json`), JSON.stringify(report, null, 1));
}

// ── --ops ───────────────────────────────────────────────────────────────────
async function supabaseUsage(ids, since) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !k) return { error: 'no supabase env', rows: [] };
  const rows = [];
  for (let i = 0; i < ids.length; i += 80) {
    const inList = ids.slice(i, i + 80).map(encodeURIComponent).join(',');
    for (let page = 0; page < 50; page++) {
      const from = page * 1000;
      const resp = await fetch(`${url}/rest/v1/gemini_usage?select=book_id,endpoint,mode,model,cost_usd,input_tokens,output_tokens,page_count,status,timestamp,batch_job_id&book_id=in.(${inList})&timestamp=gte.${since.toISOString()}&order=id.asc`, { headers: { apikey: k, Authorization: `Bearer ${k}`, Range: `${from}-${from + 999}` } });
      if (!resp.ok && resp.status !== 206) return { error: `supabase ${resp.status}`, rows };
      const batch = await resp.json();
      rows.push(...batch);
      if (batch.length < 1000) break;
    }
  }
  return { rows };
}

async function ops(db, bookIds) {
  const since = new Date(arg('since') || '2026-09-30T08:00:00Z');
  const runs = await db.collection(RUNS_COLLECTION).find({ book_id: { $in: bookIds }, mode: SHADOW_MODE, created_at: { $gte: since } }).toArray();
  const arms = {};
  for (const r of runs) {
    const a = (arms[r.tag] ||= { books: 0, complete: 0, parked: [], pages_queued: 0, written: 0, unhealthy: 0, blocked: 0, single_fallbacks: 0, rounds: 0, strikes: 0, cancelled: 0, latencies: [], book_minutes: [], refused: {} });
    a.books++; a.pages_queued += r.page_count || 0;
    for (const k of ['written', 'unhealthy', 'blocked', 'single_fallbacks']) a[k] += r.counts?.[k] || 0;
    if (r.phase === 'complete') { a.complete++; a.book_minutes.push((new Date(r.completed_at) - new Date(r.created_at)) / 60000); }
    if (r.phase === 'parked') a.parked.push({ book: r.book_id, reason: r.parked_reason });
    for (const x of r.rounds || []) { a.rounds++; if (x.outcome === 'strike') { a.strikes++; if (/CANCELLED|cancelled/.test(x.reason || '')) a.cancelled++; } if (x.submitted_at && x.collected_at) a.latencies.push((new Date(x.collected_at) - new Date(x.submitted_at)) / 60000); }
    for (const f of r.refused || []) a.refused[f.reason] = (a.refused[f.reason] || 0) + 1;
  }
  for (const a of Object.values(arms)) {
    a.round_latency_min = { median: med(a.latencies)?.toFixed(1), p90: pct(a.latencies, 0.9)?.toFixed(1), max: pct(a.latencies, 1)?.toFixed(1) };
    a.book_wall_clock_min = { median: med(a.book_minutes)?.toFixed(0), max: pct(a.book_minutes, 1)?.toFixed(0), n: a.book_minutes.length };
    a.cancel_rate = a.rounds ? +(a.cancelled / a.rounds).toFixed(3) : null;
    delete a.latencies; delete a.book_minutes;
  }
  // R: the realtime worker's pages and timing from the served text and the book's status trail.
  const books = await db.collection('books').find({ id: { $in: bookIds } }, { projection: { id: 1, 'pipeline_auto.status': 1, pages_translated: 1, last_translation_at: 1, updated_at: 1 } }).toArray();
  const rPages = await db.collection('pages').aggregate([
    { $match: { book_id: { $in: bookIds }, 'translation.updated_at': { $gte: since } } },
    { $group: { _id: '$book_id', n: { $sum: 1 }, first: { $min: '$translation.updated_at' }, last: { $max: '$translation.updated_at' }, health_blocked: { $sum: { $cond: [{ $ifNull: ['$translation.health_blocked', false] }, 1, 0] } }, skip: { $sum: { $cond: [{ $eq: ['$translation.source', 'skip'] }, 1, 0] } } } },
  ]).toArray();
  arms.R = { books: rPages.length, pages_written: rPages.reduce((n, b) => n + b.n, 0), health_blocked: rPages.reduce((n, b) => n + b.health_blocked, 0), refused_skip: rPages.reduce((n, b) => n + b.skip, 0),
    book_wall_clock_min: { median: med(rPages.map((b) => (b.last - b.first) / 60000))?.toFixed(0), max: pct(rPages.map((b) => (b.last - b.first) / 60000), 1)?.toFixed(0), n: rPages.length, note: 'first→last page write; dispatch wait not included' },
    status: Object.fromEntries(books.map((b) => [b.id, b.pipeline_auto?.status])) };
  // Meter by endpoint.
  const { rows, error } = await supabaseUsage(bookIds, since);
  const meter = {};
  for (const r of rows) { const m = (meter[r.endpoint || '?'] ||= { rows: 0, usd: 0, pages: 0, input: 0, output: 0, failed: 0 }); m.rows++; m.usd += Number(r.cost_usd) || 0; m.pages += Number(r.page_count) || 0; m.input += Number(r.input_tokens) || 0; m.output += Number(r.output_tokens) || 0; if (r.status && r.status !== 'success' && r.status !== 'submitted') m.failed++; }
  for (const m of Object.values(meter)) { m.usd = +m.usd.toFixed(4); m.usd_per_payload_page = m.pages ? +(m.usd / m.pages).toFixed(5) : null; }
  const out = { since, arms, meter, meter_error: error || null };
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(OPS_FILE, JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
}

// ── main ────────────────────────────────────────────────────────────────────
const books = String(arg('books') || '').split(',').filter(Boolean);
if (has('score')) score();
else if (has('packet') || has('ops')) {
  if (!books.length) { console.error('--books=id1,id2,... required'); process.exit(1); }
  const client = new MongoClient(process.env.MONGODB_URI);
  try { await client.connect(); const db = client.db('bookstore'); if (has('packet')) await buildPacket(db, books); if (has('ops')) await ops(db, books); } finally { await client.close(); }
} else console.log('one of --packet --books=… | --score | --ops --books=… (see the header)');
