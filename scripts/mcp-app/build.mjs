/**
 * Bundle the MCP gallery app (#3978) into the generated module the server
 * serves. Run after editing gallery-app.js:
 *
 *   node scripts/mcp-app/build.mjs
 *
 * Requires the build-time-only SDK in node_modules:
 *   npm i --no-save @modelcontextprotocol/ext-apps
 * (deliberately not in package.json — the OUTPUT is committed; production
 * never imports the SDK.)
 */
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');

const result = await build({
  entryPoints: [join(here, 'gallery-app.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  write: false,
  target: ['es2020'],
});
const js = result.outputFiles[0].text;

const css = `
  :root {
    --bg: #faf8f4; --fg: #1f1d1a; --muted: #6b6559; --card: #ffffff;
    --border: rgba(0,0,0,.12); --shadow: rgba(0,0,0,.08);
  }
  [data-theme="dark"] {
    --bg: #1a1917; --fg: #ece8e1; --muted: #a39c8e; --card: #242220;
    --border: rgba(255,255,255,.12); --shadow: rgba(0,0,0,.35);
  }
  * { box-sizing: border-box; margin: 0; }
  body {
    background: var(--bg); color: var(--fg);
    font: 14px/1.45 Georgia, 'Times New Roman', serif;
    padding: 12px;
  }
  .head { display: flex; align-items: baseline; gap: 8px; margin: 2px 2px 10px; }
  .head b { font-size: 15px; }
  .head span { color: var(--muted); font-size: 12px; }
  .grid {
    display: grid; gap: 10px;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  }
  .card {
    background: var(--card); border: 1px solid var(--border);
    box-shadow: 0 1px 3px var(--shadow);
    display: flex; flex-direction: column; overflow: hidden;
  }
  .card a.imgwrap { display: block; background: #111; text-align: center; }
  .card img { width: 100%; height: 170px; object-fit: contain; display: block; }
  .meta { padding: 7px 9px 9px; }
  .cap {
    font-size: 12.5px; line-height: 1.35;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .sub { color: var(--muted); font-size: 11px; margin-top: 3px; }
  .sub a { color: var(--muted); }
  .empty { color: var(--muted); padding: 18px 6px; font-style: italic; }
  #linkbar {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    margin: 0 0 10px; padding: 8px 10px; font-size: 12.5px;
    background: var(--card); border: 1px solid var(--border);
  }
  #linkbar input {
    flex: 1; min-width: 200px; font: inherit; color: var(--fg);
    background: var(--bg); border: 1px solid var(--border); padding: 4px 6px;
  }
  a { color: inherit; text-decoration: none; }
  a:hover .cap, .sub a:hover { text-decoration: underline; }
`;

const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>${css}</style>
</head>
<body>
<div class="head"><b>Source Library</b><span id="count"></span></div>
<div id="root" class="empty">Loading images…</div>
<script>${js.replace(/<\/script>/gi, '<\\/script>')}</script>
</body>
</html>`;

const moduleSource = `/**
 * GENERATED FILE — do not edit by hand.
 *
 * Source: scripts/mcp-app/gallery-app.js  (rebuild: node scripts/mcp-app/build.mjs)
 *
 * MCP App: in-chat gallery viewer for search_images (#3978, #3980).
 * Served as the ui://source-library/gallery-viewer resource
 * (mimeType text/html;profile=mcp-app). Bundles the official
 * @modelcontextprotocol/ext-apps App class, whose connect() performs the
 * handshake AND auto-reports iframe size — the two things whose absence
 * rendered v1 as a blank zero-height card in claude.ai.
 *
 * CSP note: the iframe's img-src is opt-in via the resource's
 * _meta.ui.csp.resourceDomains (declared in src/app/api/mcp/route.ts) —
 * images.sourcelibrary.org must stay listed there or every thumbnail
 * silently breaks.
 */
export const GALLERY_VIEWER_RESOURCE_URI = 'ui://source-library/gallery-viewer';
export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app';

export const GALLERY_VIEWER_HTML = ${JSON.stringify(html)};
`;

const outPath = join(repo, 'src', 'lib', 'mcp-gallery-app.ts');
writeFileSync(outPath, moduleSource);
console.log(`wrote ${outPath}: html ${html.length} bytes (js ${js.length}, css ${css.length})`);
