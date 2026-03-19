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

import { MongoClient } from 'mongodb';
import { nanoid } from 'nanoid';
import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
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
const OCR_MODEL = 'gemini-3-flash-preview';
const OCR_PROMPT_VERSION = 'v5.2026-02';
const OCR_INLINE_BATCH_SIZE = 20;  // Pages per inline batch (base64 in body, ~20MB limit)
const OCR_FILE_BATCH_SIZE = 150;   // Pages per file-based batch (JSONL uploaded to File API)
const IMAGE_CONCURRENCY = 20;     // Parallel image downloads per book
const MAX_PAGES_PER_BOOK = 500;   // Max pages to OCR per book

if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
if (!CRON_SECRET) { console.error('CRON_SECRET not set'); process.exit(1); }

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const phaseIdx = args.indexOf('--phase');
const ONLY_PHASE = phaseIdx >= 0 ? parseFloat(args[phaseIdx + 1]) : null;

// Submission limits — much higher than the Vercel cron since we have no time budget
const ENROLL_LIMIT = 100;
const ARCHIVE_LIMIT = 500;
const OCR_SUBMIT_LIMIT = 200;
const MAX_ACTIVE_BATCH_OCR = 500; // Gemini Batch API is resilient
const METADATA_ENRICH_LIMIT = 50;
const TRANSLATE_SUBMIT_LIMIT = 100;
const ENRICH_LIMIT = 30;
const CHAPTER_LIMIT = 50;
const IMAGE_SUBMIT_LIMIT = 10;
const FINALIZE_LIMIT = 200;
const TRANSLITERATE_LIMIT = 10;  // Books per run (pages processed inline)
const TRANSLITERATE_CONCURRENCY = 10;  // Parallel Gemini calls per book
const MAX_ACTIVE_IMAGE_JOBS = 15;
const PREVIEW_PAGE_COUNT = 25;
const PREVIEW_LIMIT = 20; // Books per run to queue preview OCR
const MAX_RETRIES = 3;
const ENROLL_WINDOW_DAYS = 14;

// Delay between API calls (ms) to avoid overwhelming production
const API_DELAY_MS = 500;

// Page types to skip for translation (mirrors defaults.ts)
const SKIP_TRANSLATION_PAGE_TYPES = [
  'blank',
];

// Non-Latin languages that need transliteration
const NON_LATIN_LANGUAGES = new Set([
  'greek', 'hebrew', 'arabic', 'persian', 'ottoman turkish',
  'syriac', 'chinese', 'japanese', 'korean', 'sanskrit',
  'armenian', 'georgian', 'ethiopic', 'coptic', 'tibetan',
  'russian', 'church slavonic',
]);

function isNonLatin(language) {
  return language && NON_LATIN_LANGUAGES.has(language.toLowerCase());
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

const TRANSLATE_MODEL = 'gemini-3-flash-preview';
const TRANSLATE_PROMPT_VERSION = 'v5.2026-02';
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

**Inline annotations (visible to readers):**
- <note>X</note> — interpretive notes for readers
- <margin>X</margin> — translate and keep marginal notes
- <gloss>X</gloss> — translate interlinear annotations
- <insert>X</insert> — translate later additions (inline only)
- <unclear>X</unclear> — illegible readings
- <term>X</term> — technical vocabulary with explanation

**Metadata tags (hidden from readers):**
- <meta>X</meta> for translator notes that should be hidden (e.g., continuity with previous page)

**Do NOT use:**
- Code blocks or backticks - this is prose

**IMPORTANT - Translate ALL languages to English:**
The source text may contain phrases in multiple languages (Latin, Greek, Hebrew, etc.). You MUST translate EVERYTHING to English:
- Latin quotes embedded in German → translate to English
- Greek phrases → translate to English
- Hebrew or Aramaic terms → translate to English
- ANY non-English text → translate to English
Use <note>original: "..."</note> to preserve important original phrases for scholars, but the main text must be fully readable in English without knowing other languages.

**Instructions:**
1. Start with <meta>...</meta> if noting continuity with previous page (hidden from readers).
2. Mirror the source layout - headings, paragraphs, tables, centered text.
3. Translate ALL text including <margin>, <insert>, <gloss> - keep the XML tags.
4. Translate embedded Latin/Greek/Hebrew phrases to English, noting originals when significant.
5. Add <note>...</note> inline to explain historical references or difficult phrases.
6. Style: warm museum label - explain rather than assume knowledge.
7. Preserve the voice and spirit of the original.
8. END with <summary>...</summary> and <keywords>...</keywords> for indexing.

**Source language:** {source_language}
**Target language:** {target_language}

**Final output format:**
[translated text]

<summary>1-2 sentence summary of this page's main content and significance</summary>
<keywords>key concepts, names, themes in English — for indexing</keywords>`;

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
const GEMINI_BATCH_KEYS = [
  process.env.GEMINI_API_KEY_2,       // Prefer KEY_2 for batch (separate quota pool)
  process.env.GEMINI_API_KEY_TIER3,
  process.env.GEMINI_API_KEY,
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
async function submitOcrDirectly(db, book) {
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
    .limit(MAX_PAGES_PER_BOOK)
    .project({ _id: 0, id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, cropped_photo: 1, crop: 1 })
    .toArray();

  if (pages.length === 0) {
    return { submitted: 0, jobName: null, alreadyDone: true };
  }

  console.log(`    Downloading ${pages.length} images...`);
  const downloaded = await downloadImagesParallel(pages, IMAGE_CONCURRENCY);
  if (downloaded.length === 0) {
    throw new Error(`All ${pages.length} image downloads failed`);
  }
  console.log(`    Downloaded ${downloaded.length}/${pages.length} images`);

  const prompt = await getOcrPromptFromDb(db);

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

      // Upload JSONL to Gemini File API (use the first key that works)
      const apiKey = getGeminiApiKey(0);
      const fileResult = await uploadBatchFile(jsonlContent, displayName, apiKey);
      console.log(`    Uploaded file: ${fileResult.name}`);

      // Create batch job from the uploaded file
      batchJob = await createBatchJobFromFile(OCR_MODEL, fileResult.name, displayName, 0);
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
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 16384,
            thinkingConfig: { thinkingBudget: 0 },
          },
        },
        metadata: { key: item.pageId },
      }));
      batchJob = await createBatchJobInline(OCR_MODEL, inlineRequests, displayName);
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
      model: OCR_MODEL,
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
      model: OCR_MODEL,
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
      model: OCR_MODEL,
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
  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  // Emergency stop check
  const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
  if (control?.paused) {
    console.log('[pipeline-orchestrator] PAUSED by emergency stop. Exiting.');
    await client.close();
    return;
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
    finalized: 0,
    needs_attention: 0,
    stale_retried: 0,
    stale_failed: 0,
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
      const queuedBooks = await db.collection('books')
        .find({ 'pipeline_auto.status': 'queued' })
        .sort({ hidden: 1 })
        .project({ id: 1 })
        .limit(ARCHIVE_LIMIT)
        .toArray();

      if (!DRY_RUN) {
        for (const book of queuedBooks) {
          await setPipelineStatus(db, book.id, 'archiving', { started_at: new Date() });
          log.archived++;
        }
      }
      console.log(`  Queued -> archiving: ${queuedBooks.length}`);

      // Check archiving books for completion
      const archivingBooks = await db.collection('books')
        .find({ 'pipeline_auto.status': 'archiving' })
        .sort({ hidden: 1 })
        .project({ id: 1 })
        .limit(ARCHIVE_LIMIT)
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

        // Find archive_complete books that haven't had preview OCR yet
        const readyForPreview = await db.collection('books')
          .find({
            'pipeline_auto.status': 'archive_complete',
            preview_ocr_queued_at: { $exists: false },
          })
          .sort({ is_first_translation: -1, hidden: 1 })
          .project({ id: 1, title: 1, language: 1 })
          .limit(PREVIEW_LIMIT)
          .toArray();

        console.log(`  Books ready for preview: ${readyForPreview.length}`);

        for (const book of readyForPreview) {
          try {
            const label = (book.title || '').substring(0, 50);

            // Get first 25 pages with images
            const pages = await db.collection('pages')
              .find({
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

    // ── Phase 2: Submit OCR via Gemini Batch API (archive_complete -> ocr_submitted) ──
    if (shouldRun(2)) {
      console.log('\n--- Phase 2: OCR submission ---');

      const activeBatchOcr = await db.collection('batch_jobs').countDocuments({
        type: 'ocr',
        status: { $in: ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'] },
      });
      console.log(`  Active OCR batch jobs: ${activeBatchOcr}/${MAX_ACTIVE_BATCH_OCR}`);

      const ocrLimit = activeBatchOcr >= MAX_ACTIVE_BATCH_OCR ? 0 : OCR_SUBMIT_LIMIT;

      const readyForOcr = ocrLimit > 0 ? await db.collection('books')
        .find({ 'pipeline_auto.status': 'archive_complete' })
        .sort({ hidden: 1 })
        .project({ id: 1, title: 1, pages_count: 1, 'pipeline_auto.retry_count': 1 })
        .limit(ocrLimit)
        .toArray() : [];

      console.log(`  Books ready for OCR: ${readyForOcr.length}`);

      for (const book of readyForOcr) {
        const retries = book.pipeline_auto?.retry_count || 0;
        try {
          const label = (book.title || '').substring(0, 50);

          if (DRY_RUN) {
            console.log(`  Would submit OCR: ${label} (${book.pages_count} pages)`);
            continue;
          }

          // Direct OCR submission — downloads images on Hetzner, submits to Gemini Batch API
          console.log(`  Submitting OCR: ${label}...`);
          const result = await submitOcrDirectly(db, book);

          if (result.alreadyDone) {
            await setPipelineStatus(db, book.id, 'ocr_complete');
            log.ocr_advanced++;
            console.log(`  Already OCR'd: ${label}`);
          } else if (result.skippedDuplicate) {
            // Don't change state — active batch jobs exist, wait for them
            console.log(`  Skipped (active batch exists): ${label}`);
          } else {
            await setPipelineStatus(db, book.id, 'ocr_submitted', {
              ocr_job_name: result.jobName,
              retry_count: 0,
            });
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
            status: { $in: ['completed', 'saved', 'completed_with_errors'] },
          });
          const parentJob = !batchJob
            ? await db.collection('batch_jobs').findOne({
                book_id: book.id,
                type: 'ocr',
                child_job_ids: { $exists: true, $ne: [] },
                status: { $in: ['completed', 'saved', 'completed_with_errors'] },
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
        .project({ id: 1, title: 1, 'pipeline_auto.retry_count': 1, 'ai_metadata.enriched_at': 1 })
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

          const res = await fetch(`${BASE_URL}/api/books/${book.id}/verify-metadata`, {
            method: 'POST',
            headers: headers(),
          });

          if (res.ok) {
            await setPipelineStatus(db, book.id, 'metadata_enriched', { retry_count: 0 });
            log.metadata_enriched++;
          } else {
            const retries = book.pipeline_auto?.retry_count || 0;
            if (retries >= MAX_RETRIES) {
              // Non-blocking: skip on persistent failure
              await setPipelineStatus(db, book.id, 'metadata_enriched', { retry_count: 0 });
              log.metadata_skipped++;
            } else {
              await setPipelineStatus(db, book.id, 'ocr_complete', { retry_count: retries + 1 });
            }
            log.errors.push(`Metadata ${book.id}: HTTP ${res.status}`);
          }

          await sleep(API_DELAY_MS);
        } catch (err) {
          if (!DRY_RUN) {
            await setPipelineStatus(db, book.id, 'metadata_enriched', { retry_count: 0 });
          }
          log.metadata_skipped++;
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

      if (!SQS_TRANSLATION_QUEUE_URL) {
        console.log('  SKIP: SQS_PAGE_TRANSLATION_QUEUE_URL not configured');
      } else {
        const sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'eu-central-1' });

        const readyForTranslate = await db.collection('books')
          .find({ 'pipeline_auto.status': { $in: ['metadata_enriched', 'ft_verified'] } })
          .sort({ is_first_translation: -1, hidden: 1 })
          .project({ id: 1, title: 1, pages_count: 1, language: 1, 'pipeline_auto.retry_count': 1 })
          .limit(TRANSLATE_SUBMIT_LIMIT)
          .toArray();

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
              console.log(`  Would dispatch: ${label} — ${pageIds.length} pages via Lambda`);
              continue;
            }

            // Create job record
            await db.collection('jobs').insertOne({
              id: jobId,
              type: 'translation',
              book_id: book.id,
              book_title: book.title,
              status: 'pending',
              progress: { total: pageIds.length, completed: 0, failed: 0 },
              config: {
                page_ids: pageIds,
                model: 'gemini-3-flash-preview',
                language: book.language || 'auto-detect',
              },
              initiated_by: 'pipeline_orchestrator',
              created_at: new Date(),
              updated_at: new Date(),
            });

            await db.collection('books').updateOne(
              { id: book.id },
              { $set: { job: { type: 'realtime', job_id: jobId } } },
            );

            // Enqueue pages to SQS FIFO in batches of 10
            for (let i = 0; i < pageIds.length; i += 10) {
              const batch = pageIds.slice(i, i + 10);
              const entries = batch.map((pageId, idx) => ({
                Id: `msg-${idx}`,
                MessageBody: JSON.stringify({ bookId: book.id, pageId, jobId }),
                MessageGroupId: jobId,
                MessageDeduplicationId: createHash('sha256')
                  .update(`${book.id}:${pageId}:${jobId}`)
                  .digest('hex').slice(0, 128),
              }));

              const result = await sqsClient.send(new SendMessageBatchCommand({
                QueueUrl: SQS_TRANSLATION_QUEUE_URL,
                Entries: entries,
              }));

              if (result.Failed?.length) {
                console.error(`    SQS batch failed: ${result.Failed.length} messages`);
              }
            }

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

    // ── Phase 6: Enrich — summary + index (translate_complete -> enriched) ──
    if (shouldRun(6)) {
      console.log('\n--- Phase 6: Enrichment (summary + index) ---');

      const readyForEnrich = await db.collection('books')
        .find({ 'pipeline_auto.status': 'translate_complete' })
        .sort({ hidden: 1 })
        .project({ id: 1, title: 1, 'pipeline_auto.retry_count': 1 })
        .limit(ENRICH_LIMIT)
        .toArray();

      console.log(`  Books ready for enrichment: ${readyForEnrich.length}`);

      for (const book of readyForEnrich) {
        try {
          if (DRY_RUN) {
            console.log(`  Would enrich: ${book.title}`);
            continue;
          }

          await setPipelineStatus(db, book.id, 'enriching');

          const res = await fetch(`${BASE_URL}/api/books/${book.id}/index`, {
            method: 'GET',
          });

          if (!res.ok) {
            const retries = book.pipeline_auto?.retry_count || 0;
            if (retries >= MAX_RETRIES) {
              await markFailed(db, book.id, `Enrich: HTTP ${res.status}`, retries);
            } else {
              await setPipelineStatus(db, book.id, 'translate_complete', { retry_count: retries + 1 });
            }
            log.errors.push(`Enrich ${book.id}: HTTP ${res.status}`);
            continue;
          }

          await setPipelineStatus(db, book.id, 'enriched', { retry_count: 0 });
          log.enriched++;
          console.log(`  Enriched: ${book.title}`);

          await sleep(API_DELAY_MS);
        } catch (err) {
          const retries = book.pipeline_auto?.retry_count || 0;
          if (retries >= MAX_RETRIES) {
            // Non-critical — skip
            await setPipelineStatus(db, book.id, 'enriched', { retry_count: 0 });
            log.enriched++;
          } else {
            await setPipelineStatus(db, book.id, 'translate_complete', { retry_count: retries + 1 });
          }
          log.errors.push(`Enrich ${book.id}: ${err.message}`);
        }
      }
      console.log(`  Enriched: ${log.enriched}`);
    }

    // ── Phase 7: Chapter extraction (enriched -> chapters_complete) ──
    if (shouldRun(7)) {
      console.log('\n--- Phase 7: Chapter extraction ---');

      const readyForChapters = await db.collection('books')
        .find({ 'pipeline_auto.status': 'enriched' })
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
              await setPipelineStatus(db, book.id, 'enriched', { retry_count: retries + 1 });
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
              await setPipelineStatus(db, book.id, 'enriched', { retry_count: retries + 1 });
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
          'pipeline_auto.status': { $in: ['ocr_submitted', 'translate_submitted', 'images_submitted', 'enriching', 'chapters'] },
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
        'enriching': 'translate_complete',
        'chapters': 'enriched',
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

    // ── Phase 9: Finalize (images_complete -> complete) ──
    if (shouldRun(9)) {
      console.log('\n--- Phase 9: Finalize ---');

      const readyToFinalize = await db.collection('books')
        .find({ 'pipeline_auto.status': 'images_complete' })
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
        }
        log.finalized++;
        console.log(`  Finalized: ${book.title}`);
      }
      console.log(`  Finalized: ${log.finalized}`);
    }

    // ── Summary ──
    const duration = Date.now() - startTime;

    // Pipeline funnel snapshot
    const [facetResult] = await db.collection('books').aggregate([{
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
    }]).toArray();

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
    console.log(`  Finalized: ${log.finalized} | Needs attention: ${log.needs_attention}`);
    console.log(`  Stale retried: ${log.stale_retried} | Stale failed: ${log.stale_failed}`);
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
          },
          errors: log.errors.slice(0, 50).map(msg => ({ message: msg, timestamp: new Date() })),
          error_count: log.errors.length,
          summary: `E:${log.enrolled} A:${log.archived} P:${log.preview_queued} O:${log.ocr_submitted}/${log.ocr_advanced} M:${log.metadata_enriched} Tr:${log.transliterated}/${log.transliterate_pages}p T:${log.translate_submitted}/${log.translate_advanced} R:${log.enriched} C:${log.chapters_extracted} I:${log.images_submitted}/${log.images_advanced} F:${log.finalized}`,
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
