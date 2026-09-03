#!/usr/bin/env node
/**
 * Rewrite "About this book" for books whose summary was written from a
 * collection's point of view rather than the book's.
 *
 * When these were written for the Slime Moulds collection, two general works
 * ended up described almost entirely by their myxomycete content: a 1,363-plant
 * medicinal herbal introduced as "the earliest published notice of a slime
 * mould", and a work on new plant genera introduced by where it sits in the
 * naming of that group. Both even said "its interest HERE", meaning in that
 * collection. About this book appears on the book's own page, where most
 * readers arrive without the collection, so it has to describe the book.
 *
 * Books that genuinely are about slime moulds (de Bary, Rostafinski, Cooke,
 * Zopf, Massee, Lister) are left alone: for those, the group is the subject,
 * not a lens.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/import/rewrite-book-summaries.mjs [--dry-run]
 */
import { MongoClient } from 'mongodb';

const DRY = process.argv.includes('--dry-run');
const CRON_SECRET = process.env.CRON_SECRET;

const REWRITES = [
  {
    id: '6a42724628e9db2e39c131da',
    name: 'Panckow, Herbarium Portatile (1656)',
    brief: 'A pocket herbal for people who used plants for a living. It figures 1,363 native and foreign herbs, names each in Latin and German, and briefly explains the uses of those employed in medicine, with Theophilus Kentmann’s herb table appended. The title page addresses it to physicians, apothecaries, surgeons, gardeners and householders. First published at Berlin in 1654; this is the Leipzig printing of 1656.',
    detailed: 'Thomas Panckow (1622-1665) was a Berlin physician, and this is a working reference rather than a scientific treatise: small enough to carry, arranged for looking things up, with a woodcut, a bilingual name and a short note on use for each plant. Its practical bent is stated on the title page, which names the apothecaries, wound-surgeons, gardeners and householders it is meant to serve, and it closes with a herb table taken from Theophilus Kentmann.\n\nThe woodcuts were not made for it. Leonhard Thurneisser had 1,921 botanical blocks cut in the 1570s, by Peter Holzmeyer, for a ten-volume work that collapsed after its first volume; Panckow found 1,363 of the abandoned blocks in the early 1650s and built this book around them. The pictures are therefore some eighty years older than the text beside them, which is worth remembering before treating any single figure as a record of what Panckow himself saw.\n\nOne of those figures has a later significance the book could not have anticipated. Under the heading fungi cito crescentes, the fungus that grows quickly, it shows and briefly describes a growth now identified as Lycogala epidendrum, and this is generally taken to be the earliest published notice of a slime mould. Panckow files it with the fungi, as everyone would for another two hundred years.',
  },
  {
    id: '6a8b7898ddf894921a433f42',
    name: 'Schrader, Nova Genera Plantarum (1797)',
    brief: 'Schrader’s attempt to put a set of plant genera on firmer footing: some newly established by him, others defined by earlier authors but, in his view, too loosely. Each is described from his own examination through successive stages of growth and illustrated with hand-coloured engraved plates. Published at Leipzig in 1797 as a first part; no further part appeared.',
    detailed: 'Heinrich Adolph Schrader (1767-1836) opens with a preface invoking Caesalpinus on the primacy of the genus, and states his purpose plainly: to publish genera that are either his own or that others had established without defining well enough to be usable. The dedication is to Franz Egon, Bishop of Hildesheim and Paderborn.\n\nWhat gives the descriptions their weight is the method. Schrader says he observed and examined all of the genera treated here through their various stages of development, noting the single case (Cribraria purpurea) where he could not, which is an unusually exact claim for the period and the reason later authors kept citing him. The plates are hand-coloured and drawn with more precision than was then usual for organisms of this size.\n\nThe work is a first part of a projected larger one that was never continued, and it has never been translated into English. It opens with Cribraria, a genus of slime moulds, and its treatment of that group belongs to the short window between Persoon’s first arrangement of them and the Synopsis of 1801 that made his names standard.',
  },
];

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB);

for (const r of REWRITES) {
  const before = await db.collection('books').findOne({ id: r.id }, { projection: { _id: 0, 'index.bookSummary.brief': 1 } });
  console.log(`\n${r.name}`);
  console.log(`  was: ${String(before?.index?.bookSummary?.brief || '(none)').slice(0, 110)}…`);
  console.log(`  now: ${r.brief.slice(0, 110)}…`);
  if (DRY) continue;
  await db.collection('books').updateOne({ id: r.id }, {
    $set: {
      'index.bookSummary.brief': r.brief,
      'index.bookSummary.detailed': r.detailed,
      'index.bookSummary.abstract': r.brief,
      'reading_summary.overview': r.brief,
      'reading_summary.detailed': r.detailed,
    },
    $currentDate: { updated_at: true },
  });
  const res = await fetch(`https://sourcelibrary.org/api/admin/revalidate-book/${r.id}`, {
    method: 'POST', headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });
  console.log(`  written, revalidate ${res.status}`);
}
await client.close();
