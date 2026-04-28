/**
 * Source Library Embed Script
 *
 * Renders Source Library's actual UI (collections, book detail, page reader)
 * inside a full-screen iframe. No UI duplication — any changes to Source Library
 * automatically propagate to all embedded sites.
 *
 * Usage:
 *   <div id="sl-embed"></div>
 *   <script
 *     src="https://sourcelibrary.org/embed.js"
 *     data-library="bph"
 *     data-collection="alchemy"
 *     data-target="sl-embed"
 *     data-height="100vh">
 *   </script>
 *
 * Attributes:
 *   data-collection  — collection slug to embed (e.g. "alchemy")
 *   data-library     — library provider key to embed (e.g. "bph", "internet-archive")
 *   data-target      — id of the container div (required)
 *   data-height      — iframe height, any CSS value (default: 100vh)
 *   data-auto-height — auto-resize iframe to content height via postMessage (default: true)
 *   data-bottom-offset — extra px added below iframe content (default: 24)
 *   data-base-url    — override API/page base URL (default: https://sourcelibrary.org)
 *
 * At least one of data-collection or data-library is required.
 */
(function () {
  'use strict';

  // --- Config ---
  var script = document.currentScript ||
    (function () {
      var scripts = document.getElementsByTagName('script');
      // Find the script by looking for our specific src pattern
      for (var i = scripts.length - 1; i >= 0; i--) {
        var src = scripts[i].src || '';
        if (src.indexOf('embed') !== -1 && src.indexOf('v1.js') !== -1) {
          return scripts[i];
        }
        if (src.indexOf('sourcelibrary') !== -1 && src.indexOf('embed') !== -1) {
          return scripts[i];
        }
      }
      return scripts[scripts.length - 1];
    })();

  if (!script) {
    console.error('[SourceLibrary] Could not find embed script element.');
    return;
  }

  var BASE_URL = (script.getAttribute('data-base-url') || 'https://sourcelibrary.org').replace(/\/$/, '');
  var COLLECTION = script.getAttribute('data-collection') || '';
  var TENANT = script.getAttribute('data-library') || '';
  var TARGET_ID = script.getAttribute('data-target') || 'sl-embed';
  var HEIGHT = script.getAttribute('data-height') || '100vh';
  var AUTO_HEIGHT = (script.getAttribute('data-auto-height') || 'true').toLowerCase() !== 'false';
  var BOTTOM_OFFSET = parseInt(script.getAttribute('data-bottom-offset') || '24', 10);
  if (isNaN(BOTTOM_OFFSET) || BOTTOM_OFFSET < 0) BOTTOM_OFFSET = 24;

  if (!TENANT) {
    console.error('[SourceLibrary] data-library is required on the embed script tag.');
    return;
  }

  // --- CSS ---
  function injectStyles() {
    if (document.getElementById('sl-embed-styles')) return;
    var style = document.createElement('style');
    style.id = 'sl-embed-styles';
    style.textContent = [
      '#sl-iframe-wrap{position:relative;width:100%;overflow:hidden}',
      '#sl-iframe-wrap iframe{display:block;width:100%;border:none;background:#faf8f4}',
    ].join('');
    document.head.appendChild(style);
  }

  // --- URL state helpers ---
  // Keeps the host page URL in sync with what's loaded inside the iframe,
  // so links are shareable and the browser back button works.

  function getURLParam(key) {
    try {
      return new URL(window.location.href).searchParams.get(key);
    } catch (e) { return null; }
  }

  function setURLParams(params) {
    try {
      var url = new URL(window.location.href);
      Object.keys(params).forEach(function (k) {
        if (params[k] == null) {
          url.searchParams.delete(k);
        } else {
          url.searchParams.set(k, params[k]);
        }
      });
      window.history.pushState(params, '', url.toString());
    } catch (e) {}
  }

  // Build the initial iframe src from URL params (for deep linking)
  // All paths are tenant-scoped: /{tenant}/book/*, /{tenant}/collections/*
  function buildInitialSrc() {
    var book = getURLParam('book');
    var page = getURLParam('page');

    if (book && page) {
      return BASE_URL + '/' + TENANT + '/book/' + encodeURIComponent(book) + '/page/' + encodeURIComponent(page);
    }
    if (book) {
      return BASE_URL + '/' + TENANT + '/book/' + encodeURIComponent(book);
    }
    if (COLLECTION) {
      return BASE_URL + '/' + TENANT + '/collections/' + encodeURIComponent(COLLECTION);
    }
    // Default: tenant root (library home page)
    return BASE_URL + '/' + TENANT;
  }

  // --- Render ---
  function render(container) {
    injectStyles();

    // Defensive defaults for CMS builders (e.g. Webflow) where the embed target
    // might be configured with fixed height/overflow, causing footer overlap.
    container.style.height = 'auto';
    container.style.minHeight = '0';
    container.style.overflow = 'visible';

    var wrap = document.createElement('div');
    wrap.id = 'sl-iframe-wrap';
    wrap.style.height = HEIGHT;

    var iframe = document.createElement('iframe');
    iframe.id = 'sl-embed-iframe';
    iframe.src = buildInitialSrc();
    iframe.style.height = HEIGHT;
    iframe.style.overflow = 'hidden';
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('title', 'Source Library');
    iframe.setAttribute('scrolling', AUTO_HEIGHT ? 'no' : 'auto');

    if (AUTO_HEIGHT) {
      // Ask embedded app to emit a fresh height after load/nav transitions.
      iframe.addEventListener('load', function () {
        try {
          iframe.contentWindow.postMessage({ type: 'sl-request-resize' }, BASE_URL);
        } catch (e) {}
      });
    }

    wrap.appendChild(iframe);
    container.appendChild(wrap);

    // --- postMessage listener ---
    // Source Library pages send navigation events so we can keep
    // the host page URL in sync (shareability + back button).
    window.addEventListener('message', function (event) {
      // Only accept messages from the Source Library origin
      if (event.origin !== BASE_URL) return;

      var data = event.data;
      if (!data || !data.type) return;

      if (AUTO_HEIGHT && data.type === 'sl-resize') {
        var nextHeight = parseInt(data.height, 10);
        if (!isNaN(nextHeight) && nextHeight > 0) {
          var px = (nextHeight + BOTTOM_OFFSET) + 'px';
          iframe.style.height = px;
          wrap.style.height = px;
        }
        return;
      }

      if (data.type !== 'sl-navigate') return;

      // Update host URL params without reloading the page
      setURLParams({
        book: data.book || null,
        page: data.page || null,
      });
    });

    // Browser back/forward: update iframe src to match URL params
    window.addEventListener('popstate', function () {
      var src = buildInitialSrc();
      if (iframe.src !== src) {
        iframe.src = src;
      }
    });
  }

  // --- Init ---
  function init() {
    var container = document.getElementById(TARGET_ID);
    if (!container) {
      console.error('[SourceLibrary] No element found with id "' + TARGET_ID + '"');
      return;
    }
    container.innerHTML = '';
    render(container);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
