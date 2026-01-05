import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Normalize text for search matching.
 * - Removes diacritics (ü→u, é→e, ñ→n)
 * - Converts to lowercase
 * - Trims whitespace
 *
 * This allows "durer" to match "Dürer", "cafe" to match "café", etc.
 */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')                    // Decompose: ü → u + combining umlaut
    .replace(/[\u0300-\u036f]/g, '')     // Remove combining diacritical marks
    .toLowerCase()
    .trim();
}

/**
 * Check if a text field matches a search query (diacritic-insensitive).
 */
export function textMatches(text: string | null | undefined, query: string): boolean {
  if (!text) return false;
  return normalizeText(text).includes(normalizeText(query));
}

/**
 * Create a regex for diacritic-insensitive search.
 * Use this for MongoDB $regex queries.
 */
export function createSearchRegex(query: string): RegExp {
  // Escape regex special characters
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Normalize the query
  const normalized = normalizeText(escaped);
  return new RegExp(normalized, 'i');
}

/**
 * Get the best available image URL for a page.
 * Priority: cropped_photo > archived_photo > photo_original > photo
 */
export function getPageImageUrl(page: {
  cropped_photo?: string;
  archived_photo?: string;
  photo_original?: string;
  photo: string;
  crop?: unknown;
}): string {
  // If page has crop data, prefer cropped_photo
  if (page.crop && page.cropped_photo) {
    return page.cropped_photo;
  }
  // Prefer archived copy over live IA URL
  if (page.archived_photo) {
    return page.archived_photo;
  }
  // Fall back to original URLs
  return page.photo_original || page.photo;
}
