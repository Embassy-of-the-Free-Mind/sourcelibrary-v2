// =============================================================================
// Likes System
// =============================================================================

/**
 * What can be liked. `article` is liked by slug (/articles/<slug>) and is
 * private: the article page shows no count, the like only files it under the
 * reader's favorites.
 */
export const LIKE_TARGET_TYPES = ['image', 'page', 'book', 'collection', 'article'] as const;
export type LikeTargetType = (typeof LIKE_TARGET_TYPES)[number];

export function isLikeTargetType(v: unknown): v is LikeTargetType {
  return typeof v === 'string' && (LIKE_TARGET_TYPES as readonly string[]).includes(v);
}

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