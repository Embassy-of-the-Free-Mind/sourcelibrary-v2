#!/usr/bin/env node
/**
 * Backfill artwork_embeddings table on Supabase.
 *
 * Composes rich text from artwork enrichment metadata (description, subjects,
 * figures, symbols, inscriptions, museum_description) and embeds via Gemini.
 *
 * Separate from book embeddings — artwork embedding text is structured differently
 * (visual metadata vs chapter/vocabulary data).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/migration/backfill-artwork-embeddings.mjs [--incremental] [--dry-run] [--limit=100]
 */
import { MongoClient } from 'mongodb';
import pg from 'pg';

const INCREMENTAL = process.argv.includes('--incremental');
const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0') || 0;
const BATCH_SIZE = 50;

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = 'gemini-embedding-2-preview';
const MONGODB_URI = process.env.MONGODB_URI;
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function composeArtworkEmbeddingText(art) {
  const parts = [];
  const title = art.display_title || art.title || 'Untitled';
  parts.push(`${title} by ${art.author || 'Unknown artist'}`);

  const e = art.enrichment;
  if (e?.description) parts.push(e.description);
  if (e?.subject && e.subject !== e.description) parts.push(e.subject);
  if (e?.significance) parts.push(e.significance);
  if (e?.museum_description) parts.push(e.museum_description);

  if (!e?.description && art.commons_description) parts.push(art.commons_description.slice(0, 500));
  if (!e?.description && art.description) parts.push(art.description.slice(0, 500));

  const figures = e?.figures_depicted || [];
  if (figures.length > 0) parts.push(`Figures: ${figures.join(', ')}`);
  const symbols = e?.symbols || [];
  if (symbols.length > 0) parts.push(`Symbols: ${symbols.join(', ')}`);
  const iconclass = e?.iconclass || [];
  if (iconclass.length > 0) parts.push(`Iconclass: ${iconclass.join(', ')}`);

  if (e?.aat_technique) parts.push(`Technique: ${e.aat_technique}`);
  if (e?.aat_material) parts.push(`Material: ${e.aat_material}`);
  if (art.medium) parts.push(`Medium: ${art.medium}`);
  if (e?.period) parts.push(`Period: ${e.period}`);
  if (e?.culture) parts.push(`Culture: ${e.culture}`);
  if (e?.genre) parts.push(`Genre: ${e.genre}`);

  if (e?.inscriptions) parts.push(`Inscriptions: ${e.inscriptions.slice(0, 300)}`);

  const colls = (art.collections || []).filter(c => c !== 'visual-art').map(c => c.replace(/-/g, ' '));
  if (colls.length > 0) parts.push(`Collections: ${colls.join(', ')}`);

  if (art.commons_categories) {
    const cats = typeof art.commons_categories === 'string'
      ? art.commons_categories.split('|').map(c => c.trim()).filter(Boolean).slice(0, 15)
      : Array.isArray(art.commons_categories) ? art.commons_categories.slice(0, 15) : [];
    if (cats.length > 0) parts.push(`Subjects: ${cats.join(', ')}`);
  }

  if (e?.cross_references?.length > 0) {
    parts.push(`Related texts: ${e.cross_references.map(r => r.text_or_author).join(', ')}`);
  }

  return parts.join('\n').slice(0, 8000);
}

async function embedBatch(texts) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:batchEmbedContents?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: texts.map(text => ({
          model: `models/${GEMINI_MODEL}`,
          content: { parts: [{ text }] },
          taskType: 'RETRIEVAL_DOCUMENT',
        })),
      }),
      signal: AbortSignal.timeout(30000),
    }
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text().catch(() => '')}`);
  const data = await res.json();
  return data.embeddings.map(e => e.values);
}

async function main() {
  if (!GEMINI_KEY || !MONGODB_URI || !SUPABASE_DB_URL) {
    console.error('Missing env vars'); process.exit(1);
  }

  const mongo = new MongoClient(MONGODB_URI);
  await mongo.connect();
  const db = mongo.db('bookstore');

  const pgClient = new pg.Client({ connectionString: SUPABASE_DB_URL });
  await pgClient.connect();

  // Get artworks
  const artworks = await db.collection('books').find(
    { content_type: 'artwork', visible: true },
    { projection: {
      id: 1, title: 1, display_title: 1, author: 1, description: 1, summary: 1,
      enrichment: 1, commons_description: 1, commons_categories: 1,
      collections: 1, resource_type: 1, medium: 1, thumbnail: 1, thumbnail_blob: 1,
      wikidata_artist: 1,
    }}
  ).toArray();

  console.log(`Found ${artworks.length} artworks`);

  let toProcess = artworks;
  if (INCREMENTAL) {
    const { rows } = await pgClient.query('SELECT book_id FROM artwork_embeddings');
    const existing = new Set(rows.map(r => r.book_id));
    toProcess = artworks.filter(a => !existing.has(a.id));
    console.log(`${existing.size} already embedded, ${toProcess.length} to process`);
  }

  if (LIMIT) toProcess = toProcess.slice(0, LIMIT);
  if (DRY_RUN) { console.log(`Dry run: would embed ${toProcess.length}`); await pgClient.end(); await mongo.close(); return; }

  let embedded = 0, errors = 0;
  const startTime = Date.now();

  for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
    const batch = toProcess.slice(i, i + BATCH_SIZE);
    const texts = batch.map(a => composeArtworkEmbeddingText(a));

    try {
      const embeddings = await embedBatch(texts);

      for (let idx = 0; idx < batch.length; idx++) {
        const art = batch[idx];
        const e = art.enrichment || {};
        await pgClient.query(`
          INSERT INTO artwork_embeddings (book_id, title, display_title, author, summary_text,
            subjects, figures, symbols, iconclass, technique, material, style, period, culture,
            genre, ulan_artist, collections, embedding, resource_type, thumbnail_url, updated_at,
            embedding_model, visible)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,now(),$21,true)
          ON CONFLICT (book_id) DO UPDATE SET
            summary_text=EXCLUDED.summary_text, embedding=EXCLUDED.embedding,
            subjects=EXCLUDED.subjects, figures=EXCLUDED.figures, symbols=EXCLUDED.symbols,
            iconclass=EXCLUDED.iconclass, technique=EXCLUDED.technique, material=EXCLUDED.material,
            style=EXCLUDED.style, period=EXCLUDED.period, culture=EXCLUDED.culture,
            genre=EXCLUDED.genre, ulan_artist=EXCLUDED.ulan_artist, collections=EXCLUDED.collections,
            display_title=EXCLUDED.display_title, thumbnail_url=EXCLUDED.thumbnail_url,
            embedding_model=EXCLUDED.embedding_model, visible=true, updated_at=now()
        `, [
          art.id, art.title, art.display_title || art.title, art.author, texts[idx],
          e.figures_depicted || [], e.figures_depicted || [], e.symbols || [],
          e.iconclass || [], e.aat_technique || null, e.aat_material || null,
          e.aat_style || null, e.period || null, e.culture || null,
          e.genre || art.resource_type || null,
          art.wikidata_artist?.ulan_id ? parseInt(art.wikidata_artist.ulan_id) : (e.ulan_artist || null),
          art.collections || [], JSON.stringify(embeddings[idx]),
          art.resource_type || null, art.thumbnail_blob || art.thumbnail || null,
          'gemini-embedding-2-preview',
        ]);
      }
      embedded += batch.length;
    } catch (e) {
      errors++;
      console.log(`  Batch error: ${e.message?.substring(0, 80)}`);
    }

    if ((i + BATCH_SIZE) % 500 === 0 || i + BATCH_SIZE >= toProcess.length) {
      const rate = embedded / ((Date.now() - startTime) / 1000);
      const left = Math.round((toProcess.length - i - BATCH_SIZE) / Math.max(rate, 0.1));
      console.log(`  ${Math.min(i + BATCH_SIZE, toProcess.length)}/${toProcess.length} — ${embedded} embedded (${rate.toFixed(1)}/s, ~${left}s left, ${errors} errors)`);
    }
    await sleep(100);
  }

  console.log(`\nDone. ${embedded} embedded, ${errors} errors.`);
  await pgClient.end();
  await mongo.close();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
