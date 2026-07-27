#!/usr/bin/env node
/**
 * Spike: rich book embedding A/B on a single book.
 *
 * Target: Della Porta's "De Humana Physiognomonia" (slug: de-humana-physiognomonia-libri-iv-porta).
 *
 * NOTE: any results recorded from a run of this spike BEFORE 2026-07-27 compared
 * two composers that both read `.name` on people/places/concepts (the extractor
 * writes `.term`) and keyed topics on the near-absent `entries` field. Both arms
 * were therefore missing every entity and term signal — the measured lift was
 * between two degraded texts. Both composers are fixed below; re-run before
 * citing any prior numbers.
 *
 * Compares three embedding text compositions:
 *   1. CURRENT  — what enrich-worker writes today
 *   2. RICH     — + reading_summary + section summaries + section quotes + themes
 *   3. RICH+LLM — + LLM-condensed roll-up of page summaries (for the size problem)
 *
 * For each composition, embeds the text, then for a battery of niche physiognomy
 * queries, computes:
 *   - cosine similarity (this book vs. query)
 *   - rank of this book in the current production book_embeddings (where does
 *     the book actually appear today?)
 *   - rank the book WOULD have if we used the rich embedding (rough — we
 *     compare rich-cosine against the top-N production similarities)
 *
 * Output: per-query table showing the lift.
 *
 *   set -a; source ../../../../.env.production.local; set +a
 *   node scripts/eval/librarian-search/_spike-rich-embedding.mjs
 */

import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';
import { composeBookEmbeddingText } from '../../lib/book-embedding-text.mjs';

const TARGET_SLUG = 'de-humana-physiognomonia-libri-iv-porta';

const QUERIES = [
  'facial features and character',
  'reading the face for moral disposition',
  'lion features and bravery',
  'nose shape and temperament',
  'physiognomy of women and men compared',
  'animal analogies for human personality',
  'forehead lines and intellect',
  // For sanity: queries about other books should NOT pull physiognomy up
  'transmutation of metals into gold',
  'planetary correspondences in talismans',
];

// ── Setup ─────────────────────────────────────────────────────────────

const mongoUri = process.env.MONGODB_URI;
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const geminiKey = process.env.GEMINI_API_KEY;
if (!mongoUri || !supabaseUrl || !supabaseKey || !geminiKey) {
  console.error('Missing env. Source .env.production.local first.');
  process.exit(1);
}

const mongo = new MongoClient(mongoUri);
const supabase = createClient(supabaseUrl, supabaseKey);
const ai = new GoogleGenAI({ apiKey: geminiKey });

// ── Embedding fn ──────────────────────────────────────────────────────

async function embed(text, dims = 768) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2-preview:batchEmbedContents?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          model: 'models/gemini-embedding-2-preview',
          content: { parts: [{ text: text.slice(0, 8000) }] },
          outputDimensionality: dims,
        }],
      }),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!res.ok) throw new Error(`embed ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.embeddings[0].values;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ── Text compositions ────────────────────────────────────────────────

// The CURRENT arm IS production — import it rather than re-typing it, so the
// baseline can never drift from what the worker actually writes.
const composeCurrent = composeBookEmbeddingText;

/**
 * Topic + entity lines for the RICH arm. Deliberately reuses production's
 * composer for this block so the A/B measures the fields RICH adds
 * (reading_summary, section text, quotes) and not a composer difference.
 */
function pushTermLines(parts, indexData) {
  const shared = composeBookEmbeddingText({ title: '', author: '' }, indexData).split('\n');
  for (const line of shared) {
    if (/^(Topics|People|Places|Concepts): /.test(line)) parts.push(line);
  }
}

function composeRich(book, indexData) {
  // Start from current, add reading_summary + section summaries (with full
  // summary text, not just title) + section quotes + themes.
  const parts = [];
  parts.push(`${book.display_title || book.title || 'Untitled'} by ${book.author || 'Unknown'}`);
  if (book.language) parts.push(`Language: ${book.language}`);
  if (book.published) parts.push(`Published: ${book.published}`);

  // NEW: reading_summary — currently ignored by enrich-worker
  if (book.reading_summary?.detailed) parts.push(book.reading_summary.detailed);
  else if (book.reading_summary?.overview) parts.push(book.reading_summary.overview);
  if (book.reading_summary?.themes?.length > 0) {
    parts.push(`Themes: ${book.reading_summary.themes.join('; ')}`);
  }

  if (indexData?.bookSummary?.detailed) parts.push(indexData.bookSummary.detailed);

  // NEW: full section summaries with summary text (not just titles)
  if (indexData?.sectionSummaries?.length > 0) {
    const sectionBlock = indexData.sectionSummaries
      .map(s => `[${s.title || ''}] ${s.summary || ''}`)
      .join('\n');
    parts.push(sectionBlock);

    // NEW: section quotes — curated passage text
    const quotes = indexData.sectionSummaries
      .flatMap(s => s.quotes || [])
      .map(q => q.text)
      .filter(Boolean);
    if (quotes.length > 0) {
      parts.push(`Quoted passages: ${quotes.join(' / ')}`);
    }
  }

  pushTermLines(parts, indexData);
  if (book.categories?.length > 0) parts.push(`Categories: ${book.categories.join(', ')}`);
  return parts.join('\n').slice(0, 8000);
}

async function composeRichWithRollup(book, indexData) {
  const richBase = composeRich(book, indexData);

  // Page summaries → LLM-condensed retrieval fingerprint.
  const pageSummaries = (indexData?.pageSummaries || []).map(p => p.summary || '').filter(Boolean);
  if (pageSummaries.length === 0) return richBase;

  const pageBlock = pageSummaries.join('\n');
  if (pageBlock.length < 400) {
    return (richBase + '\n' + pageBlock).slice(0, 8000);
  }

  const prompt = `You are creating a retrieval fingerprint for a book. Below are page-level summaries.
Condense them into a dense, retrieval-friendly representation of EVERYTHING distinctive
the book contains: every named person, place, concept, technical term, comparison, example,
and recurring metaphor. Prioritize specific vocabulary over generic description. List the
distinctive terms and phrases that appear. Do NOT add interpretation or assessment. Output
plain text, up to 600 words.

PAGE SUMMARIES:
${pageBlock.slice(0, 30000)}`;

  const resp = await ai.models.generateContent({
    model: 'gemini-3.1-flash-lite',
    contents: prompt,
    config: { temperature: 0.2 },
  });
  const condensed = resp.text?.trim() || '';
  return (richBase + '\n\nContent fingerprint:\n' + condensed).slice(0, 8000);
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  await mongo.connect();
  const db = mongo.db('bookstore');

  const book = await db.collection('books').findOne({ slug: TARGET_SLUG });
  if (!book) {
    console.error(`Book not found: ${TARGET_SLUG}`);
    process.exit(1);
  }
  const indexData = await db.collection('book_indexes').findOne({ book_id: book.id });

  console.log(`\nTarget: "${book.display_title || book.title}" by ${book.author}`);
  console.log(`  pages: ${book.pages_translated}/${book.pages_count} translated`);
  console.log(`  has reading_summary: ${!!book.reading_summary?.detailed}`);
  console.log(`  has book_index: ${!!indexData}`);
  console.log(`  has sectionSummaries: ${(indexData?.sectionSummaries?.length || 0) > 0}`);
  console.log(`  has pageSummaries: ${(indexData?.pageSummaries?.length || 0) > 0} (${indexData?.pageSummaries?.length || 0} pages)`);

  console.log('\nComposing text variants...');
  const currentText = composeCurrent(book, indexData);
  const richText = composeRich(book, indexData);
  console.log('  Calling LLM for page-summary roll-up...');
  const richRollupText = await composeRichWithRollup(book, indexData);

  console.log(`\nText sizes:`);
  console.log(`  current   : ${currentText.length} chars`);
  console.log(`  rich      : ${richText.length} chars  (+${richText.length - currentText.length})`);
  console.log(`  rich+llm  : ${richRollupText.length} chars`);

  // Show what got added (rich - current diff, abbreviated)
  console.log(`\n=== Sample of what RICH adds (first 600 chars new content) ===`);
  // Find content in rich not in current
  const newInRich = richText.split('\n').filter(line => !currentText.includes(line) && line.trim().length > 0).join('\n');
  console.log(newInRich.slice(0, 600));

  // Embed all three
  console.log('\nEmbedding variants...');
  const embCurrent = await embed(currentText);
  const embRich = await embed(richText);
  const embRichRollup = await embed(richRollupText);

  // Get current production embedding for this book to verify our re-embed of "current" matches
  const { data: prodRow } = await supabase
    .from('book_embeddings')
    .select('book_id, summary_text, embedding')
    .eq('book_id', book.id)
    .limit(1)
    .single();
  let productionMatch = null;
  if (prodRow?.embedding) {
    const prodEmb = JSON.parse(prodRow.embedding);
    productionMatch = cosine(embCurrent, prodEmb);
  }
  console.log(`  Sanity: our 'current' recompute vs production embedding cosine = ${productionMatch?.toFixed(4) || 'n/a'}`);

  // For each query, run the production semantic search and see where this book ranks,
  // then compute cosine for each text variant
  console.log('\n┌─ Per-query lift (cosine sim to target book) ────────────────────────────────┐');
  console.log('│ query                              │ current │ rich   │ rich+llm │ prod-rank│');
  console.log('├────────────────────────────────────┼─────────┼────────┼──────────┼──────────┤');

  for (const query of QUERIES) {
    const qEmb = await embed(query);
    const cCurrent = cosine(qEmb, embCurrent);
    const cRich = cosine(qEmb, embRich);
    const cRichRollup = cosine(qEmb, embRichRollup);

    // Where does this book rank in current production book_embeddings?
    const { data: matches } = await supabase.rpc('match_books_semantic', {
      query_embedding: JSON.stringify(qEmb),
      match_threshold: 0.0,
      match_count: 100,
      filter_language: null,
      filter_year_min: null,
      filter_year_max: null,
    });
    const rank = (matches || []).findIndex(m => m.book_id === book.id);
    const rankStr = rank === -1 ? '>100' : String(rank + 1);

    const q = query.length > 36 ? query.slice(0, 33) + '...' : query.padEnd(36);
    console.log(`│ ${q.padEnd(34)} │  ${cCurrent.toFixed(3)}  │ ${cRich.toFixed(3)}  │  ${cRichRollup.toFixed(3)}   │   ${rankStr.padEnd(6)} │`);
  }
  console.log('└──────────────────────────────────────────────────────────────────────────────┘');

  await mongo.close();
}

main().catch(err => { console.error(err); process.exit(1); });
