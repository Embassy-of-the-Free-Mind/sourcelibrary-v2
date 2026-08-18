/**
 * Source Library gallery viewer — MCP App source (#3978, #3980).
 *
 * Browser-side code for the in-chat image grid. Bundled by build.mjs (esbuild,
 * with the official @modelcontextprotocol/ext-apps SDK inlined) into the
 * generated module src/lib/mcp-gallery-app.ts, which the MCP route serves as
 * the ui://source-library/gallery-viewer resource.
 *
 * Why the SDK instead of hand-rolled postMessage (the v1 that shipped in
 * #3980): Anthropic's troubleshooting doc names the two ways an app renders
 * BLANK — handlers only fire after the SDK's connect() handshake, and the
 * inner iframe has ZERO HEIGHT until the app reports its size, which
 * connect() auto-installs (setupSizeChangedNotifications). v1 did neither
 * notification, which is exactly the empty bordered card Derek screenshotted.
 *
 * Edit this file, then: node scripts/mcp-app/build.mjs
 * (requires: npm i --no-save @modelcontextprotocol/ext-apps — build-time only,
 * the generated output is committed and the server has no runtime dependency).
 */
import { App } from '@modelcontextprotocol/ext-apps';

const app = new App({ name: 'Source Library gallery viewer', version: '2.0.0' });

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
}

function applyTheme(ctx) {
  const theme = ctx && ctx.theme;
  if (theme === 'dark' || theme === 'light') {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

function render(result) {
  const root = document.getElementById('root');
  const countEl = document.getElementById('count');
  let data = null;
  // Prefer structuredContent; fall back to parsing the first text block that
  // carries the search_images JSON (caption text blocks aren't JSON — skip).
  if (result && result.structuredContent && result.structuredContent.images) {
    data = result.structuredContent;
  } else if (result && Array.isArray(result.content)) {
    for (const block of result.content) {
      if (block.type === 'text') {
        try {
          const parsed = JSON.parse(block.text);
          if (parsed && parsed.images) { data = parsed; break; }
        } catch { /* not the JSON block */ }
      }
    }
  }
  if (!data || !data.images || !data.images.length) {
    root.className = 'empty';
    root.textContent = (data && data.note) ? data.note : 'No images in this result.';
    return;
  }
  countEl.textContent = data.total > data.images.length
    ? `showing ${data.images.length} of ${data.total} images`
    : `${data.images.length} ${data.images.length === 1 ? 'image' : 'images'}`;
  root.className = 'grid';
  root.innerHTML = data.images.map((img) => {
    if (!img.image_url) return '';
    const title = esc(img.description || (img.book && img.book.title) || 'Untitled');
    const bits = [];
    if (img.book && img.book.author) bits.push(esc(img.book.author));
    else if (img.artist) bits.push(esc(img.artist));
    if (img.book && img.book.year) bits.push(esc(img.book.year));
    else if (img.year) bits.push(esc(img.year));
    if (img.page) bits.push('p. ' + esc(img.page));
    const href = esc(img.url || img.book_url || '#');
    return '<div class="card">'
      + `<a class="imgwrap" href="${href}" target="_blank" rel="noopener">`
      + `<img src="${esc(img.image_url)}" alt="${title}" loading="lazy"></a>`
      + `<div class="meta"><a href="${href}" target="_blank" rel="noopener">`
      + `<div class="cap">${title}</div></a>`
      + `<div class="sub">${bits.join(' · ')}</div></div>`
      + '</div>';
  }).join('');
}

app.ontoolresult = (result) => render(result);
app.onhostcontextchanged = (ctx) => applyTheme(ctx);

// Route card clicks through the host: sandboxed iframes generally swallow
// target=_blank, so a plain anchor renders a gallery you can look at but not
// leave. app.openLink({uri}) is the spec's way to ask the host to open the
// book/gallery page in the user's browser. The anchors stay in the DOM as a
// fallback for permissive hosts and for right-click/copy-link.
document.addEventListener('click', (ev) => {
  const a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
  if (!a) return;
  const href = a.getAttribute('href');
  if (!href || href === '#') { ev.preventDefault(); return; }
  ev.preventDefault();
  app.openLink({ uri: href }).catch(() => {
    // Host refused or doesn't support openLink — try the anchor's own path.
    window.open(href, '_blank', 'noopener');
  });
});

app.connect().then(() => {
  applyTheme(app.getHostContext ? app.getHostContext() : null);
}).catch((err) => {
  const root = document.getElementById('root');
  root.className = 'empty';
  root.textContent = 'Could not connect to the chat host: ' + (err && err.message ? err.message : err);
});
