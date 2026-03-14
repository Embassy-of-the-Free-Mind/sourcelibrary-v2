import { DEFAULT_PROMPTS, DEFAULT_MODEL, ENGLISH_MODERNIZATION_PROMPT } from './types';
import { getGeminiClient } from './gemini-client';
import { images } from './api-client/images';
import { HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
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

// Model pricing per 1M tokens (USD)
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gemini-3-flash-preview': { input: 0.50, output: 3.00 },
  'gemini-2.5-flash': { input: 0.15, output: 0.60 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  'gemini-2.0-flash-exp': { input: 0.10, output: 0.40 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
  'gemini-1.5-pro': { input: 1.25, output: 5.00 },
  'gemini-3.1-flash-lite-preview': { input: 0.075, output: 0.30 },
  // Fallback for unknown models
  'default': { input: 0.10, output: 0.40 },
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
  const model = getGeminiClient().getGenerativeModel({ model: modelId });

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
    const outputTokens = usageMetadata?.candidatesTokenCount || 0;

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
  const model = getGeminiClient().getGenerativeModel({ model: modelId });

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
    const outputTokens = usageMetadata?.candidatesTokenCount || 0;

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
  const model = getGeminiClient().getGenerativeModel({ model: modelId });

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

  const result = await model.generateContent(prompt);

  const usageMetadata = result.response.usageMetadata;
  const inputTokens = usageMetadata?.promptTokenCount || 0;
  const outputTokens = usageMetadata?.candidatesTokenCount || 0;

  return {
    text: sanitizeTranslationTags(result.response.text()),
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
  const model = getGeminiClient().getGenerativeModel({ model: modelId });

  let prompt = customPrompt || DEFAULT_PROMPTS.summary;
  prompt += `\n\n**Translated text:**\n${translatedText}`;

  if (previousPageSummary) {
    prompt += `\n\n**Previous page summary for context:**\n${previousPageSummary}`;
  }

  const result = await model.generateContent(prompt);

  const usageMetadata = result.response.usageMetadata;
  const inputTokens = usageMetadata?.promptTokenCount || 0;
  const outputTokens = usageMetadata?.candidatesTokenCount || 0;

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
const MODERNIZATION_PROMPT = `You are rewriting a scholarly translation into clear, accessible modern English.

**Goal:** Make the text easy to read while preserving the author's meaning and ideas. This is NOT a summary - keep all the content but reorganize and clarify it.

**Your task:**
1. **Break up long sentences** - Renaissance prose often has very long periods. Split into digestible sentences.
2. **Use modern vocabulary** - Replace archaic terms with modern equivalents (but keep key technical terms with brief inline explanations)
3. **Add paragraph breaks** - Create logical paragraph structure even if the original is a wall of text
4. **Clarify references** - When the text says "as we discussed" or "the aforementioned", briefly restate what's being referred to
5. **Preserve meaning** - Never change the author's ideas, just how they're expressed
6. **Maintain flow** - If the previous page ended mid-thought, continue naturally

**What to keep:**
- All substantive content (don't summarize or skip anything)
- Key terms and names (with brief context if needed)
- The author's arguments and reasoning
- Any quoted passages (can paraphrase but note it)

**What to modernize:**
- Sentence structure (shorter, clearer)
- Vocabulary (modern equivalents)
- Paragraph organization (logical groupings)
- Pronouns and references (make explicit when unclear)

**Format:** Clean prose with paragraph breaks. No markdown headers, bullet points, or annotations. Just flowing, readable text.

**IMPORTANT:** If the translation has <note>...</note>, <term>...</term>, or other XML/bracket tags, incorporate that information naturally into the text rather than preserving the markup. Remove all tags from output.`;

export async function performModernization(
  translationText: string,
  previousContext?: {
    translation?: string;
    modernized?: string;
  },
  customPrompt?: string,
  modelId: string = DEFAULT_MODEL
): Promise<AIResult> {
  const model = getGeminiClient().getGenerativeModel({ model: modelId });

  let prompt = customPrompt || MODERNIZATION_PROMPT;
  prompt += `\n\n**Text to modernize:**\n${translationText}`;

  if (previousContext?.modernized) {
    prompt += `\n\n**Previous page (modernized) for continuity:**\n${previousContext.modernized.slice(0, 2000)}...`;
  }
  if (previousContext?.translation) {
    prompt += `\n\n**Previous page (original translation) for reference:**\n${previousContext.translation.slice(0, 2000)}...`;
  }

  const result = await model.generateContent(prompt);

  const usageMetadata = result.response.usageMetadata;
  const inputTokens = usageMetadata?.promptTokenCount || 0;
  const outputTokens = usageMetadata?.candidatesTokenCount || 0;

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
  const model = getGeminiClient().getGenerativeModel({ model: modelId });

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
  const outputTokens = usageMetadata?.candidatesTokenCount || 0;

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
