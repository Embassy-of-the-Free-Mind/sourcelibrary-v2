/**
 * Source Library reading room — host script (#5266).
 *
 * The block a room owner pastes (copied from sourcelibrary.org/rooms/manage/<slug>):
 *
 *   <iframe class="sl-room" src="https://sourcelibrary.org/rooms/<slug>" data-room="<slug>" …></iframe>
 *   <p><a class="sl-room-open" href="https://sourcelibrary.org/rooms/<slug>" …>Open … in its own window</a></p>
 *   <script src="https://sourcelibrary.org/rooms/embed.js" defer></script>
 *
 * What it does for every `iframe.sl-room[data-room]` on the page:
 *  - grows the frame to fit the shelf and the book page (no scrollbar inside a scrollbar);
 *  - when the room's reader opens, lifts the frame to fill the window (`modal-open`) and drops it
 *    back when the reader closes (`modal-close`) — the same messages and `source: "source-library"`
 *    tag as the Source Bridge component embeds, so one host script serves both;
 *  - keeps `?room=book/<slug>[/page/<id>]` in the host page's address, one history entry per step,
 *    so Back / Forward / refresh return to the same page of the same book.
 *
 * Optional attributes on the iframe: `data-param` (query key, default "room"), `data-origin`
 * (default: the iframe src's origin).
 *
 * History rules (measured 2026-09-30 on the yam packet; lesson in auto-memory
 * `lesson_iframe_full_navigation_owns_a_history_entry`):
 *  - The room's in-frame navigation is client-side, so it adds no joint history entry; this page
 *    pushes one entry per step and owns Back/Forward.
 *  - If `history.length` already grew (a full load inside the frame added a joint entry), write
 *    nothing — replaceState would rewrite the SHARED entry behind it too.
 *  - On popstate, steer the frame with `contentWindow.location.replace`, never `src=` (a src change
 *    on a loaded frame adds another joint entry). While traversing, ignore frame reports that differ
 *    from the expected place: the browser restores a stale in-frame URL of its own first.
 *
 * Reference host: the yam packet's reading room (sidequests/yam/index.html, §39).
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || !window.document) return;

  var SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;
  var PATH_RE = /^book\/[A-Za-z0-9_-]+(\/page\/[A-Za-z0-9_-]+)?$/;
  var MIN_HEIGHT = 560;
  var MAX_HEIGHT = 16000;
  var TRAVERSE_MS = 4000;

  function roomPath(book, page) {
    return book ? 'book/' + book + (page ? '/page/' + page : '') : '';
  }

  function init(frame) {
    if (frame.getAttribute('data-sl-room-ready')) return;
    var slug = frame.getAttribute('data-room') || '';
    if (!SLUG_RE.test(slug)) return;
    frame.setAttribute('data-sl-room-ready', '1');

    var origin = frame.getAttribute('data-origin');
    if (!origin) {
      try { origin = new URL(frame.getAttribute('src') || '', location.href).origin; } catch (e) { origin = ''; }
    }
    if (!origin || origin === 'null') origin = 'https://sourcelibrary.org';
    var key = frame.getAttribute('data-param') || 'room';
    var ROOM = origin + '/rooms/' + slug;
    var open = findOpenLink(frame, ROOM);

    var inReader = false, current = '', reported = '', lastLen = history.length, traversing = 0;
    var lastHeight = 0, lifted = false, savedStyle = '', savedOverflow = '';

    function urlFor(path) { return path ? ROOM + '/' + path : ROOM; }
    function setOpen(path) { if (open) open.href = urlFor(path); }

    function setHeight(h) {
      if (typeof h === 'number' && h > 0) lastHeight = h;
      if (lifted) return;
      // Outside the reader the frame is as tall as its content; inside, the reader owns its own
      // viewport, so the frame locks to the window instead of growing.
      if (inReader) { frame.style.height = Math.max(MIN_HEIGHT, Math.round(window.innerHeight * 0.92)) + 'px'; return; }
      frame.style.height = Math.min(Math.max(MIN_HEIGHT, Math.ceil(lastHeight || MIN_HEIGHT)), MAX_HEIGHT) + 'px';
    }

    function lift() {
      if (lifted) return;
      savedStyle = frame.getAttribute('style') || '';
      savedOverflow = document.documentElement.style.overflow;
      frame.setAttribute('style', 'position:fixed;inset:0;width:100vw;height:100vh;z-index:2147483647;border:0;margin:0;display:block;background:#fff');
      document.documentElement.style.overflow = 'hidden';
      lifted = true;
    }
    function drop() {
      if (!lifted) return;
      frame.setAttribute('style', savedStyle);
      document.documentElement.style.overflow = savedOverflow;
      lifted = false;
      setHeight();
    }

    function scrollToFrame(smooth) {
      var top = frame.getBoundingClientRect().top;
      if (top < 0 || top > 80) frame.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
    }

    function writeUrl(path) {
      // A full page load inside the frame already added an entry this page cannot suppress, and
      // replaceState would rewrite the shared entry behind it too. Leave history alone then.
      if (history.length > lastLen) { lastLen = history.length; return; }
      var u = new URL(location.href);
      if (path) u.searchParams.set(key, path); else u.searchParams.delete(key);
      history.pushState({ slRoom: key, path: path }, '', u.toString());
      lastLen = history.length;
    }

    // Deep link on arrival: ?room=book/<slug>[/page/<id>] starts the frame there.
    var start = new URLSearchParams(location.search).get(key);
    if (start && PATH_RE.test(start)) {
      current = start;
      inReader = start.indexOf('/page/') !== -1;
      frame.src = urlFor(start);
      setOpen(start);
      if (!location.hash) setTimeout(function () { frame.scrollIntoView({ block: 'start' }); }, 50);
    }
    setHeight();

    function onNavigate(path, page) {
      var wasReader = inReader;
      reported = path;
      if (traversing) {
        // Only the expected place ends a traversal; a differing report is the browser's own
        // stale restore inside the frame, not a click.
        if (path === current) { clearTimeout(traversing); traversing = 0; inReader = !!page; setHeight(); }
        return;
      }
      inReader = !!page;
      if (!inReader && lifted) drop();
      if (path === current) { if (inReader !== wasReader) setHeight(); return; }
      current = path;
      setOpen(path);
      writeUrl(path);
      if (inReader !== wasReader) setHeight();
      if (!lifted) scrollToFrame(true);
    }

    window.addEventListener('message', function (e) {
      if (e.source !== frame.contentWindow || e.origin !== origin) return;
      var d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.source === 'source-library') {
        if (d.type === 'modal-open') lift();
        else if (d.type === 'modal-close') drop();
        else if (d.type === 'resize' && typeof d.height === 'number') setHeight(d.height);
        return;
      }
      if (d.type === 'sl-resize' && typeof d.height === 'number') { setHeight(d.height); return; }
      if (d.type === 'sl-navigate') {
        var book = typeof d.book === 'string' ? d.book : '';
        var page = book && typeof d.page === 'string' ? d.page : '';
        onNavigate(roomPath(book, page), page);
      }
    });

    window.addEventListener('popstate', function () {
      var p = new URLSearchParams(location.search).get(key) || '';
      var path = PATH_RE.test(p) ? p : '';
      if (path === current) return;
      current = path;
      inReader = path.indexOf('/page/') !== -1;
      lastLen = history.length;
      setOpen(path);
      if (!inReader && lifted) drop();
      setHeight();
      if (reported === path) return;
      // This page owns history: steer the frame to the step's place at once.
      clearTimeout(traversing);
      traversing = setTimeout(function () { traversing = 0; }, TRAVERSE_MS);
      try { frame.contentWindow.location.replace(urlFor(path)); } catch (err) { frame.src = urlFor(path); }
    });

    window.addEventListener('resize', function () { if (inReader) setHeight(); });
  }

  // The fallback link beneath the frame: the first a.sl-room-open after it, else any link to the room.
  function findOpenLink(frame, room) {
    var el = frame.nextElementSibling;
    for (var i = 0; el && i < 3; i++, el = el.nextElementSibling) {
      var a = el.matches && el.matches('a.sl-room-open') ? el : el.querySelector && el.querySelector('a.sl-room-open');
      if (a) return a;
    }
    var links = document.querySelectorAll('a.sl-room-open');
    for (var j = 0; j < links.length; j++) if (links[j].href.indexOf(room) === 0) return links[j];
    return null;
  }

  function initAll() {
    var frames = document.querySelectorAll('iframe.sl-room[data-room]');
    for (var i = 0; i < frames.length; i++) init(frames[i]);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAll);
  else initAll();
})();
