export interface DecadeBucket {
  decade: number;
  count: number;
  languages: { lang: string; count: number }[];
}

export interface TimelineOverview {
  decades: DecadeBucket[];
  summary: {
    total: number;
    yearRange: { min: number; max: number };
    topLanguages: { lang: string; count: number }[];
  };
  filters: { languages: string[]; collections: string[] };
}

export interface TimelineBook {
  id: string;
  slug?: string;
  title: string;
  display_title?: string;
  author?: string;
  year: number;
  language?: string;
  thumbnail?: string;
  pages_count?: number;
  pages_translated?: number;
  published?: string;
}

export interface TimelineDrilldown {
  decade: number;
  books: TimelineBook[];
  total: number;
  offset: number;
}
