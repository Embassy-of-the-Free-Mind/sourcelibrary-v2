import { getDb } from './mongodb';
import { DEFAULT_PROMPTS } from './types';
import type { PromptType, PromptReference } from './types';

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
      return {
        text: prompt.content as string,
        reference: {
          id: prompt._id?.toString() || 'unknown',
          name: prompt.name as string,
          version: (prompt.version as number) || 1,
        },
      };
    }

    // Fallback to hardcoded defaults if no prompts in DB
    console.warn(`[prompts] No prompt found for type=${type}, using hardcoded default`);
    return {
      text: DEFAULT_PROMPTS[type],
      reference: {
        id: 'hardcoded',
        name: `Default ${type}`,
        version: 0,
      },
    };
  } catch (error) {
    // On any DB error, fall back to hardcoded defaults
    console.error('[prompts] Error fetching prompt:', error);
    return {
      text: DEFAULT_PROMPTS[type],
      reference: {
        id: 'hardcoded',
        name: `Default ${type}`,
        version: 0,
      },
    };
  }
}

/**
 * Get OCR prompt with language variable replaced
 */
export async function getOcrPrompt(
  language: string,
  options?: { name?: string; id?: string; customText?: string }
): Promise<PromptLookupResult> {
  const result = await getPrompt('ocr', options);
  return {
    text: result.text.replace('{language}', language),
    reference: result.reference,
  };
}

/**
 * Get translation prompt with language variables replaced
 */
export async function getTranslationPrompt(
  sourceLanguage: string,
  targetLanguage: string = 'English',
  options?: { name?: string; id?: string; customText?: string }
): Promise<PromptLookupResult> {
  const result = await getPrompt('translation', options);
  return {
    text: result.text
      .replace('{language}', sourceLanguage)
      .replace('{sourceLanguage}', sourceLanguage)
      .replace('{targetLanguage}', targetLanguage),
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
