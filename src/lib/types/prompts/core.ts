export type PromptType = 'ocr' | 'translation' | 'summary';

export interface PromptReference {
  id: string;                   // Prompt document ID
  name: string;                 // Prompt name for quick reference
  version: number;              // Version number
}

export interface ProcessingPrompts {
  ocr: string;
  translation: string;
  summary: string;
}

/**
 * A versioned prompt stored in the database.
 * Each prompt has a name and version number.
 * When prompts are updated, a new version is created (immutable history).
 */
export interface Prompt {
  _id?: unknown;
  id?: string;
  name: string;                           // e.g., "Standard OCR", "Latin Translation"
  type: PromptType;                       // 'ocr' | 'translation' | 'summary'
  version?: number;                       // Auto-increment per name (1, 2, 3...)
  content: string;                        // The actual prompt template (legacy name, same as 'text')
  text?: string;                          // Alias for content
  variables?: string[];                   // Variables used, e.g., ["language"]
  description?: string;                   // Human-readable description
  is_default?: boolean;                   // Is this the default prompt for this type?
  created_at?: Date;
  updated_at?: Date;                      // Legacy field
  created_by?: string;                    // User who created this version
}