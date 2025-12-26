import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';
import { LIBRARY_CATEGORIES } from '../../categories/route';

// Mapping of keywords/terms to category IDs
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'alchemy': [
    'alchemy', 'alchemical', 'alchemist', 'philosopher\'s stone', 'transmutation',
    'paracelsus', 'spagyric', 'elixir', 'chrysopoeia', 'aurum', 'gold', 'mercury',
    'sulphur', 'salt', 'chymical', 'chymistry', 'laboratory', 'distillation',
    'calcination', 'great work', 'opus magnum', 'azoth', 'vitriol', 'basilius',
    'flamel', 'ripley', 'maier', 'khunrath'
  ],
  'hermeticism': [
    'hermes', 'hermetic', 'trismegistus', 'emerald tablet', 'corpus hermeticum',
    'poimandres', 'asclepius', 'thrice-great', 'egyptian', 'thoth', 'ficino',
    'prisca theologia'
  ],
  'kabbalah': [
    'kabbalah', 'kabbalistic', 'cabala', 'qabalah', 'sephiroth', 'sefirot',
    'tree of life', 'zohar', 'gematria', 'hebrew', 'talmud', 'yetzirah',
    'bahir', 'abulafia', 'luria', 'cordovero', 'reuchlin', 'pico'
  ],
  'neoplatonism': [
    'neoplatonism', 'plato', 'platonic', 'plotinus', 'proclus', 'iamblichus',
    'porphyry', 'emanation', 'one', 'nous', 'world soul', 'anima mundi',
    'ficino', 'academy', 'florentine', 'henosis', 'theurgy'
  ],
  'rosicrucianism': [
    'rosicrucian', 'rosenkreutz', 'fama', 'confessio', 'chemical wedding',
    'fraternity', 'r.c.', 'rose cross', 'invisible college', 'andreae',
    'fludd', 'maier'
  ],
  'freemasonry': [
    'freemasonry', 'masonic', 'freemason', 'lodge', 'craft', 'temple',
    'hiram', 'solomon', 'degree', 'ritual', 'initiation', 'grand lodge'
  ],
  'natural-philosophy': [
    'natural philosophy', 'nature', 'physics', 'astronomy', 'mathematics',
    'mechanics', 'optics', 'magnetism', 'electricity', 'experiment',
    'observation', 'science', 'bacon', 'newton', 'boyle', 'galileo'
  ],
  'astrology': [
    'astrology', 'astrological', 'horoscope', 'zodiac', 'planet', 'star',
    'celestial', 'natal', 'ptolemy', 'tetrabiblos', 'ephemeris', 'aspect',
    'conjunction', 'influence', 'firmament'
  ],
  'magic': [
    'magic', 'magical', 'magick', 'theurgy', 'ritual', 'invocation',
    'evocation', 'talisman', 'amulet', 'sigil', 'grimoire', 'conjuration',
    'agrippa', 'picatrix', 'goetia', 'angel', 'demon', 'spirit', 'necromancy'
  ],
  'mysticism': [
    'mysticism', 'mystical', 'mystic', 'contemplation', 'vision', 'ecstasy',
    'union', 'divine', 'spiritual', 'illumination', 'boehme', 'bohme',
    'eckhart', 'tauler', 'suso', 'theosophia'
  ],
  'theology': [
    'theology', 'theological', 'god', 'christ', 'christian', 'scripture',
    'bible', 'church', 'doctrine', 'faith', 'salvation', 'trinity',
    'incarnation', 'redemption', 'augustine', 'aquinas'
  ],
  'medicine': [
    'medicine', 'medical', 'healing', 'physician', 'cure', 'disease',
    'remedy', 'herb', 'pharmaceutical', 'iatrochemistry',
    'galenical', 'humour', 'anatomy', 'surgery'
  ],
  // New expanded categories
  'gnosticism': [
    'gnostic', 'gnosis', 'demiurge', 'sophia', 'archon', 'pleroma',
    'valentinian', 'basilides', 'marcion', 'mandaean', 'manichaean',
    'nag hammadi', 'pistis sophia', 'apocryphon', 'aeon'
  ],
  'theosophy': [
    'theosophy', 'theosophical', 'blavatsky', 'besant', 'leadbeater',
    'olcott', 'judge', 'mahatma', 'adyar', 'secret doctrine',
    'isis unveiled', 'astral', 'etheric', 'devachan', 'karma',
    'reincarnation', 'root race', 'round', 'chain'
  ],
  'pythagoreanism': [
    'pythagoras', 'pythagorean', 'tetraktys', 'monad', 'dyad', 'triad',
    'harmony of spheres', 'sacred geometry', 'number mysticism',
    'philolaus', 'archytas', 'nicomachus', 'iamblichus'
  ],
  'divination': [
    'divination', 'geomancy', 'geomantic', 'prophecy', 'oracle',
    'omen', 'augury', 'sortilege', 'scrying', 'chiromancy',
    'physiognomy', 'presage', 'prognostication', 'sibyl', 'lot'
  ],
  'ars-notoria': [
    'ars notoria', 'notory art', 'sworn book', 'liber juratus',
    'honorius', 'memory art', 'art of memory', 'mnemonic',
    'angelic language', 'sacred names'
  ],
  'paracelsian': [
    'paracelsus', 'paracelsian', 'hohenheim', 'paramirum', 'archidoxis',
    'spagyric', 'three principles', 'tria prima', 'iatrochemistry',
    'tartarus', 'archeus', 'vulcanus', 'iliaster'
  ],
  'spiritual-alchemy': [
    'spiritual alchemy', 'inner alchemy', 'soul transformation',
    'philosophical gold', 'spiritual gold', 'rebirth', 'regeneration',
    'purification of soul', 'mystical marriage', 'chymical wedding'
  ],
  'christian-mysticism': [
    'boehme', 'bohme', 'böhme', 'eckhart', 'meister eckhart', 'tauler',
    'suso', 'ruysbroeck', 'theologia germanica', 'cloud of unknowing',
    'dark night', 'interior castle', 'mystical theology', 'dionysius',
    'quietism', 'guyon', 'fenelon', 'molinos'
  ],
  'egyptian': [
    'egypt', 'egyptian', 'pharaoh', 'hieroglyphic', 'pyramid', 'isis',
    'osiris', 'horus', 'thoth', 'hermes', 'memphis', 'thebes',
    'book of dead', 'papyrus', 'temple', 'mystery'
  ],
  'renaissance': [
    'ficino', 'pico', 'mirandola', 'renaissance', 'florentine',
    'medici', 'quattrocento', 'cinquecento', '15th century', '16th century',
    '1400', '1500', 'humanist', 'revival of learning'
  ],
  'reformation': [
    'reformation', 'protestant', 'luther', 'calvin', 'zwingli',
    'anabaptist', 'thirty years', 'counter-reformation', 'jesuit',
    '1517', '1520', '1530', '1540', '1550', '1560', '1570', '1580',
    '1590', '1600', '1610', '1620', '1630', '1640'
  ],
  'enlightenment': [
    'enlightenment', 'aufklärung', 'reason', 'rationalist',
    '1650', '1660', '1670', '1680', '1690', '1700', '1710', '1720',
    '1730', '1740', '1750', '1760', '1770', '1780', '1790', '1800',
    'encyclopédie', 'voltaire', 'illuminati', 'bavarian'
  ],
  '19th-century-revival': [
    'spiritualism', 'spiritualist', 'séance', 'medium', 'occult revival',
    'golden dawn', 'hermetic order', 'crowley', 'mathers', 'westcott',
    '1800s', '1810', '1820', '1830', '1840', '1850', '1860', '1870',
    '1880', '1890', '19th century', 'victorian', 'eliphas levi',
    'papus', 'encausse', 'martinism'
  ],
};

function categorizeBook(book: {
  title?: string;
  display_title?: string;
  author?: string;
  summary?: { data?: string } | string;
  index?: { keywords?: { term: string }[]; concepts?: { term: string }[] };
}): string[] {
  const categories = new Set<string>();

  // Gather all text to analyze
  const texts: string[] = [];
  if (book.title) texts.push(book.title.toLowerCase());
  if (book.display_title) texts.push(book.display_title.toLowerCase());
  if (book.author) texts.push(book.author.toLowerCase());

  const summaryText = typeof book.summary === 'string'
    ? book.summary
    : book.summary?.data || '';
  if (summaryText) texts.push(summaryText.toLowerCase());

  // Add index keywords and concepts
  if (book.index?.keywords) {
    texts.push(...book.index.keywords.map(k => k.term.toLowerCase()));
  }
  if (book.index?.concepts) {
    texts.push(...book.index.concepts.map(c => c.term.toLowerCase()));
  }

  const fullText = texts.join(' ');

  // Check each category's keywords
  for (const [categoryId, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const keyword of keywords) {
      if (fullText.includes(keyword.toLowerCase())) {
        categories.add(categoryId);
        break; // Found match, move to next category
      }
    }
  }

  return Array.from(categories);
}

// POST /api/books/categorize - Auto-categorize all books
export async function POST() {
  try {
    const db = await getDb();

    // Get all books
    const books = await db.collection('books').find({}).toArray();

    const results: { id: string; title: string; categories: string[]; updated: boolean }[] = [];

    for (const book of books) {
      const suggestedCategories = categorizeBook(book as unknown as Parameters<typeof categorizeBook>[0]);

      // Merge with existing categories (don't remove manually added ones)
      const existingCategories = book.categories || [];
      const mergedCategories = [...new Set([...existingCategories, ...suggestedCategories])];

      const wasUpdated = mergedCategories.length !== existingCategories.length ||
        !mergedCategories.every(c => existingCategories.includes(c));

      if (wasUpdated) {
        await db.collection('books').updateOne(
          { id: book.id },
          { $set: { categories: mergedCategories } }
        );
      }

      results.push({
        id: book.id,
        title: book.display_title || book.title,
        categories: mergedCategories,
        updated: wasUpdated,
      });
    }

    const updatedCount = results.filter(r => r.updated).length;

    return NextResponse.json({
      success: true,
      total: books.length,
      updated: updatedCount,
      results,
    });
  } catch (error) {
    console.error('Error categorizing books:', error);
    return NextResponse.json(
      { error: 'Failed to categorize books' },
      { status: 500 }
    );
  }
}

// GET /api/books/categorize - Preview categorization without saving
export async function GET() {
  try {
    const db = await getDb();

    const books = await db.collection('books').find({}).toArray();

    const results = books.map(book => {
      const suggestedCategories = categorizeBook(book as unknown as Parameters<typeof categorizeBook>[0]);
      const existingCategories = book.categories || [];

      return {
        id: book.id,
        title: book.display_title || book.title,
        author: book.author,
        existing: existingCategories,
        suggested: suggestedCategories,
        wouldAdd: suggestedCategories.filter(c => !existingCategories.includes(c)),
      };
    });

    return NextResponse.json({
      total: books.length,
      withSuggestions: results.filter(r => r.wouldAdd.length > 0).length,
      results,
    });
  } catch (error) {
    console.error('Error previewing categorization:', error);
    return NextResponse.json(
      { error: 'Failed to preview categorization' },
      { status: 500 }
    );
  }
}
