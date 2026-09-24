/**
 * PRIOR ART: src/lib/iconclass-categories.ts (deleted in #5012) was the last browse
 * vocabulary; it indexed model-recalled Iconclass codes that covered 1.2% of images.
 * scripts/maintenance/build-gallery-subject-index.mjs grouped nothing — it counted raw
 * strings, so "botany", "herbalism" and "flora" were separate tiles. This module and
 * `image-subject-map.ts` are the missing join: a fixed reader-facing vocabulary plus a
 * reviewed map from the extractor's raw strings onto it.
 *
 * Browse topics for book illustrations (#4856) — the vocabulary side.
 *
 * `src/data/image-subjects.json` is a two-level list of categories and terms in a
 * reader's words. A topic id is either a category id (`plants`) or a term id
 * (`plants.medicinal`). This module is safe to import from client components: it
 * carries only the vocabulary (~150 labels). The raw-string expansion lives in
 * `image-subject-map.ts`, server-side, so the 2K-entry map never ships to browsers.
 */
import vocabulary from '@/data/image-subjects.json';

export interface SubjectTerm { id: string; label: string }
export interface SubjectCategory { id: string; label: string; terms: SubjectTerm[] }

export const SUBJECT_CATEGORIES: SubjectCategory[] = vocabulary.categories;

/** The label for a category or term id, or null if the id is not in the vocabulary. */
export function topicLabel(topicId: string): string | null {
  for (const cat of SUBJECT_CATEGORIES) {
    if (cat.id === topicId) return cat.label;
    const term = cat.terms.find((t) => t.id === topicId);
    if (term) return term.label;
  }
  return null;
}

export function topicHref(topicId: string): string {
  return `/gallery?topic=${encodeURIComponent(topicId)}`;
}
