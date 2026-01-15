import { apiClient } from './client';

/**
 * Utility API client
 * Handles miscellaneous utility endpoints
 */
export const utils = {
  /**
   * Get available languages
   */
  languages: async (): Promise<{ languages: string[] }> => {
    return await apiClient.get('/api/languages');
  },

  /**
   * Upload a single file
   */
  upload: async (file: File): Promise<{ success: boolean; url: string }> => {
    const formData = new FormData();
    formData.append('file', file);
    return await apiClient.post('/api/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },

  /**
   * Upload multiple files
   */
  uploadMultiple: async (files: File[]): Promise<{ success: boolean; urls: string[] }> => {
    const formData = new FormData();
    files.forEach(file => formData.append('files', file));
    return await apiClient.post('/api/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  },

  /**
   * Process with AI
   */
  process: async (data: any): Promise<any> => {
    return await apiClient.post('/api/process', data);
  },

  /**
   * Translate text
   */
  translate: async (text: string, sourceLanguage: string, targetLanguage: string): Promise<{ translation: string }> => {
    return await apiClient.post('/api/translate', { text, sourceLanguage, targetLanguage });
  },

  /**
   * Explain/ask about content
   */
  explain: async (data: {
    text?: string;
    question?: string;
    context?: string;
    book_id?: string;
    book_title?: string;
    book_author?: string;
    page_number?: number;
    mode?: 'analyze' | 'explain_term' | 'ask' | 'general' | 'book_context';
    term?: string;
    customPrompt?: string;
    conversationHistory?: Array<{ role: string; content: string }>;
  }): Promise<any> => {
    return await apiClient.post('/api/explain', data);
  },

  /**
   * Track an event (alias for analytics.track)
   */
  track: async (event: string, properties?: Record<string, any>): Promise<{ success: boolean }> => {
    return await apiClient.post('/api/track', { event, properties });
  },
};
