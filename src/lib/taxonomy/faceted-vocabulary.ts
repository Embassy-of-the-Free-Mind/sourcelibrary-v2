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
 * Design constraint: each facet has 5-15 values. 7 facets × ~12 values = ~84 tag values,
 * but 12^3 = 1,728 three-facet intersections — far more expressive than 226 subclusters.
 */

// ─── Facet Definitions ───────────────────────────────────────────────

export interface FacetValue {
  id: string;
  label: string;
  /** One-sentence description — what distinguishes this from its neighbors */
  differentia: string;
}

export interface Facet {
  id: string;
  label: string;
  /** What question does this facet answer? (Kircher's question-based access) */
  question: string;
  /** How many tags from this facet should a book typically get? */
  cardinality: { min: number; max: number };
  values: FacetValue[];
}

// ─── TRADITION (intellectual lineage / school of thought) ─────────

export const TRADITION: Facet = {
  id: 'tradition',
  label: 'Tradition',
  question: 'What intellectual lineage does this belong to?',
  cardinality: { min: 0, max: 3 },  // 0 allowed: secular science, bibliographies, indigenous texts
  values: [
    { id: 'hermetic', label: 'Hermetic', differentia: 'Attributed to Hermes Trismegistus or the Corpus Hermeticum tradition' },
    { id: 'alchemical', label: 'Alchemical', differentia: 'Concerned with transmutation of matter or the Great Work' },
    { id: 'kabbalistic', label: 'Kabbalistic', differentia: 'Jewish mystical tradition: Sefirot, Zohar, letter mysticism' },
    { id: 'neoplatonic', label: 'Neoplatonic', differentia: 'Emanation from the One, via Plotinus, Proclus, or their heirs' },
    { id: 'rosicrucian', label: 'Rosicrucian', differentia: 'The Rosy Cross brotherhood, manifestos, and their influence' },
    { id: 'masonic', label: 'Masonic', differentia: 'Freemasonry, lodge rituals, and fraternal initiation' },
    { id: 'theosophical', label: 'Theosophical', differentia: 'Blavatsky\'s Theosophy or Boehme\'s theosophy — divine wisdom traditions' },
    { id: 'gnostic', label: 'Gnostic', differentia: 'Salvation through knowledge, demiurge, pleroma, aeons' },
    { id: 'pythagorean', label: 'Pythagorean', differentia: 'Number as the principle of reality, harmony of spheres' },
    { id: 'paracelsian', label: 'Paracelsian', differentia: 'Paracelsus and iatrochemistry — tria prima, archeus, signatures' },
    { id: 'sufi', label: 'Sufi / Islamic Mystical', differentia: 'Islamic mysticism, tariqa, Rumi, Ibn Arabi, irfan' },
    { id: 'vedic', label: 'Vedic / Hindu', differentia: 'Vedas, Upanishads, darshanas, tantra, yoga traditions' },
    { id: 'buddhist', label: 'Buddhist', differentia: 'Dharma, sutra, tantra — Theravada, Mahayana, Vajrayana' },
    { id: 'daoist', label: 'Daoist', differentia: 'Dao, wu wei, inner alchemy (neidan), Zhuangzi, Laozi' },
    { id: 'classical', label: 'Classical Greek & Roman', differentia: 'Plato, Aristotle, Stoics, or the broader Greco-Roman intellectual world' },
    { id: 'christian-mystical', label: 'Christian Mystical', differentia: 'Eckhart, Boehme, Dionysius — direct experience of God in Christian framing' },
    { id: 'new-thought', label: 'New Thought / Spiritualist', differentia: 'Mental science, positive thinking, mesmerism, spiritualism, occult revival' },
  ],
};

// ─── DOMAIN (subject matter) ─────────────────────────────────────
// 48 domains organized into 10 groups for browse UI.
// Groups are presentational only — the DB stores flat domain IDs.

export interface DomainGroup {
  id: string;
  label: string;
  domains: string[]; // references DOMAIN.values[].id
}

export const DOMAIN_GROUPS: DomainGroup[] = [
  { id: 'philosophy-thought', label: 'Philosophy & Thought',
    domains: ['philosophy', 'theology', 'mysticism', 'cosmology', 'history'] },
  { id: 'science-nature', label: 'Science & Nature',
    domains: ['astronomy', 'mathematics', 'medicine', 'pharmacology', 'natural-history', 'natural-philosophy', 'chemistry', 'geography'] },
  { id: 'hidden-arts', label: 'The Hidden Arts',
    domains: ['alchemy', 'astrology', 'magic', 'divination', 'kabbalah'] },
  { id: 'esoteric-currents', label: 'Esoteric Currents',
    domains: ['hermeticism', 'neoplatonism', 'esotericism', 'freemasonry', 'rosicrucianism', 'theosophy'] },
  { id: 'sacred-devotional', label: 'Sacred & Devotional',
    domains: ['scripture', 'devotion', 'prophecy'] },
  { id: 'world-knowledge', label: 'World Knowledge Systems',
    domains: ['daoism', 'buddhism', 'sufism', 'gnosticism', 'demonology'] },
  { id: 'human-affairs', label: 'Human Affairs',
    domains: ['politics', 'military', 'law', 'economics', 'architecture'] },
  { id: 'language-art-culture', label: 'Language, Art & Culture',
    domains: ['literature', 'language', 'music', 'art', 'technology', 'education'] },
  { id: 'reference', label: 'Reference',
    domains: ['encyclopedia', 'bibliography'] },
  { id: 'material-manuscript', label: 'Material & Manuscript',
    domains: ['cryptography', 'printing', 'emblematics'] },
];

export const DOMAIN: Facet = {
  id: 'domain',
  label: 'Domain',
  question: 'What is the subject matter?',
  cardinality: { min: 1, max: 3 },
  values: [
    // Philosophy & Thought
    { id: 'philosophy', label: 'Philosophy', differentia: 'Ethics, logic, metaphysics, epistemology — secular reasoning about fundamental questions' },
    { id: 'theology', label: 'Theology', differentia: 'God, salvation, doctrine, church fathers, systematic theology' },
    { id: 'mysticism', label: 'Mysticism', differentia: 'Direct experience of the divine — contemplation, union, ecstasy across traditions' },
    { id: 'cosmology', label: 'Cosmology', differentia: 'Structure of the cosmos, creation, cosmic cycles, world-soul' },
    { id: 'history', label: 'History', differentia: 'Narrative of past events, chronicles, biography, historiography' },

    // Science & Nature
    { id: 'astronomy', label: 'Astronomy', differentia: 'Celestial bodies, planetary motion, observational and theoretical astronomy' },
    { id: 'mathematics', label: 'Mathematics', differentia: 'Number, geometry, arithmetic, algebra, sacred geometry' },
    { id: 'medicine', label: 'Medicine', differentia: 'Treatment of disease, anatomy, surgery, medical theory' },
    { id: 'pharmacology', label: 'Pharmacology', differentia: 'Drugs, herbs, materia medica, recipes for medicines' },
    { id: 'natural-history', label: 'Natural History', differentia: 'Plants, animals, minerals, specimens — descriptive study of nature' },
    { id: 'natural-philosophy', label: 'Natural Philosophy', differentia: 'Investigation of nature\'s causes — proto-science, physics, mechanics' },
    { id: 'chemistry', label: 'Chemistry', differentia: 'Chemical processes, iatrochemistry, laboratory arts distinct from alchemy' },
    { id: 'geography', label: 'Geography', differentia: 'Description of lands, peoples, maps, cosmography, travel accounts' },

    // The Hidden Arts
    { id: 'alchemy', label: 'Alchemy', differentia: 'Transmutation of matter, the Great Work, philosopher\'s stone, spagyrics' },
    { id: 'astrology', label: 'Astrology', differentia: 'Celestial influence on human affairs — nativities, elections, mundane astrology' },
    { id: 'magic', label: 'Magic', differentia: 'Practical magic — grimoires, talismans, conjuration, theurgy, natural magic' },
    { id: 'divination', label: 'Divination', differentia: 'Foretelling the future — geomancy, chiromancy, scrying, lots, omens' },
    { id: 'kabbalah', label: 'Kabbalah', differentia: 'Jewish mystical tradition — Sefirot, letter mysticism, Zohar, Christian Cabala' },

    // Esoteric Currents
    { id: 'hermeticism', label: 'Hermeticism', differentia: 'Corpus Hermeticum, Asclepius, prisca theologia, Hermetic philosophy' },
    { id: 'neoplatonism', label: 'Neoplatonism', differentia: 'Emanation from the One, Plotinus, Proclus, Ficino, Florentine Platonism' },
    { id: 'esotericism', label: 'Esotericism', differentia: 'Western esotericism broadly — occult philosophy, secret traditions, initiatory knowledge' },
    { id: 'freemasonry', label: 'Freemasonry', differentia: 'Masonic lodges, rituals, fraternal initiation, Templar traditions' },
    { id: 'rosicrucianism', label: 'Rosicrucianism', differentia: 'The Rosy Cross, manifestos, Andreae, and their influence' },
    { id: 'theosophy', label: 'Theosophy', differentia: 'Divine wisdom — Boehme\'s theosophy and Blavatsky\'s Theosophical Society' },

    // Sacred & Devotional
    { id: 'scripture', label: 'Scripture', differentia: 'Sacred texts, biblical studies, Qur\'an, Vedas, canonical and apocryphal works' },
    { id: 'devotion', label: 'Devotion', differentia: 'Prayer, hymns, liturgy, hagiography, devotional practice' },
    { id: 'prophecy', label: 'Prophecy', differentia: 'Prophetic and apocalyptic literature, millenarianism, eschatology' },

    // World Knowledge Systems
    { id: 'daoism', label: 'Daoism', differentia: 'Dao, wu wei, inner alchemy (neidan), Zhuangzi, Laozi, Daoist canon' },
    { id: 'buddhism', label: 'Buddhism', differentia: 'Dharma, sutra, tantra — Theravada, Mahayana, Vajrayana, Chan/Zen' },
    { id: 'sufism', label: 'Sufism', differentia: 'Islamic mysticism — tariqa, Rumi, Ibn Arabi, irfan' },
    { id: 'gnosticism', label: 'Gnosticism', differentia: 'Salvation through knowledge, demiurge, pleroma, Nag Hammadi, Mandaeism' },
    { id: 'demonology', label: 'Demonology', differentia: 'Demons, witchcraft, possession, exorcism, spirit hierarchies' },

    // Human Affairs
    { id: 'politics', label: 'Politics', differentia: 'Governance, diplomacy, statecraft, political philosophy' },
    { id: 'military', label: 'Military Science', differentia: 'Strategy, fortification, weapons, naval warfare' },
    { id: 'law', label: 'Law', differentia: 'Legal codes, jurisprudence, canon law, civil law' },
    { id: 'economics', label: 'Economics', differentia: 'Trade, agriculture, administration, household management' },
    { id: 'architecture', label: 'Architecture', differentia: 'Building, proportion, sacred architecture, engineering of structures' },

    // Language, Art & Culture
    { id: 'literature', label: 'Literature', differentia: 'Poetry, drama, fiction, allegory, letters, literary prose' },
    { id: 'language', label: 'Language', differentia: 'Grammar, rhetoric, philology, lexicography, translation' },
    { id: 'music', label: 'Music', differentia: 'Theory of sound, tuning, cosmic harmony, musica mundana, composition' },
    { id: 'art', label: 'Art', differentia: 'Visual arts, painting, sculpture, perspective, proportion, design' },
    { id: 'technology', label: 'Technology', differentia: 'Machines, engineering, hydraulics, instruments, practical invention' },
    { id: 'education', label: 'Education', differentia: 'Pedagogy, memory arts, university curricula, teaching methods' },

    // Reference
    { id: 'encyclopedia', label: 'Encyclopedia', differentia: 'Comprehensive survey of a field or all knowledge' },
    { id: 'bibliography', label: 'Bibliography', differentia: 'Catalogs of books, library science, book history, transmission of texts' },

    // Material & Manuscript
    { id: 'cryptography', label: 'Cryptography', differentia: 'Ciphers, codes, steganography, secret writing' },
    { id: 'printing', label: 'Printing', differentia: 'Typography, book production, press history, type design' },
    { id: 'emblematics', label: 'Emblematics', differentia: 'Emblem books, imprese, symbolic imagery with motto and epigram' },
  ],
};

// ─── FORM (genre / type of text) ────────────────────────────────

export const FORM: Facet = {
  id: 'form',
  label: 'Form',
  question: 'What kind of text is this?',
  cardinality: { min: 1, max: 2 },
  values: [
    { id: 'treatise', label: 'Treatise', differentia: 'Sustained argument on a single subject' },
    { id: 'encyclopedia', label: 'Encyclopedia / Compendium', differentia: 'Comprehensive survey of a field or of all knowledge' },
    { id: 'commentary', label: 'Commentary', differentia: 'Explanation of another text, line by line or section by section' },
    { id: 'manual', label: 'Manual / Recipe Book', differentia: 'Practical instructions — how to do something' },
    { id: 'letters', label: 'Letters / Correspondence', differentia: 'Epistolary text — written to or between named persons' },
    { id: 'poetry', label: 'Poetry / Literary', differentia: 'Verse, allegory, fiction, drama, or literary prose' },
    { id: 'dialogue', label: 'Dialogue', differentia: 'Conversation between named interlocutors' },
    { id: 'anthology', label: 'Anthology / Collection', differentia: 'Compiled shorter works — fragments, excerpts, opera omnia' },
    { id: 'polemic', label: 'Polemic / Manifesto', differentia: 'Argument for or against a position, often combative' },
    { id: 'scripture', label: 'Sacred Text / Scripture', differentia: 'Revelation, canon, or text with liturgical/devotional authority' },
    { id: 'biography', label: 'Biography / Hagiography', differentia: 'Life of a named person — saints\' lives, intellectual biographies, vitae' },
    { id: 'history', label: 'History / Chronicle', differentia: 'Narrative account of events — annals, chronicles, histories of wars or peoples' },
    { id: 'catalog', label: 'Catalog / Bibliography', differentia: 'Systematic list of books, manuscripts, specimens, or objects' },
  ],
};

// ─── CULTURAL SPHERE (linguistic-geographic tradition) ────────────

export const SPHERE: Facet = {
  id: 'sphere',
  label: 'Cultural Sphere',
  question: 'What linguistic-cultural world does this come from?',
  cardinality: { min: 1, max: 2 },
  values: [
    { id: 'latin', label: 'Latin West', differentia: 'Written in or translated from Latin — the European scholarly lingua franca' },
    { id: 'greek', label: 'Greek', differentia: 'Ancient, Byzantine, or modern Greek textual tradition' },
    { id: 'arabic', label: 'Arabic & Persian', differentia: 'Islamic civilization — Arabic or Persian language' },
    { id: 'hebrew', label: 'Hebrew & Aramaic', differentia: 'Jewish textual tradition — biblical, rabbinic, kabbalistic' },
    { id: 'sanskrit', label: 'Sanskrit & South Asian', differentia: 'Indian subcontinent — Sanskrit, Pali, Tamil, etc.' },
    { id: 'chinese', label: 'Chinese & East Asian', differentia: 'Chinese literary tradition, including Japanese and Korean adaptations' },
    { id: 'syriac', label: 'Syriac & Armenian', differentia: 'Eastern Christian — Syriac, Armenian, Coptic, Ethiopic' },
    { id: 'vernacular-european', label: 'Vernacular European', differentia: 'English, French, German, Italian, Dutch, Spanish — not Latin' },
    { id: 'celtic', label: 'Celtic & Norse', differentia: 'Irish, Welsh, Icelandic, Old Norse traditions' },
    { id: 'ancient-near-east', label: 'Ancient Near East', differentia: 'Sumerian, Akkadian, Egyptian — cuneiform and hieroglyphic traditions' },
    { id: 'african', label: 'African & Diaspora', differentia: 'Sub-Saharan African, Mesoamerican, and indigenous traditions' },
  ],
};

// ─── ERA (period of original composition, not publication) ───────

export const ERA: Facet = {
  id: 'era',
  label: 'Era',
  question: 'When was the original text composed?',
  cardinality: { min: 1, max: 2 },
  values: [
    { id: 'ancient', label: 'Ancient', differentia: 'Before 200 CE — classical antiquity, pre-Christian' },
    { id: 'late-antique', label: 'Late Antique', differentia: '200–700 CE — the transition from pagan to Christian/Islamic world' },
    { id: 'medieval', label: 'Medieval', differentia: '700–1400 — scholasticism, Islamic golden age, high Middle Ages' },
    { id: 'renaissance', label: 'Renaissance', differentia: '1400–1600 — revival of ancient learning, humanist movement' },
    { id: 'early-modern', label: 'Early Modern', differentia: '1600–1750 — scientific revolution, Reformation, baroque' },
    { id: 'enlightenment', label: 'Enlightenment', differentia: '1750–1850 — reason, revolution, systematic knowledge' },
    { id: 'modern', label: 'Modern', differentia: '1850+ — occult revival, theosophy, academic study of esotericism' },
  ],
};

// ─── EPISTEMIC MODE (Bacon's cognitive grounding) ────────────────

export const MODE: Facet = {
  id: 'mode',
  label: 'Epistemic Mode',
  question: 'How does this text generate or transmit knowledge?',
  cardinality: { min: 1, max: 2 },
  values: [
    { id: 'empirical', label: 'Empirical / Observational', differentia: 'Based on direct observation, experiment, or case reports' },
    { id: 'speculative', label: 'Speculative / Theoretical', differentia: 'Reasoning from principles — metaphysics, cosmology, systematic philosophy' },
    { id: 'revelatory', label: 'Revelatory / Visionary', differentia: 'Claims divine or supernatural origin — prophecy, vision, channeling' },
    { id: 'practical', label: 'Practical / Instructional', differentia: 'How-to knowledge — recipes, procedures, exercises, rituals' },
    { id: 'compilatory', label: 'Compilatory / Encyclopedic', differentia: 'Gathers and organizes existing knowledge from multiple sources' },
  ],
};

// ─── ALL FACETS ──────────────────────────────────────────────────

export const FACETS: Facet[] = [TRADITION, DOMAIN, FORM, SPHERE, ERA, MODE];

/** Total tag values across all facets */
export const TOTAL_TAG_VALUES = FACETS.reduce((sum, f) => sum + f.values.length, 0);

// ─── Book Tags Interface ─────────────────────────────────────────

export interface FacetedTags {
  tradition: string[];    // 1-3 values from TRADITION
  domain: string[];       // 1-3 values from DOMAIN
  form: string[];         // 1-2 values from FORM
  sphere: string[];       // 1-2 values from SPHERE
  era: string[];          // 1-2 values from ERA
  mode: string[];         // 1-2 values from MODE
  tagged_at: Date;
  model: string;
  confidence: 'high' | 'medium' | 'low';
}

// ─── Prompt Builder ──────────────────────────────────────────────

/**
 * Builds the system prompt for the LLM tagger.
 * Includes the full vocabulary with differentia so the model
 * understands what each tag means and where boundaries lie.
 */
export function buildTaggingPrompt(): string {
  const facetBlocks = FACETS.map(facet => {
    // For domain facet, organize values by group for clarity
    if (facet.id === 'domain') {
      const groupBlocks = DOMAIN_GROUPS.map(group => {
        const values = group.domains
          .map(id => facet.values.find(v => v.id === id))
          .filter((v): v is FacetValue => !!v)
          .map(v => `  - ${v.id}: ${v.label} — ${v.differentia}`)
          .join('\n');
        return `**${group.label}:**\n${values}`;
      }).join('\n');
      return `### ${facet.label} (${facet.question})
Pick ${facet.cardinality.min}–${facet.cardinality.max} values.
${groupBlocks}`;
    }

    const valueList = facet.values
      .map(v => `  - ${v.id}: ${v.label} — ${v.differentia}`)
      .join('\n');
    return `### ${facet.label} (${facet.question})
Pick ${facet.cardinality.min}–${facet.cardinality.max} values.
${valueList}`;
  }).join('\n\n');

  return `You are a librarian classifying books in Source Library, a digital library of historical texts spanning alchemy, philosophy, science, mysticism, and world traditions from antiquity to 1900.

Assign faceted tags to each book based on its title, author, year, language, and summary. Use ONLY the tag IDs listed below — never invent new ones.

${facetBlocks}

## Rules
1. Use the tag IDs (e.g., "hermetic"), not the labels (e.g., "Hermetic").
2. Respect the cardinality limits for each facet.
3. For "era", use the composition date of the ORIGINAL work, not the publication date of this edition.
4. If the book is a translation or commentary, tag both the tradition of the original AND the commentator's tradition if they differ.
5. Prefer precision over coverage — only add a tag if you're confident.
6. For Chinese military, medical, or astronomical texts, use the appropriate domain tag + "chinese" sphere.
7. "classical" tradition is for secular Greco-Roman thought (Plato, Aristotle, Stoics). Use "neoplatonic" for Plotinus onward.

Respond with valid JSON only. No explanation.`;
}

/**
 * Builds the user prompt for a batch of books.
 */
export function buildBookBatchPrompt(books: Array<{
  id: string;
  title: string;
  display_title?: string;
  author: string;
  year?: string;
  language: string;
  summary?: string;
  taxonomy?: { cluster?: string; subcluster?: string };
}>): string {
  const bookEntries = books.map(b => {
    const parts = [
      `ID: ${b.id}`,
      `Title: ${b.title}`,
      b.display_title ? `English title: ${b.display_title}` : null,
      `Author: ${b.author}`,
      b.year ? `Year: ${b.year}` : null,
      `Language: ${b.language}`,
      b.taxonomy?.cluster ? `Cluster: ${b.taxonomy.cluster}` : null,
      b.taxonomy?.subcluster ? `Subcluster: ${b.taxonomy.subcluster}` : null,
      b.summary ? `Summary: ${typeof b.summary === 'string' ? b.summary.slice(0, 500) : ''}` : null,
    ].filter(Boolean);
    return parts.join('\n');
  }).join('\n---\n');

  return `Tag these books. Return a JSON array where each element has:
{ "id": "book_id", "tradition": [...], "domain": [...], "form": [...], "sphere": [...], "era": [...], "mode": [...] }

${bookEntries}`;
}
