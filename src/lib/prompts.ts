import { createHash } from 'crypto';
import { getDb } from './mongodb';
import { DEFAULT_PROMPTS, ENGLISH_MODERNIZATION_PROMPT } from './types';
import type { PromptType, PromptReference } from './types';

/** Compute md5 hash of prompt content for provenance tracking */
export function promptContentHash(content: string): string {
  return createHash('md5').update(content).digest('hex');
}

/**
 * Result of looking up a prompt - includes both the text and a reference for storage
 */
export interface PromptLookupResult {
  text: string;                    // The actual prompt text to use
  reference: PromptReference;      // Reference to store in page metadata
}

/**
 * Get a prompt by type, optionally by name or ID.
 * Returns both the prompt text and a reference for storage.
 *
 * @param type - 'ocr' | 'translation' | 'summary'
 * @param options - Optional: { name, id, customText }
 * @returns PromptLookupResult with text and reference
 */
export async function getPrompt(
  type: PromptType,
  options?: {
    name?: string;      // Look up by name (e.g., "Latin OCR (Neo-Latin)")
    id?: string;        // Look up by specific ID
    customText?: string; // Use custom text (won't have a stored reference)
  }
): Promise<PromptLookupResult> {
  // If custom text is provided, use it without a DB reference
  if (options?.customText) {
    return {
      text: options.customText,
      reference: {
        id: 'custom',
        name: 'Custom Prompt',
        version: 0,
      },
    };
  }

  try {
    const db = await getDb();
    const collection = db.collection('prompts');

    let prompt;

    if (options?.id) {
      // Look up by specific ID
      const { ObjectId } = await import('mongodb');
      prompt = await collection.findOne({ _id: new ObjectId(options.id) });
    } else if (options?.name) {
      // Look up by name (get latest version)
      prompt = await collection.findOne(
        { name: options.name },
        { sort: { version: -1 } }
      );
    } else {
      // Get default prompt for this type
      prompt = await collection.findOne(
        { type, is_default: true },
        { sort: { version: -1 } }
      );
    }

    if (prompt) {
      const content = prompt.content as string;
      return {
        text: content,
        reference: {
          id: prompt._id?.toString() || 'unknown',
          name: prompt.name as string,
          version: (prompt.version as number) || 1,
          content_hash: (prompt.content_hash as string) || promptContentHash(content),
        },
      };
    }

    // Fallback to hardcoded defaults if no prompts in DB
    console.warn(`[prompts] No prompt found for type=${type}, using hardcoded default`);
    const fallbackText = DEFAULT_PROMPTS[type];
    return {
      text: fallbackText,
      reference: {
        id: 'hardcoded',
        name: `Default ${type}`,
        version: 0,
        content_hash: promptContentHash(fallbackText),
      },
    };
  } catch (error) {
    // On any DB error, fall back to hardcoded defaults
    console.error('[prompts] Error fetching prompt:', error);
    const fallbackText = DEFAULT_PROMPTS[type];
    return {
      text: fallbackText,
      reference: {
        id: 'hardcoded',
        name: `Default ${type}`,
        version: 0,
        content_hash: promptContentHash(fallbackText),
      },
    };
  }
}

/**
 * Map of book languages to their DB prompt names.
 * When a book's language matches, we look up the language-specific OCR prompt.
 * Falls back to the default Standard OCR prompt if no match or not found.
 */
const LANGUAGE_OCR_PROMPT_NAMES: Record<string, string> = {
  arabic: 'Arabic OCR',
  hebrew: 'Hebrew OCR',
  latin: 'Latin OCR (Neo-Latin)',
  german: 'German OCR (Fraktur)',
};

/**
 * Get OCR prompt from DB (or hardcoded fallback).
 * Always uses auto-detect for language — Gemini 3 Flash detects reliably,
 * and the language hint was propagating bad metadata (e.g. "Unknown").
 *
 * If `language` is provided, looks up a language-specific prompt from DB first.
 * Falls back to the default Standard OCR prompt if no language match or not found.
 */
export async function getOcrPrompt(
  options?: { name?: string; id?: string; customText?: string; language?: string }
): Promise<PromptLookupResult> {
  // Try language-specific prompt if language is provided (and no explicit name/id/custom)
  if (options?.language && !options.name && !options.id && !options.customText) {
    const langKey = options.language.toLowerCase();
    const promptName = LANGUAGE_OCR_PROMPT_NAMES[langKey];
    if (promptName) {
      const langResult = await getPrompt('ocr', { name: promptName });
      // Only use if we found a real DB prompt (not hardcoded fallback)
      if (langResult.reference.id !== 'hardcoded') {
        return {
          text: langResult.text,
          reference: langResult.reference,
        };
      }
    }
  }

  const result = await getPrompt('ocr', options);
  const languageInstruction = `**Source language:** Detect the primary language from the text. Pages may contain multiple languages — transcribe all of them. Report the primary language in the <language> tag (e.g. <language>Latin</language>).`;
  return {
    text: result.text
      .replace('{language_instruction}', languageInstruction)
      .replace('{language}', ''), // backward compat for old prompts in DB
    reference: result.reference,
  };
}

/**
 * Map of book languages to their DB translation prompt names.
 */
const LANGUAGE_TRANSLATION_PROMPT_NAMES: Record<string, string> = {
  arabic: 'Arabic Translation',
  hebrew: 'Hebrew Translation',
  latin: 'Latin Translation (Neo-Latin)',
  german: 'German Translation (Early Modern)',
};

/**
 * Get translation prompt with language variables replaced.
 * If sourceLanguage matches a language-specific prompt in DB, uses that instead
 * of the default Standard Translation prompt.
 */
export async function getTranslationPrompt(
  sourceLanguage: string,
  targetLanguage: string = 'English',
  options?: { name?: string; id?: string; customText?: string }
): Promise<PromptLookupResult> {
  // English books get modernized instead of translated
  const isEnglish = sourceLanguage.toLowerCase() === 'english';

  if (isEnglish && !options?.customText && !options?.name && !options?.id) {
    // DB-first (#3725): the english_modernization prompt lives in the prompts
    // collection — the same row translate-worker.mjs reads — so improving it
    // never requires a deploy. This used to short-circuit to the hardcoded
    // constant, silently forking the prompt for every English book processed
    // through the API/Lambda paths. The constant remains only as a fallback
    // so English books never fail closed on a DB hiccup.
    try {
      const db = await getDb();
      const doc = await db.collection('prompts').findOne(
        { type: 'english_modernization', is_default: true },
        { sort: { version: -1 } }
      );
      if (doc?.content) {
        const content = doc.content as string;
        return {
          text: content,
          reference: {
            id: doc._id?.toString() || 'unknown',
            name: (doc.name as string) || 'English Modernization',
            version: (doc.version as number) || 1,
            content_hash: (doc.content_hash as string) || promptContentHash(content),
          },
        };
      }
    } catch (error) {
      console.error('[prompts] Error fetching english_modernization prompt:', error);
    }
    console.warn('[prompts] No english_modernization prompt in DB, using hardcoded fallback');
    return {
      text: ENGLISH_MODERNIZATION_PROMPT,
      reference: {
        id: 'hardcoded',
        name: 'English Modernization',
        version: 0,
      },
    };
  }

  // Try language-specific prompt if no explicit name/id/custom
  if (!options?.name && !options?.id && !options?.customText) {
    const langKey = sourceLanguage.toLowerCase();
    const promptName = LANGUAGE_TRANSLATION_PROMPT_NAMES[langKey];
    if (promptName) {
      const langResult = await getPrompt('translation', { name: promptName });
      if (langResult.reference.id !== 'hardcoded') {
        return {
          text: langResult.text,
          reference: langResult.reference,
        };
      }
    }
  }

  const result = await getPrompt('translation', options);
  return {
    text: result.text
      .replace('{language}', sourceLanguage)
      .replace('{sourceLanguage}', sourceLanguage)
      .replace('{targetLanguage}', targetLanguage)
      .replace('{source_language}', sourceLanguage)
      .replace('{target_language}', targetLanguage),
    reference: result.reference,
  };
}

/**
 * Get summary prompt
 */
export async function getSummaryPrompt(
  options?: { name?: string; id?: string; customText?: string }
): Promise<PromptLookupResult> {
  return getPrompt('summary', options);
}

/**
 * Get image extraction prompt from DB (or hardcoded fallback).
 */
export async function getImageExtractionPrompt(
  options?: { name?: string; id?: string; customText?: string }
): Promise<PromptLookupResult> {
  // IMAGE_EXTRACTION_PROMPT is the canonical source — import dynamically to avoid circular deps
  const result = await getPrompt('image_extraction', options);
  // If we got the empty hardcoded fallback, use the real prompt from image-extraction.ts
  if (result.reference.id === 'hardcoded' || !result.text) {
    const { IMAGE_EXTRACTION_PROMPT } = await import('./image-extraction');
    return {
      text: IMAGE_EXTRACTION_PROMPT,
      reference: {
        id: 'hardcoded',
        name: 'Image Extraction v1',
        version: 1,
        content_hash: promptContentHash(IMAGE_EXTRACTION_PROMPT),
      },
    };
  }
  return result;
}
