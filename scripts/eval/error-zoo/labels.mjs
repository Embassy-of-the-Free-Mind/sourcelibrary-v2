#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/error-zoo/agg.py — reads ONE source (the spare-audit runs on disk) into rows.json; this
 * joins every page-level judgment we hold into one table so the predictor and the zoo can be trained and counted per
 * source. scripts/eval/estimator/pooled-quality/build-table.mjs — pools book_checks into BOOK rates for the quality
 * estimator; it does not keep per-page findings or the text they judged. scripts/lib/book-checks.mjs — the store.
 *
 * labels.mjs — every page-level "serious error / clean" judgment we hold, one row per (source, page), to
 * <out>/labels.jsonl. Read-only against Mongo. Sources:
 *
 *   book_checks      page_findings per pages_read (image-opened model readers, 19 methods). serious = the page has
 *                    an entry in page_findings. text_provenance gives page_id and the text's updated_at at check time;
 *                    `stale` is set when the live page's ocr/translation updated_at is later (the label is of text
 *                    nobody serves any more).
 *   spare_audit      /root/jobs/spare-audit/<run>/ on gex45-1: the #6420 lane-D convergent audit, Opus reader. serious =
 *                    any finding with severity 'serious' or right_page = 'no' (convergent-audit-lib isSeriousPage).
 *                    Every finding is kept with its severity so the zoo can count the minor tail. The text judged is in
 *                    the packet, so `ocr_text`/`translation` here are the judged text, not the live one.
 *   lane_judge       lane_judge_verdicts whose arm is the SERVED text (arms contains 'served' or route *stored*).
 *                    serious = accept === false || fidelity <= 3.
 *   correction       page_corrections with status applied / partially_applied: a positive label only (someone changed
 *                    the text after reading the image). No negatives come from this source.
 *
 * Row: { source, method, run_id, reader, book_id, page_id, page_number, exposure, selection, judged_at, serious,
 *        errors: [{stage, class, kind, severity, problem, bad, good}], scores, ocr_model_at_check, stale,
 *        ocr_text?, translation? (spare_audit only) }
 *
 * Usage: node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/error-zoo/labels.mjs <outdir>
 *        [--spare-audit /root/jobs/spare-audit]
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { kindOfFinding } from '../../lib/review-vocabulary.mjs';
import { verdictQuery } from '../lib/judge-rows.mjs';

const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith('--'));
if (!out) { console.error('usage: labels.mjs <outdir> [--spare-audit <dir>]'); process.exit(1); }
const saDir = args.includes('--spare-audit') ? args[args.indexOf('--spare-audit') + 1] : '/root/jobs/spare-audit';
fs.mkdirSync(out, { recursive: true });
const w = fs.createWriteStream(path.join(out, 'labels.jsonl'));
const emit = (r) => w.write(JSON.stringify(r) + '\n');
const counts = {};
const bump = (k) => { counts[k] = (counts[k] || 0) + 1; };

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const iso = (d) => (d instanceof Date ? d.toISOString() : d ? String(d) : null);

// ---- 1. book_checks -------------------------------------------------------------------------------------------
{
  const cur = db.collection('book_checks').find({ page_findings: { $type: 'array' } }, {
    projection: { book_id: 1, method_id: 1, run_id: 1, reader: 1, pages_read: 1, exposure: 1, frame: 1, checked_at: 1, page_findings: 1, text_provenance: 1, verdict: 1, reader_warning: 1 },
  }).batchSize(1000);
  const pageIds = new Set();
  const rows = [];
  for await (const c of cur) {
    const prov = new Map((c.text_provenance || []).map((t) => [t.page_number, t]));
    const expo = new Map((c.exposure || []).map((e) => [e.page_number, e.exposure]));
    const pf = new Map((c.page_findings || []).map((f) => [f.page_number, f]));
    for (const pn of c.pages_read || []) {
      const t = prov.get(pn) || {};
      const f = pf.get(pn);
      const errors = (f?.errors || []).map((e) => ({ stage: e.stage ?? null, class: e.class ?? null, kind: kindOfFinding(e), severity: 'serious', problem: e.problem ?? null, bad: e.quote ?? null, good: null }));
      if (f?.wrong_page && !errors.some((e) => e.kind === 'wrong_leaf')) errors.push({ stage: 'other', class: 'I1', kind: 'wrong_leaf', severity: 'serious', problem: 'wrong page (page_findings.wrong_page)', bad: null, good: null });
      const row = {
        source: 'book_checks', method: c.method_id, run_id: c.run_id, reader: `${c.reader?.kind}:${c.reader?.model ?? c.reader?.role ?? '?'}`,
        book_id: c.book_id, page_id: t.page_id ?? null, page_number: pn, exposure: expo.get(pn) ?? 'unrecorded', selection: c.frame?.selection ?? null,
        judged_at: iso(c.checked_at), serious: !!f, errors, scores: null, ocr_model_at_check: t.ocr_model ?? null, tr_model_at_check: t.translation_model ?? null,
        ocr_updated_at_check: iso(t.ocr_updated_at), tr_updated_at_check: iso(t.translation_updated_at), tr_hash_at_check: t.translation_content_hash ?? null,
        reader_warning: c.reader_warning ?? null, stale: null,
      };
      rows.push(row);
      if (row.page_id) pageIds.add(row.page_id);
    }
  }
  // staleness: compare live updated_at with the check's
  const live = new Map();
  const ids = [...pageIds];
  for (let i = 0; i < ids.length; i += 2000) {
    const batch = ids.slice(i, i + 2000);
    const docs = await db.collection('pages').find({ $or: [{ id: { $in: batch } }, { _id: { $in: batch } }] }, { projection: { id: 1, 'ocr.updated_at': 1, 'translation.updated_at': 1, 'translation.content_hash': 1 } }).toArray();
    for (const d of docs) live.set(d.id ?? String(d._id), d);
  }
  const later = (a, b) => a && b && new Date(a).getTime() > new Date(b).getTime() + 1000;
  for (const r of rows) {
    const d = r.page_id ? live.get(r.page_id) : null;
    if (!d) r.stale = r.page_id ? 'page_missing' : 'no_page_id';
    else {
      const ocrStale = later(d.ocr?.updated_at, r.ocr_updated_at_check);
      const trStale = r.tr_hash_at_check && d.translation?.content_hash ? d.translation.content_hash !== r.tr_hash_at_check : later(d.translation?.updated_at, r.tr_updated_at_check);
      r.stale = ocrStale ? 'ocr' : trStale ? 'translation' : false;
    }
    emit(r); bump(`book_checks/${r.stale ? 'stale' : 'fresh'}`);
  }
}

// ---- 2. spare audits on disk ----------------------------------------------------------------------------------
if (fs.existsSync(saDir)) {
  const runs = fs.readdirSync(saDir).filter((d) => /^spare-audit-\d{8}-\d+$/.test(d) && fs.existsSync(path.join(saDir, d, 'draw.json'))).sort();
  const want = new Map(); // (book_id|page_number) -> rows awaiting page_id
  for (const run of runs) {
    const base = path.join(saDir, run);
    const draw = JSON.parse(fs.readFileSync(path.join(base, 'draw.json'), 'utf8'));
    const byPacket = new Map(draw.pages.map((p) => [p.packet, p]));
    const revDir = path.join(base, 'readers', 'opus', 'reviews');
    if (!fs.existsSync(revDir)) continue;
    for (const f of fs.readdirSync(revDir).filter((x) => x.endsWith('.json'))) {
      const packet = f.replace(/\.json$/, '');
      const d = byPacket.get(packet); if (!d) continue;
      const rev = JSON.parse(fs.readFileSync(path.join(revDir, f), 'utf8'))[0];
      const pk = JSON.parse(fs.readFileSync(path.join(base, 'packets', f), 'utf8'))[0];
      const pkPage = pk.pages?.[0] || {};
      const p = rev?.pages?.[0]; if (!p) continue;
      const errors = [];
      for (const [key, stage] of [['ocr_errors', 'ocr'], ['tr_errors', 'translation'], ['other', 'other']]) {
        for (const e of p[key] || []) {
          errors.push({ stage, class: e.class ?? null, kind: kindOfFinding(e), severity: e.severity ?? null, problem: e.problem ?? e.note ?? null,
            bad: stage === 'ocr' ? e.ocr ?? null : stage === 'translation' ? e.english ?? null : null,
            good: stage === 'ocr' ? e.image ?? null : stage === 'translation' ? e.source ?? null : null });
        }
      }
      const serious = errors.some((e) => e.severity === 'serious') || p.right_page === 'no';
      if (p.right_page === 'no' && !errors.some((e) => e.kind === 'wrong_leaf')) errors.push({ stage: 'other', class: 'I1', kind: 'wrong_leaf', severity: 'serious', problem: 'reader: not the right page', bad: null, good: null });
      const row = {
        source: 'spare_audit', method: 'convergent-audit-weekly', run_id: run, reader: 'model:claude-opus (spare-audit brief #6338)',
        book_id: d.book_id, page_id: null, page_number: d.page_number, exposure: d.exposure ?? 'unrecorded', selection: d.stratum === 'random' ? 'random' : 'lane-b-written',
        judged_at: draw.drawn_at, serious, errors, scores: { ocr: p.ocr_score ?? null, tr: p.tr_score ?? null, confidence: p.confidence ?? null }, ocr_model_at_check: d.ocr_model ?? null,
        stale: false, image_file: pkPage.image_file ? path.join(base, pkPage.image_file) : null, ocr_text: pkPage.ocr ?? null, translation: pkPage.translation ?? null,
        language: d.language ?? pk.book?.language ?? null, published: pk.book?.published ?? null,
      };
      const k = `${d.book_id}|${d.page_number}`;
      if (!want.has(k)) want.set(k, []);
      want.get(k).push(row);
    }
  }
  // page ids by (book_id, page_number)
  const keys = [...want.keys()];
  for (let i = 0; i < keys.length; i += 500) {
    const batch = keys.slice(i, i + 500).map((k) => { const [b, n] = k.split('|'); return { book_id: b, page_number: Number(n) }; });
    const docs = await db.collection('pages').find({ $or: batch }, { projection: { id: 1, book_id: 1, page_number: 1, 'ocr.updated_at': 1, 'translation.updated_at': 1 } }).toArray();
    for (const d of docs) for (const r of want.get(`${d.book_id}|${d.page_number}`) || []) {
      r.page_id = d.id ?? String(d._id);
      // the packet text is what was judged; mark stale if the live text moved after the draw
      const later = (a) => a && new Date(a).getTime() > new Date(r.judged_at).getTime() + 1000;
      r.stale = later(d.ocr?.updated_at) ? 'ocr' : later(d.translation?.updated_at) ? 'translation' : false;
    }
  }
  for (const rows of want.values()) for (const r of rows) { emit(r); bump(`spare_audit/${r.stale ? 'stale' : 'fresh'}`); }
}

// ---- 3. lane_judge_verdicts on the served arm ---------------------------------------------------------------
{
  // live verdicts only: verdictQuery() drops origin:test rows (#7263); a label of a test arm is not a label of what readers see
  const cur = db.collection('lane_judge_verdicts').find(verdictQuery({ $or: [{ arms: 'served' }, { route: /stored|served/ }] }), { projection: { book_id: 1, page_id: 1, page_number: 1, verdict: 1, judge: 1, judged_at: 1, run_id: 1, lane: 1, task: 1, route: 1, lang: 1 } }).batchSize(1000);
  for await (const v of cur) {
    const vd = v.verdict || {};
    const serious = vd.accept === false || (typeof vd.fidelity === 'number' && vd.fidelity <= 3) || vd.wrong_text === true;
    const errors = (vd.defects || []).map((e) => ({ stage: v.task ?? 'ocr', class: e.class ?? null, kind: kindOfFinding(e), severity: e.severity === 'cosmetic' ? 'minor' : e.severity === 'misleads' ? 'moderate' : 'serious', problem: e.what ?? null, bad: e.quote ?? null, good: e.print ?? null }));
    emit({ source: 'lane_judge', method: v.lane ?? 'lane-judge', run_id: v.run_id, reader: `model:${v.judge?.model_reported ?? v.judge?.by ?? '?'}`, book_id: v.book_id, page_id: v.page_id, page_number: v.page_number,
      exposure: 'served', selection: null, judged_at: iso(v.judged_at), serious, errors, scores: { fidelity: vd.fidelity ?? null, accept: vd.accept ?? null }, ocr_model_at_check: null, stale: null, language: v.lang ?? null });
    bump('lane_judge');
  }
}

// ---- 4. applied corrections (positives only) ----------------------------------------------------------------
{
  const cur = db.collection('page_corrections').find({ status: { $in: ['applied', 'partially_applied'] } }, { projection: { book_id: 1, page_id: 1, page_number: 1, field: 1, note: 1, via: 1, created_at: 1, reviewed_by: 1, edits: 1 } }).batchSize(1000);
  for await (const pc of cur) {
    emit({ source: 'correction', method: `page_corrections:${pc.via ?? '?'}`, run_id: null, reader: `human-or-job:${pc.reviewed_by ?? '?'}`, book_id: pc.book_id, page_id: pc.page_id, page_number: pc.page_number,
      exposure: 'served', selection: 'picked', judged_at: iso(pc.created_at), serious: true, errors: [{ stage: pc.field, class: null, kind: null, severity: 'serious', problem: (pc.note ?? '').slice(0, 400), bad: (pc.edits?.[0]?.find ?? '').slice(0, 240), good: (pc.edits?.[0]?.replace ?? '').slice(0, 240) }],
      scores: null, ocr_model_at_check: null, stale: null, positive_only: true });
    bump('correction');
  }
}

await new Promise((r) => w.end(r));
await client.close();
console.log(JSON.stringify(counts, null, 1));
console.log('wrote', path.join(out, 'labels.jsonl'));
