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

export const DOMAIN: Facet = {
  id: 'domain',
  label: 'Domain',
  question: 'What is the subject matter?',
  cardinality: { min: 1, max: 3 },
  values: [
    { id: 'medicine', label: 'Medicine & Healing', differentia: 'Treatment of disease, anatomy, pharmacology, herbalism' },
    { id: 'astronomy', label: 'Astronomy & Cosmology', differentia: 'Celestial bodies, planetary motion, structure of the cosmos' },
    { id: 'astrology', label: 'Astrology & Divination', differentia: 'Celestial influence on human affairs, or foretelling the future' },
    { id: 'natural-philosophy', label: 'Natural Philosophy', differentia: 'Investigation of nature\'s causes — proto-science, physics, chemistry' },
    { id: 'mathematics', label: 'Mathematics & Geometry', differentia: 'Number, measurement, spatial reasoning, sacred geometry' },
    { id: 'music', label: 'Music & Harmony', differentia: 'Theory of sound, tuning, cosmic harmony, musica mundana' },
    { id: 'theology', label: 'Theology & Scripture', differentia: 'God, salvation, scripture, doctrine, church' },
    { id: 'ethics', label: 'Ethics & Politics', differentia: 'How to live, govern, and organize society' },
    { id: 'magic', label: 'Magic & Ritual', differentia: 'Practical magic — grimoires, talismans, conjuration, theurgy' },
    { id: 'language', label: 'Language & Philology', differentia: 'Grammar, etymology, lexicography, translation, rhetoric' },
    { id: 'history', label: 'History & Biography', differentia: 'Narrative of past events, lives of persons, chronicles' },
    { id: 'natural-history', label: 'Natural History & Botany', differentia: 'Plants, animals, minerals, materia medica, natural specimens' },
    { id: 'art', label: 'Art & Architecture', differentia: 'Visual arts, proportion, perspective, building, design' },
    { id: 'military', label: 'Military Science', differentia: 'Strategy, fortification, weapons, naval warfare' },
    { id: 'bibliography', label: 'Bibliography & Book History', differentia: 'Catalogs of books, library science, printing, transmission of texts' },
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
