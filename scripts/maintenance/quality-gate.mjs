#!/usr/bin/env node
// PRIOR ART: /root/translate-next/s1-sample.mjs, s1-screen.mjs, resize.cjs (Hetzner, translate-next-5467
// STEP 1, not in the repo) — the one-off spot check this makes standing; scripts/eval/ judge packets read
// pages by a model, which this protocol deliberately does not ($0, by eye). The library half is
// scripts/lib/quality-gate.mjs (record, brake, cadence) and scripts/lib/quality-gate-screens.mjs.
/**
 * quality-gate — run and record the standing by-eye quality gate (#5826; decision 8 of
 * .claude/docs/pipeline-next-step.md, decided by Derek 2026-10-10).
 *
 *   status  [--step=ocr|translate]
 *       Last gate, books through the lane since, ok/due/overdue, and the NO-GO brake. Read-only.
 *
 *   prepare --step=S --out=DIR [--seed=N] [--books-file=F[,F2]] [--from=ISO] [--to=ISO] [--label=L]
 *       Read-only, $0. Resolves the window (default: since the last gate's window end, to now; with
 *       --books-file, a COHORT: those books' lane output in [from, to)), runs the mechanical screens over
 *       every page of the window (DIR/screens.json + screens-summary.json), draws the by-eye sample
 *       (10 books stratified by language, 3 consecutive pages each; DIR/sample.json), and writes for each
 *       sampled book DIR/<book>.txt (OCR and English per page) beside the page images
 *       (DIR/<book>_<page>.jpg, plus .top/.bot halves for reading). A person then reads image → OCR →
 *       English, labels each claim read-from-image / read-from-text, and classifies defects with
 *       .claude/docs/page-error-taxonomy.md.
 *
 *   record  --step=S --verdict=GO|NO-GO --by="Name" --sample=DIR/sample.json [--screens=DIR/screens-summary.json]
 *           [--failure-classes=O6:3,T7:1] [--findings=FILE.json] [--fix="what changed"] [--notes="…"] [--dry-run]
 *       Writes one `quality_gates` row. NO-GO ALSO sets processing_control.lane_budgets.<S>.enrol_paused
 *       (versioned) and pushes ntfy (high). That flag is read by every unattended enroler of the step —
 *       translate: translate-batch-worker --chained --enrol/--enrol-auto (cron :23 hourly), orchestrator
 *       Phase 4 and translate-worker self-dispatch (scheduler, every 2–5 min); ocr: orchestrator Phase 1.5
 *       and Phase 2 (scheduler, every 2–5 min). A GO that lifts a NO-GO must name the fix and come from a
 *       person. --findings JSON may carry { failure_classes: [{ code, pages, books, severity, note }],
 *       pages: [...] }; its failure_classes win over --failure-classes.
 *
 *   drill   --step=test-<name> [--no-push]
 *       The NO-GO path end to end on a TEST step: records NO-GO, shows the brake answer paused, runs the
 *       chained lane's real --enrol-auto entry (dry run, $0) with QUALITY_GATE_DRILL_STEP so it asks the
 *       test step too and must refuse, checks the ntfy topic for the push, records the GO, shows enrolment
 *       open again, then deletes the drill rows and the test lane key.
 *
 * Usage: node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/quality-gate.mjs <cmd> …
 * No model calls in any command.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import {
  GATE_STEPS, SAMPLE_BOOKS, RUN_PAGES, GATES_COLLECTION, NTFY_TOPIC, assertStep, isTestStep,
  gateStatus, lastGate, windowStartAfter, windowBooks, enrolBrake, recordGate, parseFailureClasses, driverGate,
} from '../lib/quality-gate.mjs';
import { screenTranslatedPage, screenOcrPage, summariseScreens, drawSample, median } from '../lib/quality-gate-screens.mjs';
import { transcriptionBody } from '../lib/blank-page-guard.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const cmd = argv[0];
const arg = (k) => { const a = argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const has = (k) => argv.includes(`--${k}`);

async function resolveWindow(db, step) {
  const to = arg('to') ? new Date(arg('to')) : new Date();
  const files = arg('books-file');
  if (files) {
    const bookIds = [...new Set(files.split(',').flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean)))];
    const from = arg('from') ? new Date(arg('from')) : null;
    const entries = await windowBooks(db, step, { from, to, bookIds });
    return { label: arg('label') || `cohort ${files}`, kind: 'cohort', from, to, books_listed: bookIds.length, entries };
  }
  const last = await lastGate(db, step);
  const from = arg('from') ? new Date(arg('from')) : windowStartAfter(last);
  if (!from) throw new Error(`no gate recorded for ${step} yet: pass --from=ISO (or --books-file) for the first window`);
  const entries = await windowBooks(db, step, { from, to });
  return { label: arg('label') || `since ${last?.id || from.toISOString()}`, kind: 'rolling', from, to, entries };
}

/** Stream the window's pages through the screens; returns per-page rows (no text kept). */
async function screenWindow(db, step, entries) {
  const bookIds = entries.map((e) => e.book_id);
  const books = new Map((await db.collection('books').find({ id: { $in: bookIds } }, { projection: { id: 1, language: 1, title: 1 } }).toArray()).map((b) => [b.id, b]));
  const rows = [];
  if (step === 'translate') {
    const runIds = entries.flatMap((e) => e.runs || []);
    const cur = db.collection('pages').find(
      { book_id: { $in: bookIds }, 'translation.engine.run.job_id': { $in: runIds } },
      { projection: { id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1 } },
    ).batchSize(500);
    for await (const p of cur) {
      const s = screenTranslatedPage({ ocr: p.ocr?.data, translation: p.translation?.data, language: books.get(p.book_id)?.language });
      rows.push({ id: p.id, book: p.book_id, pg: p.page_number, ...s });
    }
  } else {
    const jobIds = entries.flatMap((e) => e.runs || []);
    const pageIds = [];
    for (let i = 0; i < jobIds.length; i += 500) {
      const jobs = await db.collection('batch_jobs').find({ id: { $in: jobIds.slice(i, i + 500) } }, { projection: { page_ids: 1 } }).toArray();
      for (const j of jobs) pageIds.push(...(j.page_ids || []));
    }
    const ids = [...new Set(pageIds)];
    const raw = [];
    for (let i = 0; i < ids.length; i += 1000) {
      const pages = await db.collection('pages').find({ id: { $in: ids.slice(i, i + 1000) } }, { projection: { id: 1, book_id: 1, page_number: 1, 'ocr.data': 1 } }).toArray();
      for (const p of pages) raw.push({ id: p.id, book: p.book_id, pg: p.page_number, len: transcriptionBody(p.ocr?.data || '').length, ocr: p.ocr?.data });
    }
    const med = new Map();
    for (const r of raw) (med.get(r.book) || med.set(r.book, []).get(r.book)).push(r.len);
    for (const [b, xs] of med) med.set(b, median(xs));
    for (const r of raw) {
      const s = screenOcrPage({ ocr: r.ocr, language: books.get(r.book)?.language, bookMedian: med.get(r.book) });
      rows.push({ id: r.id, book: r.book, pg: r.pg, ...s });
    }
  }
  return { rows, books };
}

const imageUrlOf = (p) => p.ocr?.source_url || p.cropped_photo || p.archived_photo || p.photo || null;

async function fetchImages(sample, db, out) {
  const sharp = (await import('sharp')).default;
  for (const s of sample) {
    const pages = await db.collection('pages').find({ id: { $in: s.page_ids } }, { projection: { id: 1, page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.source_url': 1, 'translation.data': 1, 'translation.model': 1, archived_photo: 1, cropped_photo: 1, photo: 1 } }).toArray();
    pages.sort((a, b) => a.page_number - b.page_number);
    const book = await db.collection('books').findOne({ id: s.book_id }, { projection: { title: 1, author: 1, year: 1, published: 1, language: 1 } });
    let txt = `BOOK ${s.book_id} | ${book?.language} | ${book?.title} | ${book?.author || ''} ${book?.year || book?.published || ''}\n`;
    s.images = [];
    for (const p of pages) {
      const url = imageUrlOf(p);
      txt += `\n================ PAGE ${p.page_number} (page id ${p.id}) image: ${url}\nOCR model: ${p.ocr?.model} | translation model: ${p.translation?.model}\n---------------- OCR ----------------\n${p.ocr?.data || ''}\n---------------- ENGLISH ----------------\n${p.translation?.data || ''}\n`;
      if (!url) { s.images.push(null); continue; }
      const base = path.join(out, `${s.book_id}_${p.page_number}`);
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const m = await sharp(buf).metadata();
        await sharp(buf).resize({ width: Math.min(m.width, 1400) }).jpeg({ quality: 85 }).toFile(`${base}.jpg`);
        const h = Math.floor(m.height / 2);
        await sharp(buf).extract({ left: 0, top: 0, width: m.width, height: h }).resize({ width: Math.min(m.width, 1600) }).jpeg({ quality: 85 }).toFile(`${base}.top.jpg`);
        await sharp(buf).extract({ left: 0, top: h, width: m.width, height: m.height - h }).resize({ width: Math.min(m.width, 1600) }).jpeg({ quality: 85 }).toFile(`${base}.bot.jpg`);
        s.images.push({ page_id: p.id, url, file: `${base}.jpg` });
      } catch (e) {
        s.images.push({ page_id: p.id, url, error: e.message });
      }
    }
    fs.writeFileSync(path.join(out, `${s.book_id}.txt`), txt);
  }
}

async function cmdStatus(db) {
  const steps = arg('step') ? [assertStep(arg('step'))] : GATE_STEPS;
  for (const step of steps) {
    const st = await gateStatus(db, step);
    const d = driverGate(st);
    console.log(`${step}: ${st.state.toUpperCase()}${st.reason ? ` (${st.reason})` : ''} — ${st.books} books through the lane since ${st.window_from ? st.window_from.toISOString() : '(no gate: last 7 days shown)'}`);
    console.log(`  last gate: ${st.last_gate ? `${st.last_gate.id} ${st.last_gate.verdict} by ${st.last_gate.by} at ${new Date(st.last_gate.at).toISOString()}` : 'none'}`);
    console.log(`  enrol_paused: ${st.enrol_paused ? JSON.stringify(st.enrol_paused) : 'no'}  →  standing driver would: ${d.enrol ? 'enrol' : `IDLE (${d.reason})`}`);
  }
}

async function cmdPrepare(db) {
  const step = assertStep(arg('step'));
  if (isTestStep(step)) throw new Error('prepare reads a real lane; a test step has no window');
  const out = arg('out');
  if (!out) throw new Error('--out=DIR is required');
  fs.mkdirSync(out, { recursive: true });
  const seed = Number(arg('seed') || Date.now() % 1e6);
  const w = await resolveWindow(db, step);
  console.log(`window ${w.label}: ${w.entries.length} books (${w.from ? w.from.toISOString() : '…'} → ${w.to.toISOString()})`);
  const { rows, books } = await screenWindow(db, step, w.entries);
  const summary = summariseScreens(rows);
  fs.writeFileSync(path.join(out, 'screens.json'), JSON.stringify(rows));
  fs.writeFileSync(path.join(out, 'screens-summary.json'), JSON.stringify(summary, null, 1));
  console.log(`screens: ${summary.pages} pages in ${summary.books} books; flagged ${summary.flagged_pages} pages ${JSON.stringify(summary.by_flag)}`);
  const pagesByBook = new Map();
  for (const r of rows) (pagesByBook.get(r.book) || pagesByBook.set(r.book, []).get(r.book)).push({ id: r.id, page_number: r.pg, ol: r.ol });
  const sample = drawSample([...books.values()].map((b) => ({ id: b.id, language: b.language })), pagesByBook, { seed, nBooks: SAMPLE_BOOKS, runLen: RUN_PAGES });
  await fetchImages(sample, db, out);
  const window = { label: w.label, kind: w.kind, from: w.from, to: w.to, books: w.entries.length, pages: summary.pages, ...(w.books_listed ? { books_listed: w.books_listed } : {}) };
  fs.writeFileSync(path.join(out, 'sample.json'), JSON.stringify({ step, seed, window, sample }, null, 1));
  for (const s of sample) console.log(`  ${s.book_id}  ${String(s.language).slice(0, 20).padEnd(20)} pp ${s.page_numbers.join(',')}${s.consecutive ? '' : ' (no consecutive run)'}  images ${s.images.filter((i) => i?.file).length}/${s.images.length}`);
  console.log(`wrote ${out}/sample.json, screens.json, screens-summary.json, <book>.txt and page images. Read them, then: quality-gate.mjs record --step=${step} --sample=${out}/sample.json --screens=${out}/screens-summary.json --verdict=… --by=…`);
}

async function cmdRecord(db) {
  const step = assertStep(arg('step'));
  const sampleFile = arg('sample') ? JSON.parse(fs.readFileSync(arg('sample'), 'utf8')) : null;
  const findings = arg('findings') ? JSON.parse(fs.readFileSync(arg('findings'), 'utf8')) : null;
  const rec = {
    step,
    verdict: arg('verdict'),
    by: arg('by'),
    fix: arg('fix'),
    notes: arg('notes'),
    seed: sampleFile?.seed ?? null,
    window: sampleFile?.window ?? null,
    sample_ids: (sampleFile?.sample || []).map((s) => ({ book_id: s.book_id, language: s.language, page_ids: s.page_ids, page_numbers: s.page_numbers })),
    failure_classes: findings?.failure_classes ?? parseFailureClasses(arg('failure-classes')),
    screens: arg('screens') ? JSON.parse(fs.readFileSync(arg('screens'), 'utf8')) : null,
    findings: findings?.pages ? { pages: findings.pages, summary: findings.summary ?? null } : null,
  };
  if (has('dry-run')) {
    const { recordProblems, enrolPausedFor } = await import('../lib/quality-gate.mjs');
    const ctl = await db.collection('system_config').findOne({ _id: 'processing_control' });
    const problems = recordProblems(rec, { pausedNow: enrolPausedFor(ctl, step) });
    console.log(problems.length ? `WOULD REFUSE:\n  ${problems.join('\n  ')}` : `would record ${rec.verdict} for ${step} (${rec.sample_ids.length} books sampled)${rec.verdict === 'NO-GO' ? ' and pause enrolment' : ''} — DRY RUN, nothing written`);
    return;
  }
  const { gate, problems } = await recordGate(db, rec, { push: has('no-push') ? async () => ({ ok: false, error: 'skipped (--no-push)' }) : undefined });
  if (problems.length) { console.error(`REFUSED:\n  ${problems.join('\n  ')}`); process.exitCode = 2; return; }
  console.log(JSON.stringify({ id: gate.id, step: gate.step, verdict: gate.verdict, actuation: gate.actuation }, null, 1));
  if (gate.verdict === 'NO-GO') console.log(`enrolment into ${step} is now PAUSED. Readers: ${step === 'translate' ? 'translate-batch-worker --chained --enrol-auto (cron :23), orchestrator Phase 4 + translate-worker self-dispatch (scheduler)' : 'orchestrator Phase 1.5 + Phase 2 (scheduler)'} — each asks on its next run.`);
}

async function pollNtfyFor(needle, { sinceSec, tries = 6 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`${NTFY_TOPIC}/json?poll=1&since=${sinceSec}`);
      const lines = (await res.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l));
      const hit = lines.find((m) => m.event === 'message' && String(m.message || '').includes(needle));
      if (hit) return { id: hit.id, time: new Date(hit.time * 1000).toISOString(), title: hit.title, priority: hit.priority };
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 5000));
  }
  return null;
}

async function cmdDrill(db) {
  const step = arg('step') || 'test-drill';
  if (!isTestStep(step)) throw new Error(`a drill runs on a test step (test-<name>), never on ${step}`);
  const noPush = has('no-push');
  const push = noPush ? async () => ({ ok: false, error: 'skipped (--no-push)' }) : undefined;
  const t0 = Math.floor(Date.now() / 1000) - 5;
  const runEnrol = () => {
    try {
      return execFileSync(process.execPath, ['scripts/workers/translate-batch-worker.mjs', '--chained', '--enrol-auto', '--dry-run', '--limit=2'],
        { cwd: ROOT, env: { ...process.env, QUALITY_GATE_DRILL_STEP: step }, encoding: 'utf8', timeout: 300000 });
    } catch (e) { return `${e.stdout || ''}${e.stderr || ''}`; }
  };
  const report = { step };
  const nogo = await recordGate(db, { step, verdict: 'NO-GO', by: 'quality-gate drill', failure_classes: [{ code: 'O4', pages: 1, severity: 'blocking', note: 'drill' }], notes: 'drill: NO-GO path on a test step (#5826)' }, { push });
  if (nogo.problems.length) throw new Error(nogo.problems.join('; '));
  report.nogo = { id: nogo.gate.id, actuation: nogo.gate.actuation };
  report.brake_after_nogo = await enrolBrake(db, step, { log: null });
  const outPaused = runEnrol();
  report.enrol_while_paused = outPaused.split('\n').filter((l) => /ENROLMENT PAUSED|candidate|open chained|REFUSED/.test(l)).map((l) => l.trim());
  report.enrolment_stopped = /ENROLMENT PAUSED/.test(outPaused) && !/candidate\(s\)/.test(outPaused);
  report.ntfy_seen = noPush ? 'skipped' : await pollNtfyFor(nogo.gate.id, { sinceSec: t0 });
  const go = await recordGate(db, { step, verdict: 'GO', by: 'quality-gate drill', fix: 'drill: nothing to fix' }, { push });
  if (go.problems.length) throw new Error(go.problems.join('; '));
  report.go = { id: go.gate.id, actuation: go.gate.actuation };
  report.brake_after_go = await enrolBrake(db, step, { log: null });
  const outOpen = runEnrol();
  report.enrol_after_go = outOpen.split('\n').filter((l) => /ENROLMENT PAUSED|candidate\(s\)|open chained/.test(l)).map((l) => l.trim());
  report.enrolment_resumed = !/ENROLMENT PAUSED/.test(outOpen);
  // Clean up: the drill rows and the test lane key (the GO already unset lane_budgets.<step>).
  const del = await db.collection(GATES_COLLECTION).deleteMany({ step, drill: true, id: { $in: [nogo.gate.id, go.gate.id] } });
  const ctl = await db.collection('system_config').findOne({ _id: 'processing_control' });
  if (ctl?.lane_budgets && !Object.keys(ctl.lane_budgets).length) {
    const { updateConfigVersioned } = await import('../lib/versioned-config.mjs');
    await updateConfigVersioned(db, 'processing_control', { $unset: { lane_budgets: '' } }, `quality-gate drill cleanup (${step}) #5826`);
  }
  const after = await db.collection('system_config').findOne({ _id: 'processing_control' });
  report.cleanup = { gate_rows_deleted: del.deletedCount, lane_budgets_after: after?.lane_budgets ?? null };
  console.log(JSON.stringify(report, null, 1));
  if (!report.brake_after_nogo.paused || !report.enrolment_stopped || report.brake_after_go.paused || !report.enrolment_resumed || (!noPush && !report.ntfy_seen)) {
    console.error('DRILL FAILED: see the report above');
    process.exitCode = 1;
  } else console.log('DRILL PASSED');
}

async function main() {
  if (!['status', 'prepare', 'record', 'drill'].includes(cmd)) {
    console.log('Usage: quality-gate.mjs status|prepare|record|drill … (see the header)');
    process.exitCode = 2;
    return;
  }
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI not set (node --env-file=/root/sourcelibrary/.env.production.local …)');
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  try {
    const db = client.db('bookstore');
    if (cmd === 'status') await cmdStatus(db);
    if (cmd === 'prepare') await cmdPrepare(db);
    if (cmd === 'record') await cmdRecord(db);
    if (cmd === 'drill') await cmdDrill(db);
  } finally {
    await client.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
