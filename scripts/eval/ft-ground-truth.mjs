#!/usr/bin/env npx tsx
/**
 * First-Translation Ground-Truth Evaluation
 *
 * Builds an external ground-truth dataset by independently querying 5 catalog
 * APIs for English translations of books in our library. Then runs our
 * verification tool and measures accuracy against this external truth.
 *
 * The ground truth is INDEPENDENT of our tool — it uses deterministic string
 * matching (not LLM interpretation) across multiple sources. If 2+ independent
 * APIs agree a translation exists, that's high-confidence ground truth.
 *
 * Subcommands:
 *   build    — Query external APIs, build ground-truth dataset (~$0, just API calls)
 *   verify   — Run our verification tool on the test set, compare results (~$0.01/book)
 *   report   — Show last evaluation results
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   npx tsx scripts/eval/ft-ground-truth.mjs build [--count 120]
 *   npx tsx scripts/eval/ft-ground-truth.mjs verify
 *   npx tsx scripts/eval/ft-ground-truth.mjs report
 */

import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GROUND_TRUTH_PATH = path.join(__dirname, 'ft-ground-truth.json');
const RESULTS_PATH = path.join(__dirname, 'ft-ground-truth-results.json');

// ── Env loading ──────────────────────────────────────────────────────

function loadEnv() {
  for (const file of ['.env.production.local', '.env.local']) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      for (const line of content.split('\n')) {
        const m = line.match(/^([^=#]+)=(.*)$/);
        if (m) {
          let v = m[2].trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
            v = v.slice(1, -1);
          if (!process.env[m[1].trim()]) process.env[m[1].trim()] = v;
        }
      }
      break;
    } catch { /* next */ }
  }
}

loadEnv();

// ── Helpers ──────────────────────────────────────────────────────────

function normalize(s) {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

function extractSurname(author) {
  // "Ficino, Marsilio" → "ficino"
  // "Marsilio Ficino" → "ficino"
  const norm = normalize(author);
  if (norm.includes(',')) return norm.split(',')[0].trim();
  const parts = norm.split(/\s+/);
  return parts[parts.length - 1];
}

function titleKeywords(title) {
  const stop = new Set(['the','of','and','in','on','a','an','or','de','des','du','le','la','les','von','van','der','das','die','den','het','een','et','pour','par','sur','con','del','della','delle','degli','nei','nella','per','una','il','lo','gli','di']);
  return normalize(title).split(/\s+/).filter(w => w.length > 2 && !stop.has(w));
}

/** Check if a search result looks like an English translation of our book */
function isLikelyTranslation(result, authorSurname, bookTitleKeywords, originalTitle) {
  const resultTitle = normalize(result.title || '');
  const resultText = normalize([result.title, result.subtitle, result.description, result.creator, result.authors].filter(Boolean).join(' '));

  // Author surname must appear
  if (!resultText.includes(authorSurname)) return false;

  // At least 1 title keyword must match
  const kwMatches = bookTitleKeywords.filter(kw => resultText.includes(kw));
  if (kwMatches.length === 0) return false;

  // CRITICAL: Filter out the original text showing up with English metadata.
  // If the result title closely matches the original-language title, it's probably
  // the source text, not a translation. Translations have English titles.
  const origNorm = normalize(originalTitle);
  if (origNorm.length > 10) {
    const origWords = origNorm.split(/\s+/).filter(w => w.length > 3);
    const titleWords = resultTitle.split(/\s+/).filter(w => w.length > 3);
    if (titleWords.length > 0 && origWords.length > 0) {
      const overlapRatio = origWords.filter(w => titleWords.includes(w)).length / Math.max(origWords.length, 1);
      // If >60% of original-language title words appear in result title, it's the original
      if (overlapRatio > 0.6 && !resultText.includes('translat') && !resultText.includes('english')) {
        return false;
      }
    }
  }

  // Results from before 1800 are very unlikely to be English translations of pre-1700 works
  // (unless they're famous like Chapman's Homer). Require a translation signal for old results.
  const resultYear = parseInt(result.year);
  if (resultYear && resultYear < 1800 && !resultText.includes('translat') && !resultText.includes('english')) {
    return false;
  }

  // Must not be obviously about the author (biography, criticism) rather than a translation
  const aboutPatterns = ['biography', 'life and works', 'companion to', 'introduction to the thought', 'critical study', 'a study of', 'reader on', 'guide to'];
  const isAbout = aboutPatterns.some(p => resultText.includes(p));
  if (isAbout && !resultText.includes('translat')) return false;

  // Positive signals (any of these increase confidence):
  const hasTranslationSignal = resultText.includes('translat') || resultText.includes('english') ||
    resultText.includes('rendered into') || resultText.includes('newly englished');

  // If we have no positive signal and the result is ambiguous, skip
  if (!hasTranslationSignal && kwMatches.length < 2) return false;

  return true;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── External API Searches (deterministic, no LLM) ───────────────────

async function searchOpenLibrary(query) {
  try {
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&language=eng&limit=15`;
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.docs || []).map(d => ({
      source: 'open_library',
      title: d.title,
      authors: Array.isArray(d.author_name) ? d.author_name.join(', ') : undefined,
      year: d.first_publish_year,
      publisher: Array.isArray(d.publisher) ? d.publisher[0] : undefined,
      url: d.key ? `https://openlibrary.org${d.key}` : undefined,
    }));
  } catch { return []; }
}

async function searchGoogleBooks(query) {
  try {
    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&langRestrict=en&maxResults=15`;
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items || []).map(item => {
      const v = item.volumeInfo || {};
      return {
        source: 'google_books',
        title: v.title,
        subtitle: v.subtitle,
        authors: Array.isArray(v.authors) ? v.authors.join(', ') : undefined,
        year: v.publishedDate?.slice(0, 4),
        publisher: v.publisher,
        description: typeof v.description === 'string' ? v.description.slice(0, 300) : undefined,
        url: v.infoLink || undefined,
      };
    });
  } catch { return []; }
}

async function searchInternetArchive(query) {
  try {
    const iaQuery = `(${query}) AND language:(eng OR english) AND mediatype:(texts)`;
    const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(iaQuery)}&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=date&fl[]=publisher&fl[]=description&rows=15&output=json&sort=downloads+desc`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.response?.docs || []).map(d => ({
      source: 'internet_archive',
      title: d.title,
      creator: d.creator,
      year: d.date?.slice(0, 4),
      publisher: d.publisher,
      description: Array.isArray(d.description) ? d.description[0]?.slice(0, 300) : typeof d.description === 'string' ? d.description.slice(0, 300) : undefined,
      url: d.identifier ? `https://archive.org/details/${d.identifier}` : undefined,
    }));
  } catch { return []; }
}

async function searchOpenAlex(query) {
  try {
    const params = new URLSearchParams({
      search: query,
      filter: 'language:en',
      per_page: '15',
      mailto: 'derek@sourcelibrary.org',
    });
    const res = await fetch(`https://api.openalex.org/works?${params}`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.results || []).map(w => {
      const authors = (w.authorships || []).map(a => a.author?.display_name).filter(Boolean).join(', ');
      const src = w.primary_location?.source;
      return {
        source: 'openalex',
        title: w.title || w.display_name,
        authors: authors || undefined,
        year: w.publication_year,
        publisher: src?.host_organization_name || src?.display_name,
        description: undefined,
        url: w.doi || w.id || undefined,
      };
    });
  } catch { return []; }
}

async function searchLOC(query) {
  try {
    const params = new URLSearchParams({ q: query, fa: 'language:english', fo: 'json', c: '15' });
    const res = await fetch(`https://www.loc.gov/books/?${params}`, {
      signal: AbortSignal.timeout(15000),
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.content?.results || data.results || []).map(item => ({
      source: 'loc',
      title: item.title,
      authors: Array.isArray(item.contributor) ? item.contributor.join(', ') : undefined,
      year: item.date?.slice(0, 4),
      description: Array.isArray(item.description) ? item.description[0]?.slice(0, 300) : undefined,
      url: item.url || item.id || undefined,
    }));
  } catch { return []; }
}

// ── Build Ground Truth ───────────────────────────────────────────────

async function build(args) {
  const targetCount = parseInt(args.find(a => a.startsWith('--count='))?.split('=')[1] || '120');

  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('bookstore');

  console.log(`\nBuilding ground-truth dataset (target: ${targetCount} books)\n`);

  // ── Step 1: Sample diverse books from our library ──────────────────
  // Stratified by disposition and language, weighted toward the most
  // important test cases (confirmed_first with known authors)
  const strata = [
    // Books where tool said "translation found" — ground truth should agree
    { disposition: 'translation_found', limit: Math.ceil(targetCount * 0.35) },
    // Books where tool said "first" — most important to test for false positives
    { disposition: 'confirmed_first', limit: Math.ceil(targetCount * 0.35) },
    // Edge cases
    { disposition: 'first_complete_translation', limit: Math.ceil(targetCount * 0.12) },
    { disposition: 'first_modern_translation', limit: Math.ceil(targetCount * 0.08) },
    { disposition: 'first_from_source', limit: Math.ceil(targetCount * 0.05) },
    { disposition: 'needs_review', limit: Math.ceil(targetCount * 0.05) },
  ];

  let allBooks = [];
  for (const s of strata) {
    const books = await db.collection('books').aggregate([
      { $match: {
        language: { $in: ['Latin', 'German', 'French', 'Italian', 'Dutch', 'Spanish', 'Portuguese'] },
        author: { $exists: true, $ne: null, $ne: '', $ne: 'Unknown' },
        pages_count: { $gt: 0 },
        'translation_verification.disposition': s.disposition,
        'translation_verification.tools_called': { $exists: true },
      }},
      { $sample: { size: s.limit * 2 } }, // oversample for filtering
    ]).project({
      id: 1, author: 1, title: 1, display_title: 1, language: 1, year: 1,
      is_first_translation: 1,
      'translation_verification.disposition': 1,
      'translation_verification.confidence': 1,
      'translation_verification.reasoning': 1,
      'translation_verification.translations_found': 1,
    }).toArray();

    // Shuffle and take limit
    const shuffled = books.sort(() => Math.random() - 0.5).slice(0, s.limit);
    allBooks.push(...shuffled);
    console.log(`  ${s.disposition}: ${shuffled.length} sampled (${books.length} available)`);
  }

  console.log(`\nTotal books to research: ${allBooks.length}`);
  console.log(`Querying 5 external APIs per book (Open Library, Google Books, Internet Archive, OpenAlex, LOC)...\n`);

  // ── Step 2: Independently research each book via external APIs ─────

  const groundTruth = [];
  const API_DELAY = 500; // ms between books to avoid rate limiting

  for (let i = 0; i < allBooks.length; i++) {
    const book = allBooks[i];
    const author = book.author;
    const title = book.display_title || book.title;
    const surname = extractSurname(author);
    const kws = titleKeywords(title);
    const tv = book.translation_verification || {};

    process.stdout.write(`[${i + 1}/${allBooks.length}] ${author?.slice(0, 25)} — ${title?.slice(0, 40)}...`);

    // Build search queries — try multiple formulations
    const q1 = `${author} ${title} english translation`;
    const q2 = `${surname} ${kws.slice(0, 3).join(' ')} english`;
    const q3 = `${author} ${kws.slice(0, 2).join(' ')}`;

    // Query all 5 APIs in parallel
    const [olResults, gbResults, iaResults, oaResults, locResults] = await Promise.all([
      searchOpenLibrary(q2),
      searchGoogleBooks(q1),
      searchInternetArchive(q3),
      searchOpenAlex(q1),
      searchLOC(q2),
    ]);

    // Combine all results
    const allResults = [...olResults, ...gbResults, ...iaResults, ...oaResults, ...locResults];

    // Deterministic matching: which results look like actual translations?
    const matches = allResults.filter(r => isLikelyTranslation(r, surname, kws, title));

    // Deduplicate by source
    const sourceHits = new Set(matches.map(m => m.source));

    // Ground truth determination:
    // - 2+ independent sources with matching results = high confidence translation exists
    // - 1 source with strong match = medium confidence
    // - 0 sources = no external evidence of translation
    let externalVerdict;
    let externalConfidence;
    if (sourceHits.size >= 3) {
      externalVerdict = 'translation_exists';
      externalConfidence = 'high';
    } else if (sourceHits.size >= 2) {
      externalVerdict = 'translation_exists';
      externalConfidence = 'high';
    } else if (sourceHits.size === 1) {
      externalVerdict = 'translation_likely';
      externalConfidence = 'medium';
    } else {
      externalVerdict = 'no_translation_found';
      externalConfidence = matches.length === 0 ? 'high' : 'low';
    }

    const icon = externalVerdict === 'translation_exists' ? ' FOUND' :
                 externalVerdict === 'translation_likely' ? ' MAYBE' : ' NONE';
    console.log(` ${icon} (${sourceHits.size} sources, ${matches.length} matches, ${allResults.length} total results)`);

    groundTruth.push({
      book_id: book.id,
      author,
      title,
      language: book.language,
      // Our tool's current determination
      tool_disposition: tv.disposition,
      tool_confidence: tv.confidence,
      tool_is_first: book.is_first_translation,
      // External ground truth
      external_verdict: externalVerdict,
      external_confidence: externalConfidence,
      external_sources_with_matches: [...sourceHits],
      external_match_count: matches.length,
      external_total_results: allResults.length,
      // Best matches for review
      top_matches: matches.slice(0, 5).map(m => ({
        source: m.source,
        title: m.title,
        authors: m.authors || m.creator,
        year: m.year,
        publisher: m.publisher,
        url: m.url,
      })),
    });

    if (i < allBooks.length - 1) await sleep(API_DELAY);
  }

  // ── Step 3: Save and summarize ─────────────────────────────────────

  const dataset = {
    metadata: {
      built: new Date().toISOString(),
      total_books: groundTruth.length,
      apis_queried: ['open_library', 'google_books', 'internet_archive', 'openalex', 'loc'],
      matching_method: 'deterministic (author surname + title keywords, no LLM)',
    },
    cases: groundTruth,
  };

  fs.writeFileSync(GROUND_TRUTH_PATH, JSON.stringify(dataset, null, 2) + '\n');

  // Summary statistics
  const translationExists = groundTruth.filter(g => g.external_verdict === 'translation_exists');
  const translationLikely = groundTruth.filter(g => g.external_verdict === 'translation_likely');
  const noTranslation = groundTruth.filter(g => g.external_verdict === 'no_translation_found');

  // Cross-tabulate with tool results
  const falsePositives = groundTruth.filter(g =>
    g.external_verdict === 'translation_exists' && g.tool_is_first === true
  );
  const falseNegatives = groundTruth.filter(g =>
    g.external_verdict === 'no_translation_found' && g.external_confidence === 'high' && g.tool_is_first === false
  );

  console.log('\n' + '='.repeat(60));
  console.log('GROUND TRUTH DATASET BUILT');
  console.log('='.repeat(60));
  console.log(`Total books researched: ${groundTruth.length}`);
  console.log('');
  console.log('External evidence:');
  console.log(`  Translation clearly exists:  ${translationExists.length} (2+ sources agree)`);
  console.log(`  Translation likely exists:   ${translationLikely.length} (1 source match)`);
  console.log(`  No external evidence found:  ${noTranslation.length}`);
  console.log('');
  console.log('Comparison with our tool (current pipeline):');
  console.log(`  Potential false positives:    ${falsePositives.length} (tool says "first", but external APIs found translations)`);
  console.log(`  Potential false negatives:    ${falseNegatives.length} (tool says "not first", but no external evidence supports that)`);
  console.log('');

  if (falsePositives.length > 0) {
    console.log('POTENTIAL FALSE POSITIVES (most important — claiming "first" when translation exists):');
    for (const fp of falsePositives.slice(0, 15)) {
      console.log(`  ${fp.author} — ${fp.title.slice(0, 50)}`);
      console.log(`    Tool: ${fp.tool_disposition} | External: ${fp.external_verdict} (${fp.external_sources_with_matches.join(', ')})`);
      if (fp.top_matches[0]) {
        const m = fp.top_matches[0];
        console.log(`    Best match: "${m.title}" (${m.year}) — ${m.source}`);
      }
      console.log('');
    }
  }

  console.log(`\nSaved to: ${GROUND_TRUTH_PATH}`);
  console.log('Next: run `npx tsx scripts/eval/ft-ground-truth.mjs verify` to re-run the tool and compare.');

  await client.close();
}

// ── Verify (re-run tool against ground truth) ────────────────────────

async function verify() {
  if (!fs.existsSync(GROUND_TRUTH_PATH)) {
    console.error('No ground truth dataset. Run `build` first.');
    process.exit(1);
  }

  const dataset = JSON.parse(fs.readFileSync(GROUND_TRUTH_PATH, 'utf8'));
  const cases = dataset.cases;

  console.log(`\nRe-running verification on ${cases.length} ground-truth cases...\n`);

  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('bookstore');

  // Import the verification function
  let verifyFirstTranslation;
  try {
    const mod = await import('../../src/lib/verify-first-translation.ts');
    verifyFirstTranslation = mod.verifyFirstTranslation;
  } catch (err) {
    console.error('Cannot import verify-first-translation.ts. Use: npx tsx scripts/eval/ft-ground-truth.mjs verify');
    console.error(err.message);
    await client.close();
    process.exit(1);
  }

  const results = [];
  let totalCost = 0;
  const startTime = Date.now();

  for (let i = 0; i < cases.length; i++) {
    const gt = cases[i];
    process.stdout.write(`[${i + 1}/${cases.length}] ${gt.author?.slice(0, 25)} — ${gt.title?.slice(0, 40)}... `);

    try {
      const result = await verifyFirstTranslation(db, gt.book_id, { dryRun: true, force: true });

      if (!result.success) {
        console.log(`ERROR: ${result.error}`);
        results.push({ ...gt, verify_disposition: null, verify_is_first: null, error: result.error });
        continue;
      }

      const v = result.verification;
      totalCost += v.cost_usd || 0;

      // Compare against external ground truth
      let agreement;
      if (gt.external_verdict === 'translation_exists') {
        // External says translation exists — tool should say translation_found or first_complete/modern
        agreement = !result.is_first_translation ? 'correct' :
          v.disposition === 'first_complete_translation' || v.disposition === 'first_modern_translation'
            ? 'partial' : 'FALSE_POSITIVE';
      } else if (gt.external_verdict === 'no_translation_found' && gt.external_confidence === 'high') {
        // External found nothing — tool should say some flavor of "first"
        agreement = result.is_first_translation ? 'correct' :
          v.disposition === 'needs_review' ? 'acceptable' : 'FALSE_NEGATIVE';
      } else {
        agreement = 'inconclusive'; // External evidence was weak
      }

      const icon = agreement === 'correct' ? '  OK' :
                   agreement === 'partial' ? ' ~OK' :
                   agreement === 'inconclusive' ? '  --' :
                   agreement === 'acceptable' ? '  OK' :
                   agreement === 'FALSE_POSITIVE' ? ' FP!' :
                   ' FN!';

      console.log(`${icon}  tool=${v.disposition}  ext=${gt.external_verdict}  (${v.tools_called.length} tools, $${(v.cost_usd || 0).toFixed(4)})`);

      results.push({
        book_id: gt.book_id,
        author: gt.author,
        title: gt.title,
        language: gt.language,
        external_verdict: gt.external_verdict,
        external_confidence: gt.external_confidence,
        external_sources: gt.external_sources_with_matches,
        external_match_count: gt.external_match_count,
        verify_disposition: v.disposition,
        verify_confidence: v.confidence,
        verify_is_first: result.is_first_translation,
        verify_reasoning: v.reasoning,
        verify_translations_found: v.translations_found,
        verify_tools_called: v.tools_called,
        verify_cost: v.cost_usd || 0,
        agreement,
        top_external_matches: gt.top_matches,
      });
    } catch (err) {
      console.log(`CRASH: ${err.message}`);
      results.push({ ...gt, verify_disposition: null, verify_is_first: null, error: err.message });
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // ── Compute metrics ────────────────────────────────────────────────

  const valid = results.filter(r => r.verify_disposition !== null);

  // For books where external says "translation exists" (high confidence)
  const externalPositive = valid.filter(r => r.external_verdict === 'translation_exists');
  const toolCorrectOnPositive = externalPositive.filter(r => !r.verify_is_first);
  const toolFalsePositive = externalPositive.filter(r => r.verify_is_first && r.agreement === 'FALSE_POSITIVE');
  const toolPartial = externalPositive.filter(r => r.agreement === 'partial');

  // For books where external found nothing (high confidence)
  const externalNegative = valid.filter(r => r.external_verdict === 'no_translation_found' && r.external_confidence === 'high');
  const toolCorrectOnNegative = externalNegative.filter(r => r.verify_is_first);
  const toolFalseNegative = externalNegative.filter(r => r.agreement === 'FALSE_NEGATIVE');

  // Inconclusive
  const inconclusive = valid.filter(r => r.agreement === 'inconclusive');

  // Tool usage
  const toolCounts = {};
  for (const r of valid) {
    for (const t of (r.verify_tools_called || [])) {
      toolCounts[t] = (toolCounts[t] || 0) + 1;
    }
  }

  // ── Print report ───────────────────────────────────────────────────

  console.log('\n' + '='.repeat(70));
  console.log('GROUND-TRUTH EVALUATION REPORT');
  console.log('='.repeat(70));
  console.log(`Date:     ${new Date().toISOString()}`);
  console.log(`Cases:    ${results.length} total, ${valid.length} valid`);
  console.log(`Time:     ${elapsed}s`);
  console.log(`Cost:     $${totalCost.toFixed(4)} ($${valid.length > 0 ? (totalCost / valid.length).toFixed(4) : '0'}/book)`);
  console.log('');

  console.log('RECALL: Can the tool find translations that external APIs confirm exist?');
  console.log('-'.repeat(60));
  if (externalPositive.length > 0) {
    const recallRate = toolCorrectOnPositive.length / externalPositive.length;
    console.log(`  External confirmed:    ${externalPositive.length} books with translations`);
    console.log(`  Tool found them:       ${toolCorrectOnPositive.length} (${(recallRate * 100).toFixed(1)}% recall)`);
    console.log(`  Tool partially right:  ${toolPartial.length} (first_complete or first_modern — nuanced, not wrong)`);
    console.log(`  Tool MISSED (FP):      ${toolFalsePositive.length} (claimed "first" but translation exists)`);
    console.log(`  False positive rate:   ${(toolFalsePositive.length / externalPositive.length * 100).toFixed(1)}%`);
  } else {
    console.log('  No externally confirmed translations in test set.');
  }
  console.log('');

  console.log('PRECISION: When external APIs find nothing, does the tool agree?');
  console.log('-'.repeat(60));
  if (externalNegative.length > 0) {
    const precRate = toolCorrectOnNegative.length / externalNegative.length;
    console.log(`  External found nothing: ${externalNegative.length} books`);
    console.log(`  Tool agrees (first):    ${toolCorrectOnNegative.length} (${(precRate * 100).toFixed(1)}%)`);
    console.log(`  Tool disagrees (FN):    ${toolFalseNegative.length} (tool found a translation external missed)`);
  } else {
    console.log('  No high-confidence "no translation" cases in test set.');
  }
  console.log('');

  console.log(`Inconclusive (external evidence too weak): ${inconclusive.length}`);
  console.log('');

  console.log('Tool Usage Across Eval:');
  console.log('-'.repeat(60));
  for (const [tool, count] of Object.entries(toolCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${tool}: ${count} (${(count / valid.length * 100).toFixed(0)}%)`);
  }
  console.log('');

  if (toolFalsePositive.length > 0) {
    console.log('FALSE POSITIVES (tool says "first" but translation confirmed externally):');
    console.log('='.repeat(60));
    for (const r of toolFalsePositive) {
      console.log(`\n  ${r.author} — ${r.title.slice(0, 55)}`);
      console.log(`    Language: ${r.language}`);
      console.log(`    Tool says: ${r.verify_disposition} (${r.verify_confidence})`);
      console.log(`    Tool reasoning: ${r.verify_reasoning?.slice(0, 200)}`);
      console.log(`    External sources: ${r.external_sources.join(', ')} (${r.external_match_count} matches)`);
      if (r.top_external_matches?.[0]) {
        const m = r.top_external_matches[0];
        console.log(`    Best external match: "${m.title}" by ${m.authors || '?'} (${m.year}) — ${m.source}`);
        if (m.url) console.log(`    URL: ${m.url}`);
      }
    }
    console.log('');
  }

  if (toolFalseNegative.length > 0) {
    console.log('FALSE NEGATIVES (tool found translation, external found nothing):');
    console.log('-'.repeat(60));
    for (const r of toolFalseNegative.slice(0, 10)) {
      console.log(`  ${r.author} — ${r.title.slice(0, 55)}`);
      console.log(`    Tool says: ${r.verify_disposition} — ${r.verify_reasoning?.slice(0, 150)}`);
      if (r.verify_translations_found?.[0]) {
        const t = r.verify_translations_found[0];
        console.log(`    Tool found: "${t.english_title}" (${t.evidence_source})`);
      }
    }
    console.log('');
  }

  // Save full results
  const report = {
    metadata: {
      date: new Date().toISOString(),
      total_cases: results.length,
      valid_cases: valid.length,
      elapsed_seconds: parseFloat(elapsed),
      total_cost_usd: totalCost,
    },
    recall: externalPositive.length > 0 ? {
      external_confirmed: externalPositive.length,
      tool_found: toolCorrectOnPositive.length,
      tool_partial: toolPartial.length,
      tool_false_positive: toolFalsePositive.length,
      recall_rate: toolCorrectOnPositive.length / externalPositive.length,
      false_positive_rate: toolFalsePositive.length / externalPositive.length,
    } : null,
    precision: externalNegative.length > 0 ? {
      external_none: externalNegative.length,
      tool_agrees: toolCorrectOnNegative.length,
      tool_disagrees: toolFalseNegative.length,
      agreement_rate: toolCorrectOnNegative.length / externalNegative.length,
    } : null,
    tool_usage: toolCounts,
    false_positives: toolFalsePositive,
    false_negatives: toolFalseNegative,
    all_results: results,
  };

  fs.writeFileSync(RESULTS_PATH, JSON.stringify(report, null, 2) + '\n');
  console.log(`Full results saved to: ${RESULTS_PATH}`);

  await client.close();
}

// ── Report ───────────────────────────────────────────────────────────

async function report() {
  if (!fs.existsSync(RESULTS_PATH)) {
    console.error('No results found. Run `verify` first.');
    process.exit(1);
  }

  const r = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));
  const m = r.metadata;

  console.log(`\nLast eval: ${m.date} (${m.valid_cases} cases, $${m.total_cost_usd.toFixed(4)}, ${m.elapsed_seconds}s)`);

  if (r.recall) {
    console.log(`\nRecall: ${(r.recall.recall_rate * 100).toFixed(1)}% (${r.recall.tool_found}/${r.recall.external_confirmed})`);
    console.log(`  False positives: ${r.recall.tool_false_positive} (${(r.recall.false_positive_rate * 100).toFixed(1)}%)`);
    console.log(`  Partially correct: ${r.recall.tool_partial}`);
  }

  if (r.precision) {
    console.log(`\nPrecision: ${(r.precision.agreement_rate * 100).toFixed(1)}% (${r.precision.tool_agrees}/${r.precision.external_none})`);
    console.log(`  False negatives: ${r.precision.tool_disagrees}`);
  }

  if (r.false_positives?.length > 0) {
    console.log(`\nFalse Positives (${r.false_positives.length}):`);
    for (const fp of r.false_positives.slice(0, 5)) {
      console.log(`  ${fp.author} — ${fp.title?.slice(0, 50)}: tool=${fp.verify_disposition}, ext=${fp.external_sources?.join(',')}`);
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case 'build':
    await build(args);
    break;
  case 'verify':
    await verify();
    break;
  case 'report':
    await report();
    break;
  default:
    console.log(`
First-Translation Ground-Truth Evaluation

Builds an external ground-truth dataset by independently querying 5 catalog
APIs, then tests our verification tool against it.

Usage:
  npx tsx scripts/eval/ft-ground-truth.mjs <command>

Commands:
  build [--count=120]   Research books via 5 external APIs, build ground truth
  verify                Re-run our verification tool, compare to ground truth
  report                Show last results

Workflow:
  1. build   — queries Open Library, Google Books, Internet Archive, OpenAlex,
               and LOC for each sampled book. Uses deterministic matching (no LLM)
               to determine if English translations exist. (~1 min per 60 books)
  2. verify  — runs our Gemini-powered verification on each case, compares its
               disposition against the external ground truth. (~$0.01/book)
  3. report  — quick summary of the last run

Key metrics:
  - RECALL: When external APIs confirm a translation exists, does our tool find it?
  - FALSE POSITIVE RATE: When external APIs confirm a translation exists, how often
    does our tool incorrectly claim "first translation"?
  - PRECISION: When external APIs find nothing, does our tool agree?
`);
}
