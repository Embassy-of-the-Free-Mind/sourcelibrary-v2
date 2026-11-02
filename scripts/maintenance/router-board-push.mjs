#!/usr/bin/env node
// PRIOR ART: scripts/audit/router-table-drift.mjs — the data (driftReport: each decided cell's status, the lanes that
// serve it, waivers); this adds the per-cell evidence the audit leaves out and the cron schedule of each lane, and
// writes it where an admin page can read it. scripts/maintenance/work-board-push.mjs / pipeline-now-push.mjs — the
// pattern copied (one ops_reports document, upserted from cron; the page renders it and needs no deploy to refresh).
/**
 * router-board push (/admin/router, #7913): per router cell, what production runs against what the router decided.
 *
 *   node --env-file=.env.production.local scripts/maintenance/router-board-push.mjs [--dry-run]
 *
 * Reads, from the checkout it runs in (main on Hetzner): the live router table (current.json through
 * scripts/lib/router-binding.mjs loadCurrentTable), the repo crontabs and the two routing tables (router-table-drift.mjs
 * driftFromRepo). One row per cell that is decided (keep / switch), served by a cron lane, or has pages waiting:
 * production route (the lanes' routes, box and cron schedule), the router's decision and route, the route's evidence
 * (accepted k/n, books, defects per 1,000 words, judge validity of its stratum), pages waiting, waivers and their
 * expiry. Upserts {_id: 'router-board:latest', type: 'router-board'} in ops_reports. Nothing but the admin page reads
 * it, so the write actuates nothing. No model, no page reads; the crontabs are the repo copies, not `crontab -l`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { driftFromRepo, defaultCrontabs } from '../audit/router-table-drift.mjs';
import { servedByCrontab } from '../audit/router-binding.mjs';
import { loadCurrentTable, checkBinding } from '../lib/router-binding.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const COLLECTION = 'ops_reports';
export const TYPE = 'router-board';
export const DOC_ID = 'router-board:latest';

const decided = (row) => /^(keep|switch)\b/.test(row.decision || '') && !/UNTESTED/.test(row.decision);
const r3 = (v) => (v == null ? null : Math.round(v * 1000) / 1000);

/** Each cron lane with its schedule and trailing comment: servedByCrontab run line by line. Exported for the test. */
export function cronLanes(crontabs) {
  const out = [];
  for (const [box, text] of Object.entries(crontabs)) {
    for (const line of text.split('\n')) {
      if (/^\s*#/.test(line) || !line.includes('cli-ocr-lane.mjs')) continue;
      const schedule = line.trim().split(/\s+/).slice(0, 5).join(' ');
      const comment = line.includes(' # ') ? line.slice(line.lastIndexOf(' # ') + 3).trim().slice(0, 200) : '';
      for (const s of servedByCrontab(line)) out.push({ ...s, box, schedule, comment });
    }
  }
  return out;
}

/** The evidence of one route of a table row: k/n, books, defects per 1,000 words, judge stratum. */
export function routeEvidence(row, routeId) {
  const r = (row.routes || []).find((x) => x.id === routeId);
  if (!r) return null;
  const d = r.defects;
  return {
    // n_eff: the judged pages after book scaling (build.py pool_sources), what the posterior really sees
    route: routeId, k_of_n: r.n ? `${r.k}/${r.n}` : null, n: r.n ?? null, n_eff: r3(r.eff?.[1]),
    accept_mean: r3(r.mean), wrong_text_pages: r.n ? `${r.wrong}/${r.n}` : null,
    defects: d ? { books: d.books, words: d.words, misleads_per_1k: r3(d.misleads_per_1k_posterior?.[1]), wrong_text_per_1k: r3(d.wrong_text_per_1k_posterior?.[1]) } : null,
  };
}

/** The board, pure over its inputs (the test passes them). */
export function routerBoard({ table, drift, lanes, today = new Date().toISOString().slice(0, 10) }) {
  const findings = checkBinding(table, lanes, { today }).map((f, i) => ({ ...f, box: lanes[i].box, schedule: lanes[i].schedule, comment: lanes[i].comment }));
  const status = Object.fromEntries(drift.cells.map((c) => [c.cell, c]));
  const cells = [];
  for (const row of table.rows.values()) {
    const mine = findings.filter((f) => f.cell === row.id);
    const isDecided = decided(row);
    if (!isDecided && !mine.length && !(row.pages_waiting > 0)) continue;
    const jv = row.judge_validity;
    const waivers = (table.waivers || []).filter((w) => w.cell === row.id).map((w) => ({ lane: w.lane || null, set: w.set, until: w.until, live: Boolean(w.until && today <= w.until), reason: String(w.reason || '').slice(0, 300) }));
    cells.push({
      cell: row.id, title: row.title || null,
      status: isDecided ? status[row.id]?.status ?? 'unshipped' : 'undecided',
      decision: String(row.decision || '').split(' (')[0], decision_label: String(row.decision || '').slice(0, 300),
      route: row.route, table: row.table || table.name, decided_set: table.pointer?.cells?.[row.id]?.set || table.pointer?.set || null,
      evidence: routeEvidence(row, row.route),
      judge: jv ? { stratum: jv.stratum, valid: jv.self_preference_valid ?? null } : null,
      pages_waiting: row.pages_waiting ?? 0,
      lanes: mine.map((f) => ({ box: f.box.replace(/^infrastructure\//, ''), lane: f.lane, runs: f.runs, runs_kn: f.runs_kn, status: f.status, schedule: f.schedule, comment: f.comment, ...(f.waiver && { waiver_until: f.waiver.until }) })),
      production: [...new Set(mine.map((f) => f.runs))],
      waivers,
      routing_row: (status[row.id]?.routing_row || []).length > 0,
    });
  }
  const rank = { mismatch: 0, unshipped: 1, waived: 2, served: 3, stored: 4, undecided: 5, idle: 6 };
  cells.sort((a, b) => rank[a.status] - rank[b.status] || b.pages_waiting - a.pages_waiting || a.cell.localeCompare(b.cell));
  return { _id: DOC_ID, type: TYPE, as_of: today, table: drift.table, pointer_set: drift.pointer_set, crontabs: drift.crontabs,
    tally: drift.tally, routing_tables: drift.routing_tables, cells };
}

async function main() {
  const argv = process.argv.slice(2);
  const dry = argv.includes('--dry-run');
  const table = loadCurrentTable();
  const drift = driftFromRepo();
  const crontabs = Object.fromEntries(defaultCrontabs(ROOT).map((f) => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]));
  let commit = null;
  try { commit = execFileSync('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { /* not a checkout */ }
  const doc = { ...routerBoard({ table, drift, lanes: cronLanes(crontabs) }), generated_at: new Date(), commit };
  if (dry) { console.log(JSON.stringify(doc, null, 1)); return; }
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set — use node --env-file=…/.env.production.local'); process.exit(2); }
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20_000 });
  await client.connect();
  try {
    await client.db(process.env.MONGODB_DB || 'bookstore').collection(COLLECTION).replaceOne({ _id: DOC_ID }, doc, { upsert: true });
    console.log(`router-board: ${doc.cells.length} cells (${doc.table}, commit ${commit})`);
  } finally { await client.close(); }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
