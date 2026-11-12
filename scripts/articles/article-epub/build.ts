// Assembles the EPUB from article.html, refs.txt and pages/ in the cwd (see README.md).
// Usage: node build.mjs <article-slug> <out.epub>
import fs from 'fs';
import { markdownToHtml } from '@/lib/export-markdown-html';
import { EPub } from 'epub-gen-memory';
import { posts } from '@/app/articles/posts';
import { imageAccessFor } from '@/lib/types/image-source';
import { fetchAndCompressImage, pageExportImageUrl } from '@/lib/export-page-images';
import type { Page } from '@/lib/types';
import sharp from 'sharp';
import { preparePicture } from './pictures';
import { makeCover, type CoverCrop } from './cover';
import covers from './covers.json';
import openers from './openers.json';
import ornamentSet from './ornaments.json';
import briefs from './briefs.json';
import plates from './plates.json';
import { images } from '@/lib/api-client';

const [slug, out] = process.argv.slice(2);
// STYLE=bw: pictures for e-ink (page scans 1-bit, figures grayscale: pictures.ts). Default: colour.
// Either way every picture is cropped to its printed area.
const BW = process.env.STYLE === 'bw';
const post = posts.find((p) => p.slug === slug);
if (!post) throw new Error(`no post ${slug} in src/app/articles/posts.ts`);

const SITE = 'https://sourcelibrary.org';
const refs = fs.readFileSync('refs.txt', 'utf8').trim().split('\n').filter(Boolean);
const anchor = (r: string) => 'r-' + r.replace(/\?page=/, '-');
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Tags in the stored page text that are layout, not reading (running heads, signatures, catchwords).
const LAYOUT = /<(page-num|sig|catch|header|footer)>[\s\S]*?<\/\1>/g;

/** A picture, sized for an e-reader (800×1200) and prepared by pictures.ts, as a local file the EPUB embeds;
 *  null when it cannot be read. */
async function picture(url: string, name: string, kind: 'scan' | 'figure', rotate = 0): Promise<string | null> {
  const buf = url.startsWith('file://')
    ? await sharp(fs.readFileSync(url.slice(7))).resize(800, 1200, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 75, mozjpeg: true }).toBuffer()
    : await fetchAndCompressImage(url, { colour: true, width: 800, height: 1200 });
  if (!buf) return null;
  const { data, ext } = await preparePicture(rotate ? await sharp(buf).rotate(rotate).toBuffer() : buf, kind, BW);
  const f = `${process.cwd()}/scans/${name}.${ext}`;
  fs.writeFileSync(f, data);
  return `file://${f}`;
}
fs.mkdirSync('scans', { recursive: true });

// The house ornaments (ornaments/*.png, cut from the library's own woodcuts by ornaments.mjs) are ink masks:
// black, with the ink as alpha. In colour they are tinted to a brand ink that also shows on a dark page
// (Apple Books' night theme does not invert pictures); for e-ink they are black on white.
const HERE = process.env.EPUB_DIR!;
const INK = { rust: '#7d3021', gold: '#9e7c3c' };
const ornamentCache = new Map<string, string>();
async function ornament(name: string, ink: keyof typeof INK): Promise<string | null> {
  const key = `${name}-${ink}`;
  if (ornamentCache.has(key)) return ornamentCache.get(key)!;
  const src = `${HERE}/ornaments/${name}.png`;
  if (!fs.existsSync(src)) return null;
  const f = `${process.cwd()}/scans/orn-${key}.png`;
  if (BW) {
    fs.writeFileSync(f, await sharp(src).flatten({ background: '#ffffff' }).grayscale().png({ palette: true, colours: 16 }).toBuffer());
  } else {
    const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(INK[ink].slice(i, i + 2), 16));
    for (let i = 0; i < data.length; i += 4) { data[i] = r; data[i + 1] = g; data[i + 2] = b; }
    fs.writeFileSync(f, await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png({ palette: true, colours: 64 }).toBuffer());
  }
  ornamentCache.set(key, `file://${f}`);
  return `file://${f}`;
}
const orn = async (name: string, cls: string, ink: keyof typeof INK = 'gold') => {
  const f = await ornament(name, ink);
  return f ? `<div class="orn ${cls}"><img src="${f}" alt=""/></div>` : '';
};

// The essay: a link to a cited page goes to that page's reading in the back.
const rendered = fs.readFileSync('article.html', 'utf8');
const unesc = (v: string) => v.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const header = rendered.match(/<div data-epub-header="" data-title="([^"]*)"(?: data-subtitle="([^"]*)")?/);
const displayTitle = header ? unesc(header[1]) : post.title.split(': ')[0];
const displaySubtitle = header?.[2] ? unesc(header[2]) : post.title.split(': ').slice(1).join(': ');
let essay = rendered
  .replace(/<div data-epub-header=""[^>]*><\/div>/, '')
  .replace(/<link rel="preload"[^>]*\/>/g, '') // React's image preload hints: page furniture, not content
  .replace(/<blockquote data-book="[^"]*" data-page="[^"]*" data-src="[^"]*">/g, '<blockquote>')
  .replace(/href="https:\/\/sourcelibrary\.org\/book\/([a-z0-9-]+\?page=\d+)"/g, (m, r) =>
    refs.includes(r) ? `href="readings.xhtml#${anchor(r)}"` : m);

// An interactive chart (a figure of buttons: the Hyperborea timeline) cannot run in a book. Its lanes and the
// dots' labels are in the rendered HTML, so it is set as a table of what it shows; any other button is dropped.
essay = essay.replace(/<figure class="not-prose[^"]*">([\s\S]*?)<\/figure>/g, (m, inner: string) => {
  if (!/<button/.test(inner)) return m;
  const title = inner.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/)?.[1] ?? '';
  const lanes = inner.split(/<div class="text-xs text-muted leading-tight">/).slice(1).map((seg) => ({
    label: seg.slice(0, seg.indexOf('</div>')),
    items: [...seg.matchAll(/aria-label="([^"]+)"/g)].map((x) => x[1]),
  })).filter((l) => l.items.length);
  if (!lanes.length) return '';
  return `<div class="table"><p class="tabletitle">${title}</p>${lanes.map((l) =>
    `<p class="lane">${l.label}</p><p class="laneitems">${l.items.map((it) => it.replace(/, (?=[^,]*$)/, ' <span class="when">') + '</span>').join('<br/>')}</p>`).join('')}</div>`;
}).replace(/<button[\s\S]*?<\/button>/g, '');

{
  let i = 0;
  for (const src of [...new Set([...essay.matchAll(/<img src="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&')))]) {
    const local = await picture(src, `figure-${i++}`, 'figure');
    if (local) essay = essay.split(`src="${src.replace(/&/g, '&amp;')}"`).join(`src="${local}"`);
  }
}

// The sources: the cited pages, grouped by book, books in the order the essay first cites them, each book's
// pages in page order. Each page carries its scan, as the site's continuous EPUB does: only when the book's
// scans may be redistributed (imageAccessFor 'open'), resolved by pageExportImageUrl, recompressed.
type SourcePage = { id: string; page: number; label: string; scan: string; text: string; online: string };
const books = new Map<string, { title: string; author: string; published: string; translated: boolean; pages: SourcePage[] }>();
let words = 0, scans = 0, withheld = 0, readingCount = 0;
for (const r of refs) {
  const [book, page] = r.split('?page=');
  const file = `pages/${book}-${page}.json`;
  if (!fs.existsSync(file)) continue;
  const q = JSON.parse(fs.readFileSync(file, 'utf8'));
  const english = /^english/i.test(q.language || '');
  const text: string = ((english && q.original) || q.translation || q.original || '').replace(LAYOUT, '');
  if (!text.trim()) continue;
  // printed_page is the fitted page-number record ({ label, numbering, … }); older rows hold a bare value.
  // The reader sees the page number printed on the leaf; the scan number only when the leaf has none.
  const printed = q.printed_page && typeof q.printed_page === 'object' ? q.printed_page.label : q.printed_page;
  const label = `p. ${esc(printed || page)}`;
  words += text.split(/\s+/).length;
  readingCount++;
  let scan = '';
  const url = q.pageDoc ? pageExportImageUrl(q.pageDoc as Page) : null;
  if (url && imageAccessFor(q.book ?? {}) === 'open') {
    const local = await picture(url, anchor(r), 'scan');
    if (local) { scan = `<figure class="scan"><img src="${local}" alt="${esc(q.title)}, ${label}"/></figure>`; scans++; }
  } else if (url) withheld++;
  if (!books.has(book)) {
    books.set(book, {
      title: q.title, author: q.author || '', published: q.published && q.published !== 'Unknown' ? String(q.published) : '',
      translated: !english, pages: [],
    });
  }
  books.get(book)!.pages.push({ id: anchor(r), page: +page, label, scan, text: markdownToHtml(text), online: `${SITE}/book/${r}` });
}
for (const b of books.values()) b.pages.sort((x, y) => x.page - y.page);

/** Catalogue names as a reader says them: "Keyssler, Johann Georg" → "Johann Georg Keyssler", life dates dropped,
 *  several people joined with "and". Names already in reading order ("Pindar (tr. …)") pass through. */
function displayAuthor(a: string): string {
  return a.split(/\s*;\s*/).map((part) => {
    const p = part.replace(/,?\s*\d{3,4}\s*[-–]\s*\d{3,4}/, '').trim();
    const m = p.match(/^([^,()]+),\s*([^,()]+)$/);
    return m && !/\b(ed|tr|trans)\b/i.test(p) ? `${m[2]} ${m[1]}` : p;
  }).filter(Boolean).reduce((acc, p) => !acc ? p : /^(ed|tr|trans)\b/i.test(p) ? `${acc}, ${p}` : `${acc} and ${p}`, '');
}

const sourceList = [...books.values()].map((b) =>
  `<p class="src">${b.author ? `<span class="au">${esc(displayAuthor(b.author))}</span>, ` : ''}<i>${esc(b.title)}</i>${b.published ? ` (${esc(b.published)})` : ''}<span class="pp"> · ${b.pages.length > 1 ? 'pp.' : 'p.'} ${b.pages.map((pg) => `<a href="#${pg.id}">${pg.label.replace('p. ', '')}</a>`).join(', ')}</span></p>`,
).join('');
const bookRule = await orn('fleuron', 'fleuron small');
const sourceBooks = [...books.values()].map((b) => `<section class="book">
${bookRule}
<h2 class="booktitle">${esc(b.title)}</h2>
<p class="byline">${esc(displayAuthor(b.author))}${b.published ? ` · ${esc(b.published)}` : ''}</p>
${b.translated ? '<p class="byline plain">In Source Library’s English translation</p>' : ''}
${b.pages.map((pg, i) => `<section id="${pg.id}" class="reading${i ? ' next' : ''}">
<p class="pagelabel">${pg.label}</p>
${pg.scan}
<div class="text">${pg.text}</div>
<p class="online"><a href="${pg.online}">Read this page online</a></p>
</section>`).join('\n')}
</section>`).join('\n');

// One face (EB Garamond, static TTFs so every reader loads it: fonts/), one accent (the site's rust) with gold
// for rules. Derek's review, 2026-11-12: headings must not fall back to a sans, links must not show blue, italic
// only for titles and foreign words, nothing smaller than 0.9em except spaced capitals. Text colour is left to
// the reader's theme (a fixed dark ink vanishes on Apple Books' night page); only the accents are coloured, and
// both show on white, sepia and black.
const RUST = '#9e4a3a', GOLD = '#9e7c3c';
const SERIF = '"EB Garamond", Garamond, "Iowan Old Style", Palatino, Georgia, serif';
const css = `
@font-face { font-family: "EB Garamond"; font-style: normal; font-weight: normal; src: url(fonts/EBGaramond-Regular.ttf); }
@font-face { font-family: "EB Garamond"; font-style: italic; font-weight: normal; src: url(fonts/EBGaramond-Italic.ttf); }
body { font-family: ${SERIF}; font-size: 1.08em; line-height: 1.5; font-kerning: normal; }
p { margin: 0; text-indent: 1.4em; text-align: justify; hyphens: auto; -webkit-hyphens: auto; }
h1 + p, h2 + p, figure + p, blockquote + p, .orn + p, .table + p, ul + p, p.first, .noindent { text-indent: 0; }
h1, h2, h3, h4 { font-family: ${SERIF}; font-weight: normal; font-style: normal; color: ${RUST}; -webkit-text-fill-color: ${RUST}; hyphens: none; -webkit-hyphens: none; }
h1 { font-size: 1.9em; text-align: center; margin: 0.6em 0 0.8em; line-height: 1.2; }
h2 { font-size: 1.5em; text-align: center; margin: 0.2em 0 1em; line-height: 1.25; }
h3 { font-size: 1.2em; margin: 1.2em 0 0.3em; line-height: 1.25; }
a, a:link, a:visited, a:hover, a:active { color: ${RUST}; -webkit-text-fill-color: ${RUST}; text-decoration: none; }
em, i, cite { font-style: italic; }
strong, b { font-weight: normal; font-variant: normal; text-transform: uppercase; font-size: 0.86em; letter-spacing: 0.06em; }
ul { margin: 0.8em 0 0.8em 1.2em; padding: 0; }
li { margin: 0 0 0.5em; text-align: left; }
.chapnum { text-align: center; text-indent: 0; font-size: 1em; letter-spacing: 0.3em; color: ${GOLD}; -webkit-text-fill-color: ${GOLD}; margin: 0.9em 0 0.1em; }
.orn { text-align: center; margin: 0; padding: 0; page-break-inside: avoid; }
.orn img { max-width: 100%; }
.headpiece { margin: 0.4em 0 0; }
.headpiece img { width: 86%; }
.fleuron { margin: 1.8em 0 0.6em; }
.fleuron img { width: 26%; }
.fleuron.small { margin: 1em 0 0.2em; }
.fleuron.small img { width: 18%; }
.tailpiece { margin: 2em 0 0; }
.tailpiece img { width: 42%; }
.device { margin: 0 0 1.4em; }
.device img { width: 40%; }
p.first { text-indent: 0; }
img.initial { float: left; width: 4.1em; height: auto; margin: 0.25em 0.55em 0 0; }
.lead { text-transform: uppercase; letter-spacing: 0.07em; font-size: 0.9em; }
p.dropcap::first-letter { float: left; font-size: 3.3em; line-height: 0.85; margin: 0.06em 0.08em 0 0; color: ${RUST}; -webkit-text-fill-color: ${RUST}; }
blockquote { margin: 1.2em 0 1.2em 0.2em; padding: 0.1em 0 0.1em 0.9em; border-left: 2px solid ${GOLD}; }
blockquote p { text-align: left; text-indent: 0; margin-bottom: 0.4em; }
.cite { font-size: 0.92em; text-align: right; margin: 0.4em 0 0; }
figure { margin: 1.5em 0; text-align: center; page-break-inside: avoid; }
figure img { max-width: 100%; }
figcaption { font-size: 0.92em; font-style: normal; margin-top: 0.45em; text-align: center; line-height: 1.35; hyphens: none; -webkit-hyphens: none; }
figure.opener { margin: 0 0 1.4em; }
figure.opener img { max-height: 62vh; }
figure.plate { margin: 1.6em 0 0.6em; page-break-before: always; }
.key { margin: 0.6em 0 1.2em; }
.key p { text-indent: -1.7em; margin: 0 0 0.15em 1.7em; text-align: left; }
.key .n { color: ${RUST}; -webkit-text-fill-color: ${RUST}; display: inline-block; width: 1.7em; text-indent: 0; }
.table { margin: 1.6em 0; padding: 0.9em 0 0.6em; border-top: 1px solid ${GOLD}; border-bottom: 1px solid ${GOLD}; page-break-inside: avoid; }
.table p { text-indent: 0; text-align: left; }
.tabletitle { text-align: center !important; font-size: 1.15em; color: ${RUST}; -webkit-text-fill-color: ${RUST}; margin-bottom: 0.5em; }
.lane { text-transform: uppercase; letter-spacing: 0.1em; font-size: 0.82em; color: ${GOLD}; -webkit-text-fill-color: ${GOLD}; margin: 0.8em 0 0.1em; }
.laneitems { margin: 0 0 0 1em; line-height: 1.4; }
.when { float: right; }
.coverpage { margin: 0; padding: 0; text-align: center; }
.coverpage img { height: 100vh; max-width: 100%; }
.titlepage { text-align: center; padding-top: 6%; }
.titlepage p { text-indent: 0; text-align: center; hyphens: none; -webkit-hyphens: none; }
.titlepage .logo { width: 46%; margin: 0 auto 22%; }
.titlepage h1 { font-size: 2.4em; line-height: 1.12; margin: 0 0 0.45em; }
.titlepage .subtitle { font-size: 1.1em; line-height: 1.4; margin: 0 6% 1.2em; }
.label { text-transform: uppercase; letter-spacing: 0.14em; font-size: 0.82em; text-align: center; text-indent: 0; margin-bottom: 0.3em; }
.front p { text-indent: 0; margin-bottom: 0.8em; text-align: left; hyphens: none; -webkit-hyphens: none; }
.front .big { font-size: 1.22em; line-height: 1.42; }
.front .closing { text-align: center; margin-top: 1.4em; }
.intro { text-indent: 0; text-align: center; margin: 0 6% 1.6em; hyphens: none; -webkit-hyphens: none; }
.sources .src { text-align: left; text-indent: -1.4em; margin: 0 0 0.55em 1.4em; line-height: 1.35; hyphens: none; -webkit-hyphens: none; }
.sources .pp { color: ${GOLD}; -webkit-text-fill-color: ${GOLD}; }
.book { page-break-before: always; }
h2.booktitle { font-size: 1.5em; margin: 0.5em 0 0.35em; }
.byline { text-align: center; text-indent: 0; margin: 0 0 0.2em; hyphens: none; -webkit-hyphens: none; }
.byline.plain { font-size: 0.92em; }
.reading { margin-top: 1.6em; }
.reading.next { page-break-before: always; margin-top: 0; }
.pagelabel { text-align: center; text-indent: 0; color: ${GOLD}; -webkit-text-fill-color: ${GOLD}; text-transform: uppercase; letter-spacing: 0.2em; font-size: 0.86em; margin: 0 0 0.8em; }
.reading .text p { text-indent: 0; margin-bottom: 0.6em; }
.online { text-align: right; text-indent: 0; font-size: 0.92em; margin-top: 0.6em; }
.scan { margin: 0 0 1.2em; }
.scan img { max-height: 92vh; }
.colophon { margin-top: 12%; }
.colophon p { text-align: center; text-indent: 0; font-size: 0.95em; margin: 0 4% 0.7em; hyphens: none; -webkit-hyphens: none; }
`;

// Pictures that open each chapter: the best illustration (the gallery's crops) from a book the chapter cites,
// one not yet used, nearest its cited page, from a book whose scans may be shared. A chapter that already opens
// with a picture keeps it.
type GalleryImage = { page_number: number; extracted_url: string; description?: string; gallery_quality?: number; type?: string };
const PICTURE_TYPES = new Set(['woodcut', 'engraving', 'emblem', 'portrait', 'map', 'frontispiece']);
const WHOLE_BOOK_TYPES = new Set(['frontispiece', 'map', 'portrait']);
/** The gallery's description, to its first sentence: a caption, not a catalogue entry. */
const shortCaption = (d = '') => (d.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? d).replace(/\.$/, '').slice(0, 140);
const gallery: Record<string, { title: string; author?: string; book: Parameters<typeof imageAccessFor>[0]; images: GalleryImage[] }> =
  fs.existsSync('gallery.json') ? JSON.parse(fs.readFileSync('gallery.json', 'utf8')) : {};
const usedPictures = new Set<string>();
// A picture must be about what the chapter is about: its description shares a telling word with the chapter
// (Stonehenge, Apollo, Prussia), not just the picture vocabulary every description has. Reviewed on Hyperborea,
// where nearness alone opened chapters with Alciato's portrait and a map of the Tigris.
const GENERIC = new Set(('engraving engraved woodcut portrait showing depicting depicted detailed figure figures plate title '
  + 'image illustration ancient various large small above below left right centre center within frame framed border '
  + 'decorative scene features featuring including labeled labelled several standing seated around '
  + 'library source author renowned famous known first italian greek roman latin german french english early likely')
  .split(' '));
const wordsOf = (t: string) => new Set((t.toLowerCase().match(/[a-zà-ÿ]{5,}/g) ?? []).filter((w) => !GENERIC.has(w)));
// A shared name (capitalised in the description: Stonehenge, Ammianus) counts double; a pass needs 2.
const names = (t: string) => new Set((t.match(/(?<=\S\s+)[A-ZÀ-Þ][a-zà-ÿ]{3,}/g) ?? []).map((w) => w.toLowerCase()));
const relevance = (desc: string | undefined, chapter: Set<string>) => {
  const shared = [...wordsOf(desc ?? '')].filter((w) => chapter.has(w));
  const named = names(desc ?? '');
  return shared.length + shared.filter((w) => named.has(w)).length;
};
type Pick = { book: string; page: number; image: string; caption: string; rotate?: number };
const curated = (openers as unknown as Record<string, Record<string, Pick>>)[slug];
async function opener(html: string, n: number, title: string): Promise<string> {
  if (curated) {
    // Chosen by eye for this article: exactly these, and no automatic picks beside them.
    const c = curated[title];
    if (!c || imageAccessFor(gallery[c.book]?.book ?? {}) !== 'open') return '';
    const local = await picture(c.image, `opener-${n}`, 'figure', c.rotate);
    return local ? `<figure class="opener"><img src="${local}" alt="${esc(c.caption)}"/><figcaption>${esc(c.caption)}. <a href="${SITE}/book/${c.book}?page=${c.page}">${esc(gallery[c.book]?.title ?? c.book)}, p. ${c.page}</a></figcaption></figure>` : '';
  }
  const chapterWords = wordsOf(html.replace(/<[^>]+>/g, ' '));
  if (/^[\s\S]{0,1200}<img /.test(html.replace(/^<h2[\s\S]*?<\/h2>/, ''))) return '';
  const cited = [...html.matchAll(/readings\.xhtml#r-([a-z0-9-]+)-(\d+)"/g)].map((m) => ({ slug: m[1], page: +m[2] }));
  const candidates = cited.flatMap(({ slug, page }) => {
    const g = gallery[slug];
    if (!g || imageAccessFor(g.book ?? {}) !== 'open') return [];
    // Pictures, not diagrams or ornament; near the cited page (the same passage's plate), or a book's
    // frontispiece, map or portrait, which stand for the whole book.
    return g.images.filter((im) => !usedPictures.has(im.extracted_url) && PICTURE_TYPES.has(im.type ?? '')
      && !/\bcoins?\b|\btable\b/i.test(im.description ?? '')
      && (Math.abs(im.page_number - page) <= 12 || WHOLE_BOOK_TYPES.has(im.type ?? ''))
      && relevance(im.description, chapterWords) >= 2)
      .map((im) => ({ im, g, slug, score: (im.gallery_quality ?? 0) + relevance(im.description, chapterWords) / 4 - Math.abs(im.page_number - page) / 60 }));
  }).sort((a, b) => b.score - a.score);
  for (const c of candidates) {
    const local = await picture(c.im.extracted_url, `opener-${n}`, 'figure');
    if (!local) continue;
    usedPictures.add(c.im.extracted_url);
    const what = shortCaption(c.im.description);
    return `<figure class="opener"><img src="${local}" alt="${esc(what)}"/><figcaption>${esc(what)}${what ? '. ' : ''}<a href="${SITE}/book/${c.slug}?page=${c.im.page_number}">${esc(c.g.title)}, p. ${c.im.page_number}</a></figcaption></figure>`;
  }
  return '';
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI', 'XXII', 'XXIII', 'XXIV'];
const romanYear = (y: number) => [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
  .reduce((acc, [v, r]) => { while (y >= (v as number)) { acc += r; y -= v as number; } return acc; }, '');

// A chapter's first paragraph opens with a woodcut initial from the house set (ornaments.json) and its first
// words in capitals, as a printed book's would. A letter the set lacks (J, W, X, Y), or a paragraph that opens
// with a quotation mark or a link, gets a plain large capital. A letter met again takes its second cut if any.
const initialUses = new Map<string, number>();
async function firstPara(html: string): Promise<string> {
  const m = html.match(/^((?:\s*<(?:article|div|section)[^>]*>)*\s*)<p(?: class="[^"]*")?>([A-Z])([^<]*)/);
  if (!m) return html.replace(/^((?:\s*<(?:article|div|section)[^>]*>)*\s*)<p(?: class="[^"]*")?>/, '$1<p class="first dropcap">');
  const [all, lead0, letter, run] = m;
  const words = run.match(/^(\S*(?:\s+\S+){0,3})([\s\S]*)$/)!;
  const uses = initialUses.get(letter) ?? 0;
  initialUses.set(letter, uses + 1);
  const cuts = [`initial-${letter}`, `initial-${letter}-2`].filter((n) => fs.existsSync(`${HERE}/ornaments/${n}.png`));
  const img = cuts.length ? await ornament(cuts[uses % cuts.length], 'rust') : null;
  const rest = `<span class="lead">${words[1]}</span>${words[2]}`;
  return html.replace(all, img
    ? `${lead0}<p class="first"><img class="initial" src="${img}" alt="${letter}"/>${rest}`
    : `${lead0}<p class="first dropcap">${letter}${rest}`);
}

// Plates made for an article (a map, a table): plates.json names the chapter each closes, and an HTML fragment
// in plates/ whose pictures (src="plate:<file>") are rendered files beside it.
async function platesFor(title: string): Promise<string> {
  let out = '';
  for (const pl of ((plates as unknown as Record<string, { chapter: string; html: string }[]>)[slug] ?? []).filter((x) => x.chapter === title)) {
    let html = fs.readFileSync(`${HERE}/plates/${pl.html}`, 'utf8');
    for (const name of new Set([...html.matchAll(/src="plate:([^"]+)"/g)].map((x) => x[1]))) {
      const base = sharp(fs.readFileSync(`${HERE}/plates/${name}`)).resize({ width: 1100, withoutEnlargement: true });
      const f = `${process.cwd()}/scans/plate-${name.replace(/\.\w+$/, '')}.jpg`;
      fs.writeFileSync(f, await (BW ? base.grayscale().normalize() : base).jpeg({ quality: 82, mozjpeg: true }).toBuffer());
      html = html.split(`src="plate:${name}"`).join(`src="file://${f}"`);
    }
    out += html;
  }
  return out;
}

// The essay, one chapter per section, so the contents page lists them. The opening before the first
// section heading is the first chapter, under the article's title. Sections are numbered; a closing note on
// the sources is not. Each opens under the headpiece and closes on a fleuron; the last on the tailpiece.
const parts = essay.split(/(?=<h2[\s>])/);
const essayChapters = [];
const headpiece = await orn('headpiece', 'headpiece');
for (const [i, html] of parts.entries()) {
  const h = html.match(/^<h2[^>]*>([\s\S]*?)<\/h2>([\s\S]*)$/);
  const title = h ? unesc(h[1].replace(/<[^>]+>/g, '')) : displayTitle;
  const pic = await opener(html, i, title);
  const numbered = h && !/^(sources|a note on the sources|notes?)$/i.test(title.trim());
  const text = h ? h[2] : html;
  const body = `${headpiece}${numbered ? `<p class="chapnum">${ROMAN[i - 1] ?? i}</p>` : ''}`
    + (h ? `<h2>${h[1]}</h2>` : `<h1>${esc(displayTitle)}</h1>`) + pic
    + (numbered || !h ? await firstPara(text) : text)
    + await platesFor(title)
    + (i === parts.length - 1 ? await orn('tailpiece', 'tailpiece') : await orn('fleuron', 'fleuron'));
  essayChapters.push({ title, filename: `essay-${String(i).padStart(2, '0')}.xhtml`, content: body });
}

const coverFile = `${process.cwd()}/scans/cover.jpg`;
{
  // covers.json may name a better picture and a crop (in its own pixels); else the hero. A picture kept in the
  // repo (/articles/<slug>/x.jpg) is read from public/ (PUBLIC_DIR, set by build.sh).
  const spec = (covers as Record<string, { src?: string; crop?: CoverCrop }>)[slug] ?? {};
  const src = spec.src ?? post.image;
  const picture = src.startsWith('/')
    ? fs.readFileSync(`${process.env.PUBLIC_DIR}${src}`)
    : await images.fetchBuffer(src, { timeout: 60000 });
  fs.writeFileSync(coverFile, await makeCover({
    picture, crop: spec.crop, title: displayTitle, subtitle: displaySubtitle, kicker: 'An essay with its sources',
    logo: `${process.env.PUBLIC_DIR}/brand/png/logo-full--white-on-transparent--512h.png`,
  }));
}
const year = (post.date.match(/\d{4}/) || [''])[0];

// Front matter. The book opens on what Source Library is for (briefs.json `_source_library`, shared by every
// article), then the essay in brief (briefs.json, per article; a book without one simply has no such page).
type Brief = { tldr: string; summary: string };
const purpose = (briefs as unknown as { _source_library: { title: string; paragraphs: string[]; thisBook: string; closing: string } })._source_library;
const brief = (briefs as unknown as Record<string, Brief | undefined>)[slug];
const frontHead = await orn('headpieceAlt', 'headpiece');
// Credit the books the set's cuts come from, in the order initials, headpieces, tailpieces.
const picks = ornamentSet as unknown as { sources: Record<string, string>; initials: Record<string, { book: string }>; initialsAlt?: Record<string, { book: string }> } & Record<string, { book?: string }>;
const usedSources = [...new Set([...Object.values(picks.initials), ...Object.values(picks.initialsAlt ?? {}), picks.headpiece, picks.headpieceAlt, picks.tailpiece, picks.fleuron]
  .map((x) => picks.sources[x?.book ?? '']).filter(Boolean))];

const epub = await new EPub({
  title: displayTitle,
  author: 'Source Library',
  publisher: 'Source Library',
  description: `${post.summary} The article, with every page it cites gathered at the back.`,
  cover: fs.existsSync(coverFile) ? `file://${coverFile}` : post.image,
  lang: 'en', css, tocTitle: 'Contents', ignoreFailedDownloads: true, verbose: false,
  prependChapterTitles: false, numberChaptersInTOC: false, // every chapter carries its own heading
  date: new Date().toISOString(),
  fonts: ['EBGaramond-Regular.ttf', 'EBGaramond-Italic.ttf'].map((f) => ({ filename: f, url: `file://${HERE}/fonts/${f}` })),
}, [
  // The first page inside the book is the cover, full page: e-readers open there, and show the cover only on the shelf.
  ...(fs.existsSync(coverFile) ? [{ title: 'Cover', filename: 'cover-page.xhtml', excludeFromToc: true, beforeToc: true, content: `<div class="coverpage"><img src="file://${coverFile}" alt="${esc(displayTitle)}"/></div>` }] : []),
  {
    title: 'Title page', filename: 'title.xhtml', excludeFromToc: true, beforeToc: true,
    content: `<div class="titlepage"><img class="logo" src="file://${process.env.PUBLIC_DIR}/brand/png/logo-full--black-on-transparent--256h.png" alt="Source Library"/><h1>${esc(displayTitle)}</h1>${displaySubtitle ? `<p class="subtitle">${esc(displaySubtitle)}</p>` : ''}${await orn('fleuron', 'fleuron small')}<p class="label">An essay with its sources</p><p class="label">${esc(post.date)}</p></div>`,
  },
  {
    title: 'Source Library', filename: 'source-library.xhtml', beforeToc: true,
    content: `<div class="front">${frontHead}<h2>${esc(purpose.title)}</h2>${purpose.paragraphs.map((t, i) => `<p${i ? '' : ' class="big"'}>${esc(t)}</p>`).join('')}<p>${esc(purpose.thisBook.replace('{n}', String(readingCount)))}</p><p class="closing">${esc(purpose.closing)} <a href="${SITE}">sourcelibrary.org</a></p></div>`,
  },
  ...(brief ? [{
    title: 'In brief', filename: 'in-brief.xhtml', beforeToc: true,
    content: `<div class="front">${frontHead}<h2>In brief</h2><p class="big">${esc(brief.tldr)}</p><p>${esc(brief.summary)}</p>${await orn('fleuron', 'fleuron')}</div>`,
  }] : []),
  ...essayChapters,
  {
    title: 'The Sources', filename: 'readings.xhtml',
    content: `${frontHead}<h1>The Sources</h1><p class="intro">The ${readingCount} pages the essay cites, book by book, each with its scan. A link in the essay opens its page here.</p><div class="sources">${sourceList}</div>${sourceBooks}${await orn('tailpiece', 'tailpiece')}`,
  },
  {
    title: 'Colophon', filename: 'colophon.xhtml',
    content: `<div class="colophon">${await orn('device', 'device', 'rust')}<p>${esc(displayTitle)}</p><p>Made for the reader by Source Library, Amsterdam, ${romanYear(+year)}.</p><p>Set in EB Garamond. The initials, headpieces and tailpieces are woodcuts from books in the library: ${usedSources.map(esc).join('; ')}.</p><p>Text and translations: CC BY-NC-SA 4.0.</p><p><a href="${SITE}/articles/${slug}">${SITE.replace('https://', '')}/articles/${slug}</a></p></div>`,
  },
]).genEpub();
fs.writeFileSync(out, epub);
console.log(`${out}: ${readingCount} readings (${scans} scans, ${withheld} withheld), ${words} words of sources, ${(epub.length / 1e6).toFixed(1)} MB`);
