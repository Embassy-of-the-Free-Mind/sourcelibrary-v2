#!/usr/bin/env node
/**
 * Unified artwork enrichment: one Gemini Flash vision call per artwork.
 * Produces description, significance, collection assignment, cross-references,
 * OCR text, and visual elements.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/artwork-enrichment.mjs --limit 10 [--dry-run] [--artist "Hendrick Goltzius"]
 *
 * GitHub issues: #336, #374
 */
import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';

const DRY_RUN = process.argv.includes('--dry-run');
const RE_ENRICH = process.argv.includes('--re-enrich');
const LIMIT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--limit') || '10');
const ARTIST_FILTER = process.argv.find((_, i, a) => a[i - 1] === '--artist') || null;
const SLUG_FILTER = process.argv.find((_, i, a) => a[i - 1] === '--slug') || null;

const client = new MongoClient(process.env.MONGODB_URI);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite-preview' });

// Visual art collections that artworks can be assigned to
const VISUAL_ART_COLLECTIONS = [
  { slug: 'ficinos-florence', name: "Ficino's Florence" },
  { slug: 'before-ficino', name: 'Before Ficino' },
  { slug: 'school-of-athens', name: 'The School of Athens' },
  { slug: 'haarlem-mannerists', name: 'Haarlem Mannerists' },
  { slug: 'leonardo-drawings', name: "Leonardo's Notebooks" },
  { slug: 'the-visionary', name: 'The Visionary' },
  { slug: 'hermetic-image', name: 'The Hermetic Image' },
  { slug: 'emblems-great-work', name: 'Emblems & the Great Work' },
  { slug: 'alchemists-studio', name: "The Alchemist's Studio" },
  { slug: 'rudolf-prague', name: "Rudolf II's Prague" },
  { slug: 'the-cosmos', name: 'The Cosmos' },
  { slug: 'memento-mori', name: 'Memento Mori' },
  { slug: 'portraits-tradition', name: 'Portraits of the Tradition' },
  { slug: 'classical-mysteries', name: 'The Classical Mysteries' },
  { slug: 'kabbalah-sacred-geometry', name: 'Kabbalah & Sacred Geometry' },
  { slug: 'medieval-illuminations', name: 'Medieval Illuminations' },
  { slug: 'esoteric-engravers', name: 'The Esoteric Engravers' },
  { slug: 'art-of-altdorfer-baldung', name: 'Witchcraft & the Uncanny' },
  { slug: 'venetian-mystery', name: 'The Venetian Mystery' },
];

// Also allow assigning to topical (non-visual-art) collections when relevant
const TOPICAL_COLLECTIONS = [
  { slug: 'alchemy', name: 'Alchemy' },
  { slug: 'hermetica', name: 'Hermetica' },
  { slug: 'kabbalah', name: 'Kabbalah' },
  { slug: 'astrology', name: 'Astrology & Divination' },
  { slug: 'neoplatonism', name: 'Neoplatonism' },
  { slug: 'natural-philosophy', name: 'Natural Philosophy & Science' },
  { slug: 'alchemical-emblem', name: 'The Alchemical Emblem' },
  { slug: 'maps-of-the-invisible', name: 'Maps of the Invisible' },
  { slug: 'nova-reperta', name: 'Nova Reperta' },
  { slug: 'rosicrucian-moment', name: 'The Rosicrucian Moment' },
  { slug: 'courts-of-wonder', name: 'Courts of Wonder' },
  { slug: 'bestiary-tradition', name: 'The Bestiary Tradition' },
];

const ALL_COLLECTIONS = [...VISUAL_ART_COLLECTIONS, ...TOPICAL_COLLECTIONS];
const COLLECTION_LIST = ALL_COLLECTIONS.map(c => `  - ${c.slug}: ${c.name}`).join('\n');

function buildPrompt(artwork) {
  return `You are cataloging a work of art for Source Library, a scholarly digital library of primary sources. The collection spans all traditions worldwide: Western esotericism (alchemy, Hermetica, Kabbalah, Rosicrucianism), classical antiquity (Greek, Roman, Egyptian, Mesopotamian), world religions (Hinduism, Buddhism, Islam, Judaism, Daoism, Shinto), indigenous traditions (African, Oceanic, Mesoamerican, Native American), and early modern knowledge (anatomy, astronomy, natural philosophy, botany).

ARTWORK METADATA:
- Title: ${artwork.title || 'Unknown'}
- Artist: ${artwork.author || 'Unknown'}
- Date: ${artwork.published || 'Unknown'}
- Medium: ${artwork.medium || 'Unknown'}
- Type: ${artwork.resource_type || 'Unknown'}
- Commons categories: ${(artwork.commons_categories || []).join(', ') || 'None'}

Look at the image carefully. Return JSON with these fields:

{
  "subject": "One sentence: what is physically in the image. Name every figure, creature, object, and action you can see. Be literal. 'A nude woman straddles a broomstick, legs spread, pressing it against her vulva' — not 'an allegory of the sabbath'. 'A four-armed blue-skinned deity stands on a prostrate figure, holding a severed head and a sword' — not 'a wrathful deity'.",
  "description": "2-3 sentences describing what a person SEES when they look at this image. What are the figures doing? What are they holding? What position are their bodies in? What are they wearing or not wearing? What colors dominate? What is in the foreground vs background? Be concrete enough that someone could find this image by searching for any visible object, body part, animal, color, or action. Do NOT interpret — describe. Do NOT use art-criticism language ('masterful', 'evocative', 'captures the essence'). Just say what is there.",
  "significance": "1-2 sentences of historical or intellectual context. What tradition does this come from? What text, ritual, belief system, or historical moment does it connect to? Name the specific text, author, or school of thought. This applies to any tradition worldwide — Indic, Buddhist, Islamic, African, Mesoamerican, classical, etc. — not just Western. If no meaningful connection exists, set to null. Do NOT fabricate.",
  "genre": "portrait | allegory | religious | mythological | landscape | genre-scene | still-life | scientific | decorative | emblem | architectural | anatomical | map | botanical | ritual-object | manuscript-illumination | sculpture",
  "collections": ["Collection slugs from the list below. Be selective — 1-2 usually, rarely 3. Only assign if STRONG fit."],
  "cross_references": [
    {
      "text_or_author": "A specific text title or author name this artwork connects to",
      "relationship": "One sentence explaining the connection",
      "confidence": "high | medium | low"
    }
  ],
  "inscriptions": "Transcribe ALL readable text on the image — titles, verses, dedications, labels, publisher lines, plate numbers, colophons. Look at the ENTIRE image including margins. Separate distinct text blocks with blank lines. If no readable text, null.",
  "inscriptions_translation": "English translation if inscriptions exist and are not in English. Null otherwise.",
  "inscriptions_language": "Language of the inscription (e.g. 'Latin', 'Sanskrit', 'Arabic'). Null if none.",
  "has_readable_text": true,
  "figures_depicted": ["Named figures, deities, historical persons, or figure types visible in the image"],
  "symbols": ["Symbols with specific iconographic meaning (e.g. 'caduceus', 'ouroboros', 'vajra', 'ankh', 'yin-yang', 'broomstick'). NOT generic objects like 'tree' or 'building'."],
  "iconclass": ["2-5 Iconclass codes. 0=Abstract, 1=Religion, 2=Nature, 3=Human, 4=Society, 5=Ideas, 6=History, 7=Bible, 8=Literature, 9=Classical Myth. Key: 11H=saints, 14=astrology, 25F=animals, 25FF=fabulous animals, 31A=human figure, 48C=emblems, 49E39=alchemy, 61B2=personifications, 92=classical gods."]
}

AVAILABLE COLLECTIONS:
${COLLECTION_LIST}

RULES:
- DESCRIBE WHAT YOU SEE. Not what it means, not what it represents — what is physically visible. A viewer should be able to picture the image from your description alone.
- Be FRANK about bodies. Nudity, genitalia, sexual acts, violence, gore, death — describe them plainly using anatomical terms. This is a scholarly library serving researchers. 'The figure's erect penis' not 'a symbol of fertility'. 'She squats over the broomstick pressing it against her vulva' not 'she rides a broomstick'. Accurate description is essential for scholarly search and retrieval.
- Be SPECIFIC. Name colors, positions, gestures, facial expressions, clothing, objects held. 'A skeleton wearing a crown holds an hourglass in its left hand and a scythe in its right' — not 'a memento mori figure'.
- INSCRIPTIONS: Look at the ENTIRE image including margins. Prints often have 3-4+ text blocks. Transcribe all of them.
- COLLECTIONS: Only assign if confident. Most artworks fit 1-2 collections.
- CROSS-REFERENCES: Connect to specific texts, authors, or traditions — not vague themes. Only medium or high confidence.
- Return valid JSON only. No markdown, no commentary.`;
}

async function fetchImageBase64(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch image: ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  return buf.toString('base64');
}

async function enrichArtwork(artwork) {
  // Prefer highest resolution for better inscription reading.
  // commons_full_url is the original upload (often 4000+ px).
  const imageUrl = artwork.commons_full_url || artwork.thumbnail_blob || artwork.thumbnail;
  if (!imageUrl) return { error: 'no_image' };

  const prompt = buildPrompt(artwork);
  const imageBase64 = await fetchImageBase64(imageUrl);
  const mimeType = imageUrl.includes('.png') ? 'image/png' : 'image/jpeg';

  const result = await model.generateContent([
    { text: prompt },
    { inlineData: { mimeType, data: imageBase64 } },
  ]);

  const text = result.response.text();
  const usage = result.response.usageMetadata;

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
  const jsonStr = jsonMatch[1].trim();

  try {
    const parsed = JSON.parse(jsonStr);
    return {
      ...parsed,
      _tokens: usage?.totalTokenCount || 0,
      _prompt_tokens: usage?.promptTokenCount || 0,
      _completion_tokens: usage?.candidatesTokenCount || 0,
    };
  } catch (e) {
    return { error: 'json_parse_failed', raw: text.substring(0, 500) };
  }
}

async function main() {
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  // Build query — resource_type_sparse index makes this fast
  const query = { resource_type: { $exists: true } };
  if (!RE_ENRICH) query.enrichment = { $exists: false };
  if (ARTIST_FILTER) query.author = ARTIST_FILTER;
  if (SLUG_FILTER) query.slug = SLUG_FILTER;

  const projection = {
    _id: 1, id: 1, slug: 1, title: 1, author: 1, published: 1,
    medium: 1, resource_type: 1, thumbnail_blob: 1, thumbnail: 1,
    commons_full_url: 1, commons_categories: 1,
  };

  // Use cursor-based iteration to avoid loading all docs into memory
  // Atlas is slow on large .toArray() calls
  let cursor;
  if (!ARTIST_FILTER && DRY_RUN) {
    // In dry-run mode, sample randomly for diversity
    const sampled = await books.aggregate([
      { $match: query },
      { $sample: { size: LIMIT } },
      { $project: projection },
    ]).toArray();
    cursor = { [Symbol.asyncIterator]: async function*() { for (const d of sampled) yield d; }, count: sampled.length };
  } else {
    cursor = books.find(query, { projection }).limit(LIMIT);
    cursor.count = LIMIT; // approximate
  }

  console.log(`${DRY_RUN ? 'DRY RUN — ' : ''}Processing up to ${LIMIT} artworks...`);

  let success = 0, errors = 0, totalTokens = 0, processed = 0;
  const results = [];

  for await (const art of cursor) {
    processed++;
    const label = `[${processed}] ${art.author} — ${art.title?.substring(0, 50)}`;

    try {
      console.log(`\n${label}`);
      const t0 = Date.now();
      const enrichment = await enrichArtwork(art);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

      if (enrichment.error) {
        console.log(`  ERROR: ${enrichment.error}`);
        errors++;
        continue;
      }

      console.log(`  Subject: ${enrichment.subject}`);
      console.log(`  Genre: ${enrichment.genre}`);
      console.log(`  Collections: ${(enrichment.collections || []).join(', ') || 'none'}`);
      console.log(`  Has text: ${enrichment.has_readable_text}`);
      if (enrichment.inscriptions) {
        console.log(`  Inscriptions: ${enrichment.inscriptions.substring(0, 100)}...`);
      }
      if (enrichment.iconclass?.length > 0) {
        console.log(`  Iconclass: ${enrichment.iconclass.join(', ')}`);
      }
      if (enrichment.cross_references?.length > 0) {
        console.log(`  Cross-refs: ${enrichment.cross_references.map(r => r.text_or_author).join(', ')}`);
      }
      console.log(`  Tokens: ${enrichment._tokens} | ${elapsed}s`);

      totalTokens += enrichment._tokens || 0;
      success++;
      results.push({ slug: art.slug, ...enrichment });

      if (!DRY_RUN) {
        // Write enrichment to the book document
        const updateFields = {
          enrichment: {
            subject: enrichment.subject,
            description: enrichment.description,
            significance: enrichment.significance,
            genre: enrichment.genre,
            cross_references: enrichment.cross_references || [],
            inscriptions: enrichment.inscriptions || null,
            inscriptions_translation: enrichment.inscriptions_translation || null,
            inscriptions_language: enrichment.inscriptions_language || null,
            has_readable_text: !!enrichment.has_readable_text,
            figures_depicted: enrichment.figures_depicted || [],
            symbols: enrichment.symbols || [],
            iconclass: enrichment.iconclass || [],
            model: 'gemini-3.1-flash-lite-preview',
            enriched_at: new Date(),
          },
          updated_at: new Date(),
        };

        await books.updateOne({ _id: art._id }, { $set: updateFields });

        // Add to collections array (used by collection pages for querying)
        if (enrichment.collections?.length > 0) {
          const validSlugs = enrichment.collections.filter(s =>
            ALL_COLLECTIONS.some(c => c.slug === s)
          );
          if (validSlugs.length > 0) {
            await books.updateOne(
              { _id: art._id },
              { $addToSet: { collections: { $each: validSlugs } } }
            );
          }
        }
      }

      // Rate limit: 2s between calls
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.log(`  ERROR: ${err.message}`);
      errors++;
      // Back off on rate limit errors
      if (err.message?.includes('429') || err.message?.includes('quota')) {
        console.log('  Rate limited — waiting 30s...');
        await new Promise(r => setTimeout(r, 30000));
      } else {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  // Summary
  console.log('\n━━━ SUMMARY ━━━');
  console.log(`Success: ${success}/${processed}`);
  console.log(`Errors: ${errors}`);
  console.log(`Total tokens: ${totalTokens.toLocaleString()}`);
  console.log(`Avg tokens/artwork: ${success > 0 ? Math.round(totalTokens / success) : 0}`);
  const estimatedCost = totalTokens * 0.00000015; // ~$0.15/M tokens for Flash input+output blended
  console.log(`Estimated cost for this run: $${estimatedCost.toFixed(4)}`);
  if (success > 0) {
    const fullCorpusCost = (totalTokens / success) * 7069 * 0.00000015;
    console.log(`Projected cost for full 7,069 artworks: $${fullCorpusCost.toFixed(2)}`);
  }

  // Save detailed results
  if (results.length > 0) {
    const fs = await import('fs');
    const outDir = new URL('./output/', import.meta.url);
    try { fs.mkdirSync(outDir, { recursive: true }); } catch {}
    fs.writeFileSync(
      new URL('artwork-enrichment-results.json', outDir),
      JSON.stringify(results, null, 2)
    );
    console.log(`\nDetailed results: scripts/output/artwork-enrichment-results.json`);
  }

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
