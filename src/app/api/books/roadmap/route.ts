import { NextResponse } from 'next/server';
import { getDb } from '@/lib/mongodb';

// Roadmap books from Internet Archive
// IMPORTANT: Only include genuinely OLD editions (15th-18th century), not modern translations
const ROADMAP_BOOKS = [
  // Tier 1: Foundational Texts - Hermeticism
  {
    title: 'Corpus Hermeticum',
    display_title: 'Corpus Hermeticum (Ficino Latin, 1481)',
    author: 'Hermes Trismegistus; trans. Marsilio Ficino',
    language: 'Latin',
    ia_identifier: 'bib_fict_4102599',
    source_url: 'https://archive.org/details/bib_fict_4102599',
    categories: ['hermeticism', 'prisca-theologia'],
    priority: 1,
    notes: 'Third Latin edition (1481, Venice). Ficino translation from 1463. Incunabulum.',
  },

  // Tier 1: Florentine Platonism
  {
    title: 'Divini Platonis Opera omnia',
    display_title: 'Plato: Complete Works (Ficino Translation)',
    author: 'Plato; trans. Marsilio Ficino',
    language: 'Latin',
    ia_identifier: 'diviniplatonisop00plat',
    source_url: 'https://archive.org/details/diviniplatonisop00plat',
    categories: ['florentine-platonism', 'neoplatonism'],
    priority: 1,
    notes: 'John Adams Library copy. Ficino\'s foundational Plato translation.',
  },
  {
    title: 'Epistolae Marsilii Ficini Florentini',
    display_title: 'Letters of Marsilio Ficino',
    author: 'Marsilio Ficino',
    language: 'Latin',
    ia_identifier: 'epistolaemarsili00fici',
    source_url: 'https://archive.org/details/epistolaemarsili00fici',
    categories: ['florentine-platonism', 'neoplatonism'],
    priority: 1,
    notes: 'Koberger incunabulum (1490s). Ficino\'s philosophical correspondence.',
  },
  {
    title: 'De Vita Libri Tres',
    display_title: 'De Vita Libri Tres (1489 First Edition)',
    author: 'Marsilio Ficino',
    language: 'Latin',
    ia_identifier: 'ita-bnc-in2-00001718-001',
    source_url: 'https://archive.org/details/ita-bnc-in2-00001718-001',
    categories: ['florentine-platonism', 'natural-magic', 'medicine'],
    priority: 1,
    notes: 'First edition (Florence, Miscomini, 1489). Astrological medicine and natural magic. Incunabulum.',
  },

  // Tier 1: Neoplatonism & Theurgy
  {
    title: 'De Mysteriis Aegyptiorum',
    display_title: 'Iamblichus De Mysteriis (1497 Aldine)',
    author: 'Iamblichus; Proclus; Porphyry; trans. Marsilio Ficino',
    language: 'Latin',
    ia_identifier: 'A335081',
    source_url: 'https://archive.org/details/A335081',
    categories: ['neoplatonism', 'theurgy', 'prisca-theologia'],
    priority: 1,
    notes: '1497 Venice, Aldus Manutius. Incunabulum. Includes Proclus, Porphyry, Synesius, Psellus.',
  },

  // Tier 1: Christian Cabala
  {
    title: 'De Arte Cabalistica',
    display_title: 'De Arte Cabalistica (in Galatino, 1550)',
    author: 'Johann Reuchlin',
    language: 'Latin',
    ia_identifier: 'bub_gb_hgg8vG6num4C',
    source_url: 'https://archive.org/details/bub_gb_hgg8vG6num4C',
    categories: ['christian-cabala', 'jewish-kabbalah'],
    priority: 1,
    notes: '1550 Latin edition bound with Galatino. Foundation of Christian Cabala.',
  },
  {
    title: 'Opera Omnia',
    display_title: 'Pico della Mirandola: Opera (1496)',
    author: 'Giovanni Pico della Mirandola',
    language: 'Latin',
    ia_identifier: 'A335045',
    source_url: 'https://archive.org/details/A335045',
    categories: ['florentine-platonism', 'christian-cabala', 'renaissance'],
    priority: 1,
    notes: 'Incunabulum (Bologna, 1496). Includes Oratio, Heptaplus, 900 Theses. Complete works.',
  },

  // Tier 2: Major Alchemical Collections
  {
    title: 'Musaeum Hermeticum',
    display_title: 'Musaeum Hermeticum (1677 Edition)',
    author: 'Various; ed. Luca Jennis',
    language: 'Latin',
    ia_identifier: 'musaeumhermeticu00meri',
    source_url: 'https://archive.org/details/musaeumhermeticu00meri',
    categories: ['alchemy', 'hermeticism'],
    priority: 2,
    notes: '1678 Latin edition. 21 alchemical treatises. Merian engravings.',
  },
  {
    title: 'Theatrum Chemicum Britannicum',
    display_title: 'Theatrum Chemicum Britannicum',
    author: 'Elias Ashmole (compiler)',
    language: 'English',
    ia_identifier: 'theatrumchemicum00ashm',
    source_url: 'https://archive.org/details/theatrumchemicum00ashm',
    categories: ['alchemy', 'spiritual-alchemy'],
    priority: 2,
    notes: '1652 London edition. English alchemical poetry. Norton, Ripley, Kelley, Dee.',
  },
  {
    title: 'Manly Palmer Hall Alchemical Manuscripts',
    display_title: 'Manly Palmer Hall Collection of Alchemical Manuscripts',
    author: 'Various',
    language: 'Latin/German/English',
    ia_identifier: 'manlypalmerhabox4v3hall',
    source_url: 'https://archive.org/details/manlypalmerhabox4v3hall',
    categories: ['alchemy', 'hermeticism', 'rosicrucianism'],
    priority: 2,
    notes: '243 manuscripts (1500-1825) in 68 volumes. Getty Research Institute.',
  },
  {
    title: 'Lehigh Codex',
    display_title: 'Lehigh Codex (15th c. Naples Alchemical MS)',
    author: 'Arnold of Brussels (compiler)',
    language: 'Latin',
    ia_identifier: 'lehigh_codex_010',
    source_url: 'https://archive.org/details/lehigh_codex_010',
    categories: ['alchemy'],
    priority: 2,
    notes: 'Late 15th century Naples manuscript. Alchemical compilation.',
  },

  // Tier 2: Paracelsian
  {
    title: 'Opera Omnia Medico-Chemico-Chirurgica',
    display_title: 'Paracelsus: Complete Works (Latin)',
    author: 'Paracelsus',
    language: 'Latin',
    ia_identifier: 'bub_gb_fAA6Advd-pMC',
    source_url: 'https://archive.org/details/bub_gb_fAA6Advd-pMC',
    categories: ['paracelsian', 'alchemy', 'medicine'],
    priority: 2,
    notes: '1658 Geneva edition. Complete Latin works. 3 volumes.',
  },
  {
    title: 'Archidoxes of Magic',
    display_title: 'Archidoxes of Magic (1655 English)',
    author: 'Paracelsus',
    language: 'English',
    ia_identifier: 'ArchidoxesOfMagicOfTheSupremeMysteriesOfNatureParacelsus1655',
    source_url: 'https://archive.org/details/ArchidoxesOfMagicOfTheSupremeMysteriesOfNatureParacelsus1655',
    categories: ['paracelsian', 'natural-magic'],
    priority: 2,
    notes: '17th century English translation. Magical Paracelsiana.',
  },

  // Tier 3: Magic & Ritual
  {
    title: 'De Occulta Philosophia Libri Tres (1533)',
    display_title: 'Three Books of Occult Philosophy (1533 Latin)',
    author: 'Heinrich Cornelius Agrippa',
    language: 'Latin',
    ia_identifier: 'McGillLibrary-osl_henrici-cornelii-agrippae_folioA279o1533-19978',
    source_url: 'https://archive.org/details/McGillLibrary-osl_henrici-cornelii-agrippae_folioA279o1533-19978',
    categories: ['ritual-magic', 'natural-magic', 'christian-cabala'],
    priority: 3,
    notes: 'First complete Latin edition. Foundation of Western ceremonial magic.',
  },

  // Tier 4: Christian Mysticism - Böhme
  {
    title: 'Mysterium Magnum',
    display_title: 'Mysterium Magnum (1656 Sparrow Translation)',
    author: 'Jakob Böhme; trans. John Sparrow',
    language: 'English',
    ia_identifier: 'bim_early-english-books-1475-1640_mysterium-magnum_bhme-jacob_1656',
    source_url: 'https://archive.org/details/bim_early-english-books-1475-1640_mysterium-magnum_bhme-jacob_1656',
    categories: ['christian-mysticism', 'theosophy'],
    priority: 4,
    notes: 'Original 1656 English edition. Genesis commentary. Major theosophical work.',
  },
  {
    title: 'Works of Jacob Behmen',
    display_title: 'Works of Jacob Behmen (William Law Edition, 4 vols)',
    author: 'Jakob Böhme; ed. William Law',
    language: 'English',
    ia_identifier: 'worksofjacobbehm04beohuoft',
    source_url: 'https://archive.org/details/worksofjacobbehm04beohuoft',
    categories: ['christian-mysticism', 'theosophy'],
    priority: 4,
    notes: '1764-1781 London edition. Complete English works with figures.',
  },

  // Tier 5: Encyclopedic Works - Kircher
  {
    title: 'Oedipus Aegyptiacus Vol. I',
    display_title: 'Oedipus Aegyptiacus Volume I (1652)',
    author: 'Athanasius Kircher',
    language: 'Latin',
    ia_identifier: 'AthanasiiKircheriOedipusAegyptiacusVolI1652',
    source_url: 'https://archive.org/details/AthanasiiKircheriOedipusAegyptiacusVolI1652',
    categories: ['prisca-theologia', 'hermeticism'],
    priority: 5,
    notes: 'Egyptian wisdom encyclopedia. Hieroglyphics, Kabbalah, more.',
  },
  {
    title: 'Oedipus Aegyptiacus Vol. II',
    display_title: 'Oedipus Aegyptiacus Volume II (1653)',
    author: 'Athanasius Kircher',
    language: 'Latin',
    ia_identifier: 'bub_gb_zXWh65oYZ4EC',
    source_url: 'https://archive.org/details/bub_gb_zXWh65oYZ4EC',
    categories: ['prisca-theologia', 'hermeticism'],
    priority: 5,
    notes: 'Continuation. Complutense University copy.',
  },
  {
    title: 'Ars Magna Lucis et Umbrae',
    display_title: 'The Great Art of Light and Shadow',
    author: 'Athanasius Kircher',
    language: 'Latin',
    ia_identifier: 'athanasiikirche00kirc',
    source_url: 'https://archive.org/details/athanasiikirche00kirc',
    categories: ['natural-philosophy', 'natural-magic'],
    priority: 5,
    notes: '1671 Amsterdam edition. Optics, astronomy, physics.',
  },
  {
    title: 'Musurgia Universalis',
    display_title: 'Musurgia Universalis (Universal Music)',
    author: 'Athanasius Kircher',
    language: 'Latin',
    ia_identifier: 'bub_gb_Ebv8SNgKNnoC',
    source_url: 'https://archive.org/details/bub_gb_Ebv8SNgKNnoC',
    categories: ['natural-philosophy', 'pythagoreanism'],
    priority: 5,
    notes: '1650 Rome. Music, harmony, cosmic correspondences.',
  },
];

// GET /api/books/roadmap - List all roadmap books
export async function GET() {
  try {
    const db = await getDb();

    // Get existing roadmap books (status = 'draft' with ia_identifier)
    const existingBooks = await db.collection('books').find({
      status: 'draft',
      ia_identifier: { $exists: true, $ne: null },
    }).toArray();

    // Check which roadmap books are already in DB
    const existingIdentifiers = new Set(existingBooks.map(b => b.ia_identifier));

    const roadmapStatus = ROADMAP_BOOKS.map(book => ({
      ...book,
      in_database: existingIdentifiers.has(book.ia_identifier),
    }));

    return NextResponse.json({
      total: ROADMAP_BOOKS.length,
      in_database: existingBooks.length,
      pending: ROADMAP_BOOKS.length - existingBooks.length,
      books: roadmapStatus,
    });
  } catch (error) {
    console.error('Error fetching roadmap:', error);
    return NextResponse.json({ error: 'Failed to fetch roadmap' }, { status: 500 });
  }
}

// POST /api/books/roadmap - Add all roadmap books to database
export async function POST() {
  try {
    const db = await getDb();

    // Get existing ia_identifiers to avoid duplicates
    const existingBooks = await db.collection('books').find({
      ia_identifier: { $exists: true, $ne: null },
    }).project({ ia_identifier: 1 }).toArray();

    const existingIdentifiers = new Set(existingBooks.map(b => b.ia_identifier));

    const results: Array<{ title: string; status: 'added' | 'exists' | 'error'; id?: string }> = [];

    for (const book of ROADMAP_BOOKS) {
      if (existingIdentifiers.has(book.ia_identifier)) {
        results.push({ title: book.title, status: 'exists' });
        continue;
      }

      try {
        const bookId = crypto.randomUUID();
        const now = new Date();

        const bookDoc = {
          id: bookId,
          tenant_id: 'default',
          title: book.title,
          display_title: book.display_title,
          author: book.author,
          language: book.language,
          published: '', // To be determined from source
          status: 'draft' as const,
          categories: book.categories,
          ia_identifier: book.ia_identifier,
          image_source: {
            provider: 'internet_archive' as const,
            provider_name: 'Internet Archive',
            source_url: book.source_url,
            identifier: book.ia_identifier,
            license: 'publicdomain',
            notes: book.notes,
          },
          dublin_core: {
            dc_description: book.notes,
          },
          pages_count: 0,
          created_at: now,
          updated_at: now,
        };

        await db.collection('books').insertOne(bookDoc);
        results.push({ title: book.title, status: 'added', id: bookId });
      } catch (err) {
        console.error(`Error adding ${book.title}:`, err);
        results.push({ title: book.title, status: 'error' });
      }
    }

    const added = results.filter(r => r.status === 'added').length;
    const exists = results.filter(r => r.status === 'exists').length;
    const errors = results.filter(r => r.status === 'error').length;

    return NextResponse.json({
      success: true,
      added,
      already_existed: exists,
      errors,
      results,
    });
  } catch (error) {
    console.error('Error adding roadmap books:', error);
    return NextResponse.json({ error: 'Failed to add roadmap books' }, { status: 500 });
  }
}
