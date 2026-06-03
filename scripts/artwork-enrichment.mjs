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
const COLLECTION_FILTER = process.argv.find((_, i, a) => a[i - 1] === '--collection') || null;

const client = new MongoClient(process.env.MONGODB_URI);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite' });

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
  { slug: 'dreams-unconscious', name: 'Dreams & the Unconscious' },
  { slug: 'music-sound', name: 'Music, Sound & Cosmic Harmony' },
  { slug: 'dance-of-death', name: 'Dance of Death' },
  { slug: 'book-of-the-dead', name: 'The Book of the Dead' },
  { slug: 'the-infernal', name: 'The Infernal' },
  { slug: 'yokai-oni', name: 'Yōkai & Oni' },
  { slug: 'wrathful-deities', name: 'Wrathful Deities' },
  { slug: 'angels-celestials', name: 'Angels & Celestials' },
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
- Commons categories: ${typeof artwork.commons_categories === 'string' ? artwork.commons_categories.split('|').slice(0, 10).join(', ') : Array.isArray(artwork.commons_categories) ? artwork.commons_categories.slice(0, 10).join(', ') : 'None'}

Look at the image carefully. Return JSON with these fields:

{
  "display_title": "A clean, concise English title for this artwork (max 80 chars). If the existing title is a messy filename, catalog number, or foreign language, rewrite it. If it's already clean, return it unchanged. Examples: 'The Sleep of Reason Produces Monsters', 'Queen of Cups (Visconti-Sforza Tarot)', 'Anatomical Study of the Muscular System'.",
  "corrected_author": "The artist's name in standard form (e.g. 'Francisco de Goya', 'Albrecht Dürer', 'Unknown artist'). Fix Wikipedia usernames, doubled strings, institution names that aren't artists. If the existing author is correct, return it unchanged. Null if truly unknown.",
  "subject": "One sentence: what is depicted. Name every identifiable figure, creature, object, and action. If you can identify who the figures are (a specific deity, saint, mythological character, or historical person), name them. Be concrete about what they are doing and what is happening.",
  "description": "2-3 sentences describing the image for someone who cannot see it. What do the figures look like, what are they doing, what are they holding, what are they wearing? Describe poses, gestures, facial expressions, colors, composition. Include enough physical detail that someone could find this image by searching for any object, figure, animal, or action in it. Interpretation and meaning are welcome — but ground them in what is visually present.",
  "significance": "1-2 sentences of historical or intellectual context. What tradition, text, ritual, or belief system does this connect to? Name specific texts, authors, schools of thought, or historical events. This applies to any tradition worldwide. If no meaningful connection exists, set to null. Do NOT fabricate.",
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
  "iconclass": ["2-5 Iconclass codes. 0=Abstract, 1=Religion, 2=Nature, 3=Human, 4=Society, 5=Ideas, 6=History, 7=Bible, 8=Literature, 9=Classical Myth. Key: 11H=saints, 14=astrology, 25F=animals, 25FF=fabulous animals, 31A=human figure, 48C=emblems, 49E39=alchemy, 61B2=personifications, 92=classical gods."],
  "aat_technique": "Getty AAT preferred term for technique (e.g. 'engraving', 'etching', 'woodcut', 'oil painting', 'fresco', 'lithography', 'watercolor', 'pen and ink', 'charcoal', 'tempera', 'mezzotint', 'aquatint'). Use the most specific applicable term.",
  "aat_material": "Getty AAT preferred term for support/material (e.g. 'laid paper', 'canvas', 'panel (wood)', 'parchment', 'vellum', 'copper (metal)', 'ivory', 'silk'). Null if unknown.",
  "aat_style": "Getty AAT style/period term (e.g. 'Renaissance', 'Baroque', 'Mannerist', 'Gothic', 'Edo', 'Mughal', 'Symbolist', 'Pre-Raphaelite'). Use AAT's preferred form.",
  "ulan_artist": "If you can identify the artist, provide their Getty ULAN ID as a number (e.g. 500024327 for Hendrick Goltzius, 500010141 for Albrecht Dürer, 500118936 for Francisco de Goya). Only include if confident. Null if unknown.",
  "tgn_place": "If a specific place of creation is identifiable, provide the Getty TGN ID (e.g. 7000874 for Rome, 7006952 for Florence, 7016845 for Amsterdam). Null if unknown.",
  "period": "Art-historical period (e.g. 'Renaissance', 'Baroque', 'Medieval', 'Edo period', 'Mughal', 'Song dynasty', 'Hellenistic', 'Romanesque', 'Gothic', 'Symbolist', 'Art Nouveau'). Be specific to the cultural tradition.",
  "culture": "Cultural origin (e.g. 'Italian', 'Japanese', 'Tibetan', 'Persian', 'Flemish', 'German', 'French', 'Indian', 'Chinese', 'Egyptian', 'Aztec'). Null if unclear.",
  "museum_description": "2-3 sentences for a museum wall label. What the viewer sees and why it matters. No AI slop."
}

AVAILABLE COLLECTIONS:
${COLLECTION_LIST}

RULES:
- Be CONCRETE. Describe what you see in enough detail that someone could picture the image. Name colors, positions, gestures, expressions, clothing, objects.
- Be FRANK. Nudity, genitalia, sexual acts, violence, death — describe them accurately using plain language. This is a scholarly library. Do not euphemize or sanitize.
- IDENTIFY figures when possible. If a figure is recognizable as a specific deity, saint, mythological character, or historical person, name them and explain why you think so.
- INSCRIPTIONS: Look at the ENTIRE image including margins. Prints often have 3-4+ text blocks. Transcribe all of them.
- COLLECTIONS: Only assign if confident. Most artworks fit 1-2 collections.
- CROSS-REFERENCES: Connect to specific texts, authors, or traditions — not vague themes. Only medium or high confidence.
- No AI slop ('masterful', 'captivating', 'testament to', 'captures the essence').
- Return valid JSON only. No markdown, no commentary.`;
}

async function fetchImageBase64(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch image: ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());

  // Downscale large images to avoid Gemini API limits (~4MB base64 safe)
  // sharp is optional — if not available, send raw and let Gemini handle it
  const MAX_BYTES = 3 * 1024 * 1024; // 3MB
  if (buf.length > MAX_BYTES) {
    try {
      const sharp = (await import('sharp')).default;
      const resized = await sharp(buf)
        .resize({ width: 1600, withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      return resized.toString('base64');
    } catch {
      // sharp not available — truncate won't work, just try raw
      return buf.toString('base64');
    }
  }
  return buf.toString('base64');
}

async function enrichArtwork(artwork) {
  // Prefer R2 archived images (no rate limits, fast) over external URLs.
  // Skip artworks that are only on external URLs — they'll 429.
  // Run R2 archival first, then enrichment.
  const r2Url = artwork.archived_full_url || artwork.thumbnail_blob;
  const externalUrl = artwork.commons_full_url || artwork.thumbnail;
  const imageUrl = r2Url || externalUrl;
  if (!imageUrl) return { error: 'no_image' };
  if (!r2Url && externalUrl?.includes('wikimedia')) return { error: 'not_on_r2_yet' };

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

  // Build query — only visible, non-deleted artworks
  const query = {
    resource_type: { $exists: true },
    content_type: 'artwork',
    visible: true,
    deleted: { $ne: true },
  };
  if (!RE_ENRICH) query.enrichment = { $exists: false };
  if (ARTIST_FILTER) query.author = ARTIST_FILTER;
  if (SLUG_FILTER) query.slug = SLUG_FILTER;
  if (COLLECTION_FILTER) query.collections = COLLECTION_FILTER;

  const projection = {
    _id: 1, id: 1, slug: 1, title: 1, author: 1, published: 1,
    medium: 1, resource_type: 1, thumbnail_blob: 1, thumbnail: 1,
    archived_full_url: 1, commons_full_url: 1, commons_categories: 1,
    display_title: 1, description: 1, hidden: 1, hidden_reason: 1,
    'image_source.source_description': 1, 'enrichment.ulan_artist': 1,
  };

  // Use batched skip/limit to avoid cursor timeouts on long-running enrichment
  console.log(`${DRY_RUN ? 'DRY RUN — ' : ''}Processing up to ${LIMIT} artworks...`);

  let success = 0, errors = 0, totalTokens = 0, processed = 0;
  const results = [];
  const BATCH_SIZE = 100;

  // Fetch artworks in batches to avoid MongoDB cursor timeout
  async function* batchIterator() {
    let skip = 0;
    while (skip < LIMIT) {
      const batchLimit = Math.min(BATCH_SIZE, LIMIT - skip);
      let batch;
      if (!ARTIST_FILTER && DRY_RUN && skip === 0) {
        batch = await books.aggregate([
          { $match: query },
          { $sample: { size: batchLimit } },
          { $project: projection },
        ]).toArray();
      } else {
        batch = await books.find(query, { projection })
          .sort({ _id: 1 })
          .skip(skip)
          .limit(batchLimit)
          .toArray();
      }
      if (batch.length === 0) break;
      for (const doc of batch) yield doc;
      skip += batch.length;
      if (batch.length < batchLimit) break;
    }
  }

  for await (const art of batchIterator()) {
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

      if (enrichment.display_title && enrichment.display_title !== art.title) {
        console.log(`  Title: "${art.title?.substring(0, 40)}" → "${enrichment.display_title}"`);
      }
      if (enrichment.corrected_author && enrichment.corrected_author !== art.author) {
        console.log(`  Author: "${art.author?.substring(0, 30)}" → "${enrichment.corrected_author}"`);
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
        const now = new Date();
        const provenanceEntry = {
          source: 'ai_enrichment',
          model: 'gemini-3.1-flash-lite',
          date: now,
          script: 'artwork-enrichment.mjs',
        };

        // Write enrichment subdocument (full structured data)
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
            aat_technique: enrichment.aat_technique || null,
            aat_material: enrichment.aat_material || null,
            aat_style: enrichment.aat_style || null,
            ulan_artist: enrichment.ulan_artist || null,
            tgn_place: enrichment.tgn_place || null,
            period: enrichment.period || null,
            culture: enrichment.culture || null,
            museum_description: enrichment.museum_description || null,
            model: 'gemini-3.1-flash-lite',
            enriched_at: now,
          },
          updated_at: now,
        };

        // Promote enrichment to core book fields for search/display
        // Only overwrite if the enrichment provides better data
        const provenance = {};

        // Display title — promote if enrichment provides a cleaner one
        if (enrichment.display_title && enrichment.display_title !== art.title) {
          updateFields.display_title = enrichment.display_title;
          provenance.display_title = { ...provenanceEntry, previous_value: art.display_title || art.title };
        }

        // Author — fix if enrichment corrects it
        if (enrichment.corrected_author && enrichment.corrected_author !== art.author) {
          updateFields.author = enrichment.corrected_author;
          provenance.author = { ...provenanceEntry, previous_value: art.author };
        }

        // Description — promote to top-level for search indexing.
        // Preserve the original source description (e.g. ContentDM catalog text) in
        // provenance so AI enrichment never destroys it. Also keep a one-time snapshot
        // of the source-of-record description under image_source.source_description.
        if (enrichment.description) {
          updateFields.description = enrichment.description;
          provenance.description = { ...provenanceEntry, previous_value: art.description ?? null };
          if (art.description && !art.image_source?.source_description) {
            updateFields['image_source.source_description'] = art.description;
          }
        }

        // Summary — combine subject + significance for book-level search
        if (enrichment.subject) {
          const summary = [enrichment.subject, enrichment.significance].filter(Boolean).join(' ');
          updateFields.summary = summary;
          provenance.summary = provenanceEntry;
        }

        // Genre → resource_type (more accurate than import guess)
        if (enrichment.genre && enrichment.genre !== art.resource_type) {
          updateFields.resource_type = enrichment.genre;
          provenance.resource_type = { ...provenanceEntry, previous_value: art.resource_type };
        }

        // Write provenance for all touched fields
        if (Object.keys(provenance).length > 0) {
          for (const [field, entry] of Object.entries(provenance)) {
            updateFields[`field_provenance.${field}`] = entry;
          }
          updateFields['field_provenance.enrichment'] = provenanceEntry;
        }

        // Make visible after enrichment (Commons imports start as hidden drafts)
        if (art.hidden && art.hidden_reason === 'artwork_import') {
          updateFields.hidden = false;
          updateFields.status = 'published';
          updateFields.visible = true;
        }

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
