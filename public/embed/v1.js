/**
 * Source Library Embed Script v2
 *
 * Renders Source Library's actual UI (collections, book detail, page reader)
 * inside a full-screen iframe. No UI duplication — any changes to Source Library
 * automatically propagate to all embedded sites.
 *
 * History Management Strategy:
 * - Browser owns the initial entry (index.html). We NEVER touch it.
 * - Each iframe navigation (book, page) pushes exactly ONE new entry.
 * - On popstate, we navigate the iframe to match the URL. No history writes.
 * - sl-navigate from iframe only pushes when URL actually differs.
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
  var SCROLL_MODE = (script.getAttribute('data-scroll-mode') || 'page').toLowerCase();
  if (!TENANT) {
    console.error('[SourceLibrary] data-library is required on the embed script tag.');
    return;
  }

  // --- Helpers ---
  function getParam(key) {
    try { return new URL(window.location.href).searchParams.get(key); }
    catch (e) { return null; }
  }

  function makeNavKey(book, page) {
    return (book || '') + '::' + (page || '');
  }

  function getHostPathname() {
    try {
      var u = new URL(window.location.href);
      return u.pathname || '/';
    } catch (e) {
      return '/';
    }
  }

  function withEmbedContext(src) {
    var sep = src.indexOf('?') === -1 ? '?' : '&';
    return src + sep + 'host_path=' + encodeURIComponent(getHostPathname());
  }

  function buildIframeSrc(book, page) {
    var base = BASE_URL + '/';
    if (book && page) {
      return withEmbedContext(base + TENANT + '/book/' + encodeURIComponent(book) + '/page/' + encodeURIComponent(page) + '?embed=1');
    }
    if (book) {
      return withEmbedContext(base + TENANT + '/book/' + encodeURIComponent(book) + '?embed=1');
    }
    if (COLLECTION) {
      return withEmbedContext(base + 'collections/' + encodeURIComponent(COLLECTION) + '?embed=1');
    }
    return withEmbedContext(base + TENANT + '?view=books&embed=1');
  }

  // --- CSS ---
  function injectStyles() {
    if (document.getElementById('sl-embed-styles')) return;
    var style = document.createElement('style');
    style.id = 'sl-embed-styles';
    style.textContent = [
      '#sl-iframe-wrap{position:relative;width:100%;overflow:hidden}',
      '#sl-iframe-wrap iframe{display:block;width:100%;height:100%;border:none;background:#faf8f4}',
      'html.sl-embed-lock-scroll,body.sl-embed-lock-scroll{overflow:hidden!important;height:100%!important}',
    ].join('');
    document.head.appendChild(style);
  }

  function setHostScrollLocked(locked) {
    var m = locked ? 'add' : 'remove';
    document.documentElement.classList[m]('sl-embed-lock-scroll');
    if (document.body) document.body.classList[m]('sl-embed-lock-scroll');
  }

  function getViewportHeight() {
    var n = parseFloat(TOP_OFFSET);
    var unit = (TOP_OFFSET || '').replace(String(n), '').trim() || 'px';
    if (!isNaN(n) && unit === 'px') {
      return Math.max(0, Math.round(window.innerHeight - n)) + 'px';
    }
    return 'calc(100vh - ' + TOP_OFFSET + ')';
  }

  function getViewportHeightPx() {
    var n = parseFloat(TOP_OFFSET);
    var unit = (TOP_OFFSET || '').replace(String(n), '').trim() || 'px';
    if (isNaN(n) || unit !== 'px') return null;
    return Math.max(0, Math.round(window.innerHeight - n));
  }

  function getOffsetPx() {
    var n = parseFloat(TOP_OFFSET);
    var unit = (TOP_OFFSET || '').replace(String(n), '').trim() || 'px';
    if (isNaN(n) || unit !== 'px') return 0;
    return Math.max(0, Math.round(n));
  }

  // --- Render ---
  function render(container) {
    injectStyles();

    var wrap = document.createElement('div');
    wrap.id = 'sl-iframe-wrap';
    wrap.style.marginTop = TOP_OFFSET;
    wrap.style.height = getViewportHeight();

    var iframe = document.createElement('iframe');
    iframe.id = 'sl-embed-iframe';
    iframe.src = buildIframeSrc(getParam('book'), getParam('page'));
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('title', 'Source Library');

    if (SCROLL_MODE === 'iframe') {
      wrap.style.overscrollBehaviorY = 'contain';
      iframe.style.overscrollBehaviorY = 'contain';
    }

    wrap.appendChild(iframe);
    container.appendChild(wrap);
    setHostScrollLocked(SCROLL_MODE === 'iframe');

    // --- State ---
    // What the host URL currently has (from browser perspective)
    var hostNavKey = makeNavKey(getParam('book'), getParam('page'));
    // What the iframe is currently showing (tracked via sl-navigate)
    var frameNavKey = hostNavKey;
    // Guard: true while handling popstate to prevent sl-navigate from pushing
    var isPopstateNav = false;
    // For forced reloads when client nav fails
    var reloadCounter = 0;
    // Track expected history length to detect iframe full navigations
    var expectedHistoryLength = history.length;

    function resetHeight() {
      if (SCROLL_MODE === 'iframe') return;
      var h = getViewportHeight();
      iframe.style.height = h;
      wrap.style.height = h;
    }

    function scrollToTop() {
      var top = wrap.getBoundingClientRect().top + window.pageYOffset;
      window.scrollTo(0, Math.max(0, Math.round(top - getOffsetPx())));
    }

    iframe.addEventListener('load', resetHeight);

    // --- Handle messages from iframe ---
    window.addEventListener('message', function (event) {
      if (event.origin !== BASE_URL) return;
      if (event.source !== iframe.contentWindow) return;
      var data = event.data;
      if (!data || !data.type) return;

      // Resize
      if (data.type === 'sl-resize' && SCROLL_MODE !== 'iframe') {
        var h = parseInt(data.height, 10);
        if (!isNaN(h) && h > 0) {
          var min = getViewportHeightPx();
          var px = (min ? Math.max(min, h) : h) + 'px';
          iframe.style.height = px;
          wrap.style.height = px;
        }
        return;
      }

      // Navigation report from iframe
      if (data.type !== 'sl-navigate') return;

      var newNavKey = makeNavKey(data.book, data.page);
      var historyGrewUnexpectedly = history.length > expectedHistoryLength;

      // Update frame tracking
      frameNavKey = newNavKey;
      resetHeight();

      // If this was triggered by popstate, we're done - don't push history
      if (isPopstateNav) {
        isPopstateNav = false;
        return;
      }

      // Only push if host URL differs from what iframe is now showing
      if (newNavKey === hostNavKey) {
        return;
      }

      // Scroll to top on navigation
      scrollToTop();

      // Build the new URL
      var url = new URL(window.location.href);
      url.searchParams.delete('book');
      url.searchParams.delete('page');
      if (data.book) url.searchParams.set('book', data.book);
      if (data.page) url.searchParams.set('page', data.page);

      // If history grew unexpectedly (iframe did full navigation), use replaceState
      // instead of pushState to avoid duplicate entries
      if (historyGrewUnexpectedly) {
        window.history.replaceState({ book: data.book || null, page: data.page || null }, '', url.toString());
        hostNavKey = newNavKey;
      } else {
        window.history.pushState({ book: data.book || null, page: data.page || null }, '', url.toString());
        hostNavKey = newNavKey;
        expectedHistoryLength = history.length;
      }
    });

    // --- Handle browser back/forward ---
    window.addEventListener('popstate', function () {
      var book = getParam('book');
      var page = getParam('page');
      var targetNavKey = makeNavKey(book, page);

      // Update host tracking
      hostNavKey = targetNavKey;
      // Sync expected length - popstate doesn't change length, but resets our expectation
      expectedHistoryLength = history.length;

      // If iframe already shows this, nothing to do
      if (targetNavKey === frameNavKey) {
        return;
      }

      // Set guard so sl-navigate doesn't push when iframe confirms navigation
      isPopstateNav = true;

      // Scroll to top
      scrollToTop();

      // Try fast client-side navigation first
      var src = buildIframeSrc(book, page);

      try {
        iframe.contentWindow.postMessage({
          type: 'sl-host-navigate',
          tenant: TENANT,
          book: book || null,
          page: page || null,
        }, BASE_URL);
      } catch (e) { /* cross-origin, fallback handles it */ }

      // Fallback: if iframe doesn't respond in 400ms, force reload
      setTimeout(function () {
        if (frameNavKey === targetNavKey) {
          return;
        }
        reloadCounter++;
        iframe.src = src + (src.indexOf('?') === -1 ? '?' : '&') + '_r=' + reloadCounter;
        frameNavKey = targetNavKey;
        isPopstateNav = false;
      }, 400);
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
