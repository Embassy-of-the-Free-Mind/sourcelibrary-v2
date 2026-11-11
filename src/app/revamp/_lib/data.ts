import fs from 'node:fs';
import path from 'node:path';
import { AUTHORED } from '../_data/authored';
import type { Book, CollectionModel, RPlate } from './types';
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
  // Collections only: periods, languages and types are saved in the same shape but are not collections.
  try { return fs.readdirSync(SNAP).filter((f) => f.endsWith('.json') && !f.startsWith('_') && !/^(period|language|type)-/.test(f)).map((f) => f.replace(/\.json$/, '')); } catch { return []; }
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
function toPlate(i: Rec): RPlate | null {
  const src = thumb(i);
  if (!src) return null;
  const a = Number(i.aspect) || 0;
  const id = (i.id as string) || (i.pageId ? `${i.pageId}-${i.detectionIndex ?? 0}` : '');
  return {
    src,
    fallback: [(i.extractedUrl || i.imageUrl) as string].filter(Boolean),
    href: id ? `/gallery/image/${id}` : undefined,
    label: (i.bookTitle as string)?.slice(0, 70),
    kind: (i.type as string) || undefined,
    bookId: (i.bookId as string) || undefined,
    ...(a ? { w: Math.round(a * 1000), h: 1000 } : {}),
  };
}
/** A one-line description: the maker's own, else trimmed to 140 characters at a word. */
const shortLine = (t: string) => (t.length <= 140 ? t : `${t.slice(0, 137).replace(/\s+\S*$/, '')}…`);
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

// Pictures that make a poor card: decorated initials, ornaments, bindings, title pages, blank leaves.
const NOT_COVER = /initial|letter|ornament|headpiece|tailpiece|fleuron|border|binding|cover|spine|title.?page|endpaper|bookplate|ex.?libris|stamp|blank|printer'?s mark|colophon|text block|page of text/i;
const BAD_KIND = /decorative|symbol|exlibris|unknown|document|manuscript$/i;
function coverPicks(items: Rec[]): string[] {
  return items
    .filter((i) => {
      const a = Number(i.aspect) || 0;
      return (i.cardUrl || i.extractedUrl) && a > 0.55 && a < 1.8 && !BAD_KIND.test(String(i.type || '')) && !NOT_COVER.test(`${i.type || ''} ${i.description || ''}`);
    })
    .sort((x, y) => (Number(y.galleryQuality) || 0) - (Number(x.galleryQuality) || 0))
    .map((i) => (i.cardUrl || i.extractedUrl) as string);
}

type Facets = Record<string, { form: string[]; era: string[]; material: string | null }>;
let FACETS: { at: number; v: Facets } | null = null;
/** Adds each work's text types and eras, where the site has tagged them. Re-read when the saved file changes. */
function withFacets(bs: Book[]): Book[] {
  let at = 0;
  try { at = fs.statSync(path.join(SNAP, '_facets.json')).mtimeMs; } catch { /* not saved yet */ }
  if (!FACETS || FACETS.at !== at) FACETS = { at, v: read<Facets>('_facets') ?? {} };
  const v = FACETS.v;
  return bs.map((b) => { const f = v[b.id!]; return f ? { ...b, form: f.form, era: f.era, material: f.material } : b; });
}
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
  const hl = (col.highlighted_books as { book_id?: string; id?: string; note?: string; rank?: number; tier?: number }[] | undefined) || [];
  const noted = hl.find((h) => h.note);
  const nb = noted ? books.find((b) => b.id === (noted.book_id || noted.id)) : undefined;
  const featured = fb && a
    ? { book: fb, title: a.featuredTitle!, byline: a.featuredBy!, text: a.featuredText! }
    : nb ? { book: nb, title: nb.display_title || nb.title, byline: [nb.author, nb.year].filter(Boolean).join(' · '), text: [noted!.note!] } : null;
  // A picture type has pictures and no works, but its pictures are gallery plates, not artworks.
  const artworks = !col.plates_only && (!books.length || (Number(col.artwork_count) > 50 && total <= 1));
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
  // The intro picture: the first real illustration, not a bookplate, initial, ornament or binding.
  const goodItem = items.find((i) => !BAD_KIND.test(String(i.type || '')) && !NOT_COVER.test(`${i.type || ''} ${i.description || ''}`));
  const lead = (!a?.intro && goodItem && toPlate(goodItem)) || plates[0]; // hand-made pages keep theirs
  const leadFull = Array.isArray(lead?.fallback) ? lead.fallback[0] : lead?.fallback;
  const introPlate = a?.introImage ? { src: a.introImage } : lead ? { src: leadFull || lead.src, label: lead.label, href: lead.href } : undefined;
  return {
    slug,
    askMedia,
    introPlate,
    name: a?.name || (col.name as string),
    deck: a?.deck || (col.subtitle as string) || firstSentence(description),
    short: shortLine(a?.short || (col.subtitle as string) || firstSentence(a?.deck || description)),
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
    coverPicks: coverPicks(items),
    heroImage: (col.hero_image as string) || undefined,
    books: artworks ? [] : withFacets(books),
    all: artworks ? [] : withFacets(read<{ books: Book[] }>(`_manifest-${slug}`)?.books ?? books),
    byBook: items.reduce<Record<string, Plate[]>>((acc, i) => { const pl = toPlate(i); const k = i.bookId as string; if (pl && k) (acc[k] ??= []).push(pl); return acc; }, {}),
    notes: hl.filter((h) => h.note).map((h, i) => ({ id: (h.book_id || h.id)!, rank: h.rank ?? i + 1, note: h.note!, tier: h.tier })).sort((x, y) => x.rank - y.rank),
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
    listed: artworks ? 0 : ((snap.c.total as number) ?? books.length),
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
    slug, name: s.title as string, deck: firstSentence((s.description as string) || ''), short: shortLine(firstSentence((s.description as string) || '')), intro: [], byline: 'By Source Library', subjects: [],
    stats: { works: 0, years: years.length ? `${Math.min(...years)} – ${Math.max(...years)}` : null, firstTranslations: 0, images: (s.imageCount as number) || plates.length },
    heroTiles: plates.slice(0, 40).map((p) => p.src), coverPicks: coverPicks(items), books: [], all: [], notes: [], byBook: {}, firstTranslations: [], featured: null,
    plates, platesLabel: 'Plates', platesNote: '', pages: [], quotes: [], quoteBand: null, opensOn: 'plates', ask: null, askMedia: null, moreWorks: 0, listed: 0,
  };
}

export interface IndexItem {
  slug: string; name: string; deck: string; short?: string; href: string; maker: 'source-library' | 'reader';
  holds: string[]; books: number; images: number; artworks: number; pages: number; quotes: number;
  thumbs: string[]; languages: string[]; label?: string; example?: boolean; order: number;
  /** The cover's square crop, worked out by _tools/pick-covers.mjs from the picture itself. */
  coverCrop?: { src: string; x: number; y: number; w: number; aspect: number };
  /** One representative picture, shown square. Until a maker picks one, the best upright illustration. */
  cover?: string;
  /** Covers, pages and plates for the strip card, each at its own proportions. */
  strip?: string[];
}

/** One record per collection, for the /collections grid. A collection can hold any mix. */
export function indexItems(sortedKind: Map<string, string>): IndexItem[] {
  const items: IndexItem[] = [];
  const used = new Set<string>();
  const covers = read<Record<string, { src: string; crop: { x: number; y: number; w: number; aspect: number } }[]>>('_covers') ?? {};
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
    // One picture per collection, never the same one twice on the page: the best unused pick, else the
    // full-size first page of a book (text-only collections), never the small thumbnails.
    const pages = m.books.map((b) => b.thumbnail || b.thumbnail_blob).filter(Boolean) as string[];
    // Judged covers first (blank pages and flat bindings already rejected, crop chosen), then the old order.
    const judged = (covers[m.slug] ?? []).find((c) => !used.has(c.src));
    const cover = judged?.src ?? ([...m.coverPicks, ...pages].find((x) => x && !used.has(x)) || thumbs[0]);
    if (cover) used.add(cover);
    const coverCrop = judged ? { src: judged.src, ...judged.crop } : undefined;
    const pics = m.coverPicks.length ? m.coverPicks : m.plates.map((p) => p.src);
    const strip: string[] = [];
    for (let i = 0; strip.length < 12 && (i < pages.length || i < pics.length); i++) [pages[i], pics[i]].forEach((x) => x && strip.length < 12 && strip.push(x));
    items.push({ slug: m.slug, name: m.name, deck: m.deck, short: m.short, href, maker: 'source-library', holds, books: m.stats.works, images, artworks: art, pages: m.pages.length, quotes: m.quotes.length, thumbs, cover, coverCrop, strip, languages: langs(m.slug), label: m.label, order: items.length, ...extra });
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
