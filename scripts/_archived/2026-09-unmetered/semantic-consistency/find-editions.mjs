#!/usr/bin/env node
/**
 * Find related editions using semantic embeddings.
 *
 * For each book, embeds a representative sample of pages (first 3 text pages)
 * and computes a "book fingerprint" — the mean embedding vector. Books with
 * high cosine similarity between fingerprints are likely editions of the same work.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/semantic-consistency/find-editions.mjs
 *
 *   Options:
 *     --limit N          Max books to fingerprint (default: 200)
 *     --threshold T      Cosine similarity threshold for "same work" (default: 0.92)
 *     --pages-per-book N Pages to sample per book (default: 3)
 *     --verify           Cross-check against existing work_ids
 *     --apply            Write discovered work_ids to DB (dry-run by default)
 */

import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';

const EMBEDDING_MODEL = 'gemini-embedding-001';
const BATCH_SIZE = 5;

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return args[idx + 1];
}
const hasFlag = (name) => args.includes(`--${name}`);

const LIMIT = parseInt(getArg('limit') || '200', 10);
const THRESHOLD = parseFloat(getArg('threshold') || '0.92');
const PAGES_PER_BOOK = parseInt(getArg('pages-per-book') || '3', 10);
const VERIFY = hasFlag('verify');
const APPLY = hasFlag('apply');

// ── Setup ───────────────────────────────────────────────────────────────────
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) { console.error('GEMINI_API_KEY not set'); process.exit(1); }
const genai = new GoogleGenerativeAI(apiKey);

// ── Math ────────────────────────────────────────────────────────────────────
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function meanVector(vectors) {
  if (vectors.length === 0) return null;
  const dim = vectors[0].length;
  const result = new Float64Array(dim);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) result[i] += v[i];
  }
  for (let i = 0; i < dim; i++) result[i] /= vectors.length;
  return Array.from(result);
}

function stripAnnotations(text) {
  return text
    .replace(/<(?:meta|language|page-type|page-num|header|sig|folio|warning)>[\s\S]*?<\/(?:meta|language|page-type|page-num|header|sig|folio|warning)>/g, '')
    .replace(/<\/?[a-z-]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Embedding ───────────────────────────────────────────────────────────────
async function embedTexts(texts) {
  const model = genai.getGenerativeModel({ model: EMBEDDING_MODEL });
  const results = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const requests = batch.map(text => ({
      content: { role: 'user', parts: [{ text: text.slice(0, 8000) }] },
    }));

    try {
      const response = await model.batchEmbedContents({ requests });
      for (const emb of response.embeddings) results.push(emb.values);
    } catch {
      for (const req of requests) {
        try {
          const single = await model.embedContent(req);
          results.push(single.embedding.values);
        } catch { results.push(null); }
      }
    }

    if (i + BATCH_SIZE < texts.length) await new Promise(r => setTimeout(r, 200));
  }
  return results;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  const db = client.db('bookstore');
  console.log('Connected to MongoDB');

  // Get books with translated pages, sorted by pages_translated desc
  const books = await db.collection('books')
    .find({ pages_translated: { $gte: 5 }, hidden: { $ne: true } })
    .project({ id: 1, title: 1, display_title: 1, author: 1, language: 1, year: 1, work_id: 1 })
    .sort({ pages_translated: -1 })
    .limit(LIMIT)
    .toArray();

  console.log(`Fingerprinting ${books.length} books (${PAGES_PER_BOOK} pages each, threshold ${THRESHOLD})\n`);

  // ── Phase 1: Compute book fingerprints ────────────────────────────────
  const fingerprints = []; // { bookId, title, author, year, work_id, vector }

  for (let b = 0; b < books.length; b++) {
    const book = books[b];
    const title = (book.display_title || book.title || 'Unknown').slice(0, 60);
    process.stdout.write(`[${b + 1}/${books.length}] ${title}... `);

    // Get first N text pages (skip title pages, blanks, etc.)
    const pages = await db.collection('pages').find(
      {
        book_id: book.id,
        'ocr.data': { $exists: true, $ne: '' },
        page_type: { $nin: ['title-page', 'blank', 'frontispiece', 'toc'] },
      },
      { projection: { 'ocr.data': 1 } }
    ).sort({ page_number: 1 }).skip(2).limit(PAGES_PER_BOOK).toArray();

    if (pages.length === 0) { console.log('no pages'); continue; }

    const texts = pages.map(p => stripAnnotations(p.ocr.data));
    const embeddings = (await embedTexts(texts)).filter(e => e !== null);

    if (embeddings.length === 0) { console.log('embed failed'); continue; }

    const vector = meanVector(embeddings);
    fingerprints.push({
      bookId: book.id,
      title: book.display_title || book.title,
      author: book.author,
      year: book.year,
      language: book.language,
      work_id: book.work_id || null,
      vector,
    });

    console.log('OK');
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\nFingerprinted ${fingerprints.length} books\n`);

  // ── Phase 2: Find similar pairs ───────────────────────────────────────
  console.log(`Finding pairs above ${THRESHOLD} similarity...\n`);

  const pairs = [];
  for (let i = 0; i < fingerprints.length; i++) {
    for (let j = i + 1; j < fingerprints.length; j++) {
      const sim = cosineSimilarity(fingerprints[i].vector, fingerprints[j].vector);
      if (sim >= THRESHOLD) {
        pairs.push({ a: fingerprints[i], b: fingerprints[j], similarity: sim });
      }
    }
  }

  pairs.sort((a, b) => b.similarity - a.similarity);

  console.log(`Found ${pairs.length} similar pairs\n`);

  // ── Phase 3: Group into clusters (union-find) ─────────────────────────
  const parent = {};
  function find(x) { return parent[x] === x ? x : (parent[x] = find(parent[x])); }
  function union(x, y) { parent[find(x)] = find(y); }

  for (const fp of fingerprints) parent[fp.bookId] = fp.bookId;
  for (const { a, b } of pairs) union(a.bookId, b.bookId);

  // Build clusters
  const clusters = {};
  for (const fp of fingerprints) {
    const root = find(fp.bookId);
    if (!clusters[root]) clusters[root] = [];
    clusters[root].push(fp);
  }

  const multiClusters = Object.values(clusters).filter(c => c.length > 1);
  multiClusters.sort((a, b) => b.length - a.length);

  console.log(`── ${multiClusters.length} Work Clusters Discovered ──\n`);

  for (let c = 0; c < multiClusters.length; c++) {
    const cluster = multiClusters[c];
    const existingWorkIds = [...new Set(cluster.map(b => b.work_id).filter(Boolean))];

    console.log(`Cluster ${c + 1} (${cluster.length} editions)${existingWorkIds.length ? ' [existing work_id: ' + existingWorkIds.join(', ') + ']' : ' [NEW]'}:`);

    for (const book of cluster) {
      const yearStr = book.year ? ` (${book.year})` : '';
      const langStr = book.language ? ` [${book.language}]` : '';
      const wid = book.work_id ? ` work_id=${book.work_id}` : '';
      console.log(`  - ${(book.title || 'Unknown').slice(0, 70)}${yearStr}${langStr}${wid}`);
    }

    // Show pairwise similarities within cluster
    if (cluster.length <= 5) {
      for (let i = 0; i < cluster.length; i++) {
        for (let j = i + 1; j < cluster.length; j++) {
          const sim = cosineSimilarity(cluster[i].vector, cluster[j].vector);
          console.log(`    ${cluster[i].title?.slice(0, 30)} ↔ ${cluster[j].title?.slice(0, 30)}: ${sim.toFixed(4)}`);
        }
      }
    }
    console.log();
  }

  // ── Verification against existing work_ids ────────────────────────────
  if (VERIFY) {
    console.log('── Verification ──\n');

    // Check: do books with the same work_id cluster together?
    let correctPairs = 0, missedPairs = 0, falsePairs = 0;

    for (const { a, b } of pairs) {
      if (a.work_id && b.work_id) {
        if (a.work_id === b.work_id) correctPairs++;
        else falsePairs++;
      }
    }

    // Find pairs that share work_id but weren't detected
    const fpMap = Object.fromEntries(fingerprints.map(f => [f.bookId, f]));
    const workGroups = {};
    for (const fp of fingerprints) {
      if (fp.work_id) {
        if (!workGroups[fp.work_id]) workGroups[fp.work_id] = [];
        workGroups[fp.work_id].push(fp);
      }
    }

    for (const [wid, group] of Object.entries(workGroups)) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const sim = cosineSimilarity(group[i].vector, group[j].vector);
          if (sim < THRESHOLD) {
            missedPairs++;
            console.log(`  MISSED (${sim.toFixed(3)}): ${group[i].title?.slice(0, 40)} ↔ ${group[j].title?.slice(0, 40)} [${wid}]`);
          }
        }
      }
    }

    console.log(`\n  Correct pairs (same work_id, high sim): ${correctPairs}`);
    console.log(`  Missed pairs (same work_id, low sim): ${missedPairs}`);
    console.log(`  False pairs (diff work_id, high sim): ${falsePairs}`);
  }

  // ── Save results ──────────────────────────────────────────────────────
  const outputPath = new URL('./edition-clusters.json', import.meta.url).pathname;
  const fs = await import('fs');
  fs.writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    config: { limit: LIMIT, threshold: THRESHOLD, pagesPerBook: PAGES_PER_BOOK },
    stats: { booksFingerprinted: fingerprints.length, pairsFound: pairs.length, clustersFound: multiClusters.length },
    clusters: multiClusters.map(cluster => ({
      size: cluster.length,
      existingWorkIds: [...new Set(cluster.map(b => b.work_id).filter(Boolean))],
      books: cluster.map(b => ({ bookId: b.bookId, title: b.title, author: b.author, year: b.year, language: b.language, work_id: b.work_id })),
    })),
    pairs: pairs.map(({ a, b, similarity }) => ({
      bookA: a.bookId, titleA: a.title,
      bookB: b.bookId, titleB: b.title,
      similarity,
    })),
  }, null, 2));
  console.log(`Results saved to ${outputPath}`);

  await client.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
