#!/usr/bin/env node
// PRIOR ART: scripts/lib/spend-guard.mjs#getScopeSpendUsd (both stores, one total — no per-book or
// per-phase split); scripts/audit/spend-reconcile.mjs (billed vs metered for the whole project, by
// day/SKU — not by book); scripts/audit/scope-progress.mjs (stage outputs, no time); the speed
// test's tick.mjs (throughput from page timestamps, dial-wide). This joins them per book.
//
// Quality round 1 (#5438) — measures 1 and 2 of the preregistration: cost per book and per phase
// from BOTH meter stores, wall-clock per phase from audit_log transitions, and pipeline health
// (statuses off the line with reasons, chained-run rounds/cancels/strikes/parks, pages without text
// or translation). Read-only.
//
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/quality-round-1/measure.mjs [--out=<path>]
//
// Writes /root/quality-round-1/measure.json (default). Costs are the meter's computed `cost_usd`,
// an ESTIMATE (spend-reconcile.mjs trap: the meter has read 3–17x under the bill); the report
// prints the bill/meter ratio for the window beside it, never instead of it.

import fs from 'fs';
import { ObjectId } from 'mongodb';
import { withMongo } from '../../lib/mongo.mjs';

const TAG = 'quality-round-1-2026-10';
const argOf = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const OUT = argOf('out', '/root/quality-round-1/measure.json');
const DRAW = JSON.parse(fs.readFileSync(new URL('./draw-2026-10-01.json', import.meta.url), 'utf8'));
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Meter `type` → phase of the preregistration.
function phaseOf(type, endpoint) {
  const t = String(type || '').toLowerCase();
  if (/ocr|preview|reference/.test(t)) return 'ocr';
  if (/translat/.test(t)) return 'translate';
  if (/image|extract|gallery/.test(t)) return 'images';
  if (/embed/.test(t)) return 'embed';
  if (/summar|index|chapter|enrich|metadata|classif|cover|title/.test(t)) return 'enrich';
  if (/translit/.test(t)) return 'transliterate';
  return `other:${t || endpoint || 'unknown'}`;
}

async function supabaseRows(ids, since) {
  if (!KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing — refusing to report one store');
  const rows = [];
  for (let i = 0; i < ids.length; i += 60) {
    const inList = ids.slice(i, i + 60).map(encodeURIComponent).join(',');
    for (let p = 0; ; p++) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/gemini_usage?select=book_id,type,mode,model,endpoint,cost_usd,page_count,status,timestamp&book_id=in.(${inList})&timestamp=gte.${since.toISOString()}&order=id.asc`, {
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Range: `${p * 1000}-${p * 1000 + 999}` },
      });
      if (!r.ok && r.status !== 206) throw new Error(`Supabase read failed ${r.status}`);
      const batch = await r.json();
      rows.push(...batch);
      if (batch.length < 1000) break;
      if (p > 200) throw new Error('Supabase pagination runaway');
    }
  }
  return rows;
}

await withMongo(async (db) => {
  const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
  const scope = control?.allow_scopes?.[TAG];
  const since = new Date(scope?.created_at || '2026-10-01T07:55:00Z');
  const ids = DRAW.books.map((b) => b.id);
  const cellOf = Object.fromEntries(DRAW.books.map((b) => [b.id, b.cell]));

  // ── cost, both stores ──
  const mongoRows = await db.collection('gemini_usage').find(
    { book_id: { $in: ids }, _id: { $gte: ObjectId.createFromTime(Math.floor(since.getTime() / 1000)) } },
    { projection: { book_id: 1, type: 1, mode: 1, model: 1, endpoint: 1, cost_usd: 1, page_count: 1, status: 1 } },
  ).toArray();
  const supaRows = await supabaseRows(ids, since);
  const cost = {};
  const store = { mongo: { rows: mongoRows.length, usd: 0 }, supabase: { rows: supaRows.length, usd: 0 } };
  const add = (r, s) => {
    const c = Number(r.cost_usd) || 0;
    store[s].usd += c;
    const ph = phaseOf(r.type, r.endpoint);
    const b = (cost[r.book_id] ||= { total: 0, by_phase: {}, costless_rows: 0, models: {} });
    b.total += c; b.by_phase[ph] = (b.by_phase[ph] || 0) + c;
    if (r.cost_usd == null) b.costless_rows++;
    b.models[`${ph}:${r.model}:${r.mode || ''}`] = (b.models[`${ph}:${r.model}:${r.mode || ''}`] || 0) + c;
  };
  for (const r of mongoRows) add(r, 'mongo');
  for (const r of supaRows) add(r, 'supabase');

  // ── wall-clock: audit_log transitions since enrolment ──
  const trans = await db.collection('audit_log').find(
    { book_id: { $in: ids }, action: 'pipeline_status_changed', timestamp: { $gte: since } },
    { projection: { book_id: 1, metadata: 1, timestamp: 1 } },
  ).sort({ timestamp: 1 }).toArray();
  const timeline = {};
  for (const t of trans) (timeline[t.book_id] ||= []).push([new Date(t.timestamp).toISOString(), t.metadata?.from, t.metadata?.to]);

  // ── books, pages, chained runs ──
  const books = await db.collection('books').find({ id: { $in: ids } }, {
    projection: { id: 1, title: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, pages_blank: 1, visible: 1, hidden_reason: 1, pipeline_auto: 1, processing_priority: 1, ai_metadata: 1, summary: 1 },
  }).toArray();
  const runs = await db.collection('translate_batch_runs').find({ book_id: { $in: ids }, created_at: { $gte: since } }, {
    projection: { id: 1, book_id: 1, phase: 1, model: 1, round: 1, strikes: 1, dropped: 1, counts: 1, page_count: 1, excluded: 1, estimate: 1, spent_est_usd: 1, created_at: 1, updated_at: 1, 'rounds.state': 1, 'rounds.status': 1, 'rounds.cancelled': 1, 'rounds.submitted_at': 1, 'rounds.collected_at': 1, park_reason: 1, parked_reason: 1, refusals: 1 },
  }).toArray();
  const pageGaps = await db.collection('pages').aggregate([
    { $match: { book_id: { $in: ids } } },
    { $group: {
      _id: '$book_id',
      pages: { $sum: 1 },
      no_text: { $sum: { $cond: [{ $or: [{ $eq: [{ $ifNull: ['$ocr.data', ''] }, ''] }] }, 1, 0] } },
      no_tr: { $sum: { $cond: [{ $and: [{ $ne: ['$page_type', 'blank'] }, { $ne: [{ $ifNull: ['$ocr.data', ''] }, ''] }, { $eq: [{ $ifNull: ['$translation.data', ''] }, ''] }] }, 1, 0] } },
      recitation: { $sum: { $cond: [{ $eq: ['$ocr.recitation_blocked', true] }, 1, 0] } },
      fail_blocked: { $sum: { $cond: [{ $eq: ['$ocr.fail_blocked', true] }, 1, 0] } },
      blank: { $sum: { $cond: [{ $eq: ['$page_type', 'blank'] }, 1, 0] } },
      ocr_first: { $min: '$ocr.updated_at' }, ocr_last: { $max: '$ocr.updated_at' },
      tr_first: { $min: '$translation.updated_at' }, tr_last: { $max: '$translation.updated_at' },
    } },
  ], { allowDiskUse: true }).toArray();
  const gaps = Object.fromEntries(pageGaps.map((g) => [g._id, g]));

  const perBook = books.map((b) => {
    const r = runs.filter((x) => x.book_id === b.id);
    const rounds = r.flatMap((x) => x.rounds || []);
    const pa = b.pipeline_auto || {};
    return {
      id: b.id, cell: cellOf[b.id], title: b.title, status: pa.status || null,
      off_line_reason: ['needs_attention', 'failed', 'parked', 'held'].includes(pa.status) ? (pa.reason || pa.attention_reason || pa.parked_reason || pa.hold?.reason || 'unrecorded') : null,
      pages_count: b.pages_count, pages_ocr: b.pages_ocr || 0, pages_translated: b.pages_translated || 0, pages_blank: b.pages_blank || 0,
      processing_priority: b.processing_priority ?? null,
      cost_usd: +(cost[b.id]?.total || 0).toFixed(4), cost_by_phase: cost[b.id]?.by_phase || {}, cost_models: cost[b.id]?.models || {}, costless_rows: cost[b.id]?.costless_rows || 0,
      timeline: timeline[b.id] || [],
      pages: gaps[b.id] || null,
      chained: r.map((x) => ({ id: x.id, phase: x.phase, model: x.model, rounds: (x.rounds || []).length, strikes: x.strikes, dropped: x.dropped, excluded: x.excluded, counts: x.counts, spent_est_usd: x.spent_est_usd, park: x.park_reason || x.parked_reason || null })),
      chained_rounds_cancelled: rounds.filter((x) => x.cancelled || /cancel/i.test(String(x.state || x.status || ''))).length,
      has_summary: !!b.summary, ai_metadata: b.ai_metadata ? { title: b.ai_metadata.title ?? null, author: b.ai_metadata.author ?? null, year: b.ai_metadata.year ?? b.ai_metadata.date ?? null } : null,
    };
  });

  const out = { t: new Date().toISOString(), tag: TAG, since: since.toISOString(), stores: store, total_usd: +(store.mongo.usd + store.supabase.usd).toFixed(4), books: perBook };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  const byCell = {};
  for (const b of perBook) { const c = (byCell[b.cell] ||= { n: 0, complete: 0, usd: 0 }); c.n++; c.usd += b.cost_usd; if (b.status === 'complete') c.complete++; }
  console.log(`total $${out.total_usd} (mongo $${store.mongo.usd.toFixed(2)} / ${store.mongo.rows} rows, supabase $${store.supabase.usd.toFixed(2)} / ${store.supabase.rows} rows)`);
  for (const [c, v] of Object.entries(byCell)) console.log(`${c.padEnd(24)} n=${v.n} complete=${v.complete} $${v.usd.toFixed(2)}`);
  console.log(`wrote ${OUT}`);
});
