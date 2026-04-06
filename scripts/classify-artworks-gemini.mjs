#!/usr/bin/env node
/**
 * Gemini-based artwork classification into thematic collections.
 *
 * Sends artwork metadata (title, author, date, description, categories) to
 * gemini-3-flash-preview in batches of 50. Gemini returns collection slugs
 * for each artwork. Then updates the DB and refreshes collection counts.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/classify-artworks-gemini.mjs
 *
 * Options:
 *   --dry-run     Print classifications without writing to DB
 *   --limit N     Only classify first N artworks (for testing)
 *   --batch-size N  Artworks per Gemini call (default 40)
 *
 * Issue: #374
 */

import { MongoClient } from 'mongodb';

const BATCH_SIZE = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--batch-size') || '40');
const LIMIT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--limit') || '0');
const DRY_RUN = process.argv.includes('--dry-run');

// ── Collection definitions (slug → description for Gemini) ──────────────

const COLLECTIONS = [
  {
    slug: 'ficinos-florence',
    name: "Ficino's Florence",
    criteria: 'Works by or depicting the Florentine Neoplatonic circle (1460-1500): Botticelli, Fra Angelico, Ghirlandaio, Filippino Lippi, Piero di Cosimo, Verrocchio, Gozzoli. Scenes of Platonic philosophy, Medici patronage, mythological subjects from this circle.',
  },
  {
    slug: 'before-ficino',
    name: 'Before Ficino',
    criteria: 'Early Florentine Renaissance (1400-1460): Masaccio, Uccello, Gentile da Fabriano, Lorenzo Monaco, Andrea del Castagno. The artists who invented perspective and naturalism before the Neoplatonic turn.',
  },
  {
    slug: 'school-of-athens',
    name: 'The School of Athens',
    criteria: 'Roman/Umbrian High Renaissance: Raphael, Perugino, Pinturicchio, Piero della Francesca, Mantegna, Signorelli. Classical humanism, mathematical precision, Vatican frescoes, ancient philosophers depicted.',
  },
  {
    slug: 'haarlem-mannerists',
    name: 'Haarlem Mannerists',
    criteria: 'Dutch Mannerist printmakers: Goltzius, Saenredam, Drebbel, Muller, Matham. Virtuoso engravings, mythological and allegorical subjects from the Haarlem school.',
  },
  {
    slug: 'leonardo-drawings',
    name: "Leonardo's Notebooks",
    criteria: 'Works by Leonardo da Vinci — drawings, studies, anatomical sketches, engineering designs, paintings, codex pages.',
  },
  {
    slug: 'the-visionary',
    name: 'The Visionary',
    criteria: 'Visionary/mystical art transcending material reality: Bosch (hell, paradise, grotesque), El Greco (mystical flame), William Blake (illuminated prophecies), Michelangelo (Sistine, divine bodies). Art that claims to show what lies beyond the visible.',
  },
  {
    slug: 'hermetic-image',
    name: 'The Hermetic Image',
    criteria: 'Hermetic and Rosicrucian imagery: Robert Fludd cosmological diagrams, Athanasius Kircher illustrations, depictions of Hermes Trismegistus, Rosicrucian symbolism, occult philosophy diagrams, cosmic correspondences, macrocosm/microcosm.',
  },
  {
    slug: 'emblems-great-work',
    name: 'Emblems & the Great Work',
    criteria: 'Alchemical emblems and imagery: Atalanta Fugiens (Maier), Splendor Solis, Khunrath, Mylius, alchemical processes (nigredo, albedo, rubedo), philosopher\'s stone, emblematic imagery encoding alchemical stages, distillation, conjunction, mercury/sulphur/salt symbolism.',
  },
  {
    slug: 'alchemists-studio',
    name: "The Alchemist's Studio",
    criteria: 'Genre paintings of alchemists at work: laboratory scenes, furnaces, distillation apparatus, cluttered workshops. David Teniers, Adriaen van Ostade, Pieter Bruegel. The material practice of alchemy depicted.',
  },
  {
    slug: 'rudolf-prague',
    name: "Rudolf II's Prague",
    criteria: 'Court of Rudolf II in Prague: Arcimboldo (composite heads), Spranger, Hans von Aachen, Hoefnagel, Sadeler. Mannerist art from the occult emperor\'s Kunstkammer. Also Tycho Brahe, Kepler, John Dee connections.',
  },
  {
    slug: 'the-cosmos',
    name: 'The Cosmos',
    criteria: 'Astronomical and cosmological imagery: celestial maps, armillary spheres, zodiac imagery, planetary diagrams, astrolabes, celestial globes, horoscopes, Ptolemaic spheres, Copernican diagrams, star charts.',
  },
  {
    slug: 'memento-mori',
    name: 'Memento Mori',
    criteria: 'Death, mortality, vanitas: skulls, hourglasses, Dance of Death (Holbein), danse macabre, ars moriendi, vanitas still life, skeleton imagery, guttering candles, the transience of earthly things.',
  },
  {
    slug: 'portraits-tradition',
    name: 'Portraits of the Tradition',
    criteria: 'Engraved or painted portraits of esoteric/philosophical figures: John Dee, Paracelsus, Agrippa, Ficino, Pico della Mirandola, Giordano Bruno, alchemists, astrologers, Hermetic philosophers, natural philosophers. Portrait engravings identifying the sitter by name.',
  },
  {
    slug: 'classical-mysteries',
    name: 'The Classical Mysteries',
    criteria: 'Greek and Roman mythology with mystery/transformation themes: Orpheus, Eurydice, Psyche and Eros/Cupid, Circe, Prometheus, Apollo and Daphne, Narcissus, Persephone/Proserpina, Hecate, Bacchus/Dionysus, Eleusinian mysteries, sibyl, oracle, Delphi, Isis, Osiris, Golden Ass/Apuleius, Leda, Europa, Metamorphoses subjects.',
  },
  {
    slug: 'kabbalah-sacred-geometry',
    name: 'Kabbalah & Sacred Geometry',
    criteria: 'Kabbalistic and sacred geometry imagery: Tree of Life, sephirot, Kabbalistic diagrams, ouroboros, vesica piscis, sacred geometry, labyrinth, mandala, Hebrew letter mysticism, gematria diagrams.',
  },
  {
    slug: 'medieval-illuminations',
    name: 'Medieval Illuminations',
    criteria: 'Medieval manuscript illuminations: Hildegard von Bingen visions, Voynich manuscript, bestiary illustrations, mappae mundi, Book of Kells, Scivias, Ripley Scroll, Hortus Deliciarum, Liber Floridus, medieval cosmological diagrams, gold-leaf manuscripts.',
  },
  {
    slug: 'esoteric-engravers',
    name: 'The Esoteric Engravers',
    criteria: 'Master engravers of esoteric/scientific subjects: Matthäus Merian (Fludd, Maier plates), Wenzel Hollar, Jacques Callot (Temptation of St Anthony), prints by Dürer with esoteric/apocalyptic themes (Melencolia I, Knight Death and Devil, Apocalypse series, Four Horsemen).',
  },
  {
    slug: 'art-of-altdorfer-baldung',
    name: 'Witchcraft & the Uncanny',
    criteria: 'Dark side of the Renaissance: witchcraft scenes, sabbath imagery, Baldung Grien witches, Altdorfer supernatural forests, nocturnal scenes, demons, demonological imagery, Temptation of St Anthony, Walpurgis night.',
  },
  {
    slug: 'venetian-mystery',
    name: 'The Venetian Mystery',
    criteria: 'Venetian Renaissance masters: Giorgione, Titian, Caravaggio, Giovanni Bellini, Veronese, Tintoretto. Venetian color, chiaroscuro, enigmatic subjects (Tempesta), sacred and profane love.',
  },
];

const SYSTEM_PROMPT = `You are a specialist in Renaissance and early modern art, alchemy, Hermetica, and the Western esoteric tradition. Your task is to classify artworks into thematic collections for Source Library, a digital library of pre-modern philosophical and esoteric texts.

You will receive a batch of artworks with metadata. For each artwork, assign it to 0-3 collections from the list below. Most artworks should get 1-2 collections. Some may get 0 if they don't fit any collection well. Never force a fit.

IMPORTANT RULES:
- Only assign a collection if the artwork genuinely belongs. Quality over quantity.
- An artwork by Botticelli is NOT automatically "Ficino's Florence" — it must be a mythological/philosophical work from that circle, not a random portrait commission.
- Artist-based collections (Leonardo's Notebooks, Haarlem Mannerists) should include ALL works by those artists.
- Thematic collections (Classical Mysteries, Memento Mori) should match by SUBJECT, not just because a keyword appears somewhere.
- "Portraits of the Tradition" is for identified portraits of specific esoteric/philosophical figures — not generic portraits.
- A landscape or city view with no esoteric content should get 0 collections.

COLLECTIONS:
${COLLECTIONS.map(c => `- "${c.slug}": ${c.name} — ${c.criteria}`).join('\n')}

Respond with a JSON array where each element has:
- "idx": the artwork index number from the input
- "collections": array of collection slugs (0-3)
- "reasoning": one sentence explaining why (or "No clear collection fit")

Example response:
[
  {"idx": 0, "collections": ["hermetic-image", "emblems-great-work"], "reasoning": "Fludd's macrocosm/microcosm diagram from Utriusque Cosmi"},
  {"idx": 1, "collections": [], "reasoning": "Generic landscape with no esoteric content"},
  {"idx": 2, "collections": ["classical-mysteries"], "reasoning": "Depicts Orpheus charming animals — Orphic myth subject"}
]`;

// ── Gemini API ──────────────────────────────────────────────────────────

async function callGemini(artworks, batchNum, totalBatches) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');

  const userContent = artworks.map((a, i) => {
    const parts = [`[${i}] "${a.title}"`];
    if (a.author) parts.push(`Artist: ${a.author}`);
    if (a.published) parts.push(`Date: ${a.published}`);
    if (a.resource_type) parts.push(`Type: ${a.resource_type}`);
    if (a.commons_description) parts.push(`Description: ${a.commons_description.substring(0, 400)}`);
    if (a.commons_categories?.length) parts.push(`Categories: ${a.commons_categories.slice(0, 8).join(', ')}`);
    if (a.linked_art) {
      if (a.linked_art.technique) parts.push(`Technique: ${a.linked_art.technique}`);
      if (a.linked_art.catalogue_refs?.length) parts.push(`Catalogue: ${a.linked_art.catalogue_refs.map(r => `${r.type} ${r.number}`).join(', ')}`);
    }
    return parts.join('\n');
  }).join('\n\n---\n\n');

  const body = {
    contents: [
      { role: 'user', parts: [{ text: userContent }] },
    ],
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
      maxOutputTokens: 8192,
    },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      });

      if (res.status === 429 || res.status === 503) {
        const wait = Math.pow(2, attempt + 1) * 1000;
        console.log(`  Rate limited (${res.status}), waiting ${wait / 1000}s...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Gemini ${res.status}: ${text.substring(0, 200)}`);
      }

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('No text in Gemini response');

      // Parse JSON from response
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error('Response is not an array');

      // Validate slugs
      const validSlugs = new Set(COLLECTIONS.map(c => c.slug));
      for (const item of parsed) {
        item.collections = (item.collections || []).filter(s => validSlugs.has(s));
      }

      return parsed;
    } catch (err) {
      if (attempt === 2) throw err;
      console.log(`  Attempt ${attempt + 1} failed: ${err.message}, retrying...`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const booksCol = db.collection('books');
  const collectionsCol = db.collection('collections');

  // Fetch all artworks with metadata
  const query = { resource_type: { $exists: true } };
  const projection = {
    id: 1, slug: 1, title: 1, author: 1, published: 1,
    resource_type: 1, commons_description: 1, commons_categories: 1,
    linked_art: 1, commons_title: 1, thumbnail: 1, thumbnail_blob: 1,
  };

  let artworks = await booksCol.find(query, { projection }).toArray();
  console.log(`Found ${artworks.length} artworks`);

  if (LIMIT > 0) {
    artworks = artworks.slice(0, LIMIT);
    console.log(`Limited to ${artworks.length} for testing`);
  }

  // Clear existing collection assignments (start fresh)
  if (!DRY_RUN) {
    const clearResult = await booksCol.updateMany(
      { resource_type: { $exists: true } },
      { $set: { collections: [] } }
    );
    console.log(`Cleared collections on ${clearResult.modifiedCount} artworks`);
  }

  // Process in batches
  const totalBatches = Math.ceil(artworks.length / BATCH_SIZE);
  let totalAssigned = 0;
  let totalSkipped = 0;
  const collectionCounts = {};

  for (let i = 0; i < artworks.length; i += BATCH_SIZE) {
    const batch = artworks.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    process.stdout.write(`\nBatch ${batchNum}/${totalBatches} (${batch.length} artworks)... `);

    try {
      const results = await callGemini(batch, batchNum, totalBatches);
      let batchAssigned = 0;

      for (const result of results) {
        const artwork = batch[result.idx];
        if (!artwork) {
          console.warn(`  Warning: idx ${result.idx} out of range`);
          continue;
        }

        if (result.collections.length === 0) {
          totalSkipped++;
          continue;
        }

        batchAssigned++;
        totalAssigned++;

        for (const slug of result.collections) {
          collectionCounts[slug] = (collectionCounts[slug] || 0) + 1;
        }

        if (!DRY_RUN) {
          await booksCol.updateOne(
            { _id: artwork._id },
            { $set: { collections: result.collections } }
          );
        }

        if (DRY_RUN) {
          console.log(`  [${result.idx}] "${artwork.title?.substring(0, 50)}" → ${result.collections.join(', ')} — ${result.reasoning}`);
        }
      }

      console.log(`${batchAssigned} assigned, ${batch.length - batchAssigned} skipped`);

      // Small delay between batches to be polite
      if (i + BATCH_SIZE < artworks.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (err) {
      console.error(`\n  ERROR on batch ${batchNum}: ${err.message}`);
      // Continue with next batch
    }
  }

  // ── Update collection documents ───────────────────────────────────────

  if (!DRY_RUN) {
    console.log('\n━━━ Updating collection documents ━━━');

    // Import collection definitions from create-art-collections for descriptions
    for (const col of COLLECTIONS) {
      // Count artworks in this collection
      const count = await booksCol.countDocuments({
        resource_type: { $exists: true },
        collections: col.slug,
      });

      // Get featured images (random sample of 4)
      const featured = await booksCol.aggregate([
        { $match: { resource_type: { $exists: true }, collections: col.slug } },
        { $sample: { size: 4 } },
        { $project: { thumbnail_blob: 1, thumbnail: 1 } },
      ]).toArray();

      const featuredImages = featured.map(a => ({
        extracted_url: a.thumbnail_blob || a.thumbnail,
        thumbnail_url: a.thumbnail,
      }));

      await collectionsCol.updateOne(
        { slug: col.slug },
        {
          $set: {
            book_count: count,
            featured_images: featuredImages,
            updated_at: new Date(),
          },
        }
      );

      console.log(`  ${col.slug}: ${count} artworks`);
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────

  console.log('\n━━━ SUMMARY ━━━');
  console.log(`Total artworks: ${artworks.length}`);
  console.log(`Assigned to collections: ${totalAssigned}`);
  console.log(`No collection fit: ${totalSkipped}`);
  console.log(`\nPer collection:`);
  const sorted = Object.entries(collectionCounts).sort((a, b) => b[1] - a[1]);
  for (const [slug, count] of sorted) {
    const name = COLLECTIONS.find(c => c.slug === slug)?.name || slug;
    console.log(`  ${count.toString().padStart(4)} ${name}`);
  }

  if (DRY_RUN) {
    console.log('\n⚠ DRY RUN — no changes written to database');
  }

  await client.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
