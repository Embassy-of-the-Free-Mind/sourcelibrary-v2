#!/usr/bin/env node
/**
 * scope-progress — per-book pipeline progress for a named list of books.
 *
 * "Will everything get done, and what does each book still need?" answered from
 * OUTPUTS, not from pipeline_auto.status alone — the status field is known to
 * run ahead of the work (#3740: 28K books sat "past" enrichment with nothing to
 * show; the setPipelineStatus guard is still observe-only). A stage counts as
 * done when the book can SHOW the output or carries a recorded skip reason.
 *
 * Read-only. Safe to run any time, from anywhere with prod env.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/scope-progress.mjs                       # list scopes + global gates
 *   node --env-file=.env.production.local scripts/audit/scope-progress.mjs --scope <tag>         # books in an allow_scopes entry
 *   node --env-file=.env.production.local scripts/audit/scope-progress.mjs --collection <slug>   # books tagged with a collection
 *   node --env-file=.env.production.local scripts/audit/scope-progress.mjs --books id1,id2,...
 *   ... --verify    # recount OCR/translation from the pages collection instead of trusting book counters
 *   ... --json      # machine-readable output (for dashboards / other sessions)
 *
 * Reads the same stores the pipeline acts on: books counters (pages_archived /
 * pages_ocr / pages_translated / pages_translatable), summary, chapters,
 * detected_images_count, cover_page, and the pipeline_auto skip-reason fields.
 * Global gates come from system_config.processing_control + spend-guard.
 *
 * Known limits, on purpose:
 *   - Image extraction has no output predicate (zero images found is a legitimate
 *     result), so that stage is judged by status reaching images_complete or later.
 *   - --verify counts pages with non-empty ocr.data / translation.data. Blank pages
 *     carry a translation placeholder, so verified translation counts can read a
 *     touch high; the point of --verify is catching ZEROS behind a confident counter.
 *   - Gates: a scope without a budget envelope bypasses the PAUSE only; a scope
 *     WITH budget_usd (#4540) also opens a confined lane past the closed daily
 *     dial, on its own measured ceiling. The gates header says which ceiling is
 *     currently binding so the report never implies motion that cannot happen.
 */

import { withMongo } from '../lib/mongo.mjs';
import { getTodaySpendUsd, readDailyBudgetUsd, readScopeEnvelopes, getScopeSpendUsd } from '../lib/spend-guard.mjs';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const val = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : null; };

const BATCH_RATE_USD_PER_PAGE = 0.00079; // measured 2026-07-16, gemini_usage

// Status rank: where the state machine THINKS the book is. Used only for the
// images stage (no output predicate) and for the ahead-of-output drift check.
const STATUS_ORDER = [
  'queued', 'archiving', 'archive_complete', 'ocr_submitted', 'ocr_complete',
  'translate_submitted', 'translate_complete', 'summary_indexed', 'enriched',
  'chapters_complete', 'images_submitted', 'images_complete', 'cover_selected', 'complete',
];
const rank = (s) => STATUS_ORDER.indexOf(s);
const statusAtLeast = (s, target) => rank(s) >= rank(target) && rank(s) !== -1;

function stageReport(b, verified) {
  const pa = b.pipeline_auto || {};
  const total = b.pages_count || 0;
  const ocrDone = verified ? verified.ocr : (b.pages_ocr || 0);
  const transDone = verified ? verified.translated : (b.pages_translated || 0);
  // #4442/#4516: pages awaiting OCR belong in the translatable denominator; when the
  // canonical counter is absent fall back to total pages.
  const translatable = b.pages_translatable ?? total;

  const stages = [];
  const add = (name, done, detail, skip) => stages.push({ name, done: !!done, detail, skipped: skip || null });

  add('archive', (b.pages_archived || 0) >= total && total > 0, `${b.pages_archived || 0}/${total}`, pa.archive_skipped_reason);
  add('ocr', ocrDone >= total && total > 0, `${ocrDone}/${total}`, pa.ocr_skipped_reason);
  add('translate', translatable > 0 && transDone >= translatable, `${transDone}/${translatable}`, pa.translate_skipped_reason);
  add('summary', !!b.summary, b.summary ? 'yes' : 'none', pa.summary_skipped_reason);
  add('chapters', Array.isArray(b.chapters) && b.chapters.length > 0, `${b.chapters?.length || 0}`, pa.chapters_skipped_reason);
  add('images', statusAtLeast(pa.status, 'images_complete'), b.detected_images_count != null ? `${b.detected_images_count} found` : 'not run', pa.images_skipped_reason);
  add('cover', b.cover_page != null, b.cover_page != null ? 'yes' : 'none', pa.cover_skipped_reason);

  const satisfied = (s) => s.done || s.skipped;
  const next = stages.find((s) => !satisfied(s));
  const remaining = {
    ocr_pages: Math.max(0, total - ocrDone),
    translate_pages: Math.max(0, translatable - transDone),
  };

  // Drift: status claims a stage whose output + skip are both absent (#3740 shape).
  const CLAIM = { archive_complete: 'archive', ocr_complete: 'ocr', translate_complete: 'translate', summary_indexed: 'summary', chapters_complete: 'chapters', cover_selected: 'cover' };
  const drift = Object.entries(CLAIM)
    .filter(([st]) => statusAtLeast(pa.status, st))
    .map(([, name]) => stages.find((s) => s.name === name))
    .filter((s) => s && !satisfied(s))
    .map((s) => s.name);

  return { stages, next: next ? next.name : 'DONE', remaining, drift };
}

async function verifyFromPages(db, ids) {
  // One aggregate per metric over the whole id list — no per-book round trips.
  const out = new Map(ids.map((id) => [id, { ocr: 0, translated: 0 }]));
  // $strLenCP throws on non-strings and aggregation operators do not
  // short-circuit (known trap) — feed it a $cond that is ALWAYS a string.
  const nonEmpty = (path) => ({
    $cond: [
      { $gt: [{ $strLenCP: { $cond: [{ $eq: [{ $type: path }, 'string'] }, path, ''] } }, 0] },
      1, 0,
    ],
  });
  const rows = await db.collection('pages').aggregate([
    { $match: { book_id: { $in: ids } } },
    { $group: {
      _id: '$book_id',
      ocr: { $sum: nonEmpty('$ocr.data') },
      translated: { $sum: nonEmpty('$translation.data') },
    } },
  ]).toArray();
  for (const r of rows) out.set(r._id, { ocr: r.ocr, translated: r.translated });
  return out;
}

await withMongo(async (db) => {
  const control = (await db.collection('system_config').findOne({ _id: 'processing_control' })) || {};

  // ── Resolve the book list ─────────────────────────────────────────────
  let ids = null;
  let source = null;
  const scopeTag = val('scope');
  const collectionSlug = val('collection');
  if (scopeTag) {
    const scope = control.allow_scopes?.[scopeTag];
    if (!scope) {
      console.error(`No allow_scopes entry '${scopeTag}'. Existing: ${Object.keys(control.allow_scopes || {}).join(', ') || '(none)'}`);
      process.exit(1);
    }
    ids = [...(scope.book_ids || [])];
    for (const slug of scope.collections || []) {
      const rows = await db.collection('books').find({ collections: slug }).project({ id: 1 }).toArray();
      ids.push(...rows.map((r) => r.id));
    }
    ids = [...new Set(ids)];
    source = `scope '${scopeTag}'`;
  } else if (collectionSlug) {
    const rows = await db.collection('books').find({ collections: collectionSlug }).project({ id: 1 }).toArray();
    ids = rows.map((r) => r.id);
    source = `collection '${collectionSlug}'`;
  } else if (val('books')) {
    ids = val('books').split(',').map((s) => s.trim()).filter(Boolean);
    source = '--books list';
  }

  // ── Global gates (always shown): what can actually MOVE right now ─────
  const budget = readDailyBudgetUsd(control);
  const spend = await getTodaySpendUsd(db);
  const dialOpen = budget !== null && !spend.meterError && spend.usd < budget;
  // Envelope lanes (#4540): a scope with budget_usd can dispatch past a
  // closed global dial, on its own measured ceiling.
  const envelopes = [];
  for (const env of readScopeEnvelopes(control)) {
    const envIds = new Set(env.book_ids);
    if (env.collections.length) {
      const rows = await db.collection('books').find({ collections: { $in: env.collections } }).project({ id: 1 }).toArray();
      for (const b of rows) envIds.add(String(b.id));
    }
    const s = await getScopeSpendUsd(db, { ids: [...envIds], since: env.created_at });
    envelopes.push({
      tag: env.tag,
      budget_usd: env.budget_usd,
      spent_usd: Number(s.usd.toFixed(2)),
      books: envIds.size,
      open: !s.meterError && s.usd < env.budget_usd,
      meter_error: s.meterError || null,
    });
  }

  const gates = {
    paused: !!control.paused,
    paused_phases: control.paused_phases || [],
    daily_budget_usd: budget,
    spent_today_usd: Number(spend.usd.toFixed(2)),
    meter_error: spend.meterError || null,
    dial_open: dialOpen,
    scopes: Object.keys(control.allow_scopes || {}),
    envelopes,
    legacy_allow_book_ids: (control.allow_book_ids || []).length,
  };

  if (!ids) {
    if (flag('json')) { console.log(JSON.stringify({ gates }, null, 2)); return; }
    console.log('Global gates:');
    console.log(`  paused: ${gates.paused}${gates.paused_phases.length ? ` (phases: ${gates.paused_phases.join(', ')})` : ''}`);
    console.log(`  dial:   $${gates.spent_today_usd} spent / ${budget === null ? 'UNSET (default-closed)' : '$' + budget} today → ${dialOpen ? 'OPEN' : 'CLOSED — no paid dispatch'}${gates.meter_error ? ` [METER ERROR: ${gates.meter_error}]` : ''}`);
    console.log(`  allow_scopes: ${gates.scopes.length ? gates.scopes.join(', ') : '(none)'}  legacy allow_book_ids: ${gates.legacy_allow_book_ids}`);
    for (const e of envelopes) {
      console.log(`    envelope ${e.tag}: $${e.spent_usd}/$${e.budget_usd} → ${e.meter_error ? `METER ERROR: ${e.meter_error}` : e.open ? 'OPEN' : 'SPENT'} (${e.books} books)`);
    }
    console.log('\nPass --scope <tag>, --collection <slug>, or --books id1,id2 for per-book progress.');
    console.log('NOTE: a scope without a budget envelope bypasses the PAUSE only; an envelope (#4540) also opens a confined lane past the closed dial. Manage with scripts/maintenance/set-scope.mjs.');
    return;
  }

  const books = await db.collection('books')
    .find({ id: { $in: ids } })
    .project({
      id: 1, title: 1, resource_type: 1, visible: 1, hidden: 1, processing_priority: 1,
      pages_count: 1, pages_archived: 1, pages_ocr: 1, pages_translated: 1, pages_translatable: 1,
      summary: 1, chapters: 1, detected_images_count: 1, cover_page: 1, pipeline_auto: 1,
    })
    .toArray();
  const foundIds = new Set(books.map((b) => b.id));
  const missing = ids.filter((id) => !foundIds.has(id));
  const artworks = books.filter((b) => b.resource_type);
  const texts = books.filter((b) => !b.resource_type);

  const verified = flag('verify') ? await verifyFromPages(db, texts.map((b) => b.id)) : null;

  const reports = texts.map((b) => ({
    id: b.id,
    title: (b.title || '(untitled)').slice(0, 60),
    visible: !!b.visible,
    priority: b.processing_priority ?? null,
    status: b.pipeline_auto?.status || '(none)',
    ...stageReport(b, verified?.get(b.id)),
  })).sort((a, c) => a.next.localeCompare(c.next) || a.title.localeCompare(c.title));

  const totals = {
    books: texts.length,
    done: reports.filter((r) => r.next === 'DONE').length,
    ocr_pages_remaining: reports.reduce((s, r) => s + r.remaining.ocr_pages, 0),
    translate_pages_remaining: reports.reduce((s, r) => s + r.remaining.translate_pages, 0),
    drift_books: reports.filter((r) => r.drift.length).length,
  };
  totals.est_batch_cost_usd = Number(((totals.ocr_pages_remaining + totals.translate_pages_remaining) * BATCH_RATE_USD_PER_PAGE).toFixed(2));

  if (flag('json')) {
    console.log(JSON.stringify({ source, gates, totals, missing, artworks: artworks.map((b) => b.id), books: reports }, null, 2));
    return;
  }

  console.log(`Scope progress — ${source} (${texts.length} text books${artworks.length ? `, ${artworks.length} artwork records excluded` : ''})${verified ? ' [verified from pages]' : ' [book counters]'}`);
  const envNote = envelopes.length
    ? envelopes.map((e) => `${e.tag} $${e.spent_usd}/$${e.budget_usd} ${e.open ? 'OPEN' : 'SPENT'}`).join('; ')
    : 'none (books wait on the global dial)';
  console.log(`Gates: paused=${gates.paused}  dial ${dialOpen ? 'OPEN' : 'CLOSED'} ($${gates.spent_today_usd}/${budget === null ? 'unset' : '$' + budget})  envelopes: ${envNote}\n`);
  if (missing.length) console.log(`⚠ ${missing.length} ids not found in books (check id vs _id): ${missing.join(', ')}\n`);

  for (const r of reports) {
    const cells = r.stages.map((s) => {
      const mark = s.done ? '✓' : s.skipped ? 'skip' : '·';
      return `${s.name}:${mark}${s.done || s.skipped ? '' : `(${s.detail})`}`;
    }).join('  ');
    const flags = [
      r.visible ? '' : 'hidden',
      r.priority != null ? `p${r.priority}` : '',
      r.drift.length ? `DRIFT:${r.drift.join('+')}` : '',
    ].filter(Boolean).join(' ');
    console.log(`${r.next === 'DONE' ? '✔' : '…'} ${r.id}  ${r.title}`);
    console.log(`    status=${r.status}  next=${r.next}  ${flags}`);
    console.log(`    ${cells}`);
  }

  console.log(`\nTotals: ${totals.done}/${totals.books} complete · OCR remaining ${totals.ocr_pages_remaining} pages · translation remaining ${totals.translate_pages_remaining} pages`);
  console.log(`Estimated batch cost to finish OCR+translation: ~$${totals.est_batch_cost_usd} (at $${BATCH_RATE_USD_PER_PAGE}/page)`);
  if (totals.drift_books) console.log(`⚠ ${totals.drift_books} book(s) have status ahead of output (#3740 shape) — status claims a stage with no output and no recorded skip.`);
});
