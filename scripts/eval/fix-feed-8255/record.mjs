#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/backfill-test-verdicts.mjs and scripts/eval/paired-fifths-check.mjs (both call
 * recordPageVerdicts for their own evidence shape; neither reads the fix-feed reader's verdict files). This is only the
 * adapter from READER.md's output to recordPageVerdicts (scripts/lib/book-checks.mjs); it holds no rule of its own.
 *
 * record.mjs — the fix-feed-8255 reads into book_checks, one row per book.
 *
 *   node --env-file=… scripts/eval/fix-feed-8255/record.mjs --verdicts=DIR --packets=DIR --evidence=scripts/eval/fix-feed-8255/results/verdicts.jsonl.gz [--apply]
 *
 * Dry run by default. Pages whose image was not opened are left out. `judged` (the text the reader saw) is passed only
 * for pages whose packet text was not cut, so a hash is never taken of a truncated text. Write-once: a rerun adds nothing.
 * ACTUATION: a row with findings warns readers on the book page (src/lib/book-warnings.ts) and is read by
 * scripts/eval/error-zoo/labels.mjs -> repair-queue.mjs on their next run.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { MongoClient } from 'mongodb';
import { recordPageVerdicts, readMethod } from '../../lib/book-checks.mjs';

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const VERDICTS = arg('verdicts'), PACKETS = arg('packets'), EVIDENCE = arg('evidence'), RUN = arg('run', 'fix-feed-8255-2026-11-13');
const APPLY = process.argv.includes('--apply');

/** One reader page -> a recordPageVerdicts verdict, or null when the page cannot be recorded. Exported for the test. */
export function toVerdict(p, packetPage) {
  if (p.image_opened !== true || !['clean', 'minor', 'serious'].includes(p.outcome)) return null;
  const wrong = p.right_page === 'no';
  const errors = p.outcome === 'serious' ? (p.errors || []).map((e) => ({ stage: e.stage, ...(e.kind ? { kind: e.kind } : {}), ...(e.problem?.trim() ? { problem: e.problem.trim() } : {}) })) : [];
  if (p.outcome === 'serious' && !errors.length && !wrong) return null;
  const cut = !packetPage || packetPage.ocr_truncated || packetPage.translation_truncated;
  return {
    page_id: p.page_id, outcome: p.outcome, page_verdict: p.outcome === 'serious' ? 'fix' : p.outcome === 'minor' ? 'caveat' : 'show',
    verdict: `${p.prior || 'none'}/${p.confidence || 'unstated'}`, note: p.note,
    ...(wrong && p.outcome === 'serious' ? { wrong_page: true } : {}), errors,
    ...(cut ? {} : { judged: { ocr: packetPage.ocr ?? '', translation: packetPage.translation ?? '' } }),
  };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  if (!VERDICTS || !PACKETS || !EVIDENCE) { console.error('usage: record.mjs --verdicts=DIR --packets=DIR --evidence=REPO_PATH [--run=ID] [--apply]'); process.exit(2); }
  const files = fs.readdirSync(VERDICTS).filter((f) => f.endsWith('.json')).sort();
  const lines = [], byReader = new Map(), skipped = [];
  for (const f of files) {
    const v = JSON.parse(fs.readFileSync(path.join(VERDICTS, f), 'utf8'));
    const packet = JSON.parse(fs.readFileSync(path.join(PACKETS, v.book_id, 'packet.json'), 'utf8'));
    const pp = new Map(packet.pages.map((x) => [x.page_id, x]));
    lines.push(JSON.stringify(v));
    for (const p of v.pages) {
      const out = toVerdict(p, pp.get(p.page_id));
      if (!out) { skipped.push(`${v.book_id} p${p.page_number}`); continue; }
      const m = v.reader_model || 'claude-opus-5-5';
      if (!byReader.has(m)) byReader.set(m, []);
      byReader.get(m).push(out);
    }
  }
  const abs = path.resolve(EVIDENCE);
  if (APPLY || !fs.existsSync(abs)) fs.writeFileSync(abs, zlib.gzipSync(lines.join('\n') + '\n'));
  const method = readMethod('fix-feed-8255');
  const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
  const db = client.db('bookstore');
  let ins = 0, already = 0; const failed = [];
  for (const [model, verdicts] of byReader) {
    const r = await recordPageVerdicts(db, {
      method_id: 'fix-feed-8255', method_version: method.version, run_id: RUN, checked_at: new Date(), selection: 'picked', stages: ['ocr', 'translation'],
      reader: { kind: 'model', model, image_opened: true }, evidence_path: EVIDENCE, reader_warning: true,
      frame: { issue: 8255, of: 'visible books whose latest image-opened check is fix' }, verdicts,
    }, { apply: APPLY });
    ins += r.inserted; already += r.already; failed.push(...r.failed);
    if (!APPLY) { const by = {}; for (const row of r.rows) by[row.verdict] = (by[row.verdict] || 0) + 1; console.log(model, 'rows', r.rows.length, JSON.stringify(by)); }
  }
  await client.close();
  console.log(JSON.stringify({ apply: APPLY, books: files.length, inserted: ins, already, failed, skipped }, null, 1));
  if (failed.length) process.exit(1);
}
