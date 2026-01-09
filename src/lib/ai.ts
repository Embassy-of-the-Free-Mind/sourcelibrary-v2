import { DEFAULT_PROMPTS, DEFAULT_MODEL } from './types';
import { getGeminiClient } from './gemini';
import { images } from './api-client/images';

// Model pricing per 1M tokens (USD)
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gemini-3-flash-preview': { input: 0.50, output: 3.00 },
  'gemini-2.5-flash': { input: 0.15, output: 0.60 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  'gemini-2.0-flash-exp': { input: 0.10, output: 0.40 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
  'gemini-1.5-pro': { input: 1.25, output: 5.00 },
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
 * Faster than performOCR when you already have the image data (e.g., after cropping).
 */
export async function performOCRWithBuffer(
  imageBuffer: Buffer,
  mimeType: string,
  language: string,
  previousPageOcr?: string,
  customPrompt?: string,
  modelId: string = DEFAULT_MODEL
): Promise<AIResult> {
  const model = getGeminiClient().getGenerativeModel({ model: modelId });

  let prompt = (customPrompt || DEFAULT_PROMPTS.ocr).replace('{language}', language);

  if (previousPageOcr) {
    prompt += `\n\n**Previous page transcription for context:**\n${previousPageOcr.slice(0, 2000)}...`;
  }

  const base64Image = imageBuffer.toString('base64');

  try {
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType,
          data: base64Image,
        },
      },
    ]);

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

export async function performOCR(
  imageUrl: string,
  language: string,
  previousPageOcr?: string,
  customPrompt?: string,
  modelId: string = DEFAULT_MODEL
): Promise<AIResult> {
  const model = getGeminiClient().getGenerativeModel({ model: modelId });

  let prompt = (customPrompt || DEFAULT_PROMPTS.ocr).replace('{language}', language);

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
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType,
          data: base64Image,
        },
      },
    ]);

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
  modelId: string = DEFAULT_MODEL
): Promise<AIResult> {
  const model = getGeminiClient().getGenerativeModel({ model: modelId });

  let prompt = (customPrompt || DEFAULT_PROMPTS.translation)
    .replace('{source_language}', sourceLanguage)
    .replace('{target_language}', targetLanguage);

  prompt += `\n\n**Text to translate:**\n${ocrText}`;

  if (previousPageTranslation) {
    prompt += `\n\n**Previous page translation for continuity:**\n${previousPageTranslation.slice(0, 2000)}...`;
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

export async function processPageComplete(
  imageUrl: string,
  language: string,
  targetLanguage: string,
  previousPage?: {
    ocr?: string;
    translation?: string;
    summary?: string;
  },
  customPrompts?: {
    ocr?: string;
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
    language,
    previousPage?.ocr,
    customPrompts?.ocr,
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
