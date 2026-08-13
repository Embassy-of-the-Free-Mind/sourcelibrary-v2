/**
 * MCP App: in-chat gallery viewer for search_images (#3978).
 *
 * Served as the `ui://source-library/gallery-viewer` resource
 * (mimeType `text/html;profile=mcp-app`). Hosts that support the MCP Apps
 * extension (claude.ai web + Claude desktop) render this in a sandboxed
 * iframe INSIDE the chat window and feed it the tool result over
 * postMessage JSON-RPC — which is the only way to put actual pictures in
 * front of the user there: plain MCP image blocks are collapsed into the
 * tool-result accordion (anthropics/claude-ai-mcp#238).
 *
 * The protocol is hand-rolled rather than bundling @modelcontextprotocol/ext-apps:
 * we need exactly three messages (ui/initialize out; its result and
 * ui/notifications/tool-result in), and a self-contained string keeps the
 * resource dependency-free. Wire shapes follow the 2026-01-26 apps spec.
 *
 * CSP note: the iframe's img-src is opt-in via the resource's
 * `_meta.ui.csp.resourceDomains` (declared where this resource is served in
 * src/app/api/mcp/route.ts) — images.sourcelibrary.org must stay listed
 * there or every thumbnail silently breaks.
 */
export const GALLERY_VIEWER_RESOURCE_URI = 'ui://source-library/gallery-viewer';
export const MCP_APP_MIME_TYPE = 'text/html;profile=mcp-app';

export const GALLERY_VIEWER_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
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
  a { color: inherit; text-decoration: none; }
  a:hover .cap, .sub a:hover { text-decoration: underline; }
</style>
</head>
<body>
<div class="head"><b>Source Library</b><span id="count"></span></div>
<div id="root" class="empty">Loading images…</div>
<script>
(function () {
  var INIT_ID = 1;

  function post(msg) { window.parent.postMessage(msg, '*'); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function applyTheme(theme) {
    if (theme === 'dark' || theme === 'light') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }

  function render(result) {
    var root = document.getElementById('root');
    var countEl = document.getElementById('count');
    var data = null;
    // Prefer structuredContent; fall back to parsing the first text block,
    // which carries the search_images JSON.
    if (result && result.structuredContent && result.structuredContent.images) {
      data = result.structuredContent;
    } else if (result && result.content) {
      for (var i = 0; i < result.content.length; i++) {
        var block = result.content[i];
        if (block.type === 'text') {
          try {
            var parsed = JSON.parse(block.text);
            if (parsed && parsed.images) { data = parsed; break; }
          } catch (e) { /* caption blocks aren't JSON — keep scanning */ }
        }
      }
    }
    if (!data || !data.images || !data.images.length) {
      root.className = 'empty';
      root.textContent = (data && data.note) ? data.note : 'No images in this result.';
      return;
    }
    countEl.textContent = data.total > data.images.length
      ? 'showing ' + data.images.length + ' of ' + data.total + ' images'
      : data.images.length + (data.images.length === 1 ? ' image' : ' images');
    root.className = 'grid';
    root.innerHTML = data.images.map(function (img) {
      if (!img.image_url) return '';
      var title = esc(img.description || (img.book && img.book.title) || 'Untitled');
      var bits = [];
      if (img.book && img.book.author) bits.push(esc(img.book.author));
      else if (img.artist) bits.push(esc(img.artist));
      if (img.book && img.book.year) bits.push(esc(img.book.year));
      else if (img.year) bits.push(esc(img.year));
      if (img.page) bits.push('p. ' + esc(img.page));
      var href = esc(img.url || img.book_url || '#');
      return '<div class="card">'
        + '<a class="imgwrap" href="' + href + '" target="_blank" rel="noopener">'
        + '<img src="' + esc(img.image_url) + '" alt="' + title + '" loading="lazy"></a>'
        + '<div class="meta"><a href="' + href + '" target="_blank" rel="noopener">'
        + '<div class="cap">' + title + '</div></a>'
        + '<div class="sub">' + bits.join(' · ') + '</div></div>'
        + '</div>';
    }).join('');
  }

  window.addEventListener('message', function (ev) {
    var msg = ev.data;
    if (!msg || msg.jsonrpc !== '2.0') return;
    if (msg.id === INIT_ID && msg.result) {
      var ctx = msg.result.hostContext || {};
      applyTheme(ctx.theme);
      return;
    }
    if (msg.method === 'ui/notifications/tool-result') {
      render(msg.params || {});
      return;
    }
    if (msg.method === 'ui/notifications/host-context-changed' && msg.params) {
      applyTheme(msg.params.theme || (msg.params.hostContext && msg.params.hostContext.theme));
    }
  });

  post({
    jsonrpc: '2.0',
    id: INIT_ID,
    method: 'ui/initialize',
    params: {
      protocolVersion: '2026-01-26',
      capabilities: {},
      clientInfo: { name: 'Source Library gallery viewer', version: '1.0.0' },
      appCapabilities: { availableDisplayModes: ['inline'] },
    },
  });
})();
</script>
</body>
</html>`;
