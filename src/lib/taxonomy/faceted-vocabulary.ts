/**
 * Faceted Vocabulary for Source Library
 *
 * Inspired by the library's own classification thinkers:
 * - Llull's combinatorial principles (few facets, multiplicative expressiveness)
 * - Bacon's cognitive grounding (facets rooted in what the mind does)
 * - Porphyry's differentia (each value has a clear splitting criterion)
 * - Gessner's multiple access points (no single facet is primary)
 * - Dionysius's ranked tags (source, bridge, and browse levels)
 *
 * Design constraint: each facet has 5-50 values. 7 facets x ~15 values = ~105 tag values,
 * but 15^3 = 3,375 three-facet intersections -- far more expressive than 226 subclusters.
 */

// --- Facet Definitions ---

export interface FacetValue {
  id: string;
  label: string;
  /** One-sentence description -- what distinguishes this from its neighbors */
  differentia: string;
}

export interface Facet {
  id: string;
  /** MongoDB field name inside faceted_tags, if different from id */
  dbField?: string;
  label: string;
  /** What question does this facet answer? (Kircher's question-based access) */
  question: string;
  /** How many tags from this facet should a book typically get? */
  cardinality: { min: number; max: number };
  values: FacetValue[];
}

/** Get the MongoDB field path for a facet (inside faceted_tags) */
export function facetDbField(facet: Facet): string {
  return facet.dbField || facet.id;
}

// --- Domain Groups (3-level hierarchy for browse UI) ---

export interface DomainGroup {
  id: string;
  label: string;
  domains: string[]; // IDs of FacetValues in this group
}

/**
 * 48 knowledge domains organized into 10 groups.
 * Groups provide 3-level hierarchy for the /topics browse page:
 *   Group -> Domain -> Books
 *
 * Designed for cross-cultural coverage: a Chinese military encyclopedia,
 * a Latin alchemical treatise, and a Dunhuang sutra all classify cleanly.
 */
export const DOMAIN_GROUPS: DomainGroup[] = [
  {
    id: 'philosophy-thought',
    label: 'Philosophy & Thought',
    domains: ['philosophy', 'theology', 'mysticism', 'cosmology', 'history'],
  },
  {
    id: 'science-nature',
    label: 'Science & Nature',
    domains: [
      'astronomy',
      'mathematics',
      'medicine',
      'pharmacology',
      'natural-history',
      'natural-philosophy',
      'chemistry',
      'geography',
    ],
  },
  {
    id: 'hidden-arts',
    label: 'The Hidden Arts',
    domains: ['alchemy', 'astrology', 'magic', 'divination', 'kabbalah'],
  },
  {
    id: 'esoteric-currents',
    label: 'Esoteric Currents',
    domains: [
      'hermeticism',
      'neoplatonism',
      'esotericism',
      'freemasonry',
      'rosicrucianism',
      'theosophy',
    ],
  },
  {
    id: 'sacred-devotional',
    label: 'Sacred & Devotional',
    domains: ['scripture', 'devotion', 'prophecy'],
  },
  {
    id: 'world-knowledge',
    label: 'World Knowledge Systems',
    domains: ['daoism', 'buddhism', 'sufism', 'gnosticism', 'demonology'],
  },
  {
    id: 'human-affairs',
    label: 'Human Affairs',
    domains: ['politics', 'military', 'law', 'economics', 'architecture'],
  },
  {
    id: 'language-art-culture',
    label: 'Language, Art & Culture',
    domains: ['literature', 'language', 'music', 'art', 'technology', 'education'],
  },
  {
    id: 'reference',
    label: 'Reference',
    domains: ['encyclopedia', 'bibliography'],
  },
  {
    id: 'material-manuscript',
    label: 'Material & Manuscript',
    domains: ['cryptography', 'printing', 'emblematics'],
  },
];

// --- TRADITION (intellectual lineage / school of thought) ---

export const TRADITION: Facet = {
  id: 'tradition',
  label: 'Tradition',
  question: 'What intellectual lineage does this belong to?',
  cardinality: { min: 0, max: 3 }, // 0 allowed: secular science, bibliographies, indigenous texts
  values: [
    {
      id: 'hermetic',
      label: 'Hermetic',
      differentia: 'Attributed to Hermes Trismegistus or the Corpus Hermeticum tradition',
    },
    {
      id: 'alchemical',
      label: 'Alchemical',
      differentia: 'Concerned with transmutation of matter or the Great Work',
    },
    {
      id: 'kabbalistic',
      label: 'Kabbalistic',
      differentia: 'Jewish mystical tradition: Sefirot, Zohar, letter mysticism',
    },
    {
      id: 'neoplatonic',
      label: 'Neoplatonic',
      differentia: 'Emanation from the One, via Plotinus, Proclus, or their heirs',
    },
    {
      id: 'rosicrucian',
      label: 'Rosicrucian',
      differentia: 'The Rosy Cross brotherhood, manifestos, and their influence',
    },
    {
      id: 'masonic',
      label: 'Masonic',
      differentia: 'Freemasonry, lodge rituals, and fraternal initiation',
    },
    {
      id: 'theosophical',
      label: 'Theosophical',
      differentia:
        "Blavatsky's Theosophy or Boehme's theosophy -- divine wisdom traditions",
    },
    {
      id: 'gnostic',
      label: 'Gnostic',
      differentia: 'Salvation through knowledge, demiurge, pleroma, aeons',
    },
    {
      id: 'pythagorean',
      label: 'Pythagorean',
      differentia: 'Number as the principle of reality, harmony of spheres',
    },
    {
      id: 'paracelsian',
      label: 'Paracelsian',
      differentia: 'Paracelsus and iatrochemistry -- tria prima, archeus, signatures',
    },
    {
      id: 'sufi',
      label: 'Sufi / Islamic Mystical',
      differentia: 'Islamic mysticism, tariqa, Rumi, Ibn Arabi, irfan',
    },
    {
      id: 'vedic',
      label: 'Vedic / Hindu',
      differentia: 'Vedas, Upanishads, darshanas, tantra, yoga traditions',
    },
    {
      id: 'buddhist',
      label: 'Buddhist',
      differentia: 'Dharma, sutra, tantra -- Theravada, Mahayana, Vajrayana',
    },
    {
      id: 'daoist',
      label: 'Daoist',
      differentia: 'Dao, wu wei, inner alchemy (neidan), Zhuangzi, Laozi',
    },
    {
      id: 'classical',
      label: 'Classical Greek & Roman',
      differentia:
        'Plato, Aristotle, Stoics, or the broader Greco-Roman intellectual world',
    },
    {
      id: 'christian-mystical',
      label: 'Christian Mystical',
      differentia:
        'Eckhart, Boehme, Dionysius -- direct experience of God in Christian framing',
    },
    {
      id: 'new-thought',
      label: 'New Thought / Spiritualist',
      differentia: 'Mental science, positive thinking, mesmerism, spiritualism, occult revival',
    },
  ],
};

// --- DOMAIN (subject matter -- 48 cross-cultural knowledge domains) ---

export const DOMAIN: Facet = {
  id: 'domain',
  dbField: 'knowledge_domain',
  label: 'Knowledge Domain',
  question: 'What is the subject matter?',
  cardinality: { min: 1, max: 3 },
  values: [
    // Philosophy & Thought
    { id: 'philosophy', label: 'Philosophy', differentia: 'Metaphysics, epistemology, logic, ethics' },
    {
      id: 'theology',
      label: 'Theology',
      differentia: 'Doctrine, scriptural interpretation, systematic theology',
    },
    {
      id: 'mysticism',
      label: 'Mysticism',
      differentia: 'Contemplative experience, spiritual union, inner knowledge',
    },
    {
      id: 'cosmology',
      label: 'Cosmology',
      differentia: 'Origin and structure of the universe, creation, emanation',
    },
    {
      id: 'history',
      label: 'History',
      differentia: 'Chronicles, biography, annals, narrative of past events',
    },
    // Science & Nature
    {
      id: 'astronomy',
      label: 'Astronomy',
      differentia: 'Celestial observation, planetary motion, star catalogs',
    },
    { id: 'mathematics', label: 'Mathematics', differentia: 'Arithmetic, geometry, algebra, harmonics' },
    { id: 'medicine', label: 'Medicine', differentia: 'Anatomy, disease, healing, surgery' },
    {
      id: 'pharmacology',
      label: 'Pharmacology',
      differentia: 'Herbals, materia medica, pharmacopoeia, drugs, poisons',
    },
    {
      id: 'natural-history',
      label: 'Natural History',
      differentia: 'Animals, minerals, bestiaries, zoology, geology',
    },
    {
      id: 'natural-philosophy',
      label: 'Natural Philosophy',
      differentia: 'Physics, mechanics, optics, elements, proto-science',
    },
    {
      id: 'chemistry',
      label: 'Chemistry',
      differentia: 'Elements, distillation, substances, iatrochemistry',
    },
    {
      id: 'geography',
      label: 'Geography',
      differentia: 'Maps, travel, exploration, cosmography, ethnography',
    },
    // The Hidden Arts
    {
      id: 'alchemy',
      label: 'Alchemy',
      differentia: 'Transmutation, Great Work, spagyrics, philosophical and laboratory',
    },
    {
      id: 'astrology',
      label: 'Astrology',
      differentia: 'Celestial influence, horoscopes, prognostication',
    },
    {
      id: 'magic',
      label: 'Magic',
      differentia: 'Grimoires, talismans, conjuration, theurgy, natural magic',
    },
    {
      id: 'divination',
      label: 'Divination',
      differentia: 'Geomancy, omens, Yi Jing, haruspicy, fortune-telling',
    },
    {
      id: 'kabbalah',
      label: 'Kabbalah',
      differentia: 'Sefirot, Zohar, letter mysticism, Jewish and Christian',
    },
    // Esoteric Currents
    {
      id: 'hermeticism',
      label: 'Hermeticism',
      differentia: 'Corpus Hermeticum, Trismegistus, Hermetic philosophy',
    },
    {
      id: 'neoplatonism',
      label: 'Neoplatonism',
      differentia: 'Plotinus, Proclus, emanation, the One, henads',
    },
    {
      id: 'esotericism',
      label: 'Esotericism',
      differentia: 'Occult philosophy, prisca theologia, signatures, secret knowledge',
    },
    {
      id: 'freemasonry',
      label: 'Freemasonry',
      differentia: 'Lodge ritual, fraternal initiation, Kloss Collection',
    },
    {
      id: 'rosicrucianism',
      label: 'Rosicrucianism',
      differentia: 'Rosy Cross, manifestos, Rosicrucian influence',
    },
    {
      id: 'theosophy',
      label: 'Theosophy',
      differentia: "Boehme's divine wisdom and Blavatsky's Theosophy",
    },
    // Sacred & Devotional
    {
      id: 'scripture',
      label: 'Scripture',
      differentia: 'Canonical sacred texts, revelation, sutras, Vedas, Torah',
    },
    {
      id: 'devotion',
      label: 'Devotion',
      differentia: 'Prayer, hymns, homilies, hagiography, liturgy',
    },
    {
      id: 'prophecy',
      label: 'Prophecy',
      differentia: 'Apocalyptic, visionary, millenarian, eschatological',
    },
    // World Knowledge Systems
    { id: 'daoism', label: 'Daoism', differentia: 'Dao, wu wei, neidan, Zhuangzi, Laozi' },
    {
      id: 'buddhism',
      label: 'Buddhism',
      differentia: 'Dharma, sutra, tantra, meditation, Dunhuang Buddhist texts',
    },
    {
      id: 'sufism',
      label: 'Sufism',
      differentia: 'Islamic mysticism, tariqa, Rumi, Ibn Arabi, irfan',
    },
    {
      id: 'gnosticism',
      label: 'Gnosticism',
      differentia: 'Nag Hammadi, demiurge, pleroma, Valentinian, Sethian',
    },
    {
      id: 'demonology',
      label: 'Demonology',
      differentia: 'Spirit hierarchies, exorcism, demonic classification, witchcraft',
    },
    // Human Affairs
    {
      id: 'politics',
      label: 'Politics',
      differentia: 'Governance, statecraft, political philosophy, diplomacy',
    },
    {
      id: 'military',
      label: 'Military',
      differentia: 'Warfare, fortification, strategy, weapons, siege machines',
    },
    { id: 'law', label: 'Law', differentia: 'Jurisprudence, legal codes, canon law, trials' },
    {
      id: 'economics',
      label: 'Economics',
      differentia: 'Trade, finance, agriculture, craft, guild knowledge',
    },
    {
      id: 'architecture',
      label: 'Architecture',
      differentia: 'Building, design, proportion, fortification, urban planning',
    },
    // Language, Art & Culture
    {
      id: 'literature',
      label: 'Literature',
      differentia: 'Poetry, drama, fiction, allegory, satire, letters, epic',
    },
    {
      id: 'language',
      label: 'Language',
      differentia: 'Grammar, philology, rhetoric, translation, lexicography',
    },
    { id: 'music', label: 'Music', differentia: 'Theory of sound, tuning, composition, instruments' },
    {
      id: 'art',
      label: 'Art',
      differentia: 'Painting, engraving, emblematics, perspective, iconography',
    },
    {
      id: 'technology',
      label: 'Technology',
      differentia: 'Machines, engineering, instruments, printing, hydraulics',
    },
    {
      id: 'education',
      label: 'Education',
      differentia: 'Pedagogy, liberal arts, memory arts, university texts',
    },
    // Reference
    {
      id: 'encyclopedia',
      label: 'Encyclopedia',
      differentia: 'Compendiums, universal knowledge, reference works',
    },
    {
      id: 'bibliography',
      label: 'Bibliography',
      differentia: 'Catalogs, book history, library science, manuscripts',
    },
    // Material & Manuscript
    {
      id: 'cryptography',
      label: 'Cryptography',
      differentia: 'Ciphers, steganography, secret writing, codes',
    },
    {
      id: 'printing',
      label: 'Printing',
      differentia: 'Typography, book production, incunabula, transmission',
    },
    {
      id: 'emblematics',
      label: 'Emblematics',
      differentia: 'Emblem books, impresa, symbolic imagery, hieroglyphics',
    },
  ],
};

// --- FORM (genre / type of text) ---

export const FORM: Facet = {
  id: 'form',
  label: 'Form',
  question: 'What kind of text is this?',
  cardinality: { min: 1, max: 2 },
  values: [
    { id: 'treatise', label: 'Treatise', differentia: 'Sustained argument on a single subject' },
    {
      id: 'encyclopedia',
      label: 'Encyclopedia / Compendium',
      differentia: 'Comprehensive survey of a field or of all knowledge',
    },
    {
      id: 'commentary',
      label: 'Commentary',
      differentia: 'Explanation of another text, line by line or section by section',
    },
    {
      id: 'manual',
      label: 'Manual / Recipe Book',
      differentia: 'Practical instructions -- how to do something',
    },
    {
      id: 'letters',
      label: 'Letters / Correspondence',
      differentia: 'Epistolary text -- written to or between named persons',
    },
    {
      id: 'poetry',
      label: 'Poetry / Literary',
      differentia: 'Verse, allegory, fiction, drama, or literary prose',
    },
    {
      id: 'dialogue',
      label: 'Dialogue',
      differentia: 'Conversation between named interlocutors',
    },
    {
      id: 'anthology',
      label: 'Anthology / Collection',
      differentia: 'Compiled shorter works -- fragments, excerpts, opera omnia',
    },
    {
      id: 'polemic',
      label: 'Polemic / Manifesto',
      differentia: 'Argument for or against a position, often combative',
    },
    {
      id: 'scripture',
      label: 'Sacred Text / Scripture',
      differentia: 'Revelation, canon, or text with liturgical/devotional authority',
    },
    {
      id: 'biography',
      label: 'Biography / Hagiography',
      differentia: "Life of a named person -- saints' lives, intellectual biographies, vitae",
    },
    {
      id: 'history',
      label: 'History / Chronicle',
      differentia:
        'Narrative account of events -- annals, chronicles, histories of wars or peoples',
    },
    {
      id: 'catalog',
      label: 'Catalog / Bibliography',
      differentia: 'Systematic list of books, manuscripts, specimens, or objects',
    },
  ],
};

// --- CULTURAL SPHERE (linguistic-geographic tradition) ---

export const SPHERE: Facet = {
  id: 'sphere',
  label: 'Cultural Sphere',
  question: 'What linguistic-cultural world does this come from?',
  cardinality: { min: 1, max: 2 },
  values: [
    {
      id: 'latin',
      label: 'Latin West',
      differentia: 'Written in or translated from Latin -- the European scholarly lingua franca',
    },
    {
      id: 'greek',
      label: 'Greek',
      differentia: 'Ancient, Byzantine, or modern Greek textual tradition',
    },
    {
      id: 'arabic',
      label: 'Arabic & Persian',
      differentia: 'Islamic civilization -- Arabic or Persian language',
    },
    {
      id: 'hebrew',
      label: 'Hebrew & Aramaic',
      differentia: 'Jewish textual tradition -- biblical, rabbinic, kabbalistic',
    },
    {
      id: 'sanskrit',
      label: 'Sanskrit & South Asian',
      differentia: 'Indian subcontinent -- Sanskrit, Pali, Tamil, etc.',
    },
    {
      id: 'chinese',
      label: 'Chinese & East Asian',
      differentia: 'Chinese literary tradition, including Japanese and Korean adaptations',
    },
    {
      id: 'syriac',
      label: 'Syriac & Armenian',
      differentia: 'Eastern Christian -- Syriac, Armenian, Coptic, Ethiopic',
    },
    {
      id: 'vernacular-european',
      label: 'Vernacular European',
      differentia: 'English, French, German, Italian, Dutch, Spanish -- not Latin',
    },
    {
      id: 'celtic',
      label: 'Celtic & Norse',
      differentia: 'Irish, Welsh, Icelandic, Old Norse traditions',
    },
    {
      id: 'ancient-near-east',
      label: 'Ancient Near East',
      differentia: 'Sumerian, Akkadian, Egyptian -- cuneiform and hieroglyphic traditions',
    },
    {
      id: 'african',
      label: 'African & Diaspora',
      differentia: 'Sub-Saharan African, Mesoamerican, and indigenous traditions',
    },
  ],
};

// --- ERA (period of original composition, not publication) ---

export const ERA: Facet = {
  id: 'era',
  label: 'Era',
  question: 'When was the original text composed?',
  cardinality: { min: 1, max: 2 },
  values: [
    {
      id: 'ancient',
      label: 'Ancient',
      differentia: 'Before 200 CE -- classical antiquity, pre-Christian',
    },
    {
      id: 'late-antique',
      label: 'Late Antique',
      differentia: '200-700 CE -- the transition from pagan to Christian/Islamic world',
    },
    {
      id: 'medieval',
      label: 'Medieval',
      differentia: '700-1400 -- scholasticism, Islamic golden age, high Middle Ages',
    },
    {
      id: 'renaissance',
      label: 'Renaissance',
      differentia: '1400-1600 -- revival of ancient learning, humanist movement',
    },
    {
      id: 'early-modern',
      label: 'Early Modern',
      differentia: '1600-1750 -- scientific revolution, Reformation, baroque',
    },
    {
      id: 'enlightenment',
      label: 'Enlightenment',
      differentia: '1750-1850 -- reason, revolution, systematic knowledge',
    },
    {
      id: 'modern',
      label: 'Modern',
      differentia: '1850+ -- occult revival, theosophy, academic study of esotericism',
    },
  ],
};

// --- EPISTEMIC MODE (Bacon's cognitive grounding) ---

export const MODE: Facet = {
  id: 'mode',
  label: 'Epistemic Mode',
  question: 'How does this text generate or transmit knowledge?',
  cardinality: { min: 1, max: 2 },
  values: [
    {
      id: 'empirical',
      label: 'Empirical / Observational',
      differentia: 'Based on direct observation, experiment, or case reports',
    },
    {
      id: 'speculative',
      label: 'Speculative / Theoretical',
      differentia:
        'Reasoning from principles -- metaphysics, cosmology, systematic philosophy',
    },
    {
      id: 'revelatory',
      label: 'Revelatory / Visionary',
      differentia:
        'Claims divine or supernatural origin -- prophecy, vision, channeling',
    },
    {
      id: 'practical',
      label: 'Practical / Instructional',
      differentia: 'How-to knowledge -- recipes, procedures, exercises, rituals',
    },
    {
      id: 'compilatory',
      label: 'Compilatory / Encyclopedic',
      differentia: 'Gathers and organizes existing knowledge from multiple sources',
    },
  ],
};

// --- ALL FACETS ---

export const FACETS: Facet[] = [TRADITION, DOMAIN, FORM, SPHERE, ERA, MODE];

/** Total tag values across all facets */
export const TOTAL_TAG_VALUES = FACETS.reduce((sum, f) => sum + f.values.length, 0);

// --- Book Tags Interface ---

export interface FacetedTags {
  tradition: string[]; // 0-3 values from TRADITION
  knowledge_domain: string[]; // 1-3 values from DOMAIN (DB field name)
  form: string[]; // 1-2 values from FORM
  sphere: string[]; // 1-2 values from SPHERE
  era: string[]; // 1-2 values from ERA
  mode: string[]; // 1-2 values from MODE
  tagged_at: Date;
  model: string;
  confidence: 'high' | 'medium' | 'low';
}

// --- Prompt Builder ---

/**
 * Builds the system prompt for the LLM tagger.
 * Includes the full vocabulary with differentia so the model
 * understands what each tag means and where boundaries lie.
 */
export function buildTaggingPrompt(): string {
  const facetBlocks = FACETS.map((facet) => {
    const valueList = facet.values
      .map((v) => `  - ${v.id}: ${v.label} -- ${v.differentia}`)
      .join('\n');
    return `### ${facet.label} (${facet.question})
Pick ${facet.cardinality.min}-${facet.cardinality.max} values.
${valueList}`;
  }).join('\n\n');

  return `You are a librarian classifying books in Source Library, a digital library of historical texts spanning alchemy, philosophy, science, mysticism, and world traditions from antiquity to 1900.

Assign faceted tags to each book based on its title, author, year, language, and summary. Use ONLY the tag IDs listed below -- never invent new ones.

${facetBlocks}

## Rules
1. Use the tag IDs (e.g., "hermetic"), not the labels (e.g., "Hermetic").
2. Respect the cardinality limits for each facet.
3. For "era", use the composition date of the ORIGINAL work, not the publication date of this edition.
4. If the book is a translation or commentary, tag both the tradition of the original AND the commentator's tradition if they differ.
5. Prefer precision over coverage -- only add a tag if you're confident.
6. For Chinese military, medical, or astronomical texts, use the appropriate domain tag + "chinese" sphere.
7. "classical" tradition is for secular Greco-Roman thought (Plato, Aristotle, Stoics). Use "neoplatonic" for Plotinus onward.

Respond with valid JSON only. No explanation.`;
}

/**
 * Builds the user prompt for a batch of books.
 */
export function buildBookBatchPrompt(
  books: Array<{
    id: string;
    title: string;
    display_title?: string;
    author: string;
    year?: string;
    language: string;
    summary?: string;
    taxonomy?: { cluster?: string; subcluster?: string };
  }>,
): string {
  const bookEntries = books
    .map((b) => {
      const parts = [
        `ID: ${b.id}`,
        `Title: ${b.title}`,
        b.display_title ? `English title: ${b.display_title}` : null,
        `Author: ${b.author}`,
        b.year ? `Year: ${b.year}` : null,
        `Language: ${b.language}`,
        b.taxonomy?.cluster ? `Cluster: ${b.taxonomy.cluster}` : null,
        b.taxonomy?.subcluster ? `Subcluster: ${b.taxonomy.subcluster}` : null,
        b.summary
          ? `Summary: ${typeof b.summary === 'string' ? b.summary.slice(0, 500) : ''}`
          : null,
      ].filter(Boolean);
      return parts.join('\n');
    })
    .join('\n---\n');

  return `Tag these books. Return a JSON array where each element has:
{ "id": "book_id", "tradition": [...], "knowledge_domain": [...], "form": [...], "sphere": [...], "era": [...], "mode": [...] }

${bookEntries}`;
}
