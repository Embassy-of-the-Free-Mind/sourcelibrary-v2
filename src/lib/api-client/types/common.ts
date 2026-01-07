/**
 * Common API Types
 * Shared patterns and utility types
 */

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface SuccessResponse {
  success: boolean;
  message?: string;
}

export interface ErrorResponse {
  error: string;
  details?: string;
  code?: string;
}

export interface IdResponse {
  id: string;
}

export interface CountResponse {
  count: number;
}
