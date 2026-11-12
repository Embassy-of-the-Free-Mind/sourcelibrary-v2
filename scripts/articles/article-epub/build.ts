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
import ornaments from './ornaments.json';
import briefs from './briefs.json';
import { inkOrnament } from './ornaments';
import { deviceSvg } from './device';
import { DIAGRAMS } from './diagrams';
import highlights from './highlights.json';
import cast from './cast.json';
import { MAPS, mapSvg } from './maps';
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
const sourceBooks = [...books.values()].map((b) => `<section class="book">
<h2 class="booktitle"><i>${esc(b.title)}</i></h2>
<p class="byline">${esc(displayAuthor(b.author))}${b.published ? ` · ${esc(b.published)}` : ''}</p>
${b.translated ? '<p class="byline small">In Source Library’s English translation</p>' : ''}
${b.pages.map((pg, i) => `<section id="${pg.id}" class="reading${i ? ' next' : ''}">
<p class="pagelabel">${pg.label}</p>
${pg.scan}
<div class="text">${pg.text}</div>
<p class="online"><a href="${pg.online}">This page online</a></p>
</section>`).join('\n')}
</section>`).join('\n');

// Typography (Derek's review, 2026-11-12): one face (EB Garamond, headings included, weight 400 so a reader
// without the variable axis does not fall back to its own sans); one accent (Source Library rust) for headings,
// links and initials, gold for rules; italic for titles only; nothing smaller than 0.9em.
const css = `
@font-face { font-family: "EB Garamond"; font-style: normal; font-weight: normal; src: url(fonts/EBGaramond-latin.woff2); }
@font-face { font-family: "EB Garamond"; font-style: italic; font-weight: normal; src: url(fonts/EBGaramond-latin-italic.woff2); }
html, body { font-family: "EB Garamond", Georgia, "Palatino Linotype", serif; }
body { font-size: 1.08em; line-height: 1.5; color: #1a1612; font-variant-numeric: oldstyle-nums; font-kerning: normal; }
h1, h2, h3, h4, .chapnum, .titlepage, .purpose, figcaption, .cite { font-family: "EB Garamond", Georgia, serif; }
p { margin: 0; text-indent: 1.4em; text-align: justify; hyphens: auto; -webkit-hyphens: auto; }
h1 + p, h2 + p, figure + p, blockquote + p, div + p, p.first, .noindent { text-indent: 0; }
h1 { font-weight: normal; font-size: 1.9em; text-align: center; margin: 0.6em 0 0.8em; line-height: 1.2; color: #9e4a3a; }
h2 { font-weight: normal; font-size: 1.5em; text-align: center; margin: 0.2em 0 1em; line-height: 1.25; color: #9e4a3a; }
h3 { font-weight: normal; font-size: 1.2em; margin: 0 0 0.2em; color: #9e4a3a; }
a, a:link, a:visited { color: #9e4a3a; -webkit-text-fill-color: #9e4a3a; text-decoration: none; }
.headpiece { text-align: center; margin: 0.4em 0 0.6em; }
.headpiece img { width: 72%; }
.tailpiece { text-align: center; margin: 1.6em 0 0.4em; page-break-inside: avoid; }
.tailpiece img { width: 22%; }
.chapnum { text-align: center; text-indent: 0; font-size: 0.95em; letter-spacing: 0.3em; color: #9e7c3c; margin: 0.4em 0 0.1em; }
p.first::first-letter { float: left; font-size: 3.3em; line-height: 0.85; margin: 0.06em 0.08em 0 0; color: #9e4a3a; }
p.first.woodcut::first-letter { float: none; font-size: 1em; line-height: inherit; margin: 0; color: inherit; }
p.first::first-line { font-variant-caps: all-small-caps; letter-spacing: 0.05em; }
img.initial { float: left; width: 4.5em; height: 4.5em; margin: 0.28em 0.6em 0.1em 0; }
blockquote { margin: 1.3em 0.4em; padding: 0.7em 0.9em; border-left: 3px solid #c9a86c; background: #f6efe1; }
blockquote p { text-align: left; text-indent: 0; margin-bottom: 0.4em; }
.cite { font-size: 0.9em; color: #6b5d4b; margin: 0.4em 0 0; }
figure { margin: 1.5em 0; text-align: center; page-break-inside: avoid; }
figure img { max-width: 100%; }
figcaption { font-size: 0.9em; color: #5d5346; margin-top: 0.45em; text-align: center; line-height: 1.35; }
figure.opener { margin: 0 0 1.4em; }
figure.opener img { max-height: 62vh; }
figure.plate img { max-height: 92vh; }
figure.map { margin: 0; text-align: center; }
figure.map img { max-height: 96vh; max-width: 100%; }
.person { width: 100%; border-collapse: collapse; margin: 0 0 1.1em; page-break-inside: avoid; }
.facecell { width: 6.2em; vertical-align: top; padding: 0.2em 0.9em 0 0; text-align: center; }
.textcell { vertical-align: top; }
.person .face { width: 5.6em; max-height: 7em; }
.person .initialface { width: 4.4em; height: 4.4em; }
.person .letterface { display: inline-block; width: 3.5em; height: 3.5em; line-height: 3.5em; font-size: 1.2em; text-align: center; color: #9e4a3a; border: 2px solid #9e4a3a; }
.person p { text-indent: 0; text-align: left; }
.person .who { font-variant-caps: all-small-caps; letter-spacing: 0.06em; font-size: 1.12em; color: #9e4a3a; margin: 0; }
.person .when { color: #9e7c3c; margin: 0 0 0.2em; }
.person .line { margin: 0; line-height: 1.4; }
.person .pic { font-size: 0.9em; color: #6b5d4b; margin: 0.25em 0 0; }
.hl { background-color: #e9e6e1; padding: 0.05em 0.15em; border-radius: 0.15em; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
a .hl, .hl a, a .hl a { color: #1a1612; -webkit-text-fill-color: #1a1612; }
a.nref { font-size: 0.8em; vertical-align: super; line-height: 0; margin-left: 0.1em; color: #9e4a3a; }
aside.hnote { margin: 1.4em 0 0; padding-top: 0.6em; border-top: 1px solid #c9a86c; }
aside.hnote p { text-indent: 0; text-align: left; font-size: 0.92em; line-height: 1.4; color: #4a3f33; margin: 0 0 0.6em; }
.coverpage { margin: 0; padding: 0; text-align: center; }
.coverpage img { height: 100vh; max-width: 100%; }
.titlepage { text-align: center; padding-top: 6%; }
.titlepage p { text-indent: 0; text-align: center; }
.titlepage .logo { width: 46%; margin: 0 auto 26%; }
.titlepage h1 { font-size: 2.4em; line-height: 1.12; margin: 0 0 0.5em; }
.titlepage .subtitle { font-size: 1.12em; line-height: 1.4; margin: 0 8% 1.6em; color: #4a3f33; }
.titlepage .orn { width: 3.5em; margin: 0 auto 1.6em; border-bottom: 1px solid #c9a86c; }
.titlepage .small { font-size: 0.9em; color: #6b5d4b; font-variant-caps: all-small-caps; letter-spacing: 0.14em; margin-bottom: 0.3em; }
.purpose { padding-top: 4%; }
.purpose .logo { display: block; width: 3.2em; margin: 0 auto 1em; }
.purpose p { margin-bottom: 0.8em; text-indent: 0; }
.tldr { text-indent: 0; text-align: left; font-size: 1.22em; line-height: 1.4; margin: 0 0 1.1em; color: #1a1612; }
.summary { text-indent: 0; margin: 0 0 1.4em; }
.chapters p { text-indent: 0; text-align: left; margin: 0 0 0.55em; }
.intro { text-indent: 0; text-align: center; color: #4a3f33; margin: 0 6% 1.6em; }
.sources .src { text-align: left; text-indent: -1.4em; margin: 0 0 0.6em 1.4em; line-height: 1.38; }
.sources .au { font-variant-caps: all-small-caps; letter-spacing: 0.04em; }
.sources .pp { color: #9e7c3c; }
.book { page-break-before: always; }
h2.booktitle { font-size: 1.5em; margin: 1.2em 0 0.35em; }
.byline { text-align: center; text-indent: 0; font-variant-caps: all-small-caps; letter-spacing: 0.08em; color: #6b5d4b; margin: 0 0 0.2em; }
.byline.small { font-variant-caps: normal; letter-spacing: 0; font-size: 0.92em; }
.reading { margin-top: 1.6em; }
.reading.next { page-break-before: always; margin-top: 0; }
.pagelabel { text-align: center; text-indent: 0; color: #9e7c3c; font-variant-caps: all-small-caps; letter-spacing: 0.2em; margin: 0 0 0.8em; }
.reading .text p { text-indent: 0; margin-bottom: 0.6em; }
.online { text-align: right; text-indent: 0; font-size: 0.92em; margin-top: 0.6em; }
.scan { margin: 0 0 1.2em; }
.scan img { max-height: 92vh; }
.colophon { text-align: center; padding-top: 8%; }
.colophon .device { width: 48%; margin: 0 auto 1.6em; }
.colophon p { text-align: center; text-indent: 0; font-size: 0.92em; color: #4a3f33; margin: 0 6% 0.5em; }
.colophon .col-title { font-variant-caps: all-small-caps; letter-spacing: 0.12em; font-size: 1em; margin-bottom: 0.9em; }
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

// Lines worth stopping for (highlights.json): a light grey ground and a dagger whose note pops up on tap,
// as an EPUB footnote; readers without pop-ups show the note at the chapter's end.
type Highlight = { text: string; note: string; ref?: string };
let noteN = 0;
const QUOTES = "(?:'|’|‘|&#x27;|&apos;|&#39;|&#x2019;|&#x2018;)";
function highlight(body: string): string {
  const notes: string[] = [];
  for (const hl of (highlights as unknown as Record<string, Highlight[]>)[slug] ?? []) {
    const re = new RegExp(hl.text.split('').map((c) => /['’‘]/.test(c) ? QUOTES : /\s/.test(c) ? '\\s+' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(''));
    if (!re.test(body)) continue;
    const n = ++noteN;
    body = body.replace(re, (m) => `<span class="hl">${m}</span><a epub:type="noteref" href="#hn-${n}" id="hr-${n}" class="nref">†</a>`);
    const more = hl.ref ? ` <a href="readings.xhtml#${anchor(hl.ref)}">See the page.</a>` : '';
    notes.push(`<aside epub:type="footnote" id="hn-${n}" class="hnote"><p><a href="#hr-${n}">†</a> ${esc(hl.note)}${more}</p></aside>`);
  }
  if (!notes.length) return body;
  // Before the tailpiece, so the ornament still closes the chapter.
  const tail = body.lastIndexOf('<div class="tailpiece">');
  return tail >= 0 ? body.slice(0, tail) + notes.join('') + body.slice(tail) : body + notes.join('');
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI', 'XXII', 'XXIII', 'XXIV'];
// The house ornaments (ornaments.json), inked: initials in rust as early printers rubricated capitals, the
// headpiece, tailpiece and printer's device in ink. The e-ink edition inks them black.
const RUST = BW ? '#000000' : '#9e4a3a', INK = BW ? '#000000' : '#2b2118';
const orn = ornaments as unknown as { initials: Record<string, { image: string; book: string }>; headpiece: { image: string; book: string; title: string }; tailpiece: { image: string; book: string; title: string }; initialsTitle: string };
async function ornamentFile(url: string, name: string, colour: string, block: boolean, size: number): Promise<string | null> {
  try {
    const f = `${process.cwd()}/scans/orn-${name}.png`;
    if (!fs.existsSync(f)) fs.writeFileSync(f, await inkOrnament(await images.fetchBuffer(url, { timeout: 60000 }), colour, { block, size }));
    return `file://${f}`;
  } catch { return null; }
}
const headpiece = await ornamentFile(orn.headpiece.image, 'head', INK, false, 1400);
const tailpiece = await ornamentFile(orn.tailpiece.image, 'tail', INK, false, 700);
const deviceFile = `${process.cwd()}/scans/device.png`;
fs.writeFileSync(deviceFile, await sharp(Buffer.from(deviceSvg(INK, RUST))).png().toBuffer());

/** The chapter's first paragraph opens with a woodcut initial of its letter (the house alphabet), the letter
 *  taken out of the text; a letter the alphabet lacks keeps a typeset drop cap. */
async function firstPara(html: string): Promise<string> {
  const m = html.match(/<p(?: class="[^"]*")?>(\s*)([A-Za-z])/);
  const letter = m?.[2].toUpperCase();
  const cut = letter && orn.initials[letter] ? await ornamentFile(orn.initials[letter].image, `init-${letter}`, RUST, true, 500) : null;
  if (!m || !cut) return html.replace(/<p(?: class="[^"]*")?>/, '<p class="first">');
  return html.replace(m[0], `<p class="first woodcut">${m[1]}<img class="initial" src="${cut}" alt="${letter}"/>`);
}
const ornamentHead = headpiece ? `<div class="headpiece"><img src="${headpiece}" alt=""/></div>` : '';
const ornamentTail = tailpiece ? `<div class="tailpiece"><img src="${tailpiece}" alt=""/></div>` : '';

// The essay, one chapter per section, so the contents page lists them. The opening before the first
// section heading is the first chapter, under the article's title. Sections are numbered; a closing note on
// the sources is not.
const parts = essay.split(/(?=<h2[\s>])/);
const essayChapters = [];
for (const [i, html] of parts.entries()) {
  const h = html.match(/^(<h2[^>]*>([\s\S]*?)<\/h2>)([\s\S]*)$/);
  const title = h ? unesc(h[2].replace(/<[^>]+>/g, '')) : displayTitle;
  let pic = await opener(html, i, title);
  // A plate the chapter needs (diagrams.ts), after its opening picture.
  const plate = DIAGRAMS[slug]?.[title];
  if (plate) {
    const f = `${process.cwd()}/scans/plate-${i}.png`;
    let png = sharp(Buffer.from(plate(BW, `${process.env.PUBLIC_DIR}/..`))).resize({ width: 1200 });
    fs.writeFileSync(f, BW ? await png.png({ palette: true, colours: 4 }).toBuffer() : await png.png().toBuffer());
    pic += `<figure class="plate"><img src="file://${f}" alt="${esc(title)}: a plate"/></figure>`;
  }
  const numbered = h && !/^(sources|a note on the sources|notes?)$/i.test(title.trim());
  const body = h
    ? `${numbered ? ornamentHead : ''}${numbered ? `<p class="chapnum">${ROMAN[i - 1] ?? i}</p>` : ''}${h[1]}${pic}${numbered ? await firstPara(h[3]) : h[3]}${numbered ? ornamentTail : ''}`
    : `${ornamentHead}<h1>${esc(displayTitle)}</h1>${pic}${await firstPara(html)}${ornamentTail}`;
  essayChapters.push({ title, filename: `essay-${String(i).padStart(2, '0')}.xhtml`, content: highlight(body) });
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

// The opening page. DRAFT copy: Derek approves it once, then every article EPUB carries it.
const PURPOSE = `<h2>Source Library</h2>
<p>Most of what was written before 1800 has never been translated into English. Whole libraries of philosophy, science, medicine, magic and history, the books our modern ideas grew out of, are still shut inside Latin, Greek, Arabic, Persian, Chinese and a dozen other languages, open to a few specialists or to no one at all.</p>
<p>Source Library is opening them. With the Embassy of the Free Mind in Amsterdam we scan these books, transcribe them and translate them, and set every page beside its translation, free to read.</p>
<p>This book carries one of our articles off the screen: an essay that tells a story through those books, followed by every page it quotes, with the scan, so that you can read the sources for yourself.</p>`;
// Maps for the opening (maps.ts), one page each.
const mapPages: string[] = [];
for (const [k, spec] of (MAPS[slug] ?? []).entries()) {
  const f = `${process.cwd()}/scans/map-${k}.png`;
  // A wide map is turned to fill the page, as a book prints a wide plate (tip the reader to read it);
  // a squarish one stays upright.
  const flat = await sharp(Buffer.from(mapSvg(spec, BW))).png().toBuffer();
  const { width = 1, height = 1 } = await sharp(flat).metadata();
  const png = width / height > 1.25 ? sharp(flat).rotate(-90).resize({ height: 1700 }) : sharp(flat).resize({ width: 1600 });
  fs.writeFileSync(f, BW ? await png.png({ palette: true, colours: 8 }).toBuffer() : await png.jpeg({ quality: 88 }).toBuffer().then((b) => b));
  mapPages.push(`<figure class="map"><img src="file://${f}" alt="${esc(spec.title)}: ${esc(spec.sub)}"/></figure>`);
}

// The cast (cast.json): each person with a picture from the library, or the woodcut initial of their name.
type Person = { name: string; when: string; line: string; pic?: { image: string; book: string; page: number; caption: string } };
const people: string[] = [];
for (const [k, pr] of ((cast as unknown as Record<string, Person[]>)[slug] ?? []).entries()) {
  let face = '';
  if (pr.pic) {
    const local = await picture(pr.pic.image, `cast-${k}`, 'figure');
    if (local) face = `<img class="face" src="${local}" alt="${esc(pr.pic.caption)}"/>`;
  }
  if (!face) {
    const L = (pr.name.replace(/^(al-|the\s+|ibn\s+)/i, '').match(/[A-Za-z]/)?.[0] ?? 'A').toUpperCase();
    const cut = orn.initials[L] ? await ornamentFile(orn.initials[L].image, `init-${L}`, RUST, true, 500) : null;
    face = cut ? `<img class="face initialface" src="${cut}" alt=""/>` : `<span class="face letterface">${L}</span>`;
  }
  people.push(`<table class="person"><tr><td class="facecell">${face}</td><td class="textcell"><p class="who">${esc(pr.name)}</p><p class="when">${esc(pr.when)}</p><p class="line">${esc(pr.line)}</p>${pr.pic && face.includes('class="face"') ? `<p class="pic">${esc(pr.pic.caption)}</p>` : ''}</td></tr></table>`);
}

type Brief = { tldr: string; summary: string; chapters?: Record<string, string> };
const brief = (briefs as unknown as Record<string, Brief>)[slug];
const briefChapters = brief?.chapters ? essayChapters.filter((c) => brief.chapters![c.title]).map((c) =>
  `<p><a href="${c.filename}">${esc(c.title)}</a> · ${esc(brief.chapters![c.title])}</p>`).join('') : '';

const epub = await new EPub({
  title: displayTitle,
  author: 'Source Library',
  publisher: 'Source Library',
  description: `${post.summary} The article, with every page it cites gathered at the back.`,
  cover: fs.existsSync(coverFile) ? `file://${coverFile}` : post.image,
  lang: 'en', css, tocTitle: 'Contents', ignoreFailedDownloads: true, verbose: false,
  prependChapterTitles: false, numberChaptersInTOC: false, // every chapter carries its own heading
  date: new Date().toISOString(),
  fonts: ['EBGaramond-latin.woff2', 'EBGaramond-latin-italic.woff2'].map((f) => ({ filename: f, url: `file://${process.env.PUBLIC_DIR}/fonts/eb-garamond/${f}` })),
}, [
  // The first page inside the book is the cover, full page: e-readers open there, and show the cover only on the shelf.
  ...(fs.existsSync(coverFile) ? [{ title: 'Cover', filename: 'cover-page.xhtml', excludeFromToc: true, beforeToc: true, content: `<div class="coverpage"><img src="file://${coverFile}" alt="${esc(displayTitle)}"/></div>` }] : []),
  {
    title: 'Title page', filename: 'title.xhtml', excludeFromToc: true, beforeToc: true,
    content: `<div class="titlepage"><img class="logo" src="file://${process.env.PUBLIC_DIR}/brand/png/logo-full--black-on-transparent--256h.png" alt="Source Library"/><h1>${esc(displayTitle)}</h1>${displaySubtitle ? `<p class="subtitle">${esc(displaySubtitle)}</p>` : ''}<div class="orn"></div><p class="small">An essay with its sources</p><p class="small">${esc(post.date)}</p></div>`,
  },
  {
    // Why the book exists, before anything else. Shared by every article EPUB.
    title: 'Source Library', filename: 'purpose.xhtml', beforeToc: true,
    content: `<div class="purpose"><img class="logo" src="file://${process.env.PUBLIC_DIR}/brand/png/icon-only--black-on-transparent--256h.png" alt=""/>${await firstPara(PURPOSE)}</div>`,
  },
  ...(brief ? [{
    title: 'In brief', filename: 'brief.xhtml', beforeToc: true,
    content: `<h2>In brief</h2><p class="tldr">${esc(brief.tldr)}</p><p class="summary">${esc(brief.summary)}</p>${briefChapters ? `<div class="chapters">${briefChapters}</div>` : ''}`,
  }] : []),
  ...mapPages.map((m, k) => ({ title: k ? `Map: ${(MAPS[slug] ?? [])[k]?.title ?? ''}` : 'Map', filename: `map-${k}.xhtml`, beforeToc: true, excludeFromToc: k > 0, content: m })),
  ...(people.length ? [{ title: 'The cast', filename: 'cast.xhtml', beforeToc: true, content: `<h2>The cast</h2><p class="intro">In order of appearance.</p>${people.join('')}` }] : []),
  ...essayChapters,
  {
    title: 'The Sources', filename: 'readings.xhtml',
    content: `<h1>The Sources</h1><p class="intro">The ${readingCount} pages the essay cites, book by book, each with its scan. A link in the essay opens its page here.</p><div class="sources">${sourceList}</div>${sourceBooks}`,
  },
  {
    title: 'Colophon', filename: 'colophon.xhtml',
    content: `<div class="colophon"><img class="device" src="file://${deviceFile}" alt="The printer's device of Source Library"/><p class="col-title">${esc(displayTitle)}</p><p>Set in EB Garamond. Initials from Alberti, <i>De re aedificatoria</i> (Paris, 1512); headpiece and tailpiece from <i>${esc(orn.headpiece.title)}</i> and <i>${esc(orn.tailpiece.title)}</i>, all in the library.</p><p>Made by Source Library, Amsterdam, ${esc(year)}. Text and translations CC BY-NC-SA 4.0.</p><p><a href="${SITE}">sourcelibrary.org</a></p></div>`,
  },
]).genEpub();
fs.writeFileSync(out, epub);
console.log(`${out}: ${readingCount} readings (${scans} scans, ${withheld} withheld), ${words} words of sources, ${(epub.length / 1e6).toFixed(1)} MB`);
