#!/usr/bin/env node
/**
 * Finish the three Slime Moulds books: summaries, the first-translation flag,
 * and publication.
 *
 * Summaries are written directly rather than generated. `GET /api/books/<id>/index`
 * falls back to a Wikipedia author bio, which returns disambiguation junk for
 * ambiguous names ("X may refer to: swimmer…") — and "Panckow" and "Rostafiński"
 * are exactly that kind of name. "About This Book" reads
 * index.bookSummary.brief → reading_summary.overview → summary.data, so all of
 * them are set.
 *
 * Safe to re-run. Refuses to publish a book with no translated pages.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/import/publish-slime-moulds.mjs [--dry-run]
 */
import { MongoClient } from 'mongodb';

const DRY = process.argv.includes('--dry-run');
const CRON_SECRET = process.env.CRON_SECRET;
if (!CRON_SECRET && !DRY) { console.error('CRON_SECRET not set.'); process.exit(1); }

const BOOKS = [
  {
    id: '6a42724628e9db2e39c131da',
    name: 'Panckow, Herbarium Portatile (1656)',
    firstTranslation: false,
    brief: 'A pocket herbal of 1,363 woodcuts, first published in Berlin in 1654 and reprinted at Leipzig in 1656, naming each plant in Latin and German. It carries what is generally taken to be the earliest published notice of a slime mould: a short entry and figure for a fungus that grows quickly, almost certainly the species now called Lycogala epidendrum, with a remark on how fast it appears.',
    detailed: 'Thomas Panckow (1622-1665) was a Berlin physician, and the Herbarium Portatile is a working book rather than a scientific one: a small-format herbal meant to be carried, with a woodcut and a bilingual name for each of 1,363 plants and a note on use. Its place in the history of the slime moulds rests on a single entry. Panckow describes and figures a growth he calls fungi cito crescentes, the fungus of rapid growth, and notes the speed with which it appears. The figure is identifiable as Lycogala epidendrum, which makes it the first slime mould to reach print. Nothing in the entry suggests he thought it was anything but a fungus, and no one would think otherwise for another two hundred years. The woodcuts of the volume were not all cut for it; a number derive from blocks made by Peter Holzmeyer for Leonhard Thurneisser, which is worth keeping in view when treating any single figure as an original observation.',
  },
  {
    id: '6a8b60e7c53b44fe18da9437',
    name: 'de Bary, Die Mycetozoen (1864)',
    firstTranslation: false,
    brief: 'The book form of the paper in which Anton de Bary argued that the slime moulds are not fungi. Working from development rather than from the dried fruiting bodies collectors brought in, he found an organism that crawls and feeds, and moved the whole group out of the fungi under a new name: Mycetozoa, the fungus animals.',
    detailed: 'Anton de Bary (1831-1888) first published this argument in 1859 in the Zeitschrift für wissenschaftliche Zoologie, and issued it as a book at Leipzig in 1864 with six folded plates. The method is the point. Naturalists had classed the slime moulds with the fungi for two centuries because the fruiting body is what survives to be collected, and it looks like a small fungus. De Bary raised them from spore and watched what came out: a naked mass of protoplasm that moves, engulfs food, and only later stops and forms the structure everyone had been describing. On that evidence he placed them with the lowest animals and named the group Mycetozoa. The classification did not hold in the form he gave it, but the separation did, and the developmental approach he used here became the standard method of the field. The text has never been fully translated into English.',
  },
  {
    id: '6a8b60f1c53b44fe18da94e3',
    name: 'Rostafiński, Śluzowce (1875)',
    firstTranslation: true,
    brief: 'The first monograph of the slime moulds, written in Polish by de Bary’s student and published in Paris in 1875. Its classification and species descriptions are the foundation the group’s taxonomy still rests on, and because few of its readers had the language, most of the field met it second hand through Arthur Lister’s English monograph of 1894.',
    detailed: 'Józef Tomasz Rostafiński (1850-1928) studied under Anton de Bary at Halle and Strasbourg, in the years immediately after de Bary had separated the slime moulds from the fungi. Śluzowce, published at Paris in 1875 by the Kórnik Library, is the first attempt to treat the whole group monographically: a classification, keys, and descriptions of the species then known. It is the point at which the Mycetozoa become a subject with its own literature rather than a difficult corner of mycology. The book was written in Polish, which almost none of its intended readership could read, and its influence travelled through intermediaries, above all Arthur Lister’s Monograph of the Mycetozoa of 1894, which rearranged what it found here. Rostafiński’s names and concepts remain in use; the reasoning behind them has been largely inaccessible.',
  },
];

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB);

for (const b of BOOKS) {
  const doc = await db.collection('books').findOne({ id: b.id }, { projection: { _id: 0, pages_count: 1, pages_translated: 1, visible: 1 } });
  if (!doc) { console.error(`${b.name}: NOT FOUND`); continue; }
  const ready = (doc.pages_translated || 0) > 0;
  console.log(`\n${b.name}\n  translated ${doc.pages_translated}/${doc.pages_count}  visible=${doc.visible === true}  ${ready ? '' : '→ SKIP, nothing translated yet'}`);
  if (!ready || DRY) continue;

  await db.collection('books').updateOne({ id: b.id }, {
    $set: {
      'index.bookSummary.brief': b.brief,
      'index.bookSummary.detailed': b.detailed,
      'index.bookSummary.abstract': b.brief,
      'reading_summary.overview': b.brief,
      'reading_summary.detailed': b.detailed,
      ...(b.firstTranslation ? { is_first_translation: true } : {}),
    },
  });
  console.log('  summary written' + (b.firstTranslation ? ' + first-translation flag set' : ''));

  const res = await fetch(`https://sourcelibrary.org/api/books/${b.id}/visibility`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CRON_SECRET}` },
    body: JSON.stringify({ hidden: false }),
  });
  console.log(`  publish: ${res.status} ${res.ok ? 'OK' : await res.text()}`);

  // Raw Mongo writes do not revalidate; the API publish above does, but the
  // summary edit landed before it, so bust the cache explicitly.
  const rev = await fetch(`https://sourcelibrary.org/api/admin/revalidate-book/${b.id}`, {
    method: 'POST', headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });
  console.log(`  revalidate: ${rev.status}`);
}

const count = await db.collection('books').countDocuments({ collections: 'slime-moulds' });
const visible = await db.collection('books').countDocuments({ collections: 'slime-moulds', visible: true });
if (!DRY) await db.collection('collections').updateOne({ slug: 'slime-moulds' }, { $set: { book_count: count } });
console.log(`\nslime-moulds: ${visible}/${count} books visible.`);
console.log('Then purge Cloudflare for /collections/slime-moulds and each /book/<slug>.');
await client.close();
