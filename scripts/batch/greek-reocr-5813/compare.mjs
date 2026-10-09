#!/usr/bin/env node
// PRIOR ART: scripts/eval/reocr-lift-5700/text-distance.mjs — the folds and edit distance are reused
// from it unchanged; it scores a read against a by-eye corrected text. This compares what a page
// served BEFORE the #5813 re-read (snapshot.mjs) with what it serves now.
//
// Per page: outcome (reread | kept-old + reason) and character agreement
//   agreement = 1 − levenshtein(new, old) / max(|new|, |old|)
// over letters only, markup stripped, case and polytonic accents folded (normWords). Read-only.
//   node --env-file=… scripts/batch/greek-reocr-5813/compare.mjs --before=before.jsonl --out=compare.jsonl [--since=ISO]
import fs from 'node:fs';
import readline from 'node:readline';
import { MongoClient } from 'mongodb';
import { normWords } from '../../eval/reocr-lift-5700/text-distance.mjs';
import { levenshtein } from '../../eval/lib/metrics.mjs';

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const FLASH = 'gemini-3-flash-preview';
export function agreement(a, b) {
  const x = [...normWords(a).join('')], y = [...normWords(b).join('')];
  const m = Math.max(x.length, y.length);
  return { agreement: m ? 1 - levenshtein(x, y) / m : 1, old_chars: y.length, new_chars: x.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const c = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 2 });
  await c.connect();
  const P = c.db('bookstore').collection('pages');
  const out = fs.createWriteStream(arg('out'));
  const tally = {};
  let buf = [];
  const flush = async () => {
    const now = new Map((await P.find({ id: { $in: buf.map((b) => b.id) } }, { projection: { _id: 0, id: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.updated_at': 1, 'ocr.batch_job_id': 1, 'ocr.recitation_count': 1, 'ocr.fail_reason': 1, 'ocr.edited_by': 1, 'ocr.source': 1 } }).toArray()).map((p) => [p.id, p]));
    for (const b of buf) {
      const p = now.get(b.id);
      const row = { page_id: b.id, book_id: b.book_id, n: b.page_number, tr: !!b.translation?.data };
      const reread = p?.ocr?.model === FLASH && p.ocr.batch_job_id !== b.ocr?.batch_job_id && +new Date(p.ocr.updated_at) > +new Date(b.ocr?.updated_at || 0);
      if (!p) row.outcome = 'page-gone';
      else if (reread) Object.assign(row, { outcome: 'reread' }, agreement(p.ocr.data, b.ocr.data));
      else row.outcome = p.ocr?.source === 'manual' || p.ocr?.edited_by ? 'kept-old:human-edit' : (p.ocr?.recitation_count || 0) > (b.ocr?.recitation_count || 0) || p.ocr?.last_recitation_at ? 'kept-old:recitation' : p.ocr?.fail_reason ? `kept-old:${p.ocr.fail_reason}` : 'kept-old:not-written';
      tally[row.outcome] = (tally[row.outcome] || 0) + 1;
      out.write(JSON.stringify(row) + '\n');
    }
    buf = [];
  };
  for await (const line of readline.createInterface({ input: fs.createReadStream(arg('before')) })) {
    if (!line) continue;
    buf.push(JSON.parse(line));
    if (buf.length >= 300) await flush();
  }
  await flush();
  await new Promise((r) => out.end(r));
  console.log(JSON.stringify(tally));
  await c.close();
}
