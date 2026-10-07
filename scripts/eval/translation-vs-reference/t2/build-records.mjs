// PRIOR ART: from-ab-sample.mjs converts a #5606 sample into harness records; T2's references were cut by
// subagents into align/out-*.jsonl, a different layout, so this converts THAT, adding period / script / kind and
// the publishability fields Derek's addendum A asks for (scan licence, our text's licence, reference licence).
/** Convert T2 aligner output into translation-vs-reference input records (+ book licence fields, period strata). Read-only. */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
const [,, alignFile, periodFile, outFile] = process.argv;
const rows = JSON.parse(fs.readFileSync(alignFile, 'utf8')).filter((r) => r.status === 'ok');
const period = Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(periodFile, 'utf8'))).flatMap(([k, v]) => v.map((s) => [s, k])));
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const books = c.db('bookstore').collection('books');
const out = [];
for (const r of rows) {
  const b = await books.findOne({ id: r.book_id }, { projection: { title: 1, author: 1, published: 1, license: 1, rights_status: 1, rights_note: 1, commons_license: 1, source: 1, provider: 1 } });
  const m = { ...r.reference_meta };
  if (/Collisson/.test(m.translator)) { m.private = false; m.licence = 'public domain (US & worldwide; pub. 1843)'; }
  if (m.private && !/SOL/.test(m.licence)) m.licence = 'in-copyright';
  const p = period[r.book_id.slice(-6)];
  out.push({
    track: 'T2', lang: p === 'byzantine' ? 'Byzantine Greek' : 'Ancient Greek', book_id: r.book_id, page_number: r.page_number,
    period: p, page_language: r.page_language, page_kind: r.page_kind, alignment_confidence: r.alignment_confidence,
    skipped_pages: r.skipped_pages || [],
    book: { title: b?.title, author: b?.author, published: b?.published },
    licences: {
      scan: b?.commons_license || b?.license || b?.rights_status || 'unrecorded (scan provider terms)',
      our_text: 'CC BY-SA 4.0 (Source Library OCR + AI translation)',
      reference: m.licence, reference_publishable: !m.private,
    },
    reference_text: r.reference_text, reference_meta: m, candidates: [],
  });
}
await c.close();
fs.writeFileSync(outFile, out.map((x) => JSON.stringify(x)).join('\n') + '\n');
console.log(out.length, 'records');
