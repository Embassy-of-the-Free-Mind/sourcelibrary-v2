#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/page-integrity.mjs (`isExcess`, the runaway tier) — does not judge a
 * source under 300 characters, which is exactly where a title leaf sits.
 * scripts/lib/illegible-source-gate.mjs — the pre-translation gate; it refuses a page nobody could
 * READ, and a title leaf is perfectly legible, so there is nothing for it to refuse before the
 * model has answered. scripts/audit/withheld-translation-drift.mjs — reconciles withholds, finds
 * none. The rule itself is `isRecited` in scripts/lib/translate-core.mjs, shared with the lane.
 *
 * recited-short-source — pages whose source is short and whose English is long (#6297).
 *
 * A reader opens a volume at page 1. The image shows one title line; the English beside it is a
 * chapter of the work, written from the model's memory. This lists such pages. READ-ONLY, $0: it
 * reads `pages` and writes a report file, nothing else.
 *
 * A flag is a CANDIDATE. Withholding needs the image opened and the by-eye path
 * (`.claude/docs/invariants/containment-on-finding.md`); this script's output is not a withhold list.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/recited-short-source.mjs --tengyur
 *   … --title-pages        every page with page_type: title-page
 *   … --book=<id>          one book
 *   … --report=PATH        jsonl.gz of the flags (default: $JOB_SCRATCH or scripts/output)
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { withMongo } from '../lib/mongo.mjs';
import { bodyLen, sourceWeight, isRecited, RECITED_SOURCE_MAX } from '../lib/translate-core.mjs';

const ARG = (k, d) => { const a = process.argv.find((x) => x.startsWith(`${k}=`)); return a ? a.slice(k.length + 1) : d; };
const TENGYUR = process.argv.includes('--tengyur'), TITLE_PAGES = process.argv.includes('--title-pages');
const BOOK = ARG('--book', null);
if (!TENGYUR && !TITLE_PAGES && !BOOK) { console.error('one of --tengyur, --title-pages, --book=<id>'); process.exit(1); }
const scope = BOOK ? `book-${BOOK}` : TENGYUR ? 'tengyur' : 'title-pages';
const REPORT = ARG('--report', path.join(process.env.JOB_SCRATCH || 'scripts/output', `recited-short-source-${scope}-${new Date().toISOString().slice(0, 10)}.jsonl.gz`));

await withMongo(async (db) => {
  const books = db.collection('books'), pages = db.collection('pages');
  let filter;
  if (BOOK) filter = { book_id: BOOK };
  else if (TENGYUR) {
    const ids = (await books.find({ collections: 'derge-tengyur' }, { projection: { id: 1 } }).toArray()).map((b) => b.id);
    console.log(`Derge Tengyur: ${ids.length} volumes`);
    filter = { book_id: { $in: ids } };
  } else filter = { page_type: 'title-page' };

  const t = { scanned: 0, translated: 0, short_source: 0, flagged: 0, flagged_books: new Set(), human_edited: 0 };
  const flags = [];
  const cur = pages.find({ ...filter, 'translation.data': { $type: 'string' } },
    { projection: { id: 1, book_id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'translation.data': 1, 'translation.model': 1, 'translation.source': 1, 'translation.edited_by': 1, 'translation.updated_at': 1 } }).batchSize(1000);
  for await (const p of cur) {
    t.scanned++;
    const ocr = p.ocr?.data || '', tr = p.translation.data;
    if (!tr.trim()) continue;
    t.translated++;
    const weight = sourceWeight(ocr);
    if (!weight || weight >= RECITED_SOURCE_MAX) continue;
    t.short_source++;
    if (!isRecited(ocr, tr)) continue;
    t.flagged++; t.flagged_books.add(p.book_id);
    const human = p.translation.source === 'manual' || !!p.translation.edited_by;
    if (human) t.human_edited++;
    flags.push({ book_id: p.book_id, page_number: p.page_number, page_type: p.page_type ?? null, source_weight: weight, source_body: bodyLen(ocr), english_body: bodyLen(tr), model: p.translation.model ?? null, translated_at: p.translation.updated_at ?? null, human_edited: human, url: `https://sourcelibrary.org/book/${p.book_id}?page=${p.page_number}` });
  }
  flags.sort((a, b) => b.english_body - a.english_body);
  // Visibility and hold per flagged book: a flag on a public, unheld book is the one a reader meets.
  const meta = new Map((await books.find({ id: { $in: [...t.flagged_books] } }, { projection: { id: 1, title: 1, visible: 1, 'pipeline_auto.status': 1 } }).toArray()).map((b) => [b.id, b]));
  for (const f of flags) { const b = meta.get(f.book_id); f.title = b?.title ?? null; f.visible = b?.visible ?? null; f.pipeline_status = b?.pipeline_auto?.status ?? null; }
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, zlib.gzipSync(flags.map((f) => JSON.stringify(f)).join('\n') + (flags.length ? '\n' : '')));
  console.log(JSON.stringify({ scope, pages_with_translation: t.translated, short_source: t.short_source, flagged: t.flagged, flagged_books: t.flagged_books.size, flagged_on_visible_books: flags.filter((f) => f.visible === true).length, human_edited_among_flags: t.human_edited, report: REPORT }, null, 2));
  for (const f of flags.slice(0, 40)) console.log(`  ${f.url}  source ${f.source_weight} → English ${f.english_body}${f.visible ? '' : '  (hidden)'}${f.human_edited ? '  (human-edited)' : ''}`);
  if (flags.length > 40) console.log(`  … ${flags.length - 40} more in the report`);
}, { timeoutMs: 3_600_000 });
