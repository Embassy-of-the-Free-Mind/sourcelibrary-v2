import type { Metadata } from 'next';
import Script from 'next/script';

// The Picture Map: every picture in the library as one point, placed by visual likeness (CLIP
// vectors laid out with UMAP), zooming in until the points become the pictures. Fully static: the
// engine (public/picture-map/engine.js) fetches its data from images.sourcelibrary.org/picture-map/v1/.
// Built in latent-walks (build_map_site.py); this page only hosts it.

export const metadata: Metadata = {
  title: 'Picture Map',
  description: 'Every picture in Source Library on one map, placed near the pictures it resembles. Zoom in until the pictures appear, or search by what is in them.',
  alternates: { canonical: '/gallery/map' },
};

const MARKUP = "<canvas id=\"c\"></canvas>\n<div id=\"thumbs\"></div>\n<div class=\"hud\" id=\"title\"><h1>Picture Map</h1>\n  <p id=\"sub\">Every picture in Source Library, each one a point, placed near the pictures it resembles.</p></div>\n<div class=\"hud\" id=\"search\"><input id=\"q\" placeholder=\"Search by what is in the picture: serpent, furnace, stars\u2026\" autocomplete=\"off\"><span id=\"count\"></span></div>\n<div class=\"hud\" id=\"chips\"></div>\n<a href=\"/\" title=\"Source Library\"><img class=\"hud\" id=\"logo\" src=\"/brand/svg/logo-full--white-on-dark.svg\" alt=\"Source Library\"></a>\n<div class=\"hud\" id=\"hint\">Scroll to zoom in until the pictures appear \u00b7 drag to move \u00b7 click a picture to open it</div>\n<div class=\"hud\" id=\"tip\"><img alt=\"\"><div></div></div>\n<div class=\"hud\" id=\"panel\"><button id=\"close\" title=\"Close\">\u00d7</button><img id=\"pimg\" alt=\"\"><h2 id=\"ptitle\"></h2><p id=\"pdesc\"></p>\n  <a id=\"plink\" target=\"_blank\" rel=\"noopener\">Open on sourcelibrary.org</a><a id=\"pdive\">Dive in from here</a><a id=\"pnear\" href=\"#\">Show similar</a></div>\n<div class=\"hud\" id=\"msg\">drawing the map\u2026</div>\n";

export default function PictureMapPage() {
  return (
    <>
      <link rel="stylesheet" href="/picture-map/style.css" precedence="default" />
      <div id="pm" dangerouslySetInnerHTML={{ __html: MARKUP }} />
      <Script src="/picture-map/engine.js" strategy="afterInteractive" />
    </>
  );
}
