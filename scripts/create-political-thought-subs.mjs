#!/usr/bin/env node
/**
 * Create sub-collections for history-political-thought and classify books.
 * Also promotes history-political-thought to a top-level collection (removes parent).
 *
 * Usage:
 *   node scripts/create-political-thought-subs.mjs [--dry-run] [--skip-gemini]
 */

import { MongoClient } from 'mongodb';
import { GoogleGenAI } from '@google/genai';

const MONGODB_URI = process.env.MONGODB_URI;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SKIP_GEMINI = args.includes('--skip-gemini');

const PARENT_SLUG = 'history-political-thought';

const SUBCOLLECTIONS = [
  {
    slug: 'ancient-historiography',
    name: 'Ancient Historiography',
    subtitle: 'Herodotus, Thucydides, Polybius, Plutarch, Xenophon — the Greek and Roman historians who invented the genre',
  },
  {
    slug: 'late-antique-byzantine-history',
    name: 'Late Antique & Byzantine History',
    subtitle: 'Procopius, Jordanes, Cassiodorus, Psellus — the historians of Rome\'s long afterlife',
  },
  {
    slug: 'renaissance-political-thought',
    name: 'Renaissance Political Thought',
    subtitle: 'Machiavelli, More, Campanella, Bacon — the rediscovery of politics as a secular art',
  },
  {
    slug: 'enlightenment-political-philosophy',
    name: 'Enlightenment Political Philosophy',
    subtitle: 'Rousseau, Montesquieu, Vico, Hegel — reason applied to the state and the progress of history',
  },
  {
    slug: 'socialist-revolutionary-thought',
    name: 'Socialist & Revolutionary Thought',
    subtitle: 'Marx, Engels, Gramsci, Luxemburg, Proudhon — the critique of capital and the dream of a new order',
  },
  {
    slug: 'russian-political-thought',
    name: 'Russian Political Thought',
    subtitle: 'Herzen, Leontiev, Kropotkin, Struve — Slavophiles, anarchists, and the Russian political imagination',
  },
  {
    slug: 'political-economy',
    name: 'Political Economy',
    subtitle: 'Bastiat, Cantillon, Mandeville, Oresme — money, trade, and the economic foundations of political order',
  },
  {
    slug: 'military-strategic-writing',
    name: 'Military & Strategic Writing',
    subtitle: 'Sun Tzu, Vegetius, Frontinus — the theory and practice of war from antiquity to early modernity',
  },
  {
    slug: 'roman-canon-law',
    name: 'Roman & Canon Law',
    subtitle: 'Justinian, the Theodosian Code, Basel theses — the legal architecture of the Western world',
  },
  {
    slug: 'asian-historical-texts',
    name: 'Asian Historical Texts',
    subtitle: 'Ferdowsi, the Three Kingdoms, the Glass Palace Chronicle — history beyond the Mediterranean',
  },
];

// ─── Rule-based classification ───

function lc(s) { return (s || '').toLowerCase(); }

function classify(b) {
  const t = lc(b.title);
  const a = lc(b.author);
  const cats = (b.categories || []).map(lc);
  const lang = lc(b.language);
  const year = b.year || 0;

  // ── Ancient Historiography ──
  // Greek historians
  if (a.includes('herodot') || a.includes('thucydid') || a.includes('polybius')
    || a.includes('plutarch') || a.includes('xenophon') || a.includes('diodorus')
    || a.includes('strabo') || a.includes('diogenes laertius') || a.includes('dio chrysostom')
    || a.includes('eunapius'))
    return 'ancient-historiography';
  // Roman historians
  if (a.includes('tacitus') || a.includes('livy') || a.includes('titi livi')
    || a.includes('suetonius') || a.includes('ammianus') || a.includes('sallust')
    || a.includes('valerius maximus') || a.includes('lucan') || a.includes('frontinus')
    || a.includes('justinus'))
    return 'ancient-historiography';
  // Plato Laws in this collection (political)
  if (a.includes('plato') && (t.includes('law') || t.includes('republic')))
    return 'ancient-historiography';
  // Cicero political works
  if (a.includes('cicero'))
    return 'ancient-historiography';

  // ── Late Antique & Byzantine ──
  if (a.includes('procopius') || a.includes('jordanes') || a.includes('cassiodor')
    || a.includes('psellus') || a.includes('malalas') || a.includes('orosius')
    || a.includes('bede') || a.includes('leo the deacon') || a.includes('julianus apostata')
    || a.includes('julian') || t.includes('historia augustae')
    || t.includes('historiae augustae') || t.includes('scriptores historiae augustae')
    || a.includes('elishe') || a.includes('eghishe') || a.includes('grigor of akner')
    || t.includes('theodosiani') || t.includes('corpus scriptorum historiae byzantinae'))
    return 'late-antique-byzantine-history';

  // ── Military & Strategic Writing ──
  if (a.includes('sun tzu') || t.includes('art of war') || t.includes('strategematon')
    || t.includes('strategicon') || t.includes('velitatione') || t.includes('武備志')
    || t.includes('epitoma rei militaris') || t.includes('apparatus bellicus')
    || a.includes('vegetius') || a.includes('frontinus')
    || t.includes('stratagems'))
    return 'military-strategic-writing';

  // ── Roman & Canon Law ──
  if (a.includes('justinian') || t.includes('corpus iuris') || t.includes('digest')
    || t.includes('statuta') || t.includes('theses') || t.includes('conclusiones')
    || t.includes('disputatio') || t.includes('enunciationes') || t.includes('positiones')
    || t.includes('quaestiones') || t.includes('inauguralis')
    || t.includes('privilegiorum') || t.includes('instrumentum pacis')
    || t.includes('rechten ende vryheden')
    || t.includes('pactis') || t.includes('testamentis') || t.includes('de donationibus')
    || t.includes('de fideiussoribus') || t.includes('de appellationibus')
    || t.includes('de interdictis') || t.includes('de rebus nullius')
    || t.includes('de mandatis') || t.includes('de inofficioso')
    || t.includes('de contractu emphyteutico')
    || t.includes('iudicii practici') || t.includes('de testamentis')
    || t.includes('de consuetudine') || t.includes('de aerario'))
    return 'roman-canon-law';

  // ── Renaissance Political Thought ──
  if (a.includes('machiavell') || a.includes('guicciardini') || a.includes('thomas more')
    || a.includes('campanella') || a.includes('bacon') || a.includes('boccalini')
    || a.includes('castiglione') || a.includes('naudé') || a.includes('naude')
    || a.includes('bruni') || a.includes('salutati') || a.includes('poggio')
    || a.includes('bembo') || a.includes('roscoe') || a.includes('landucci')
    || a.includes('janet ross') || a.includes('simmler') || a.includes('besold')
    || a.includes('andreae'))
    return 'renaissance-political-thought';
  if (t.includes('pasquillorum') || t.includes('utopia') || t.includes('christianopolitanae')
    || t.includes('de claris mulieribus') || t.includes('cleres dames')
    || t.includes('claris selectisque') || t.includes('delle donne famose')
    || t.includes('von etlichen frowen') || t.includes('de mulieribus claris')
    || t.includes('de potestate papae') || a.includes('boccaccio') || a.includes('foresti'))
    return 'renaissance-political-thought';
  // Elzevir Respublica series
  if (t.includes('respublica') || t.includes('de imperio'))
    return 'renaissance-political-thought';
  // Mornay, Fessler
  if (a.includes('mornay') || a.includes('fessler'))
    return 'renaissance-political-thought';

  // ── Socialist & Revolutionary Thought ──
  if (a.includes('marx') || a.includes('engels') || a.includes('gramsci')
    || a.includes('luxemburg') || a.includes('proudhon') || a.includes('sorel')
    || a.includes('lukács') || a.includes('lukacs') || a.includes('stirner')
    || a.includes('godwin') || a.includes('stanton'))
    return 'socialist-revolutionary-thought';

  // ── Russian Political Thought ──
  if (a.includes('herzen') || a.includes('герцен') || a.includes('леонтьев') || a.includes('leontiev')
    || a.includes('kropotkin') || a.includes('кропоткин')
    || a.includes('struve') || a.includes('karsavin') || a.includes('карсавин')
    || a.includes('frank') || a.includes('лосский') || a.includes('lossky')
    || a.includes('ленин') || a.includes('lenin')
    || a.includes('щербатов') || a.includes('радищев')
    || a.includes('радищева') || a.includes('радищевъ')
    || lang === 'russian')
    return 'russian-political-thought';

  // ── Enlightenment Political Philosophy ──
  if (a.includes('rousseau') || a.includes('montesquieu') || a.includes('vico')
    || a.includes('beccaria') || a.includes('helvétius') || a.includes('helvetius')
    || a.includes('condorcet') || a.includes('voltaire') || a.includes('mandeville')
    || a.includes('hegel') || a.includes('herder') || a.includes('fichte')
    || a.includes('schiller') || a.includes('tocqueville')
    || a.includes('bastiat') || a.includes('cantillon'))
    return 'enlightenment-political-philosophy';
  // Jurieu, Lacroix, etc.
  if (a.includes('jurieu') || a.includes('lacroix'))
    return 'enlightenment-political-philosophy';

  // ── Political Economy ──
  if (a.includes('oresme') || a.includes('davanzati') || a.includes('weber')
    || a.includes('durkheim') || a.includes('simmel') || a.includes('dilthey'))
    return 'political-economy';
  if (t.includes('monnoies') || t.includes('monete') || t.includes('monetaria'))
    return 'political-economy';

  // ── Asian Historical Texts ──
  if (a.includes('ferdowsi') || t.includes('shahnama') || t.includes('三國志')
    || t.includes('three kingdoms') || t.includes('glass palace')
    || t.includes('nihongi') || t.includes('korean repository')
    || t.includes('malay annals') || t.includes('sejarah melayu')
    || t.includes('royal asiatic') || t.includes('korean')
    || a.includes('legge') || t.includes('ch\'un ts\'ew') || t.includes('spring and autumn')
    || a.includes('leyden') || a.includes('raffles')
    || a.includes('aston') || a.includes('pe maung'))
    return 'asian-historical-texts';

  // ── Bodleian/misc manuscripts ──
  if (t.includes('bodleian') || t.includes('barocci'))
    return 'ancient-historiography';

  // Ennemoser / Bridges (history of ideas)
  if (a.includes('ennemoser') || a.includes('bridges'))
    return 'enlightenment-political-philosophy';

  // Stijl / Stinstra (Dutch biographical)
  if (t.includes('levensbeschryving'))
    return 'enlightenment-political-philosophy';

  // Mockelius political disputations
  if (a.includes('mockelius') || t.includes('quaestionum politicarum'))
    return 'roman-canon-law';

  // Brihaspati Sutra (Indian political treatise)
  if (a.includes('brihaspati'))
    return 'asian-historical-texts';

  // Demosthenes (Greek orator/political)
  if (a.includes('demosthenes'))
    return 'ancient-historiography';

  // Cardinal Bessarion, Pius II, Sixtus — Renaissance papal politics
  if (a.includes('bessarion') || a.includes('pius ii') || a.includes('sixtus')
    || t.includes('dissentio inter papam') || t.includes('contra turcos')
    || t.includes('commentarii rerum memorabilium'))
    return 'renaissance-political-thought';

  return null;
}

// ─── Gemini classification ───

async function classifyWithGemini(ai, books) {
  const subDescriptions = SUBCOLLECTIONS.map(s =>
    `- "${s.slug}": ${s.name} — ${s.subtitle}`
  ).join('\n');

  const results = [];
  const BATCH = 30;

  for (let i = 0; i < books.length; i += BATCH) {
    const batch = books.slice(i, i + BATCH);
    const bookList = batch.map((b, idx) =>
      `${idx + 1}. "${b.display_title || b.title}" by ${b.author || 'Unknown'} (${b.year || '?'}, ${b.language || '?'}) [categories: ${(b.categories || []).join(', ') || 'none'}]`
    ).join('\n');

    const prompt = `You are classifying books in the "history-political-thought" collection into sub-collections.

Sub-collections:
${subDescriptions}

For each book below, respond with ONLY the sub-collection slug, or "none" if it doesn't fit any well. One line per book, format: "NUMBER: SLUG"

Books:
${bookList}`;

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite-preview',
        contents: prompt,
      });
      const text = response.text || '';
      const lines = text.trim().split('\n');
      for (const line of lines) {
        const match = line.match(/^(\d+):\s*(\S+)/);
        if (match) {
          const idx = parseInt(match[1]) - 1;
          const slug = match[2].toLowerCase().replace(/"/g, '');
          if (idx >= 0 && idx < batch.length && slug !== 'none') {
            const validSlugs = SUBCOLLECTIONS.map(s => s.slug);
            if (validSlugs.includes(slug)) {
              results.push({ bookId: batch[idx].id, subSlug: slug });
            }
          }
        }
      }
    } catch (err) {
      console.error(`  Gemini batch error (offset ${i}):`, err.message);
    }

    if (i + BATCH < books.length) await new Promise(r => setTimeout(r, 1000));
  }

  return results;
}

// ─── Main ───

async function main() {
  const client = await MongoClient.connect(MONGODB_URI);
  const db = client.db('bookstore');
  const ai = GEMINI_KEY ? new GoogleGenAI({ apiKey: GEMINI_KEY }) : null;

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  HISTORY & POLITICAL THOUGHT — SUB-COLLECTIONS`);
  console.log(`${'═'.repeat(60)}`);

  // Step 1: Promote to top-level collection (remove parent)
  const parent = await db.collection('collections').findOne({ slug: PARENT_SLUG });
  if (!parent) { console.error('Collection not found!'); process.exit(1); }

  if (parent.parent) {
    if (DRY_RUN) {
      console.log(`  [dry-run] Would remove parent "${parent.parent}" (promote to top-level)`);
    } else {
      await db.collection('collections').updateOne(
        { slug: PARENT_SLUG },
        { $unset: { parent: '' }, $set: { updated_at: new Date() } }
      );
      console.log(`  Promoted to top-level (removed parent: "${parent.parent}")`);
    }
  } else {
    console.log(`  Already top-level`);
  }

  // Step 2: Create sub-collection documents
  let totalCreated = 0;
  for (const sub of SUBCOLLECTIONS) {
    const exists = await db.collection('collections').findOne({ slug: sub.slug });
    if (exists) {
      console.log(`  [exists] ${sub.slug}`);
      continue;
    }
    if (DRY_RUN) {
      console.log(`  [dry-run] Would create: ${sub.slug}`);
    } else {
      await db.collection('collections').insertOne({
        slug: sub.slug,
        name: sub.name,
        subtitle: sub.subtitle,
        parent: PARENT_SLUG,
        book_count: 0,
        hidden: false,
        visible: true,
        type: 'category',
        order: 0,
        languages: [],
        featured_images: [],
        created_at: new Date(),
      });
      console.log(`  [created] ${sub.slug}`);
      totalCreated++;
    }
  }

  // Step 3: Fetch all books in the collection
  const books = await db.collection('books').find(
    { collections: PARENT_SLUG, status: { $ne: 'deleted' }, hidden: { $ne: true } },
    { projection: { id: 1, title: 1, display_title: 1, author: 1, year: 1, language: 1, categories: 1, collections: 1 } },
  ).toArray();
  console.log(`\n  ${books.length} books in ${PARENT_SLUG}`);

  const validSlugs = new Set(SUBCOLLECTIONS.map(s => s.slug));
  const assigned = new Map();
  const alreadyAssigned = [];

  // Check already-assigned
  for (const book of books) {
    const existing = (book.collections || []).find(c => validSlugs.has(c));
    if (existing) {
      alreadyAssigned.push(book.id);
      assigned.set(book.id, existing);
    }
  }
  if (alreadyAssigned.length > 0) {
    console.log(`  ${alreadyAssigned.length} already in a sub-collection`);
  }

  // Pass 1: Rule-based
  const unassigned = books.filter(b => !assigned.has(b.id));
  for (const book of unassigned) {
    const sub = classify(book);
    if (sub && validSlugs.has(sub)) {
      assigned.set(book.id, sub);
    }
  }
  const ruleAssigned = assigned.size - alreadyAssigned.length;
  console.log(`  Rule-based: ${ruleAssigned} assigned`);

  // Pass 2: Gemini for remaining
  const stillUnassigned = books.filter(b => !assigned.has(b.id));
  let totalGemini = 0;
  if (stillUnassigned.length > 0 && ai && !SKIP_GEMINI) {
    console.log(`  Gemini pass: ${stillUnassigned.length} remaining...`);
    const geminiResults = await classifyWithGemini(ai, stillUnassigned);
    for (const { bookId, subSlug } of geminiResults) {
      if (validSlugs.has(subSlug)) {
        assigned.set(bookId, subSlug);
        totalGemini++;
      }
    }
    console.log(`  Gemini assigned: ${geminiResults.length}`);
  } else if (stillUnassigned.length > 0 && !SKIP_GEMINI) {
    console.log(`  ${stillUnassigned.length} unassigned (no Gemini key)`);
  }

  // Show distribution
  const dist = {};
  for (const [, sub] of assigned) {
    dist[sub] = (dist[sub] || 0) + 1;
  }
  console.log(`\n  Distribution:`);
  for (const sub of SUBCOLLECTIONS) {
    console.log(`    ${sub.name}: ${dist[sub.slug] || 0}`);
  }
  const finalUnassigned = books.filter(b => !assigned.has(b.id));
  if (finalUnassigned.length > 0) {
    console.log(`    [unassigned]: ${finalUnassigned.length}`);
    for (const b of finalUnassigned) {
      console.log(`      - "${b.title}" by ${b.author || '?'}`);
    }
  }

  // Apply assignments
  const newAssignments = [...assigned.entries()].filter(([id]) => !alreadyAssigned.includes(id));
  if (newAssignments.length > 0 && !DRY_RUN) {
    const bulkOps = newAssignments.map(([bookId, subSlug]) => ({
      updateOne: {
        filter: { id: bookId },
        update: { $addToSet: { collections: subSlug } },
      },
    }));
    const result = await db.collection('books').bulkWrite(bulkOps);
    console.log(`\n  Applied: ${result.modifiedCount} books updated`);
  } else if (DRY_RUN) {
    console.log(`\n  [dry-run] Would assign ${newAssignments.length} books`);
  }

  // Update book counts on sub-collections
  if (!DRY_RUN) {
    for (const sub of SUBCOLLECTIONS) {
      const count = [...assigned.values()].filter(s => s === sub.slug).length;
      await db.collection('collections').updateOne(
        { slug: sub.slug },
        { $set: { book_count: count, updated_at: new Date() } }
      );
    }
    console.log(`  Updated book counts`);
  }

  console.log(`\n  Summary: ${totalCreated} created, ${ruleAssigned} rule-assigned, ${totalGemini} Gemini-assigned`);
  console.log(`  Total classified: ${assigned.size}/${books.length}`);

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
