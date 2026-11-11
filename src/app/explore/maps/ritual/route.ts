// Sources on ritual (#4922, retitled #7646): the atlas's survey document, served as one static HTML response.
// It is 1.5 MB of markup and has no interactivity; as a React page the same markup would ship
// twice (HTML + flight payload), so it is a route handler, as on the atlas. It keeps its own
// typography (a document, not app chrome) under a slim bar that leads back into the site.
// ritual.json is a copied build artifact: scripts/maintenance/import-atlas-maps.mjs.
import doc from './ritual.json';

export const dynamic = 'force-static';

const TITLE = 'Sources on ritual | Source Library';
const DESCRIPTION =
  'Every primary source on liturgy, sacrifice, initiation, magic, funerary and calendar rite, monastic rule and ceremonial that Source Library holds, in eight traditions, with what you can read today.';
const URL = 'https://sourcelibrary.org/explore/maps/ritual';
const OG_IMAGE = 'https://sourcelibrary.org/og-image.jpg';
const FONTS =
  'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&display=swap';

// The artifact's stylesheet reads --display/--body from the atlas's globals; these are the
// same faces the site uses. The bar borrows the document's own palette.
const SHELL_CSS = `
html,body{margin:0;background:#F3F2EE}
.ritual{--display:'Cormorant Garamond',Georgia,serif;--body:'Newsreader',Georgia,serif}
.ritual .slbar{border-bottom:1px solid var(--rule);background:var(--bg)}
.ritual .slbar .in{max-width:80rem;margin:0 auto;padding:.7rem 2rem;display:flex;gap:1.25rem;align-items:baseline;flex-wrap:wrap;font-size:.9rem}
.ritual .slbar .brand{font-family:var(--display);font-size:1.35rem;font-weight:600;text-decoration:none;color:var(--ink);margin-right:auto}
.ritual .slbar a{text-decoration:none;color:var(--ink2)}
.ritual .slbar a:hover{color:var(--rubric)}
@media(max-width:60rem){.ritual .slbar .in{padding:.6rem 1rem;gap:.9rem}}
.ritual .wrap>main{min-width:0}
@media(max-width:60rem){.ritual .wrap{grid-template-columns:minmax(0,1fr)}}
@media (prefers-color-scheme:dark){html,body{background:#15140F}}
`;

export function GET() {
  const bar = `<header class="slbar"><div class="in"><a class="brand" href="/">Source Library</a><a href="/explore/maps">Source surveys</a><a href="/explore">Explore</a><a href="/search">Search</a></div></header>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${TITLE}</title><meta name="description" content="${DESCRIPTION}"><link rel="canonical" href="${URL}">
<meta property="og:title" content="${TITLE}"><meta property="og:description" content="${DESCRIPTION}"><meta property="og:url" content="${URL}"><meta property="og:type" content="article"><meta property="og:site_name" content="Source Library"><meta property="og:image" content="${OG_IMAGE}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${TITLE}"><meta name="twitter:description" content="${DESCRIPTION}"><meta name="twitter:image" content="${OG_IMAGE}">
<link rel="icon" href="/favicon.ico"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${FONTS}">
<style>${doc.style}${SHELL_CSS}</style></head><body><div class="ritual">${bar}${doc.body}</div></body></html>`;
  return new Response(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=0, s-maxage=86400' },
  });
}
