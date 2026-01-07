/**
 * Prompts API Types
 * Shared between API client and route handlers
 */

export interface Prompt {
  id: string;
  name: string;
  version: string;
  type: 'ocr' | 'translation' | 'summary' | 'modernize';
  language?: string;
  content: string;
  description?: string;
  is_default?: boolean;
  created_at: Date;
  updated_at?: Date;
}

export interface PromptCreateRequest {
  name: string;
  version?: string;
  type: 'ocr' | 'translation' | 'summary' | 'modernize';
  language?: string;
  content: string;
  description?: string;
  is_default?: boolean;
}

export interface PromptUpdateRequest {
  name?: string;
  version?: string;
  type?: 'ocr' | 'translation' | 'summary' | 'modernize';
  language?: string;
  content?: string;
  description?: string;
  is_default?: boolean;
}

export interface PromptListParams {
  type?: 'ocr' | 'translation' | 'summary' | 'modernize';
  language?: string;
  is_default?: boolean;
}

export interface PromptListResponse {
  prompts: Prompt[];
  total: number;
}
