// =============================================================================
// Likes System
// =============================================================================

export type LikeTargetType = 'image' | 'page' | 'book';

/**
 * A like from an anonymous visitor
 */
export interface Like {
  _id?: unknown;
  target_type: LikeTargetType;
  target_id: string;              // gallery image ID, page ID, or book ID
  visitor_id: string;             // anonymous ID from localStorage
  created_at: Date;
}

/**
 * Aggregated like count for a target
 */
export interface LikeCount {
  target_type: LikeTargetType;
  target_id: string;
  count: number;
}