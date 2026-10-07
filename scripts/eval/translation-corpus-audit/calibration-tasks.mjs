#!/usr/bin/env node
// PRIOR ART: scripts/maintenance/build-page-check-candidates.mjs `translations` campaign — draws its OWN random
// page per book and queues it; it cannot target pages that already carry a machine-judge verdict. This turns the
// corpus-audit draw (#5274) into translation-check tasks, so every reader verdict on them can be compared with the
// Opus judge's verdict on the same page — the judge-vs-human calibration the audit could not do alone.
//
// Writes a --file tasks JSON for build-page-check-candidates.mjs; it queues nothing itself.
//
//   node --env-file=.env.production.local scripts/eval/translation-corpus-audit/calibration-tasks.mjs \
//        --dir scripts/eval/results/translation-corpus-audit-2026-09-30 --out calibration-tasks.json [--exclude-leaf-mismatch ids.txt]
//   node --env-file=.env.production.local scripts/maintenance/build-page-check-candidates.mjs --file calibration-tasks.json [--apply]
//
// Campaign label "Judge calibration — <language>"; item_id `trans:<language>:<pages.id>` (same shape as the
// translations campaign, so the /check/<token> page and the per-language rollup read it unchanged).

import fs from 'node:fs';
import path from 'node:path';
import { MongoClient, ObjectId } from 'mongodb';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));
const DIR = args.dir, OUT = args.out || 'calibration-tasks.json';
if (!DIR) { console.error('--dir required'); process.exit(1); }
const SITE = 'https://sourcelibrary.org';
const exclude = new Set(args['exclude-leaf-mismatch'] ? fs.readFileSync(args['exclude-leaf-mismatch'], 'utf8').split(/\s+/).filter(Boolean) : []);

const manifest = fs.readFileSync(path.join(DIR, 'manifest.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((m) => m.kind === 'main');
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');

const rows = []; let skipped = 0;
for (const m of manifest) {
  if (exclude.has(m.id) || exclude.has(m.page_id)) { skipped++; continue; }
  // The reader route /book/<slug>/page/<x> resolves pages.id, which is NOT pages._id on re-minted pages
  // (measured 2026-09-30: an _id URL 404'd where the id URL served). Use the manifest's pages.id.
  const page = await db.collection('pages').findOne(
    { id: m.page_id },
    { projection: { id: 1, 'translation.data': 1, 'ocr.data': 1 } },
  );
  if (!page?.translation?.data || !page?.ocr?.data) { skipped++; continue; }
  const book = await db.collection('books').findOne(
    { $or: [{ id: m.book_id }, ...(ObjectId.isValid(m.book_id) ? [{ _id: new ObjectId(m.book_id) }] : [])] },
    { projection: { slug: 1 } },
  );
  const pid = String(page.id);
  rows.push({
    queue: 'translation-check',
    language: m.language,
    item_id: `trans:${m.language}:${pid}`,
    url: `${SITE}/book/${book?.slug ?? m.book_id}/page/${pid}`,
    label: 'the page',
    campaign: `Judge calibration — ${m.language}`,
    audit_item: m.id,
    prompt:
      `You read ${m.language}. This page shows the scan, our transcription of it, and our English. ` +
      'Two separate questions, in this order: does the transcription match what is actually on the page, ' +
      'and does the English match the original?' +
      (m.title ? `\n\nThis is “${m.title}”${m.published ? `, ${m.published}` : ''}.` : ''),
  });
}
await client.close();
fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
const byLang = rows.reduce((o, r) => ((o[r.language] = (o[r.language] || 0) + 1), o), {});
console.error(`${rows.length} tasks (${skipped} skipped) → ${OUT}\n` + Object.entries(byLang).map(([k, v]) => `  ${k} ${v}`).join('\n'));
