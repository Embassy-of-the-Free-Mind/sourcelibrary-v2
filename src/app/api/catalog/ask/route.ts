import { NextResponse } from 'next/server';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { checkRateLimitShared, getClientIp } from '@/lib/rate-limit';
import { CATALOG_SORTS, YEAR_CEILING, YEAR_FLOOR, type CatalogSort } from '@/lib/catalog-query';

export const maxDuration = 20;

// Structured extraction over a few hundred tokens — the cheapest model in the
// fleet is the right one. Never a model older than v3 (CLAUDE.md, AI Models).
const MODEL = 'gemini-3.1-flash-lite';

const MAX_QUESTION = 400;
const RATE_LIMIT = { name: 'catalog-ask', limit: 10, windowSeconds: 120 };

/**
 * How much of the caller's vocabulary we will read. The lists come from the
 * page that is asking, which is the page that will apply the answer: a filter
 * value it invented would only narrow its own grid, and every column behind
 * these filters is already public. Capped so a crafted body cannot inflate the
 * prompt.
 */
const VOCAB_CAPS = { languages: 60, categories: 60, collections: 250 };

interface VocabItem { id: string; name: string }

export interface CatalogAskPlan {
  /** Conceptual query for the semantic lane. Empty when the ask is pure metadata. */
  topic: string;
  /** A literal title/author string, when the reader named one. */
  keywords: string;
  language: string;
  collection: string;
  category: string;
  yearMin: number | null;
  yearMax: number | null;
  firstTranslation: boolean;
  hasTranslation: boolean;
  sort: CatalogSort;
  /** One plain sentence saying what was looked for. Shown above the results. */
  note: string;
}

const EMPTY_PLAN: CatalogAskPlan = {
  topic: '', keywords: '', language: '', collection: '', category: '',
  yearMin: null, yearMax: null, firstTranslation: false, hasTranslation: false,
  sort: 'relevance', note: '',
};

function readVocab(raw: unknown, cap: number): VocabItem[] {
  if (!Array.isArray(raw)) return [];
  const out: VocabItem[] = [];
  for (const entry of raw.slice(0, cap)) {
    if (typeof entry === 'string') {
      const id = entry.slice(0, 80).trim();
      if (id) out.push({ id, name: id });
    } else if (entry && typeof entry === 'object') {
      const id = String((entry as VocabItem).id ?? '').slice(0, 80).trim();
      const name = String((entry as VocabItem).name ?? id).slice(0, 120).trim();
      if (id) out.push({ id, name });
    }
  }
  return out;
}

function pick(value: unknown, vocab: VocabItem[]): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  const wanted = value.trim().toLowerCase();
  const hit = vocab.find((v) => v.id.toLowerCase() === wanted)
    || vocab.find((v) => v.name.toLowerCase() === wanted);
  return hit ? hit.id : '';
}

function year(value: unknown): number | null {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return null;
  if (n < YEAR_FLOOR || n > YEAR_CEILING) return null;
  return Math.round(n);
}

function str(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function buildPrompt(question: string, vocab: {
  languages: VocabItem[]; categories: VocabItem[]; collections: VocabItem[];
}): string {
  const list = (items: VocabItem[]) => items.map((v) => (v.id === v.name ? v.id : `${v.id} (${v.name})`)).join(', ');

  return `You are the reference librarian of Source Library, a digital library of historical primary sources: alchemy, Hermetica, Kabbalah, magic, early modern science, theology, classical philosophy and adjacent traditions. Every book is a scanned historical edition, most of them transcribed and translated by the library.

A reader has asked you to find them books. Turn the request into catalogue filters.

READER'S REQUEST:
"""
${question}
"""

Return ONLY JSON with these keys:
{
  "topic": string,             // what the books should be ABOUT, as a short phrase for a similarity search. Empty string if the request names no subject (e.g. "anything in Arabic before 1500").
  "keywords": string,          // a specific title or author name the reader named, verbatim. Empty string otherwise. Never put a subject here.
  "language": string,          // exactly one value from LANGUAGES, or ""
  "collection": string,        // exactly one id from COLLECTIONS, or ""
  "category": string,          // exactly one id from CATEGORIES, or ""
  "yearMin": number | null,    // publication year floor the reader implied
  "yearMax": number | null,    // publication year ceiling
  "firstTranslation": boolean, // true only if they asked for first translations / never-before-translated works
  "hasTranslation": boolean,   // true only if they asked for books they can read in English / translated ones
  "sort": string,              // one of: relevance, popular, recent, last_translated, title, author, year_asc, year_desc, quality
  "note": string               // what was looked for, as a plain noun phrase under 12 words. "Latin medical texts on plague, printed before 1600." Not "I am searching for". No dashes, no flattery, no mention of filters or JSON.
}

LANGUAGES: ${list(vocab.languages) || '(none supplied)'}
CATEGORIES: ${list(vocab.categories) || '(none supplied)'}
COLLECTIONS: ${list(vocab.collections) || '(none supplied)'}

Rules:
- Only ever use a value that appears in the lists above. If nothing fits, use "".
- Never set both "collection" and "category". They overlap, and setting both narrows twice for one request. Pick the better fit, or leave both empty and rely on "topic".
- Prefer "topic" over "category": the similarity search is better at subjects than the tag list is.
- "before 1600" means yearMax 1599. "16th century" means 1500 to 1599. "medieval" means up to 1500. Leave a bound null when the reader implied none.
- Set firstTranslation and hasTranslation to false unless the reader actually asked for that.
- Use "relevance" as the sort whenever "topic" is set. Use "year_asc" for "earliest", "recent" for "newly added", "popular" otherwise.`;
}

/**
 * POST /api/catalog/ask
 *
 * Reads a plain-language request ("Latin books on plague remedies printed
 * before 1600") and returns the catalogue filters that answer it. The page
 * applies the plan itself and shows the reader what it understood, so a
 * misread is visible and editable rather than silently changing the results.
 *
 * This route decides NOTHING about visibility or access: it only picks filter
 * values, and every one of them is enforced later by /api/catalog/browse
 * against the same SQL as an ordinary browse.
 */
export async function POST(request: Request) {
  try {
    const limit = await checkRateLimitShared(RATE_LIMIT, getClientIp(request));
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'The librarian needs a moment. Try again shortly.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfter) } },
      );
    }

    const body = await request.json().catch(() => ({}));
    const question = str((body as { question?: unknown }).question, MAX_QUESTION);
    if (question.length < 3) {
      return NextResponse.json({ error: 'Ask for something a little longer.' }, { status: 400 });
    }

    const rawVocab = (body as { vocab?: Record<string, unknown> }).vocab || {};
    const vocab = {
      languages: readVocab(rawVocab.languages, VOCAB_CAPS.languages),
      categories: readVocab(rawVocab.categories, VOCAB_CAPS.categories),
      collections: readVocab(rawVocab.collections, VOCAB_CAPS.collections),
    };

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      // No key in this environment: the ask still works, it just becomes a
      // plain similarity search over the question. Better than an error page.
      return NextResponse.json({
        plan: { ...EMPTY_PLAN, topic: question, note: '' },
        parsed: false,
      });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: MODEL,
      safetySettings: [
        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      ],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json', maxOutputTokens: 500 },
    });

    let raw: Record<string, unknown>;
    try {
      const result = await model.generateContent(buildPrompt(question, vocab));
      raw = JSON.parse(result.response.text()) as Record<string, unknown>;
    } catch (err) {
      console.error('[catalog/ask] model call failed:', (err as Error)?.message || err);
      return NextResponse.json({ plan: { ...EMPTY_PLAN, topic: question }, parsed: false });
    }

    const sortRaw = str(raw.sort, 24);
    const topic = str(raw.topic, 200);
    let yearMin = year(raw.yearMin);
    let yearMax = year(raw.yearMax);
    if (yearMin != null && yearMax != null && yearMin > yearMax) [yearMin, yearMax] = [yearMax, yearMin];

    const plan: CatalogAskPlan = {
      topic,
      keywords: str(raw.keywords, 120),
      language: pick(raw.language, vocab.languages),
      collection: pick(raw.collection, vocab.collections),
      category: pick(raw.category, vocab.categories),
      yearMin,
      yearMax,
      firstTranslation: raw.firstTranslation === true,
      hasTranslation: raw.hasTranslation === true,
      sort: (CATALOG_SORTS as readonly string[]).includes(sortRaw)
        ? (sortRaw as CatalogSort)
        : (topic ? 'relevance' : 'popular'),
      // Strip the dashes the model reaches for. House style, and it reads
      // better in a one-line status above a grid.
      note: str(raw.note, 160).replace(/\s*[—–]\s*/g, ', '),
    };

    // A plan that narrows nothing found no subject, no title and no metadata in
    // the request. Searching the raw words anyway is the worst of both: the
    // embedder happily ranks the corpus against a keyboard mash and returns
    // thirty confident books ("qwertyuiop zxcvbnm" did, at every threshold
    // tried). Say we could not read it instead, and let the reader rephrase.
    const narrows = plan.topic || plan.keywords || plan.language || plan.collection
      || plan.category || plan.yearMin != null || plan.yearMax != null
      || plan.firstTranslation || plan.hasTranslation;
    if (!narrows) {
      plan.topic = '';
      return NextResponse.json({
        plan,
        parsed: true,
        unreadable: true,
        // Fixed wording, not the model's. Asked to describe a search it did not
        // make, flash-lite writes things like "Unintelligible search query" —
        // accurate, useless, and not what a librarian sounds like. This is the
        // one branch where there is nothing to report, so the words are ours.
        note: 'I could not tell what to look for in that. Try naming a subject, a title or an author.',
      });
    }

    return NextResponse.json({ plan, parsed: true });
  } catch (err) {
    console.error('[catalog/ask] failed:', err);
    return NextResponse.json({ error: 'The librarian could not read that.' }, { status: 500 });
  }
}
