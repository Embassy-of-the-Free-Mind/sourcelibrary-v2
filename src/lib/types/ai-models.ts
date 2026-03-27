// Available Gemini models for processing
export const GEMINI_MODELS = [
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', description: 'Best Quality - Use for BPH and complex content' },
  { id: 'gemini-3.1-flash-lite-preview', name: 'Gemini 3.1 Flash Lite', description: 'Cost-Efficient - 50% cheaper, comparable quality' },
] as const;

// Full-quality model (BPH books, complex scripts, image extraction)
export const DEFAULT_MODEL = 'gemini-3-flash-preview';

// Cost-efficient model for standard OCR and translation
export const DEFAULT_LITE_MODEL = 'gemini-3.1-flash-lite-preview';

// Default model for batch operations (50% cheaper via Batch API)
export const DEFAULT_BATCH_MODEL = 'gemini-3-flash-preview';

/**
 * Select the appropriate model for a book's OCR/translation.
 * BPH books get full flash; everything else gets flash-lite.
 */
export function getModelForBook(book: { image_source?: { provider?: string } } | null): string {
  if (book?.image_source?.provider === 'bph') {
    return DEFAULT_MODEL;
  }
  return DEFAULT_LITE_MODEL;
}
