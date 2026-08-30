#!/usr/bin/env node
/**
 * Build the two curated collections proposed via the MCP `propose_collection`
 * tool and left pending in `collection_proposals`:
 *
 *   1. harmonia-mundi-economic-order   (proposed 2026-08-26)
 *   2. picturing-the-world-1450-1750   (proposed 2026-08-30)
 *
 * Both are assembled entirely from existing holdings. No acquisitions, no
 * OCR, no translation: this script only tags books and writes editorial copy.
 *
 * Two proposed book_ids did NOT resolve to any record, in `books` or in
 * `deleted_books` — the proposing agent invented them. Handled explicitly:
 *
 *   - harmonia:  698420e1f1fb376a3d580612 was meant to be Saint-Martin (the
 *     rationale cites him, and his *sequel* is already in the list). Replaced
 *     with the real 1775 `Des erreurs et de la vérité`, 6a030a5a…
 *   - picturing: 69b51e49ff09e4fe943ab558 was meant to be a Postel
 *     cosmography "(1635)". Postel died in 1581 and no such record exists, so
 *     the entry is DROPPED rather than substituted. Do not silently re-add it.
 *
 * Ordering note (why this script bumps updated_at):
 * `books.collections` drives the grid via the SUPABASE mirror, not Mongo. A
 * bare $addToSet does not bump `updated_at`, so the incremental catalog sync
 * skips the books and the public grid stays EMPTY while `book_count` reads
 * correctly. See memory/lesson_collection_grid_supabase_sync. Hence
 * $currentDate below, and the mandatory follow-up printed at the end.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/create-proposed-collections-2026-08.mjs --dry-run
 *   node --env-file=.env.production.local scripts/create-proposed-collections-2026-08.mjs
 */

import { MongoClient, ObjectId } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set. Pass --env-file=.env.production.local');
  process.exit(1);
}
const DRY_RUN = process.argv.includes('--dry-run');

// ─── Harmonia Mundi ────────────────────────────────────────────────────

const HARMONIA = {
  slug: 'harmonia-mundi-economic-order',
  name: 'Harmonia Mundi and the Origins of Economic Order',
  subtitle: 'Where the doctrine of universal harmony went after the scientific revolution',
  color: 'gold',
  proposal_id: '6a8ea8036075d168462c4734',
  review_note:
    'Built 2026-08-30 from scripts/create-proposed-collections-2026-08.mjs. 32 of the 33 proposed ids resolved; 698420e1f1fb376a3d580612 does not exist and was replaced with the real Saint-Martin, Des erreurs et de la verite (1775).',
  description:
    'A single proportion was said to tune the heavens, the body, and the state. This collection follows that claim out of cosmology and into political economy, and then into its stranger afterlives.',
  expanded_description: [
    'One idea held that a single proportion tuned the heavens, the human body, and the arrangement of goods among people. When natural philosophy stopped speaking of cosmic harmony, the doctrine did not disappear; it moved into the science of wealth.',
    "Hutcheson gave the argument its most literal form, comparing universal benevolence to gravitation and setting down an algebra for computing the morality of an action. Behind him stand Giorgi's vast Latin treatise on the harmony of the world and Mersenne's Harmonie universelle; ahead of him, Quesnay modelling circulating wealth on circulating blood, and Bastiat asking outright whether the social mechanism obeys general laws as the celestial mechanism does. The line runs through Latin, French, German and English, and no library shelf keeps it together, several of its foundational works appearing in English here for the first time.",
    'Set in order, the descent becomes legible. Carey prints "Variety in unity is perfection" on the title page of a work of political economy, importing a cosmological warrant into a science of markets and stating openly what the harmony economists generally assumed. Further along the same line the vocabulary comes loose from its mathematics: a promoter turns sympathetic vibration into a joint-stock company and stages demonstrations to move the share price, and a New Thought author sells vibration as a technique for closing a sale.',
  ].join('\n\n'),
  books: [
    '69a979f2daf647306a736eab', // Macrobius, Commentary on the Dream of Scipio
    '6a089cad2b703903f58ea029', // Cicero, On the Republic; On the Laws
    '69528662ab34727b1f04c6f8', // Giorgi, On the Harmony of the World
    '6991d8ab8c1030b12444c551', // Mersenne, Treatise on Universal Harmony
    '6952dac977f38f6761bc6cb0', // Fludd, History of the Two Worlds, Vol. 2
    '69906819249ce014347d53d5', // Rayleigh, The Theory of Sound, Vol. I
    '6953efe21479a63c110885e1', // Shaftesbury, Characteristicks
    '6953efed1479a63c11088ad6', // Shaftesbury, Inquiry Concerning Virtue or Merit
    '6953efda1479a63c1108830b', // Hutcheson, Inquiry (1726)
    '6956907caeb4b980d9ebd4b8', // Hutcheson, Inquiry (1725)
    '6953efdf1479a63c11088464', // Hutcheson, Passions
    '69568c79be7c607c5f03d7bb', // Smith, Theory of Moral Sentiments
    '6991dc79569478bd6c9d4e52', // Dugald Stewart, Biographical Memoirs
    '69568c77be7c607c5f03d5a2', // Smith, Wealth of Nations
    '69568b13be7c607c5f03d575', // Quesnay, The Economic Table
    '6991dc69569478bd6c9d4777', // Quesnay, Economic and Philosophical Works
    '6991dc5a79a19ded6bdb452b', // Cantillon, Essay on the Nature of Trade
    '6991dc63569478bd6c9d44ec', // Turgot, Reflections
    '6991dc66569478bd6c9d456d', // Say, Treatise on Political Economy
    '69568ed7499312f0ff881a99', // Mill, Principles of Political Economy
    '6991dc4879a19ded6bdb3ef9', // Bastiat, Economic Harmonies
    '69568c7fbe7c607c5f03db26', // Carey, The Harmony of Interests
    '69568ebc499312f0ff8814dd', // Carey, The Unity of Law
    '6a3d2a31af872ba37a51bcbb', // Carey, Principles of Social Science
    '6a030a5a2711ef6ae8bbede3', // Saint-Martin, Des erreurs et de la vérité (SUBSTITUTED, see header)
    '69c88aac6c6f3cc53c85a71c', // Suite des erreurs et de la verite
    '6991bd4170254d38471e35ef', // Mesmer, Mesmerism
    '69905c85aaa7f10ed4cfbbc3', // A. J. Davis, The Principles of Nature
    '69906352ef12272ffdc910f3', // Bloomfield-Moore, Keely and His Discoveries
    '6991bc8cdbc9a79256550c12', // Atkinson, Thought-Force in Business
    '699058161729589044135839', // Atkinson, Thought Vibration
    '6991bc9ddbc9a79256550ff5', // Atkinson, Dynamic Thought
    '6991bcda879c23a0fef51840', // Atkinson, The Psychology of Salesmanship
  ],
  highlighted: [
    {
      book_id: '6991dc4879a19ded6bdb3ef9',
      note: 'Bastiat asks whether the social mechanism, like the celestial mechanism and the mechanism of the body, runs on general laws, and answers yes at book length. It is the clearest statement of the claim that a market left alone resolves into harmony rather than conflict.',
    },
    {
      book_id: '6956907caeb4b980d9ebd4b8',
      note: 'Hutcheson compares universal benevolence to gravitation, then does something no moral philosopher had done before: he sets down an algebra for computing the morality of an action. The formulae were argued over in his own lifetime and are startling still.',
    },
    {
      book_id: '69528662ab34727b1f04c6f8',
      note: "A Venetian friar's attempt to show that one set of musical proportions governs scripture, the cosmos, and the measurements of a building. Giorgi's harmonics shaped architecture and Kabbalistic reading for a century after him.",
    },
    {
      book_id: '69568b13be7c607c5f03d575',
      note: 'Quesnay was a court physician before he was an economist, and the Tableau shows it: wealth circulates through the classes of a nation the way blood circulates through a body. It is the first attempt to model an entire economy on a single sheet.',
    },
    {
      book_id: '69568ebc499312f0ff8814dd',
      note: 'Carey prints "Variety in unity is perfection" on the title page, then argues that physical, social and mental laws are one law seen from three sides. Society appears here as a galvanic battery of societary positives and negatives.',
    },
    {
      book_id: '6991d8ab8c1030b12444c551',
      note: 'Mersenne measures strings and pipes with a precision no one had brought to sound before, and does it in order to establish the harmony of the world as a matter of fact. Acoustics and metaphysics are still one subject on these pages.',
    },
  ],
  mentioned: [
    { text: 'Harmonie universelle', book_id: '6991d8ab8c1030b12444c551' },
    { text: "Giorgi's vast Latin treatise on the harmony of the world", book_id: '69528662ab34727b1f04c6f8' },
    { text: 'Hutcheson', book_id: '6956907caeb4b980d9ebd4b8' },
    { text: 'Quesnay', book_id: '69568b13be7c607c5f03d575' },
    { text: 'Bastiat', book_id: '6991dc4879a19ded6bdb3ef9' },
    { text: 'Carey', book_id: '69568ebc499312f0ff8814dd' },
  ],
  todo: [
    { item: 'Saint-Martin entry was substituted for a fabricated id — confirm Des erreurs et de la vérité (1775) is the intended witness', status: 'pending' },
    { item: 'Carey, Principles of Social Science is English but 0% through the translation pipeline; confirm it needs no processing', status: 'pending' },
    { item: 'Pick a quote-band passage and background plate (Fludd or Cellarius engravings are the obvious candidates)', status: 'pending' },
    { item: 'Curate gallery images once a plate selection is made', status: 'pending' },
  ],
};

// ─── Picturing the World ───────────────────────────────────────────────

const PICTURING = {
  slug: 'picturing-the-world-1450-1750',
  name: 'Picturing the World, 1450–1750',
  subtitle: 'Illustrated compendia across four traditions',
  color: 'indigo',
  proposal_id: '6a93e1c70179b0155dabfdad',
  review_note:
    'Built 2026-08-30 from scripts/create-proposed-collections-2026-08.mjs. 22 of the 23 proposed ids resolved; 69b51e49ff09e4fe943ab558 does not exist and the intended Postel cosmography was dropped rather than substituted.',
  description:
    'Scholars in Europe, the Islamic world, China and Japan each tried to gather the whole world into one illustrated book. Their attempts are set side by side here, so the shared ambition and the different visual grammars can be read against one another.',
  expanded_description: [
    'Scholars working in different languages and on opposite sides of the world set themselves the same impossible task: to gather into one illustrated book everything a person would need in order to picture the world.',
    'The ambition took very different visual forms. Schedel\'s chronicle pictures the world as a sequence running from Creation to the present, while the German Ptolemy pictures it as a coordinate grid; al-Qazwini arranges it by wonder, descending from the celestial spheres through minerals and plants to the animals; the Sancai Tuhui builds its entire structure on the triad of Heaven, Earth and Humanity. The writing runs in Latin, German, Arabic, Persian, Literary Chinese and Japanese, so the plates have travelled far more widely than anything they were drawn to illustrate, and the Chinese and Persian compendia appear in English here for the first time.',
    'Placed side by side, the books stop being curiosities and begin answering one another. A world map redrawn in Chinese for Chinese readers sits close to the encyclopaedia that absorbed it, and that encyclopaedia sits beside the Japanese adaptation which inherited its structure, renamed it, and reorganised it for a different court. Inheritance runs in every direction here: a compendium is never the last word on the world, only the version one place made before handing it on.',
  ].join('\n\n'),
  books: [
    '699200a2768b426600239dc3', // Schedel, Nuremberg Chronicle
    '69dbcb571040d1d5e20b5fd2', // Ptolemy, Cosmographia (German)
    '69a682b2b3d8052782b3ccd3', // Apian & Gemma Frisius, Cosmography
    '69c8716b6c6f3cc53c857589', // Münster, Cosmographey
    '6a08aa9026bf28a2268d19ad', // Kircher, Ecstatic Journey
    '69a565d45a8a09c1b325e8f2', // Cellarius, The Harmony of the Macrocosm
    '6953b59b77f38f6761bd990c', // The Book of Curiosities
    '69908ad8285673ff8cb80bac', // al-Qazwini, Wonders of the Lands
    '69907bdc5f855ec553e7177b', // al-Qazwini, ʻAjāʼib al-makhlūqāt (MS Nn.3.74)
    '6992ce273ea667fbac8284fd', // Shilin Guangji
    '6992c8864f3a87912423006f', // Sancai Tuhui (Three Realms)
    '6992cd8b43713c66ea637249', // Sancai Tuhui, Vol. 35
    '69bcebf9ae27b5d80618b7ce', // Sancai Tuhui, Juan 92 (NCL)
    '6992cac1d4d545ae73feeac4', // Diqiu Tushu
    '69af0dce008f8570d42a739b', // Tianwen Milüe
    '6992ce45749d4e56e0690c46', // Lei Jing Tu Yi
    '6992cabdd4d545ae73fee906', // Yixiang Tushu
    '69af12510092756351e44992', // Ricci & Li Zhizao, Complete Map of All Lands
    '69af120ff78a272df25b55d3', // Ricci & Li Zhizao, Armillary Sphere
    '69af12750092756351e44aac', // Ricci, On the Structure of Heaven and Earth
    '6992cabed4d545ae73fee99f', // Qiqi Tushu
    '6a09fca8edaf0f8bef57b6aa', // Terajima Ryōan, Wakan Sansai Zue
  ],
  highlighted: [
    {
      book_id: '6992cd8b43713c66ea637249',
      note: 'The monument of the Chinese encyclopaedic tradition, organised on the triad of Heaven, Earth and Humanity. This volume carries the calendrical wheels, the daylight curves, and the disc of the twenty-four solar terms.',
    },
    {
      book_id: '699200a2768b426600239dc3',
      note: 'The most heavily illustrated book of the first fifty years of printing, telling the world as a chronicle running from Creation to the present. Its city views are the earliest printed portraits of many of the towns they show.',
    },
    {
      book_id: '69907bdc5f855ec553e7177b',
      note: 'A Persian manuscript of the great cosmography of wonders, descending from the celestial spheres through minerals and plants to the animals. It organises the world not by place or by date but by what is marvellous in it.',
    },
    {
      book_id: '69af12510092756351e44992',
      note: 'A European world map redrawn in Chinese, for Chinese readers, with China near the centre. It is the hinge on which two encyclopaedic traditions turned toward one another.',
    },
    {
      book_id: '69c8716b6c6f3cc53c857589',
      note: 'The bestselling description of the world in sixteenth-century Europe, running past a thousand pages of towns, costumes, monsters and maps. Münster made cosmography a commercial genre.',
    },
    {
      book_id: '69a565d45a8a09c1b325e8f2',
      note: 'The most beautiful star atlas ever printed, laying the competing world systems side by side as coloured plates. By this point the cosmological diagram has become a display object in its own right.',
    },
  ],
  mentioned: [
    { text: "Schedel's chronicle", book_id: '699200a2768b426600239dc3' },
    { text: 'the German Ptolemy', book_id: '69dbcb571040d1d5e20b5fd2' },
    { text: 'al-Qazwini', book_id: '69907bdc5f855ec553e7177b' },
    { text: 'Sancai Tuhui', book_id: '6992cd8b43713c66ea637249' },
    { text: 'the Japanese adaptation', book_id: '6a09fca8edaf0f8bef57b6aa' },
  ],
  todo: [
    { item: 'Acquire Zhang Huang, Tushu Bian (圖書編, 1613) — the companion to the Sancai Tuhui and the conspicuous hole in this collection. Harvard-Yenching per-juan PDFs on Wikimedia Commons; Waseda holds another copy', status: 'pending' },
    { item: 'Wakan Sansai Zue covers only juan 1-20 of 105 at ~10% translated; complete from NDL or Waseda scans to make the final link readable rather than gestural', status: 'blocked', blocked_by: 'pipeline' },
    { item: 'A Postel cosmography was proposed but the id was fabricated and no matching record exists; decide whether to source one', status: 'pending' },
    { item: 'Pick a quote-band passage and background plate', status: 'pending' },
  ],
};

// ─── Build ─────────────────────────────────────────────────────────────

async function build(db, spec) {
  console.log(`\n${'='.repeat(72)}\n${spec.name}\n${'='.repeat(72)}`);

  const oids = spec.books.map((id) => new ObjectId(id));
  const docs = await db
    .collection('books')
    .find(
      { _id: { $in: oids } },
      { projection: { title: 1, language: 1, visible: 1, pages_count: 1, pages_translated: 1 } },
    )
    .toArray();

  // Fail loudly rather than quietly building a short collection.
  const found = new Set(docs.map((d) => String(d._id)));
  const missing = spec.books.filter((id) => !found.has(id));
  if (missing.length) {
    throw new Error(`${spec.slug}: ${missing.length} book id(s) do not resolve: ${missing.join(', ')}`);
  }
  const notLive = docs.filter((d) => !(d.visible === true && (d.pages_count || 0) > 0));
  if (notLive.length) {
    console.warn(`  WARNING: ${notLive.length} book(s) are not live and will not render:`);
    notLive.forEach((d) => console.warn(`    ${d._id} ${d.title}`));
  }
  console.log(`  ${docs.length} books resolved, ${docs.length - notLive.length} live`);

  // Language census over the LIVE members only — this is what the page shows.
  const liveDocs = docs.filter((d) => d.visible === true && (d.pages_count || 0) > 0);

  // `book_count` must match what the GRID renders, not what is tagged. The grid
  // (browseBooks, via Supabase) serves readable books, so a member with zero
  // translated pages is tagged and counted but never shown — the counter-gap
  // bug where a card advertises more than its target page renders. Count the
  // readable subset for book_count and keep the full membership in
  // total_book_count.
  const readableDocs = liveDocs.filter((d) => (d.pages_translated || 0) > 0);
  const notReadable = liveDocs.filter((d) => (d.pages_translated || 0) === 0);
  if (notReadable.length) {
    console.log(`  ${notReadable.length} member(s) tagged but not in the grid (0 translated pages):`);
    notReadable.forEach((d) => console.log(`    ${d._id} ${d.title}`));
  }
  const langCounts = {};
  for (const d of liveDocs) {
    const l = d.language || 'Unknown';
    langCounts[l] = (langCounts[l] || 0) + 1;
  }
  const languages = Object.entries(langCounts)
    .map(([lang, count]) => ({ lang, count }))
    .sort((a, b) => b.count - a.count);
  console.log(`  languages: ${languages.map((l) => `${l.lang}(${l.count})`).join(', ')}`);

  const now = new Date();
  const highlighted = spec.highlighted.map((h, i) => {
    const b = docs.find((d) => String(d._id) === h.book_id);
    if (!b) throw new Error(`${spec.slug}: highlighted book ${h.book_id} is not a member`);
    return { ...h, rank: i + 1, tier: 1, title: b.title };
  });

  const doc = {
    slug: spec.slug,
    name: spec.name,
    subtitle: spec.subtitle,
    description: spec.description,
    expanded_description: spec.expanded_description,
    color: spec.color,
    order: 999,
    kind: 'exhibit',
    type: 'curated',
    book_count: readableDocs.length,
    total_book_count: docs.length,
    // sync-worker.mjs recomputes the counters every 2h; set them now so the
    // page does not render zeros in the meantime.
    artwork_count: 0,
    languages,
    highlighted_books: highlighted,
    highlighted_books_at: now,
    important_book_ids: spec.highlighted.map((h) => h.book_id),
    mentioned_books: spec.mentioned,
    featured_images: [],
    visible: true,
    published: true,
    curation_todo: spec.todo,
    updated_at: now,
  };

  if (DRY_RUN) {
    console.log('  [DRY RUN] would tag books and upsert collection');
    console.log(`  book_count=${doc.book_count} highlighted=${highlighted.length} mentioned=${doc.mentioned_books.length}`);
    console.log(`  expanded_description: ${doc.expanded_description.length} chars, ${doc.expanded_description.split('\n\n').length} paragraphs`);
    return;
  }

  // Tag members. $currentDate on updated_at is REQUIRED — see header.
  const tag = await db.collection('books').updateMany(
    { _id: { $in: oids } },
    { $addToSet: { collections: spec.slug }, $currentDate: { updated_at: true } },
  );
  console.log(`  tagged ${tag.modifiedCount} books with '${spec.slug}'`);

  const existing = await db.collection('collections').findOne({ slug: spec.slug });
  if (existing) {
    await db.collection('collections').updateOne({ slug: spec.slug }, { $set: doc });
    console.log(`  updated existing collection '${spec.slug}'`);
  } else {
    await db.collection('collections').insertOne({ ...doc, created_at: now });
    console.log(`  created collection '${spec.slug}'`);
  }

  // Close the loop on the proposal that asked for this. The _id type on
  // collection_proposals is not consistent across writers, so match either.
  const p = await db.collection('collection_proposals').updateOne(
    { $or: [{ _id: spec.proposal_id }, { _id: new ObjectId(spec.proposal_id) }] },
    {
      $set: {
        status: 'approved',
        reviewed_at: now,
        reviewed_by: 'curation',
        created_collection_slug: spec.slug,
        review_note: spec.review_note,
      },
    },
  );
  if (p.matchedCount !== 1) {
    console.warn(`  WARNING: proposal ${spec.proposal_id} not matched (${p.matchedCount}) — still pending`);
  } else {
    console.log('  proposal marked approved');
  }
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  await build(db, HARMONIA);
  await build(db, PICTURING);

  await client.close();

  console.log(`\n${'='.repeat(72)}`);
  if (DRY_RUN) {
    console.log('DRY RUN — nothing written.');
  } else {
    console.log('MANDATORY follow-up. The books grid is served from SUPABASE, and the');
    console.log('page HTML sits behind a 24h Cloudflare cache, so neither updates on its own.');
    console.log('');
    console.log('1. Mirror the new collection tags into Supabase:');
    console.log('     node --env-file=.env.production.local scripts/workers/sync-books-catalog.mjs');
    console.log('');
    console.log('2. Revalidate ISR + purge the CDN for the new paths:');
    console.log('     curl -s -X POST https://sourcelibrary.org/api/admin/revalidate \\');
    console.log('       -H "x-revalidate-secret: $REVALIDATE_SECRET" -H "Content-Type: application/json" \\');
    console.log('       --data \'{"collections": true, "paths": ["/collections", "/collections/harmonia-mundi-economic-order", "/collections/picturing-the-world-1450-1750"]}\'');
    console.log('');
    console.log('3. Verify the GRID is non-empty, not just book_count. A correct book_count');
    console.log('   with an empty books array is the Supabase-sync failure mode:');
    for (const s of [HARMONIA.slug, PICTURING.slug]) {
      console.log(`     curl -s "https://sourcelibrary.org/api/collections/${s}?cb=$RANDOM" | jq '{book_count, books: (.books|length)}'`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
