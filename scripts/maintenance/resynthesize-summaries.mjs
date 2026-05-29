/**
 * Re-synthesize "About This Book" summaries from already-stored index data.
 *
 * Why: the synthesis prompt was rewritten (plain encyclopedic, see
 * scripts/workers/lib/summary-prompt.mjs). Re-running full Phase 6 to refresh
 * the prose would re-extract every translated page — slow and costly — when
 * only the final writing step changed. This script reuses the per-book
 * extraction already stored in `book_indexes` (sectionSummaries, people,
 * places, concepts, quotes) and runs ONLY the synthesis call: ~1 cheap Gemini
 * call per book.
 *
 * NON-DESTRUCTIVE: writes to `book.summary_candidate`, never to the live
 * `book.summary` / `book.reading_summary`. Promotion to live happens after
 * human review via /platform/admin/summary-review.
 *
 * Usage:
 *   node scripts/maintenance/resynthesize-summaries.mjs --ids=ID1,ID2
 *   node scripts/maintenance/resynthesize-summaries.mjs --sample=150
 *   node scripts/maintenance/resynthesize-summaries.mjs --all [--limit=N] [--skip-existing]
 *   node scripts/maintenance/resynthesize-summaries.mjs --sample=20 --dry-run   (print, don't write)
 */

import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { buildSummaryPrompt, SUMMARY_GEN_CONFIG, SUMMARY_PROMPT_VERSION } from '../workers/lib/summary-prompt.mjs';

const MONGODB_URI = process.env.MONGODB_URI;
const LITE_MODEL = 'gemini-3.1-flash-lite';
const CONCURRENCY = 12;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ALL = args.includes('--all');
const VISIBLE_ONLY = args.includes('--visible-only');
const SKIP_EXISTING = args.includes('--skip-existing');
const idsArg = args.find(a => a.startsWith('--ids='))?.split('=')[1];
const sampleArg = args.find(a => a.startsWith('--sample='))?.split('=')[1];
const limitArg = args.find(a => a.startsWith('--limit='))?.split('=')[1];

const API_KEYS = [
  process.env.GEMINI_API_KEY,
  ...Array.from({ length: 9 }, (_, i) => process.env[`GEMINI_API_KEY_${i + 2}`]),
  process.env.GEMINI_API_KEY_TIER3,
].filter(Boolean);

if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
if (API_KEYS.length === 0) { console.error('No Gemini API keys configured'); process.exit(1); }

let keyIndex = 0;
function nextClient() {
  const c = new GoogleGenerativeAI(API_KEYS[keyIndex % API_KEYS.length]);
  keyIndex++;
  return c;
}

function parseSummaryJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no JSON in response');
  try {
    return JSON.parse(m[0]);
  } catch {
    const cleaned = m[0].replace(/,\s*([}\]])/g, '$1').replace(/[\x00-\x1f]/g, ' ');
    return JSON.parse(cleaned);
  }
}

const ensureString = (v) => {
  if (typeof v === 'string') return v;
  if (v == null) return '';
  if (Array.isArray(v)) return v.join('\n\n');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

/** Assemble synthesis inputs from a stored book_indexes doc. */
function inputsFromIndex(book, idx) {
  const sections = Array.isArray(idx.sectionSummaries) ? idx.sectionSummaries : [];
  const sectionSummariesText = sections
    .map(s => `Pages ${s.startPage ?? '?'}-${s.endPage ?? '?'}: ${s.summary ?? ''}`)
    .join('\n');
  const quotes = sections.flatMap(s => Array.isArray(s.quotes) ? s.quotes : []);
  const quotesText = quotes.slice(0, 15)
    .map(q => `- "${q.text}" (p. ${q.page ?? '?'})${q.significance ? ` — ${q.significance}` : ''}`)
    .join('\n');

  const bookLanguage = book.language && book.language !== 'Unknown' ? book.language : '';
  return {
    bookTitle: book.title || book.display_title || '(untitled)',
    englishTitle: book.display_title || '',
    bookAuthor: book.author || 'Unknown',
    languageContext: bookLanguage ? ` The original text is in ${bookLanguage}.` : '',
    researchSection: '',
    chapterSection: '',
    themes: (idx.keywords && idx.keywords.length ? idx.keywords : idx.concepts) || [],
    people: idx.people || [],
    places: idx.places || [],
    concepts: idx.concepts || [],
    sectionSummariesText,
    quotesText,
    hasChapters: sections.length > 0,
  };
}

async function resynth(book, idx) {
  const inputs = inputsFromIndex(book, idx);
  const prompt = buildSummaryPrompt(inputs);
  const model = nextClient().getGenerativeModel({ model: LITE_MODEL, generationConfig: SUMMARY_GEN_CONFIG });
  const result = await model.generateContent(prompt);
  const parsed = parseSummaryJson(result.response.text());
  return {
    brief: ensureString(parsed.brief),
    abstract: ensureString(parsed.abstract),
    detailed: ensureString(parsed.detailed),
  };
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');
  const indexes = db.collection('book_indexes');

  // Select target books
  let targets;
  if (idsArg) {
    const ids = idsArg.split(',').map(s => s.trim()).filter(Boolean);
    targets = await books.find({ id: { $in: ids } })
      .project({ id: 1, title: 1, display_title: 1, author: 1, language: 1 }).toArray();
  } else {
    const match = { 'summary.data': { $type: 'string', $ne: '' } };
    if (VISIBLE_ONLY) match.visible = true;
    if (SKIP_EXISTING) match.summary_candidate = { $exists: false };
    if (sampleArg) {
      targets = await books.aggregate([
        { $match: match },
        { $sample: { size: parseInt(sampleArg) } },
        { $project: { id: 1, title: 1, display_title: 1, author: 1, language: 1 } },
      ]).toArray();
    } else if (ALL) {
      const cur = books.find(match).project({ id: 1, title: 1, display_title: 1, author: 1, language: 1 });
      if (limitArg) cur.limit(parseInt(limitArg));
      targets = await cur.toArray();
    } else {
      console.error('Specify --ids=, --sample=N, or --all'); await client.close(); process.exit(1);
    }
  }

  console.log(`[resynth] prompt=${SUMMARY_PROMPT_VERSION} dry-run=${DRY_RUN} targets=${targets.length}`);

  let done = 0, skipped = 0, failed = 0;
  const queue = [...targets];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const book = queue.shift();
      try {
        const idx = await indexes.findOne({ book_id: book.id });
        if (!idx || !Array.isArray(idx.sectionSummaries) || idx.sectionSummaries.length === 0) {
          skipped++; console.log(`  SKIP (no index) ${book.id} ${book.title?.slice(0, 40)}`); continue;
        }
        const cand = await resynth(book, idx);
        if (!cand.brief) { skipped++; console.log(`  SKIP (empty) ${book.id}`); continue; }
        if (DRY_RUN) {
          console.log(`\n--- ${book.title?.slice(0, 50)} (${book.id}) ---\n${cand.brief}`);
        } else {
          await books.updateOne({ id: book.id }, { $set: { summary_candidate: {
            ...cand,
            generated_at: new Date(),
            model: LITE_MODEL,
            prompt_version: SUMMARY_PROMPT_VERSION,
            status: 'pending',
          } } });
        }
        done++;
        if (done % 25 === 0) console.log(`  ...${done}/${targets.length}`);
      } catch (err) {
        failed++; console.error(`  ERROR ${book.id}: ${err.message}`);
      }
    }
  });
  await Promise.all(workers);

  console.log(`[resynth] done=${done} skipped=${skipped} failed=${failed}`);
  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
