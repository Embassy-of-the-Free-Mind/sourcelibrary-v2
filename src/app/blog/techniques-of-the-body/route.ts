// "Techniques of the Body" — a 1.3 MB made document (originals beside translations,
// woodcuts and plates inlined as data URIs) built in the atlas repo by
// ~/sourcelibrary-atlas/scripts/build-body.mjs and copied here as document.json.
// It replaced the prose note "Where the Instructions Are" (git history has it); the old
// URL /blog/where-the-instructions-are 308s here (next.config.ts).
//
// Served as plain static HTML rather than a React page for the same reason the atlas
// serves it that way: rendering 1.3 MB through a page would ship it twice (HTML + RSC
// payload). The document's stylesheet is scoped under main.bodymap, so the site bar
// below and the document cannot style each other.
//
// To refresh: rebuild in the atlas, then copy src/content/body.json over document.json
// (dropping the colophon's link to the old note, which now redirects here).
import doc from './document.json';

export const dynamic = 'force-static';

const TITLE = 'Techniques of the Body';
const DESCRIPTION =
  'Named postures, breaths and exercises quoted from the manuals themselves — Chinese daoyin, the Sanskrit seat and its commentary, the drawn asanas of the Śrītattvanidhi, and the Greek, Arabic and Latin rites — each original beside its translation.';
const URL = 'https://sourcelibrary.org/blog/techniques-of-the-body';
const HERO = 'https://images.sourcelibrary.org/gallery/6992ce183ea667fbac8281b4/6992ce193ea667fbac8281b8-0.jpg';
const HERO_ALT =
  'Woodcut from the Sancai tuhui of 1609: a seated figure performing the exercise prescribed for the fortnight of Rain Water, with the instruction printed beside him.';

const FONTS =
  'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..600;1,9..144,300..600&family=IBM+Plex+Mono:wght@400;500&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;1,8..60,400&family=Noto+Serif+SC:wght@400;600&family=Noto+Serif+Devanagari:wght@400;600&family=Noto+Naskh+Arabic:wght@400;600&display=swap';

// The built stylesheet puts its dark palette on :root, where main.bodymap's own light
// variables shadow it — so the page stayed light while the woodcuts still inverted.
// Re-declare the dark palette on the scoped element.
const SHELL_CSS = `
body{margin:0;background:#F3EFE6}
.sitebar{font:500 12px/1 "IBM Plex Mono",ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;
  padding:14px clamp(16px,5vw,64px);border-bottom:1px solid #D9D2C4;background:#F3EFE6;color:#6B6257;
  display:flex;gap:16px;flex-wrap:wrap;justify-content:space-between}
.sitebar a{color:inherit;text-decoration:none}.sitebar a:hover{color:#B5402A}
@media (prefers-color-scheme: dark){
  body,.sitebar{background:#15130F}.sitebar{border-color:#322D26;color:#A39A8C}.sitebar a:hover{color:#E8735A}
  html main.bodymap{--paper:#15130F;--ink:#EDE7DA;--dust:#A39A8C;--hair:#322D26;--cinnabar:#E8735A;--cinnabar-wash:#3A201A;--plate:#1D1A15}
}`;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function GET() {
  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${esc(TITLE)} - Research Notes - Source Library</title>`,
    `<meta name="description" content="${esc(DESCRIPTION)}">`,
    `<link rel="canonical" href="${URL}">`,
    '<meta property="og:type" content="article">',
    `<meta property="og:url" content="${URL}">`,
    `<meta property="og:title" content="${esc(TITLE)}">`,
    `<meta property="og:description" content="${esc(DESCRIPTION)}">`,
    `<meta property="og:image" content="${HERO}">`,
    `<meta property="og:image:alt" content="${esc(HERO_ALT)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:image" content="${HERO}">`,
    '<link rel="icon" href="/favicon.ico">',
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    `<link rel="stylesheet" href="${FONTS}">`,
    `<style>${SHELL_CSS}</style>`,
  ].join('');
  const bar =
    '<nav class="sitebar" aria-label="Site"><a href="/">Source Library</a><a href="/blog">&larr; All research notes</a></nav>';
  const html = `<!doctype html><html lang="en"><head>${head}</head><body>${bar}<main class="bodymap"><style>${doc.style}</style>${doc.body}</main></body></html>`;
  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=0, s-maxage=86400' },
  });
}
