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
const LIMIT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--limit') || '10');
const ARTIST_FILTER = process.argv.find((_, i, a) => a[i - 1] === '--artist') || null;

const client = new MongoClient(process.env.MONGODB_URI);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });

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
  return `You are a museum curator cataloging a work of visual art for Source Library, a digital library of Renaissance and early modern Western esoteric texts (alchemy, Hermetica, Neoplatonism, Kabbalah, Rosicrucianism, natural philosophy).

ARTWORK METADATA:
- Title: ${artwork.title || 'Unknown'}
- Artist: ${artwork.author || 'Unknown'}
- Date: ${artwork.published || 'Unknown'}
- Medium: ${artwork.medium || 'Unknown'}
- Type: ${artwork.resource_type || 'Unknown'}
- Commons categories: ${(artwork.commons_categories || []).join(', ') || 'None'}

Analyze this artwork image and return JSON with these fields:

{
  "subject": "One factual sentence: what is depicted. Be specific — name the scene, figures, or objects.",
  "description": "2-3 sentences a museum visitor would read. What they're looking at, what's happening, notable visual details. No art-historical jargon. No AI slop ('masterful', 'captivating', 'testament to').",
  "significance": "1-2 sentences on why this matters — its intellectual, historical, or philosophical context. Connection to specific texts, thinkers, or ideas from the Western esoteric/philosophical tradition. If no meaningful connection exists, set to null. Do NOT invent connections.",
  "genre": "portrait | allegory | religious | mythological | landscape | genre-scene | still-life | scientific | decorative | emblem | architectural | anatomical | map | botanical",
  "collections": ["Array of collection slugs this artwork belongs in. Choose from the list below. Be VERY selective — most artworks fit 1-2 collections, rarely 3. Only assign a collection if the artwork is a STRONG fit, not a tangential one. A map of a Dutch city does NOT belong in 'courts-of-wonder'. A portrait of a philosopher belongs in 'portraits-tradition', not also in every tradition they studied."],
  "cross_references": [
    {
      "text_or_author": "Specific text title or author name from the Western esoteric tradition",
      "relationship": "One sentence explaining the connection",
      "confidence": "high | medium | low"
    }
  ],
  "inscriptions": "If the image contains readable text (Latin inscriptions, titles, captions, cartouches, verses, dedications, labels), transcribe it here verbatim. Preserve line breaks. If no readable text, set to null.",
  "has_readable_text": true,
  "figures_depicted": ["Named figures, historical persons, or figure types (e.g., 'Mercury', 'alchemist', 'Hermes Trismegistus')"],
  "symbols": ["Identifiable symbols with specific iconographic meaning (e.g., 'caduceus', 'ouroboros', 'pelican-in-her-piety'). NOT generic items like 'tree' or 'building'."]
}

AVAILABLE COLLECTIONS:
${COLLECTION_LIST}

RULES:
- Be HONEST. If you're not confident in an identification, say so. If there's no esoteric connection, say null.
- Be SPECIFIC. "A print depicting Mercury" not "a beautiful work showing a figure."
- Inscriptions: transcribe ALL visible text, including small captions. This is important for prints and engravings.
- Collections: only assign collections you're confident about. An ordinary landscape with no esoteric content should get 0 topical collections.
- cross_references: only include if confidence is medium or high. Never fabricate.
- Return valid JSON only. No markdown, no commentary.`;
}

async function fetchImageBase64(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch image: ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  return buf.toString('base64');
}

async function enrichArtwork(artwork) {
  const imageUrl = artwork.thumbnail_blob || artwork.thumbnail;
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
  const query = { resource_type: { $exists: true }, enrichment: { $exists: false } };
  if (ARTIST_FILTER) query.author = ARTIST_FILTER;

  const projection = {
    _id: 1, id: 1, slug: 1, title: 1, author: 1, published: 1,
    medium: 1, resource_type: 1, thumbnail_blob: 1, thumbnail: 1,
    commons_categories: 1,
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
            has_readable_text: !!enrichment.has_readable_text,
            figures_depicted: enrichment.figures_depicted || [],
            symbols: enrichment.symbols || [],
            model: 'gemini-3-flash-preview',
            enriched_at: new Date(),
          },
          updated_at: new Date(),
        };

        // Tag artwork into collections (same field books use)
        const collectionSlugs = (enrichment.collections || []).filter(s =>
          ALL_COLLECTIONS.some(c => c.slug === s)
        );

        const update = { $set: updateFields };
        if (collectionSlugs.length > 0) {
          update.$addToSet = { collections: { $each: collectionSlugs } };
        }

        await books.updateOne({ _id: art._id }, update);
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
