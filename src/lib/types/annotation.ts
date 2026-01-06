// ============================================
// COMMUNITY ANNOTATIONS & ENCYCLOPEDIA
// ============================================

/**
 * Annotation types for categorizing community contributions
 */
export type AnnotationType =
    'comment' |
    'context' |
    'correction' |
    'reference' |
    'question' |
    'etymology';

/**
 * Moderation status for annotations
 */
export type AnnotationStatus = 'pending' | 'approved' | 'hidden';

/**
 * Community contribution on a specific text passage
 * Inspired by Pepys Diary annotation model
 */
export interface Annotation {
  id: string;
  _id?: string;
  book_id: string;
  page_id: string;
  page_number: number;

  // Text anchor (what's being annotated)
  anchor: {
    text: string;             // The selected text
    start_offset?: number;    // Character offset in page translation
    end_offset?: number;
  };

  // Content
  content: string;            // Markdown annotation text
  type: AnnotationType;

  // Attribution (will be linked to auth later)
  user_id?: string;           // NextAuth user (optional until auth)
  user_name: string;          // Display name (denormalized)

  // Community curation
  upvotes: number;
  upvoted_by: string[];       // User IDs or IP hashes

  // Moderation
  status: AnnotationStatus;

  // Threading
  parent_id?: string;         // For replies to other annotations
  reply_count: number;

  // Encyclopedia links (annotations can reference entries)
  encyclopedia_refs?: string[]; // Encyclopedia entry IDs mentioned

  created_at: Date;
  updated_at?: Date;
}

/**
 * Encyclopedia entry types
 */
export type EncyclopediaEntryType =
    'term' |
    'person' |
    'place' |
    'work' |
    'concept';

/**
 * Shared encyclopedia entry for terms, people, places, etc.
 * Grows organically from annotations and term extraction
 */
export interface EncyclopediaEntry {
  id: string;
  _id?: string;
  slug: string;               // URL-friendly: "quinta-essentia"

  // Core content
  title: string;              // "Quinta Essentia"
  aliases: string[];          // ["Fifth Essence", "Quintessence"]
  type: EncyclopediaEntryType;

  // Definition
  summary: string;            // Short definition (1-2 sentences)
  content: string;            // Full markdown article

  // Categorization
  categories: string[];       // ["Alchemy", "Paracelsian"]
  related_entries: string[];  // IDs of related encyclopedia entries

  // Sources from the library
  primary_sources: Array<{
    book_id: string;
    book_title?: string;      // Denormalized for display
    page_numbers: number[];
    quote?: string;           // Representative quote
  }>;

  // External references
  external_references: Array<{
    title: string;
    url?: string;
    citation?: string;        // Formatted citation
  }>;

  // Attribution
  created_by?: string;        // User ID who created
  created_by_name?: string;   // Denormalized display name
  contributors: string[];     // User IDs who edited

  // Community metrics
  view_count: number;
  annotation_count: number;   // How many annotations link here

  created_at: Date;
  updated_at?: Date;
}

/**
 * Auto-extracted link from book text to encyclopedia entry
 * Created by scanning translations for known terms
 */
export interface TermLink {
  id: string;
  _id?: string;
  book_id: string;
  page_id: string;
  page_number: number;

  term: string;               // The text that matches
  encyclopedia_id: string;    // What it links to
  encyclopedia_slug: string;  // Denormalized for URL building

  // Confidence tracking
  confidence: 'auto' | 'confirmed' | 'rejected';
  confirmed_by?: string;      // User who confirmed/rejected

  // Position in text (for highlighting)
  start_offset?: number;
  end_offset?: number;

  created_at: Date;
  updated_at?: Date;
}