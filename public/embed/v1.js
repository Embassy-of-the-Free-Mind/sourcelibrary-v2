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
 *     data-top-offset="38px">
 *   </script>
 *
 * Attributes:
 *   data-collection  — collection slug to embed (e.g. "alchemy")
 *   data-library     — library provider key to embed (e.g. "bph", "internet-archive")
 *   data-target      — id of the container div (required)
 *   data-top-offset  — top offset for fixed host nav (default: 0px)
 *   data-height      — optional fallback height override (legacy)
 *   data-scroll-mode — "page" (default, footer reachable) or "iframe" (locked host scroll)
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
  var TOP_OFFSET = script.getAttribute('data-top-offset') || '0px';
  // var HEIGHT_OVERRIDE = script.getAttribute('data-height') || '';
  var SCROLL_MODE = (script.getAttribute('data-scroll-mode') || 'page').toLowerCase();

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
      // Keep iframe in normal document flow so footer remains below it.
      '#sl-iframe-wrap{position:relative;width:100%;overflow:hidden}',
      '#sl-iframe-wrap iframe{display:block;width:100%;height:100%;border:none;background:#faf8f4}',
      // Iframe-only mode: lock host scroll to prevent nested iframe/page scrolling.
      'html.sl-embed-lock-scroll,body.sl-embed-lock-scroll{overflow:hidden!important;height:100%!important}',
    ].join('');
    document.head.appendChild(style);
  }

  function setHostScrollLocked(locked) {
    var method = locked ? 'add' : 'remove';
    document.documentElement.classList[method]('sl-embed-lock-scroll');
    if (document.body) document.body.classList[method]('sl-embed-lock-scroll');
  }

  function getViewportHeightBelowOffset() {
    var n = parseFloat(TOP_OFFSET);
    var unit = (TOP_OFFSET || '').replace(String(n), '').trim() || 'px';

    // Best-case: pixel offset can be subtracted from viewport reliably.
    if (!isNaN(n) && unit === 'px') {
      var px = Math.max(0, Math.round(window.innerHeight - n));
      return px + 'px';
    }

    // Fallback for non-px units (e.g. rem): delegate to CSS calc.
    return 'calc(100vh - ' + TOP_OFFSET + ')';
  }

  function getViewportHeightBelowOffsetPx() {
    var n = parseFloat(TOP_OFFSET);
    var unit = (TOP_OFFSET || '').replace(String(n), '').trim() || 'px';
    if (isNaN(n) || unit !== 'px') return null;
    return Math.max(0, Math.round(window.innerHeight - n));
  }

  function getTopOffsetPx() {
    var n = parseFloat(TOP_OFFSET);
    var unit = (TOP_OFFSET || '').replace(String(n), '').trim() || 'px';
    if (isNaN(n) || unit !== 'px') return 0;
    return Math.max(0, Math.round(n));
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
  // Book paths are tenant-scoped: /{tenant}/book/*; collection paths are global: /collections/*
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
      return BASE_URL + '/collections/' + encodeURIComponent(COLLECTION);
    }
    // Default: tenant root (library home page)
    return BASE_URL + '/' + TENANT;
  }

  // --- Render ---
  function render(container) {
    injectStyles();

    var wrap = document.createElement('div');
    wrap.id = 'sl-iframe-wrap';
    wrap.style.marginTop = TOP_OFFSET;
    wrap.style.height = getViewportHeightBelowOffset();

    var iframe = document.createElement('iframe');
    iframe.id = 'sl-embed-iframe';
    iframe.src = buildInitialSrc();
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('title', 'Source Library');

    function resetToViewportBaseline() {
      if (SCROLL_MODE === 'iframe') return;      
      var baseline = getViewportHeightBelowOffset();
      iframe.style.height = baseline;
      wrap.style.height = baseline;
    }

    function scrollHostToEmbedTop() {
      var wrapTop = wrap.getBoundingClientRect().top + window.pageYOffset;
      var target = Math.max(0, Math.round(wrapTop - getTopOffsetPx()));
      window.scrollTo(0, target);
    }

    var lastNavKey = String(getURLParam('book') || '') + '::' + String(getURLParam('page') || '');

    if (SCROLL_MODE === 'iframe') {
      wrap.style.overscrollBehaviorY = 'contain';
      iframe.style.overscrollBehaviorY = 'contain';
    }

    wrap.appendChild(iframe);
    container.appendChild(wrap);

    // Safety: always clear any stale lock from prior script versions/renders.
    setHostScrollLocked(SCROLL_MODE === 'iframe');

    // If the iframe performs a document navigation, drop stale prior height immediately.
    iframe.addEventListener('load', function () {
      resetToViewportBaseline();
    });

    // --- postMessage listener ---
    // Source Library pages send navigation events so we can keep
    // the host page URL in sync (shareability + back button).
    window.addEventListener('message', function (event) {
      // Only accept messages from the Source Library origin
      if (event.origin !== BASE_URL) return;
      if (event.source !== iframe.contentWindow) return;

      var data = event.data;
      if (!data || !data.type) return;

      // Page mode: auto-grow iframe to content height so host page has one scrollbar.
      if (SCROLL_MODE !== 'iframe' && data.type === 'sl-resize') {
        var nextHeight = parseInt(data.height, 10);
        if (!isNaN(nextHeight) && nextHeight > 0) {
          var minPx = getViewportHeightBelowOffsetPx();
          var applied = minPx ? Math.max(minPx, nextHeight) : nextHeight;
          var px = applied + 'px';
          iframe.style.height = px;
          wrap.style.height = px;
        }
        return;
      }

      if (data.type !== 'sl-navigate') return;

      // Client-side route transitions can keep previous page height briefly.
      // Reset to viewport baseline, then let sl-resize grow/shrink to final content.
      resetToViewportBaseline();

      var nextNavKey = String(data.book || '') + '::' + String(data.page || '');
      if (nextNavKey !== lastNavKey) {
        scrollHostToEmbedTop();
        lastNavKey = nextNavKey;
      }

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
