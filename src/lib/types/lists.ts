import type { LikeTargetType } from './likes';

/**
 * User lists — reader-made collections of library items, playlist-style.
 * Mongo collections: `user_lists` (one doc per list) and `user_list_items`
 * (one doc per saved item), deliberately separate collections rather than
 * fields on `users`/`books` (field-sprawl.md).
 *
 * Visibility is PRIVATE BY DEFAULT (safe-defaults.md — a default that
 * publishes must be opt-in). A public list page shows the list's title and
 * items only, never the owner's name or email.
 */

export type ListVisibility = 'private' | 'public';

/** Lists hold the same target types likes do. */
export type ListTargetType = LikeTargetType;

export interface UserList {
  /** App-level id (hex string), the URL identity — not the Mongo _id. */
  id: string;
  /** session user id for signed-in owners, localStorage v_… id for anonymous. */
  owner_id: string;
  title: string;
  description: string;
  visibility: ListVisibility;
  items_count: number;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface UserListItem {
  list_id: string;
  target_type: ListTargetType;
  target_id: string;
  added_at: Date | string;
}
