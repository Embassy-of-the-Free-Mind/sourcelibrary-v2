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
    detailed: 'Thomas Panckow (1622-1665) was a Berlin physician, and the Herbarium Portatile is a working book rather than a scientific one: a small-format herbal meant to be carried, with a woodcut and a bilingual name for each of 1,363 plants and a note on use. Its place in the history of the slime moulds rests on a single entry. Panckow describes and figures a growth he calls fungi cito crescentes, the fungus of rapid growth, and notes the speed with which it appears. The figure is identifiable as Lycogala epidendrum, which makes it the first slime mould to reach print. Nothing in the entry suggests he thought it was anything but a fungus, and no one would think otherwise for another two hundred years. The woodcuts were not cut for this book. Leonhard Thurneisser had 1,921 botanical blocks made in the 1570s for a ten-volume work that collapsed after its first volume, and Panckow tracked down 1,363 of the scattered blocks in the early 1650s and printed them here (Jessie Wei-Hsuan Chen, \u2018A Woodblock\u2019s Career\u2019, Nuncius 35, 2020). The volume contains exactly 1,363 woodcuts, so the figure of the slime mould is almost certainly a Thurneisser block, cut some eighty years before the book that made it famous. What is Panckow\u2019s is the description and the identification, and his priority for the first published account of a myxomycete is unaffected.',
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
  {
    id: '6a8b7898ddf894921a433f42',
    name: 'Schrader, Nova Genera Plantarum (1797)',
    firstTranslation: true,
    english: false,
    brief: 'The only part published of Schrader\u2019s Nova Genera Plantarum (Leipzig, 1797), with hand-coloured engraved plates. It belongs to the decade when Persoon was fixing the names of the slime moulds, and it describes and figures several of them at a moment when the group was still being sorted out among the fungi.',
    detailed: 'Heinrich Adolph Schrader (1767-1836) published this first part of a projected larger work in 1797 and never continued it. It is a small book carrying careful descriptions and hand-coloured plates of genera then newly distinguished, among them slime moulds, and it sits inside the short period between Persoon\u2019s first arrangement of the group and the Synopsis of 1801 that made his names current. Its interest here is double: the descriptions have never been translated into English, and the plates are among the earliest coloured figures of these organisms drawn with any precision.',
  },
  {
    id: '6a8b76ef313cdd0126cb79af',
    name: 'Zopf, Die Pilzthiere oder Schleimpilze (1885)',
    firstTranslation: true,
    english: false,
    brief: 'The monograph that stands between Rostafi\u0144ski\u2019s Polish one of 1875 and Lister\u2019s English one of 1894 (Breslau, Trewendt, 1885). Zopf calls the group Pilzthiere, fungus animals, and works through their structure, development and classification at book length while de Bary\u2019s question was still open.',
    detailed: 'Wilhelm Zopf (1846-1909) wrote this while the status of the Mycetozoa was genuinely unsettled: de Bary had moved them out of the fungi on developmental evidence, Rostafi\u0144ski had classified them in a language almost nobody in the field could read, and the group had no accessible synthesis. Zopf supplies one. The title keeps de Bary\u2019s answer, Pilzthiere, fungus animals, and the book treats the plasmodium, the fruiting body, the life cycle and the classification in turn. It has never been translated into English, which is why the decade it covers is usually told through Lister instead.',
  },
  {
    id: '6a8b78a1ddf894921a433f76',
    name: 'Cooke, The Myxomycetes of Great Britain (1877)',
    firstTranslation: false,
    english: true,
    brief: 'A British flora of the slime moulds arranged, as its title says outright, according to the method of Rostafi\u0144ski (London, 1877). It is the book that carried the Polish monograph into English practice, seventeen years before Lister, with twenty-four plates.',
    detailed: 'Mordecai Cubitt Cooke (1825-1914) was a prolific popular mycologist, and this is a working handbook rather than a work of theory: keys, descriptions and plates for the species then known in Britain. Its significance is in the subtitle. Rostafi\u0144ski\u2019s monograph of 1875 was in Polish, and the usual account of how his classification reached the English-speaking field jumps straight to Lister in 1894. Cooke got there first, and said in his own title whose arrangement he was following.',
  },
  {
    id: '6a8b78abddf894921a43401a',
    name: 'Massee, Monograph of the Myxogastres (1892)',
    firstTranslation: false,
    english: true,
    brief: 'Massee\u2019s arrangement of the group (London, Methuen, 1892), with twelve coloured plates. It appeared two years before Lister\u2019s monograph and was largely displaced by it, which is exactly what makes the pair worth reading together.',
    detailed: 'George Massee (1845-1917) worked at Kew and published widely across mycology. This monograph was the standard English treatment for a very short time. Arthur Lister\u2019s of 1894 disagreed with it on both species limits and arrangement, and it is Lister\u2019s that the twentieth century inherited. Read beside each other, the two books show a classification being argued rather than settled, which the surviving winner on its own cannot show.',
  },
  {
    id: '6a8b76f6313cdd0126cb7a75',
    name: 'Lister, A Monograph of the Mycetozoa (1894)',
    firstTranslation: false,
    english: true,
    brief: 'The work that made the slime moulds legible to English readers (London, British Museum, 1894), a descriptive catalogue of the species in the Museum\u2019s herbarium, with plates drawn by Gulielma Lister.',
    detailed: 'Arthur Lister (1830-1908) reorganised Rostafi\u0144ski\u2019s classification and illustrated it with plates drawn by his daughter Gulielma, who was a mycologist in her own right and carried the book through two further editions after his death. For most of the twentieth century this is how the field knew the group, and the reason Rostafi\u0144ski is far more often cited than read. It is here for the plates and for the comparison: the Polish monograph it reorganises is in this collection too, in English for the first time.',
  },
];

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB);

for (const b of BOOKS) {
  const doc = await db.collection('books').findOne({ id: b.id }, { projection: { _id: 0, pages_count: 1, pages_ocr: 1, pages_translated: 1, visible: 1 } });
  if (!doc) { console.error(`${b.name}: NOT FOUND`); continue; }
  // English books have nothing to translate, so gate them on OCR instead —
  // otherwise they would wait forever for a translation that never runs.
  const ready = b.english ? (doc.pages_ocr || 0) > 0 : (doc.pages_translated || 0) > 0;
  const measure = b.english ? `ocr ${doc.pages_ocr}/${doc.pages_count}` : `translated ${doc.pages_translated}/${doc.pages_count}`;
  console.log(`\n${b.name}\n  ${measure}  visible=${doc.visible === true}  ${ready ? '' : '→ SKIP, not ready yet'}`);
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
