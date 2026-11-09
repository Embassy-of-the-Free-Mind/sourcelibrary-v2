import type { CollectionBook } from '@/components/CollectionBookCard';
import type { MiniBook } from '@/components/BookSlider';
import type { Plate } from '@/components/GalleryMasonry';
import type { Overview } from '../_components/OverviewBand';

export type Book = CollectionBook & MiniBook;

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
  /** Best pictures to stand for the collection, sharpest first: medium-size crops, no initials, ornaments, bindings or blank pages. */
  coverPicks: string[];
  heroImage?: string;
  books: Book[];
  firstTranslations: Book[];
  featured: null | { book: Book; title: string; byline: string; text: string[] };
  plates: Plate[];
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
