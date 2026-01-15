/**
 * Annotations API Types
 * Shared between API client and route handlers
 */
import type { Annotation, AnnotationType, AnnotationStatus, EncyclopediaEntry, EncyclopediaEntryType, TermLink } from '@/lib/types';

export interface AnnotationCreateRequest {
  book_id: string;
  page_id: string;
  page_number: number;
  anchor: {
    text: string;
    start_offset?: number;
    end_offset?: number;
  };
  content: string;
  type: AnnotationType;
  user_name: string;
  parent_id?: string;
}

export interface AnnotationUpdateRequest {
  content?: string;
  type?: AnnotationType;
  status?: AnnotationStatus;
}

export interface AnnotationListParams {
  book_id?: string;
  page_id?: string;
  user_id?: string;
  type?: AnnotationType;
  status?: AnnotationStatus;
  parent_id?: string | null;
  limit?: number;
  offset?: number;
}

export interface AnnotationListResponse {
  annotations: Annotation[];
  total: number;
  limit: number;
  offset: number;
}

export interface AnnotationUpvoteResponse {
  success: boolean;
  upvotes: number;
  upvoted: boolean;
}

export interface EncyclopediaEntryCreateRequest {
  slug: string;
  title: string;
  aliases?: string[];
  type: EncyclopediaEntryType;
  summary: string;
  content: string;
  categories?: string[];
  related_entries?: string[];
  primary_sources?: Array<{
    book_id: string;
    page_numbers: number[];
    quote?: string;
  }>;
  external_references?: Array<{
    title: string;
    url?: string;
    citation?: string;
  }>;
  created_by_name?: string;
}

export interface EncyclopediaEntryUpdateRequest {
  title?: string;
  aliases?: string[];
  type?: EncyclopediaEntryType;
  summary?: string;
  content?: string;
  categories?: string[];
  related_entries?: string[];
  primary_sources?: Array<{
    book_id: string;
    page_numbers: number[];
    quote?: string;
  }>;
  external_references?: Array<{
    title: string;
    url?: string;
    citation?: string;
  }>;
}

export interface EncyclopediaListParams {
  type?: EncyclopediaEntryType;
  category?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface EncyclopediaListResponse {
  entries: EncyclopediaEntry[];
  total: number;
  limit: number;
  offset: number;
}
