import type { CollectionBook } from '@/components/CollectionBookCard';
import type { MiniBook } from '@/components/BookSlider';
import type { Plate } from '@/components/GalleryMasonry';
import type { Overview } from '../_components/OverviewBand';

export type Book = CollectionBook & MiniBook & {
  /** Text types (the site's form tags) and eras (when the original was written), from _tools/snapshot-facets.mjs. */
  form?: string[]; era?: string[]; material?: string | null;
};
/** A gallery plate with its picture type and the work it comes from. */
export type RPlate = Plate & { kind?: string; bookId?: string };

export interface PageItem { src: string; href: string; book: string; author: string; page: number; text: string }
export interface QuoteItem { text: string; book: string; author: string; year?: number; page: number; href: string }

/** Everything the one template needs. Each section appears only if it has material. */
export interface CollectionModel {
  slug: string;
  name: string;
  deck: string;
  /** One short line the maker writes, like a Letterboxd list description. Up to 140 characters. */
  short: string;
  introPlate?: { src: string; label?: string; href?: string };
  intro: string[];
  byline: string;
  label?: string;
  subjects: { id: string; label: string }[];
  stats: { works: number; years: string | null; firstTranslations: number; images: number };
  heroTiles: string[];
  /** Works the collection itself lists (its own API total). Can differ from the catalogue count in stats.works. */
  listed: number;
  /** Best pictures to stand for the collection, sharpest first: medium-size crops, no initials, ornaments, bindings or blank pages. */
  coverPicks: string[];
  heroImage?: string;
  books: Book[];
  /** Every work, from the saved full list (_tools/snapshot-manifest.mjs); else the same as books. */
  all: Book[];
  /** The maker's notes on single works, with the order they ranked them in. */
  /** The maker's notes on single works, with their rank and tier (1 essential, 2 important, 3 also notable) from the old collection pages. */
  notes: { id: string; rank: number; note: string; tier?: number }[];
  /** The saved plates grouped under the work they come from, by book id. */
  byBook: Record<string, RPlate[]>;
  firstTranslations: Book[];
  featured: null | { book: Book; title: string; byline: string; text: string[] };
  plates: RPlate[];
  platesLabel: string;
  platesNote: string;
  pages: PageItem[];
  quotes: QuoteItem[];
  quoteBand: null | { text: string; original?: string; source: string };
  opensOn: 'mixed' | 'plates' | 'pages' | 'quotes' | 'artworks';
  ask: string | null;
  /** Beside Ask the librarian: a made video, else a plate from the collection, else a real quote. */
  askMedia: null | { video: string } | { plate: string; fallback?: string; label?: string; href?: string } | { quote: string; source: string };
  moreWorks: number;
  overview?: Overview | null;
}
