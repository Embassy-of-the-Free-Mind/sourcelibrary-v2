/** Shapes shared by the library page's client components. */

export interface CatalogBookItem {
  id: string;
  slug?: string | null;
  title: string;
  display_title?: string | null;
  author?: string | null;
  year?: number | null;
  language?: string | null;
  pages_count?: number;
  pages_ocr?: number;
  pages_translated?: number;
  pages_blank?: number;
  photo?: string | null;
  thumbnail?: string | null;
  thumbnail_blob?: string | null;
  published?: string | null;
  read_count?: number;
  is_first_translation?: boolean;
  ft_disposition?: string;
}

/** The serialisable half of `CatalogFacets` — see src/lib/books-catalog.ts. */
export interface CatalogFacetsProp {
  total: number;
  languages: { value: string; count: number }[];
  languageCount: number;
  categories: { value: string; count: number }[];
  collections: { value: string; count: number }[];
  providers: { value: string; count: number }[];
  textRoles: { value: string; count: number }[];
  decades: { year: number; count: number }[];
  yearMin: number | null;
  yearMax: number | null;
  firstTranslations: number;
  translated: number;
  transcribed: number;
  withDoi: number;
}
