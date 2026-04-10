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
 *   data-base-url    — override API/page base URL (default: https://sourcelibrary.org)
 *
 * At least one of data-collection or data-library is required.
 */
(function () {
  'use strict';

  // Maps providerKey → URL slug for /libraries/[slug] pages.
  // Mirrors LIBRARY_PARTNERS in src/lib/library-partners.ts.
  var LIBRARY_SLUGS = {
    'internet_archive': 'internet-archive',
    'gallica': 'gallica',
    'mdz': 'bavarian-state-library',
    'bodleian': 'bodleian',
    'cambridge': 'cambridge',
    'bph': 'bibliotheca-philosophica-hermetica',
    'e-rara': 'e-rara',
    'wellcome': 'wellcome-collection',
    'hab': 'hab-wolfenbuettel',
    'vatican': 'vatican-library',
    'google_books': 'google-books',
    'hathi_trust': 'hathi-trust',
    'europeana': 'europeana',
    'manchester': 'manchester',
    'allard_pierson': 'allard-pierson',
    'laurenziana': 'laurenziana',
    'leiden': 'leiden',
    'e-codices': 'e-codices',
    'chester_beatty': 'chester-beatty',
    'ndl_japan': 'ndl-japan',
    'cmc_kloss': 'kloss-collection',
    'loc': 'library-of-congress',
    'bl': 'british-library',
    'sbb': 'sbb-berlin',
    'onb': 'austrian-national-library',
    'yale_beinecke': 'yale-beinecke',
    'harvard': 'harvard-houghton',
    'penn_colenda': 'penn-schoenberg',
    'huntington': 'huntington',
    'getty': 'getty',
    'kyoto_rmda': 'kyoto',
  };

  // --- Config ---
  var script = document.currentScript ||
    (function () {
      var scripts = document.getElementsByTagName('script');
      return scripts[scripts.length - 1];
    })();

  var BASE_URL = (script.getAttribute('data-base-url') || 'https://sourcelibrary.org').replace(/\/$/, '');
  var COLLECTION = script.getAttribute('data-collection') || '';
  var LIBRARY_KEY = script.getAttribute('data-library') || '';
  var LIBRARY_SLUG = LIBRARY_KEY ? (LIBRARY_SLUGS[LIBRARY_KEY] || LIBRARY_KEY) : '';
  var TARGET_ID = script.getAttribute('data-target') || 'sl-embed';
  var HEIGHT = script.getAttribute('data-height') || '100vh';

  if (!COLLECTION && !LIBRARY_SLUG) {
    console.error('[SourceLibrary] data-collection or data-library is required on the embed script tag.');
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
  function buildInitialSrc() {
    var book = getURLParam('book');
    var page = getURLParam('page');

    if (book && page) {
      return BASE_URL + '/book/' + encodeURIComponent(book) + '/page/' + encodeURIComponent(page);
    }
    if (book) {
      return BASE_URL + '/book/' + encodeURIComponent(book);
    }
    if (LIBRARY_SLUG) {
      return BASE_URL + '/libraries/' + encodeURIComponent(LIBRARY_SLUG) + '?view=books';
    }
    return BASE_URL + '/collections/' + encodeURIComponent(COLLECTION);
  }

  // --- Render ---
  function render(container) {
    injectStyles();

    var wrap = document.createElement('div');
    wrap.id = 'sl-iframe-wrap';
    wrap.style.height = HEIGHT;

    var iframe = document.createElement('iframe');
    iframe.id = 'sl-embed-iframe';
    iframe.src = buildInitialSrc();
    iframe.style.height = HEIGHT;
    iframe.setAttribute('allowfullscreen', '');
    iframe.setAttribute('title', 'Source Library');

    wrap.appendChild(iframe);
    container.appendChild(wrap);

    // --- postMessage listener ---
    // Source Library pages send navigation events so we can keep
    // the host page URL in sync (shareability + back button).
    window.addEventListener('message', function (event) {
      // Only accept messages from the Source Library origin
      if (event.origin !== BASE_URL) return;

      var data = event.data;
      if (!data || data.type !== 'sl-navigate') return;

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
