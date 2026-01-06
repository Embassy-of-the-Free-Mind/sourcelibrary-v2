// Available Gemini models for processing
export const GEMINI_MODELS = [
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', description: 'Latest Model - Best Quality (Recommended)' },
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Previous Generation - Lower Cost' },
] as const;

// Default model for single-page realtime operations (best quality)
export const DEFAULT_MODEL = 'gemini-3-flash-preview';

// Default model for batch operations (50% cheaper via Batch API)
export const DEFAULT_BATCH_MODEL = 'gemini-3-flash-preview';