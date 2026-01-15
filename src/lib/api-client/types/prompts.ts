import { Prompt } from '@/lib/types';

/**
 * Prompts API Types
 * Shared between API client and route handlers
 */

export interface PromptCreateRequest {
  name: string;
  version?: string;
  type: Prompt['type'];
  language?: string;
  content: string;
  description?: string;
  is_default?: boolean;
}

export interface PromptUpdateRequest {
  name?: string;
  version?: string;
  type?: Prompt['type'];
  language?: string;
  content?: string;
  description?: string;
  is_default?: boolean;
}

export interface PromptListParams {
  type?: Prompt['type'];
  language?: string;
  is_default?: boolean;
}

// Note: The API actually returns an array directly, not an object with prompts property
export type PromptListResponse = Prompt[];
