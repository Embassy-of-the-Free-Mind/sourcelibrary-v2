import { apiClient } from './client';
import type {
  Entity,
  EntitiesListResponse,
  EntitiesListFilters,
  EntityResponse,
  EntityUpdateRequest,
} from './types/entities';

/**
 * Entities (Encyclopedia) API client
 * Handles all entity/encyclopedia-related operations
 */
export const entities = {
  /**
   * List all entities with optional filters
   *
   * @param filters - Optional filters (type, q, book_id, min_books, limit, offset)
   * @returns List of entities with pagination info
   */
  list: async (filters?: EntitiesListFilters): Promise<EntitiesListResponse> => {
    const params = new URLSearchParams();

    if (filters) {
      if (filters.type) params.append('type', filters.type);
      if (filters.q) params.append('q', filters.q);
      if (filters.book_id) params.append('book_id', filters.book_id);
      if (filters.min_books !== undefined) params.append('min_books', filters.min_books.toString());
      if (filters.limit !== undefined) params.append('limit', filters.limit.toString());
      if (filters.offset !== undefined) params.append('offset', filters.offset.toString());
    }

    const queryString = params.toString();
    const url = queryString ? `/api/entities?${queryString}` : '/api/entities';
    return await apiClient.get(url);
  },

  /**
   * Get a single entity by ID or name
   *
   * @param nameOrId - Entity name (URL-encoded) or MongoDB ObjectId
   * @returns Entity with related entities
   */
  get: async (nameOrId: string): Promise<EntityResponse> => {
    return await apiClient.get(`/api/entities/${encodeURIComponent(nameOrId)}`);
  },

  /**
   * Update entity metadata (description, aliases, wikipedia_url)
   *
   * @param id - Entity MongoDB ObjectId
   * @param updates - Fields to update
   * @returns Success response with updated fields
   */
  update: async (id: string, updates: EntityUpdateRequest): Promise<{ success: boolean; updated: EntityUpdateRequest }> => {
    return await apiClient.patch(`/api/entities/${id}`, updates);
  },

  /**
   * Search entities by query
   *
   * @param query - Search query (searches name and aliases)
   * @param type - Optional filter by type
   * @param limit - Max results
   * @returns List of matching entities
   */
  search: async (query: string, type?: 'person' | 'place' | 'concept', limit?: number): Promise<EntitiesListResponse> => {
    return entities.list({
      q: query,
      type,
      limit,
    });
  },

  /**
   * Get entities from a specific book
   *
   * @param bookId - Book ID
   * @param type - Optional filter by type
   * @param limit - Max results
   * @returns List of entities in book
   */
  getByBook: async (bookId: string, type?: 'person' | 'place' | 'concept', limit?: number): Promise<EntitiesListResponse> => {
    return entities.list({
      book_id: bookId,
      type,
      limit,
    });
  },

  /**
   * Get most connected entities (appear in multiple books)
   *
   * @param minBooks - Minimum number of books (default: 2)
   * @param type - Optional filter by type
   * @param limit - Max results
   * @returns List of well-connected entities
   */
  getMostConnected: async (minBooks: number = 2, type?: 'person' | 'place' | 'concept', limit?: number): Promise<EntitiesListResponse> => {
    return entities.list({
      min_books: minBooks,
      type,
      limit,
    });
  },
};
