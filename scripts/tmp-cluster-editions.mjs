#!/usr/bin/env node
/**
 * Multi-signal edition clustering — finds books that are editions of the same work
 * and proposes work_id assignments.
 *
 * Signals:
 *   1. Semantic similarity (embedding cosine distance)
 *   2. Title similarity (trigram / Levenshtein)
 *   3. Author similarity (normalized fuzzy match)
 *   4. Year proximity
 *   5. Language match
 *
 * Usage:
 *   DRY_RUN=1 node scripts/tmp-cluster-editions.mjs        # report only (default)
 *   DRY_RUN=0 node scripts/tmp-cluster-editions.mjs        # write work_id to MongoDB
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { MongoClient } from 'mongodb';

const DRY_RUN = process.env.DRY_RUN !== '0';
const SEMANTIC_THRESHOLD = 0.90;  // pre-filter: only consider pairs above this
const AUTO_THRESHOLD = 0.90;      // auto-apply: slam dunks only
const REVIEW_THRESHOLD = 0.75;    // review list: needs human check
const BATCH_SIZE = 50;            // RPC calls per batch

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ── String similarity ──────────────────────────────────────────────
function trigrams(s) {
  const padded = `  ${s.toLowerCase().trim()}  `;
  const set = new Set();
  for (let i = 0; i < padded.length - 2; i++) set.add(padded.slice(i, i + 3));
  return set;
}

// Strip parenthetical edition markers, dates, and library shelfmarks before comparing
function normalizeTitle(s) {
  if (!s) return '';
  return s
    .toLowerCase()
    .replace(/\(.*?\)/g, '')                  // (1485 editio princeps), (De Sphaera), etc.
    .replace(/\[.*?\]/g, '')                  // [BPH 131], [MS], etc.
    .replace(/\b\d{4}\b/g, '')               // standalone years
    .replace(/\b(ms|vol|tome?|part|book|bd|t)\b\.?\s*/gi, '')
    .replace(/[,.:;]+\s*$/, '')              // trailing punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

function trigramSimilarity(a, b) {
  if (!a || !b) return 0;
  // Compare both raw and normalized, take the higher score
  const rawA = trigrams(a), rawB = trigrams(b);
  let rawInter = 0;
  for (const t of rawA) if (rawB.has(t)) rawInter++;
  const rawScore = rawInter / (rawA.size + rawB.size - rawInter);

  const normA = normalizeTitle(a), normB = normalizeTitle(b);
  if (!normA || !normB) return rawScore;
  const nta = trigrams(normA), ntb = trigrams(normB);
  let normInter = 0;
  for (const t of nta) if (ntb.has(t)) normInter++;
  const normScore = normInter / (nta.size + ntb.size - normInter);

  return Math.max(rawScore, normScore);
}

function normalizeAuthor(author) {
  if (!author) return '';
  return author
    .toLowerCase()
    .replace(/\(.*?\)/g, '')         // remove parentheticals
    .replace(/\b(ed\.|tr\.|trans\.?|translator|editor)\b/gi, '')
    .replace(/[^a-z\s]/g, '')        // strip punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

function authorSimilarity(a, b) {
  const na = normalizeAuthor(a);
  const nb = normalizeAuthor(b);
  if (!na || !nb) return 0.3; // unknown authors: neutral
  if (na === nb) return 1.0;

  // Check if one contains the other (e.g. "Ficino" in "Marsilio Ficino")
  if (na.includes(nb) || nb.includes(na)) return 0.9;

  // Check if any surname token matches
  const tokensA = na.split(' ');
  const tokensB = nb.split(' ');
  const shared = tokensA.filter(t => t.length > 2 && tokensB.includes(t));
  if (shared.length > 0) return 0.7 + 0.1 * Math.min(shared.length, 3);

  return trigramSimilarity(na, nb);
}

function yearProximity(a, b) {
  if (!a || !b) return 0.5; // unknown: neutral
  const diff = Math.abs(a - b);
  if (diff === 0) return 1.0;
  if (diff <= 10) return 0.95;
  if (diff <= 50) return 0.8;
  if (diff <= 100) return 0.6;
  if (diff <= 200) return 0.4;
  return 0.2;
}

// Detect if two titles differ only by a volume/part number (I vs III, Vol. 1 vs Vol. 2, etc.)
function differsByVolumeOnly(a, b) {
  if (!a || !b) return false;
  const na = a.toLowerCase().trim();
  const nb = b.toLowerCase().trim();
  // Strip trailing volume indicators
  const volPattern = /[\s,.:]+(?:vol\.?\s*|tome?\s*|part\s*|book\s*|t\.\s*|bd\.?\s*)?(?:[ivxlc]+|\d+)\s*(?:\(.*?\))?\s*$/i;
  const strippedA = na.replace(volPattern, '');
  const strippedB = nb.replace(volPattern, '');
  // If stripping the volume marker makes them identical (or near-identical), they differ only by volume
  if (strippedA === strippedB && na !== nb) return true;
  // Also catch "Codex Forster I" vs "Codex Forster III" pattern
  const numPattern = /[\s]+[ivxlc]+\s*$/i;
  const sa = na.replace(numPattern, '');
  const sb = nb.replace(numPattern, '');
  if (sa === sb && na !== nb) return true;
  return false;
}

function compositeScore(semantic, titleSim, authorSim, yearProx, langMatch, titleA, titleB) {
  // Hard gate: title must be somewhat similar — prevents "different works, same author"
  if (titleSim < 0.25) return 0;

  // Reject: titles that differ only by volume/part number (different volumes, not editions)
  if (differsByVolumeOnly(titleA, titleB)) return 0;

  // If titles only match after stripping parentheticals (raw trigram < 0.7 but normalized = 1.0),
  // require strong author match — prevents "Book of Hours (PH 2)" ≠ "Book of Hours (BPH 131)"
  const rawSim = (() => {
    const ta = trigrams(titleA), tb = trigrams(titleB);
    let inter = 0;
    for (const t of ta) if (tb.has(t)) inter++;
    return inter / (ta.size + tb.size - inter);
  })();
  if (rawSim < 0.85 && titleSim >= 0.95 && authorSim < 1.0) return 0;

  // Weighted combination — title is king for edition detection
  return (
    semantic * 0.20 +
    titleSim * 0.40 +
    authorSim * 0.15 +
    yearProx * 0.05 +
    (langMatch ? 0.20 : 0.0)
  );
}

// ── Slug generation ────────────────────────────────────────────────
function generateWorkId(books) {
  // Pick the most common author, shortest meaningful title
  const authors = books.map(b => normalizeAuthor(b.author)).filter(Boolean);
  const authorFreq = {};
  for (const a of authors) {
    const surname = a.split(' ').pop();
    authorFreq[surname] = (authorFreq[surname] || 0) + 1;
  }
  const topAuthor = Object.entries(authorFreq).sort((a, b) => b[1] - a[1])[0]?.[0] || '';

  // Find shortest title among the cluster
  const titles = books.map(b => b.title).filter(Boolean).sort((a, b) => a.length - b.length);
  const shortTitle = titles[0] || 'unknown';

  // Slugify
  const slug = `${topAuthor}-${shortTitle}`
    .toLowerCase()
    .replace(/[()[\]{}"']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

  return slug;
}

// ── Main ───────────────────────────────────────────────────────────
async function main() {
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (report only)' : 'LIVE (will write work_id)'}`);

  const mongo = await MongoClient.connect(process.env.MONGODB_URI);
  const db = mongo.db('bookstore');

  // 1. Get all books WITHOUT work_id that have embeddings
  console.log('\n1. Loading books without work_id...');
  const booksWithoutWorkId = await db.collection('books').find(
    { status: 'published', $or: [{ work_id: { $exists: false } }, { work_id: null }] },
    { projection: { id: 1, title: 1, author: 1, year: 1, language: 1, content_type: 1, pages_count: 1, pages_translated: 1 } }
  ).toArray();
  console.log(`   ${booksWithoutWorkId.length} books without work_id`);

  // Also load books WITH work_id as reference anchors
  const booksWithWorkId = await db.collection('books').find(
    { status: 'published', work_id: { $exists: true, $ne: null } },
    { projection: { id: 1, title: 1, author: 1, year: 1, language: 1, work_id: 1, pages_count: 1, pages_translated: 1 } }
  ).toArray();
  console.log(`   ${booksWithWorkId.length} books already have work_id`);

  const allBooks = new Map();
  for (const b of [...booksWithoutWorkId, ...booksWithWorkId]) {
    allBooks.set(b.id, b);
  }

  // 2. Load embeddings from Supabase
  console.log('\n2. Loading embeddings from Supabase...');
  const embeddings = new Map();
  let offset = 0;
  while (true) {
    const { data, error } = await sb
      .from('book_embeddings')
      .select('book_id, embedding')
      .range(offset, offset + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) {
      const emb = typeof row.embedding === 'string' ? JSON.parse(row.embedding) : row.embedding;
      embeddings.set(row.book_id, emb);
    }
    offset += 1000;
    if (data.length < 1000) break;
  }
  console.log(`   ${embeddings.size} embeddings loaded`);

  // 3. For each unlinked book with an embedding, find neighbors and score
  console.log('\n3. Finding edition clusters...');
  const unlinked = booksWithoutWorkId.filter(b => embeddings.has(b.id));
  console.log(`   ${unlinked.length} unlinked books have embeddings`);

  // Build clusters using union-find
  const parent = new Map();
  function find(x) {
    if (!parent.has(x)) parent.set(x, x);
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)));
    return parent.get(x);
  }
  function union(a, b) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  let pairsChecked = 0;
  let pairsMatched = 0;
  const edgeScores = []; // auto-apply matches
  const reviewEdges = []; // needs human review

  // Process in batches — use Supabase RPC for nearest neighbors
  for (let i = 0; i < unlinked.length; i++) {
    const book = unlinked[i];
    const emb = embeddings.get(book.id);
    if (!emb) continue;

    if (i % 500 === 0 && i > 0) {
      console.log(`   Processed ${i}/${unlinked.length} (${pairsMatched} matches so far)`);
    }

    // Find semantic neighbors
    let neighbors;
    try {
      const { data, error } = await sb.rpc('match_books_semantic', {
        query_embedding: emb,
        match_threshold: SEMANTIC_THRESHOLD,
        match_count: 30
      });
      if (error) { console.log(`   RPC error for ${book.id}: ${error.message}`); continue; }
      neighbors = data;
    } catch (e) { continue; }

    if (!neighbors || neighbors.length <= 1) continue;

    for (const n of neighbors) {
      if (n.book_id === book.id) continue;
      pairsChecked++;

      const other = allBooks.get(n.book_id);
      if (!other) continue;

      // Skip artwork-to-book comparisons
      if (book.content_type === 'artwork' || other.content_type === 'artwork') continue;

      const titleSim = trigramSimilarity(book.title, other.title || n.title);
      const authSim = authorSimilarity(book.author, other.author || n.author);
      const yearProx = yearProximity(book.year, other.year || n.year);
      const langMatch = (book.language || '') === (other.language || n.language || '');
      const score = compositeScore(n.similarity, titleSim, authSim, yearProx, langMatch, book.title, other.title || n.title);

      if (score >= REVIEW_THRESHOLD) {
        const edge = {
          bookA: book.id, bookB: n.book_id,
          a: book.title?.substring(0, 60),
          b: (other.title || n.title)?.substring(0, 60),
          semantic: n.similarity,
          titleSim, authSim, score,
        };

        if (score >= AUTO_THRESHOLD) {
          pairsMatched++;
          union(book.id, n.book_id);
          if (edgeScores.length < 200) edgeScores.push({ ...edge, tier: 'AUTO' });
        } else {
          // Review tier — track but don't union
          if (reviewEdges.length < 200) reviewEdges.push({ ...edge, tier: 'REVIEW' });
        }
      }
    }
  }

  // 4. Collect clusters
  console.log('\n4. Collecting clusters...');
  const clusters = new Map(); // root_id -> [book_ids]
  for (const book of [...booksWithoutWorkId, ...booksWithWorkId]) {
    if (!parent.has(book.id)) continue;
    const root = find(book.id);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(book.id);
  }

  // Filter to multi-book clusters
  const multiClusters = [...clusters.entries()].filter(([, ids]) => ids.length > 1);
  multiClusters.sort((a, b) => b[1].length - a[1].length);

  console.log(`\n══════════════════════════════════════════════`);
  console.log(`RESULTS`);
  console.log(`══════════════════════════════════════════════`);
  console.log(`Pairs checked: ${pairsChecked}`);
  console.log(`Pairs matched: ${pairsMatched}`);
  console.log(`Clusters found: ${multiClusters.length}`);
  console.log(`Books in clusters: ${multiClusters.reduce((s, [, ids]) => s + ids.length, 0)}`);

  // 5. Report clusters
  let newWorkIds = 0;
  let booksToUpdate = 0;
  const updates = []; // { book_id, work_id }

  console.log(`\n── Top clusters ──────────────────────────────\n`);
  for (const [, ids] of multiClusters.slice(0, 50)) {
    const books = ids.map(id => allBooks.get(id)).filter(Boolean);

    // Check if any book in cluster already has a work_id
    const existingWorkId = books.find(b => b.work_id)?.work_id;
    const workId = existingWorkId || generateWorkId(books);

    const needsUpdate = books.filter(b => !b.work_id);
    if (needsUpdate.length === 0) continue;

    console.log(`  ${workId} (${books.length} editions${existingWorkId ? ', extending existing' : ', NEW'}):`);
    for (const b of books) {
      const status = b.work_id ? '  [linked]' : '  [NEW]   ';
      const tr = b.pages_translated > 0 ? ` (${b.pages_translated}pp translated)` : '';
      console.log(`    ${status} ${b.title?.substring(0, 70)}${tr}`);
    }
    console.log();

    for (const b of needsUpdate) {
      updates.push({ book_id: b.id, work_id: workId });
    }
    if (!existingWorkId) newWorkIds++;
    booksToUpdate += needsUpdate.length;
  }

  console.log(`\n══════════════════════════════════════════════`);
  console.log(`SUMMARY`);
  console.log(`══════════════════════════════════════════════`);
  console.log(`New work_id values: ${newWorkIds}`);
  console.log(`Books to update: ${booksToUpdate}`);
  console.log(`Existing clusters extended: ${updates.filter(u => booksWithWorkId.some(b => b.work_id === u.work_id)).length}`);

  // Review list — pairs that scored 0.75-0.90, need human check
  if (reviewEdges.length > 0) {
    console.log(`\n── REVIEW LIST (${reviewEdges.length} pairs, score ${REVIEW_THRESHOLD}–${AUTO_THRESHOLD}) ──\n`);
    // Deduplicate by sorting and showing unique pairs
    const seen = new Set();
    for (const e of reviewEdges) {
      const key = [e.bookA, e.bookB].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`  ${e.score.toFixed(3)} | sem=${e.semantic.toFixed(3)} tit=${e.titleSim.toFixed(3)} aut=${e.authSim.toFixed(3)}`);
      console.log(`    "${e.a}" ↔ "${e.b}"`);
    }
  }

  // Auto-apply edges for reference
  if (edgeScores.length > 0) {
    console.log(`\n── AUTO-APPLY pairs (score ≥ ${AUTO_THRESHOLD}) ──\n`);
    const seen = new Set();
    for (const e of edgeScores.slice(0, 30)) {
      const key = [e.bookA, e.bookB].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`  ${e.score.toFixed(3)} | sem=${e.semantic.toFixed(3)} tit=${e.titleSim.toFixed(3)} aut=${e.authSim.toFixed(3)}`);
      console.log(`    "${e.a}" ↔ "${e.b}"`);
    }
  }

  // 6. Write to MongoDB (if not dry run)
  if (!DRY_RUN && updates.length > 0) {
    console.log(`\n6. Writing ${updates.length} work_id updates to MongoDB...`);
    let written = 0;
    for (const { book_id, work_id } of updates) {
      await db.collection('books').updateOne(
        { id: book_id, $or: [{ work_id: { $exists: false } }, { work_id: null }] },
        { $set: { work_id, updated_at: new Date() } }
      );
      written++;
      if (written % 100 === 0) console.log(`   ${written}/${updates.length}`);
    }
    console.log(`   Done: ${written} books updated`);
  } else if (DRY_RUN) {
    console.log(`\nDry run complete. Set DRY_RUN=0 to apply.`);
  }

  await mongo.close();
}

main().catch(e => { console.error(e); process.exit(1); });
