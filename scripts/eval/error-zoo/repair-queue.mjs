#!/usr/bin/env node
/**
 * PRIOR ART: scripts/batch/ocr-convergence/driver.mjs `select` (picks pages to re-read by readership, not by findings),
 * scripts/lib/router-binding.mjs (loadCurrentTable / boundRoute: the live route per cell, used here unchanged), and
 * scripts/eval/error-zoo/repair-pilot/select.mjs (one cell, one route, for the pilot). Nothing turns the audits'
 * findings into a repair queue across cells: flagged pages sat untouched (#8632). This builds that queue. Read-only:
 * it writes a file, never a page.
 *
 *   node --env-file=… scripts/eval/error-zoo/repair-queue.mjs --labels=labels.jsonl --out=queue.json
 *
 * One row per page with a serious OCR-stage finding (or wrong leaf) on text unchanged since the judgment, served:
 *   cell        router cell id, `<language>-<engine>/<script>` (router-binding.mjs naming)
 *   route       the cell's bound route in the live router table, or null
 *   evidence    readers and families that flagged it; confirmed = two model families flagged the same page
 *   status      queued            confirmed, the cell has a route, nothing blocks a repair
 *               needs-second-read one family flagged it; a reader of the other family must agree first
 *               no-route          the cell binds no route (HOLD, UNTESTED, planned, or no such cell)
 *               deferred          book held or in a translate lane (the lane would re-translate at once)
 *               skip              human-edited or manual text: never re-read for a write
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import { loadCurrentTable, boundRoute } from '../../lib/router-binding.mjs';
import { translationLaneReason } from '../../batch/ocr-convergence/lib.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const LABELS = arg('labels'), OUT = arg('out');
if (!LABELS || !OUT) { console.error('usage: repair-queue.mjs --labels=FILE --out=FILE'); process.exit(2); }
const family = (reader) => (/gemini/i.test(reader || '') ? 'gemini' : /claude|opus|sonnet/i.test(reader || '') ? 'claude' : 'other');

const pages = new Map();
for (const l of fs.readFileSync(LABELS, 'utf8').split('\n')) {
  if (!l.trim()) continue; const r = JSON.parse(l);
  if (r.positive_only || r.stale || r.exposure !== 'served' || !r.page_id) continue;
  const ser = (r.errors || []).filter((e) => (e.severity || 'serious') === 'serious' && (e.stage === 'ocr' || e.kind === 'wrong_leaf'));
  if (!ser.length) continue;
  const p = pages.get(r.page_id) || { page_id: r.page_id, book_id: r.book_id, page_number: r.page_number, readers: new Set(), families: new Set(), methods: new Set(), classes: new Set() };
  p.readers.add(r.reader); p.families.add(family(r.reader)); p.methods.add(r.method);
  for (const e of ser) if (e.class) p.classes.add(e.class);
  pages.set(r.page_id, p);
}
console.log('pages with a fresh serious OCR finding:', pages.size);

const table = loadCurrentTable();
const PREFIX = { Latin: 'latin', German: 'german', French: 'french', Italian: 'italian', Greek: 'greek', Hebrew: 'hebrew', Arabic: 'arabic', Chinese: 'chinese', 'Classical Chinese': 'chinese', Sanskrit: 'sanskrit', Russian: 'russian', Spanish: 'spanish', English: 'english', Tibetan: 'tibetan', Dutch: 'dutch', Japanese: 'japanese', Korean: 'korean', Persian: 'persian', Syriac: 'syriac' };
const engineOf = (m) => { m = (m || '').toLowerCase(); if (!m) return null; if (m.includes('lite')) return 'lite'; if (m.includes('paddle')) return 'paddle'; if (m.includes('yigdzin') || m.includes('bdrc')) return 'yigdzin'; if (/gemini-3/.test(m) && m.includes('flash')) return 'flash3'; if (m.includes('opus') || m.includes('claude')) return 'opus'; return null; };
const scriptOf = (s) => (s === 'printed' ? 'print' : s === 'handwritten' ? 'manuscript' : 'unknown');
function cellFor(lang, model, script) {
  const pre = PREFIX[lang], eng = engineOf(model), sc = scriptOf(script);
  if (!pre || !eng) return { cell: `${pre || String(lang || '?').toLowerCase()}-${eng || 'other'}/${sc}`, row: null };
  for (const id of [`${pre}-${eng}/${sc}`, pre === 'chinese' ? `zh-${eng}/${sc}` : null, eng === 'yigdzin' ? `tibetan-yigdzin/${sc}` : null].filter(Boolean)) {
    const row = table.rows.get(id); if (row) return { cell: id, row };
  }
  return { cell: `${pre}-${eng}/${sc}`, row: null };
}

const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const db = client.db('bookstore');
const ids = [...pages.keys()];
const live = new Map();
for (let i = 0; i < ids.length; i += 1000) for (const d of await db.collection('pages').find({ id: { $in: ids.slice(i, i + 1000) } }, { projection: { id: 1, book_id: 1, script_type: 1, 'ocr.model': 1, 'ocr.source': 1, 'ocr.edited_by': 1, read_count: 1 } }).toArray()) live.set(d.id, d);
const bids = [...new Set([...live.values()].map((d) => d.book_id))];
const books = new Map();
for (let i = 0; i < bids.length; i += 500) for (const b of await db.collection('books').find({ id: { $in: bids.slice(i, i + 500) } }, { projection: { id: 1, language: 1, slug: 1, read_count: 1, pages_ocr: 1, pages_blank: 1, pages_translated: 1, pipeline_auto: 1 } }).toArray()) books.set(b.id, b);
await client.close();

const rows = [];
for (const p of pages.values()) {
  const d = live.get(p.page_id); if (!d) continue;
  const b = books.get(d.book_id) || {};
  const { cell, row } = cellFor(String(b.language || '').trim(), d.ocr?.model, d.script_type);
  let route = row ? boundRoute(row) : null;
  // A bound route that is just the engine that made the page (`lite` on a lite read) keeps the text: not a repair.
  if (route && !route.includes('>') && engineOf(route) && engineOf(route) === engineOf(d.ocr?.model)) route = null;
  // Two MODEL families: a lane judge or person counted as 'other' does not stand in for the second family.
  const confirmed = p.families.has('claude') && p.families.has('gemini');
  let status;
  if (d.ocr?.edited_by || d.ocr?.source === 'manual') status = 'skip';
  else if (translationLaneReason(b)) status = 'deferred';
  else if (!route) status = 'no-route';
  else status = confirmed ? 'queued' : 'needs-second-read';
  rows.push({ page_id: p.page_id, book_id: d.book_id, slug: b.slug, page_number: p.page_number, language: b.language, ocr_model: d.ocr?.model ?? null, script: d.script_type ?? null,
    cell, decision: row?.decision ?? null, route, status, families: [...p.families], methods: [...p.methods], classes: [...p.classes], page_reads: d.read_count ?? 0, book_reads: b.read_count ?? 0 });
}
rows.sort((a, b) => (b.book_reads - a.book_reads) || (b.page_reads - a.page_reads));
const by = (k) => rows.reduce((m, r) => ((m[r[k]] = (m[r[k]] || 0) + 1), m), {});
const byCell = {}; for (const r of rows) { const c = (byCell[r.cell] ||= { route: r.route, decision: r.decision, statuses: {} }); c.statuses[r.status] = (c.statuses[r.status] || 0) + 1; }
fs.writeFileSync(OUT, JSON.stringify({ built_at: new Date().toISOString(), router_table: table.name, n: rows.length, by_status: by('status'), by_cell: byCell, rows }, null, 1));
console.log(JSON.stringify(by('status')));
for (const [c, v] of Object.entries(byCell).sort((a, b) => Object.values(b[1].statuses).reduce((x, y) => x + y, 0) - Object.values(a[1].statuses).reduce((x, y) => x + y, 0)).slice(0, 14)) console.log(`  ${c.padEnd(26)} route ${String(v.route).padEnd(24)} ${JSON.stringify(v.statuses)}`);
