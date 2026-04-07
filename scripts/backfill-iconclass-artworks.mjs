#!/usr/bin/env node
/**
 * Backfill Iconclass codes for all artworks using Gemini 3.1 Flash Lite.
 * Lightweight: only asks for iconclass codes, not full re-enrichment.
 * Skips artworks that already have codes (e.g., Rijksmuseum harvest).
 *
 * Cost: ~500 tokens/artwork * 6,651 artworks * $0.075/M tokens ≈ $0.25
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/backfill-iconclass-artworks.mjs [--dry-run] [--limit 100]
 */
import { MongoClient } from 'mongodb';
import { GoogleGenAI } from '@google/genai';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--limit') || '7000');
const MODEL = 'gemini-3.1-flash-lite-preview';

const PROMPT = `Classify this artwork using Iconclass codes (iconclass.org). Return 2-5 codes, most specific first.

Iconclass top-level: 0=Abstract, 1=Religion/Magic, 2=Nature, 3=Human Being, 4=Society, 5=Ideas, 6=History, 7=Bible, 8=Literature, 9=Classical Myth.
Key branches: 11H=saints, 14=astrology, 25F=animals, 25FF=fabulous, 31A=human figure, 48C=emblems/allegories, 49E39=alchemy, 61B2=personifications, 71=Old Testament, 73=New Testament, 83=Greek/Roman lit, 92=classical gods, 97=Ovid.
Use parenthetical qualifiers: 25F23(LION), 92B1(+Bacchus).

ARTWORK: {title} by {author} ({year}). {type}. {genre}.
Existing tags: figures={figures}, symbols={symbols}.

Return ONLY a JSON array of code strings. Example: ["49E39","25FF41","48C901"]`;

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // Find artworks without iconclass codes
  const artworks = await db.collection('books')
    .find({
      resource_type: { $exists: true },
      enrichment: { $exists: true },
      $or: [
        { 'enrichment.iconclass': { $exists: false } },
        { 'enrichment.iconclass': { $size: 0 } },
      ],
    }, {
      projection: {
        _id: 1, id: 1, slug: 1, title: 1, author: 1, published: 1,
        resource_type: 1, medium: 1,
        enrichment: 1,
        thumbnail_blob: 1, thumbnail: 1, commons_full_url: 1,
      },
    })
    .limit(LIMIT)
    .toArray();

  console.log(`${DRY_RUN ? 'DRY RUN — ' : ''}Processing ${artworks.length} artworks with ${MODEL}\n`);

  let success = 0, errors = 0, totalTokens = 0;

  for (let i = 0; i < artworks.length; i++) {
    const art = artworks[i];
    const label = `[${i + 1}/${artworks.length}] ${art.author} — ${(art.title || '').substring(0, 45)}`;

    try {
      const imageUrl = art.thumbnail_blob || art.thumbnail || art.commons_full_url;
      if (!imageUrl) {
        console.log(`${label} — SKIP: no image`);
        errors++;
        continue;
      }

      // Build a concise prompt with existing enrichment context
      const enr = art.enrichment || {};
      const prompt = PROMPT
        .replace('{title}', art.title || 'Unknown')
        .replace('{author}', art.author || 'Unknown')
        .replace('{year}', art.published || '?')
        .replace('{type}', art.resource_type || '?')
        .replace('{genre}', enr.genre || '?')
        .replace('{figures}', (enr.figures_depicted || []).join(', ') || 'none')
        .replace('{symbols}', (enr.symbols || []).join(', ') || 'none');

      // Fetch image
      const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
      if (!imgRes.ok) {
        console.log(`${label} — SKIP: image fetch ${imgRes.status}`);
        errors++;
        continue;
      }
      const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
      const mimeType = imageUrl.includes('.png') ? 'image/png' : 'image/jpeg';

      const result = await genai.models.generateContent({
        model: MODEL,
        contents: [{
          parts: [
            { text: prompt },
            { inlineData: { mimeType, data: imgBuffer.toString('base64') } },
          ],
        }],
        config: { temperature: 0.1, maxOutputTokens: 256 },
      });

      const text = result.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      totalTokens += (result.usageMetadata?.totalTokenCount || 500);

      // Parse
      const match = text.match(/\[[\s\S]*\]/);
      if (!match) {
        console.log(`${label} — SKIP: no JSON array`);
        errors++;
        continue;
      }

      const codes = JSON.parse(match[0]).filter(c => typeof c === 'string' && c.length > 0);
      if (codes.length === 0) {
        console.log(`${label} — SKIP: empty codes`);
        errors++;
        continue;
      }

      console.log(`${label} — ${codes.join(', ')}`);
      success++;

      if (!DRY_RUN) {
        await db.collection('books').updateOne(
          { _id: art._id },
          {
            $set: {
              'enrichment.iconclass': codes,
              'enrichment.iconclass_source': 'gemini',
              updated_at: new Date(),
            },
          }
        );
      }

      // Rate limit: ~1s between calls
      await new Promise(r => setTimeout(r, 800));
    } catch (err) {
      console.log(`${label} — ERROR: ${err.message?.substring(0, 80)}`);
      errors++;
      if (err.message?.includes('429') || err.message?.includes('quota')) {
        console.log('  Rate limited — waiting 30s...');
        await new Promise(r => setTimeout(r, 30000));
      } else {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Success: ${success}/${artworks.length}`);
  console.log(`Errors: ${errors}`);
  console.log(`Total tokens: ${totalTokens.toLocaleString()}`);
  const cost = totalTokens * 0.000000075; // Flash Lite blended
  console.log(`Estimated cost: $${cost.toFixed(4)}`);

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
