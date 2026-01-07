/**
 * Catalog API Types
 * Shared between API client and route handlers
 */

export interface CatalogResult {
  id: string;
  title: string;
  author: string;
  year: string;
  language: string;
  description: string;
  publisher?: string;
  source: 'ia' | 'gallica' | 'bph' | 'ustc' | 'mdz';
  iaIdentifier?: string;
  gallicanArk?: string;
  bsbId?: string;
  imageUrl?: string;
  in_library?: boolean;
  library_book_id?: string;
}

export interface CatalogSearchResponse {
  query: string;
  total: number;
  results: CatalogResult[];
  sources: {
    ia?: number;
    bph?: number;
    gallica?: number;
    mdz?: number;
    ustc?: number;
  };
}

export interface CatalogImportRequest {
  source: 'ia' | 'gallica' | 'mdz';
  identifier: string;
  title: string;
  author: string;
  year?: number;
  language?: string;
}

export interface CatalogImportResponse {
  book_id: string;
  message: string;
  pages_imported: number;
}
