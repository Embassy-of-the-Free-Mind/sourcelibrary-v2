export interface GalleryCollection {
  id: string;
  slug: string;
  title: string;
  description: string;
  cover_image_id: string; // gallery image ID (pageId-detectionIndex)
  image_ids: string[]; // ordered list of gallery image IDs
  featured: boolean;
  sort_order: number;
  type: 'visual' | 'thematic'; // visual = curated by image subject, thematic = mirrors a book collection
  book_collection_slug?: string; // only for type: 'thematic' — links to the parallel book collection
  created_at: Date;
  updated_at: Date;
}
