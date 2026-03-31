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
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Check if a string is a usable HTTP(S) image URL (not a failure marker like "failed:HTTP 404") */
export function isUsableImageUrl(url: string | undefined | null): url is string {
  return !!url && (url.startsWith('http://') || url.startsWith('https://'));
}

export function isArchiveFailed(photo: string | undefined | null): boolean {
  return typeof photo === 'string' && photo.startsWith('failed:');
}

/**
 * Get the best available image URL for a page.
 *
 * Priority: cropped_photo > archived_photo > photo_original > photo
 *
 * IMPORTANT: cropped_photo is the single-page crop from a split two-page spread.
 * When it exists, bounding boxes (from image extraction) are in its coordinate space.
 * Using archived_photo (the full spread) with those bbox coordinates causes misalignment.
 * This function is the single source of truth for image source selection — all code paths
 * that select a page image URL should use this instead of inlining the priority logic.
 *
 * If archived_photo starts with "failed:" (a marker from failed archiving attempts),
 * the original source URLs are assumed dead and skipped.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
/**
 * Format an author name for display.
 * Strips bibliographic square brackets (indicating attributed authorship)
 * and returns both the clean name and whether it was attributed.
 */
export function formatAuthor(author: string | undefined | null): { name: string; attributed: boolean } {
  if (!author) return { name: '', attributed: false };
  let trimmed = author.trim().replace(/[,;]+$/, '').trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return { name: trimmed.slice(1, -1), attributed: true };
  }
  return { name: trimmed, attributed: false };
}

export function getPageImageUrl(page: Record<string, any>): string | null {
  if (isUsableImageUrl(page.cropped_photo)) return page.cropped_photo;
  if (isUsableImageUrl(page.archived_photo)) return page.archived_photo;
  // If archiving was attempted and failed ("failed:HTTP 404" etc), the source URL is dead.
  // Don't try photo/photo_original — archiving already proved those URLs don't work.
  if (isArchiveFailed(page.archived_photo)) return null;
  if (isUsableImageUrl(page.photo_original)) return page.photo_original;
  if (isUsableImageUrl(page.photo)) return page.photo;
  return null;
}
