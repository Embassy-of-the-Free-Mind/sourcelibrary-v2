/**
 * Shared style constants for entity types, processing actions, and history events.
 *
 * All className strings use Tailwind @theme tokens defined in globals.css
 * (e.g. text-accent-rust, bg-accent-rust/8) so brand colors change in one place.
 *
 * Icons stay in each consumer — this file exports only class strings, labels,
 * and CSS color values (for style attributes that can't use Tailwind).
 */

// ─── Entity types (person / place / concept) ────────────────────────────

export type EntityType = 'person' | 'place' | 'concept';

export const ENTITY_TYPE_LABELS: Record<EntityType, string> = {
  person: 'Person',
  place: 'Place',
  concept: 'Concept',
};

/** Badge styles — background tint + text color (for icon wrappers, stat counters, etc.) */
export const ENTITY_TYPE_STYLES: Record<EntityType, {
  badge: string;
  badgeBordered: string;
  iconColor: string;
  pillHover: string;
  statColor: string;
}> = {
  person: {
    badge: 'bg-accent-rust/8 text-accent-rust',
    badgeBordered: 'bg-accent-rust/8 text-accent-rust border-accent-rust/20',
    iconColor: 'text-accent-rust',
    pillHover: 'hover:bg-accent-rust/15',
    statColor: 'text-accent-rust',
  },
  place: {
    badge: 'bg-accent-sage/12 text-accent-sage-dark',
    badgeBordered: 'bg-accent-sage/12 text-accent-sage-dark border-accent-sage/25',
    iconColor: 'text-accent-sage',
    pillHover: 'hover:bg-accent-sage/20',
    statColor: 'text-accent-sage',
  },
  concept: {
    badge: 'bg-accent-violet/8 text-accent-violet',
    badgeBordered: 'bg-accent-violet/8 text-accent-violet border-accent-violet/20',
    iconColor: 'text-accent-violet',
    pillHover: 'hover:bg-accent-violet/15',
    statColor: 'text-accent-violet',
  },
};

// ─── Search index result types (superset of entity types) ───────────────

export type SearchIndexType = EntityType | 'quote' | 'vocabulary' | 'keyword';

export const SEARCH_TYPE_STYLES: Record<SearchIndexType, {
  badge: string;
  iconColor: string;
}> = {
  ...Object.fromEntries(
    (['person', 'place', 'concept'] as EntityType[]).map(t => [t, {
      badge: ENTITY_TYPE_STYLES[t].badge,
      iconColor: ENTITY_TYPE_STYLES[t].iconColor,
    }])
  ) as Record<EntityType, { badge: string; iconColor: string }>,
  quote: {
    badge: 'bg-accent-gold/15 text-accent-gold-dark',
    iconColor: 'text-accent-rust',
  },
  vocabulary: {
    badge: 'bg-rose-100 text-rose-700',
    iconColor: 'text-rose-700',
  },
  keyword: {
    badge: 'bg-stone-100 text-stone-700',
    iconColor: 'text-stone-700',
  },
};

// ─── Annotation types ───────────────────────────────────────────────────

export type AnnotationType = 'comment' | 'context' | 'reference' | 'correction' | 'etymology' | 'question';

export const ANNOTATION_TYPE_STYLES: Record<AnnotationType, string> = {
  comment: 'bg-stone-100 text-stone-700',
  context: 'bg-accent-gold/15 text-accent-gold-dark',
  reference: 'bg-accent-violet/10 text-accent-violet',
  correction: 'bg-accent-rust/10 text-accent-rust',
  etymology: 'bg-accent-sage/15 text-accent-sage-dark',
  question: 'bg-accent-gold/15 text-accent-gold-dark',
};

// ─── Processing actions (ProcessingPanel, JobStatusBanner) ──────────────

export type ProcessingAction = 'ocr' | 'translation' | 'summary' | 'image_extraction';

export const PROCESSING_ACTION_LABELS: Record<ProcessingAction, string> = {
  ocr: 'OCR',
  translation: 'Translation',
  summary: 'Summary',
  image_extraction: 'Images',
};

/** CSS color values for style attributes (Tailwind classes can't do dynamic bg). */
export const PROCESSING_ACTION_CSS_COLORS: Record<ProcessingAction, string> = {
  ocr: 'var(--accent-sage)',
  translation: 'var(--accent-rust)',
  summary: 'var(--accent-violet)',
  image_extraction: 'var(--accent-gold)',
};

// ─── History events (BookHistory timeline) ──────────────────────────────

export type HistoryEventType =
  | 'imported' | 'archived' | 'ocr' | 'translation'
  | 'summary' | 'index' | 'image_extraction' | 'extract_chapters'
  | 'metadata_enriched' | 'metadata_change'
  | 'edition_published' | 'admin_action';

export const HISTORY_EVENT_LABELS: Record<HistoryEventType, string> = {
  imported: 'Import',
  archived: 'Archive',
  ocr: 'OCR',
  translation: 'Translation',
  summary: 'Summary',
  index: 'Index',
  image_extraction: 'Image Extraction',
  extract_chapters: 'Chapters',
  metadata_enriched: 'Metadata',
  metadata_change: 'Metadata',
  edition_published: 'Edition',
  admin_action: 'Admin',
};

/** CSS color values for timeline dots and icons (need style= for dynamic bg). */
export const HISTORY_EVENT_CSS_COLORS: Record<HistoryEventType, string> = {
  imported: '#78716c',       // stone
  archived: 'var(--status-warning)',
  ocr: 'var(--accent-sage)',
  translation: 'var(--accent-rust)',
  summary: 'var(--accent-violet)',
  index: 'var(--accent-gold)',
  image_extraction: 'var(--status-warning)',
  extract_chapters: 'var(--accent-violet)',
  metadata_enriched: 'var(--accent-gold)',
  metadata_change: 'var(--accent-gold)',
  edition_published: 'var(--accent-sage)',
  admin_action: 'var(--status-error)',
};

// ─── Note tag styles (NotesRenderer inline annotations) ─────────────────

export const NOTE_TAG_STYLES = {
  term: 'bg-accent-violet/8 text-accent-violet',
  margin: 'bg-accent-sage/12 text-accent-sage-dark border-l-2 border-accent-sage',
  gloss: 'bg-accent-violet/8 text-accent-violet',
  insert: 'bg-accent-sage/12 text-accent-sage-dark',
  note: 'bg-accent-gold/15 text-accent-gold-dark',
  // Translator's single-bracket interpolation: set apart by voice (muted,
  // italic), not by a chip — they appear mid-sentence and a highlight on
  // every supplied word would shout.
  interp: 'italic text-stone-500',
  pageType: 'bg-accent-gold/15 text-accent-gold-dark',
  blockquote: 'border-accent-rust bg-accent-rust/[0.06]',
  keywords: 'text-accent-violet',
} as const;
