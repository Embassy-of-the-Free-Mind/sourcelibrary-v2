#!/usr/bin/env node
/**
 * Backfill work_id for books that are different editions/manuscripts of the same work.
 *
 * Strategy:
 * 1. Define canonical works with title patterns (regex) and a slug
 * 2. Match books against patterns
 * 3. Only assign work_id where 2+ books match (no point linking a singleton)
 * 4. Write to MongoDB
 *
 * Run: set -a; source .env.production.local; set +a; node scripts/backfill-work-ids.mjs [--dry-run]
 */
import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');

// Canonical works: [work_id_slug, title_pattern, optional_author_pattern]
// Patterns match against normalized_title (lowercased) or title
const WORKS = [
  // === ZOHAR / KABBALAH ===
  ['zohar', /\bzohar\b/i, null],
  ['sefer-yetzirah', /\bsefer\s*(ha-?)?\s*yetzirah\b|yetzir[ao]h|book\s*of\s*formation/i, null],
  ['sefer-raziel', /\bsefer\s*(ha-?)?\s*raziel\b|liber\s*raziel/i, null],
  ['sefer-ha-peliah', /\bsefer\s*(ha-?)?\s*peli['ʾ]?ah\b/i, null],
  ['pardes-rimonim', /\bpardes\s*rimonim\b|orchard.*pomegranate/i, null],

  // === HERMETICA ===
  ['corpus-hermeticum', /\bcorpus\s*hermeticum\b|poimandres|pimander|asclepius.*hermet/i, null],
  ['tabula-smaragdina', /\btabula\s*smaragdina\b|emerald\s*tablet/i, null],
  ['picatrix', /\bpicatrix\b|ghayat\s*al-?hakim/i, null],

  // === ALCHEMY ===
  ['turba-philosophorum', /\bturba\s*philosophorum\b/i, null],
  ['splendor-solis', /\bsplendor\s*solis\b/i, null],
  ['atalanta-fugiens', /\batalanta\s*fugiens\b/i, null],
  ['mutus-liber', /\bmutus\s*liber\b/i, null],
  ['rosarium-philosophorum', /\brosarium\s*philosophorum\b/i, null],

  // === NEOPLATONISM ===
  ['plotinus-enneads', /\bennead/i, /plotin/i],
  ['proclus-elements-theology', /\belements?\s*(of\s*)?theolog/i, /proclus/i],
  ['iamblichus-de-mysteriis', /\bde\s*mysteriis\b/i, /iamblich/i],

  // === PLATO ===
  ['plato-republic', /\brepublic\b|politeia/i, /plat[eo]n?$/i],
  ['plato-timaeus', /\btimaeus\b|timae/i, /plat[eo]n?$/i],
  ['plato-symposium', /\bsymposium\b/i, /plat[eo]n?$/i],

  // === ARISTOTLE ===
  ['aristotle-metaphysics', /\bmetaphysic/i, /aristot/i],
  ['aristotle-nicomachean-ethics', /\bnicomachean|ethic.*nicomach/i, /aristot|argyropoul/i],

  // === CICERO ===
  ['cicero-epistulae-ad-atticum', /\bad\s*atticum\b/i, /cicer/i],
  ['cicero-epistulae-ad-familiares', /\bad\s*familiar/i, /cicer/i],
  ['cicero-epistulae', /\bcorrespondence\b.*cicer|epistul.*cicer|cicer.*epistul/i, null],

  // === SENECA ===
  ['seneca-epistulae-morales', /\bad\s*lucilium\b|epistulae\s*morales/i, /senec/i],

  // === PLINY ===
  ['pliny-letters', /\bletters?\b.*\bpanegyric/i, /plin/i],

  // === CHURCH FATHERS ===
  ['palamas-triads', /\btriads?\b.*hesychast|defense.*hesychast|défense.*hésychast/i, null],
  ['palamas-works', /\bpalamas\b/i, null],
  ['augustine-epistulae', /\bepistul/i, /augustin/i],
  ['jerome-epistulae', /\bepistul/i, /jerome|hieronym/i],
  ['basil-epistulae', /\bepistul/i, /basil.*caesare/i],

  // === PATROLOGIA ===
  ['patrologia-graeca', /\bpatrologia\s*graeca\b/i, null],
  ['patrologia-latina', /\bpatrologia\s*latina\b/i, null],

  // === RENAISSANCE ===
  ['ficino-epistolae', /\bepistol/i, /ficin/i],
  ['erasmus-epistolae', /\bepistol.*opus|opus.*epistol/i, /erasm/i],
  ['pico-opera', /\bopera\b/i, /\bpico\b/i],

  // === SCIENTIFIC REVOLUTION ===
  ['galileo-opere', /\bopere\b|le\s*opere/i, /galile/i],
  ['kepler-opera', /\bopera\b/i, /kepler/i],
  ['brahe-opera', /\bopera\b/i, /brahe/i],
  ['newton-correspondence', /\bcorrespond/i, /newton/i],
  ['descartes-oeuvres', /\boeuvres\b|\bcorrespondance\b/i, /descartes/i],
  ['leibniz-correspondence', /\bbriefwechsel\b|\bphilosophisch.*schrift|\bnouvelles\s*lettres/i, /leibniz/i],
  ['spinoza-opera', /\bopera\b/i, /spinoz/i],

  // === PERSIAN / ARABIC ===
  ['rumi-diwan', /\bdiwan.*shams|divan.*shams|diwan-e\s*shams/i, /rumi|jalal/i],
  ['firdausi-shahnama', /\bshahnam[ae]\b|book\s*of\s*kings/i, /firdaus|ferdows/i],
  ['nizami-khamsa', /\bkhamsa\b|five\s*poems/i, /nizami/i],
  ['sadi-gulistan', /\bgulistan\b|rose\s*garden/i, /sa['ʿ]?di/i],
  ['avicenna-shifa', /\bshifa\b|\bal-?shifa/i, /ibn\s*sina|avicenn/i],
  ['al-sufi-constellations', /\bconstellations?\b|suwar.*kawakib/i, /al-?sufi/i],
  ['ibn-al-nadim-fihrist', /\bfihrist\b/i, /ibn.*nadim/i],
  ['al-ghazali-ihya', /\bihya\b|revival.*religious/i, /ghazal/i],
  ['qazvini-wonders', /\bwonders.*creation|athar.*bilad|aja[ʾi]b/i, /qazvin/i],

  // === DEE / OCCULT ===
  ['dee-faithful-relation', /\btrue.*faithful\s*relat/i, /dee/i],

  // === GROTIUS ===
  ['grotius-epistolae', /\bepistol/i, /grotius/i],

  // === MGH ===
  ['mgh-epistolae', /\bmgh\s*epistolae\b|monumenta.*epistol|epistolae.*merovingic/i, null],
];

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  // Fetch all books with title and author
  const allBooks = await books.find(
    {},
    { projection: { id: 1, title: 1, display_title: 1, author: 1, normalized_title: 1, normalized_author: 1, work_id: 1 } }
  ).toArray();

  console.log(`Loaded ${allBooks.length} books\n`);

  // Match books to works
  const workMatches = new Map(); // work_id -> [book_ids]

  for (const book of allBooks) {
    const title = book.title || '';
    const displayTitle = book.display_title || '';
    const author = book.author || '';
    const normTitle = book.normalized_title || title.toLowerCase();
    const normAuthor = book.normalized_author || author.toLowerCase();
    const combined = `${title} ${displayTitle}`;

    for (const [workId, titlePattern, authorPattern] of WORKS) {
      const titleMatch = titlePattern.test(combined) || titlePattern.test(normTitle);
      if (!titleMatch) continue;

      if (authorPattern && !authorPattern.test(author) && !authorPattern.test(normAuthor)) continue;

      if (!workMatches.has(workId)) workMatches.set(workId, []);
      workMatches.get(workId).push(book);
      break; // First match wins — avoid double-counting
    }
  }

  // Filter to works with 2+ books (no point linking singletons)
  const multiEditionWorks = [...workMatches.entries()].filter(([, books]) => books.length >= 2);

  console.log(`Found ${multiEditionWorks.length} works with multiple editions:\n`);

  let totalUpdated = 0;
  for (const [workId, matchedBooks] of multiEditionWorks.sort((a, b) => b[1].length - a[1].length)) {
    const alreadySet = matchedBooks.filter(b => b.work_id === workId).length;
    const needsUpdate = matchedBooks.filter(b => b.work_id !== workId);

    console.log(`${workId}: ${matchedBooks.length} editions (${alreadySet} already set, ${needsUpdate.length} to update)`);
    for (const b of matchedBooks.slice(0, 5)) {
      const marker = b.work_id === workId ? '  ✓' : '  →';
      console.log(`${marker} ${b.title?.substring(0, 70)} [${b.id}]`);
    }
    if (matchedBooks.length > 5) console.log(`  ... and ${matchedBooks.length - 5} more`);

    if (!DRY_RUN && needsUpdate.length > 0) {
      const ids = needsUpdate.map(b => b.id);
      const result = await books.updateMany(
        { id: { $in: ids } },
        { $set: { work_id: workId } }
      );
      totalUpdated += result.modifiedCount;
    }
    console.log();
  }

  if (DRY_RUN) {
    console.log(`DRY RUN — would update ${multiEditionWorks.reduce((s, [, b]) => s + b.filter(x => x.work_id !== multiEditionWorks[0][0]).length, 0)} books`);
  } else {
    console.log(`Updated ${totalUpdated} books with work_ids`);
  }

  // Summary
  const singletons = [...workMatches.entries()].filter(([, books]) => books.length === 1);
  console.log(`\nSummary:`);
  console.log(`  ${multiEditionWorks.length} works with multiple editions`);
  console.log(`  ${multiEditionWorks.reduce((s, [, b]) => s + b.length, 0)} books linked`);
  console.log(`  ${singletons.length} singleton matches (not linked)`);
  console.log(`  ${allBooks.length - [...workMatches.values()].reduce((s, b) => s + b.length, 0)} books unmatched`);

  await client.close();
}

main().catch(console.error);
