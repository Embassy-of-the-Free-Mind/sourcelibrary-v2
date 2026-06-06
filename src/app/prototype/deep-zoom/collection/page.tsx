import type { Metadata } from 'next';
import Link from 'next/link';
import DeepZoomViewer, { type DeepZoomItem } from '../DeepZoomViewer';

export const metadata: Metadata = {
  title: 'Bosch & Bruegel in deep zoom — prototype · Source Library',
  description:
    'A prototype of a collection page rendered as a deep-zoom gallery, with high-resolution Bosch and Bruegel masterpieces.',
  robots: { index: false, follow: false },
};

const COMMONS = 'https://commons.wikimedia.org/wiki/File:';

/**
 * Prototype only. Tile pyramids live in R2 under `deepzoom/<id>/`, downscaled
 * to ~8000px from the gigapixel Wikimedia Commons masters (Google Art Project /
 * Prado releases) and cut with sharp. Dimensions below are the exact tiled
 * sizes — they must match the pyramid or OpenSeadragon mis-requests edge tiles.
 */
const ITEMS: DeepZoomItem[] = [
  {
    id: 'bruegel-babel',
    title: 'The Tower of Babel',
    book: 'Pieter Bruegel the Elder · 1563 · Kunsthistorisches Museum, Vienna',
    width: 8000,
    height: 5854,
    tileSize: 256,
    overlap: 1,
    format: 'jpeg',
    tileBase: 'https://images.sourcelibrary.org/deepzoom/bruegel-babel',
    source: `${COMMONS}Pieter_Bruegel_the_Elder_-_The_Tower_of_Babel_(Vienna)_-_Google_Art_Project_-_edited.jpg`,
    blurb:
      'Zoom into the spiralling tower to find the thousands of labourers, cranes, and scaffolds — and the king inspecting the works at lower left. Each window and arch is individually drawn.',
  },
  {
    id: 'bosch-garden',
    title: 'The Garden of Earthly Delights',
    book: 'Hieronymus Bosch · c. 1490–1510 · Museo del Prado',
    width: 8000,
    height: 4554,
    tileSize: 256,
    overlap: 1,
    format: 'jpeg',
    tileBase: 'https://images.sourcelibrary.org/deepzoom/bosch-garden',
    source: `${COMMONS}The_Garden_of_Earthly_Delights_by_Bosch_High_Resolution.jpg`,
    blurb:
      'The whole triptych at once — then zoom into the central panel’s crowds, or the burning hell on the right with its tree-man and music-torture. Detail invisible at any printed scale.',
  },
  {
    id: 'bruegel-hunters',
    title: 'Hunters in the Snow (Winter)',
    book: 'Pieter Bruegel the Elder · 1565 · Kunsthistorisches Museum, Vienna',
    width: 6819,
    height: 4853,
    tileSize: 256,
    overlap: 1,
    format: 'jpeg',
    tileBase: 'https://images.sourcelibrary.org/deepzoom/bruegel-hunters',
    source: `${COMMONS}Pieter_Bruegel_the_Elder_-_Hunters_in_the_Snow_(Winter)_-_Google_Art_Project.jpg`,
    blurb:
      'Follow the hunters and their dogs down the ridge, then zoom across the valley to the skaters on the frozen ponds and the bird trap — a whole winter world in one frame.',
  },
  {
    id: 'bruegel-proverbs',
    title: 'Netherlandish Proverbs',
    book: 'Pieter Bruegel the Elder · 1559 · Gemäldegalerie, Berlin',
    width: 5649,
    height: 4000,
    tileSize: 256,
    overlap: 1,
    format: 'jpeg',
    tileBase: 'https://images.sourcelibrary.org/deepzoom/bruegel-proverbs',
    source: `${COMMONS}Pieter_Brueghel_the_Elder_-_The_Dutch_Proverbs_-_Google_Art_Project.jpg`,
    blurb:
      'More than a hundred proverbs acted out across one village. Zoom in to find “banging your head against a brick wall,” “armed to the teeth,” and the man casting roses before swine.',
  },
  {
    id: 'bosch-haywain',
    title: 'The Haywain Triptych',
    book: 'Hieronymus Bosch · c. 1516 · Museo del Prado',
    width: 8000,
    height: 5263,
    tileSize: 256,
    overlap: 1,
    format: 'jpeg',
    tileBase: 'https://images.sourcelibrary.org/deepzoom/bosch-haywain',
    source: `${COMMONS}Bosch_-_Haywain_Triptych.jpg`,
    blurb:
      'A whole world grasping for hay. Zoom into the procession behind the wagon, the demons hauling it toward hell, and the tiny figures clambering over the load.',
  },
];

export default function DeepZoomCollectionPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">
          Prototype · collection
        </p>
        <h1 className="mt-1 text-3xl font-semibold text-stone-900">
          Bosch &amp; Bruegel — the close look
        </h1>
        <p className="mt-3 max-w-2xl leading-relaxed text-stone-600">
          A collection page rendered as a deep-zoom gallery. Bosch and Bruegel
          painted worlds you have to lean into — thousands of tiny figures, each
          one a scene. Page through the works like the gallery, then zoom all
          the way into the original to find them. Masters here are
          high-resolution scans (Google Art Project / Prado), streamed in tiles
          so even a panel sized for a museum wall stays sharp on screen.
        </p>
        <p className="mt-2 text-sm text-stone-500">
          A deep-zoom treatment for an art collection such as{' '}
          <Link href="/collections/art-illustrated" className="underline hover:text-stone-700">
            Art &amp; Illustrated Books
          </Link>
          . See also the{' '}
          <Link href="/prototype/deep-zoom" className="underline hover:text-stone-700">
            mixed deep-zoom demo
          </Link>
          .
        </p>
      </header>

      <DeepZoomViewer items={ITEMS} />

      <section className="mt-8 max-w-2xl text-sm leading-relaxed text-stone-500">
        <h2 className="mb-1 font-medium text-stone-700">Notes</h2>
        <p>
          The masters are public-domain gigapixel scans from Wikimedia Commons,
          downscaled to ~8,000px and cut into 256-px DZI tiles (via{' '}
          <code className="rounded bg-stone-100 px-1">sharp</code>), served from
          our image CDN. In production these would be tiled by the
          image-extraction pipeline and any collection could opt into this
          deep-zoom presentation.
        </p>
      </section>
    </main>
  );
}
