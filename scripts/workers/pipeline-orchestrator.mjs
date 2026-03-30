#!/usr/bin/env node
/**
 * Pipeline Orchestrator Worker
 *
 * Replaces the Vercel `post-import-pipeline` cron. Drives books through all pipeline
 * phases with no time limit and higher submission limits.
 *
 * Designed to run every 5 minutes on Hetzner via crontab.
 *
 * Key improvements over the Vercel cron:
 *   - No 270s time budget — processes ALL books per phase
 *   - Higher submission limits (200 OCR, 100 translate, 30 enrich, etc.)
 *   - Still calls production API for complex operations (OCR/translate submission,
 *     enrichment, chapter extraction, image extraction)
 *   - Logs to cron_runs collection for observability
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/workers/pipeline-orchestrator.mjs
 *   node scripts/workers/pipeline-orchestrator.mjs --dry-run
 *   node scripts/workers/pipeline-orchestrator.mjs --phase 2  # run only phase 2 (OCR submit)
 */

import { MongoClient, ObjectId } from 'mongodb';
import { nanoid } from 'nanoid';
import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'crypto';

// ── Config ──

const MONGODB_URI = process.env.MONGODB_URI;
const CRON_SECRET = process.env.CRON_SECRET;
const BASE_URL = process.env.NEXT_PUBLIC_URL || 'https://sourcelibrary.org';
const SQS_TRANSLATION_QUEUE_URL = process.env.SQS_PAGE_TRANSLATION_QUEUE_URL;
const SQS_OCR_QUEUE_URL = process.env.SQS_PAGE_OCR_QUEUE_URL;
const SQS_IMAGE_EXTRACTION_QUEUE_URL = process.env.SQS_PAGE_IMAGE_EXTRACTION_QUEUE_URL;

// Gemini Batch API config (for direct OCR submission, bypassing Vercel)
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const OCR_MODEL_FLASH = 'gemini-3-flash-preview';
const OCR_MODEL_LITE = 'gemini-3.1-flash-lite-preview';
function getOcrModelForBook(book) {
  // A/B tested 2026-03-28: lite produces identical OCR on BPH books (2-4% char diff,
  // indistinguishable from normal variation). 50% cost savings, 5-7x faster.
  return OCR_MODEL_LITE;
}
const OCR_MODEL = OCR_MODEL_FLASH; // Legacy fallback for recitation retry path
const OCR_PROMPT_VERSION = 'v5.2026-02';
const OCR_INLINE_BATCH_SIZE = 20;  // Pages per inline batch (base64 in body, ~20MB limit)
const OCR_FILE_BATCH_SIZE = 150;   // Pages per file-based batch (JSONL uploaded to File API)
const IMAGE_CONCURRENCY = 20;     // Parallel image downloads per book
const MAX_PAGES_PER_BOOK = 500;   // Max pages to OCR per book

// R2 config for split image uploads (mirrors batch-split-bph.mjs)
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';
const SPLIT_OVERLAP = 10; // overlap in 0-1000 scale
const SPLIT_PAGE_CONCURRENCY = 5;
const SPLIT_CROPPED_QUALITY = 90;
const SPLIT_DISPLAY_WIDTH = 1200;
const SPLIT_DISPLAY_QUALITY = 85;
const SPLIT_THUMB_WIDTH = 150;
const SPLIT_THUMB_QUALITY = 60;

function getR2Client() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error('Missing R2 credentials for split image upload');
  }
  return new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });
}

async function uploadToR2(r2, key, buffer, contentType = 'image/jpeg') {
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET, Key: key, Body: buffer, ContentType: contentType,
    CacheControl: 'public, max-age=86400, s-maxage=86400',
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

function splitPagePaths(bookId, pageNumber) {
  const num = String(pageNumber).padStart(4, '0');
  const base = `pages/${bookId}/${num}`;
  return { full: `${base}-full.jpg`, display: `${base}.jpg`, thumb: `${base}-thumb.jpg` };
}

async function parallelMap(items, fn, concurrency) {
  const results = [];
  let i = 0;
  async function worker() { while (i < items.length) { const idx = i++; results[idx] = await fn(items[idx], idx); } }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
if (!CRON_SECRET) { console.error('CRON_SECRET not set'); process.exit(1); }

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const phaseIdx = args.indexOf('--phase');
const ONLY_PHASE = phaseIdx >= 0 ? parseFloat(args[phaseIdx + 1]) : null;

// Submission limits — defaults, may be reduced by DB health probe
let ENROLL_LIMIT = 100;
let ARCHIVE_LIMIT = 500;
let OCR_SUBMIT_LIMIT = 200;
const MAX_ACTIVE_BATCH_OCR = 500; // Gemini Batch API is resilient
let METADATA_ENRICH_LIMIT = 50;
let TRANSLATE_SUBMIT_LIMIT = 30;
let MAX_INFLIGHT_TRANSLATIONS = 40; // Total books in translate_submitted — caps concurrent workers
let ENRICH_LIMIT = 30;
let CHAPTER_LIMIT = 50;
let IMAGE_SUBMIT_LIMIT = 10;
let FINALIZE_LIMIT = 200;
let TRANSLITERATE_LIMIT = 10;  // Books per run (pages processed inline)
const TRANSLITERATE_CONCURRENCY = 10;  // Parallel Gemini calls per book
let MAX_ACTIVE_IMAGE_JOBS = 15;
const PREVIEW_PAGE_COUNT = 25;
let PREVIEW_LIMIT = 20; // Books per run to queue preview OCR
const MAX_RETRIES = 3;
const ENROLL_WINDOW_DAYS = 14;

// Delay between API calls (ms) to avoid overwhelming production
const API_DELAY_MS = 500;

// ── DB Health Probe (ported from src/lib/adaptive-limits.ts) ──
// Probes DB latency and active job count before each run.
// On degraded: halves all submission limits.
// On critical: slams to minimums and cancels pending jobs.

async function probeDbHealth(db) {
  const t0 = Date.now();
  let findMs = 0, countMs = 0, activeJobs = 0;

  // Signal 1: Query latency — time a find + countDocuments on pages
  try {
    const sampleBook = await db.collection('books').findOne(
      { 'pipeline_auto.status': { $exists: true } },
      { projection: { id: 1 }, maxTimeMS: 3000 }
    );
    if (sampleBook) {
      const t1 = Date.now();
      await db.collection('pages').findOne(
        { book_id: sampleBook.id, 'translation.data': { $exists: true } },
        { projection: { id: 1 }, maxTimeMS: 3000 }
      );
      findMs = Date.now() - t1;

      const t2 = Date.now();
      await db.collection('pages').countDocuments(
        { book_id: sampleBook.id, 'ocr.data': { $exists: true, $ne: '' } },
        { maxTimeMS: 3000 }
      );
      countMs = Date.now() - t2;
    }
  } catch {
    findMs = 3000; // treat timeout as worst-case
    countMs = 3000;
  }

  // Signal 2: Active jobs
  try {
    activeJobs = await db.collection('jobs').countDocuments(
      { status: 'processing' },
      { maxTimeMS: 5000 }
    );
  } catch {
    activeJobs = 999; // assume worst-case
  }

  // Grade
  let grade = 'healthy';
  if (findMs > 1000 || countMs > 1500 || activeJobs > 200) grade = 'critical';
  else if (findMs > 300 || countMs > 500 || activeJobs > 100) grade = 'degraded';

  const duration = Date.now() - t0;
  console.log(`[health] grade=${grade} find=${findMs}ms count=${countMs}ms jobs=${activeJobs} (probed in ${duration}ms)`);

  // Apply throttling
  if (grade === 'critical') {
    console.log('[health] CRITICAL — slamming all limits to minimums, cancelling pending jobs');
    ENROLL_LIMIT = 5;
    ARCHIVE_LIMIT = 10;
    OCR_SUBMIT_LIMIT = 2;
    METADATA_ENRICH_LIMIT = 2;
    TRANSLATE_SUBMIT_LIMIT = 2;
    MAX_INFLIGHT_TRANSLATIONS = 3;
    ENRICH_LIMIT = 2;
    CHAPTER_LIMIT = 2;
    IMAGE_SUBMIT_LIMIT = 2;
    FINALIZE_LIMIT = 10;
    TRANSLITERATE_LIMIT = 2;
    MAX_ACTIVE_IMAGE_JOBS = 3;
    PREVIEW_LIMIT = 2;

    // Cancel pending jobs to relieve pressure
    try {
      const result = await db.collection('jobs').updateMany(
        { status: 'pending' },
        {
          $set: {
            status: 'cancelled',
            updated_at: new Date(),
            cancelled_at: new Date(),
            cancelled_by: 'adaptive-limits',
          },
        },
      );
      if (result.modifiedCount > 0) {
        console.log(`[health] Cancelled ${result.modifiedCount} pending jobs`);
        // Clear book.job references AND roll back pipeline status so books can be re-submitted
        await db.collection('books').updateMany(
          { 'pipeline_auto.status': 'translate_submitted' },
          { $set: { 'pipeline_auto.status': 'metadata_enriched', updated_at: new Date() }, $unset: { job: '' } },
        );
        await db.collection('books').updateMany(
          { 'pipeline_auto.status': 'ocr_submitted' },
          { $set: { 'pipeline_auto.status': 'archive_complete', updated_at: new Date() }, $unset: { job: '' } },
        );
        await db.collection('books').updateMany(
          { 'pipeline_auto.status': 'images_submitted' },
          { $set: { 'pipeline_auto.status': 'chapters_complete', updated_at: new Date() }, $unset: { job: '' } },
        );
      }
    } catch (e) {
      console.error('[health] Failed to cancel pending jobs:', e.message);
    }
  } else if (grade === 'degraded') {
    console.log('[health] DEGRADED — halving all submission limits');
    ENROLL_LIMIT = Math.max(5, Math.floor(ENROLL_LIMIT / 2));
    ARCHIVE_LIMIT = Math.max(10, Math.floor(ARCHIVE_LIMIT / 2));
    OCR_SUBMIT_LIMIT = Math.max(5, Math.floor(OCR_SUBMIT_LIMIT / 2));
    METADATA_ENRICH_LIMIT = Math.max(5, Math.floor(METADATA_ENRICH_LIMIT / 2));
    TRANSLATE_SUBMIT_LIMIT = Math.max(2, Math.floor(TRANSLATE_SUBMIT_LIMIT / 2));
    MAX_INFLIGHT_TRANSLATIONS = Math.max(5, Math.floor(MAX_INFLIGHT_TRANSLATIONS / 2));
    ENRICH_LIMIT = Math.max(5, Math.floor(ENRICH_LIMIT / 2));
    CHAPTER_LIMIT = Math.max(5, Math.floor(CHAPTER_LIMIT / 2));
    IMAGE_SUBMIT_LIMIT = Math.max(2, Math.floor(IMAGE_SUBMIT_LIMIT / 2));
    FINALIZE_LIMIT = Math.max(10, Math.floor(FINALIZE_LIMIT / 2));
    TRANSLITERATE_LIMIT = Math.max(2, Math.floor(TRANSLITERATE_LIMIT / 2));
    MAX_ACTIVE_IMAGE_JOBS = Math.max(3, Math.floor(MAX_ACTIVE_IMAGE_JOBS / 2));
    PREVIEW_LIMIT = Math.max(2, Math.floor(PREVIEW_LIMIT / 2));
  }

  // Persist health state for admin dashboard visibility
  try {
    await db.collection('system_config').updateOne(
      { _id: 'adaptive_limits' },
      {
        $set: {
          'health.grade': grade,
          'health.find_ms': findMs,
          'health.count_ms': countMs,
          'health.active_jobs': activeJobs,
          'health.measured_at': new Date(),
          'health.source': 'hetzner-orchestrator',
          updated_at: new Date(),
          updated_by: 'adaptive',
        },
      },
      { upsert: true }
    );
  } catch { /* best effort */ }

  return grade;
}

// Page types to skip for translation (mirrors defaults.ts)
const SKIP_TRANSLATION_PAGE_TYPES = [
  'blank',
];

// Languages that get inline transliteration before translation.
// Currently Greek only — other scripts are handled by the translator directly.
const NON_LATIN_LANGUAGES = new Set([
  'greek',
]);

function isNonLatin(language) {
  return language && NON_LATIN_LANGUAGES.has(language.toLowerCase());
}

/** Detect Google Books, Internet Archive, or other digitizer notice pages from OCR text. */
function isDigitizerOcr(ocrData) {
  if (!ocrData) return false;
  const start = ocrData.substring(0, 1500);
  return /google\s+logo|digitized\s+by\s+google|this\s+is\s+a\s+digital\s+copy/i.test(start) ||
    /inserted\s+by\s+the\s+internet|internet\s+archive|digitization\s+(credit|notice)/i.test(start) ||
    /not\s+part\s+of\s+the\s+original\s+book|scanner\s+barcode/i.test(start) ||
    /ex[\s\-.]?libris|bookplate|library\s+stamp/i.test(start);
}

function languageToScript(language) {
  if (!language) return 'Unknown';
  const map = {
    'greek': 'Greek', 'hebrew': 'Hebrew', 'arabic': 'Arabic',
    'persian': 'Arabic (Persian)', 'ottoman turkish': 'Arabic (Ottoman Turkish)',
    'syriac': 'Syriac', 'chinese': 'Chinese', 'japanese': 'Japanese',
    'korean': 'Korean', 'sanskrit': 'Sanskrit/Devanagari', 'armenian': 'Armenian',
    'georgian': 'Georgian', 'ethiopic': 'Ethiopic', 'coptic': 'Coptic',
    'tibetan': 'Tibetan', 'russian': 'Cyrillic', 'church slavonic': 'Cyrillic',
  };
  return map[language.toLowerCase()] || language;
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(16);
}

const TRANSLATE_MODEL_FLASH = 'gemini-3-flash-preview';
const TRANSLATE_MODEL_LITE = 'gemini-3.1-flash-lite-preview';
function getTranslateModelForBook(book) {
  if (book?.image_source?.provider === 'bph') return TRANSLATE_MODEL_FLASH;
  return TRANSLATE_MODEL_LITE;
}
const TRANSLATE_MODEL = TRANSLATE_MODEL_FLASH; // Legacy fallback
const TRANSLATE_PROMPT_VERSION = 'v10';
const TRANSLITERATION_MODEL = 'gemini-3.1-flash-lite-preview';
const TRANSLITERATION_PROMPT = `You are a scholarly transliterator. Convert the following text to Latin characters using standard academic Romanization conventions.

CRITICAL RULES:
1. Preserve the line-by-line structure EXACTLY. Each line of output must correspond to the same line of input.
2. Preserve paragraph breaks and blank lines exactly as they appear.
3. PRESERVE the <column-break/> tag exactly where it appears.
4. Remove all OTHER XML/markup tags from the output.
5. Include standard scholarly diacritics.
6. Do not translate — only transliterate.
7. If the text contains passages in Latin script already, preserve them as-is.

Romanization conventions by script:
- Greek: Standard scholarly. α→a, β→b, γ→g, δ→d, ε→e, ζ→z, η→ē, θ→th, etc.
- Hebrew: SBL academic style.
- Arabic: DIN 31635 / Library of Congress.
- Syriac: Standard Semiticist conventions.
- Armenian: Library of Congress romanization.
- Chinese: Pinyin with tone marks.
- Japanese: Modified Hepburn.
- Korean: Revised Romanization.
- Sanskrit/Devanagari: IAST.`;

async function transliteratePage(db, page, sourceScript) {
  const apiKey = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${TRANSLITERATION_MODEL}:generateContent?key=${apiKey}`;
  const prompt = `${TRANSLITERATION_PROMPT}\n\nThe source script is: **${sourceScript}**\n\n**Text to transliterate:**\n${page.ocr.data}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
      generationConfig: { thinkingConfig: { thinkingBudget: 0 } },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini ${response.status}: ${errText.substring(0, 200)}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const usage = data.usageMetadata || {};
  const inputTokens = usage.promptTokenCount || 0;
  const outputTokens = usage.candidatesTokenCount || 0;

  if (!text) return null;

  const ocrHash = hashString(page.ocr.data);
  await db.collection('pages').updateOne(
    { id: page.id },
    {
      $set: {
        'transliteration.data': text,
        'transliteration.model': TRANSLITERATION_MODEL,
        'transliteration.updated_at': new Date(),
        'transliteration.source_ocr_hash': ocrHash,
        'transliteration.script': sourceScript,
        updated_at: new Date(),
      },
    }
  );

  // Log usage (fire-and-forget)
  const costUsd = (inputTokens / 1_000_000) * 0.10 + (outputTokens / 1_000_000) * 0.40;
  db.collection('gemini_usage').insertOne({
    type: 'transliterate',
    mode: 'realtime',
    model: TRANSLITERATION_MODEL,
    book_id: page.book_id,
    page_ids: [page.id],
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: costUsd,
    status: 'success',
    endpoint: 'hetzner/pipeline-orchestrator',
    timestamp: new Date(),
  }).catch(() => {});

  return { inputTokens, outputTokens, costUsd };
}

// ── Direct translation (Gemini realtime, FIFO per book) ──

const TRANSLATION_PROMPT = `You are translating a manuscript transcription into accessible English.

**Input:** The OCR transcription and (if available) the previous page's translation for continuity.

**Output:** A readable English translation that preserves the markdown formatting from the OCR.

**Preserve from OCR:**
- Heading levels (# ## ###) - keep the same hierarchy
- **Bold** and *italic* formatting
- Tables - recreate them in the translation
- Centered text (->text<-)
- <column-break/> markers — preserve exactly as-is between translated columns
- Line breaks and paragraph structure

**Inline annotations (XML tags — toggleable by reader):**
- <note>X</note> — interpretive notes, interpolated clarifications
- <term>X</term> — technical/foreign terms kept in transliteration
- <gloss>X</gloss> — definition immediately after a <term> tag; also translate interlinear annotations
- <margin>X</margin> — translate and keep marginal notes
- <insert>X</insert> — translate later additions
- <unclear>X</unclear> — preserve uncertain readings from OCR

**Metadata tags (hidden from readers):**
- <meta>X</meta> for translator notes that should be hidden (e.g., continuity with previous page)

**Do NOT use:**
- Bare [square brackets] for interpolations — use <note>...</note> instead
- Bare (parenthetical glosses) after terms — use <term>word</term> <gloss>meaning</gloss> instead
- Code blocks or backticks — this is prose

**IMPORTANT - Translate ALL languages to English:**
The source text may contain phrases in multiple languages (Latin, Greek, Hebrew, Sanskrit, Arabic, etc.). You MUST translate EVERYTHING to English:
- Latin quotes embedded in German → translate to English
- Greek, Hebrew, Aramaic phrases → translate to English
- Sanskrit, Prakrit, Pali, Arabic text → translate to English
- Text in non-Latin scripts (Devanagari, Chinese, Arabic, etc.) → provide English translation immediately after
- ANY non-English text → translate to English
Use <note>original: "..."</note> to preserve important original phrases for scholars, but the main text must be fully readable in English without knowing other languages.

**Image descriptions from OCR:**
If the OCR contains <image-desc>...</image-desc>, translate the description and wrap the ENTIRE paragraph in <note>...</note>. Image descriptions are editorial content, not original text — they must be toggleable. Do NOT leave image description prose untagged. Example:
  OCR: <image-desc>A woodcut of a pelican feeding her young</image-desc>
  Translation: <note>A woodcut depicts a pelican feeding her young from her own breast, a symbol of self-sacrifice in alchemical tradition.</note>

**Instructions:**
1. Start with <meta>...</meta> if noting continuity with previous page (hidden from readers).
2. Mirror the source layout - headings, paragraphs, tables, centered text.
3. Translate ALL text including <margin>, <insert>, <gloss> - keep the XML tags.
4. Translate embedded Latin/Greek/Hebrew phrases to English, noting originals when significant.
5. For foreign terms kept in transliteration: <term>Chesed</term> <gloss>Mercy/Loving-kindness</gloss>

**Examples of annotated translation:**
- "He composed a very worthy book On the World and Religion <note>original: "De Seculo, & Religione"</note>; one On Fate and Fortune <note>original: "De Fato, & Fortuna"</note>; and another On Law and Medicine <note>original: "Della Legge, e della Medicina"</note>."
- "The <term>prima materia</term> <gloss>first matter</gloss> must be purified through <term>calcination</term> <gloss>heating to powder</gloss> before the <term>opus</term> <gloss>the Great Work</gloss> can proceed."
- "According to the <term>Sefer Yetzirah</term> <gloss>Book of Formation</gloss>, the ten <term>sefirot</term> <gloss>divine emanations</gloss> correspond to the paths of wisdom."
6. For interpolated clarifications: <note>from the aspect of the secret</note>
7. Add <note>...</note> inline to explain historical references or difficult phrases.
8. Style: warm museum label - explain rather than assume knowledge.
9. Preserve the voice and spirit of the original.
8. Wrap ALL image/illustration descriptions in <note>...</note> — readers can toggle these off.
9. END with <summary>...</summary> and <keywords>...</keywords> for indexing.

**Writing style for summaries and notes:**
- Never use em-dashes (—). Use commas, colons, semicolons, or separate sentences.
- Avoid: "delves into", "rich tapestry", "fascinating exploration", "sheds light on", "comprehensive", "intricate", "nuanced", "multifaceted", "offers a window into".
- Use short, direct sentences. Scholarly but accessible.

**Source language:** {source_language}
**Target language:** {target_language}

**Final output format:**
[translated text]

<summary>1-2 sentence summary of this page's main content and significance</summary>
<keywords>key concepts, names, themes in English, for indexing</keywords>`;

const ENGLISH_MODERNIZATION_PROMPT = `You are modernizing Early Modern English text into clear, accessible Modern English.

**Context:** This is a historical text (1500s-1700s) written in Early Modern English. The OCR transcription preserves the original spelling, vocabulary, and syntax. Your job is to make it readable for a modern audience while preserving the author's meaning and the document's formatting.

**Input:** The OCR transcription with markdown formatting and XML tags, plus (if available) the previous page's modernization for continuity.

**Output:** Modern English text that preserves the markdown formatting and XML tags from the OCR.

**Preserve from OCR:**
- Heading levels (# ## ###) - keep the same hierarchy
- **Bold** and *italic* formatting
- Tables - recreate them with modern text
- Centered text (->text<-)
- Line breaks and paragraph structure

**Inline annotations (visible to readers):**
- <note>X</note> — keep or add interpretive notes for readers
- <margin>X</margin> — modernize and keep marginal notes
- <gloss>X</gloss> — modernize interlinear annotations
- <insert>X</insert> — modernize later additions (inline only)
- <unclear>X</unclear> — illegible readings
- <term>X</term> — explain archaic or technical vocabulary

**Metadata tags (hidden from readers):**
- <meta>X</meta> for notes about continuity with previous page

**What to modernize:**
1. **Spelling** — normalize archaic spelling
2. **Vocabulary** — replace obsolete words with modern equivalents
3. **Sentence structure** — break up very long periodic sentences while preserving meaning
4. **Punctuation** — modernize capitalization, punctuation, and emphasis
5. **Grammar** — update archaic forms ("hath" → "has", "doth" → "does")

**What to keep:**
- All substantive content (don't summarize or skip anything)
- Key names, titles, and proper nouns
- The author's arguments, reasoning, and rhetorical structure

**IMPORTANT - Translate ALL embedded foreign languages to English:**
Use <note>original: "..."</note> to preserve important original phrases.

**Do NOT use:**
- Code blocks or backticks — this is prose

**Instructions:**
1. Start with <meta>...</meta> if noting continuity with previous page.
2. Mirror the source layout — headings, paragraphs, tables, centered text.
3. Modernize ALL text including <margin>, <insert>, <gloss> — keep the XML tags.
4. Translate any Latin/Greek/Hebrew phrases to English.
5. Add <note>...</note> inline to explain historical references.
6. Preserve the voice and spirit of the original.
7. END with <summary>...</summary> and <keywords>...</keywords> for indexing.

**Final output format:**
[modernized text]

<summary>1-2 sentence summary of this page's main content and significance</summary>
<keywords>key concepts, names, themes — for indexing</keywords>`;

function extractTranslationMetadata(text) {
  const result = {};
  const summaryMatch = text.match(/<summary>([\s\S]*?)<\/summary>/i);
  if (summaryMatch) {
    const s = summaryMatch[1].trim();
    if (s.length > 0) result.translation_summary = s;
  }
  const keywordsMatch = text.match(/<keywords>([\s\S]*?)<\/keywords>/i);
  if (keywordsMatch) {
    const raw = keywordsMatch[1].trim();
    if (raw.length > 0) {
      const kw = raw.split(/[,;]\s*|\s+-\s+/).map(k => k.trim()).filter(k => k.length > 0);
      if (kw.length > 0) result.translation_keywords = [...new Set(kw)];
    }
  }
  return result;
}

/**
 * Translate a single page via direct Gemini realtime call.
 * Returns the translation text (for use as context for the next page).
 */
async function translatePage(db, page, sourceLanguage, previousTranslation) {
  const apiKey = process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY;
  const url = `${GEMINI_API_BASE}/models/${TRANSLATE_MODEL}:generateContent?key=${apiKey}`;

  const isEnglish = sourceLanguage.toLowerCase() === 'english';
  const basePrompt = isEnglish ? ENGLISH_MODERNIZATION_PROMPT : TRANSLATION_PROMPT;
  let prompt = basePrompt
    .replace('{source_language}', sourceLanguage)
    .replace('{target_language}', 'English');

  prompt += isEnglish
    ? `\n\n**Text to modernize:**\n${page.ocr.data}`
    : `\n\n**Text to translate:**\n${page.ocr.data}`;

  if (previousTranslation) {
    prompt += isEnglish
      ? `\n\n**Previous page (modernized) for continuity:**\n${previousTranslation.slice(0, 2000)}...`
      : `\n\n**Previous page translation for continuity:**\n${previousTranslation.slice(0, 2000)}...`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini ${response.status}: ${errText.substring(0, 300)}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const usage = data.usageMetadata || {};
  const inputTokens = usage.promptTokenCount || 0;
  const outputTokens = usage.candidatesTokenCount || 0;

  if (!text) throw new Error('Empty response from Gemini');

  // Extract metadata from translation output
  const meta = extractTranslationMetadata(text);

  // Save translation to page
  await db.collection('pages').updateOne(
    { id: page.id },
    {
      $set: {
        'translation.data': text,
        'translation.language': 'English',
        'translation.model': TRANSLATE_MODEL,
        'translation.updated_at': new Date(),
        'translation.source': 'ai',
        'translation.prompt_version': TRANSLATE_PROMPT_VERSION,
        ...meta,
        updated_at: new Date(),
      },
    }
  );

  // Log usage (fire-and-forget)
  const costUsd = (inputTokens / 1_000_000) * 0.50 + (outputTokens / 1_000_000) * 3.00;
  db.collection('gemini_usage').insertOne({
    type: 'translation',
    mode: 'realtime',
    model: TRANSLATE_MODEL,
    book_id: page.book_id,
    page_ids: [page.id],
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: costUsd,
    status: 'success',
    endpoint: 'hetzner/pipeline-orchestrator',
    timestamp: new Date(),
  }).catch(() => {});

  return { text, inputTokens, outputTokens, costUsd };
}

// Sources whose pages need archiving
const ARCHIVABLE_SOURCES = /archive\.org|gallica\.bnf\.fr|digitale-sammlungen\.de|digi\.vatlib\.it|diglib\.hab\.de|e-rara|wellcomecollection|cudl\.lib\.cam|digital\.bodleian/;

console.log(`[pipeline-orchestrator] Base URL: ${BASE_URL} | Dry run: ${DRY_RUN}${ONLY_PHASE !== null ? ` | Phase: ${ONLY_PHASE}` : ''}`);

// ── Helpers ──

function headers() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${CRON_SECRET}`,
  };
}

// ── Inline metadata verification (replaces Vercel POST /api/books/[id]/verify-metadata) ──
// Searches external_catalog (EFM/IA) and USTC (Supabase) for catalog matches,
// then applies high-confidence suggestions to fill missing/Unknown fields.
// No Gemini dependency — pure catalog lookups.

const SUPABASE_URL = 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlraHhhZWNiYnhhYXFsdWp1emRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUwNjExMDEsImV4cCI6MjA4MDYzNzEwMX0.O2chfnHGQWLOaVSFQ-F6UJMlya9EzPbsUh848SEOPj4';

function metaNormalize(text) {
  if (!text) return '';
  return text.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

function metaSimilarity(a, b) {
  const normA = metaNormalize(a);
  const normB = metaNormalize(b);
  if (!normA || !normB) return 0;
  const wordsA = new Set(normA.split(' ').filter(w => w.length > 2));
  const wordsB = new Set(normB.split(' ').filter(w => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  return Math.round((intersection / union) * 100);
}

function extractYear(text) {
  if (!text) return undefined;
  const match = text.match(/\b(1[4-9]\d{2}|20[0-2]\d)\b/);
  return match ? match[1] : undefined;
}

async function verifyMetadataInline(db, book) {
  const matches = [];

  // 1. Search local external_catalog (EFM + IA)
  const searchTerms = [book.title, book.author]
    .filter(Boolean)
    .join(' ')
    .split(' ')
    .filter(w => w.length >= 3)
    .slice(0, 3);

  if (searchTerms.length > 0) {
    const wordConditions = searchTerms.map(word => ({
      $or: [
        { title: { $regex: word, $options: 'i' } },
        { author: { $regex: word, $options: 'i' } },
      ]
    }));

    const catalogDocs = await db.collection('external_catalog')
      .find({ $and: wordConditions })
      .limit(20)
      .toArray();

    for (const doc of catalogDocs) {
      const titleSim = metaSimilarity(book.title, doc.title);
      const authorSim = metaSimilarity(book.author, doc.author);
      const confidence = Math.round((titleSim * 0.7) + (authorSim * 0.3));
      if (confidence > 30) {
        matches.push({
          source: doc.source === 'bph' ? 'EFM' : 'IA',
          confidence,
          year: doc.year?.toString(),
          language: doc.language,
          place: doc.placeOfPublication,
          publisher: doc.publisher,
        });
      }
    }
  }

  // 2. Search USTC via Supabase
  try {
    const supaHeaders = {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    };
    const searchQuery = metaNormalize(book.title).split(' ').slice(0, 3).join(' ');
    if (searchQuery.length >= 3) {
      const enrichedUrl = new URL(`${SUPABASE_URL}/rest/v1/ustc_enrichments`);
      enrichedUrl.searchParams.set('select', 'id,std_title,english_title,detected_language,original_author');
      enrichedUrl.searchParams.set('limit', '10');
      enrichedUrl.searchParams.set('or', `(std_title.ilike.*${searchQuery}*,english_title.ilike.*${searchQuery}*,original_author.ilike.*${searchQuery}*)`);

      const enrichRes = await fetch(enrichedUrl.toString(), { headers: supaHeaders });
      if (enrichRes.ok) {
        const enrichData = await enrichRes.json();
        for (const row of enrichData) {
          const titleSim = Math.max(
            metaSimilarity(book.title, row.std_title || ''),
            metaSimilarity(book.title, row.english_title || '')
          );
          const authorSim = metaSimilarity(book.author, row.original_author || '');
          const confidence = Math.round((titleSim * 0.7) + (authorSim * 0.3));
          if (confidence > 30) {
            // Fetch edition data for year/place
            const edUrl = new URL(`${SUPABASE_URL}/rest/v1/ustc_editions`);
            edUrl.searchParams.set('select', 'year,place,language_1');
            edUrl.searchParams.set('id', `eq.${row.id}`);
            const edRes = await fetch(edUrl.toString(), { headers: supaHeaders });
            const edData = edRes.ok ? await edRes.json() : [];
            const edition = edData[0];
            matches.push({
              source: 'USTC',
              confidence,
              year: edition?.year?.toString(),
              language: row.detected_language || edition?.language_1,
              place: edition?.place,
              publisher: undefined,
            });
          }
        }
      }
    }
  } catch (e) {
    console.log(`  [metadata] USTC search error for ${book.id}: ${e.message}`);
  }

  // Sort by confidence, pick best
  matches.sort((a, b) => b.confidence - a.confidence);
  const bestMatch = matches[0];
  if (!bestMatch || bestMatch.confidence <= 60) {
    return { applied: 0, matches: matches.length };
  }

  // Build updates — only fill missing/Unknown fields
  const updates = { updated_at: new Date() };
  const changes = [];

  if ((!book.published || book.published === 'Unknown') && bestMatch.year) {
    const yr = extractYear(bestMatch.year) || bestMatch.year;
    updates.published = yr;
    changes.push({ field: 'published', previous: book.published, new_value: yr });
  }
  if ((!book.language || book.language === 'Unknown') && bestMatch.language && bestMatch.language !== 'Unknown') {
    updates.language = bestMatch.language;
    changes.push({ field: 'language', previous: book.language, new_value: bestMatch.language });
  }
  if (!book.place_of_publication && bestMatch.place) {
    updates.place_of_publication = bestMatch.place;
    changes.push({ field: 'place_of_publication', previous: null, new_value: bestMatch.place });
  }
  if (!book.publisher && bestMatch.publisher) {
    updates.publisher = bestMatch.publisher;
    changes.push({ field: 'publisher', previous: null, new_value: bestMatch.publisher });
  }

  if (changes.length === 0) {
    return { applied: 0, matches: matches.length };
  }

  // Set field_provenance for each changed field
  const provenance = {
    source: 'metadata_verification',
    verified_source: bestMatch.source,
    confidence: bestMatch.confidence,
    date: new Date(),
  };
  for (const c of changes) {
    updates[`field_provenance.${c.field}`] = { ...provenance, previous_value: c.previous };
  }

  // Record verification metadata
  updates.metadata_verified = {
    date: new Date(),
    source: bestMatch.source,
    confidence: bestMatch.confidence,
    changes: changes.map(c => `${c.field}: ${c.previous || 'none'} → ${c.new_value}`),
  };

  await db.collection('books').updateOne({ id: book.id }, { $set: updates });

  // Append-only changelog
  try {
    await db.collection('book_metadata_changelog').insertOne({
      id: nanoid(12),
      book_id: book.id,
      source: 'catalog_verification',
      changes,
      note: `Source: ${bestMatch.source}, confidence: ${bestMatch.confidence}`,
      timestamp: new Date(),
    });
  } catch { /* non-fatal */ }

  return { applied: changes.length, matches: matches.length, source: bestMatch.source, confidence: bestMatch.confidence };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function setPipelineStatus(db, bookId, status, extra = {}) {
  const book = await db.collection('books').findOne(
    { id: bookId },
    { projection: { 'pipeline_auto.status': 1, title: 1 } }
  );
  const prevStatus = book?.pipeline_auto?.status;

  await db.collection('books').updateOne(
    { id: bookId },
    {
      $set: {
        'pipeline_auto.status': status,
        'pipeline_auto.last_updated': new Date(),
        ...Object.fromEntries(
          Object.entries(extra).map(([k, v]) => [`pipeline_auto.${k}`, v])
        ),
        updated_at: new Date(),
      },
    }
  );

  // Audit trail (fire-and-forget)
  if (prevStatus !== status) {
    db.collection('audit_log').insertOne({
      action: 'pipeline_status_changed',
      book_id: bookId,
      book_title: book?.title,
      metadata: { from: prevStatus || 'none', to: status, source: 'hetzner-worker', ...extra },
      timestamp: new Date(),
    }).catch(() => {});
  }
}

async function markFailed(db, bookId, error, retryCount) {
  await setPipelineStatus(db, bookId, 'failed', { error, retry_count: retryCount });
}

function shouldRun(phase) {
  return ONLY_PHASE === null || ONLY_PHASE === phase;
}

// ── Gemini Batch API helpers (direct OCR submission, no Vercel) ──

// All keys for rotation — try each until one works (batch jobs are per-key)
// KEY_2 moved to end: frequently quota-exhausted, let healthy keys go first
const GEMINI_BATCH_KEYS = [
  process.env.GEMINI_API_KEY_TIER3,
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
].filter(k => !!k);

function getGeminiApiKey(keyIndex = 0) {
  const key = GEMINI_BATCH_KEYS[keyIndex] || GEMINI_BATCH_KEYS[0];
  if (!key) throw new Error('No GEMINI_API_KEY found in env');
  return key;
}

function getPageImageUrl(page) {
  if (page.crop && page.cropped_photo) return page.cropped_photo;
  if (page.archived_photo && !page.archived_photo.startsWith('failed:')) return page.archived_photo;
  return page.photo_original || page.photo || null;
}

async function fetchImageBase64(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    return {
      data: Buffer.from(buffer).toString('base64'),
      mimeType: contentType.split(';')[0].trim(),
    };
  } catch {
    return null;
  }
}

async function downloadImagesParallel(pages, concurrency) {
  const results = [];
  for (let i = 0; i < pages.length; i += concurrency) {
    const chunk = pages.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      chunk.map(async (page) => {
        const url = getPageImageUrl(page);
        if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) return null;
        const image = await fetchImageBase64(url);
        if (!image) return null;
        return { pageId: page.id, image };
      })
    );
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) {
        results.push(r.value);
      }
    }
  }
  return results;
}

async function createBatchJobInline(model, requests, displayName) {
  // Try each API key — rotate on quota exhaustion (429)
  for (let ki = 0; ki < GEMINI_BATCH_KEYS.length; ki++) {
    const apiKey = getGeminiApiKey(ki);
    const response = await fetch(
      `${GEMINI_API_BASE}/models/${model}:batchGenerateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batch: {
            display_name: displayName,
            input_config: {
              requests: { requests },
            },
          },
        }),
      }
    );

    if (response.ok) {
      const result = await response.json();
      return { name: result.name, state: result.state || 'JOB_STATE_PENDING' };
    }

    const errorText = await response.text();
    console.log(`    Key ${ki} failed (${response.status}): ${errorText.substring(0, 100)}`);
    if (response.status === 429) {
      continue;
    }
    throw new Error(`Batch create failed (${response.status}): ${errorText.substring(0, 200)}`);
  }
  throw new Error('ALL_KEYS_QUOTA_EXHAUSTED');
}

/**
 * Upload JSONL content to Gemini File API for file-based batch submission.
 * Uses resumable upload protocol. Returns { name, uri } of uploaded file.
 */
async function uploadBatchFile(jsonlContent, displayName, apiKey) {
  const contentLength = Buffer.byteLength(jsonlContent);

  // Step 1: Start resumable upload (text/plain as workaround for Gemini JSONL bug)
  const startResponse = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': contentLength.toString(),
        'X-Goog-Upload-Header-Content-Type': 'text/plain',
      },
      body: JSON.stringify({ file: { displayName } }),
    }
  );

  if (!startResponse.ok) {
    const error = await startResponse.text();
    throw new Error(`File upload start failed: ${error.substring(0, 200)}`);
  }

  const uploadUrl = startResponse.headers.get('X-Goog-Upload-URL');
  if (!uploadUrl) throw new Error('No upload URL returned from File API');

  // Step 2: Upload the content
  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'text/plain',
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Offset': '0',
    },
    body: jsonlContent,
  });

  if (!uploadResponse.ok) {
    const error = await uploadResponse.text();
    throw new Error(`File upload failed: ${error.substring(0, 200)}`);
  }

  const fileInfo = await uploadResponse.json();
  if (!fileInfo.file?.name) {
    throw new Error(`File upload response missing 'file.name': ${JSON.stringify(fileInfo).substring(0, 200)}`);
  }

  return { name: fileInfo.file.name, uri: fileInfo.file.uri };
}

/**
 * Create a batch job from an uploaded JSONL file.
 * Tries all API keys on quota exhaustion (429).
 */
async function createBatchJobFromFile(model, fileName, displayName, preferredKeyIndex = 0) {
  for (let ki = preferredKeyIndex; ki < GEMINI_BATCH_KEYS.length; ki++) {
    const apiKey = getGeminiApiKey(ki);
    const response = await fetch(
      `${GEMINI_API_BASE}/models/${model}:batchGenerateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batch: {
            display_name: displayName,
            input_config: { file_name: fileName },
          },
        }),
      }
    );

    if (response.ok) {
      const result = await response.json();
      return { name: result.name, state: result.state || 'JOB_STATE_PENDING', keyIndex: ki };
    }

    const errorText = await response.text();
    console.log(`    Key ${ki} failed for file batch (${response.status}): ${errorText.substring(0, 100)}`);
    if (response.status === 429) continue;
    throw new Error(`File batch create failed (${response.status}): ${errorText.substring(0, 200)}`);
  }
  throw new Error('ALL_KEYS_QUOTA_EXHAUSTED');
}

async function getOcrPromptFromDb(db) {
  const prompt = await db.collection('prompts').findOne(
    { type: 'ocr', is_default: true },
    { sort: { version: -1 } }
  );
  if (!prompt?.content) throw new Error('No default OCR prompt found in DB');

  const languageInstruction = `**Source language:** Detect the primary language from the text. Pages may contain multiple languages — transcribe all of them. Report the primary language in the <language> tag (e.g. <language>Latin</language>).`;

  return prompt.content
    .replace('{language_instruction}', languageInstruction)
    .replace('{language}', '');
}

/**
 * Submit OCR for a single book directly to Gemini Batch API.
 * Downloads images on Hetzner, then submits via:
 *   - Inline batch for ≤20 pages (base64 in HTTP body, simple)
 *   - File-based batch for >20 pages (JSONL uploaded to File API, ~150 pages/job)
 *
 * This is a 7.5x improvement in quota efficiency vs the old 20-page-per-job approach.
 * A 300-page book now uses 2 batch jobs instead of 15.
 */
async function submitOcrDirectly(db, book, { modelOverride, maxPages } = {}) {
  const ocrModel = modelOverride || getOcrModelForBook(book);
  const pageLimit = maxPages || MAX_PAGES_PER_BOOK;
  // Guard: check for existing active batch_jobs for this book
  const activeBatchForBook = await db.collection('batch_jobs').countDocuments({
    book_id: book.id,
    type: 'ocr',
    status: { $in: ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'] },
  });
  if (activeBatchForBook > 0) {
    console.log(`    Skipping: ${activeBatchForBook} active batch jobs already exist for this book`);
    return { submitted: 0, jobName: null, alreadyDone: false, skippedDuplicate: true };
  }

  // Find pages needing OCR
  const pages = await db.collection('pages')
    .find({
      book_id: book.id,
      $or: [
        { 'ocr.data': { $exists: false } },
        { 'ocr.data': null },
        { 'ocr.data': '' },
      ],
      $and: [{
        $or: [
          { photo: { $exists: true, $ne: null } },
          { photo_original: { $exists: true, $ne: null } },
        ]
      }]
    })
    .sort({ page_number: 1 })
    .limit(pageLimit)
    .project({ _id: 0, id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, crop: 1 })
    .toArray();

  if (pages.length === 0) {
    return { submitted: 0, jobName: null, alreadyDone: true };
  }

  // Guard: skip pages that are unsplit spreads (have no crop but book needs splitting)
  // These would send two-page images to OCR, producing garbled results
  // BUT: if the book was already split_checked, it passed Phase 1.25 and was determined
  // to be portrait/single-page — no crop data expected, safe to OCR as-is.
  const unsplitPages = pages.filter(p => !p.crop && !p.cropped_photo);
  if (unsplitPages.length > 0 && unsplitPages.length === pages.length && !book.pipeline_auto?.split_checked) {
    // All pages are unsplit AND book hasn't been through split detection
    console.log(`    WARNING: All ${pages.length} pages lack crop data — possible unsplit spreads, skipping OCR (#523)`);
    return { submitted: 0, jobName: null, alreadyDone: false, skippedUnsplit: true };
  }

  console.log(`    Downloading ${pages.length} images...`);
  const downloaded = await downloadImagesParallel(pages, IMAGE_CONCURRENCY);
  if (downloaded.length === 0) {
    throw new Error(`All ${pages.length} image downloads failed`);
  }
  console.log(`    Downloaded ${downloaded.length}/${pages.length} images`);

  let prompt = await getOcrPromptFromDb(db);

  // Append book provenance context to help Gemini avoid recitation blocks
  // on public domain works it mistakes for copyrighted material
  const yearStr = book.year ? `Published ${book.year}.` : '';
  const copyrightNote = book.year && book.year < 1930
    ? 'This work is in the public domain.'
    : '';
  if (yearStr || book.title) {
    prompt += `\n\n**Document context:** "${book.title || 'Unknown'}" by ${book.author || 'Unknown'}. ${yearStr} ${copyrightNote}`.trim();
  }

  // Choose batch size based on page count
  const useFileBased = downloaded.length > OCR_INLINE_BATCH_SIZE;
  const batchSize = useFileBased ? OCR_FILE_BATCH_SIZE : OCR_INLINE_BATCH_SIZE;

  const parentJobId = nanoid();
  const childJobIds = [];
  let totalSubmitted = 0;
  let firstJobName = null;

  for (let j = 0; j < downloaded.length; j += batchSize) {
    const chunk = downloaded.slice(j, j + batchSize);
    const childJobId = nanoid();
    const displayName = `pipeline-ocr-${book.id}-${childJobId}`;
    let batchJob;

    if (useFileBased) {
      // File-based: build JSONL, upload, submit one batch job per chunk
      console.log(`    Building JSONL for ${chunk.length} pages (file-based)...`);
      const jsonlLines = chunk.map(item => JSON.stringify({
        request: {
          contents: [{
            parts: [
              { text: prompt },
              { inlineData: { mimeType: item.image.mimeType, data: item.image.data } },
            ],
          }],
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 16384,
            thinkingConfig: { thinkingBudget: 0 },
          },
        },
        metadata: { key: item.pageId },
      }));
      const jsonlContent = jsonlLines.join('\n');
      const jsonlSizeMB = (Buffer.byteLength(jsonlContent) / 1024 / 1024).toFixed(1);
      console.log(`    JSONL size: ${jsonlSizeMB} MB for ${chunk.length} pages`);

      // Upload JSONL to Gemini File API — try all keys on quota exhaustion
      let fileResult;
      let uploadKeyIndex = -1;
      for (let uki = 0; uki < GEMINI_BATCH_KEYS.length; uki++) {
        const uploadKey = getGeminiApiKey(uki);
        try {
          fileResult = await uploadBatchFile(jsonlContent, displayName, uploadKey);
          uploadKeyIndex = uki;
          console.log(`    Uploaded file: ${fileResult.name} (key ${uki})`);
          break;
        } catch (uploadErr) {
          if (uploadErr.message.includes('429') || uploadErr.message.includes('quota')) {
            console.log(`    Upload key ${uki} quota exhausted, trying next...`);
            continue;
          }
          throw uploadErr;
        }
      }
      if (!fileResult) throw new Error('ALL_KEYS_QUOTA_EXHAUSTED');

      // Create batch job from the uploaded file — must use same key that uploaded it
      batchJob = await createBatchJobFromFile(ocrModel, fileResult.name, displayName, uploadKeyIndex);

      // Clean up uploaded file immediately — Gemini copies it into the batch job,
      // so the source file is no longer needed. Prevents hitting 20GB storage quota.
      try {
        await fetch(`https://generativelanguage.googleapis.com/v1beta/${fileResult.name}?key=${getGeminiApiKey(uploadKeyIndex)}`, { method: 'DELETE' });
      } catch (cleanupErr) {
        console.log(`    Warning: file cleanup failed: ${cleanupErr.message}`);
      }
    } else {
      // Inline: small batch, embed base64 directly in request body
      const inlineRequests = chunk.map(item => ({
        request: {
          contents: [{
            parts: [
              { text: prompt },
              { inlineData: { mimeType: item.image.mimeType, data: item.image.data } },
            ],
          }],
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_CIVIC_INTEGRITY', threshold: 'BLOCK_NONE' },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 16384,
            thinkingConfig: { thinkingBudget: 0 },
          },
        },
        metadata: { key: item.pageId },
      }));
      batchJob = await createBatchJobInline(ocrModel, inlineRequests, displayName);
    }

    if (!firstJobName) firstJobName = batchJob.name;

    // Record in batch_jobs
    await db.collection('batch_jobs').insertOne({
      id: childJobId,
      parent_job_id: parentJobId,
      job_name: batchJob.name,
      type: 'ocr',
      book_id: book.id,
      page_ids: chunk.map(c => c.pageId),
      page_count: chunk.length,
      status: 'pending',
      model: ocrModel,
      prompt_version: OCR_PROMPT_VERSION,
      submission_method: useFileBased ? 'file' : 'inline',
      force: false,
      created_at: new Date(),
      updated_at: new Date(),
    });

    childJobIds.push(childJobId);
    totalSubmitted += chunk.length;

    // Log to gemini_usage
    await db.collection('gemini_usage').insertOne({
      type: 'ocr',
      mode: 'batch',
      model: ocrModel,
      book_id: book.id,
      book_title: book.title,
      page_ids: chunk.map(c => c.pageId),
      page_count: chunk.length,
      batch_job_id: childJobId,
      gemini_job_name: batchJob.name,
      input_tokens: 0,
      output_tokens: 0,
      status: 'submitted',
      endpoint: 'hetzner/pipeline-orchestrator',
      submission_method: useFileBased ? 'file' : 'inline',
      timestamp: new Date(),
    });
  }

  // Create parent job if multiple children
  if (childJobIds.length > 1) {
    await db.collection('batch_jobs').insertOne({
      id: parentJobId,
      type: 'ocr',
      book_id: book.id,
      child_job_ids: childJobIds,
      total_pages: totalSubmitted,
      status: 'pending',
      model: ocrModel,
      prompt_version: OCR_PROMPT_VERSION,
      created_at: new Date(),
      updated_at: new Date(),
    });
  }

  const method = useFileBased ? 'file-based' : 'inline';
  return { submitted: totalSubmitted, jobName: firstJobName || parentJobId, childCount: childJobIds.length, method };
}

// ── Main ──

async function run() {
  const startTime = Date.now();
  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 30000 });
  await client.connect();
  const db = client.db('bookstore');

  // Emergency stop check
  const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
  if (control?.paused) {
    console.log('[pipeline-orchestrator] PAUSED by emergency stop. Exiting.');
    await client.close();
    return;
  }

  // DB health probe — adjusts submission limits based on Atlas load
  const healthGrade = await probeDbHealth(db);
  if (healthGrade === 'critical') {
    console.log('[pipeline-orchestrator] DB critical — running with minimum limits. Will skip heavy phases.');
  }

  const log = {
    enrolled: 0,
    archived: 0,
    preview_queued: 0,
    ocr_submitted: 0,
    ocr_advanced: 0,
    metadata_enriched: 0,
    metadata_skipped: 0,
    transliterated: 0,
    transliterate_pages: 0,
    translate_submitted: 0,
    translate_advanced: 0,
    enriched: 0,
    chapters_extracted: 0,
    chapters_skipped: 0,
    images_submitted: 0,
    images_advanced: 0,
    covers_selected: 0,
    digitizer_pages_hidden: 0,
    finalized: 0,
    needs_attention: 0,
    stale_retried: 0,
    stale_failed: 0,
    zombie_jobs_cancelled: 0,
    errors: [],
  };

  try {
    // ── Phase 0: Auto-enroll recently imported books ──
    if (shouldRun(0)) {
      console.log('\n--- Phase 0: Auto-enroll ---');
      const cutoff = new Date(Date.now() - ENROLL_WINDOW_DAYS * 24 * 60 * 60 * 1000);
      const newBooks = await db.collection('books')
        .find({
          pipeline_auto: { $exists: false },
          created_at: { $gte: cutoff },
        })
        .project({ id: 1 })
        .limit(ENROLL_LIMIT)
        .toArray();

      if (DRY_RUN) {
        console.log(`  Would enroll ${newBooks.length} books`);
      } else {
        for (const book of newBooks) {
          await db.collection('books').updateOne(
            { id: book.id },
            {
              $set: {
                pipeline_auto: {
                  status: 'queued',
                  source: 'cron',
                  queued_at: new Date(),
                  last_updated: new Date(),
                  retry_count: 0,
                },
                updated_at: new Date(),
              },
            }
          );
          log.enrolled++;
        }
      }
      console.log(`  Enrolled: ${log.enrolled}`);
    }

    // ── Phase 1: Archive check (queued/archiving -> archive_complete) ──
    if (shouldRun(1)) {
      console.log('\n--- Phase 1: Archive check ---');

      // Move queued -> archiving
      // Priority: confirmed first translations > non-English (likely first) > English
      const ENGLISH_VARIANTS_P1 = ['english', 'eng', 'en'];
      const queuedBooks = await db.collection('books')
        .aggregate([
          { $match: { 'pipeline_auto.status': 'queued' } },
          { $addFields: {
            _priority: {
              $switch: {
                branches: [
                  { case: { $eq: ['$is_first_translation', true] }, then: 0 },
                  { case: { $in: [{ $toLower: { $ifNull: ['$language', ''] } }, ENGLISH_VARIANTS_P1] }, then: 2 },
                ],
                default: 1,
              },
            },
          }},
          { $sort: { _priority: 1, hidden: 1 } },
          { $project: { id: 1 } },
          { $limit: ARCHIVE_LIMIT },
        ])
        .toArray();

      if (!DRY_RUN) {
        for (const book of queuedBooks) {
          await setPipelineStatus(db, book.id, 'archiving', { started_at: new Date() });
          log.archived++;
        }
      }
      console.log(`  Queued -> archiving: ${queuedBooks.length}`);

      // Check archiving books for completion
      // Priority: confirmed first translations > non-English > English
      const archivingBooks = await db.collection('books')
        .aggregate([
          { $match: { 'pipeline_auto.status': 'archiving' } },
          { $addFields: {
            _priority: {
              $switch: {
                branches: [
                  { case: { $eq: ['$is_first_translation', true] }, then: 0 },
                  { case: { $in: [{ $toLower: { $ifNull: ['$language', ''] } }, ENGLISH_VARIANTS_P1] }, then: 2 },
                ],
                default: 1,
              },
            },
          }},
          { $sort: { _priority: 1, hidden: 1 } },
          { $project: { id: 1 } },
          { $limit: ARCHIVE_LIMIT },
        ])
        .toArray();

      let archiveCompleted = 0;
      for (const book of archivingBooks) {
        const remaining = await db.collection('pages').countDocuments({
          book_id: book.id,
          $or: [
            { archived_photo: { $exists: false } },
            { archived_photo: { $regex: /^failed:/ } },
          ],
          $and: [{
            $or: [
              { photo: { $regex: ARCHIVABLE_SOURCES } },
              { photo_original: { $regex: ARCHIVABLE_SOURCES } },
            ],
          }],
        });

        if (remaining === 0) {
          if (!DRY_RUN) {
            await setPipelineStatus(db, book.id, 'archive_complete', { retry_count: 0 });

            // Auto-unhide books that were hidden because they were unarchived
            const bookDoc = await db.collection('books').findOne(
              { id: book.id, hidden: true, hidden_reason: 'unarchived' },
              { projection: { id: 1, title: 1 } }
            );
            if (bookDoc) {
              await db.collection('books').updateOne(
                { id: book.id },
                { $set: { hidden: false, updated_at: new Date() }, $unset: { hidden_reason: '' } }
              );
              console.log(`    ✓ Auto-unhidden: ${bookDoc.title?.slice(0, 60)}`);
            }
          }
          archiveCompleted++;
          log.archived++;
        }
      }
      console.log(`  Archive completed: ${archiveCompleted}/${archivingBooks.length}`);
    }

    // ── Phase 1.25: Split detection for spread scans ──
    // Checks archive_complete books for two-page spreads (landscape aspect ratio).
    // Center-splits spreads inline (no API call), uploads cropped halves to R2.
    // Based on batch-split-bph.mjs by Mayank. Must run BEFORE OCR.
    // See: https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/264
    if (shouldRun(1.25)) {
      console.log('\n--- Phase 1.25: Split detection (spread → individual pages) ---');

      const SPLIT_LIMIT = 100; // Max books per cycle (increased from 10)
      const ASPECT_RATIO_THRESHOLD = 1.2; // Width/height > 1.2 = likely spread

      // Find archive_complete books that haven't been split-checked yet
      const candidates = await db.collection('books')
        .find({
          'pipeline_auto.status': 'archive_complete',
          'pipeline_auto.split_checked': { $ne: true },
          preview_ocr_queued_at: { $exists: false }, // Not yet in OCR
        })
        .sort({ hidden: 1 })
        .project({ id: 1, title: 1, pages_count: 1 })
        .limit(SPLIT_LIMIT)
        .toArray();

      console.log(`  Candidates for split check: ${candidates.length}`);

      let splitChecked = 0;
      let splitApplied = 0;

      for (const book of candidates) {
        try {
          const label = (book.title || '').substring(0, 50);

          // Sample first 3 pages to check aspect ratio
          const samplePages = await db.collection('pages')
            .find({ book_id: book.id, crop: { $exists: false } })
            .sort({ page_number: 1 })
            .limit(3)
            .project({ id: 1, photo: 1, photo_original: 1, archived_photo: 1 })
            .toArray();

          if (samplePages.length === 0) {
            // No pages without crop — already split or single-page
            if (!DRY_RUN) {
              await db.collection('books').updateOne(
                { id: book.id },
                { $set: { 'pipeline_auto.split_checked': true, 'pipeline_auto.last_updated': new Date() } }
              );
            }
            splitChecked++;
            continue;
          }

          // Check aspect ratio of first available image
          let isSpread = false;
          for (const page of samplePages) {
            const imageUrl = page.archived_photo || page.photo_original || page.photo;
            if (!imageUrl) continue;

            try {
              const res = await fetch(imageUrl, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
              // Can't get dimensions from HEAD. Download a small version and check.
              const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
              if (!imgRes.ok) continue;
              const buffer = Buffer.from(await imgRes.arrayBuffer());
              const sharp = (await import('sharp')).default;
              const meta = await sharp(buffer).metadata();
              if (meta.width && meta.height) {
                const ratio = meta.width / meta.height;
                console.log(`    ${label}: page ${page.id} aspect ratio = ${ratio.toFixed(2)}`);
                if (ratio > ASPECT_RATIO_THRESHOLD) {
                  isSpread = true;
                }
                break; // One sample is enough
              }
            } catch (err) {
              console.log(`    ${label}: failed to check aspect ratio: ${err.message?.slice(0, 80)}`);
            }
          }

          if (!isSpread) {
            // Not a spread — mark as checked and move on
            if (!DRY_RUN) {
              await db.collection('books').updateOne(
                { id: book.id },
                { $set: { 'pipeline_auto.split_checked': true, 'pipeline_auto.last_updated': new Date() } }
              );
            }
            console.log(`    ${label}: not a spread (portrait pages), skipping`);
            splitChecked++;
            continue;
          }

          // It's a spread — center-split inline (from batch-split-bph.mjs)
          console.log(`    ${label}: SPREAD detected, running center-split...`);

          if (DRY_RUN) {
            console.log(`    Would split: ${label}`);
            continue;
          }

          const r2 = getR2Client();
          const sharp = (await import('sharp')).default;

          // Get all pages for this book
          const allBookPages = await db.collection('pages')
            .find({ book_id: book.id })
            .sort({ page_number: 1 })
            .toArray();

          const newPages = [];
          const updateOps = [];
          let bookSplitCount = 0;
          let bookSingleCount = 0;
          let bookErrors = 0;

          await parallelMap(allBookPages, async (page) => {
            try {
              const imgUrl = page.archived_photo || page.photo_original || page.photo;
              if (!imgUrl) return;

              const imgRes = await fetch(imgUrl, { signal: AbortSignal.timeout(30000) });
              if (!imgRes.ok) return;
              const buf = Buffer.from(await imgRes.arrayBuffer());
              const pageMeta = await sharp(buf).metadata();
              const pageRatio = (pageMeta.width || 1) / (pageMeta.height || 1);

              if (pageRatio <= ASPECT_RATIO_THRESHOLD) {
                bookSingleCount++;
                return;
              }

              // Center-split
              const imgWidth = pageMeta.width || 1000;
              const imgHeight = pageMeta.height || 1000;
              const splitX = Math.round(imgWidth / 2);
              const overlapPx = Math.round(SPLIT_OVERLAP * imgWidth / 1000);

              const leftBuf = await sharp(buf)
                .extract({ left: 0, top: 0, width: Math.min(imgWidth, splitX + overlapPx), height: imgHeight })
                .jpeg({ quality: SPLIT_CROPPED_QUALITY, progressive: true })
                .toBuffer();

              const rightBuf = await sharp(buf)
                .extract({ left: Math.max(0, splitX - overlapPx), top: 0, width: Math.min(imgWidth, imgWidth - splitX + overlapPx), height: imgHeight })
                .jpeg({ quality: SPLIT_CROPPED_QUALITY, progressive: true })
                .toBuffer();

              const [leftDisplay, leftThumb, rightDisplay, rightThumb] = await Promise.all([
                sharp(leftBuf).resize(SPLIT_DISPLAY_WIDTH).jpeg({ quality: SPLIT_DISPLAY_QUALITY }).toBuffer(),
                sharp(leftBuf).resize(SPLIT_THUMB_WIDTH).jpeg({ quality: SPLIT_THUMB_QUALITY }).toBuffer(),
                sharp(rightBuf).resize(SPLIT_DISPLAY_WIDTH).jpeg({ quality: SPLIT_DISPLAY_QUALITY }).toBuffer(),
                sharp(rightBuf).resize(SPLIT_THUMB_WIDTH).jpeg({ quality: SPLIT_THUMB_QUALITY }).toBuffer(),
              ]);

              const leftPaths = splitPagePaths(book.id, page.page_number);
              const rightPageId = new ObjectId().toHexString();
              const rightTempKey = `pages/${book.id}/split-${rightPageId}`;

              const [leftFullUrl, , leftThumbUrl] = await Promise.all([
                uploadToR2(r2, leftPaths.full, leftBuf),
                uploadToR2(r2, leftPaths.display, leftDisplay),
                uploadToR2(r2, leftPaths.thumb, leftThumb),
              ]);

              const [rightFullUrl, , rightThumbUrl] = await Promise.all([
                uploadToR2(r2, `${rightTempKey}-full.jpg`, rightBuf),
                uploadToR2(r2, `${rightTempKey}.jpg`, rightDisplay),
                uploadToR2(r2, `${rightTempKey}-thumb.jpg`, rightThumb),
              ]);

              const splitPosition = Math.round((splitX / imgWidth) * 1000);
              const leftCrop = { xStart: 0, xEnd: splitPosition + SPLIT_OVERLAP };
              const rightCrop = { xStart: splitPosition - SPLIT_OVERLAP, xEnd: 1000 };

              updateOps.push({
                updateOne: {
                  filter: { id: page.id },
                  update: {
                    $set: {
                      photo: leftFullUrl,
                      photo_original: page.photo,
                      cropped_photo: leftFullUrl,
                      thumbnail: leftThumbUrl,
                      crop: leftCrop,
                      split_detection: {
                        isTwoPageSpread: true, confidence: 'high', splitPosition,
                        method: 'center-split', detected_at: new Date(),
                      },
                      updated_at: new Date(),
                    },
                    $unset: { ocr: '', translation: '', summary: '' },
                  },
                },
              });

              newPages.push({
                _id: new ObjectId(rightPageId),
                id: rightPageId,
                tenant_id: 'default',
                book_id: book.id,
                page_number: page.page_number + 0.5,
                photo: rightFullUrl,
                photo_original: page.photo,
                cropped_photo: rightFullUrl,
                thumbnail: rightThumbUrl,
                crop: rightCrop,
                split_from: page.id,
                split_detection: {
                  isTwoPageSpread: true, confidence: 'high', splitPosition,
                  method: 'center-split', detected_at: new Date(),
                },
                created_at: new Date(),
                updated_at: new Date(),
              });

              bookSplitCount++;
            } catch (err) {
              console.log(`      page ${page.page_number}: FAIL — ${err.message?.slice(0, 80)}`);
              bookErrors++;
            }
          }, SPLIT_PAGE_CONCURRENCY);

          // Apply DB changes
          if (updateOps.length > 0) await db.collection('pages').bulkWrite(updateOps);
          if (newPages.length > 0) await db.collection('pages').insertMany(newPages);

          // Renumber pages sequentially
          const allPagesAfter = await db.collection('pages')
            .find({ book_id: book.id })
            .sort({ page_number: 1, _id: 1 })
            .toArray();

          const renumberOps = allPagesAfter.map((p, i) => ({
            updateOne: { filter: { _id: p._id }, update: { $set: { page_number: i + 1 } } },
          }));
          if (renumberOps.length > 0) await db.collection('pages').bulkWrite(renumberOps);

          // Update book counts
          const ocrCount = await db.collection('pages').countDocuments({ book_id: book.id, 'ocr.data': { $exists: true, $ne: '' } });
          const translateCount = await db.collection('pages').countDocuments({ book_id: book.id, 'translation.data': { $exists: true, $ne: '' } });

          await db.collection('books').updateOne({ id: book.id }, {
            $set: {
              pages_count: allPagesAfter.length,
              pages_ocr: ocrCount,
              pages_translated: translateCount,
              'pipeline_auto.split_checked': true,
              'pipeline_auto.last_updated': new Date(),
              ...(bookSplitCount > 0 ? {
                'pipeline_auto.split_performed': true,
                'pipeline_auto.split_count': bookSplitCount,
                'pipeline_auto.split_at': new Date(),
              } : {}),
            },
          });

          console.log(`    ${label}: ${bookSplitCount} spreads split, ${bookSingleCount} single → ${allPagesAfter.length} total pages${bookErrors ? `, ${bookErrors} errors` : ''}`);

          splitChecked++;
          if (bookSplitCount > 0) splitApplied++;

        } catch (err) {
          console.log(`    ${book.title?.slice(0, 50)}: ERROR — ${err.message?.slice(0, 120)}`);
        }
      }

      console.log(`  Split checked: ${splitChecked}, splits applied: ${splitApplied}`);
    }

    // ── Phase 1.5: Preview OCR+Translation for first 25 pages via Lambda ──
    // Sends first 25 pages to Lambda OCR queue for fast turnaround.
    // When preview OCR completes, job-completion.ts on Vercel auto-triggers
    // preview translation — giving readers content within minutes, not hours.
    // Prioritizes first English translations.
    if (shouldRun(1.5)) {
      console.log('\n--- Phase 1.5: Preview OCR (first 25 pages via Lambda) ---');

      if (!SQS_OCR_QUEUE_URL) {
        console.log('  SKIP: SQS_PAGE_OCR_QUEUE_URL not configured');
      } else {
        const sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'eu-central-1' });

        // Find archive_complete books that haven't had preview OCR yet.
        // Priority: confirmed first translations > non-English (likely first translations) > English
        const ENGLISH_VARIANTS = ['english', 'eng', 'en'];
        const readyForPreview = await db.collection('books')
          .aggregate([
            { $match: {
              'pipeline_auto.status': 'archive_complete',
              'pipeline_auto.split_checked': true,
              preview_ocr_queued_at: { $exists: false },
            }},
            { $addFields: {
              _priority: {
                $switch: {
                  branches: [
                    { case: { $eq: ['$is_first_translation', true] }, then: 0 },
                    { case: { $in: [{ $toLower: { $ifNull: ['$language', ''] } }, ENGLISH_VARIANTS] }, then: 2 },
                  ],
                  default: 1,  // Non-English = likely first translation
                },
              },
            }},
            { $sort: { _priority: 1, hidden: 1 } },
            { $project: { id: 1, title: 1, language: 1 } },
            { $limit: PREVIEW_LIMIT },
          ])
          .toArray();

        console.log(`  Books ready for preview: ${readyForPreview.length}`);

        for (const book of readyForPreview) {
          try {
            const label = (book.title || '').substring(0, 50);

            // Get first 25 pages with archived/cropped images only.
            // Lambda can't reliably fetch from archive.org/gallica (rate limits, 403s).
            const pages = await db.collection('pages')
              .find({
                book_id: book.id,
                $and: [
                  { $or: [
                    { cropped_photo: { $exists: true, $nin: [null, ''] } },
                    { archived_photo: { $regex: /^https?:\/\// } },
                  ]},
                  { $or: [
                    { 'ocr.data': { $exists: false } },
                    { 'ocr.data': null },
                    { 'ocr.data': '' },
                  ]},
                ],
              })
              .sort({ page_number: 1 })
              .limit(PREVIEW_PAGE_COUNT)
              .project({ id: 1 })
              .toArray();

            if (pages.length === 0) {
              console.log(`  No pages for preview: ${label}`);
              continue;
            }

            if (DRY_RUN) {
              console.log(`  Would queue preview: ${label} — ${pages.length} pages`);
              continue;
            }

            const pageIds = pages.map(p => p.id);
            const jobId = nanoid(12);

            // Create job record with preview flag — triggers auto-translation on completion
            await db.collection('jobs').insertOne({
              id: jobId,
              type: 'ocr',
              book_id: book.id,
              book_title: book.title,
              status: 'pending',
              progress: { total: pageIds.length, completed: 0, failed: 0 },
              config: {
                page_ids: pageIds,
                preview: true,
              },
              initiated_by: 'pipeline_preview',
              created_at: new Date(),
              updated_at: new Date(),
            });

            // Flag book so we don't re-queue, and set active job for completion tracking
            await db.collection('books').updateOne(
              { id: book.id },
              { $set: { preview_ocr_queued_at: new Date(), job: { type: 'realtime', job_id: jobId } } },
            );

            // Enqueue pages to Lambda OCR queue (standard, not FIFO)
            for (let i = 0; i < pageIds.length; i += 10) {
              const batch = pageIds.slice(i, i + 10);
              const entries = batch.map((pageId, idx) => ({
                Id: `msg-${idx}`,
                MessageBody: JSON.stringify({ bookId: book.id, pageId, jobId }),
              }));

              await sqsClient.send(new SendMessageBatchCommand({
                QueueUrl: SQS_OCR_QUEUE_URL,
                Entries: entries,
              }));
            }

            log.preview_queued++;
            console.log(`  Preview queued: ${label} — ${pageIds.length} pages (job ${jobId})`);

            await sleep(200);
          } catch (err) {
            log.errors.push(`Preview ${book.id}: ${err.message}`);
          }
        }
        console.log(`  Preview OCR queued: ${log.preview_queued}`);
      }
    }

    // ── Phase 1.7: Preview Translation — translate preview-OCR'd pages inline via Vercel API ──
    // Calls /api/process for each page. No SQS queue (222K backlog makes it useless for previews).
    // ~25 pages × ~5s each = ~2 minutes per book. Processes up to 5 books per run.
    if (shouldRun(1.7)) {
      console.log('\n--- Phase 1.7: Preview Translation (inline via Vercel API) ---');

      const PREVIEW_TRANSLATE_LIMIT = 50;

      const readyForPreviewTranslate = await db.collection('books')
        .find({
          preview_ocr_queued_at: { $exists: true },
          preview_translate_queued_at: { $exists: false },
          language: { $nin: ['English', 'english', 'eng', 'en', 'ENG'] },
        })
        .sort({ is_first_translation: -1 })
        .project({ id: 1, title: 1, language: 1 })
        .limit(PREVIEW_TRANSLATE_LIMIT)
        .toArray();

      console.log(`  Books ready for preview translation: ${readyForPreviewTranslate.length}`);

      for (const book of readyForPreviewTranslate) {
        try {
          const label = (book.title || '').substring(0, 50);

          const pages = await db.collection('pages')
            .find({
              book_id: book.id,
              'ocr.data': { $exists: true, $nin: [null, ''] },
              page_type: { $nin: SKIP_TRANSLATION_PAGE_TYPES },
              $or: [
                { 'translation.data': { $exists: false } },
                { 'translation.data': null },
                { 'translation.data': '' },
              ],
            })
            .sort({ page_number: 1 })
            .limit(PREVIEW_PAGE_COUNT)
            .project({ id: 1 })
            .toArray();

          if (pages.length === 0) {
            await db.collection('books').updateOne(
              { id: book.id },
              { $set: { preview_translate_queued_at: new Date() } },
            );
            console.log(`  Already translated: ${label}`);
            continue;
          }

          if (DRY_RUN) {
            console.log(`  Would translate: ${label} — ${pages.length} pages`);
            continue;
          }

          console.log(`  Translating: ${label} — ${pages.length} pages...`);
          let pagesDone = 0;
          let pagesErr = 0;

          for (const page of pages) {
            try {
              const res = await fetch(`${BASE_URL}/api/process`, {
                method: 'POST',
                headers: headers(),
                body: JSON.stringify({
                  pageId: page.id,
                  bookId: book.id,
                  action: 'translate',
                }),
              });

              if (res.ok) {
                pagesDone++;
              } else {
                pagesErr++;
                if (res.status === 429) {
                  console.log('    Rate limited — waiting 10s...');
                  await sleep(10000);
                }
              }
              await sleep(500);
            } catch (err) {
              pagesErr++;
            }
          }

          await db.collection('books').updateOne(
            { id: book.id },
            { $set: { preview_translate_queued_at: new Date(), updated_at: new Date() } },
          );

          const translatedCount = await db.collection('pages').countDocuments({
            book_id: book.id,
            'translation.data': { $exists: true, $nin: [null, ''] },
          });
          await db.collection('books').updateOne(
            { id: book.id },
            { $set: { pages_translated: translatedCount } },
          );

          log.preview_queued++;
          console.log(`  Done: ${label} — ${pagesDone} ok, ${pagesErr} errors`);
        } catch (err) {
          log.errors.push(`Preview translate ${book.id}: ${err.message}`);
        }
      }
      console.log(`  Preview translations done: ${log.preview_queued}`);
    }

    // ── Phase 2: Submit OCR via Gemini Batch API (archive_complete -> ocr_submitted) ──
    // Two-pass strategy:
    //   Pass 1 ("preview"): First 25 pages of first-translation books — gives readers content fast
    //   Pass 2 ("full"): Remaining pages for books that already have preview OCR
    if (shouldRun(2)) {
      console.log('\n--- Phase 2: OCR submission ---');

      const activeBatchOcr = await db.collection('batch_jobs').countDocuments({
        type: 'ocr',
        status: { $in: ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'] },
      });
      console.log(`  Active OCR batch jobs: ${activeBatchOcr}/${MAX_ACTIVE_BATCH_OCR}`);

      const ocrLimit = activeBatchOcr >= MAX_ACTIVE_BATCH_OCR ? 0 : OCR_SUBMIT_LIMIT;

      const ENGLISH_VARIANTS_P2 = ['english', 'eng', 'en'];
      const PREVIEW_PAGES = 25;

      // --- Pass 1: Preview OCR (first 25 pages) for books that haven't had any OCR yet ---
      // Prioritize first-translation books. This spreads OCR across many books fast.
      if (ocrLimit > 0) {
        const previewCandidates = await db.collection('books')
          .aggregate([
            { $match: {
              'pipeline_auto.status': 'archive_complete',
              'pipeline_auto.split_checked': true,
              'image_source.provider': { $ne: 'bph' },
              pages_ocr: { $in: [0, null, undefined] }, // No OCR yet
            }},
            { $addFields: {
              _priority: {
                $switch: {
                  branches: [
                    { case: { $eq: ['$is_first_translation', true] }, then: 0 },
                    { case: { $in: [{ $toLower: { $ifNull: ['$language', ''] } }, ENGLISH_VARIANTS_P2] }, then: 2 },
                  ],
                  default: 1,
                },
              },
            }},
            { $sort: { _priority: 1, hidden: 1 } },
            { $project: { id: 1, title: 1, pages_count: 1, 'pipeline_auto.retry_count': 1, 'pipeline_auto.split_checked': 1 } },
            { $limit: ocrLimit },
          ])
          .toArray();

        if (previewCandidates.length > 0) {
          console.log(`  Preview pass: ${previewCandidates.length} books (first ${PREVIEW_PAGES} pages each)`);
        }

        for (const book of previewCandidates) {
          try {
            const label = (book.title || '').substring(0, 50);
            if (DRY_RUN) { console.log(`  Would preview OCR: ${label}`); continue; }
            console.log(`  Preview OCR: ${label}...`);
            const result = await submitOcrDirectly(db, book, { maxPages: PREVIEW_PAGES });

            if (result.alreadyDone) {
              await setPipelineStatus(db, book.id, 'ocr_complete');
              log.ocr_advanced++;
              console.log(`  Already OCR'd: ${label}`);
            } else if (result.skippedDuplicate) {
              console.log(`  Skipped (active batch exists): ${label}`);
            } else if (result.submitted > 0) {
              // Don't advance to ocr_submitted yet — still has remaining pages
              // Mark that preview batch was sent so full pass picks it up later
              await db.collection('books').updateOne(
                { id: book.id },
                { $set: { 'pipeline_auto.preview_batch_at': new Date() } }
              );
              log.ocr_submitted++;
              console.log(`  Preview submitted: ${label} — ${result.submitted}/${book.pages_count || '?'} pages`);
            } else {
              console.log(`  OCR submitted: ${label} — 0 pages`);
            }
            await sleep(API_DELAY_MS);
          } catch (err) {
            const msg = err.message || String(err);
            console.log(`  Preview OCR error: ${(book.title || '').substring(0, 40)} — ${msg.substring(0, 80)}`);
          }
        }
      }

      // --- Pass 2: Full OCR for books that already have some OCR (preview done, or partial) ---
      const readyForOcr = ocrLimit > 0 ? await db.collection('books')
        .aggregate([
          { $match: {
            'pipeline_auto.status': 'archive_complete',
            'pipeline_auto.split_checked': true,
            'image_source.provider': { $ne: 'bph' },
            pages_ocr: { $gt: 0 }, // Already has some OCR (preview pass done)
          }},
          { $addFields: {
            _priority: {
              $switch: {
                branches: [
                  { case: { $eq: ['$is_first_translation', true] }, then: 0 },
                  { case: { $in: [{ $toLower: { $ifNull: ['$language', ''] } }, ENGLISH_VARIANTS_P2] }, then: 2 },
                ],
                default: 1,
              },
            },
          }},
          { $sort: { _priority: 1, hidden: 1 } },
          { $project: { id: 1, title: 1, pages_count: 1, 'pipeline_auto.retry_count': 1, 'pipeline_auto.recitation_retry': 1, 'pipeline_auto.split_checked': 1 } },
          { $limit: ocrLimit },
        ])
        .toArray() : [];

      if (readyForOcr.length > 0) {
        console.log(`  Full pass: ${readyForOcr.length} books (all remaining pages)`);
      }

      for (const book of readyForOcr) {
        const retries = book.pipeline_auto?.retry_count || 0;
        try {
          const label = (book.title || '').substring(0, 50);

          if (DRY_RUN) {
            console.log(`  Would submit OCR: ${label} (${book.pages_count} pages)`);
            continue;
          }

          // Direct OCR submission — downloads images on Hetzner, submits to Gemini Batch API
          // Use fallback model for RECITATION retries (gemini-3-flash-preview triggers it)
          const isRecitationRetry = book.pipeline_auto?.recitation_retry === true;
          const ocrOpts = isRecitationRetry ? { modelOverride: 'gemini-2.5-flash' } : {};
          if (isRecitationRetry) console.log(`  RECITATION retry with gemini-2.5-flash: ${label}`);
          else console.log(`  Submitting OCR: ${label}...`);
          const result = await submitOcrDirectly(db, book, ocrOpts);

          if (result.alreadyDone) {
            await setPipelineStatus(db, book.id, 'ocr_complete');
            log.ocr_advanced++;
            console.log(`  Already OCR'd: ${label}`);
          } else if (result.skippedDuplicate) {
            // Don't change state — active batch jobs exist, wait for them
            console.log(`  Skipped (active batch exists): ${label}`);
          } else {
            const statusExtra = { ocr_job_name: result.jobName, retry_count: 0 };
            await setPipelineStatus(db, book.id, 'ocr_submitted', statusExtra);
            // Clear recitation_retry flag after successful resubmission
            if (isRecitationRetry) {
              await db.collection('books').updateOne(
                { id: book.id },
                { $unset: { 'pipeline_auto.recitation_retry': '' } }
              );
            }
            log.ocr_submitted++;
            console.log(`  OCR submitted: ${label} — ${result.submitted} pages in ${result.childCount} batches`);
          }

          await sleep(API_DELAY_MS);
        } catch (err) {
          const msg = err.message || String(err);
          if (msg.includes('ALL_KEYS_QUOTA_EXHAUSTED')) {
            console.log(`  All Gemini keys quota exhausted — stopping OCR submissions`);
            log.errors.push('OCR: All API keys quota exhausted');
            break; // Stop trying more books
          } else if (msg.includes('image downloads failed')) {
            await setPipelineStatus(db, book.id, 'needs_attention', { error: msg });
            log.needs_attention++;
          } else if (retries >= MAX_RETRIES) {
            await markFailed(db, book.id, `OCR submit: ${msg}`, retries);
          } else {
            await setPipelineStatus(db, book.id, 'archive_complete', { retry_count: retries + 1 });
          }
          console.log(`  ERROR OCR submit ${book.id}: ${msg}`);
          log.errors.push(`OCR submit ${book.id}: ${msg}`);
        }
      }
      console.log(`  OCR submitted: ${log.ocr_submitted}, advanced: ${log.ocr_advanced}`);
    }

    // ── Phase 3: Check OCR completion (ocr_submitted -> ocr_complete) ──
    if (shouldRun(3)) {
      console.log('\n--- Phase 3: OCR completion check ---');

      const ocrPending = await db.collection('books')
        .find({ 'pipeline_auto.status': 'ocr_submitted' })
        .project({ id: 1, title: 1, 'pipeline_auto.ocr_job_name': 1, 'pipeline_auto.ocr_job_id': 1, 'pipeline_auto.ocr_loop_count': 1 })
        .toArray();

      console.log(`  Books waiting for OCR: ${ocrPending.length}`);

      for (const book of ocrPending) {
        const jobName = book.pipeline_auto?.ocr_job_name;
        const jobId = book.pipeline_auto?.ocr_job_id;
        let isComplete = false;

        if (jobId) {
          const job = await db.collection('jobs').findOne({
            id: jobId,
            status: { $in: ['completed', 'completed_with_errors'] },
          });
          if (job) isComplete = true;
        } else if (jobName) {
          const batchJob = await db.collection('batch_jobs').findOne({
            book_id: book.id,
            type: 'ocr',
            $or: [{ job_name: jobName }, { gemini_job_name: jobName }],
            status: { $in: ['completed', 'saved', 'completed_with_errors', 'failed'] },
          });
          const parentJob = !batchJob
            ? await db.collection('batch_jobs').findOne({
                book_id: book.id,
                type: 'ocr',
                child_job_ids: { $exists: true, $ne: [] },
                status: { $in: ['completed', 'saved', 'completed_with_errors', 'failed'] },
              })
            : null;
          if (batchJob || parentJob) isComplete = true;
        }

        if (isComplete) {
          // Check for remaining un-OCR'd pages
          const remainingOcr = await db.collection('pages').countDocuments({
            book_id: book.id,
            $or: [
              { photo: { $exists: true, $ne: null } },
              { photo_original: { $exists: true, $ne: null } },
            ],
            $and: [{
              $or: [
                { 'ocr.data': { $exists: false } },
                { 'ocr.data': null },
                { 'ocr.data': '' },
              ],
            }],
          });

          if (remainingOcr > 0) {
            // Check if there are uncollected batch_jobs — collector may not have saved results yet
            const uncollectedBatch = await db.collection('batch_jobs').countDocuments({
              book_id: book.id,
              type: 'ocr',
              status: { $in: ['pending', 'processing', 'completed'] }, // NOT 'saved' — results not yet written to pages
            });

            if (uncollectedBatch > 0) {
              // Results exist in Gemini but haven't been saved to pages yet — wait for collector
              console.log(`  Waiting for collector: ${book.title} — ${uncollectedBatch} uncollected batch jobs, ${remainingOcr} pages remaining`);
              // Don't change state, don't increment loop count — just wait
            } else {
              // All batch_jobs have been collected ('saved'), so remaining pages genuinely failed
              const loopCount = (book.pipeline_auto?.ocr_loop_count || 0) + 1;
              if (loopCount > MAX_RETRIES) {
                if (!DRY_RUN) {
                  await setPipelineStatus(db, book.id, 'needs_attention', {
                    error: `OCR looped ${loopCount} times with ${remainingOcr} pages still un-OCR'd`,
                    ocr_loop_count: loopCount,
                  });
                }
                log.needs_attention++;
                log.errors.push(`OCR circuit breaker ${book.id}: looped ${loopCount}x, ${remainingOcr} pages remaining`);
              } else {
                if (!DRY_RUN) {
                  await setPipelineStatus(db, book.id, 'archive_complete', { ocr_loop_count: loopCount });
                }
                console.log(`  OCR loop ${loopCount} for ${book.title}: ${remainingOcr} pages remaining (all batches collected)`);
              }
            }
            log.ocr_advanced++;
          } else {
            if (!DRY_RUN) {
              await setPipelineStatus(db, book.id, 'ocr_complete');
            }
            log.ocr_advanced++;
            console.log(`  OCR complete: ${book.title}`);
          }
        }
      }
      console.log(`  OCR advanced: ${log.ocr_advanced}`);
    }

    // ── Phase 3.5: Metadata enrichment (ocr_complete -> metadata_enriched) ──
    if (shouldRun(3.5) || shouldRun(3)) {
      console.log('\n--- Phase 3.5: Metadata enrichment ---');

      const readyForMetadata = await db.collection('books')
        .find({ 'pipeline_auto.status': 'ocr_complete' })
        .sort({ hidden: 1 })
        .project({ id: 1, title: 1, author: 1, published: 1, language: 1, place_of_publication: 1, publisher: 1, 'pipeline_auto.retry_count': 1, 'ai_metadata.enriched_at': 1 })
        .limit(METADATA_ENRICH_LIMIT)
        .toArray();

      console.log(`  Books ready for metadata: ${readyForMetadata.length}`);

      for (const book of readyForMetadata) {
        try {
          if (book.ai_metadata?.enriched_at) {
            if (!DRY_RUN) {
              await setPipelineStatus(db, book.id, 'metadata_enriched', { retry_count: 0 });
            }
            log.metadata_skipped++;
            continue;
          }

          if (DRY_RUN) {
            console.log(`  Would enrich metadata: ${book.title}`);
            continue;
          }

          // Inline catalog lookup + apply (no Vercel dependency)
          const result = await verifyMetadataInline(db, book);
          if (result.applied > 0) {
            console.log(`  [metadata] ${book.id}: applied ${result.applied} fields from ${result.source} (${result.confidence}% confidence)`);
          }

          await setPipelineStatus(db, book.id, 'metadata_enriched', { retry_count: 0 });
          log.metadata_enriched++;
        } catch (err) {
          const retries = book.pipeline_auto?.retry_count || 0;
          if (retries >= MAX_RETRIES) {
            // Non-blocking: skip on persistent failure
            if (!DRY_RUN) {
              await setPipelineStatus(db, book.id, 'metadata_enriched', { retry_count: 0 });
            }
            log.metadata_skipped++;
          } else {
            if (!DRY_RUN) {
              await setPipelineStatus(db, book.id, 'ocr_complete', { retry_count: retries + 1 });
            }
          }
          log.errors.push(`Metadata ${book.id}: ${err.message}`);
        }
      }
      console.log(`  Metadata enriched: ${log.metadata_enriched}, skipped: ${log.metadata_skipped}`);
    }

    // ── Phase 3.7: Transliteration for non-Latin books (inline, runs on metadata_enriched books) ──
    // Not a pipeline state — just enriches pages before translation. Cheap & fast (text-only, lite model).
    if (shouldRun(3.7) || shouldRun(3.5) || shouldRun(3)) {
      console.log('\n--- Phase 3.7: Transliteration (non-Latin books) ---');

      // Find metadata_enriched books with non-Latin languages
      const nonLatinBooks = await db.collection('books')
        .find({
          'pipeline_auto.status': 'metadata_enriched',
          language: { $regex: new RegExp(`^(${[...NON_LATIN_LANGUAGES].join('|')})$`, 'i') },
        })
        .sort({ hidden: 1 })
        .project({ id: 1, title: 1, language: 1 })
        .limit(TRANSLITERATE_LIMIT)
        .toArray();

      console.log(`  Non-Latin books ready for transliteration: ${nonLatinBooks.length}`);

      for (const book of nonLatinBooks) {
        try {
          const sourceScript = languageToScript(book.language);
          const pages = await db.collection('pages')
            .find({
              book_id: book.id,
              'ocr.data': { $exists: true, $nin: [null, ''] },
              page_type: { $nin: SKIP_TRANSLATION_PAGE_TYPES },
              $or: [
                { 'transliteration.data': { $exists: false } },
                { 'transliteration.data': null },
                { 'transliteration.data': '' },
              ],
            })
            .sort({ page_number: 1 })
            .project({ id: 1, book_id: 1, ocr: 1, transliteration: 1 })
            .toArray();

          if (pages.length === 0) {
            console.log(`  Already transliterated: ${book.title}`);
            continue;
          }

          const label = (book.title || '').substring(0, 50);
          if (DRY_RUN) {
            console.log(`  Would transliterate: ${label} (${book.language}) — ${pages.length} pages`);
            continue;
          }

          console.log(`  Transliterating: ${label} (${book.language}) — ${pages.length} pages...`);
          let pagesDone = 0;
          let pagesErr = 0;

          for (let i = 0; i < pages.length; i += TRANSLITERATE_CONCURRENCY) {
            const chunk = pages.slice(i, i + TRANSLITERATE_CONCURRENCY);
            const results = await Promise.allSettled(
              chunk.map(page => transliteratePage(db, page, sourceScript))
            );

            for (const r of results) {
              if (r.status === 'fulfilled' && r.value) {
                pagesDone++;
              } else if (r.status === 'rejected') {
                pagesErr++;
                const msg = r.reason?.message || '';
                if (msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
                  console.log('    Rate limited — waiting 30s...');
                  await sleep(30000);
                }
              }
            }
          }

          log.transliterated++;
          log.transliterate_pages += pagesDone;
          console.log(`  Done: ${label} — ${pagesDone} ok, ${pagesErr} errors`);
        } catch (err) {
          log.errors.push(`Transliterate ${book.id}: ${err.message}`);
        }
      }
      console.log(`  Transliterated: ${log.transliterated} books, ${log.transliterate_pages} pages`);
    }

    // ── Phase 4: Dispatch translation to Lambda via SQS FIFO ──
    // Hetzner focuses on OCR; Lambdas scale out translation.
    // Creates a job record, enqueues pages to SQS FIFO, Lambdas process sequentially per book.
    if (shouldRun(4)) {
      console.log('\n--- Phase 4: Dispatch translation to Lambda (SQS FIFO) ---');

      // Zombie job reaper: cancel translation jobs stuck in processing with 0 progress for >2h.
      // These are dead Lambda workers that will never complete, blocking the in-flight cap.
      if (!DRY_RUN) {
        const zombieThreshold = new Date(Date.now() - 2 * 60 * 60 * 1000);
        const zombieJobs = await db.collection('jobs').find({
          type: 'translation',
          status: 'processing',
          'progress.completed': 0,
          created_at: { $lt: zombieThreshold },
        }).project({ _id: 1, book_id: 1, book_title: 1 }).toArray();

        if (zombieJobs.length > 0) {
          const zombieBookIds = zombieJobs.map(j => j.book_id);
          await db.collection('jobs').updateMany(
            { _id: { $in: zombieJobs.map(j => j._id) } },
            { $set: { status: 'failed', error: 'Auto-cancelled: stuck >2h with 0 progress', updated_at: new Date() } },
          );
          // Reset affected books so they can be re-dispatched
          await db.collection('books').updateMany(
            { id: { $in: zombieBookIds }, 'pipeline_auto.status': 'translate_submitted' },
            { $set: { 'pipeline_auto.status': 'metadata_enriched', updated_at: new Date() }, $unset: { job: '' } },
          );
          log.zombie_jobs_cancelled += zombieJobs.length;
          console.log(`  Zombie reaper: cancelled ${zombieJobs.length} stuck translation jobs, reset books to metadata_enriched`);
        }
      }

      // Orphan detector: books in *_submitted state with no active job and no book.job reference.
      // These get stranded when jobs are cancelled without rolling back pipeline status.
      if (!DRY_RUN) {
        const orphanStates = [
          { from: 'translate_submitted', to: 'metadata_enriched' },
          { from: 'ocr_submitted', to: 'archive_complete' },
          { from: 'images_submitted', to: 'chapters_complete' },
        ];
        for (const { from, to } of orphanStates) {
          const orphans = await db.collection('books').find({
            'pipeline_auto.status': from,
            $or: [{ job: { $exists: false } }, { job: null }],
          }).project({ id: 1 }).toArray();
          if (orphans.length > 0) {
            // Verify no active jobs exist for these books
            const orphanIds = orphans.map(b => b.id);
            const activeJobCount = await db.collection('jobs').countDocuments({
              book_id: { $in: orphanIds },
              status: { $in: ['pending', 'processing'] },
            });
            if (activeJobCount === 0) {
              await db.collection('books').updateMany(
                { id: { $in: orphanIds }, 'pipeline_auto.status': from },
                { $set: { 'pipeline_auto.status': to, updated_at: new Date() } },
              );
              console.log(`  Orphan detector: rolled back ${orphans.length} books from ${from} to ${to}`);
            }
          }
        }
      }

      // Phase 4 creates translation jobs. The Hetzner translate-worker.mjs picks them up.
      // SQS/Lambda path is deprecated — translate-worker runs on Hetzner cron and calls Gemini directly.
      {
        const inFlight = await db.collection('books').countDocuments({
          'pipeline_auto.status': 'translate_submitted',
        });
        const headroom = MAX_INFLIGHT_TRANSLATIONS - inFlight;
        const effectiveLimit = Math.max(0, Math.min(TRANSLATE_SUBMIT_LIMIT, headroom));
        console.log(`  In-flight translations: ${inFlight}/${MAX_INFLIGHT_TRANSLATIONS} — dispatching up to ${effectiveLimit}`);

        if (effectiveLimit === 0) {
          console.log('  SKIP: at in-flight cap, waiting for existing translations to complete');
        }

        const readyForTranslate = effectiveLimit > 0 ? await db.collection('books').aggregate([
          // PAUSED: BPH books excluded pending split quality audit (#523)
          { $match: { 'pipeline_auto.status': { $in: ['metadata_enriched', 'ft_verified'] }, 'image_source.provider': { $ne: 'bph' } } },
          { $addFields: { _latinFirst: { $cond: [{ $eq: ['$language', 'Latin'] }, 0, 1] } } },
          { $sort: { _latinFirst: 1, is_first_translation: -1, hidden: 1 } },
          { $project: { id: 1, title: 1, pages_count: 1, language: 1, 'pipeline_auto.retry_count': 1, 'image_source.provider': 1 } },
          { $limit: effectiveLimit }
        ]).toArray() : [];

        console.log(`  Books ready for translation: ${readyForTranslate.length}`);

        for (const book of readyForTranslate) {
          try {
            const pages = await db.collection('pages')
              .find({
                book_id: book.id,
                'ocr.data': { $exists: true, $nin: [null, ''] },
                page_type: { $nin: SKIP_TRANSLATION_PAGE_TYPES },
                $or: [
                  { 'translation.data': { $exists: false } },
                  { 'translation.data': null },
                  { 'translation.data': '' },
                  { $expr: { $lt: ['$translation.updated_at', '$ocr.updated_at'] } },
                ],
              })
              .sort({ page_number: 1 })
              .project({ id: 1 })
              .toArray();

            if (pages.length === 0) {
              if (!DRY_RUN) await setPipelineStatus(db, book.id, 'translate_complete');
              log.translate_advanced++;
              console.log(`  No pages need translation: ${book.title}`);
              continue;
            }

            const label = (book.title || '').substring(0, 50);
            const pageIds = pages.map(p => p.id);
            const jobId = nanoid(12);

            if (DRY_RUN) {
              console.log(`  Would dispatch: ${label} — ${pageIds.length} pages`);
              continue;
            }

            // Create job record — translate-worker.mjs picks this up
            await db.collection('jobs').insertOne({
              id: jobId,
              type: 'translation',
              book_id: book.id,
              book_title: book.title,
              status: 'pending',
              progress: { total: pageIds.length, completed: 0, failed: 0 },
              config: {
                page_ids: pageIds,
                model: getTranslateModelForBook(book),
                language: book.language || 'auto-detect',
              },
              initiated_by: 'pipeline_orchestrator',
              created_at: new Date(),
              updated_at: new Date(),
            });

            await db.collection('books').updateOne(
              { id: book.id },
              { $set: { job: { type: 'hetzner-inline', job_id: jobId } } },
            );

            await setPipelineStatus(db, book.id, 'translate_submitted', {
              translate_job_id: jobId,
              retry_count: 0,
            });
            log.translate_submitted++;
            console.log(`  Dispatched: ${label} — ${pageIds.length} pages (job ${jobId})`);
          } catch (err) {
            const retries = book.pipeline_auto?.retry_count || 0;
            if (retries >= MAX_RETRIES) {
              await markFailed(db, book.id, `Translate dispatch: ${err.message}`, retries);
            } else {
              await setPipelineStatus(db, book.id, 'metadata_enriched', { retry_count: retries + 1 });
            }
            log.errors.push(`Translate ${book.id}: ${err.message}`);
          }
        }
        console.log(`  Translate dispatched: ${log.translate_submitted}, advanced: ${log.translate_advanced}`);
      }
    }

    // ── Phase 5: Translation completion check (translate_submitted -> translate_complete) ──
    // Checks Lambda job progress — advances completed books, recycles partial failures.
    if (shouldRun(5)) {
      console.log('\n--- Phase 5: Legacy translation completion check ---');

      const translatePending = await db.collection('books')
        .find({ 'pipeline_auto.status': 'translate_submitted' })
        .project({ id: 1, title: 1, 'pipeline_auto.translate_job_id': 1, 'pipeline_auto.translate_job_name': 1 })
        .toArray();

      console.log(`  Books in translate_submitted (legacy): ${translatePending.length}`);

      for (const book of translatePending) {
        // Check if translation is actually done by looking at pages
        const remaining = await db.collection('pages').countDocuments({
          book_id: book.id,
          'ocr.data': { $exists: true, $nin: [null, ''] },
          page_type: { $nin: SKIP_TRANSLATION_PAGE_TYPES },
          $or: [
            { 'translation.data': { $exists: false } },
            { 'translation.data': null },
            { 'translation.data': '' },
          ],
        });

        if (remaining === 0) {
          if (!DRY_RUN) await setPipelineStatus(db, book.id, 'translate_complete');
          log.translate_advanced++;
          console.log(`  Translation complete: ${book.title}`);
        } else {
          // Check Lambda job completion
          const jobId = book.pipeline_auto?.translate_job_id;
          if (jobId) {
            const job = await db.collection('jobs').findOne({
              id: jobId,
              status: { $in: ['completed', 'completed_with_errors', 'failed'] },
            });
            if (job) {
              // Lambda job finished but pages remain — send back to Phase 4 for direct translation
              if (!DRY_RUN) await setPipelineStatus(db, book.id, 'metadata_enriched');
              log.translate_advanced++;
              console.log(`  Recycling to Phase 4: ${book.title} (${remaining} pages remain after Lambda job)`);
            }
          } else {
            // No job ID — orphaned state, recycle
            if (!DRY_RUN) await setPipelineStatus(db, book.id, 'metadata_enriched');
            log.translate_advanced++;
            console.log(`  Recycling orphan: ${book.title} (${remaining} pages remain, no job ID)`);
          }
        }
      }
      console.log(`  Translation advanced: ${log.translate_advanced}`);
    }

    // ── Phase 6: Summary + Index (translate_complete -> summary_indexed) ──
    // When ENRICHMENT_INLINE=true, the enrich-worker.mjs cron handles this.
    // Otherwise falls back to the Vercel API route.
    if (shouldRun(6) && process.env.ENRICHMENT_INLINE === 'true') {
      console.log('\n--- Phase 6: Summary + Index (INLINE — handled by enrich-worker.mjs) ---');
      const readyCount = await db.collection('books').countDocuments({ 'pipeline_auto.status': 'translate_complete' });
      console.log(`  Books in translate_complete: ${readyCount} (enrich-worker processes these)`);
    } else if (shouldRun(6)) {
      console.log('\n--- Phase 6: Summary + Index ---');

      const readyForEnrich = await db.collection('books')
        .find({ 'pipeline_auto.status': 'translate_complete' })
        .sort({ hidden: 1 })
        .project({ id: 1, title: 1, 'pipeline_auto.retry_count': 1 })
        .limit(ENRICH_LIMIT)
        .toArray();

      console.log(`  Books ready for summary + index: ${readyForEnrich.length}`);

      for (const book of readyForEnrich) {
        try {
          if (DRY_RUN) {
            console.log(`  Would enrich: ${book.title}`);
            continue;
          }

          await setPipelineStatus(db, book.id, 'summarizing');

          const res = await fetch(`${BASE_URL}/api/books/${book.id}/index`, {
            method: 'GET',
            headers: headers(),
          });

          if (!res.ok) {
            const retries = book.pipeline_auto?.retry_count || 0;
            if (retries >= MAX_RETRIES) {
              await markFailed(db, book.id, `Summary+Index: HTTP ${res.status}`, retries);
            } else {
              await setPipelineStatus(db, book.id, 'translate_complete', { retry_count: retries + 1 });
            }
            log.errors.push(`Summary+Index ${book.id}: HTTP ${res.status}`);
            continue;
          }

          await setPipelineStatus(db, book.id, 'summary_indexed', { retry_count: 0 });
          log.enriched++;
          console.log(`  Summary + Index: ${book.title}`);

          await sleep(API_DELAY_MS);
        } catch (err) {
          const retries = book.pipeline_auto?.retry_count || 0;
          if (retries >= MAX_RETRIES) {
            await setPipelineStatus(db, book.id, 'summary_indexed', { retry_count: 0 });
            log.enriched++;
          } else {
            await setPipelineStatus(db, book.id, 'translate_complete', { retry_count: retries + 1 });
          }
          log.errors.push(`Summary+Index ${book.id}: ${err.message}`);
        }
      }
      console.log(`  Summary + Index: ${log.enriched}`);
    }

    // ── Phase 7: Chapter extraction (enriched -> chapters_complete) ──
    // When ENRICHMENT_INLINE=true, the enrich-worker.mjs cron handles this.
    if (shouldRun(7) && process.env.ENRICHMENT_INLINE === 'true') {
      console.log('\n--- Phase 7: Chapter Extraction (INLINE — handled by enrich-worker.mjs) ---');
      const readyCount = await db.collection('books').countDocuments({ 'pipeline_auto.status': 'summary_indexed' });
      console.log(`  Books in summary_indexed: ${readyCount} (enrich-worker processes these)`);
    } else if (shouldRun(7)) {
      console.log('\n--- Phase 7: Chapter extraction ---');

      const readyForChapters = await db.collection('books')
        .find({ 'pipeline_auto.status': 'summary_indexed' })
        .sort({ hidden: 1 })
        .project({ id: 1, title: 1, pages_count: 1, 'pipeline_auto.retry_count': 1 })
        .limit(CHAPTER_LIMIT)
        .toArray();

      console.log(`  Books ready for chapters: ${readyForChapters.length}`);

      for (const book of readyForChapters) {
        try {
          if ((book.pages_count || 0) < 10) {
            if (!DRY_RUN) {
              await setPipelineStatus(db, book.id, 'chapters_complete', { retry_count: 0 });
            }
            log.chapters_skipped++;
            continue;
          }

          if (DRY_RUN) {
            console.log(`  Would extract chapters: ${book.title}`);
            continue;
          }

          await setPipelineStatus(db, book.id, 'chapters');

          const res = await fetch(`${BASE_URL}/api/books/${book.id}/extract-chapters`, {
            method: 'POST',
            headers: headers(),
          });

          if (res.ok) {
            await setPipelineStatus(db, book.id, 'chapters_complete', { retry_count: 0 });
            log.chapters_extracted++;
            console.log(`  Chapters extracted: ${book.title}`);
          } else {
            const retries = book.pipeline_auto?.retry_count || 0;
            if (retries >= MAX_RETRIES) {
              // Non-critical — skip
              await setPipelineStatus(db, book.id, 'chapters_complete', { retry_count: 0 });
              log.chapters_skipped++;
            } else {
              await setPipelineStatus(db, book.id, 'summary_indexed', { retry_count: retries + 1 });
            }
            log.errors.push(`Chapters ${book.id}: HTTP ${res.status}`);
          }

          await sleep(API_DELAY_MS);
        } catch (err) {
          const retries = book.pipeline_auto?.retry_count || 0;
          if (retries >= MAX_RETRIES) {
            if (!DRY_RUN) {
              await setPipelineStatus(db, book.id, 'chapters_complete', { retry_count: 0 });
            }
            log.chapters_skipped++;
          } else {
            if (!DRY_RUN) {
              await setPipelineStatus(db, book.id, 'summary_indexed', { retry_count: retries + 1 });
            }
          }
          log.errors.push(`Chapters ${book.id}: ${err.message}`);
        }
      }
      console.log(`  Chapters extracted: ${log.chapters_extracted}, skipped: ${log.chapters_skipped}`);
    }

    // ── Phase 8: Image extraction (chapters_complete -> images_submitted/complete) ──
    if (shouldRun(8)) {
      console.log('\n--- Phase 8: Image extraction ---');

      const activeImageJobs = await db.collection('jobs').countDocuments({
        type: 'image_extraction',
        status: { $in: ['pending', 'processing'] },
      });
      console.log(`  Active image jobs: ${activeImageJobs}/${MAX_ACTIVE_IMAGE_JOBS}`);

      if (!SQS_IMAGE_EXTRACTION_QUEUE_URL) {
        console.log('  SKIP: SQS_PAGE_IMAGE_EXTRACTION_QUEUE_URL not configured');
      } else if (activeImageJobs < MAX_ACTIVE_IMAGE_JOBS) {
        const IMAGE_CANDIDATE_PAGE_TYPES = ['illustration', 'diagram', 'map', 'frontispiece', 'mixed'];
        const sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'eu-central-1' });

        const readyForImages = await db.collection('books')
          .find({ 'pipeline_auto.status': 'chapters_complete' })
          .sort({ processing_priority: -1, hidden: 1 })
          .project({ id: 1, title: 1 })
          .limit(IMAGE_SUBMIT_LIMIT)
          .toArray();

        console.log(`  Books ready for image extraction: ${readyForImages.length}`);

        for (const book of readyForImages) {
          try {
            // Find pages with image candidates (same logic as Vercel cron)
            const bookPages = await db.collection('pages')
              .find({
                book_id: book.id,
                $or: [
                  { page_type: { $in: IMAGE_CANDIDATE_PAGE_TYPES } },
                  { page_type: { $exists: false }, 'ocr.data': { $regex: '<detected-images>' } },
                ],
              }, { projection: { id: 1 } })
              .toArray();

            if (bookPages.length === 0) {
              // No image candidates — skip straight to images_complete
              if (!DRY_RUN) await setPipelineStatus(db, book.id, 'images_complete');
              log.images_advanced++;
              console.log(`  No image candidates, skipped: ${book.title}`);
              continue;
            }

            if (DRY_RUN) {
              console.log(`  Would submit image extraction: ${book.title} (${bookPages.length} pages)`);
              continue;
            }

            const pageIds = bookPages.map(p => p.id);
            const jobId = nanoid(12);

            // Create job record
            await db.collection('jobs').insertOne({
              id: jobId,
              type: 'image_extraction',
              status: 'pending',
              book_id: book.id,
              book_title: book.title,
              progress: { total: pageIds.length, completed: 0, failed: 0 },
              config: { page_ids: pageIds },
              created_at: new Date(),
              updated_at: new Date(),
            });

            await db.collection('books').updateOne(
              { id: book.id },
              { $set: { job: { type: 'image_extraction', job_id: jobId } } }
            );

            // Enqueue pages to SQS in batches of 10
            for (let i = 0; i < pageIds.length; i += 10) {
              const batch = pageIds.slice(i, i + 10);
              await sqsClient.send(new SendMessageBatchCommand({
                QueueUrl: SQS_IMAGE_EXTRACTION_QUEUE_URL,
                Entries: batch.map((pageId, idx) => ({
                  Id: String(idx),
                  MessageBody: JSON.stringify({ bookId: book.id, pageId, jobId }),
                })),
              }));
            }

            await setPipelineStatus(db, book.id, 'images_submitted', {
              image_extraction_job_id: jobId,
            });
            log.images_submitted++;
            console.log(`  Image extraction submitted: ${book.title} (${pageIds.length} pages)`);

            await sleep(API_DELAY_MS);
          } catch (err) {
            log.errors.push(`Images submit ${book.id}: ${err.message}`);
          }
        }
      }

      // Check completed image extraction jobs
      const imagesPending = await db.collection('books')
        .find({ 'pipeline_auto.status': 'images_submitted' })
        .project({ id: 1, 'pipeline_auto.image_extraction_job_id': 1 })
        .toArray();

      for (const book of imagesPending) {
        const imgJobId = book.pipeline_auto?.image_extraction_job_id;
        if (!imgJobId) {
          if (!DRY_RUN) await setPipelineStatus(db, book.id, 'images_complete');
          log.images_advanced++;
          continue;
        }

        const imgJob = await db.collection('jobs').findOne({
          id: imgJobId,
          status: { $in: ['completed', 'completed_with_errors'] },
        });

        if (imgJob) {
          if (!DRY_RUN) await setPipelineStatus(db, book.id, 'images_complete');
          log.images_advanced++;
        }
      }
      console.log(`  Images submitted: ${log.images_submitted}, advanced: ${log.images_advanced}`);
    }

    // ── Phase 8.5: Staleness detection ──
    if (shouldRun(8.5) || shouldRun(8)) {
      console.log('\n--- Phase 8.5: Staleness detection ---');

      const staleThreshold = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const staleBooks = await db.collection('books')
        .find({
          'pipeline_auto.status': { $in: ['ocr_submitted', 'translate_submitted', 'images_submitted', 'summarizing', 'chapters'] },
          'pipeline_auto.last_updated': { $lt: staleThreshold },
        })
        .project({ id: 1, title: 1, pipeline_auto: 1 })
        .limit(50)
        .toArray();

      console.log(`  Stale books: ${staleBooks.length}`);

      const rollbackMap = {
        'ocr_submitted': 'archive_complete',
        'translate_submitted': 'metadata_enriched',
        'images_submitted': 'chapters_complete',
        'summarizing': 'translate_complete',
        'chapters': 'summary_indexed',
      };

      for (const book of staleBooks) {
        const retries = book.pipeline_auto?.retry_count || 0;
        const status = book.pipeline_auto?.status;

        // Before rolling back ocr_submitted/translate_submitted, check if batch_jobs are still active
        // Rolling back while Gemini is still processing creates duplicate submissions
        if (status === 'ocr_submitted' || status === 'translate_submitted') {
          const batchType = status === 'ocr_submitted' ? 'ocr' : 'translation';
          const activeBatch = await db.collection('batch_jobs').countDocuments({
            book_id: book.id,
            type: batchType,
            status: { $in: ['pending', 'processing', 'completed'] }, // completed = not yet collected
          });
          if (activeBatch > 0) {
            console.log(`  Stale SKIP: ${book.title} (${status}) — ${activeBatch} active/uncollected batch jobs, waiting for collector`);
            // Update last_updated to extend the staleness window
            if (!DRY_RUN) {
              await db.collection('books').updateOne(
                { id: book.id },
                { $set: { 'pipeline_auto.last_updated': new Date() } }
              );
            }
            continue;
          }
        }

        if (retries >= MAX_RETRIES) {
          if (!DRY_RUN) {
            await markFailed(db, book.id, `Stale in ${status} for >48h after ${retries} retries`, retries);
          }
          log.stale_failed++;
          console.log(`  Stale FAILED: ${book.title} (${status})`);
        } else {
          const rollbackTo = rollbackMap[status];
          if (rollbackTo && !DRY_RUN) {
            await setPipelineStatus(db, book.id, rollbackTo, { retry_count: retries + 1 });
          }
          log.stale_retried++;
          console.log(`  Stale RETRY: ${book.title} (${status} -> ${rollbackTo})`);
        }
        log.errors.push(`Stale ${book.id}: stuck in ${status}`);
      }
    }

    // ── Phase 8.9: Cover selection + digitizer page hiding ──
    // Runs on images_complete books before finalize. Hides Google/IA notice pages
    // and picks the best cover using page_type + detected_images scoring.
    if (shouldRun(8.9) || shouldRun(9)) {
      console.log('\n--- Phase 8.9: Cover selection + page cleanup ---');

      const coverBooks = await db.collection('books')
        .find({ 'pipeline_auto.status': 'images_complete' })
        .sort({ hidden: 1 })
        .project({ id: 1, title: 1, thumbnail: 1, thumbnail_source: 1 })
        .limit(50)
        .toArray();

      console.log(`  Books needing cover selection: ${coverBooks.length}`);
      let coversSelected = 0;
      let pagesHidden = 0;

      for (const book of coverBooks) {
        if (DRY_RUN) continue;
        try {
          // 1. Hide digitizer notice pages (Google, IA, barcodes) in first 5 pages
          const earlyPages = await db.collection('pages').find(
            { book_id: book.id, page_number: { $lte: 5 } },
            { projection: { id: 1, page_number: 1, 'ocr.data': 1, page_type: 1 } }
          ).sort({ page_number: 1 }).toArray();

          for (const page of earlyPages) {
            const ocr = (page.ocr?.data || '').substring(0, 1500);
            const isDigitizerPage =
              /google\s+logo|digitized\s+by\s+google|this\s+is\s+a\s+digital\s+copy/i.test(ocr) ||
              /inserted\s+by\s+the\s+internet|internet\s+archive|digitization\s+(credit|notice)/i.test(ocr) ||
              /not\s+part\s+of\s+the\s+original\s+book|scanner\s+barcode/i.test(ocr);

            if (isDigitizerPage && page.page_type !== 'digitizer-notice') {
              await db.collection('pages').updateOne(
                { id: page.id },
                { $set: {
                  page_type: 'digitizer-notice',
                  hidden: true,
                  updated_at: new Date(),
                  'field_provenance.page_type': {
                    source: 'pipeline', method: 'ocr-pattern-match',
                    confidence: 0.95, date: new Date(),
                  },
                }}
              );
              pagesHidden++;
            }
          }

          // 2. Select best cover (skip if manually set)
          if (book.thumbnail_source === 'manual') {
            await setPipelineStatus(db, book.id, 'cover_selected', { cover_selected_at: new Date() });
            coversSelected++;
            continue;
          }

          // Heuristic cover selection: frontispiece > title-page > best detected image
          const proj = { page_number: 1, page_type: 1, cropped_photo: 1, archived_photo: 1, photo: 1, 'ocr.data': 1, detected_images: 1, hidden: 1 };
          let bestPage = null;

          // Priority 1: frontispiece (first 50 pages, not hidden, not digitizer)
          const frontispieces = await db.collection('pages').find(
            { book_id: book.id, page_type: 'frontispiece', page_number: { $lte: 50 }, hidden: { $ne: true } },
            { projection: proj, sort: { page_number: 1 }, limit: 3 }
          ).toArray();
          bestPage = frontispieces.find(p => !isDigitizerOcr(p.ocr?.data)) || null;

          // Priority 2: title-page (first 30 pages)
          if (!bestPage) {
            bestPage = await db.collection('pages').findOne(
              { book_id: book.id, page_type: 'title-page', page_number: { $lte: 30 }, hidden: { $ne: true } },
              { projection: proj, sort: { page_number: 1 } }
            );
          }

          // Priority 3: best detected image by gallery_quality (first 30 pages)
          if (!bestPage) {
            const pagesWithImages = await db.collection('pages').find(
              { book_id: book.id, 'detected_images.0': { $exists: true }, page_number: { $lte: 30 }, hidden: { $ne: true } },
              { projection: proj }
            ).toArray();

            let bestScore = 0.4; // minimum threshold
            for (const page of pagesWithImages) {
              if (isDigitizerOcr(page.ocr?.data)) continue;
              for (const img of (page.detected_images || [])) {
                const q = img.gallery_quality || 0;
                const posBonus = page.page_number <= 10 ? 0.1 : page.page_number <= 20 ? 0.05 : 0;
                const typeBonus = ['frontispiece', 'emblem', 'portrait', 'engraving'].includes(img.type) ? 0.15 : 0;
                const score = q * 0.5 + posBonus + typeBonus;
                if (score > bestScore) {
                  bestScore = score;
                  bestPage = page;
                }
              }
            }
          }

          // Priority 4: first non-hidden, non-blank page
          if (!bestPage) {
            bestPage = await db.collection('pages').findOne(
              { book_id: book.id, hidden: { $ne: true }, page_type: { $nin: ['blank', 'digitizer-notice', null] } },
              { projection: proj, sort: { page_number: 1 } }
            );
          }

          if (bestPage) {
            const newUrl = bestPage.cropped_photo || bestPage.archived_photo || bestPage.photo;
            if (newUrl && newUrl !== book.thumbnail) {
              await db.collection('books').updateOne(
                { id: book.id },
                { $set: {
                  thumbnail: newUrl,
                  thumbnail_source: 'auto',
                  cover_page: bestPage.page_number,
                  cover_selected_at: new Date(),
                  'field_provenance.thumbnail': {
                    source: 'pipeline', method: 'heuristic-cover-selection',
                    confidence: 0.8, date: new Date(),
                  },
                }}
              );
            }
          }

          await setPipelineStatus(db, book.id, 'cover_selected', { cover_selected_at: new Date() });
          coversSelected++;
        } catch (err) {
          console.error(`  Cover selection failed for ${book.title}: ${err.message?.slice(0, 100)}`);
          log.errors.push(`Cover failed ${book.id}: ${err.message?.slice(0, 80)}`);
        }
      }

      console.log(`  Covers selected: ${coversSelected}, digitizer pages hidden: ${pagesHidden}`);
      log.covers_selected = coversSelected;
      log.digitizer_pages_hidden = pagesHidden;
    }

    // ── Phase 9: Finalize (cover_selected -> complete) ──
    if (shouldRun(9)) {
      console.log('\n--- Phase 9: Finalize ---');

      const readyToFinalize = await db.collection('books')
        .find({ 'pipeline_auto.status': 'cover_selected' })
        .sort({ hidden: 1 })
        .project({ id: 1, title: 1, pages_count: 1, language: 1 })
        .limit(FINALIZE_LIMIT)
        .toArray();

      console.log(`  Books ready to finalize: ${readyToFinalize.length}`);

      for (const book of readyToFinalize) {
        const totalPages = book.pages_count || await db.collection('pages').countDocuments({ book_id: book.id });

        if (totalPages === 0) {
          if (!DRY_RUN) {
            await setPipelineStatus(db, book.id, 'needs_attention', {
              error: 'Empty book: 0 pages. Likely a failed import.',
            });
          }
          log.needs_attention++;
          log.errors.push(`Finalize blocked ${book.id}: 0 pages`);
          continue;
        }

        const ocrCount = await db.collection('pages').countDocuments({
          book_id: book.id,
          'ocr.data': { $exists: true, $ne: '', $not: { $eq: null } },
        });

        if (ocrCount === 0) {
          if (!DRY_RUN) {
            await setPipelineStatus(db, book.id, 'needs_attention', {
              error: `Finalize blocked: 0/${totalPages} OCR pages. Needs manual investigation.`,
            });
          }
          log.needs_attention++;
          log.errors.push(`Finalize blocked ${book.id}: 0/${totalPages} OCR pages`);
          continue;
        }

        const ocrPercent = ocrCount / totalPages;
        if (ocrPercent < 0.1) {
          if (!DRY_RUN) {
            await setPipelineStatus(db, book.id, 'needs_attention', {
              error: `Very low OCR coverage: ${ocrCount}/${totalPages} (${(ocrPercent * 100).toFixed(1)}%)`,
            });
          }
          log.needs_attention++;
          log.errors.push(`Finalize blocked ${book.id}: ${ocrCount}/${totalPages} OCR`);
          continue;
        }

        if (!DRY_RUN) {
          await setPipelineStatus(db, book.id, 'complete', { completed_at: new Date() });
          // Auto-unhide: books that completed the full pipeline should be visible
          await db.collection('books').updateOne(
            { id: book.id, hidden: true },
            { $set: { hidden: false, updated_at: new Date() }, $unset: { hidden_reason: '' } }
          );
        }
        log.finalized++;
        console.log(`  Finalized: ${book.title}`);
      }
      console.log(`  Finalized: ${log.finalized}`);
    }

    // ── Summary ──
    const duration = Date.now() - startTime;

    // Pipeline funnel snapshot
    let facetResult;
    try {
      [facetResult] = await db.collection('books').aggregate([{
        $facet: {
          funnel: [
            { $match: { 'pipeline_auto.status': { $exists: true } } },
            { $group: { _id: '$pipeline_auto.status', count: { $sum: 1 } } },
          ],
          totals: [{ $group: {
            _id: null,
            books: { $sum: 1 },
            pages: { $sum: { $ifNull: ['$pages_count', 0] } },
            ocr: { $sum: { $ifNull: ['$pages_ocr', 0] } },
            translated: { $sum: { $ifNull: ['$pages_translated', 0] } },
          }}],
        },
      }], { maxTimeMS: 15000 }).toArray();
    } catch {
      console.log('  Summary facet timed out — skipping funnel snapshot');
      facetResult = { funnel: [], totals: [{ books: 0, pages: 0, ocr: 0, translated: 0 }] };
    }

    const counts = Object.fromEntries((facetResult?.funnel || []).map(s => [s._id, s.count]));
    const totals = facetResult?.totals?.[0] || { books: 0, pages: 0, ocr: 0, translated: 0 };

    console.log(`\n=== PIPELINE FUNNEL ===`);
    for (const [status, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${status}: ${count}`);
    }
    console.log(`\n=== PAGES ===`);
    console.log(`  Total: ${totals.pages} | OCR: ${totals.ocr} | Translated: ${totals.translated}`);

    console.log(`\n=== ACTIONS (${(duration / 1000).toFixed(0)}s) ===`);
    console.log(`  Enrolled: ${log.enrolled} | Archived: ${log.archived}`);
    console.log(`  Preview queued: ${log.preview_queued} | OCR submitted: ${log.ocr_submitted} | OCR advanced: ${log.ocr_advanced}`);
    console.log(`  Metadata: ${log.metadata_enriched} enriched, ${log.metadata_skipped} skipped`);
    console.log(`  Translate submitted: ${log.translate_submitted} | Translate advanced: ${log.translate_advanced}`);
    console.log(`  Enriched: ${log.enriched} | Chapters: ${log.chapters_extracted} (${log.chapters_skipped} skipped)`);
    console.log(`  Images submitted: ${log.images_submitted} | Images advanced: ${log.images_advanced}`);
    console.log(`  Covers: ${log.covers_selected} | Pages hidden: ${log.digitizer_pages_hidden}`);
    console.log(`  Finalized: ${log.finalized} | Needs attention: ${log.needs_attention}`);
    console.log(`  Stale retried: ${log.stale_retried} | Stale failed: ${log.stale_failed}`);
    if (log.zombie_jobs_cancelled > 0) console.log(`  Zombie jobs cancelled: ${log.zombie_jobs_cancelled}`);
    if (log.errors.length > 0) {
      console.log(`  Errors (${log.errors.length}):`);
      for (const err of log.errors.slice(0, 30)) {
        console.log(`    - ${err}`);
      }
    }

    // Write cron_runs + pipeline_snapshots
    if (!DRY_RUN) {
      const activeBatch = await db.collection('batch_jobs').aggregate([
        { $match: { status: { $in: ['pending', 'processing'] } } },
        { $group: { _id: '$type', count: { $sum: 1 }, pages: { $sum: { $ifNull: ['$page_count', 0] } } } },
      ]).toArray();
      const batchByType = Object.fromEntries(activeBatch.map(b => [b._id, { count: b.count, pages: b.pages }]));

      await Promise.allSettled([
        db.collection('pipeline_snapshots').insertOne({
          timestamp: new Date(),
          funnel: counts,
          pages: { total: totals.pages, ocr: totals.ocr, translated: totals.translated },
          books: totals.books,
          active_batch: batchByType,
          source: 'hetzner-worker',
        }),
        db.collection('cron_runs').insertOne({
          cron: 'pipeline-orchestrator-worker',
          timestamp: new Date(),
          duration_ms: duration,
          status: log.errors.length > 0 ? 'partial' : 'success',
          failed: false,
          actions: {
            enrolled: log.enrolled,
            archived: log.archived,
            ocr_submitted: log.ocr_submitted,
            ocr_advanced: log.ocr_advanced,
            metadata_enriched: log.metadata_enriched,
            metadata_skipped: log.metadata_skipped,
            transliterated: log.transliterated,
            transliterate_pages: log.transliterate_pages,
            translate_submitted: log.translate_submitted,
            translate_advanced: log.translate_advanced,
            enriched: log.enriched,
            chapters_extracted: log.chapters_extracted,
            chapters_skipped: log.chapters_skipped,
            images_submitted: log.images_submitted,
            images_advanced: log.images_advanced,
            finalized: log.finalized,
            needs_attention: log.needs_attention,
            stale_retried: log.stale_retried,
            stale_failed: log.stale_failed,
            zombie_jobs_cancelled: log.zombie_jobs_cancelled,
          },
          errors: log.errors.slice(0, 50).map(msg => ({ message: msg, timestamp: new Date() })),
          error_count: log.errors.length,
          health_grade: healthGrade,
          summary: `[${healthGrade}] E:${log.enrolled} A:${log.archived} P:${log.preview_queued} O:${log.ocr_submitted}/${log.ocr_advanced} M:${log.metadata_enriched} Tr:${log.transliterated}/${log.transliterate_pages}p T:${log.translate_submitted}/${log.translate_advanced} R:${log.enriched} C:${log.chapters_extracted} I:${log.images_submitted}/${log.images_advanced} F:${log.finalized}`,
        }),
      ]);
    }

    await client.close();
  } catch (error) {
    console.error('[pipeline-orchestrator] Fatal error:', error);

    // Write failure record
    try {
      await db.collection('cron_runs').insertOne({
        cron: 'pipeline-orchestrator-worker',
        timestamp: new Date(),
        duration_ms: Date.now() - startTime,
        status: 'failed',
        failed: true,
        actions: log,
        errors: [{ message: error.message || 'Unknown error', timestamp: new Date() }],
        error_count: 1,
        summary: `FAILED: ${error.message}`,
      });
    } catch (_) { /* best effort */ }

    await client.close();
    process.exit(1);
  }
}

run().catch(err => { console.error(err); process.exit(1); });
