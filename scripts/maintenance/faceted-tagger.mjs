#!/usr/bin/env node
/**
 * Faceted Tagger — assigns multi-facet tags to Source Library books using Gemini.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/maintenance/faceted-tagger.mjs
 *
 * Options:
 *   --dry-run       Preview tags without saving to DB
 *   --limit N       Process only N books (default: all untagged)
 *   --retag         Re-tag books that already have faceted_tags
 *   --batch N       Books per Gemini request (default: 10)
 *   --book ID       Tag a single book by ID
 *
 * Stores results in book.faceted_tags: { tradition, domain, form, sphere, era, mode, tagged_at, model, confidence }
 */

import { MongoClient } from 'mongodb';

// ─── Configuration ──────────────────────────────────────────────

const GEMINI_MODEL = 'gemini-3-flash-preview';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MONGODB_URI = process.env.MONGODB_URI;
const BATCH_SIZE = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--batch') || '20');
const LIMIT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--limit') || '0');
const DRY_RUN = process.argv.includes('--dry-run');
const RETAG = process.argv.includes('--retag');
const SINGLE_BOOK = process.argv.find((_, i, a) => a[i - 1] === '--book');

if (!GEMINI_API_KEY) { console.error('Missing GEMINI_API_KEY'); process.exit(1); }
if (!MONGODB_URI) { console.error('Missing MONGODB_URI'); process.exit(1); }

// ─── Vocabulary (duplicated from TS source for standalone use) ────

const VALID_TAGS = {
  tradition: ['hermetic','alchemical','kabbalistic','neoplatonic','rosicrucian','masonic',
    'theosophical','gnostic','pythagorean','paracelsian','sufi','vedic','buddhist',
    'daoist','classical','christian-mystical','new-thought'],
  domain: ['medicine','astronomy','astrology','natural-philosophy','mathematics','music',
    'theology','ethics','magic','language','history','natural-history','art','military','bibliography'],
  form: ['treatise','encyclopedia','commentary','manual','letters','poetry','dialogue',
    'anthology','polemic','scripture','biography','history','catalog'],
  sphere: ['latin','greek','arabic','hebrew','sanskrit','chinese','syriac',
    'vernacular-european','celtic','ancient-near-east','african'],
  era: ['ancient','late-antique','medieval','renaissance','early-modern','enlightenment','modern'],
  mode: ['empirical','speculative','revelatory','practical','compilatory'],
};

const CARDINALITY = {
  tradition: { min: 0, max: 3 },  // 0 allowed: bibliographies, secular science, indigenous texts
  domain: { min: 1, max: 3 },
  form: { min: 1, max: 2 },
  sphere: { min: 1, max: 2 },
  era: { min: 1, max: 2 },
  mode: { min: 1, max: 2 },
};

// ─── System Prompt ───────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a librarian classifying books in Source Library, a digital library of historical texts spanning alchemy, philosophy, science, mysticism, and world traditions from antiquity to 1900.

Assign faceted tags to each book based on its title, author, year, language, and summary. Use ONLY the tag IDs listed below — never invent new ones.

### Tradition (What intellectual lineage does this belong to?)
Pick 1–3 values.
  - hermetic: Hermetic — Attributed to Hermes Trismegistus or the Corpus Hermeticum tradition
  - alchemical: Alchemical — Concerned with transmutation of matter or the Great Work
  - kabbalistic: Kabbalistic — Jewish mystical tradition: Sefirot, Zohar, letter mysticism
  - neoplatonic: Neoplatonic — Emanation from the One, via Plotinus, Proclus, or their heirs
  - rosicrucian: Rosicrucian — The Rosy Cross brotherhood, manifestos, and their influence
  - masonic: Masonic — Freemasonry, lodge rituals, and fraternal initiation
  - theosophical: Theosophical — Blavatsky's Theosophy or Boehme's theosophy — divine wisdom traditions
  - gnostic: Gnostic — Salvation through knowledge, demiurge, pleroma, aeons
  - pythagorean: Pythagorean — Number as the principle of reality, harmony of spheres
  - paracelsian: Paracelsian — Paracelsus and iatrochemistry — tria prima, archeus, signatures
  - sufi: Sufi / Islamic Mystical — Islamic mysticism, tariqa, Rumi, Ibn Arabi, irfan
  - vedic: Vedic / Hindu — Vedas, Upanishads, darshanas, tantra, yoga traditions
  - buddhist: Buddhist — Dharma, sutra, tantra — Theravada, Mahayana, Vajrayana
  - daoist: Daoist — Dao, wu wei, inner alchemy (neidan), Zhuangzi, Laozi
  - classical: Classical Greek & Roman — Plato, Aristotle, Stoics, or the broader Greco-Roman intellectual world
  - christian-mystical: Christian Mystical — Eckhart, Boehme, Dionysius — direct experience of God in Christian framing
  - new-thought: New Thought / Spiritualist — Mental science, positive thinking, mesmerism, spiritualism, occult revival

### Domain (What is the subject matter?)
Pick 1–3 values.
  - medicine: Medicine & Healing — Treatment of disease, anatomy, pharmacology, herbalism
  - astronomy: Astronomy & Cosmology — Celestial bodies, planetary motion, structure of the cosmos
  - astrology: Astrology & Divination — Celestial influence on human affairs, or foretelling the future
  - natural-philosophy: Natural Philosophy — Investigation of nature's causes — proto-science, physics, chemistry
  - mathematics: Mathematics & Geometry — Number, measurement, spatial reasoning, sacred geometry
  - music: Music & Harmony — Theory of sound, tuning, cosmic harmony, musica mundana
  - theology: Theology & Scripture — God, salvation, scripture, doctrine, church
  - ethics: Ethics & Politics — How to live, govern, and organize society
  - magic: Magic & Ritual — Practical magic — grimoires, talismans, conjuration, theurgy
  - language: Language & Philology — Grammar, etymology, lexicography, translation, rhetoric
  - history: History & Biography — Narrative of past events, lives of persons, chronicles
  - natural-history: Natural History & Botany — Plants, animals, minerals, materia medica, natural specimens
  - art: Art & Architecture — Visual arts, proportion, perspective, building, design
  - military: Military Science — Strategy, fortification, weapons, naval warfare
  - bibliography: Bibliography & Book History — Catalogs of books, library science, printing, transmission of texts

### Form (What kind of text is this?)
Pick 1–2 values.
  - treatise: Treatise — Sustained argument on a single subject
  - encyclopedia: Encyclopedia / Compendium — Comprehensive survey of a field or of all knowledge
  - commentary: Commentary — Explanation of another text, line by line or section by section
  - manual: Manual / Recipe Book — Practical instructions — how to do something
  - letters: Letters / Correspondence — Epistolary text — written to or between named persons
  - poetry: Poetry / Literary — Verse, allegory, fiction, drama, or literary prose
  - dialogue: Dialogue — Conversation between named interlocutors
  - anthology: Anthology / Collection — Compiled shorter works — fragments, excerpts, opera omnia
  - polemic: Polemic / Manifesto — Argument for or against a position, often combative
  - scripture: Sacred Text / Scripture — Revelation, canon, or text with liturgical/devotional authority
  - biography: Biography / Hagiography — Life of a named person — saints' lives, intellectual biographies, vitae
  - history: History / Chronicle — Narrative account of events — annals, chronicles, histories of wars or peoples
  - catalog: Catalog / Bibliography — Systematic list of books, manuscripts, specimens, or objects

### Cultural Sphere (What linguistic-cultural world does this come from?)
Pick 1–2 values.
  - latin: Latin West — Written in or translated from Latin — the European scholarly lingua franca
  - greek: Greek — Ancient, Byzantine, or modern Greek textual tradition
  - arabic: Arabic & Persian — Islamic civilization — Arabic or Persian language
  - hebrew: Hebrew & Aramaic — Jewish textual tradition — biblical, rabbinic, kabbalistic
  - sanskrit: Sanskrit & South Asian — Indian subcontinent — Sanskrit, Pali, Tamil, etc.
  - chinese: Chinese & East Asian — Chinese literary tradition, including Japanese and Korean adaptations
  - syriac: Syriac & Armenian — Eastern Christian — Syriac, Armenian, Coptic, Ethiopic
  - vernacular-european: Vernacular European — English, French, German, Italian, Dutch, Spanish — not Latin
  - celtic: Celtic & Norse — Irish, Welsh, Icelandic, Old Norse traditions
  - ancient-near-east: Ancient Near East — Sumerian, Akkadian, Egyptian — cuneiform and hieroglyphic traditions
  - african: African & Diaspora — Sub-Saharan African, Mesoamerican, and indigenous traditions

### Era (When was the original text composed?)
Pick 1–2 values.
  - ancient: Ancient — Before 200 CE — classical antiquity, pre-Christian
  - late-antique: Late Antique — 200–700 CE — the transition from pagan to Christian/Islamic world
  - medieval: Medieval — 700–1400 — scholasticism, Islamic golden age, high Middle Ages
  - renaissance: Renaissance — 1400–1600 — revival of ancient learning, humanist movement
  - early-modern: Early Modern — 1600–1750 — scientific revolution, Reformation, baroque
  - enlightenment: Enlightenment — 1750–1850 — reason, revolution, systematic knowledge
  - modern: Modern — 1850+ — occult revival, theosophy, academic study of esotericism

### Epistemic Mode (How does this text generate or transmit knowledge?)
Pick 1–2 values.
  - empirical: Empirical / Observational — Based on direct observation, experiment, or case reports
  - speculative: Speculative / Theoretical — Reasoning from principles — metaphysics, cosmology, systematic philosophy
  - revelatory: Revelatory / Visionary — Claims divine or supernatural origin — prophecy, vision, channeling
  - practical: Practical / Instructional — How-to knowledge — recipes, procedures, exercises, rituals
  - compilatory: Compilatory / Encyclopedic — Gathers and organizes existing knowledge from multiple sources

## Rules
1. Use the tag IDs (e.g., "hermetic"), not the labels.
2. Respect the cardinality limits for each facet.
3. For "era", use the composition date of the ORIGINAL work, not the publication date of this edition.
4. If the book is a translation or commentary, tag both the tradition of the original AND the commentator's tradition if they differ.
5. Prefer precision over coverage — only add a tag if you're confident.
6. For Chinese military, medical, or astronomical texts, use the appropriate domain tag + "chinese" sphere.
7. "classical" tradition is for secular Greco-Roman thought (Plato, Aristotle, Stoics). Use "neoplatonic" for Plotinus onward.

Respond with valid JSON only. No markdown fences. No explanation.`;

// ─── Gemini API ──────────────────────────────────────────────────

async function callGemini(books) {
  const bookEntries = books.map(b => {
    const summary = typeof b.summary === 'object' ? b.summary?.data : b.summary;
    const parts = [
      `ID: ${b._id}`,
      `Title: ${b.title}`,
      b.display_title ? `English title: ${b.display_title}` : null,
      `Author: ${b.author}`,
      b.published ? `Year: ${b.published}` : null,
      `Language: ${b.language}`,
      b.taxonomy?.cluster ? `Cluster: ${b.taxonomy.cluster}` : null,
      b.taxonomy?.subcluster ? `Subcluster: ${b.taxonomy.subcluster}` : null,
      summary ? `Summary: ${summary.slice(0, 500)}` : null,
    ].filter(Boolean);
    return parts.join('\n');
  }).join('\n---\n');

  const userPrompt = `Tag these ${books.length} books. Return a JSON array where each element has:
{ "id": "book_id", "tradition": [...], "domain": [...], "form": [...], "sphere": [...], "era": [...], "mode": [...] }

${bookEntries}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ parts: [{ text: userPrompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
        maxOutputTokens: 65536,
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty Gemini response');

  // Clean up response — strip markdown fences if present
  const cleaned = text.replace(/^```json?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('   ⚠ JSON parse failed. Raw response (first 500 chars):');
    console.error('   ' + cleaned.slice(0, 500));
    throw e;
  }
}

// ─── Validation ──────────────────────────────────────────────────

function validateTags(tags) {
  const errors = [];
  for (const [facet, validValues] of Object.entries(VALID_TAGS)) {
    const values = tags[facet];
    if (!Array.isArray(values)) {
      errors.push(`${facet}: not an array`);
      continue;
    }
    const { min, max } = CARDINALITY[facet];
    if (values.length < min) errors.push(`${facet}: too few (${values.length} < ${min})`);
    if (values.length > max) errors.push(`${facet}: too many (${values.length} > ${max})`);
    for (const v of values) {
      if (!validValues.includes(v)) errors.push(`${facet}: invalid value "${v}"`);
    }
  }
  return errors;
}

function sanitizeTags(tags) {
  const sanitized = {};
  for (const [facet, validValues] of Object.entries(VALID_TAGS)) {
    let values = tags[facet];
    if (!Array.isArray(values)) values = [];
    // Remove invalid values
    values = values.filter(v => validValues.includes(v));
    // Enforce max cardinality
    const { max } = CARDINALITY[facet];
    if (values.length > max) values = values.slice(0, max);
    sanitized[facet] = values;
  }
  return sanitized;
}

// ─── Main ────────────────────────────────────────────────────────

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  // Build query
  const query = { hidden: { $ne: true } };
  if (SINGLE_BOOK) {
    query._id = SINGLE_BOOK;
  } else if (!RETAG) {
    query['faceted_tags'] = { $exists: false };
  }

  // Fetch all IDs upfront to avoid cursor timeout on long runs
  const projection = {
    _id: 1, title: 1, display_title: 1, author: 1, published: 1,
    language: 1, summary: 1, taxonomy: 1, categories: 1,
  };

  let allBooks = await books.find(query, { projection }).toArray();
  if (LIMIT) allBooks = allBooks.slice(0, LIMIT);
  const totalCount = allBooks.length;

  console.log(`\n📚 Faceted Tagger`);
  console.log(`   Model: ${GEMINI_MODEL}`);
  console.log(`   Books to tag: ${totalCount}${DRY_RUN ? ' (DRY RUN)' : ''}`);
  console.log(`   Batch size: ${BATCH_SIZE}\n`);

  let processed = 0;
  let saved = 0;
  let errors = 0;

  for (let i = 0; i < allBooks.length; i += BATCH_SIZE) {
    const batch = allBooks.slice(i, i + BATCH_SIZE);
    const result = await processBatch(batch, books);
    processed += batch.length;
    saved += result.saved;
    errors += result.errors;
    console.log(`   Progress: ${processed}/${totalCount} (${saved} saved, ${errors} errors)`);
    // Rate limit
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\n✅ Done. ${processed} processed, ${saved} saved, ${errors} errors.\n`);
  await client.close();
}

const FACET_ORDER = ['tradition', 'domain', 'form', 'sphere', 'era', 'mode'];

async function processBatch(batch, collection) {
  let saved = 0;
  let errors = 0;

  try {
    const rawResults = await callGemini(batch);

    // Unpack compact format: [[id, [tradition], [domain], [form], [sphere], [era], [mode]], ...]
    const results = rawResults.map(row => {
      if (Array.isArray(row) && typeof row[0] === 'string') {
        const obj = { id: row[0] };
        FACET_ORDER.forEach((facet, i) => { obj[facet] = row[i + 1] || []; });
        return obj;
      }
      return row; // already object format (backwards compat)
    });

    for (const result of results) {
      const bookId = result.id;
      const book = batch.find(b => String(b._id) === String(bookId));
      if (!book) {
        console.warn(`   ⚠ No match for ID ${bookId}`);
        errors++;
        continue;
      }

      const sanitized = sanitizeTags(result);
      const validationErrors = validateTags(sanitized);

      if (validationErrors.length > 0) {
        console.warn(`   ⚠ ${book.title}: ${validationErrors.join(', ')}`);
        // Still save if we have some valid tags
        const hasSomeTags = Object.values(sanitized).some(arr => arr.length > 0);
        if (!hasSomeTags) {
          errors++;
          continue;
        }
      }

      const facetedTags = {
        ...sanitized,
        tagged_at: new Date(),
        model: GEMINI_MODEL,
        confidence: validationErrors.length === 0 ? 'high' : 'medium',
      };

      if (DRY_RUN) {
        console.log(`   ${book.display_title || book.title}`);
        console.log(`     tradition: [${sanitized.tradition}]  domain: [${sanitized.domain}]`);
        console.log(`     form: [${sanitized.form}]  sphere: [${sanitized.sphere}]`);
        console.log(`     era: [${sanitized.era}]  mode: [${sanitized.mode}]`);
        saved++;
      } else {
        await collection.updateOne(
          { _id: book._id },
          { $set: { faceted_tags: facetedTags } }
        );
        saved++;
      }
    }
  } catch (err) {
    console.error(`   ❌ Batch error: ${err.message}`);
    errors += batch.length;
  }

  return { saved, errors };
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
