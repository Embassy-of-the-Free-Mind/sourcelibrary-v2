import fs from 'node:fs';
import path from 'node:path';
import { AUTHORED } from '../_data/authored';
import type { Book, CollectionModel } from './types';
import type { Plate } from '@/components/GalleryMasonry';
import type { Overview } from '../_components/OverviewBand';

/* Reads a saved snapshot of public API output. No database, no live calls. */
const SNAP = path.join(process.cwd(), 'src/app/revamp/_data/snap');
function read<T>(name: string): T | null {
  try { return JSON.parse(fs.readFileSync(path.join(SNAP, `${name}.json`), 'utf8')) as T; } catch { return null; }
}
type Rec = Record<string, unknown>;
export function dataFile<T>(name: string): T | null {
  try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/app/revamp/_data', `${name}.json`), 'utf8')) as T; } catch { return null; }
}

export function overview(slug: string): Overview | null {
  return read<Overview>(`_stats-${slug}`);
}

export function snapshotSlugs(): string[] {
  try { return fs.readdirSync(SNAP).filter((f) => f.endsWith('.json') && !f.startsWith('_')).map((f) => f.replace(/\.json$/, '')); } catch { return []; }
}
export function indexRecords(): Rec[] {
  const v = read<Rec[] | { collections: Rec[] }>('_index');
  return Array.isArray(v) ? v : (v?.collections ?? []);
}
const thumb = (i: Rec) => {
  const t = i.thumbnailUrl as string | undefined;
  if (t) return t;
  const full = (i.extractedUrl || i.imageUrl) as string | undefined;
  return full ? full.replace(/(\.[a-z0-9]+)(\?.*)?$/i, '-thumb$1$2') : undefined;
};
function toPlate(i: Rec): Plate | null {
  const src = thumb(i);
  if (!src) return null;
  const a = Number(i.aspect) || 0;
  const id = (i.id as string) || (i.pageId ? `${i.pageId}-${i.detectionIndex ?? 0}` : '');
  return {
    src,
    fallback: [(i.extractedUrl || i.imageUrl) as string].filter(Boolean),
    href: id ? `/gallery/image/${id}` : undefined,
    label: (i.bookTitle as string)?.slice(0, 70),
    ...(a ? { w: Math.round(a * 1000), h: 1000 } : {}),
  };
}
const firstSentence = (s: string) => (s.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? s);
/** The large lead holds a sentence or two; the rest of a long first paragraph drops to body text. */
function leadSplit(ps: string[]): string[] {
  const first = ps[0];
  if (!first || first.length <= 300) return ps;
  const sentences = first.match(/[^.!?]+[.!?]+(?:\s|$)/g) ?? [first];
  let lead = '';
  for (const t of sentences) { if (lead && lead.length + t.length > 300) break; lead += t; }
  const rest = first.slice(lead.length).trim();
  return [lead.trim(), ...(rest ? [rest] : []), ...ps.slice(1)];
}
const paras = (s?: string | null) => (s || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

export function collectionModel(slug: string): CollectionModel | null {
  const snap = read<{ c: Rec; g: { items?: Rec[]; total?: number } | null }>(slug);
  if (!snap) return null;
  const col = snap.c.collection as Rec;
  const a = AUTHORED[slug];
  const books = (snap.c.books as Book[]) || [];
  const ov = overview(slug);
  const total = ov?.books?.total || ((snap.c.total as number) ?? books.length);
  let items = snap.g?.items || [];
  const allImages = snap.g?.total ?? items.length;
  if (a?.plateMatch) {
    const rx = new RegExp(a.plateMatch, 'i');
    const whole = a.wholeBookMatch ? new RegExp(a.wholeBookMatch, 'i') : null;
    items = items.filter((i) => rx.test(String(i.description || '')) || (whole?.test(String(i.bookTitle || '')) ?? false));
  }
  const plates = items.map(toPlate).filter(Boolean) as Plate[];
  const ft = books.filter((b) => b.is_first_translation && (b.pages_translated ?? 0) > 0);
  const years = books.map((b) => b.year).filter((y): y is number => typeof y === 'number' && y > 0);
  const fb = a?.featuredPrefix ? books.find((b) => String(b.slug || '').startsWith(a.featuredPrefix!)) : undefined;
  const hl = (col.highlighted_books as { book_id?: string; id?: string; note?: string; rank?: number }[] | undefined) || [];
  const noted = hl.find((h) => h.note);
  const nb = noted ? books.find((b) => b.id === (noted.book_id || noted.id)) : undefined;
  const featured = fb && a
    ? { book: fb, title: a.featuredTitle!, byline: a.featuredBy!, text: a.featuredText! }
    : nb ? { book: nb, title: nb.display_title || nb.title, byline: [nb.author, nb.year].filter(Boolean).join(' · '), text: [noted!.note!] } : null;
  const artworks = !books.length || (Number(col.artwork_count) > 50 && total <= 1);
  const description = (col.description as string) || '';
  const heroTiles = plates.slice(0, 40).map((p) => p.src);
  const artTiles = artworks ? ((col.featured_images as (string | Rec)[]) || []).map((x) => (typeof x === 'string' ? x : (x.url as string))).filter(Boolean) : [];
  // A real illustration for the Ask section: not a binding, cover or title page,
  // upright rather than extreme, and off the gallery's first row.
  const notPicture = /binding|cover|spine|title.?page|endpaper|bookplate|stamp|ex.?libris/i;
  const pictures = items.filter((i) => !notPicture.test(`${i.type || ''} ${i.description || ''}`) && (Number(i.aspect) || 0.75) > 0.55 && (Number(i.aspect) || 0.75) < 1.05);
  const tall = (pictures.map(toPlate).filter(Boolean) as Plate[])[4] ?? plates[1] ?? plates[0];
  const fallback = Array.isArray(tall?.fallback) ? tall.fallback[0] : tall?.fallback;
  const askMedia: CollectionModel['askMedia'] = a?.askVideo ? { video: a.askVideo }
    : tall ? { plate: fallback || tall.src, fallback: tall.src, label: tall.label, href: tall.href }
    : a?.quote ? { quote: a.quote.text, source: a.quote.source } : null;
  const lead = plates[0];
  const leadFull = Array.isArray(lead?.fallback) ? lead.fallback[0] : lead?.fallback;
  const introPlate = a?.introImage ? { src: a.introImage } : lead ? { src: leadFull || lead.src, label: lead.label, href: lead.href } : undefined;
  return {
    slug,
    askMedia,
    introPlate,
    name: a?.name || (col.name as string),
    deck: a?.deck || (col.subtitle as string) || firstSentence(description),
    intro: a?.intro || leadSplit(paras((col.expanded_description as string) || description)),
    byline: 'By Source Library',
    label: a?.label,
    subjects: a?.subjects || [],
    stats: {
      works: artworks ? 0 : total,
      years: years.length ? `${Math.min(...years)} – ${Math.max(...years)}` : null,
      firstTranslations: ft.length,
      images: artworks ? Number(col.artwork_count) : (allImages || 0),
    },
    heroTiles: heroTiles.length >= 8 ? heroTiles : artTiles.slice(0, 24),
    heroImage: (col.hero_image as string) || undefined,
    books: artworks ? [] : books,
    firstTranslations: ft,
    featured,
    plates: artworks ? artTiles.map((src) => ({ src })) : plates,
    platesLabel: artworks ? 'Artworks' : 'Gallery',
    platesNote: a?.platesNote || (artworks ? '' : 'Plates from across the collection, at their own proportions.'),
    pages: [],
    quotes: [],
    quoteBand: a?.quote || null,
    opensOn: artworks ? 'artworks' : 'mixed',
    ask: a?.ask ?? `Ask a question about ${(col.name as string).toLowerCase()}…`,
    moreWorks: Math.max(0, total - books.length),
    overview: ov,
  };
}

export function gallerySetModel(slug: string): CollectionModel | null {
  const s = read<Rec>(`_set-${slug}`);
  if (!s) return null;
  const items = (s.items as Rec[]) || [];
  const plates = items.map(toPlate).filter(Boolean) as Plate[];
  const years = items.map((i) => i.year as number).filter((y) => typeof y === 'number' && y > 0);
  return {
    slug, name: s.title as string, deck: firstSentence((s.description as string) || ''), intro: [], byline: 'By Source Library', subjects: [],
    stats: { works: 0, years: years.length ? `${Math.min(...years)} – ${Math.max(...years)}` : null, firstTranslations: 0, images: (s.imageCount as number) || plates.length },
    heroTiles: plates.slice(0, 40).map((p) => p.src), books: [], firstTranslations: [], featured: null,
    plates, platesLabel: 'Plates', platesNote: '', pages: [], quotes: [], quoteBand: null, opensOn: 'plates', ask: null, askMedia: null, moreWorks: 0,
  };
}

export interface IndexItem {
  slug: string; name: string; deck: string; href: string; maker: 'source-library' | 'reader';
  holds: string[]; books: number; images: number; artworks: number; pages: number; quotes: number;
  thumbs: string[]; languages: string[]; label?: string; example?: boolean; order: number;
  /** One representative picture, shown square. Until a maker picks one, the best upright illustration. */
  cover?: string;
  /** Covers, pages and plates for the strip card, each at its own proportions. */
  strip?: string[];
}

/** One record per collection, for the /collections grid. A collection can hold any mix. */
export function indexItems(sortedKind: Map<string, string>): IndexItem[] {
  const items: IndexItem[] = [];
  const records = indexRecords();
  const langs = (slug: string) => {
    const r = records.find((x) => x.slug === slug);
    return ((r?.languages as { lang: string; count: number }[] | undefined) ?? []).filter((l) => l.count > 0 && !/no linguistic|unknown/i.test(l.lang)).map((l) => l.lang);
  };
  const add = (m: CollectionModel, href: string, extra: Partial<IndexItem> = {}) => {
    const art = m.opensOn === 'artworks' ? m.stats.images : 0;
    const images = m.opensOn === 'artworks' ? 0 : m.stats.images;
    const holds = [m.stats.works > 0 && 'books', images > 0 && 'plates', art > 0 && 'artworks', m.pages.length > 0 && 'pages', m.quotes.length > 0 && 'quotes'].filter(Boolean) as string[];
    const thumbs = m.heroTiles.length >= 4 ? m.heroTiles.slice(0, 9) : [m.plates[0]?.src || m.heroImage || m.books[0]?.thumbnail_blob || m.books[0]?.thumbnail].filter(Boolean) as string[];
    const am = m.askMedia && 'plate' in m.askMedia ? m.askMedia : null;
    const cover = am?.fallback || am?.plate || m.introPlate?.src || m.heroImage || thumbs[0];
    const covers = m.books.map((b) => b.thumbnail_blob || b.thumbnail).filter(Boolean) as string[];
    const pics = m.plates.map((p) => p.src);
    const strip: string[] = [];
    for (let i = 0; strip.length < 12 && (i < covers.length || i < pics.length); i++) [covers[i], pics[i]].forEach((x) => x && strip.length < 12 && strip.push(x));
    items.push({ slug: m.slug, name: m.name, deck: m.deck, href, maker: 'source-library', holds, books: m.stats.works, images, artworks: art, pages: m.pages.length, quotes: m.quotes.length, thumbs, cover, strip, languages: langs(m.slug), label: m.label, order: items.length, ...extra });
  };
  for (const slug of snapshotSlugs()) {
    const k = sortedKind.get(slug);
    const rec = records.find((x) => x.slug === slug);
    // A page with hand-written copy, like Mycology, stays a collection whatever the sort says.
    if (!AUTHORED[slug]?.intro && (k ? k === 'subject' || k === 'retire' || k === 'library_slice' : rec?.kind === 'tradition' || rec?.kind === 'region')) continue;
    const m = collectionModel(slug);
    if (m) add(m, `/revamp/c/${slug}`, k === 'historic_library' ? { label: 'Historic library' } : {});
  }
  const set = gallerySetModel('chinese-woodcuts');
  if (set) add(set, '/revamp/sets/chinese-woodcuts');
  return items;
}
