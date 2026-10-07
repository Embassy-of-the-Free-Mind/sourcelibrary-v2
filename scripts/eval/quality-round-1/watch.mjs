#!/usr/bin/env node
// PRIOR ART: scripts/audit/scope-progress.mjs (per-stage outputs for a scope, but a one-shot print
// with no timeline, no cap action and no issue comment); /root/speedtest-a/tick.mjs (the speed
// test's guard + 6-hourly row — dial-level, not a book set). This copies tick.mjs's shape (cron
// tick → jsonl checkpoint → guard → periodic comment) onto one envelope's book list.
//
// Quality round 1 (#5438) — the watcher. Run from cron every 30 min (lid-proof):
//
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/quality-round-1/watch.mjs [--comment] [--dry-run]
//
// Each tick appends ONE row to $STATE/ticks.jsonl (the checkpoint: a dead tick loses nothing but
// itself), holding per-book status / pages_ocr / pages_translated and the envelope's measured
// spend from BOTH usage stores. The cap brake: at CAP_USD measured spend, every round book not yet
// terminal is held (`quality-round-1-cap`), a BLOCKED marker is written and #5438 is told — the
// envelope alone cannot stop spend while the global dial is open. --comment (or 6 h since the last
// comment) posts a progress comment on #5438.

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { withMongo } from '../../lib/mongo.mjs';
import { getScopeSpendUsd } from '../../lib/spend-guard.mjs';
import { holdBook } from '../../lib/pipeline-hold.mjs';

const TAG = 'quality-round-1-2026-10';
const ISSUE = 5438;
const BUDGET_USD = 500;
const CAP_USD = 475;
const COMMENT_EVERY_MS = 6 * 3600 * 1000;
const STATE = process.env.QR1_STATE || '/root/quality-round-1';
const DRY = process.argv.includes('--dry-run');
const FORCE_COMMENT = process.argv.includes('--comment');
const TERMINAL = new Set(['complete', 'needs_attention', 'failed', 'parked', 'held']);
const ORDER = ['queued', 'archiving', 'archive_complete', 'ocr_submitted', 'ocr_complete', 'translate_submitted', 'translate_complete', 'summary_indexed', 'enriched', 'chapters_complete', 'images_submitted', 'images_complete', 'cover_selected', 'complete', 'needs_attention', 'parked', 'failed', 'held'];

fs.mkdirSync(STATE, { recursive: true });
const lockFile = path.join(STATE, 'watch.lock');
try { fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' }); } catch {
  const age = Date.now() - fs.statSync(lockFile).mtimeMs;
  if (age < 50 * 60 * 1000) { console.error('another tick is running'); process.exit(0); }
  fs.writeFileSync(lockFile, String(process.pid));
}

try {
  await withMongo(async (db) => {
    const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
    const scope = control?.allow_scopes?.[TAG];
    if (!scope) throw new Error(`scope ${TAG} is gone`);
    const ids = scope.book_ids.map(String);
    const since = new Date(scope.created_at);
    const now = new Date();

    const books = await db.collection('books').find({ id: { $in: ids } }, {
      projection: { id: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, pages_blank: 1, visible: 1, 'pipeline_auto.status': 1, 'pipeline_auto.last_updated': 1, 'pipeline_auto.reason': 1, 'pipeline_auto.attention_reason': 1, 'pipeline_auto.hold.reason': 1 },
    }).toArray();
    const spend = await getScopeSpendUsd(db, { ids, since });

    const byStatus = {};
    for (const b of books) { const s = b.pipeline_auto?.status || 'none'; byStatus[s] = (byStatus[s] || 0) + 1; }
    const sum = (k) => books.reduce((s, b) => s + (b[k] || 0), 0);
    const row = {
      t: now.toISOString(), tag: TAG, books: books.length,
      spend_usd: +spend.usd.toFixed(4), spend_rows: spend.rows, meter_error: spend.meterError,
      dial_usd: control.daily_budget_usd ?? null, paused: !!control.paused,
      by_status: byStatus,
      pages: { count: sum('pages_count'), ocr: sum('pages_ocr'), translated: sum('pages_translated'), blank: sum('pages_blank') },
      per_book: books.map((b) => [b.id, b.pipeline_auto?.status || null, b.pages_ocr || 0, b.pages_translated || 0, b.pipeline_auto?.reason || b.pipeline_auto?.attention_reason || b.pipeline_auto?.hold?.reason || null]),
    };
    if (!DRY) fs.appendFileSync(path.join(STATE, 'ticks.jsonl'), JSON.stringify(row) + '\n');
    console.log(`${row.t} $${row.spend_usd} rows=${row.spend_rows}${spend.meterError ? ' METER ERROR ' + spend.meterError : ''} ocr=${row.pages.ocr}/${row.pages.count} tr=${row.pages.translated} ${JSON.stringify(byStatus)}`);

    // ── cap brake ──
    const blockedFile = path.join(STATE, 'BLOCKED');
    if (spend.usd >= CAP_USD && !fs.existsSync(blockedFile)) {
      const open = books.filter((b) => !TERMINAL.has(b.pipeline_auto?.status));
      const results = [];
      for (const b of open) {
        if (DRY) { results.push([b.id, 'dry_run']); continue; }
        const r = await holdBook(db, b.id, { reason: 'quality-round-1-cap', issue: ISSUE, release: `quality round 1 envelope reached $${CAP_USD} of $${BUDGET_USD}; release only with a new approval on #${ISSUE}`, source: 'quality-round-1-watch' });
        results.push([b.id, r.outcome]);
      }
      if (!DRY) {
        fs.writeFileSync(blockedFile, JSON.stringify({ t: row.t, spend_usd: row.spend_usd, held: results }, null, 1));
        gh(`**BLOCKED — cap brake.** Measured envelope spend $${row.spend_usd.toFixed(2)} reached the $${CAP_USD} brake (cap $${BUDGET_USD}). Held ${results.filter((r) => r[1] === 'held').length} unfinished round books (\`quality-round-1-cap\`); in-flight batches finish. Needs Derek: raise the cap or judge what finished.`);
      }
    }

    // ── progress comment every ~6 h ──
    const lastFile = path.join(STATE, 'last-comment');
    const last = fs.existsSync(lastFile) ? Number(fs.readFileSync(lastFile, 'utf8')) : 0;
    if (!DRY && (FORCE_COMMENT || Date.now() - last >= COMMENT_EVERY_MS)) {
      const statusLine = ORDER.filter((s) => byStatus[s]).map((s) => `${s} ${byStatus[s]}`).join(' · ');
      const reasons = {};
      for (const b of books) if (['needs_attention', 'failed', 'parked', 'held'].includes(b.pipeline_auto?.status)) {
        const r = String(b.pipeline_auto?.reason || b.pipeline_auto?.attention_reason || b.pipeline_auto?.hold?.reason || 'unrecorded').replace(/\d+\/\d+ \([\d.]+%\)/, 'N/M').slice(0, 80);
        reasons[r] = (reasons[r] || 0) + 1;
      }
      const body = [
        `**Progress ${row.t.slice(0, 16)}Z** (watcher tick, automatic)`,
        '',
        `- Books by status (${books.length}): ${statusLine}`,
        `- Pages: OCR ${row.pages.ocr.toLocaleString('en')} / ${row.pages.count.toLocaleString('en')} · translated ${row.pages.translated.toLocaleString('en')}`,
        `- Envelope spend (both meter stores, by book id since ${since.toISOString().slice(0, 16)}Z): **$${row.spend_usd.toFixed(2)} / $${BUDGET_USD}** (${row.spend_rows} usage rows${spend.meterError ? `; METER ERROR: ${spend.meterError}` : ''}). Global dial $${row.dial_usd}/day.`,
        Object.keys(reasons).length ? `- Off the line: ${Object.entries(reasons).map(([k, v]) => `${v}× ${k}`).join('; ')}` : '',
      ].filter(Boolean).join('\n');
      gh(body);
      fs.writeFileSync(lastFile, String(Date.now()));
    }
  });
} finally {
  fs.rmSync(lockFile, { force: true });
}

function gh(body) {
  try {
    execFileSync('gh', ['issue', 'comment', String(ISSUE), '--repo', 'Embassy-of-the-Free-Mind/sourcelibrary-v2', '--body', body], { stdio: ['ignore', 'inherit', 'inherit'] });
  } catch (e) { console.error('gh comment failed:', e.message); }
}
