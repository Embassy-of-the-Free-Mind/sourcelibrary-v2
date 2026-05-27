/**
 * Shared types + rating config for review queues.
 */

export type RatingOption = {
  key: string;        // single-letter keyboard shortcut
  rating: string;     // canonical rating value (must match server-side ALLOWED_RATINGS)
  label: string;      // UI label
  color: string;      // hex / css color for the button border accent
  hint: string;       // short explanation
};

export const QUEUE_RATINGS: Record<string, RatingOption[]> = {
  hallucination: [
    { key: 'k', rating: 'matches',       label: '✓ matches',       color: '#10b981', hint: 'Description matches the page' },
    { key: 'p', rating: 'partial',       label: '~ partial',       color: '#f59e0b', hint: 'Description mentions real element but adds invented detail' },
    { key: 'j', rating: 'hallucination', label: '✗ hallucination', color: '#ef4444', hint: 'Description is fictional / page is blank or bleedthrough' },
    { key: 'u', rating: 'unclear',       label: '? unclear',       color: '#6b7280', hint: "Can't tell" },
  ],
  'gallery-quality': [
    { key: 'h', rating: 'hero',    label: '★ hero',    color: '#a855f7', hint: 'Iconic — could be the book\'s cover image' },
    { key: 'k', rating: 'yes',     label: '✓ yes',     color: '#10b981', hint: 'Belongs in the curated gallery' },
    { key: 'j', rating: 'no',      label: '✗ no',      color: '#ef4444', hint: 'Decorative / fragment / not gallery-worthy' },
    { key: 'u', rating: 'unclear', label: '? unclear', color: '#6b7280', hint: "Can't tell" },
  ],
  'scan-quality': [
    { key: 'p', rating: 'pristine',         label: '★ pristine',         color: '#a855f7', hint: 'Crisp color scan, sharp, no defects' },
    { key: 'k', rating: 'good',             label: '✓ good',             color: '#10b981', hint: 'Acceptable — minor age/discoloration' },
    { key: 'b', rating: 'bitonal',          label: '◐ bitonal',          color: '#3b82f6', hint: 'Black-and-white, but clean and readable' },
    { key: 'm', rating: 'microfilm',        label: '⚠ microfilm',        color: '#f59e0b', hint: 'Microfilm/microfiche, washed out, low contrast' },
    { key: 'j', rating: 'degraded',         label: '✗ degraded',         color: '#ef4444', hint: 'Blurry / cropped / corrupt — unusable' },
    { key: 'n', rating: 'blank',            label: '∅ blank',            color: '#6b7280', hint: 'Effectively blank page' },
    { key: 'u', rating: 'unclear',          label: '? unclear',          color: '#9ca3af', hint: "Can't tell" },
  ],
};

export function isValidRating(queue: string, rating: string): boolean {
  return QUEUE_RATINGS[queue]?.some(r => r.rating === rating) ?? false;
}

export function getRatingOptions(queue: string): RatingOption[] {
  return QUEUE_RATINGS[queue] ?? [];
}

export const QUEUE_KEYS = ['hallucination', 'gallery-quality', 'scan-quality'] as const;
export type QueueKey = (typeof QUEUE_KEYS)[number];
