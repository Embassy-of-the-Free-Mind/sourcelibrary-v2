import { apiClient } from './client';
import type {
  Category,
  CategoriesResponse,
  CategoryWithBooks
} from './types/categories';

/**
 * Categories API client
 * Handles book categories and classification
 */
export const categories = {
  /**
   * Get all categories
   */
  list: async (): Promise<CategoriesResponse> => {
    return await apiClient.get('/api/categories');
  },

  /**
   * Get a single category with its books
   */
  get: async (id: string): Promise<CategoryWithBooks> => {
    return await apiClient.get(`/api/categories/${id}`);
  },
};
