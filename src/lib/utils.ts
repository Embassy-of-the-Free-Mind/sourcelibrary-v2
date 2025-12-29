import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
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
