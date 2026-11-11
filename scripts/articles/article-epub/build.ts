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
async function picture(url: string, name: string, kind: 'scan' | 'figure'): Promise<string | null> {
  const buf = url.startsWith('file://')
    ? await sharp(fs.readFileSync(url.slice(7))).resize(800, 1200, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 75, mozjpeg: true }).toBuffer()
    : await fetchAndCompressImage(url, { colour: true, width: 800, height: 1200 });
  if (!buf) return null;
  const { data, ext } = await preparePicture(buf, kind, BW);
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
  const pp = q.printed_page && String(q.printed_page) !== String(page) ? `p. ${esc(q.printed_page)} (scan ${page})` : `p. ${page}`;
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
body { font-family: Georgia, "Palatino Linotype", Palatino, serif; line-height: 1.55; color: #1d1b18; }
p { margin: 0 0 0.8em 0; text-align: justify; hyphens: auto; -webkit-hyphens: auto; }
h1 { font-weight: normal; font-size: 1.7em; text-align: center; margin: 1.5em 0 0.4em; line-height: 1.25; }
h2 { font-weight: normal; font-size: 1.35em; text-align: center; margin: 1.2em 0 1em; line-height: 1.3; }
h2::after { content: ""; display: block; width: 3em; margin: 0.6em auto 0; border-bottom: 1px solid #b8955a; }
h3 { font-weight: normal; font-size: 1.15em; margin: 0 0 0.2em; line-height: 1.3; }
a { color: #6b4f1d; text-decoration: none; }
blockquote { margin: 1.2em 0.8em; padding-left: 0.9em; border-left: 2px solid #b8955a; }
blockquote p { text-align: left; }
.cite { font-size: 0.85em; color: #6b6355; }
figure { margin: 1.4em 0; text-align: center; page-break-inside: avoid; }
figure img { max-width: 100%; }
figcaption { font-size: 0.85em; font-style: italic; color: #5b544a; margin-top: 0.4em; text-align: center; }
.titlepage { text-align: center; margin-top: 18%; }
.titlepage .house { font-size: 0.8em; letter-spacing: 0.35em; color: #8a6d3b; margin-bottom: 3em; }
.titlepage h1 { font-size: 2.1em; margin: 0 0 0.5em; }
.titlepage .subtitle { font-style: italic; font-size: 1.1em; text-align: center; margin-bottom: 2.5em; }
.titlepage .rule { width: 4em; margin: 0 auto 2.5em; border-bottom: 1px solid #b8955a; }
.titlepage .small { font-size: 0.85em; text-align: center; color: #5b544a; }
.note { font-size: 0.92em; }
.index { font-size: 0.9em; }
.index p { text-align: left; margin: 0 0 0.35em 2em; text-indent: -2em; }
.reading { page-break-before: always; }
.reading .num { font-size: 0.75em; letter-spacing: 0.25em; color: #8a6d3b; margin: 0 0 0.6em; text-align: left; }
.reading .meta { font-size: 0.85em; color: #6b6355; text-align: left; margin-bottom: 1em; }
.scan { margin: 0 0 1.2em; }
.scan img { max-height: 92vh; }
.reading .text p:first-child { margin-top: 0; }
.colophon { font-size: 0.85em; color: #5b544a; margin-top: 30%; }
.colophon p { text-align: center; }
`;

// The essay, one chapter per section, so the contents page lists them. The opening before the first
// section heading is the first chapter, under the article's title.
const parts = essay.split(/(?=<h2[\s>])/);
const essayChapters = parts.map((html, i) => {
  const h = html.match(/^<h2[^>]*>([\s\S]*?)<\/h2>/);
  const title = h ? unesc(h[1].replace(/<[^>]+>/g, '')) : displayTitle;
  const body = i === 0 ? `<h1>${esc(displayTitle)}</h1>${html}` : html;
  return { title, filename: `essay-${String(i).padStart(2, '0')}.xhtml`, content: body };
});

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
}, [
  {
    title: 'Title page', filename: 'title.xhtml', excludeFromToc: true, beforeToc: true,
    content: `<div class="titlepage"><p class="house">SOURCE LIBRARY</p><h1>${esc(displayTitle)}</h1>${displaySubtitle ? `<p class="subtitle">${esc(displaySubtitle)}</p>` : ''}<div class="rule"></div><p class="small">An essay with its sources</p><p class="small">${esc(post.date)}</p></div>`,
  },
  {
    title: 'About this edition', filename: 'about.xhtml', beforeToc: true,
    content: `<h2>About this edition</h2><div class="note"><p>This is an article from Source Library, followed by the ${readings.length} book pages it cites, so the sources can be read offline. A linked phrase in the article takes you to its page among the Readings; each reading links back to the page online.</p><p>Pages not in English are given in Source Library's AI translation, English-language books as transcribed from the scan. Both can contain errors, and the scan above each reading shows what the page says${withheld ? `. ${withheld} scan${withheld === 1 ? ' is' : 's are'} left out because the holding library does not allow redistribution; open the page online to see ${withheld === 1 ? 'it' : 'them'}` : ''}.</p><p>Online: <a href="${SITE}/articles/${slug}">${SITE.replace('https://', '')}/articles/${slug}</a></p></div>`,
  },
  ...essayChapters,
  {
    title: 'Readings', filename: 'readings.xhtml',
    content: `<h1>Readings</h1><p class="note">The pages the article cites, in the order it first cites them.</p><div class="index">${index}</div>${readings.join('\n')}`,
  },
  {
    title: 'Colophon', filename: 'colophon.xhtml',
    content: `<div class="colophon"><p>${esc(displayTitle)}</p><p>Source Library, ${esc(year)}</p><p>Text and translations: CC BY-NC-SA 4.0. Scans: as stated by each holding library.</p><p><a href="${SITE}">sourcelibrary.org</a></p></div>`,
  },
]).genEpub();
fs.writeFileSync(out, epub);
console.log(`${out}: ${readings.length} readings (${scans} scans, ${withheld} withheld), ${words} words of sources, ${(epub.length / 1e6).toFixed(1)} MB`);
