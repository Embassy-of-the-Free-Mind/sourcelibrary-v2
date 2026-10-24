// The book-level note (#7119) after the leaf split and the fresh Opus read; counts from fresh-apply-result.json and
// fresh-vs-anchored.json, gate figures from fresh-gate-scores.json (#7119 comment, 2026-10-23).
//   node --env-file=/root/sourcelibrary/.env.production.local book-note.mjs [--apply]
// PRIOR ART: publish.mjs wrote the first note (and made the book public); this rewrites only the note text.
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { HERE, BOOK } from './lib.mjs';
import { recordSweepAction } from '../../../lib/sweep-log.mjs';
const res = JSON.parse(fs.readFileSync(path.join(HERE, 'fresh-apply-result.json'), 'utf8'));
const cmp = Object.values(JSON.parse(fs.readFileSync(path.join(HERE, 'fresh-vs-anchored.json'), 'utf8'))).filter((x) => x.fresh_cer != null);
const pooled = cmp.reduce((s, x) => s + x.fresh_cer * x.fresh_chars, 0) / cmp.reduce((s, x) => s + x.fresh_chars, 0);
const A = res.pages.filter((p) => p.primary === 'edition-anchored').length, F = res.pages.filter((p) => p.primary === 'fresh-opus-columns').length;
const NOTE = `A palm-leaf manuscript in Malayalam script, copied at Calicut in 1822 (Royal Asiatic Society, Whish MS 147), shown one leaf per page. It holds Īśvarakṛṣṇa's Sāṅkhyakārikā with Śaṅkara's Jayamaṅgalā and Vācaspati Miśra's Tattvakaumudī, an unidentified Sāṅkhya fragment, and Annambhaṭṭa's Tarkasaṃgraha with his own Dīpikā on it. `
  + `The text on these pages was made by machine in October 2026, in one of two ways, and each page says which. `
  + `Where an AI model (Claude Opus 5.5) could place a leaf in a published text (${A} leaves), the page gives that text collated against the leaf, in Malayalam script generated from the romanised text and in IAST: in a test on 9 leaves of the verses, AI reviewers found 25 of 36 planted differences between leaf and edition (69%), so about a third of real differences may be unmarked. A note under it gives a fresh direct reading of the leaf. `
  + `On the other leaves (${F}, most of them pp. 130–221, the Tattvakaumudī stretch and the fragment, in a denser hand) the page gives a direct reading by Claude Opus 5.5 with no edition shown. On 9 verse leaves such reads differed from the published text in 37% of characters, unevenly and partly from memory of the verses; across the ${cmp.length} placed leaves, in ${Math.round(pooled * 100)}%. `
  + `The English translations (Claude Opus 5.5) translate these uncertain texts. Nothing here has been checked by a scholar.`;
console.log(NOTE);
if (process.argv.includes('--apply')) {
  const c = await MongoClient.connect(process.env.MONGODB_URI);
  const db = c.db('bookstore');
  const b = await db.collection('books').findOne({ id: BOOK }, { projection: { summary: 1 } });
  if (b.summary?.source !== 'job:whish147-best-attempt') throw new Error('summary is not this job\'s; not overwritten');
  await recordSweepAction(db, { sweep: 'whish147-best-attempt', book_id: BOOK, action: 'book-note-update', detail: { issue: 7119, chars: NOTE.length } });
  await db.collection('books').updateOne({ id: BOOK }, { $set: { summary: { ...b.summary, data: NOTE, generated_at: new Date() }, updated_at: new Date() } });
  console.log('written');
  await c.close();
}
