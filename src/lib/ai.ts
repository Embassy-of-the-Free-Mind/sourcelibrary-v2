import { DEFAULT_PROMPTS, DEFAULT_MODEL, ENGLISH_MODERNIZATION_PROMPT } from './types';
import { getGeminiClient } from './gemini-client';
import { outputTokensFrom } from './gemini-logger';
import { images } from './api-client/images';
import { HarmCategory, HarmBlockThreshold, type GenerationConfig } from '@google/generative-ai';
import { sanitizeTranslationTags } from './sanitize-translation-tags';

// Safety settings for OCR/transcription - disable all filters for historical texts
const OCR_SAFETY_SETTINGS = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_CIVIC_INTEGRITY,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
];

// Gemini 3.x runs thinking by default and bills thought tokens at the output rate,
// while candidatesTokenCount excludes them — so thinking must be explicitly disabled
// or the meter under-reports the bill (17x in Aug 2026, #4581). The batch writers
// (pipeline-orchestrator.mjs) already set thinkingBudget: 0; this covers the
// realtime/Lambda path. thinkingConfig is not in @google/generative-ai 0.24.x types
// but is passed through verbatim to the API (verified by live probe: thoughtsTokenCount
// 61 -> absent).
const THINKING_OFF_CONFIG = {
  thinkingConfig: { thinkingBudget: 0 },
} as unknown as GenerationConfig;

function getThinkingOffModel(modelId: string) {
  // Self-metered: every function here RETURNS its token counts, and the callers
  // that matter (the OCR/translation workers, /api/process, modernize,
  // transliterate, stitch-translations) write the usage row themselves with the
  // book and page context an automatic row could not know. Letting the client
  // also log would put TWO rows on every page of the pipeline — which would
  // double the measured spend and close the daily dial on money never spent.
  return getGeminiClient({
    selfMetered: true,
    reason: 'callers log the usage row with book/page context; auto-metering would double-count the pipeline',
  }).getGenerativeModel({
    model: modelId,
    generationConfig: THINKING_OFF_CONFIG,
  });
}

// Model pricing per 1M tokens (USD), STANDARD serving tier, text.
//
// Verify against Google's own catalogue, never a summary of the pricing page:
//   scripts/audit/spend-reconcile.mjs   (exits 2 on drift; source is
//   cloudbilling.googleapis.com/v1/services/AEFD-7695-64FA/skus)
//
// Two things this table cannot express, and both matter when reading a number
// computed from it:
//   - BATCH is exactly half of every rate below. A batch-heavy month costs less
//     than this table implies.
//   - Reasoning ("thinking") tokens bill at the OUTPUT rate. Callers must count
//     `thoughtsTokenCount` alongside `candidatesTokenCount` or the cost is
//     understated several-fold (#4581).
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Verified against the SKU catalogue 2026-09-03.
  'gemini-3-flash-preview': { input: 0.50, output: 3.00 },
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.50 },   // was 0.075/0.30 — 3.3x/5x under list (#4581)
  'gemini-3.5-flash-lite': { input: 0.30, output: 2.50 },
  'gemini-3.5-flash': { input: 1.50, output: 9.00 },       // NOT the same as 3.6/3.7 — verify, don't infer

  'gemini-3.6-flash': { input: 0.75, output: 3.75 },
  'gemini-3.7-flash': { input: 0.75, output: 3.75 },
  // Legacy models — retained for historical rows; not verifiable against the
  // current catalogue, which splits 2.5-flash by long/short input.
  'gemini-2.5-flash': { input: 0.15, output: 0.60 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  'gemini-2.0-flash-exp': { input: 0.10, output: 0.40 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
  'gemini-1.5-pro': { input: 1.25, output: 5.00 },
  // Fallback for unknown models. Deliberately NOT cheap: an unpriced model
  // should overstate, so it gets noticed, rather than hide in the noise.
  'default': { input: 0.75, output: 3.75 },
};

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface AIResult {
  text: string;
  usage: TokenUsage;
}

function calculateCost(inputTokens: number, outputTokens: number, model: string): number {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['default'];
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

/**
 * Perform OCR with a pre-loaded image buffer.
 * Caller must provide the fully resolved prompt text (from getOcrPrompt() or custom).
 * Faster than performOCR when you already have the image data (e.g., after cropping).
 */
export async function performOCRWithBuffer(
  imageBuffer: Buffer,
  mimeType: string,
  promptText: string,
  previousPageOcr?: string,
  modelId: string = DEFAULT_MODEL
): Promise<AIResult> {
  const model = getThinkingOffModel(modelId);

  let prompt = promptText;

  if (previousPageOcr) {
    prompt += `\n\n**Previous page transcription for context:**\n${previousPageOcr.slice(0, 2000)}...`;
  }

  const base64Image = imageBuffer.toString('base64');

  try {
    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType,
                data: base64Image,
              },
            },
          ],
        },
      ],
      safetySettings: OCR_SAFETY_SETTINGS,
    });

    const usageMetadata = result.response.usageMetadata;
    const inputTokens = usageMetadata?.promptTokenCount || 0;
    const outputTokens = outputTokensFrom(usageMetadata);

    return {
      text: result.response.text(),
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        costUsd: calculateCost(inputTokens, outputTokens, modelId),
      },
    };
  } catch (geminiError) {
    console.error('Gemini API error:', geminiError);
    throw new Error(`Gemini API error: ${geminiError instanceof Error ? geminiError.message : 'Unknown error'}`);
  }
}

/**
 * Perform OCR from an image URL.
 * Caller must provide the fully resolved prompt text (from getOcrPrompt() or custom).
 */
export async function performOCR(
  imageUrl: string,
  promptText: string,
  previousPageOcr?: string,
  modelId: string = DEFAULT_MODEL
): Promise<AIResult> {
  const model = getThinkingOffModel(modelId);

  let prompt = promptText;

  if (previousPageOcr) {
    prompt += `\n\n**Previous page transcription for context:**\n${previousPageOcr.slice(0, 2000)}...`;
  }

  // Fetch the image using centralized utility (handles mime type detection)
  const { base64: base64Image, mimeType: detectedMimeType } = await images.fetchBase64(imageUrl, {
    includeMimeType: true
  }) as { base64: string; mimeType: string };

  // Gemini only supports these image types
  const supportedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

  // Validate and fallback if needed
  let mimeType = detectedMimeType;
  if (!supportedMimeTypes.includes(mimeType)) {
    // Fallback to jpeg if unsupported type detected
    mimeType = 'image/jpeg';
  }

  try {
    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType,
                data: base64Image,
              },
            },
          ],
        },
      ],
      safetySettings: OCR_SAFETY_SETTINGS,
    });

    const usageMetadata = result.response.usageMetadata;
    const inputTokens = usageMetadata?.promptTokenCount || 0;
    const outputTokens = outputTokensFrom(usageMetadata);

    return {
      text: result.response.text(),
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        costUsd: calculateCost(inputTokens, outputTokens, modelId),
      },
    };
  } catch (geminiError) {
    console.error('Gemini API error:', geminiError);
    throw new Error(`Gemini API error: ${geminiError instanceof Error ? geminiError.message : 'Unknown error'}`);
  }
}

export async function performTranslation(
  ocrText: string,
  sourceLanguage: string,
  targetLanguage: string,
  previousPageTranslation?: string,
  customPrompt?: string,
  modelId: string = DEFAULT_MODEL,
  bookContext?: { title?: string; author?: string; year?: number | string }
): Promise<AIResult> {
  const model = getThinkingOffModel(modelId);

  // English books get modernized (Early Modern → Modern English) instead of translated
  const isEnglish = sourceLanguage.toLowerCase() === 'english';
  const basePrompt = customPrompt || (isEnglish ? ENGLISH_MODERNIZATION_PROMPT : DEFAULT_PROMPTS.translation);
  let prompt = basePrompt
    .replace('{source_language}', sourceLanguage)
    .replace('{target_language}', targetLanguage);

  // Inject book metadata context so the model knows what work it's translating
  if (bookContext && (bookContext.title || bookContext.author || bookContext.year)) {
    const parts = [];
    if (bookContext.title) parts.push(`Title: ${bookContext.title}`);
    if (bookContext.author) parts.push(`Author: ${bookContext.author}`);
    if (bookContext.year) parts.push(`Date: ${bookContext.year}`);
    prompt += `\n\n**Source work:** ${parts.join(' | ')}`;
  }

  prompt += isEnglish
    ? `\n\n**Text to modernize:**\n${ocrText}`
    : `\n\n**Text to translate:**\n${ocrText}`;

  if (previousPageTranslation) {
    prompt += isEnglish
      ? `\n\n**Previous page (modernized) for continuity:**\n${previousPageTranslation.slice(0, 2000)}...`
      : `\n\n**Previous page translation for continuity:**\n${previousPageTranslation.slice(0, 2000)}...`;
  }

  // If the OCR flagged this as handwritten, inject a note into the prompt
  // so the model knows readings are uncertain, and prepend the warning to the output
  const scriptMatch = ocrText.match(/<script>(handwritten|mixed)<\/script>/i);
  const warningMatch = ocrText.match(/<warning>([\s\S]*?)<\/warning>/i);
  if (scriptMatch) {
    prompt += `\n\n**Note:** This is a handwritten manuscript. Some readings marked <unclear> may be uncertain. Translate in context but acknowledge uncertainty where meaning is genuinely ambiguous.`;
  }

  const result = await model.generateContent(prompt);

  const usageMetadata = result.response.usageMetadata;
  const inputTokens = usageMetadata?.promptTokenCount || 0;
  const outputTokens = outputTokensFrom(usageMetadata);

  // Carry manuscript warnings through to the translation so both panels show them
  let translationText = sanitizeTranslationTags(result.response.text());
  if (scriptMatch) {
    const warningTag = warningMatch ? `<warning>${warningMatch[1]}</warning>\n` : '';
    translationText = `<script>${scriptMatch[1]}</script>\n${warningTag}${translationText}`;
  }

  return {
    text: translationText,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      costUsd: calculateCost(inputTokens, outputTokens, modelId),
    },
  };
}

export async function generateSummary(
  translatedText: string,
  previousPageSummary?: string,
  customPrompt?: string,
  modelId: string = DEFAULT_MODEL
): Promise<AIResult> {
  const model = getThinkingOffModel(modelId);

  let prompt = customPrompt || DEFAULT_PROMPTS.summary;
  prompt += `\n\n**Translated text:**\n${translatedText}`;

  if (previousPageSummary) {
    prompt += `\n\n**Previous page summary for context:**\n${previousPageSummary}`;
  }

  const result = await model.generateContent(prompt);

  const usageMetadata = result.response.usageMetadata;
  const inputTokens = usageMetadata?.promptTokenCount || 0;
  const outputTokens = outputTokensFrom(usageMetadata);

  return {
    text: result.response.text(),
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      costUsd: calculateCost(inputTokens, outputTokens, modelId),
    },
  };
}

// Default prompt for modernizing translations
const MODERNIZATION_PROMPT = `You are an editor turning a scholarly translation of a pre-modern text into clear, compelling modern prose — the kind you'd find in a well-edited trade paperback or hear in a quality podcast.

**Your reader:** An intelligent person with no specialist knowledge. They should be able to read this aloud naturally.

**Core rules:**
1. **Short, direct sentences.** Split Latinate periods into 1-2 clause sentences. No sentence longer than 25 words unless quoting.
2. **Modern vocabulary.** "Wherefore" → so/therefore. "Lest" → in case. "It is not easy to describe how" → "You can't imagine how." "Most honest men" → "genuinely honest people."
3. **Active voice.** "A banquet was prepared by the king" → "The king prepared a banquet."
4. **Paragraph breaks every 3-5 sentences.** The original has none. Create logical groupings.
5. **PRESERVE ALL ORIGINAL HEADINGS.** The source text contains chapter titles and section titles (in markdown: # ## ### or ->centered<-). These are the AUTHOR'S headings — keep them exactly, just modernize the wording if needed. Example: ->*The boundaries of Africa.*<- becomes ### The Boundaries of Africa. NEVER delete or replace original headings with <section-intro> tags.
6. **Editorial section intros** — You may ALSO add brief editorial context lines wrapped in XML: <section-intro>Leo describes the food and customs of the mountain people</section-intro>. These go AFTER the original heading, not instead of it. Use sparingly.
7. **Cut formulaic Latin filler:** Remove "wherefore," "the aforementioned," "as we have already said," "it is incredible to relate," "which I believe happened for this reason," and similar throat-clearing. Just say what happened.
8. **Preserve every fact, name, date, and detail.** Never summarize or skip content. Change HOW things are said, not WHAT is said.
9. **Preserve the author's voice** — humor, irony, asides, opinions, first-person moments. These are the best parts. Make them shine, don't flatten them.
10. **Read-aloud test:** Every sentence should sound natural if spoken aloud. Avoid nested subordinate clauses, double negatives, and inverted word order.

**What to remove:**
- Redundant transitions: "Wherefore," "Moreover," "Furthermore," "Now," "Indeed"
- Formulaic qualifiers: "a certain," "of that kind," "as has already been said"
- Latinate padding: "it is not to be doubted that," "one could hardly believe," "it is incredible to say how"
- Passive constructions where active is clearer

**What to keep/enhance:**
- Specific details (numbers, distances, prices, names)
- Direct speech and dialogue
- Personal observations ("I remember," "I saw," "I was there when")
- Humor and irony
- Cultural details and customs

**Cross-page continuity:**
- If previous page context is provided, your text MUST flow seamlessly from it. If the previous page ended mid-sentence or mid-thought, continue it naturally — do NOT restart or summarize.
- Match the tone, tense, and style of the previous page's modernized text.
- Never begin with a transition that ignores what came before.

**Format:** Clean prose with paragraph breaks and occasional <section-intro> headers at major topic shifts. Do NOT add new markdown headings, but DO preserve original document structure: book titles, author names, chapter headings, and section titles from the source text should be kept as markdown headings (# ## ###) exactly as they appear in the input.

**IMPORTANT — Preserve all formatting and XML tags:**
- Keep markdown formatting: *italic*, **bold**, # ## ### headings, ->centered<- text
- Keep ALL XML tags exactly as they appear: <note>...</note>, <term>...</term>, <gloss>...</gloss>, <margin>...</margin>, <insert>...</insert>, <unclear>...</unclear>
- Keep <section-intro>...</section-intro> tags you add
- Only modernize the PROSE between/around the tags, not the tags themselves
- Strip only <meta>...</meta>, <summary>...</summary>, and <keywords>...</keywords> tags (hidden metadata)`;

export async function performModernization(
  translationText: string,
  previousContext?: {
    translation?: string;
    modernized?: string;
  },
  customPrompt?: string,
  modelId: string = DEFAULT_MODEL
): Promise<AIResult> {
  const model = getThinkingOffModel(modelId);

  let prompt = customPrompt || MODERNIZATION_PROMPT;

  // Previous context FIRST so the model knows what it's continuing from
  if (previousContext?.modernized) {
    prompt += `\n\n**Previous page (modernized) — continue seamlessly from here:**\n...${previousContext.modernized.slice(-1500)}`;
  }
  if (previousContext?.translation) {
    prompt += `\n\n**Previous page (original translation) for reference:**\n...${previousContext.translation.slice(-1500)}`;
  }

  prompt += `\n\n**Text to modernize (this page):**\n${translationText}`;

  const result = await model.generateContent(prompt);

  const usageMetadata = result.response.usageMetadata;
  const inputTokens = usageMetadata?.promptTokenCount || 0;
  const outputTokens = outputTokensFrom(usageMetadata);

  return {
    text: result.response.text(),
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      costUsd: calculateCost(inputTokens, outputTokens, modelId),
    },
  };
}

// Prompt for scholarly transliteration of non-Latin scripts
const TRANSLITERATION_PROMPT_BASE = `You are a scholarly transliterator. Convert the following text to Latin characters using standard academic Romanization conventions.

CRITICAL RULES:
1. Preserve the line-by-line structure EXACTLY. Each line of output must correspond to the same line of input. Do not merge or split lines.
2. Preserve paragraph breaks and blank lines exactly as they appear.
3. PRESERVE all XML formatting tags — transliterate the text inside them but keep the tags intact:
   - <term>...</term> — transliterate the content, keep the tags
   - <margin>...</margin> — transliterate the content, keep the tags
   - <note>...</note> — keep as-is (these are usually already in Latin script)
   - <header>...</header> — transliterate the content, keep the tags
   - <page-num>...</page-num> — keep as-is (usually already Latin script)
4. Include standard scholarly diacritics (macrons for long vowels, dots for emphatics, etc.).
5. Do not translate — only transliterate. The output should be a phonetic representation in Latin script, not a translation.
6. If the text contains passages in Latin script already (e.g. Latin in a Greek manuscript), preserve them as-is.

Romanization conventions by script:
- **Greek:** Standard scholarly transliteration. α→a, β→b, γ→g, δ→d, ε→e, ζ→z, η→ē, θ→th, ι→i, κ→k, λ→l, μ→m, ν→n, ξ→x, ο→o, π→p, ρ→r, σ/ς→s, τ→t, υ→y/u, φ→ph, χ→ch, ψ→ps, ω→ō. Rough breathing→h, accents preserved where standard.
- **Hebrew:** SBL academic style. א→ʾ, ב→b/v, ג→g, ד→d, ה→h, ו→w, ז→z, ח→ḥ, ט→ṭ, י→y, כ→k/kh, ל→l, מ→m, נ→n, ס→s, ע→ʿ, פ→p/f, צ→ṣ, ק→q, ר→r, שׁ→sh, שׂ→ś, ת→t/th. Vowels: qamets→ā, patach→a, tsere→ē, segol→e, hiriq→i, holem→ō, qibbuts→u, shureq→ū, shva→ə.
- **Arabic:** DIN 31635 / Library of Congress. Include hamza (ʾ), ayn (ʿ), emphatics (ṭ, ḍ, ṣ, ẓ), long vowels (ā, ī, ū), tāʾ marbūṭa (a/at).
- **Syriac:** Based on standard Semiticist conventions, similar to Hebrew/Arabic.
- **Armenian:** Library of Congress romanization.
- **Georgian:** National system or ISO 9984.
- **Coptic/Ethiopic:** Standard scholarly conventions.
- **Chinese:** Pinyin with tone marks.
- **Japanese:** Modified Hepburn.
- **Korean:** Revised Romanization.
- **Sanskrit/Devanagari:** IAST (International Alphabet of Sanskrit Transliteration).`;

/**
 * Preprocess OCR text for transliteration: strip pure metadata tags,
 * convert ## Column headers to <column-break/> markers.
 * Keeps formatting tags (<term>, <margin>, <note>, <header>, <page-num>)
 * so the model can transliterate their content and NotesRenderer can style them.
 */
function preprocessOcrForTransliteration(ocrText: string): string {
  let text = ocrText;

  // Strip pure metadata tags AND their content (no display value)
  text = text.replace(/<lang(?:uage)?>[^<]*<\/lang(?:uage)?>/gi, '');
  text = text.replace(/<page-type>[^<]*<\/page-type>/gi, '');
  text = text.replace(/<meta>[\s\S]*?<\/meta>/gi, '');
  text = text.replace(/<detected-images>[\s\S]*?<\/detected-images>/gi, '');
  text = text.replace(/<columns>[^<]*<\/columns>/gi, '');
  text = text.replace(/<vocab>[\s\S]*?<\/vocab>/gi, '');

  // Keep formatting tags: <term>, <margin>, <note>, <header>, <page-num>
  // The model will transliterate their content while preserving the tags

  // Convert ## Column N headers to <column-break/> (first column stripped, rest become breaks)
  text = text.replace(/^---\s*$/gm, ''); // strip horizontal rules between columns
  text = text.replace(/^\s*## Column 1\s*$/gm, '');
  text = text.replace(/^\s*## Column \d+\s*$/gm, '<column-break/>');

  // Clean up excessive blank lines
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

export async function performTransliteration(
  ocrText: string,
  sourceScript: string,
  modelId: string = DEFAULT_MODEL
): Promise<AIResult> {
  const model = getThinkingOffModel(modelId);

  // Preprocess: strip metadata, convert column headers to <column-break/>
  const cleanedOcr = preprocessOcrForTransliteration(ocrText);

  let prompt = TRANSLITERATION_PROMPT_BASE;
  // Only tell the model to preserve <column-break/> if the cleaned text has one
  if (cleanedOcr.includes('<column-break/>')) {
    prompt += `\n\nIMPORTANT: The text contains <column-break/> tags marking column boundaries. PRESERVE them exactly where they appear.`;
  }
  prompt += `\n\nThe source script is: **${sourceScript}**`;
  prompt += `\n\n**Text to transliterate:**\n${cleanedOcr}`;

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    safetySettings: OCR_SAFETY_SETTINGS,
  });

  const usageMetadata = result.response.usageMetadata;
  const inputTokens = usageMetadata?.promptTokenCount || 0;
  const outputTokens = outputTokensFrom(usageMetadata);

  return {
    text: result.response.text(),
    usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      costUsd: calculateCost(inputTokens, outputTokens, modelId),
    },
  };
}

export async function processPageComplete(
  imageUrl: string,
  ocrPromptText: string,
  language: string,
  targetLanguage: string,
  previousPage?: {
    ocr?: string;
    translation?: string;
    summary?: string;
  },
  customPrompts?: {
    translation?: string;
    summary?: string;
  },
  modelId: string = DEFAULT_MODEL
): Promise<{
  ocr: string;
  translation: string;
  summary: string;
  usage: TokenUsage;
}> {
  // Step 1: OCR
  const ocrResult = await performOCR(
    imageUrl,
    ocrPromptText,
    previousPage?.ocr,
    modelId
  );

  // Step 2: Translation
  const translationResult = await performTranslation(
    ocrResult.text,
    language,
    targetLanguage,
    previousPage?.translation,
    customPrompts?.translation,
    modelId
  );

  // Step 3: Summary
  const summaryResult = await generateSummary(
    translationResult.text,
    previousPage?.summary,
    customPrompts?.summary,
    modelId
  );

  // Combine usage stats
  const totalUsage: TokenUsage = {
    inputTokens: ocrResult.usage.inputTokens + translationResult.usage.inputTokens + summaryResult.usage.inputTokens,
    outputTokens: ocrResult.usage.outputTokens + translationResult.usage.outputTokens + summaryResult.usage.outputTokens,
    totalTokens: ocrResult.usage.totalTokens + translationResult.usage.totalTokens + summaryResult.usage.totalTokens,
    costUsd: ocrResult.usage.costUsd + translationResult.usage.costUsd + summaryResult.usage.costUsd,
  };

  return {
    ocr: ocrResult.text,
    translation: translationResult.text,
    summary: summaryResult.text,
    usage: totalUsage,
  };
}
