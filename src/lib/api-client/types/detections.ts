/**
 * Image Detections API types
 */

export interface Detection {
  id?: string;
  pageId?: string;
  bookId?: string;
  description?: string;
  type?: string;
  bbox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  confidence?: number;
  model?: string;
  status?: 'pending' | 'approved' | 'rejected';
  detection_source?: 'ocr_tag' | 'vision_model' | 'manual';
  reviewed?: boolean;
  metadata?: Record<string, any>;
}

export interface PageWithDetections {
  pageId: string;
  bookId: string;
  pageNumber: number;
  imageUrl: string;
  bookTitle: string;
  author?: string;
  detections: Detection[];
}

export interface DetectionsResponse {
  detections: Detection[];
  pages: PageWithDetections[];
  total: number;
  limit: number;
  offset: number;
  books: Array<{
    id: string;
    title: string;
  }>;
  counts: {
    total?: number;
    pending: number;
    approved: number;
    rejected: number;
    reviewed?: number;
  };
}

export interface ReviewResponse extends DetectionsResponse {}

export interface MarkReviewedRequest {
  detectionIds: string[];
  reviewed: boolean;
}
