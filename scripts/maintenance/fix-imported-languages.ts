/**
 * One-shot fix: Update language metadata for the 90 books imported on 2026-02-15.
 * The batch import scripts sent `original_language` but the IA route expects `language`,
 * so all books got `language: 'Unknown'`.
 *
 * Run: secret-lover run -- npx tsx scripts/fix-imported-languages.ts
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI!;
const DB_NAME = 'bookstore';

// All IA identifiers from the two batch import scripts, mapped to correct language.
// Source: scripts/batch-import-new-thought.ts, scripts/batch-import-swedenborg-expanded.ts

const LANGUAGE_MAP: Record<string, string> = {};

// Atkinson (all pseudonyms) — English
const atkinsonIds = [
  'mindpowersecret00atkigoog', 'thoughtforceinb00atkigoog', 'innerconsciousn00atkigoog',
  'memoryhowtodeve00atkigoog', 'yourmindandhowt00atkigoog', 'practicalmindre00atkigoog',
  'theartoflogicalt41838gut', 'dynamicthoughtor00atkirich', 'howtoreadhumanna41501gut',
  'psychologysales00atkigoog', 'thoughtcultureor41519gut', 'practicalpsychom43954gut',
  'nuggetsofnewthou00atki', 'lawnewthoughtas01atkigoog',
  'PracticalMentalInfluenceACourseOfLessonsOnMentalVibrations',
  'reincarnationand26364gut', 'TheSecretOfSuccess_201303', 'mindandbodyormen44029gut',
  'in.ernet.dli.2015.62474', 'atkinson-1907-mental-fasc', 'rkas.1937.memoryculture0000will',
  'the-mystery-of-sex-or-sex-polarity', '1911vril',
  'the-arcane-teachings-of-william-walker-atkinson', 'arcaneformulaso00atkigoog',
  'suggestionautosu0000unse', 'seriesoflessonsi00atki',
  'william-walker-atkinson-self-healing-by-thought-force', 'correspondencec00atkigoog',
  // Ramacharaka
  'in.ernet.dli.2015.47927', 'hathayogawithnu00ramagoog', 'in.ernet.dli.2015.222142',
  'advancedcoursein0000yogi', 'seriesoflessonsi00rama', 'seriesoflessonsi0000yogi',
  'scienceofpsychic00rama', 'mysticchristiani0000yogi', 'ThePhilosophiesAndReligionsOfIndia',
  'lifebeyonddeath', 'gtu_A32400006343390B',
  // Dumont
  'powerconcentrat00dumogoog', 'isbn_0787303011', 'b28069183', 'mentaltherapeut00dumogoog',
  'solarplexusorab00dumogoog', 'practicalmemoryt0000ther', 'the-master-mind',
  // Panchadasi
  'clairvoyanceoccu00panciala', 'human_aura_panchadasi',
  // Other pseudonyms
  'the-secret-doctrine-of-the-rosicrucians-magus-incognito-1918', 'atkinson-1913-vim-culture-copy',
];
for (const id of atkinsonIds) LANGUAGE_MAP[id] = 'English';

// Mesmerism — French
const frenchMesmerism = [
  'b28780875', // Mesmer
  'b22324665', // Franklin commission
  'considrationss00berg', // Bergasse
  'dumagntismeanima00chas', // Puysegur
  'BIUSante_54669', // Puysegur
  'instructionprati00dele', // Deleuze (French original)
];
for (const id of frenchMesmerism) LANGUAGE_MAP[id] = 'French';

// Mesmerism — German
LANGUAGE_MAP['mesmerismusoder00wolfgoog'] = 'German';

// Mesmerism — English (translations/English originals)
const englishMesmerism = [
  'practicalinstruc00dele', // Deleuze (English translation)
  'isisrevelataani03colqgoog', 'historyofmagicwi00colqrich', 'historyofmagicwi01colq',
  'factsinmesmeris00town', 'practicalmanualo00test', 'animalmagnetism00binerich',
  'b21931136', '63721400R.nlm.nih.gov', 'researchesonmag00greggoog',
  'reportofexperime00acad', 'anintroductiont01conggoog', 'letterstocandidi00greg',
];
for (const id of englishMesmerism) LANGUAGE_MAP[id] = 'English';

// Swedenborg — Latin (originals, published as English translations)
const swedenborgLatin = [
  'divineloveanddi00sweduoft', 'divineprovidence00sweduoft', 'conjugialloveaf00sweduoft',
  'apocalypseexplained01swed', 'apocalypseexplai02swed', 'apocalypseexplai03sweduoft',
  'apocalypseexplai05sweduoft', 'apocalypseexplained06swed',
  'soulsorrational00sweduoft', 'principiaorfirst00sweduoft',
  // Expanded import
  'apocalypseexplai04swed_0',
  'heavenitswonderss00swed', 'truechristianrel01swed', 'truechristianrel02swed',
  'fourleadingdoctrin00swed', 'miscellaneousthe01swed', 'compendiumoftheo00swed',
  'cu31924007550027',
  'arcanacoelestiah01swed', 'arcanacoelestiah02swed',
  'arcanacoelestiah06swed', 'arcanacoelestiah07swed', 'arcanacoelestiah08swed',
  'arcanacoelestiah09swed', 'arcanacoelestiah10swed', 'arcanacoelestiah11swed',
  'arcanacoelestiah12swed',
];
for (const id of swedenborgLatin) LANGUAGE_MAP[id] = 'Latin';

// Swedenborg — Swedish (Journal of Dreams)
LANGUAGE_MAP['emanuelswedenbor00swed'] = 'Swedish';

async function main() {
  console.log(`Fix language metadata for ${Object.keys(LANGUAGE_MAP).length} imported books\n`);

  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(DB_NAME);

  let updated = 0;
  let notFound = 0;
  let alreadyCorrect = 0;

  for (const [iaId, correctLanguage] of Object.entries(LANGUAGE_MAP)) {
    const book = await db.collection('books').findOne({
      $or: [
        { ia_identifier: iaId },
        { 'image_source.identifier': iaId },
      ],
    });

    if (!book) {
      console.log(`  NOT FOUND: ${iaId}`);
      notFound++;
      continue;
    }

    if (book.language === correctLanguage) {
      alreadyCorrect++;
      continue;
    }

    await db.collection('books').updateOne(
      { _id: book._id },
      { $set: { language: correctLanguage, updated_at: new Date() } },
    );
    console.log(`  FIXED: "${book.title}" ${book.language} -> ${correctLanguage}`);
    updated++;
  }

  console.log(`\nDone: ${updated} updated, ${alreadyCorrect} already correct, ${notFound} not found`);
  await client.close();
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
