/**
 * Batch import: Atkinson (all pseudonyms), Mesmerism/Magnetism, and Swedenborg
 * Run: secret-lover run -- npx tsx scripts/batch-import-new-thought.ts
 */

const BASE_URL = 'https://sourcelibrary.org';

interface ImportItem {
  ia_identifier: string;
  title: string;
  author: string;
  year: number;
  original_language: string;
}

// ============================================================
// ATKINSON (own name)
// ============================================================
const ATKINSON: ImportItem[] = [
  { ia_identifier: 'mindpowersecret00atkigoog', title: 'Mind-Power: The Secret of Mental Magic', author: 'William Walker Atkinson', year: 1912, original_language: 'English' },
  { ia_identifier: 'thoughtforceinb00atkigoog', title: 'Thought-Force in Business and Everyday Life', author: 'William Walker Atkinson', year: 1901, original_language: 'English' },
  { ia_identifier: 'innerconsciousn00atkigoog', title: 'The Inner Consciousness', author: 'William Walker Atkinson', year: 1908, original_language: 'English' },
  { ia_identifier: 'memoryhowtodeve00atkigoog', title: 'Memory: How to Develop, Train, and Use It', author: 'William Walker Atkinson', year: 1909, original_language: 'English' },
  { ia_identifier: 'yourmindandhowt00atkigoog', title: 'Your Mind and How to Use It', author: 'William Walker Atkinson', year: 1911, original_language: 'English' },
  { ia_identifier: 'practicalmindre00atkigoog', title: 'Practical Mind Reading', author: 'William Walker Atkinson', year: 1908, original_language: 'English' },
  { ia_identifier: 'theartoflogicalt41838gut', title: 'The Art of Logical Thinking', author: 'William Walker Atkinson', year: 1909, original_language: 'English' },
  { ia_identifier: 'dynamicthoughtor00atkirich', title: 'Dynamic Thought; or, The Law of Vibrant Energy', author: 'William Walker Atkinson', year: 1906, original_language: 'English' },
  { ia_identifier: 'howtoreadhumanna41501gut', title: 'How to Read Human Nature', author: 'William Walker Atkinson', year: 1913, original_language: 'English' },
  { ia_identifier: 'psychologysales00atkigoog', title: 'The Psychology of Salesmanship', author: 'William Walker Atkinson', year: 1912, original_language: 'English' },
  { ia_identifier: 'thoughtcultureor41519gut', title: 'Thought-Culture; or, Practical Mental Training', author: 'William Walker Atkinson', year: 1909, original_language: 'English' },
  { ia_identifier: 'practicalpsychom43954gut', title: 'Practical Psychomancy and Crystal Gazing', author: 'William Walker Atkinson', year: 1908, original_language: 'English' },
  { ia_identifier: 'nuggetsofnewthou00atki', title: 'Nuggets of the New Thought', author: 'William Walker Atkinson', year: 1902, original_language: 'English' },
  { ia_identifier: 'lawnewthoughtas01atkigoog', title: 'The Law of the New Thought', author: 'William Walker Atkinson', year: 1902, original_language: 'English' },
  { ia_identifier: 'PracticalMentalInfluenceACourseOfLessonsOnMentalVibrations', title: 'Practical Mental Influence', author: 'William Walker Atkinson', year: 1908, original_language: 'English' },
  { ia_identifier: 'reincarnationand26364gut', title: 'Reincarnation and the Law of Karma', author: 'William Walker Atkinson', year: 1908, original_language: 'English' },
  { ia_identifier: 'TheSecretOfSuccess_201303', title: 'The Secret of Success', author: 'William Walker Atkinson', year: 1907, original_language: 'English' },
  { ia_identifier: 'mindandbodyormen44029gut', title: 'Mind and Body; or, Mental States and Physical Conditions', author: 'William Walker Atkinson', year: 1910, original_language: 'English' },
  { ia_identifier: 'in.ernet.dli.2015.62474', title: 'The Secret of Mental Magic', author: 'William Walker Atkinson', year: 1907, original_language: 'English' },
  { ia_identifier: 'atkinson-1907-mental-fasc', title: 'Mental Fascination', author: 'William Walker Atkinson', year: 1907, original_language: 'English' },
  { ia_identifier: 'rkas.1937.memoryculture0000will', title: 'Memory Culture', author: 'William Walker Atkinson', year: 1918, original_language: 'English' },
  { ia_identifier: 'the-mystery-of-sex-or-sex-polarity', title: 'The Mystery of Sex, or Sex Polarity', author: 'William Walker Atkinson', year: 1912, original_language: 'English' },
  { ia_identifier: '1911vril', title: 'Vril, or Vital Magnetism', author: 'William Walker Atkinson', year: 1911, original_language: 'English' },
  { ia_identifier: 'the-arcane-teachings-of-william-walker-atkinson', title: 'The Arcane Teaching', author: 'William Walker Atkinson', year: 1911, original_language: 'English' },
  { ia_identifier: 'arcaneformulaso00atkigoog', title: 'The Arcane Formulas, or Mental Alchemy', author: 'William Walker Atkinson', year: 1909, original_language: 'English' },
  { ia_identifier: 'suggestionautosu0000unse', title: 'Suggestion and Auto-Suggestion', author: 'William Walker Atkinson', year: 1909, original_language: 'English' },
  { ia_identifier: 'seriesoflessonsi00atki', title: 'A Series of Lessons in Personal Magnetism', author: 'William Walker Atkinson', year: 1901, original_language: 'English' },
  { ia_identifier: 'william-walker-atkinson-self-healing-by-thought-force', title: 'Self Healing by Thought Force', author: 'William Walker Atkinson', year: 1907, original_language: 'English' },
  { ia_identifier: 'correspondencec00atkigoog', title: 'Correspondence Course in Yogi Philosophy and Oriental Occultism', author: 'William Walker Atkinson', year: 1903, original_language: 'English' },
];

// ============================================================
// YOGI RAMACHARAKA (Atkinson pseudonym)
// ============================================================
const RAMACHARAKA: ImportItem[] = [
  { ia_identifier: 'in.ernet.dli.2015.47927', title: 'Science of Breath', author: 'Yogi Ramacharaka (William Walker Atkinson)', year: 1905, original_language: 'English' },
  { ia_identifier: 'hathayogawithnu00ramagoog', title: 'Hatha Yoga', author: 'Yogi Ramacharaka (William Walker Atkinson)', year: 1904, original_language: 'English' },
  { ia_identifier: 'in.ernet.dli.2015.222142', title: 'Fourteen Lessons in Yogi Philosophy and Oriental Occultism', author: 'Yogi Ramacharaka (William Walker Atkinson)', year: 1904, original_language: 'English' },
  { ia_identifier: 'advancedcoursein0000yogi', title: 'Advanced Course in Yogi Philosophy and Oriental Occultism', author: 'Yogi Ramacharaka (William Walker Atkinson)', year: 1905, original_language: 'English' },
  { ia_identifier: 'seriesoflessonsi00rama', title: 'A Series of Lessons in Raja Yoga', author: 'Yogi Ramacharaka (William Walker Atkinson)', year: 1906, original_language: 'English' },
  { ia_identifier: 'seriesoflessonsi0000yogi', title: 'A Series of Lessons in Gnani Yoga', author: 'Yogi Ramacharaka (William Walker Atkinson)', year: 1906, original_language: 'English' },
  { ia_identifier: 'scienceofpsychic00rama', title: 'The Science of Psychic Healing', author: 'Yogi Ramacharaka (William Walker Atkinson)', year: 1909, original_language: 'English' },
  { ia_identifier: 'mysticchristiani0000yogi', title: 'Mystic Christianity, or The Inner Teaching of the Master', author: 'Yogi Ramacharaka (William Walker Atkinson)', year: 1907, original_language: 'English' },
  { ia_identifier: 'ThePhilosophiesAndReligionsOfIndia', title: 'The Philosophies and Religions of India', author: 'Yogi Ramacharaka (William Walker Atkinson)', year: 1908, original_language: 'English' },
  { ia_identifier: 'lifebeyonddeath', title: 'The Life Beyond Death', author: 'Yogi Ramacharaka (William Walker Atkinson)', year: 1912, original_language: 'English' },
  { ia_identifier: 'gtu_A32400006343390B', title: 'The Bhagavad Gita, or The Message of the Master', author: 'Yogi Ramacharaka (William Walker Atkinson)', year: 1911, original_language: 'English' },
];

// ============================================================
// THERON Q. DUMONT (Atkinson pseudonym)
// ============================================================
const DUMONT: ImportItem[] = [
  { ia_identifier: 'powerconcentrat00dumogoog', title: 'The Power of Concentration', author: 'Theron Q. Dumont (William Walker Atkinson)', year: 1916, original_language: 'English' },
  { ia_identifier: 'isbn_0787303011', title: 'The Art and Science of Personal Magnetism', author: 'Theron Q. Dumont (William Walker Atkinson)', year: 1913, original_language: 'English' },
  { ia_identifier: 'b28069183', title: 'The Advanced Course in Personal Magnetism', author: 'Theron Q. Dumont (William Walker Atkinson)', year: 1914, original_language: 'English' },
  { ia_identifier: 'mentaltherapeut00dumogoog', title: 'Mental Therapeutics', author: 'Theron Q. Dumont (William Walker Atkinson)', year: 1916, original_language: 'English' },
  { ia_identifier: 'solarplexusorab00dumogoog', title: 'The Solar Plexus, or Abdominal Brain', author: 'Theron Q. Dumont (William Walker Atkinson)', year: 1920, original_language: 'English' },
  { ia_identifier: 'practicalmemoryt0000ther', title: 'Practical Memory Training', author: 'Theron Q. Dumont (William Walker Atkinson)', year: 1916, original_language: 'English' },
  { ia_identifier: 'the-master-mind', title: 'The Master Mind', author: 'Theron Q. Dumont (William Walker Atkinson)', year: 1918, original_language: 'English' },
];

// ============================================================
// SWAMI PANCHADASI (Atkinson pseudonym)
// ============================================================
const PANCHADASI: ImportItem[] = [
  { ia_identifier: 'clairvoyanceoccu00panciala', title: 'Clairvoyance and Occult Powers', author: 'Swami Panchadasi (William Walker Atkinson)', year: 1916, original_language: 'English' },
  { ia_identifier: 'human_aura_panchadasi', title: 'The Human Aura', author: 'Swami Panchadasi (William Walker Atkinson)', year: 1912, original_language: 'English' },
];

// ============================================================
// MAGUS INCOGNITO / THEODORE SHELDON (Atkinson pseudonyms)
// ============================================================
const OTHER_PSEUDONYMS: ImportItem[] = [
  { ia_identifier: 'the-secret-doctrine-of-the-rosicrucians-magus-incognito-1918', title: 'The Secret Doctrine of the Rosicrucians', author: 'Magus Incognito (William Walker Atkinson)', year: 1918, original_language: 'English' },
  { ia_identifier: 'atkinson-1913-vim-culture-copy', title: 'Vim Culture', author: 'Theodore Sheldon (William Walker Atkinson)', year: 1913, original_language: 'English' },
];

// ============================================================
// MESMERISM / ANIMAL MAGNETISM
// ============================================================
const MESMERISM: ImportItem[] = [
  // Tier 1: Essential
  { ia_identifier: 'b28780875', title: 'Precis historique des faits relatifs au magnetisme animal', author: 'Franz Anton Mesmer', year: 1781, original_language: 'French' },
  { ia_identifier: 'mesmerismusoder00wolfgoog', title: 'Mesmerismus, oder System der Wechselwirkungen', author: 'Franz Anton Mesmer (ed. Wolfart)', year: 1814, original_language: 'German' },
  { ia_identifier: 'b22324665', title: 'Rapport des commissaires sur le magnetisme animal', author: 'Benjamin Franklin, Bailly, Lavoisier et al.', year: 1784, original_language: 'French' },
  { ia_identifier: 'considrationss00berg', title: 'Considerations sur le magnetisme animal', author: 'Nicolas Bergasse', year: 1784, original_language: 'French' },
  { ia_identifier: 'dumagntismeanima00chas', title: 'Du magnetisme animal', author: 'Marquis de Puysegur', year: 1807, original_language: 'French' },
  { ia_identifier: 'BIUSante_54669', title: 'Recherches, experiences et observations physiologiques sur le somnambulisme', author: 'Marquis de Puysegur', year: 1811, original_language: 'French' },
  { ia_identifier: 'instructionprati00dele', title: 'Instruction pratique sur le magnetisme animal', author: 'J.P.F. Deleuze', year: 1825, original_language: 'French' },
  { ia_identifier: 'practicalinstruc00dele', title: 'Practical Instruction in Animal Magnetism (tr. Hartshorn)', author: 'J.P.F. Deleuze', year: 1879, original_language: 'French' },
  // Tier 2: Major secondary
  { ia_identifier: 'isisrevelataani03colqgoog', title: 'Isis Revelata: An Inquiry into Animal Magnetism', author: 'John Campbell Colquhoun', year: 1844, original_language: 'English' },
  { ia_identifier: 'historyofmagicwi00colqrich', title: 'An History of Magic, Witchcraft, and Animal Magnetism, Vol. 1', author: 'John Campbell Colquhoun', year: 1851, original_language: 'English' },
  { ia_identifier: 'historyofmagicwi01colq', title: 'An History of Magic, Witchcraft, and Animal Magnetism, Vol. 2', author: 'John Campbell Colquhoun', year: 1851, original_language: 'English' },
  { ia_identifier: 'factsinmesmeris00town', title: 'Facts in Mesmerism, or Animal Magnetism', author: 'Chauncy Hare Townshend', year: 1841, original_language: 'English' },
  { ia_identifier: 'practicalmanualo00test', title: 'A Practical Manual of Animal Magnetism', author: 'Alphonse Teste', year: 1843, original_language: 'English' },
  { ia_identifier: 'animalmagnetism00binerich', title: 'Animal Magnetism', author: 'Alfred Binet and Charles Fere', year: 1889, original_language: 'English' },
  { ia_identifier: 'b21931136', title: 'Magic, Witchcraft, Animal Magnetism, Hypnotism and Electro-Biology', author: 'James Braid', year: 1852, original_language: 'English' },
  // Tier 3: Complementary
  { ia_identifier: '63721400R.nlm.nih.gov', title: 'Mesmerism in India', author: 'James Esdaile', year: 1851, original_language: 'English' },
  { ia_identifier: 'researchesonmag00greggoog', title: 'Researches on Magnetism and the Vital Force', author: 'Karl von Reichenbach', year: 1850, original_language: 'English' },
  { ia_identifier: 'reportofexperime00acad', title: 'Report of the Experiments on Animal Magnetism (1831 Academy Report)', author: 'French Royal Academy', year: 1833, original_language: 'English' },
  { ia_identifier: 'anintroductiont01conggoog', title: 'An Introduction to the Study of Animal Magnetism', author: 'Baron Du Potet de Sennevoy', year: 1838, original_language: 'English' },
  { ia_identifier: 'letterstocandidi00greg', title: 'Letters to a Candid Inquirer, on Animal Magnetism', author: 'William Gregory', year: 1851, original_language: 'English' },
];

// ============================================================
// SWEDENBORG (new works not already in library)
// Known existing: Arcana Caelestia I-V (Latin), Works 11/15, Heaven and Hell,
// Vera Christiana Religio, Arcana Coelestia (English)
// ============================================================
const SWEDENBORG: ImportItem[] = [
  { ia_identifier: 'divineloveanddi00sweduoft', title: 'Divine Love and Divine Wisdom', author: 'Emanuel Swedenborg', year: 1890, original_language: 'Latin' },
  { ia_identifier: 'divineprovidence00sweduoft', title: 'Divine Providence', author: 'Emanuel Swedenborg', year: 1899, original_language: 'Latin' },
  { ia_identifier: 'conjugialloveaf00sweduoft', title: 'Conjugial Love', author: 'Emanuel Swedenborg', year: 1907, original_language: 'Latin' },
  { ia_identifier: 'apocalypseexplained01swed', title: 'Apocalypse Explained, Vol. 1', author: 'Emanuel Swedenborg', year: 1890, original_language: 'Latin' },
  { ia_identifier: 'apocalypseexplai02swed', title: 'Apocalypse Explained, Vol. 2', author: 'Emanuel Swedenborg', year: 1892, original_language: 'Latin' },
  { ia_identifier: 'apocalypseexplai03sweduoft', title: 'Apocalypse Explained, Vol. 3', author: 'Emanuel Swedenborg', year: 1905, original_language: 'Latin' },
  { ia_identifier: 'apocalypseexplai05sweduoft', title: 'Apocalypse Explained, Vol. 5', author: 'Emanuel Swedenborg', year: 1905, original_language: 'Latin' },
  { ia_identifier: 'apocalypseexplained06swed', title: 'Apocalypse Explained, Vol. 6', author: 'Emanuel Swedenborg', year: 1890, original_language: 'Latin' },
  { ia_identifier: 'soulsorrational00sweduoft', title: 'The Soul, or Rational Psychology', author: 'Emanuel Swedenborg', year: 1900, original_language: 'Latin' },
  { ia_identifier: 'principiaorfirst00sweduoft', title: 'The Principia; or, The First Principles of Natural Things', author: 'Emanuel Swedenborg', year: 1912, original_language: 'Latin' },
];

// ============================================================
// MAIN
// ============================================================

async function checkDuplicate(ia_identifier: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/api/search?q=${encodeURIComponent(ia_identifier)}&limit=5`);
    const data = await res.json();
    for (const r of data.results || []) {
      if (r.ia_identifier === ia_identifier) return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function importBook(item: ImportItem): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const res = await fetch(`${BASE_URL}/api/import/ia`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    });
    const data = await res.json();
    if (res.ok && (data.bookId || data.book_id)) {
      return { success: true, id: data.bookId || data.book_id };
    }
    return { success: false, error: data.error || data.message || `HTTP ${res.status}` };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

async function importBatch(label: string, items: ImportItem[]) {
  console.log(`\n=== ${label} (${items.length} books) ===`);
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const item of items) {
    const result = await importBook(item);
    if (result.success) {
      console.log(`  OK: ${item.title} -> ${BASE_URL}/book/${result.id}`);
      imported++;
    } else if (result.error?.includes('already exists')) {
      console.log(`  SKIP (exists): ${item.title}`);
      skipped++;
    } else {
      console.log(`  FAIL: ${item.title} -> ${result.error}`);
      failed++;
    }

    // Small delay to avoid overwhelming the server
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`  --- ${label}: ${imported} imported, ${skipped} skipped, ${failed} failed ---`);
  return { imported, skipped, failed };
}

async function main() {
  console.log('=== BATCH IMPORT: NEW THOUGHT, MESMERISM, SWEDENBORG ===');
  console.log(`Started: ${new Date().toISOString()}\n`);

  const totals = { imported: 0, skipped: 0, failed: 0 };

  const batches: [string, ImportItem[]][] = [
    ['ATKINSON (own name)', ATKINSON],
    ['YOGI RAMACHARAKA', RAMACHARAKA],
    ['THERON Q. DUMONT', DUMONT],
    ['SWAMI PANCHADASI', PANCHADASI],
    ['OTHER PSEUDONYMS', OTHER_PSEUDONYMS],
    ['MESMERISM / ANIMAL MAGNETISM', MESMERISM],
    ['SWEDENBORG (new works)', SWEDENBORG],
  ];

  for (const [label, items] of batches) {
    const result = await importBatch(label, items);
    totals.imported += result.imported;
    totals.skipped += result.skipped;
    totals.failed += result.failed;
  }

  console.log(`\n=== GRAND TOTAL ===`);
  console.log(`Imported: ${totals.imported}`);
  console.log(`Skipped (duplicates): ${totals.skipped}`);
  console.log(`Failed: ${totals.failed}`);
  console.log(`Finished: ${new Date().toISOString()}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
