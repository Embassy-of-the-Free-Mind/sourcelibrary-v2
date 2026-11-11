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

// The readings: the cited pages, in the order the essay first cites them.
// Each reading carries its scan, as the site's continuous EPUB does: only when the book's scans may be
// redistributed (imageAccessFor 'open'), resolved by pageExportImageUrl, recompressed to 800×1200.
const readings: string[] = [];
const readingIndex: { id: string; label: string }[] = [];
let words = 0, scans = 0, withheld = 0;
for (const r of refs) {
  const [book, page] = r.split('?page=');
  const file = `pages/${book}-${page}.json`;
  if (!fs.existsSync(file)) continue;
  const q = JSON.parse(fs.readFileSync(file, 'utf8'));
  const english = /^english/i.test(q.language || '');
  const text: string = ((english && q.original) || q.translation || q.original || '').replace(LAYOUT, '');
  if (!text.trim()) continue;
  // printed_page is the fitted page-number record ({ label, numbering, … }); older rows hold a bare value.
  const printed = q.printed_page && typeof q.printed_page === 'object' ? q.printed_page.label : q.printed_page;
  const pp = printed && String(printed) !== String(page) ? `p. ${esc(printed)} (scan ${page})` : `p. ${page}`;
  words += text.split(/\s+/).length;
  let scan = '';
  const url = q.pageDoc ? pageExportImageUrl(q.pageDoc as Page) : null;
  if (url && imageAccessFor(q.book ?? {}) === 'open') {
    const local = await picture(url, anchor(r), 'scan');
    if (local) {
      scan = `<figure class="scan"><img src="${local}" alt="${esc(q.title)}, ${pp}"/></figure>`;
      scans++;
    }
  } else if (url) withheld++;
  const published = q.published && q.published !== 'Unknown' ? `, ${esc(q.published)}` : '';
  readingIndex.push({ id: anchor(r), label: `${q.author ? `${q.author}, ` : ''}${q.title}, ${pp.replace(/&amp;/g, '&')}` });
  readings.push(`<section id="${anchor(r)}" class="reading">
<p class="num">READING ${readingIndex.length}</p>
<h3>${esc(q.title)}</h3>
<p class="meta">${esc(q.author)}${published} · ${pp}${english ? '' : ' · English translation'} · <a href="${SITE}/book/${r}">open the page</a></p>
${scan}
<div class="text">${markdownToHtml(text)}</div>
</section>`);
}

const css = `
@font-face { font-family: "EB Garamond"; font-style: normal; font-weight: 400 800; src: url(fonts/EBGaramond-latin.woff2); }
@font-face { font-family: "EB Garamond"; font-style: italic; font-weight: 400 800; src: url(fonts/EBGaramond-latin-italic.woff2); }
body { font-family: "EB Garamond", Georgia, "Palatino Linotype", serif; font-size: 1.08em; line-height: 1.5; color: #1f1a14; }
p { margin: 0; text-indent: 1.4em; text-align: justify; hyphens: auto; -webkit-hyphens: auto; }
h1 + p, h2 + p, figure + p, blockquote + p, .chapnum + h2 + p, p.first, .noindent { text-indent: 0; }
h1 { font-weight: 500; font-size: 1.9em; text-align: center; margin: 1.2em 0 0.8em; line-height: 1.2; color: #6e2617; }
h2 { font-weight: 500; font-size: 1.45em; text-align: center; margin: 0.3em 0 1.1em; line-height: 1.25; color: #6e2617; }
h2::after { content: ""; display: block; width: 2.5em; margin: 0.55em auto 0; border-bottom: 1px solid #b08a4a; }
h3 { font-weight: 500; font-size: 1.2em; margin: 0 0 0.2em; line-height: 1.25; color: #6e2617; }
.chapnum { text-align: center; text-indent: 0; font-size: 0.8em; letter-spacing: 0.3em; color: #b08a4a; margin: 1.6em 0 0.2em; }
p.first::first-letter { float: left; font-size: 3.3em; line-height: 0.85; margin: 0.06em 0.08em 0 0; color: #6e2617; }
p.first::first-line { font-variant: small-caps; letter-spacing: 0.04em; }
a { color: #6e2617; text-decoration: none; border-bottom: 1px dotted #b08a4a; }
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
.titlepage { text-align: center; margin-top: 16%; }
.titlepage p { text-indent: 0; text-align: center; }
.titlepage .house { font-size: 0.8em; letter-spacing: 0.4em; color: #b08a4a; margin-bottom: 3em; }
.titlepage h1 { font-size: 2.3em; margin: 0 0 0.5em; }
.titlepage .subtitle { font-style: italic; font-size: 1.15em; margin-bottom: 2.5em; color: #4a3f33; }
.titlepage .rule { width: 4em; margin: 0 auto 2.5em; border-bottom: 1px solid #b08a4a; }
.titlepage .small { font-size: 0.85em; color: #5d5346; font-variant: small-caps; letter-spacing: 0.08em; }
.note p { text-indent: 0; margin-bottom: 0.7em; font-size: 0.95em; }
.index p { text-align: left; text-indent: -2em; margin: 0 0 0.35em 2em; font-size: 0.9em; }
.reading { page-break-before: always; }
.reading .num { font-size: 0.75em; letter-spacing: 0.3em; color: #b08a4a; margin: 0 0 0.5em; text-indent: 0; text-align: left; }
.reading .meta { font-size: 0.82em; font-variant: small-caps; letter-spacing: 0.03em; color: #7a6a52; text-align: left; text-indent: 0; margin-bottom: 1em; }
.reading .text p { text-indent: 0; margin-bottom: 0.6em; }
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

const index = readingIndex.map((x, i) => `<p>${i + 1}. <a href="#${x.id}">${esc(x.label)}</a></p>`).join('');

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
    content: `<div class="titlepage"><p class="house">SOURCE LIBRARY</p><h1>${esc(displayTitle)}</h1>${displaySubtitle ? `<p class="subtitle">${esc(displaySubtitle)}</p>` : ''}<div class="rule"></div><p class="small">An essay with its sources</p><p class="small">${esc(post.date)}</p></div>`,
  },
  {
    title: 'About this edition', filename: 'about.xhtml', beforeToc: true,
    content: `<h2>About this edition</h2><div class="note"><p>This is an article from Source Library, followed by the ${readings.length} book pages it cites, so the sources can be read offline. A linked phrase in the article takes you to its page among the Readings; each reading links back to the page online.</p><p>Pages not in English are given in Source Library's AI translation, English-language books as transcribed from the scan. Both can contain errors; the scan above each reading shows what the page says.</p><p>Online: <a href="${SITE}/articles/${slug}">${SITE.replace('https://', '')}/articles/${slug}</a></p></div>`,
  },
  ...essayChapters,
  {
    title: 'Readings', filename: 'readings.xhtml',
    content: `<h1>Readings</h1><p class="note">The pages the article cites, in the order it first cites them.</p><div class="index">${index}</div>${readings.join('\n')}`,
  },
  {
    title: 'Colophon', filename: 'colophon.xhtml',
    content: `<div class="colophon"><p>${esc(displayTitle)}</p><p>Source Library, ${esc(year)}</p><p>Text and translations: CC BY-NC-SA 4.0.</p><p><a href="${SITE}">sourcelibrary.org</a></p></div>`,
  },
]).genEpub();
fs.writeFileSync(out, epub);
console.log(`${out}: ${readings.length} readings (${scans} scans, ${withheld} withheld), ${words} words of sources, ${(epub.length / 1e6).toFixed(1)} MB`);
