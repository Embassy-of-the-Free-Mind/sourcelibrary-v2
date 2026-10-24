// PUBLISH (#7119): make Whish 147 public through the canonical writer, and set the book-level note readers see as its
// About text (`summary`, the field the book page falls back to when there is no index brief). The pipeline hold
// (malayalam-palm-leaf-lane) is NOT touched: setPipelineStatus refuses any status while the hold marker is on, and
// the hold is what keeps the lite lane from re-reading these pages.
//   node --env-file=/root/sourcelibrary/.env.production.local publish.mjs [--apply]
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { HERE, BOOK } from './lib.mjs';
import { setPublication } from '../../../lib/publication.mjs';
import { recordSweepAction } from '../../../lib/sweep-log.mjs';

const APPLY = process.argv.includes('--apply');
const SO_FAR = process.argv.includes('--final') ? '' : ' so far';
// Counts come from the assembled pages, not from memory.
const tally = { 'edition-anchored': 0, 'free-read': 0, 'contents-leaf-read': 0 };
let leavesA = 0, leavesF = 0, halvesEmpty = 0;
for (const f of fs.readdirSync(path.join(HERE, 'pages'))) {
  const P = JSON.parse(fs.readFileSync(path.join(HERE, 'pages', f), 'utf8'));
  if (P.skip) continue;
  for (const l of Object.values(P.leaves)) { if (l.method === 'edition-anchored') leavesA++; if (l.method === 'free-read') { leavesF++; halvesEmpty += (l.collapsed_halves || []).length; } }
}
const NOTE = `A palm-leaf manuscript in Malayalam script, copied at Calicut in 1822 (Royal Asiatic Society, Whish MS 147). It holds Īśvarakṛṣṇa's Sāṅkhyakārikā with Śaṅkara's Jayamaṅgalā and Vācaspati Miśra's Tattvakaumudī, an unidentified Sāṅkhya fragment, and Annambhaṭṭa's Tarkasaṃgraha with his own Dīpikā on it. `
  + `The Sanskrit on these pages is a machine transcription in IAST, made in October 2026 in one of two ways, and each page says which. `
  + `Where an AI model (Claude Opus 5.5) could place a leaf in a published text, the page gives that text collated against the leaf (${leavesA} leaves${SO_FAR}): in a test on 9 leaves of the verses, AI reviewers found 25 of 36 planted differences between leaf and edition (69%), so about a third of real differences may be unmarked. `
  + `Where there is no edition or the leaf could not be placed, the page carries a best-effort reading by Claude Fable 5.1 (${leavesF} leaves${SO_FAR}), which, where a published text exists, differed from it in about half of all characters (7 leaves, Oct 2026): a rough guide to the words, not a transcription. On ${halvesEmpty} of those ${2 * leavesF} half-leaves, mostly on pp. 66–111 (the Tattvakaumudī stretch and the fragment), whose denser hand the model could not place in the text, it found no connected words, and the page says so. `
  + `The English translations (Claude Opus 5.5) translate these uncertain texts. Nothing here has been checked by a scholar.`;

const c = await MongoClient.connect(process.env.MONGODB_URI);
const db = c.db('bookstore');
const book = await db.collection('books').findOne({ id: BOOK }, { projection: { publication: 1, visible: 1, hidden: 1, summary: 1, 'pipeline_auto.status': 1 } });
console.log('before:', JSON.stringify({ publication: book.publication ?? null, visible: book.visible, hidden: book.hidden, status: book.pipeline_auto?.status, summary: book.summary ? 'set' : null }));
console.log('note:', NOTE);
void tally;
if (APPLY) {
  if (book.summary && book.summary.source !== 'job:whish147-best-attempt') throw new Error('book has a summary from another writer; not overwritten');
  await recordSweepAction(db, { sweep: 'whish147-best-attempt', book_id: BOOK, action: 'publish-with-note', detail: { issue: 7119, note_chars: NOTE.length } });
  await db.collection('books').updateOne({ id: BOOK }, { $set: { summary: { data: NOTE, generated_at: new Date(), model: 'claude-opus-5-5', source: 'job:whish147-best-attempt', page_coverage: null }, updated_at: new Date() } });
  const r = await setPublication(db, BOOK, { state: 'public', by: 'script:whish147-best-attempt', issue: 7119, note: 'Best-attempt OCR + translation with reader warnings; Derek asked for it live (#7119)' });
  console.log('publication:', JSON.stringify(r));
}
await c.close();
