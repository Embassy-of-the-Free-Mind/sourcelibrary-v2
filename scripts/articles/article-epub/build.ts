// Assembles the EPUB from article.html, refs.txt and pages/ in the cwd (see README.md).
// Usage: node build.mjs <article-slug> <out.epub>
import fs from 'fs';
import { markdownToHtml } from '@/lib/export-markdown-html';
import { EPub } from 'epub-gen-memory';
import { posts } from '@/app/articles/posts';

const [slug, out] = process.argv.slice(2);
const post = posts.find((p) => p.slug === slug);
if (!post) throw new Error(`no post ${slug} in src/app/articles/posts.ts`);

const SITE = 'https://sourcelibrary.org';
const refs = fs.readFileSync('refs.txt', 'utf8').trim().split('\n').filter(Boolean);
const anchor = (r: string) => 'r-' + r.replace(/\?page=/, '-');
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Tags in the stored page text that are layout, not reading (running heads, signatures, catchwords).
const LAYOUT = /<(page-num|sig|catch|header|footer)>[\s\S]*?<\/\1>/g;

// The essay: a link to a cited page goes to that page's reading in the back.
const essay = fs.readFileSync('article.html', 'utf8')
  .replace(/<blockquote data-book="[^"]*" data-page="[^"]*" data-src="[^"]*">/g, '<blockquote>')
  .replace(/href="https:\/\/sourcelibrary\.org\/book\/([a-z0-9-]+\?page=\d+)"/g, (m, r) =>
    refs.includes(r) ? `href="readings.xhtml#${anchor(r)}"` : m);

// The readings: the cited pages, in the order the essay first cites them.
const readings: string[] = [];
let words = 0;
for (const r of refs) {
  const [book, page] = r.split('?page=');
  const file = `pages/${book}-${page}.json`;
  if (!fs.existsSync(file)) continue;
  const q = JSON.parse(fs.readFileSync(file, 'utf8'));
  const english = /^english/i.test(q.language || '');
  const text: string = ((english && q.original) || q.translation || q.original || '').replace(LAYOUT, '');
  if (!text.trim()) continue;
  words += text.split(/\s+/).length;
  const pp = q.printed_page && String(q.printed_page) !== String(page) ? `p. ${esc(q.printed_page)} (scan ${page})` : `p. ${page}`;
  const published = q.published && q.published !== 'Unknown' ? `, ${esc(q.published)}` : '';
  readings.push(`<section id="${anchor(r)}" class="reading">
<h3>${esc(q.title)}</h3>
<p class="meta">${esc(q.author)}${published} · ${pp}${english ? '' : ' · English translation'} · <a href="${SITE}/book/${r}">open the page</a></p>
<div class="text">${markdownToHtml(text)}</div>
</section>`);
}

const css = `body{font-family:serif;line-height:1.5}
blockquote{margin:1em 1.2em;border-left:2px solid #b8955a;padding-left:.8em}
.cite,.meta{font-size:.85em;color:#666}
figure{margin:1em 0;text-align:center} figure img{max-width:100%} figcaption{font-size:.85em;color:#555}
.reading{page-break-before:always} .reading h3{margin-bottom:.2em}`;

const [heading, ...rest] = post.title.split(': ');
const epub = await new EPub({
  title: heading,
  author: 'Source Library',
  publisher: 'Source Library',
  description: `${post.summary} The article, with every page it cites gathered at the back.`,
  cover: post.image,
  lang: 'en', css, tocTitle: 'Contents', ignoreFailedDownloads: true, verbose: false,
}, [
  {
    title: 'About this edition', filename: 'about.xhtml',
    content: `<p>An article from Source Library (<a href="${SITE}/articles/${slug}">${SITE}/articles/${slug}</a>), ${esc(post.date)}, followed by the ${readings.length} book pages it cites, so the sources can be read offline. A linked phrase in the article goes to its page in the Readings; each reading links to the page online.</p><p>Pages not in English are given in Source Library's AI translation, English-language books as transcribed from the scan. Both can contain errors: the page online shows the scan.</p>`,
  },
  { title: heading, filename: 'essay.xhtml', content: `${rest.length ? `<p><i>${esc(rest.join(': '))}</i></p>` : ''}${essay}` },
  { title: 'Readings', filename: 'readings.xhtml', content: `<p>The pages the article cites, in the order it first cites them.</p>${readings.join('\n')}` },
]).genEpub();
fs.writeFileSync(out, epub);
console.log(`${out}: ${readings.length} readings, ${words} words of sources, ${(epub.length / 1e6).toFixed(1)} MB`);
