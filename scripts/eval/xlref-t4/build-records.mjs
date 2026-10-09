#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-vs-reference/fetch-served.mjs adds the served arm and source text to finished records; it does not merge alignment-agent output, drop failed books, or attach the scan / text licences addendum A of #5695 asks for. This does those three, then fetch-served runs on its output. Read-only.
/** Merge the T4 alignment agents' reference records (#5695), attach book metadata and licences (scan, our text, reference), and write harness input records. */
//   node --env-file=… scripts/eval/xlref-t4/build-records.mjs <refs-dir with G*.jsonl> <out records.jsonl> <out failed.json>
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
const [DIR, OUT, FAILED] = process.argv.slice(2);
const OUR_TEXT_LICENCE = 'CC BY-SA 4.0'; // src/app/terms/page.tsx: AI translations, OCR transcriptions and derived content
const OPEN = /^(public domain|cc0|cc-by|cc by)/i; // CC-BY-NC / -SA count as open for publication with their terms recorded
const rows = fs.readdirSync(DIR).filter((f) => /^G\d+\.jsonl$/.test(f)).sort()
  .flatMap((f) => fs.readFileSync(path.join(DIR, f), 'utf8').split('\n').filter((l) => l.trim()).map((l) => ({ ...JSON.parse(l), align_group: f.replace('.jsonl', '') })));
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const books = c.db('bookstore').collection('books');
const out = []; const failed = [];
try {
  for (const r of rows) {
    const b = await books.findOne({ id: r.book_id }, { projection: { id: 1, title: 1, author: 1, year: 1, language: 1, image_source: 1 } });
    if (r.failed) { failed.push({ book_id: r.book_id, title: b?.title, book_language_label: b?.language, reason: r.reason, skipped: r.skipped || [] }); continue; }
    const m = r.reference_meta;
    const publishable = !m.private && OPEN.test(m.licence || '');
    out.push({
      track: 'T4', lang: r.lang, book_id: r.book_id, page_number: Number(r.page_number),
      reference_text: r.reference_text,
      reference_meta: { ...m, year: m.year ?? null },
      book_title: r.book_title || b?.title, book_author: b?.author ?? null, book_year: b?.year ?? null, book_language_label: b?.language ?? null,
      period: r.period ?? null, genre: r.genre ?? null, famous: !!r.famous, page_has_printed_english: !!r.page_has_printed_english,
      ocr_notes: r.ocr_notes ?? null, align: { group: r.align_group, candidate_index: r.candidate_index ?? null, skipped: r.skipped || [], confidence: r.align_confidence ?? null, note: r.align_note ?? null },
      licences: {
        scan: b?.image_source?.license || b?.image_source?.rights_normalized?.statement_uri || null,
        scan_class: b?.image_source?.rights_normalized?.class || null,
        scan_provider: b?.image_source?.provider_name || b?.image_source?.provider || null,
        our_text: OUR_TEXT_LICENCE, reference: m.licence, reference_publishable: publishable,
      },
      candidates: [],
    });
  }
} finally { await c.close(); }
fs.writeFileSync(OUT, out.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(FAILED, JSON.stringify(failed, null, 1));
const by = {}; for (const r of out) by[r.lang] = (by[r.lang] || 0) + 1;
console.log(`${out.length} records, ${failed.length} failed books; by language ${JSON.stringify(by)}; private ${out.filter((r) => r.reference_meta.private).length}`);
