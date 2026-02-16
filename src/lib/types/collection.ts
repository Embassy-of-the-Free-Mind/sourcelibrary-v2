export interface GalleryCollection {
  id: string;
  slug: string;
  title: string;
  description: string;
  cover_image_id: string; // gallery image ID (pageId-detectionIndex)
  image_ids: string[]; // ordered list of gallery image IDs
  featured: boolean;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}
