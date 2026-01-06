import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongodb';

// Validation: Reject modern editions
// Returns error message if invalid, null if OK
function validateOldEdition(ia_identifier: string, notes?: string): string | null {
  // Reject identifiers with modern upload dates (2020+)
  if (/_20[2-9]\d/.test(ia_identifier)) {
    return `Modern upload detected: ${ia_identifier} contains recent date`;
  }

  // Reject common modern translation patterns
  const modernPatterns = [
    /ScottHermetica/i,           // Walter Scott's modern translation
    /penguin|oxford|cambridge/i,  // Modern publishers
    /translated.*by.*\d{4}/i,     // "Translated by X (1990)"
  ];

  for (const pattern of modernPatterns) {
    if (pattern.test(ia_identifier) || (notes && pattern.test(notes))) {
      return `Modern translation pattern detected`;
    }
  }

  return null; // Valid old edition
}

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

  // Tier 1: Major Alchemical Collections - UNTRANSLATED
  {
    title: 'Musaeum Hermeticum',
    display_title: 'Musaeum Hermeticum (1677 Edition)',
    author: 'Various; ed. Luca Jennis',
    language: 'Latin',
    ia_identifier: 'musaeumhermeticu00meri',
    source_url: 'https://archive.org/details/musaeumhermeticu00meri',
    categories: ['alchemy', 'hermeticism'],
    priority: 1,
    notes: 'UNTRANSLATED. 1678 Latin edition. 21 alchemical treatises. Merian engravings.',
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

  // Tier 1: Paracelsian - MOSTLY UNTRANSLATED
  {
    title: 'Opera Omnia Medico-Chemico-Chirurgica',
    display_title: 'Paracelsus: Complete Works (Latin)',
    author: 'Paracelsus',
    language: 'Latin',
    ia_identifier: 'bub_gb_fAA6Advd-pMC',
    source_url: 'https://archive.org/details/bub_gb_fAA6Advd-pMC',
    categories: ['paracelsian', 'alchemy', 'medicine'],
    priority: 1,
    notes: 'MOSTLY UNTRANSLATED. 1658 Geneva edition. Complete Latin works. 3 volumes.',
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

  // Tier 1: Kircher - NEVER TRANSLATED (massive encyclopedias, zero English)
  {
    title: 'Oedipus Aegyptiacus Vol. I',
    display_title: 'Oedipus Aegyptiacus Volume I (1652)',
    author: 'Athanasius Kircher',
    language: 'Latin',
    ia_identifier: 'AthanasiiKircheriOedipusAegyptiacusVolI1652',
    source_url: 'https://archive.org/details/AthanasiiKircheriOedipusAegyptiacusVolI1652',
    categories: ['prisca-theologia', 'hermeticism'],
    priority: 1,
    notes: 'UNTRANSLATED. Egyptian wisdom encyclopedia. Hieroglyphics, Kabbalah, more.',
  },
  {
    title: 'Oedipus Aegyptiacus Vol. II',
    display_title: 'Oedipus Aegyptiacus Volume II (1653)',
    author: 'Athanasius Kircher',
    language: 'Latin',
    ia_identifier: 'bub_gb_zXWh65oYZ4EC',
    source_url: 'https://archive.org/details/bub_gb_zXWh65oYZ4EC',
    categories: ['prisca-theologia', 'hermeticism'],
    priority: 1,
    notes: 'UNTRANSLATED. Continuation. Complutense University copy.',
  },
  {
    title: 'Ars Magna Lucis et Umbrae',
    display_title: 'The Great Art of Light and Shadow',
    author: 'Athanasius Kircher',
    language: 'Latin',
    ia_identifier: 'athanasiikirche00kirc',
    source_url: 'https://archive.org/details/athanasiikirche00kirc',
    categories: ['natural-philosophy', 'natural-magic'],
    priority: 1,
    notes: 'UNTRANSLATED. 1671 Amsterdam edition. Optics, astronomy, physics.',
  },
  {
    title: 'Musurgia Universalis',
    display_title: 'Musurgia Universalis (Universal Music)',
    author: 'Athanasius Kircher',
    language: 'Latin',
    ia_identifier: 'bub_gb_Ebv8SNgKNnoC',
    source_url: 'https://archive.org/details/bub_gb_Ebv8SNgKNnoC',
    categories: ['natural-philosophy', 'pythagoreanism'],
    priority: 1,
    notes: 'UNTRANSLATED. 1650 Rome. Music, harmony, cosmic correspondences.',
  },

  // Tier 3: Natural Philosophy - HAS MODERN TRANSLATIONS
  {
    title: 'De Revolutionibus Orbium Coelestium',
    display_title: 'De Revolutionibus (1543 First Edition)',
    author: 'Nicolaus Copernicus',
    language: 'Latin',
    ia_identifier: 'McGillLibrary-osl_nicolai_copernici_de-revolutionibus-orbium-coelestium_WZ240C7826n1543-21037',
    source_url: 'https://archive.org/details/McGillLibrary-osl_nicolai_copernici_de-revolutionibus-orbium-coelestium_WZ240C7826n1543-21037',
    categories: ['natural-philosophy', 'astronomy'],
    priority: 3,
    notes: 'Has translations (Rosen 1978). 1543 Nuremberg first edition. Heliocentric revolution.',
  },
  {
    title: 'Magia Naturalis',
    display_title: 'Magia Naturalis Libri XX (1607)',
    author: 'Giambattista della Porta',
    language: 'Latin',
    ia_identifier: 'iobaptistaeporta00port_0',
    source_url: 'https://archive.org/details/iobaptistaeporta00port_0',
    categories: ['natural-magic', 'natural-philosophy'],
    priority: 1,
    notes: 'UNTRANSLATED (only old 1658 partial). 20 books on natural magic, optics, alchemy.',
  },
  {
    title: 'Utriusque Cosmi Historia',
    display_title: 'Utriusque Cosmi Historia (1617)',
    author: 'Robert Fludd',
    language: 'Latin',
    ia_identifier: 'bub_gb_HNrzHpA-ADEC',
    source_url: 'https://archive.org/details/bub_gb_HNrzHpA-ADEC',
    categories: ['rosicrucianism', 'natural-philosophy', 'pythagoreanism'],
    priority: 1,
    notes: 'UNTRANSLATED. 1617 De Bry edition. Macrocosm/microcosm. Illustrated cosmic philosophy.',
  },

  // Tier 3: Cryptography & Memory
  {
    title: 'Polygraphia',
    display_title: 'Polygraphie (1561 French)',
    author: 'Johannes Trithemius',
    language: 'French',
    ia_identifier: 'polygraphieetvni00trit',
    source_url: 'https://archive.org/details/polygraphieetvni00trit',
    categories: ['natural-magic', 'cryptography'],
    priority: 3,
    notes: '1561 Paris, Kerver. Cryptography and universal writing system.',
  },

  // Tier 3: Alchemy - Basil Valentine
  {
    title: 'Of Natural and Supernatural Things',
    display_title: 'Basil Valentine: Natural & Supernatural Things (1671)',
    author: 'Basilius Valentinus',
    language: 'English',
    ia_identifier: 'bim_early-english-books-1641-1700_basilius-valentinus-o_basil-valentine_1671',
    source_url: 'https://archive.org/details/bim_early-english-books-1641-1700_basilius-valentinus-o_basil-valentine_1671',
    categories: ['alchemy', 'spiritual-alchemy'],
    priority: 3,
    notes: '1671 London. Alchemical philosophy and practice.',
  },
  {
    title: 'Last Will and Testament',
    display_title: 'Basil Valentine: Last Will & Testament (1671)',
    author: 'Basilius Valentinus',
    language: 'English',
    ia_identifier: 'lastvvilltestame00basi',
    source_url: 'https://archive.org/details/lastvvilltestame00basi',
    categories: ['alchemy', 'spiritual-alchemy'],
    priority: 3,
    notes: '1671 London. Includes Twelve Keys with symbolic woodcuts.',
  },

  // Tier 2: Atalanta Fugiens Manuscript
  {
    title: 'Atalanta Fugiens',
    display_title: 'Atalanta Fugiens (c.1625 English MS)',
    author: 'Michael Maier; English translator',
    language: 'English',
    ia_identifier: 'mellon48atalanta',
    source_url: 'https://archive.org/details/mellon48atalanta',
    categories: ['alchemy', 'rosicrucianism'],
    priority: 2,
    notes: 'c.1625 manuscript. English translation of 1618 German. Yale Beinecke.',
  },

  // Tier 1: John Dee
  {
    title: 'Monas Hieroglyphica',
    display_title: 'Monas Hieroglyphica (1564 Antwerp)',
    author: 'John Dee',
    language: 'Latin',
    ia_identifier: 'bub_gb_pRmoDybyIVEC',
    source_url: 'https://archive.org/details/bub_gb_pRmoDybyIVEC',
    categories: ['natural-magic', 'christian-cabala', 'alchemy'],
    priority: 1,
    notes: '1564 Antwerp first edition. Hieroglyphic symbol unifying cosmos.',
  },

  // Tier 2: Kepler
  {
    title: 'Mysterium Cosmographicum',
    display_title: 'Mysterium Cosmographicum (1596 First Edition)',
    author: 'Johannes Kepler',
    language: 'Latin',
    ia_identifier: '1596-kepler-prodromus-dissertationum-cosmographicarum-continens-mysterium-cosmographicum',
    source_url: 'https://archive.org/details/1596-kepler-prodromus-dissertationum-cosmographicarum-continens-mysterium-cosmographicum',
    categories: ['astronomy', 'pythagoreanism', 'natural-philosophy'],
    priority: 2,
    notes: '1596 Tübingen first edition. Platonic solids and planetary orbits.',
  },
  {
    title: 'Harmonices Mundi',
    display_title: 'Harmonices Mundi (1619 First Edition)',
    author: 'Johannes Kepler',
    language: 'Latin',
    ia_identifier: 'den-kbd-pil-210090002470-001',
    source_url: 'https://archive.org/details/den-kbd-pil-210090002470-001',
    categories: ['astronomy', 'pythagoreanism', 'natural-philosophy'],
    priority: 2,
    notes: '1619 Linz first edition. Music of spheres. Third law of planetary motion.',
  },

  // Tier 1: Cusanus - Incunabulum
  {
    title: 'De Vera Sapientia (Ydiota)',
    display_title: 'Cusanus: De Vera Sapientia (1486-1488)',
    author: 'Nicholas of Cusa',
    language: 'Latin',
    ia_identifier: 'ned-kbn-all-00002163-001',
    source_url: 'https://archive.org/details/ned-kbn-all-00002163-001',
    categories: ['neoplatonism', 'christian-mysticism'],
    priority: 1,
    notes: '1486-1488 Zwolle incunabulum. Learned ignorance. Coincidence of opposites.',
  },

  // Tier 1: Ramon Llull - NEVER PROPERLY TRANSLATED
  {
    title: 'Ars Magna Generalis',
    display_title: 'Llull: Ars Magna Generalis (1517)',
    author: 'Ramon Llull; ed. Bernardus la Vinheta',
    language: 'Latin',
    ia_identifier: 'bub_gb_rG_yINh8V1gC',
    source_url: 'https://archive.org/details/bub_gb_rG_yINh8V1gC',
    categories: ['natural-magic', 'christian-cabala'],
    priority: 1,
    notes: 'UNTRANSLATED. 1517 Lyon edition. Combinatory art. Foundation of memory systems.',
  },

  // Tier 1: Pseudo-Dionysius
  {
    title: 'Opera Sancti Dionysii',
    display_title: 'Pseudo-Dionysius: Opera (1516)',
    author: 'Pseudo-Dionysius the Areopagite',
    language: 'Latin',
    ia_identifier: 'bub_gb_SUHKrROwiwEC',
    source_url: 'https://archive.org/details/bub_gb_SUHKrROwiwEC',
    categories: ['neoplatonism', 'christian-mysticism', 'theurgy'],
    priority: 1,
    notes: '1516 edition. Celestial Hierarchy, Divine Names, Mystical Theology.',
  },
  {
    title: 'De Coelesti Hierarchia',
    display_title: 'Pseudo-Dionysius: De Coelesti Hierarchia (c.1300 MS)',
    author: 'Pseudo-Dionysius the Areopagite',
    language: 'Latin',
    ia_identifier: 'BeineckeMS526_47',
    source_url: 'https://archive.org/details/BeineckeMS526_47',
    categories: ['neoplatonism', 'christian-mysticism'],
    priority: 1,
    notes: 'c.1300 manuscript. Yale Beinecke. Angelic hierarchies.',
  },

  // Tier 3: Galileo - HAS MODERN TRANSLATIONS
  {
    title: 'Sidereus Nuncius',
    display_title: 'Sidereus Nuncius (1610 Venice)',
    author: 'Galileo Galilei',
    language: 'Latin',
    ia_identifier: 'ita-bnc-pos-0000056-001',
    source_url: 'https://archive.org/details/ita-bnc-pos-0000056-001',
    categories: ['astronomy', 'natural-philosophy'],
    priority: 3,
    notes: 'Has translations (Van Helden 1989). 1610 Venice first edition. Moons of Jupiter.',
  },

  // Tier 3: Vesalius - HAS MODERN TRANSLATIONS
  {
    title: 'De Humani Corporis Fabrica',
    display_title: 'Vesalius: De Humani Corporis Fabrica (1555)',
    author: 'Andreas Vesalius',
    language: 'Latin',
    ia_identifier: 'andreaevesalijbr00vesa',
    source_url: 'https://archive.org/details/andreaevesalijbr00vesa',
    categories: ['natural-philosophy', 'medicine'],
    priority: 3,
    notes: 'Has translations (Richardson/Carman 2009). 1555 Basel second edition.',
  },

  // Tier 1: Euclid - Incunabulum
  {
    title: 'Elementa Geometriae',
    display_title: 'Euclid: Elementa (1482 Ratdolt)',
    author: 'Euclid; ed. Johannes Campanus',
    language: 'Latin',
    ia_identifier: 'OEXV231RES',
    source_url: 'https://archive.org/details/OEXV231RES',
    categories: ['mathematics', 'natural-philosophy'],
    priority: 1,
    notes: '1482 Venice, Ratdolt. First printed geometry with diagrams. Incunabulum.',
  },

  // Tier 1: Avicenna - Medieval MS
  {
    title: 'Canon Medicinae',
    display_title: 'Avicenna: Canon Medicinae (c.1280 MS)',
    author: 'Avicenna (Ibn Sina); trans. Gerard of Cremona',
    language: 'Latin',
    ia_identifier: '4444103.med.yale.edu',
    source_url: 'https://archive.org/details/4444103.med.yale.edu',
    categories: ['medicine', 'natural-philosophy'],
    priority: 1,
    notes: 'Late 13th century Spanish manuscript. Yale Medical Library. Vellum with illuminations.',
  },

  // Tier 1: Boethius - Incunabulum
  {
    title: 'De Consolatione Philosophiae',
    display_title: 'Boethius: De Consolatione (1486)',
    author: 'Boethius; comm. Thomas Waleys',
    language: 'Latin',
    ia_identifier: 'deconsolationeph00boet_0',
    source_url: 'https://archive.org/details/deconsolationeph00boet_0',
    categories: ['neoplatonism', 'christian-mysticism'],
    priority: 1,
    notes: '1486 Lyon incunabulum. With Pseudo-Thomas commentary. Foundation of medieval philosophy.',
  },

  // Tier 1: Albertus Magnus - NEVER TRANSLATED
  {
    title: 'De Mineralibus',
    display_title: 'Albertus Magnus: De Mineralibus (1519)',
    author: 'Albertus Magnus',
    language: 'Latin',
    ia_identifier: 'sucho-id-alberti-magni-philosophorum-maximi-de-mineralibus-libri-quinque',
    source_url: 'https://archive.org/details/sucho-id-alberti-magni-philosophorum-maximi-de-mineralibus-libri-quinque',
    categories: ['natural-philosophy', 'alchemy'],
    priority: 1,
    notes: 'UNTRANSLATED. 1519 Augsburg. Medieval natural history of minerals and stones.',
  },

  // Tier 2: Tycho Brahe
  {
    title: 'Astronomiae Instauratae Mechanica',
    display_title: 'Tycho Brahe: Astronomiae Instauratae (1602)',
    author: 'Tycho Brahe',
    language: 'Latin',
    ia_identifier: 'TychonisBraheAs00BrahA',
    source_url: 'https://archive.org/details/TychonisBraheAs00BrahA',
    categories: ['astronomy', 'natural-philosophy'],
    priority: 2,
    notes: '1602 Nuremberg. Astronomical instruments. Uranienborg observatory engravings.',
  },

  // Tier 1: Ficino's Circle - Florentine Renaissance
  {
    title: 'Miscellaneorum Centuria Prima',
    display_title: 'Poliziano: Miscellaneorum (1489 Florence)',
    author: 'Angelo Poliziano',
    language: 'Latin',
    ia_identifier: 'ita-bnc-in1-00000651-001',
    source_url: 'https://archive.org/details/ita-bnc-in1-00000651-001',
    categories: ['florentine-platonism', 'renaissance'],
    priority: 1,
    notes: '1489 Florence incunabulum. Philological essays. Ficino circle member.',
  },
  {
    title: 'Comento sopra la Commedia di Dante',
    display_title: 'Landino: Dante Commentary (1481 Florence)',
    author: 'Cristoforo Landino',
    language: 'Italian',
    ia_identifier: 'b.-r.-341-jpeg',
    source_url: 'https://archive.org/details/b.-r.-341-jpeg',
    categories: ['florentine-platonism', 'renaissance'],
    priority: 1,
    notes: '1481 Florence incunabulum. Neoplatonic Dante interpretation. Botticelli engravings.',
  },

  // Tier 2: Architecture & Design
  {
    title: 'De re aedificatoria',
    display_title: 'Alberti: De re aedificatoria (1512 Paris)',
    author: 'Leon Battista Alberti',
    language: 'Latin',
    ia_identifier: 'bub_gb_nJIqYfOjJIEC',
    source_url: 'https://archive.org/details/bub_gb_nJIqYfOjJIEC',
    categories: ['renaissance', 'architecture'],
    priority: 2,
    notes: '1512 Paris edition. First Renaissance architecture treatise. Vitruvian revival.',
  },

  // Tier 1: Illustrated Books - Renaissance Art
  {
    title: 'Hypnerotomachia Poliphili',
    display_title: 'Hypnerotomachia Poliphili (1499 Aldine)',
    author: 'Francesco Colonna',
    language: 'Italian/Latin',
    ia_identifier: 'A336080v1',
    source_url: 'https://archive.org/details/A336080v1',
    categories: ['renaissance', 'hermeticism', 'architecture'],
    priority: 1,
    notes: '1499 Venice, Aldus Manutius. Dream allegory. Most beautiful Renaissance book. 172 woodcuts.',
  },
  {
    title: 'Emblemata',
    display_title: 'Alciato: Emblemata (1548 Lyon)',
    author: 'Andrea Alciato',
    language: 'Latin',
    ia_identifier: 'emblemataandreae00alcia',
    source_url: 'https://archive.org/details/emblemataandreae00alcia',
    categories: ['renaissance', 'hermeticism'],
    priority: 2,
    notes: '1548 Lyon edition with woodcuts. Foundation of emblem book tradition.',
  },

  // Tier 1: Dürer - Art Theory
  {
    title: 'Vier Bücher von menschlicher Proportion',
    display_title: 'Dürer: Human Proportion (1528 First Edition)',
    author: 'Albrecht Dürer',
    language: 'German',
    ia_identifier: 'hierinnsindbegri00dure',
    source_url: 'https://archive.org/details/hierinnsindbegri00dure',
    categories: ['renaissance', 'art-theory', 'mathematics'],
    priority: 1,
    notes: '1528 Nuremberg, Hieronymus Andreae. First edition. 136 woodcut figures. Mathematical proportions.',
  },

  // Tier 1: Vitruvius - Architecture
  {
    title: 'De Architectura Libri Decem',
    display_title: 'Vitruvius: De Architectura (1522 Florence)',
    author: 'Vitruvius Pollio; ed. Giovanni Giocondo',
    language: 'Latin',
    ia_identifier: 'mvitrvviidearchi00vitr',
    source_url: 'https://archive.org/details/mvitrvviidearchi00vitr',
    categories: ['architecture', 'natural-philosophy'],
    priority: 1,
    notes: '1522 Florence, Junta. Giocondo edition. Foundation of Renaissance architecture.',
  },

  // Tier 2: Drebbel - Natural Philosophy/Alchemy
  {
    title: 'Tractatus duo',
    display_title: 'Drebbel: Tractatus duo (1628 Latin)',
    author: 'Cornelius Drebbel; trans. Petrus Laurembergius',
    language: 'Latin',
    ia_identifier: 'bub_gb_7c7pB61grDgC',
    source_url: 'https://archive.org/details/bub_gb_7c7pB61grDgC',
    categories: ['alchemy', 'natural-philosophy'],
    priority: 2,
    notes: '1628 Latin edition. De natura elementorum. De quinta essentia. Perpetual motion letter.',
  },

  // Tier 1: Kepler - Astronomia Nova
  {
    title: 'Astronomia Nova',
    display_title: 'Kepler: Astronomia Nova (1609 Prague)',
    author: 'Johannes Kepler',
    language: 'Latin',
    ia_identifier: 'Astronomianovaa00Kepl',
    source_url: 'https://archive.org/details/Astronomianovaa00Kepl',
    categories: ['astronomy', 'natural-philosophy'],
    priority: 1,
    notes: '1609 Prague first edition. Laws of planetary motion. Based on Tycho Brahe observations.',
  },

  // Tier 1: Palladio - Architecture
  {
    title: 'I Quattro Libri dell\'Architettura',
    display_title: 'Palladio: Quattro Libri (1616 Venice)',
    author: 'Andrea Palladio',
    language: 'Italian',
    ia_identifier: 'quattrolibridell00pall',
    source_url: 'https://archive.org/details/quattrolibridell00pall',
    categories: ['architecture', 'renaissance'],
    priority: 1,
    notes: '1616 Venice, Carampello. Four Books on Architecture. Foundation of classical revival.',
  },

  // Tier 2: Serlio - Architecture
  {
    title: 'Regole generali di architettura',
    display_title: 'Serlio: Regole generali (1540 Venice)',
    author: 'Sebastiano Serlio',
    language: 'Italian',
    ia_identifier: 'ldpd_11820669_001',
    source_url: 'https://archive.org/details/ldpd_11820669_001',
    categories: ['architecture', 'renaissance'],
    priority: 2,
    notes: '1540 Venice, Marcolini. Five orders of architecture. Vitruvian tradition.',
  },

  // Tier 1: Dürer - Geometry
  {
    title: 'Unterweysung der Messung',
    display_title: 'Dürer: Unterweysung der Messung (1525 First Edition)',
    author: 'Albrecht Dürer',
    language: 'German',
    ia_identifier: 'vnderweysungderm00drer',
    source_url: 'https://archive.org/details/vnderweysungderm00drer',
    categories: ['mathematics', 'art-theory', 'renaissance'],
    priority: 1,
    notes: '1525 Nuremberg first edition. Geometry with compass and straightedge. Perspective and lettering.',
  },

  // Tier 1: Newton - Principia
  {
    title: 'Philosophiae Naturalis Principia Mathematica',
    display_title: 'Newton: Principia (1726 Third Edition)',
    author: 'Isaac Newton',
    language: 'Latin',
    ia_identifier: 'A297190',
    source_url: 'https://archive.org/details/A297190',
    categories: ['natural-philosophy', 'mathematics', 'astronomy'],
    priority: 1,
    notes: '1726 London third edition. Last edition Newton supervised. Foundation of modern physics.',
  },

  // Tier 1: Sendivogius - Alchemy - ONLY PARTIAL OLD TRANSLATIONS
  {
    title: 'De Lapide Philosophorum',
    display_title: 'Sendivogius: Novum Lumen Chymicum (1611)',
    author: 'Michael Sendivogius',
    language: 'Latin',
    ia_identifier: 'hin-wel-all-00003011-001',
    source_url: 'https://archive.org/details/hin-wel-all-00003011-001',
    categories: ['alchemy', 'rosicrucianism'],
    priority: 1,
    notes: 'PARTIAL TRANSLATION ONLY (old). 1611 Frankfurt. Twelve treatises on philosopher\'s stone.',
  },

  // Tier 1: Cardano - Mathematics
  {
    title: 'Ars Magna',
    display_title: 'Cardano: Ars Magna (1545 First Edition)',
    author: 'Girolamo Cardano',
    language: 'Latin',
    ia_identifier: 'bub_gb_2tT0gVUf2YsC',
    source_url: 'https://archive.org/details/bub_gb_2tT0gVUf2YsC',
    categories: ['mathematics', 'renaissance'],
    priority: 1,
    notes: '1545 Nuremberg, Petreius. First edition. Cubic and quartic equation solutions. Foundation of algebra.',
  },
  {
    title: 'De Subtilitate',
    display_title: 'Cardano: De Subtilitate (1550)',
    author: 'Girolamo Cardano',
    language: 'Latin',
    ia_identifier: 'bub_gb_Tmf3wRsurVsC',
    source_url: 'https://archive.org/details/bub_gb_Tmf3wRsurVsC',
    categories: ['natural-philosophy', 'renaissance'],
    priority: 1,
    notes: 'UNTRANSLATED. 1550 Nuremberg. 21 books on natural philosophy. Renaissance encyclopedism.',
  },

  // Tier 2: Ripley - English Alchemy
  {
    title: 'Ripley Reviv\'d',
    display_title: 'Ripley Reviv\'d (1678)',
    author: 'Eirenaeus Philalethes; ed. William Cooper',
    language: 'English',
    ia_identifier: 'b30331821',
    source_url: 'https://archive.org/details/b30331821',
    categories: ['alchemy', 'spiritual-alchemy'],
    priority: 2,
    notes: '1678 London. Commentary on George Ripley\'s alchemical works. Major English alchemy.',
  },

  // Tier 1: Petrarch - Renaissance Literature
  {
    title: 'Li Sonetti Canzone Triumphi',
    display_title: 'Petrarch: Sonnets with Commentary (1519)',
    author: 'Francesco Petrarca',
    language: 'Italian',
    ia_identifier: 'bub_gb_PudU0xMsPiUC',
    source_url: 'https://archive.org/details/bub_gb_PudU0xMsPiUC',
    categories: ['renaissance', 'literature'],
    priority: 1,
    notes: '1519 Naples. Sonnets, canzone, and triumphi with commentary. Foundation of Renaissance poetry.',
  },

  // Tier 2: Thomas More - Utopia
  {
    title: 'Utopia',
    display_title: 'More: Utopia (1685 Burnet Translation)',
    author: 'Thomas More; trans. Gilbert Burnet',
    language: 'English',
    ia_identifier: 'utopia00more_2',
    source_url: 'https://archive.org/details/utopia00more_2',
    categories: ['renaissance', 'utopian'],
    priority: 2,
    notes: '1685 London, Chiswell. English translation by Bishop Burnet. Foundational political philosophy.',
  },

  // Tier 1: Rosicrucian Manifestos
  {
    title: 'Fama Fraternitatis',
    display_title: 'Fama Fraternitatis (1615 Danzig)',
    author: 'Johann Valentin Andreae (attr.)',
    language: 'German',
    ia_identifier: 'famafraternitati00andr',
    source_url: 'https://archive.org/details/famafraternitati00andr',
    categories: ['rosicrucianism', 'hermeticism'],
    priority: 1,
    notes: '1615 Danzig, Hünefeldt. First Rosicrucian manifesto. Includes Confessio and responses.',
  },
  {
    title: 'Chymische Hochzeit',
    display_title: 'Chemical Wedding (1616 Strassburg)',
    author: 'Johann Valentin Andreae',
    language: 'German',
    ia_identifier: 'chymischehochzei00rose',
    source_url: 'https://archive.org/details/chymischehochzei00rose',
    categories: ['rosicrucianism', 'alchemy', 'spiritual-alchemy'],
    priority: 1,
    notes: '1616 Strassburg, Zetzner. Third Rosicrucian manifesto. Alchemical allegory in seven days.',
  },

  // Tier 1: Comenius - Pansophism & Education
  {
    title: 'Orbis Sensualium Pictus',
    display_title: 'Orbis Sensualium Pictus (1659 First English)',
    author: 'Jan Amos Comenius',
    language: 'Latin/English',
    ia_identifier: 'bim_early-english-books-1641-1700_joh-amos-commenii-orbi_comenius-johann-amos_1659',
    source_url: 'https://archive.org/details/bim_early-english-books-1641-1700_joh-amos-commenii-orbi_comenius-johann-amos_1659',
    categories: ['pansophism', 'education', 'renaissance'],
    priority: 1,
    notes: 'PRIORITY ACQUISITION. 1659 London. Revolutionary illustrated encyclopedia. First picture book for education. 353 pages.',
  },
  {
    title: 'Pansophiae Diatyposis',
    display_title: 'Pansophiae Diatyposis (1645 Elzevier)',
    author: 'Jan Amos Comenius',
    language: 'Latin',
    ia_identifier: 'bub_gb_MGhEAAAAcAAJ',
    source_url: 'https://archive.org/details/bub_gb_MGhEAAAAcAAJ',
    categories: ['pansophism', 'education', 'renaissance'],
    priority: 1,
    notes: 'PRIORITY ACQUISITION. UNTRANSLATED. 1645 Elzevier. Outline of universal knowledge. 217 pages.',
  },
  {
    title: 'Pansophiae Prodromus',
    display_title: 'Pansophiae Prodromus (1638)',
    author: 'Jan Amos Comenius',
    language: 'Latin',
    ia_identifier: 'bim_early-english-books-1475-1640_reverendi-et-clarissimi-_komensk-jan-amos_1638',
    source_url: 'https://archive.org/details/bim_early-english-books-1475-1640_reverendi-et-clarissimi-_komensk-jan-amos_1638',
    categories: ['pansophism', 'education', 'renaissance'],
    priority: 1,
    notes: 'PRIORITY ACQUISITION. UNTRANSLATED. 1638. Forerunner of Pansophia. Vision of universal knowledge.',
  },
  {
    title: 'Naturall Philosophie Reformed',
    display_title: 'Naturall Philosophie Reformed by Divine Light (1651)',
    author: 'Jan Amos Comenius',
    language: 'English',
    ia_identifier: 'naturallphilosop00come',
    source_url: 'https://archive.org/details/naturallphilosop00come',
    categories: ['pansophism', 'natural-philosophy', 'renaissance'],
    priority: 1,
    notes: 'PRIORITY ACQUISITION. 1651 London, Leybourn. Synopsis of physics reformed by divine light. 256 pages.',
  },
  {
    title: 'Janua Linguarum Reserata',
    display_title: 'Janua Linguarum Reserata (1641)',
    author: 'Jan Amos Comenius',
    language: 'Latin/English',
    ia_identifier: 'bim_early-english-books-1641-1700_janua-linguarum-reserata_comenius-johann-amos_1641',
    source_url: 'https://archive.org/details/bim_early-english-books-1641-1700_janua-linguarum-reserata_comenius-johann-amos_1641',
    categories: ['pansophism', 'education', 'renaissance'],
    priority: 1,
    notes: 'PRIORITY ACQUISITION. 1641 edition. "The Gate of Languages Unlocked." Revolutionary language method.',
  },

  // Tier 1: Major Alchemical Anthologies
  {
    title: 'Theatrum Chemicum',
    display_title: 'Theatrum Chemicum Vol. III (1602)',
    author: 'Various; ed. Lazarus Zetzner',
    language: 'Latin',
    ia_identifier: 'BIUSante_pharma_res011287x03',
    source_url: 'https://archive.org/details/BIUSante_pharma_res011287x03',
    categories: ['alchemy', 'hermeticism'],
    priority: 1,
    notes: '1602 Strassburg, first edition. Major Latin alchemical anthology. 21 treatises.',
  },
  {
    title: 'Turba Philosophorum',
    display_title: 'Turba Philosophorum (1572 Basel)',
    author: 'Various; ed. P. Perna',
    language: 'Latin',
    ia_identifier: 'hin-wel-all-00002028-001',
    source_url: 'https://archive.org/details/hin-wel-all-00002028-001',
    categories: ['alchemy'],
    priority: 1,
    notes: '1572 Basel, Perna. "Assembly of the Sages." Oldest Latin alchemical anthology.',
  },

  // Tier 1: Kepler - Optics
  {
    title: 'Dioptrice',
    display_title: 'Kepler: Dioptrice (1611 First Edition)',
    author: 'Johannes Kepler',
    language: 'Latin',
    ia_identifier: 'dioptricesevdemo00kepl',
    source_url: 'https://archive.org/details/dioptricesevdemo00kepl',
    categories: ['natural-philosophy', 'astronomy'],
    priority: 1,
    notes: '1611 Augsburg first edition. Optics and telescope theory. Foundation of geometric optics.',
  },

  // Tier 1: Lomazzo - Art Theory
  {
    title: 'Trattato dell\'arte della pittura',
    display_title: 'Lomazzo: Trattato (1584 Milan)',
    author: 'Giovanni Paolo Lomazzo',
    language: 'Italian',
    ia_identifier: 'bub_gb_k16wKRtVntsC',
    source_url: 'https://archive.org/details/bub_gb_k16wKRtVntsC',
    categories: ['art-theory', 'renaissance'],
    priority: 1,
    notes: '1584 Milan, Pontio. Seven books on painting theory and practice. Major Mannerist treatise.',
  },

  // Tier 2: Trithemius - Cryptography
  {
    title: 'Steganographia',
    display_title: 'Trithemius: Steganographia (1608)',
    author: 'Johannes Trithemius',
    language: 'Latin',
    ia_identifier: 'bub_gb_8A75sRz4b3gC',
    source_url: 'https://archive.org/details/bub_gb_8A75sRz4b3gC',
    categories: ['natural-magic', 'cryptography'],
    priority: 2,
    notes: '1608 Frankfurt. Hidden writing and angel magic. Occult cryptography treatise.',
  },

  // Tier 1: Medieval Magic Manuscripts
  {
    title: 'Ars Notoria',
    display_title: 'Ars Notoria (c.1225 Medieval MS)',
    author: 'Anonymous; attr. to Apollonius',
    language: 'Latin',
    ia_identifier: 'MellonMS1_47',
    source_url: 'https://archive.org/details/MellonMS1_47',
    categories: ['ritual-magic', 'medieval'],
    priority: 1,
    notes: 'c.1225 manuscript. Yale Beinecke MS 1. Solomonic art of memory and angelic invocations.',
  },

  // Tier 2: Demonology & Witchcraft
  {
    title: 'Daemonologie',
    display_title: 'King James: Daemonologie (1597 First Edition)',
    author: 'King James I of England',
    language: 'English',
    ia_identifier: 'bim_early-english-books-1475-1640_daemonologie-in-forme-o_james-i_1597',
    source_url: 'https://archive.org/details/bim_early-english-books-1475-1640_daemonologie-in-forme-o_james-i_1597',
    categories: ['demonology', 'witchcraft'],
    priority: 2,
    notes: '1597 Edinburgh first edition. Royal treatise on witchcraft, dialogue form.',
  },
  {
    title: 'De Praestigiis Daemonum',
    display_title: 'Weyer: De Praestigiis Daemonum (1568)',
    author: 'Johann Weyer',
    language: 'Latin',
    ia_identifier: 'bub_gb_TgQ6AAAAcAAJ',
    source_url: 'https://archive.org/details/bub_gb_TgQ6AAAAcAAJ',
    categories: ['demonology', 'medicine'],
    priority: 1,
    notes: 'PARTIAL TRANSLATION ONLY (Mora 1991). 1568 Basel. Skeptical of witchcraft accusations.',
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

      // Validate: reject modern editions
      const validationError = validateOldEdition(book.ia_identifier, book.notes);
      if (validationError) {
        console.warn(`Skipping ${book.title}: ${validationError}`);
        results.push({ title: book.title, status: 'error' });
        continue;
      }

      try {
        const bookId = new ObjectId();
        const bookIdStr = bookId.toHexString();
        const now = new Date();

        const bookDoc = {
          _id: bookId,
          id: bookIdStr,
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
        results.push({ title: book.title, status: 'added', id: bookIdStr });
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
