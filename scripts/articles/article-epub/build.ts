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

const css = `
@font-face { font-family: "EB Garamond"; font-style: normal; font-weight: 400 800; src: url(fonts/EBGaramond-latin.woff2); }
@font-face { font-family: "EB Garamond"; font-style: italic; font-weight: 400 800; src: url(fonts/EBGaramond-latin-italic.woff2); }
body { font-family: "EB Garamond", Georgia, "Palatino Linotype", serif; font-size: 1.08em; line-height: 1.5; color: #1f1a14; font-variant-numeric: oldstyle-nums; font-kerning: normal; }
p { margin: 0; text-indent: 1.4em; text-align: justify; hyphens: auto; -webkit-hyphens: auto; }
h1 + p, h2 + p, figure + p, blockquote + p, .chapnum + h2 + p, p.first, .noindent { text-indent: 0; }
h1 { font-weight: 500; font-size: 1.9em; text-align: center; margin: 1.2em 0 0.8em; line-height: 1.2; color: #6e2617; }
h2 { font-weight: 500; font-size: 1.45em; text-align: center; margin: 0.3em 0 1.1em; line-height: 1.25; color: #6e2617; }
h2::after { content: ""; display: block; width: 2.5em; margin: 0.55em auto 0; border-bottom: 1px solid #b08a4a; }
h3 { font-weight: 500; font-size: 1.2em; margin: 0 0 0.2em; line-height: 1.25; color: #6e2617; }
.chapnum { text-align: center; text-indent: 0; font-size: 0.8em; letter-spacing: 0.3em; color: #b08a4a; margin: 1.6em 0 0.2em; }
p.first::first-letter { float: left; font-size: 3.3em; line-height: 0.85; margin: 0.06em 0.08em 0 0; color: #6e2617; }
p.first::first-line { font-variant-caps: all-small-caps; letter-spacing: 0.05em; }
a { color: #6e2617; text-decoration: none; }
em, i { font-style: italic; }
blockquote { margin: 1.3em 0.4em; padding: 0.7em 0.9em; border-left: 3px solid #b08a4a; background: #f6efe1; }
blockquote p { text-align: left; text-indent: 0; margin-bottom: 0.4em; }
.cite { font-size: 0.82em; font-variant: small-caps; letter-spacing: 0.03em; color: #7a6a52; margin: 0.4em 0 0; }
figure { margin: 1.5em 0; text-align: center; page-break-inside: avoid; }
figure img { max-width: 100%; }
figcaption { font-size: 0.85em; font-style: italic; color: #5d5346; margin-top: 0.45em; text-align: center; line-height: 1.35; }
figure.opener { margin: 0 0 1.4em; }
figure.opener img { max-height: 70vh; }
.coverpage { margin: 0; padding: 0; text-align: center; }
.coverpage img { height: 100vh; max-width: 100%; }
.titlepage { text-align: center; padding-top: 6%; }
.titlepage p { text-indent: 0; text-align: center; }
.titlepage .logo { width: 46%; margin: 0 auto 28%; }
.titlepage h1 { font-size: 2.4em; line-height: 1.12; margin: 0 0 0.45em; }
.titlepage .subtitle { font-style: italic; font-size: 1.15em; line-height: 1.4; margin: 0 8% 1.6em; color: #4a3f33; }
.titlepage .orn { width: 3.5em; margin: 0 auto 1.6em; border-bottom: 1px solid #b08a4a; }
.titlepage .small { font-size: 0.8em; color: #6b5d4b; font-variant-caps: all-small-caps; letter-spacing: 0.14em; margin-bottom: 0.3em; }
.note p { text-indent: 0; margin-bottom: 0.7em; font-size: 0.95em; }
.intro { text-indent: 0; text-align: center; font-style: italic; color: #4a3f33; margin: 0 6% 1.6em; }
.sources .src { text-align: left; text-indent: -1.4em; margin: 0 0 0.55em 1.4em; line-height: 1.35; }
.sources .au { font-variant-caps: all-small-caps; letter-spacing: 0.04em; }
.sources .pp { color: #b08a4a; }
.sources .pp a { color: #6e2617; }
.book { page-break-before: always; }
h2.booktitle { font-size: 1.5em; margin: 1.2em 0 0.35em; }
h2.booktitle::after { display: none; }
.byline { text-align: center; text-indent: 0; font-variant-caps: all-small-caps; letter-spacing: 0.08em; color: #6b5d4b; margin: 0 0 0.2em; }
.byline.small { font-variant-caps: normal; letter-spacing: 0; font-style: italic; font-size: 0.85em; }
.reading { margin-top: 1.6em; }
.reading.next { page-break-before: always; margin-top: 0; }
.pagelabel { text-align: center; text-indent: 0; color: #b08a4a; font-variant-caps: all-small-caps; letter-spacing: 0.2em; margin: 0 0 0.8em; }
.reading .text p { text-indent: 0; margin-bottom: 0.6em; }
.online { text-align: right; text-indent: 0; font-size: 0.82em; font-style: italic; margin-top: 0.6em; }
.scan { margin: 0 0 1.2em; }
.scan img { max-height: 92vh; }
.colophon { margin-top: 30%; }
.colophon p { text-align: center; text-indent: 0; font-size: 0.85em; color: #5d5346; margin-bottom: 0.4em; }
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
const firstPara = (html: string) => html.replace(/<p(?: class="[^"]*")?>/, '<p class="first">');

// The essay, one chapter per section, so the contents page lists them. The opening before the first
// section heading is the first chapter, under the article's title. Sections are numbered; a closing note on
// the sources is not.
const parts = essay.split(/(?=<h2[\s>])/);
const essayChapters = [];
for (const [i, html] of parts.entries()) {
  const h = html.match(/^(<h2[^>]*>([\s\S]*?)<\/h2>)([\s\S]*)$/);
  const title = h ? unesc(h[2].replace(/<[^>]+>/g, '')) : displayTitle;
  const pic = await opener(html, i, title);
  const numbered = h && !/^(sources|a note on the sources|notes?)$/i.test(title.trim());
  const body = h
    ? `${numbered ? `<p class="chapnum">${ROMAN[i - 1] ?? i}</p>` : ''}${h[1]}${pic}${firstPara(h[3])}`
    : `<h1>${esc(displayTitle)}</h1>${pic}${firstPara(html)}`;
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
    title: 'About this edition', filename: 'about.xhtml', beforeToc: true,
    content: `<h2>About this edition</h2><div class="note"><p>This is an article from Source Library, followed by the ${readingCount} book pages it cites, so the sources can be read offline. A linked phrase in the article takes you to its page among the Sources; each reading links back to the page online.</p><p>Pages not in English are given in Source Library's AI translation, English-language books as transcribed from the scan. Both can contain errors; the scan above each reading shows what the page says.</p><p>Online: <a href="${SITE}/articles/${slug}">${SITE.replace('https://', '')}/articles/${slug}</a></p></div>`,
  },
  ...essayChapters,
  {
    title: 'The Sources', filename: 'readings.xhtml',
    content: `<h1>The Sources</h1><p class="intro">The ${readingCount} pages the essay cites, book by book, each with its scan. A link in the essay opens its page here.</p><div class="sources">${sourceList}</div>${sourceBooks}`,
  },
  {
    title: 'Colophon', filename: 'colophon.xhtml',
    content: `<div class="colophon"><p>${esc(displayTitle)}</p><p>Source Library, ${esc(year)}</p><p>Text and translations: CC BY-NC-SA 4.0.</p><p><a href="${SITE}">sourcelibrary.org</a></p></div>`,
  },
]).genEpub();
fs.writeFileSync(out, epub);
console.log(`${out}: ${readingCount} readings (${scans} scans, ${withheld} withheld), ${words} words of sources, ${(epub.length / 1e6).toFixed(1)} MB`);
