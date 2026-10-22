// TRANSLATE plan (#7119): the page-ids and per-page instruction files for scripts/batch/claude-translate.mjs, which
// reads the stored OCR, translates with Opus on the production block prompt, and leaves the write to
// cli-translate.mjs apply. Each page's instruction gives the exact <warning> its English must open with.
//   node --env-file=/root/sourcelibrary/.env.production.local translate-plan.mjs <first> <last> <out-prefix>
// then: claude-translate.mjs read --page-ids-file=<prefix>.ids.json --instructions-file=<prefix>.instr.json --out=DIR
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { HERE, BOOK } from './lib.mjs';

const TW = {
  'edition-anchored': 'the Sanskrit it translates is a machine transcription anchored to a published edition, which can miss places where the leaf differs (see the note on the transcription)',
  'free-read': 'the Sanskrit is a best-effort machine reading that, in tests on this manuscript (Oct 2026), matched the published text no better than chance; only what was read is translated',
};
export function translationWarning(P) {
  if (P.methods.includes('contents-leaf-read')) return 'English translation (Claude Opus 5.5, Oct 2026) of the contents leaf, whose transcription is a machine reading: the English list is kept as written and the Malayalam list is translated. Not checked by a scholar.';
  const by = { t: 'upper leaf', b: 'lower leaf' };
  const leaves = Object.entries(P.leaves);
  const mixed = new Set(leaves.map(([, l]) => l.method)).size > 1;
  const parts = mixed ? leaves.map(([k, l]) => `for the ${by[k] || k}, ${TW[l.method]}`) : [TW[leaves[0][1].method]];
  return `English translation (Claude Opus 5.5, Oct 2026) of an uncertain text: ${parts.join('; ')}. Not checked by a scholar.`;
}
export function instruction(n, P) {
  const w = translationWarning(P);
  if (P.methods.includes('contents-leaf-read')) return `For page ${n} (the manuscript's contents leaf): begin its translation with exactly this line: <warning>${w}</warning> Keep the English list as written and translate the Malayalam list line by line; keep the <leaf-break/> between the two leaves.`;
  const free = P.methods.includes('free-read');
  return `For page ${n} (two palm leaves of Sanskrit, transcribed in IAST as half-leaf rows): begin its translation with exactly this line: <warning>${w}</warning> Then translate each leaf as continuous English under the headings **Upper leaf** and **Lower leaf**, with the <leaf-break/> between them; the text of a leaf runs left-half row 1, right-half row 1, left-half row 2, right-half row 2, and so on; join a word split across a row end or a string hole into one word (never write split halves like "tha- -t"). Translate the words written: render a doubtful reading "X [leaf: Y?]" as X with the leaf's alternative in brackets, keep [illegible] for stretches not read, and never supply a remembered published translation or fill a gap from the known text.${free ? ' Where a leaf is a best-effort reading of broken syllables, translate only connected words actually read; if none can be read as words, write only "[no connected text could be read on this leaf]" for that leaf.' : ''}`;
}

async function main() {
  const [a, b, prefix] = process.argv.slice(2);
  const c = await MongoClient.connect(process.env.MONGODB_URI);
  const pages = await c.db('bookstore').collection('pages').find({ book_id: BOOK, page_number: { $gte: Number(a), $lte: Number(b) }, 'ocr.pipeline': 'whish147-best-attempt', $or: [{ 'translation.data': { $exists: false } }, { 'translation.data': { $in: [null, ''] } }] }, { projection: { id: 1, page_number: 1, 'ocr.data': 1 } }).sort({ page_number: 1 }).toArray();
  await c.close();
  const ids = [], instr = {};
  for (const p of pages) {
    const P = JSON.parse(fs.readFileSync(path.join(HERE, 'pages', `${p.page_number}.json`), 'utf8'));
    if (P.text !== p.ocr.data) throw new Error(`p.${p.page_number}: stored OCR is not the assembled text`);
    ids.push(p.id); instr[p.id] = instruction(p.page_number, P);
  }
  fs.writeFileSync(`${prefix}.ids.json`, JSON.stringify(ids));
  fs.writeFileSync(`${prefix}.instr.json`, JSON.stringify(instr, null, 1));
  console.log(`${ids.length} pages -> ${prefix}.ids.json / .instr.json`);
}
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) await main();
