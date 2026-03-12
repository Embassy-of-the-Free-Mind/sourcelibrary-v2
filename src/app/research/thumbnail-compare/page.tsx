/* eslint-disable @next/next/no-img-element */
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Thumbnail Quality Comparison',
  robots: 'noindex',
};

// Diverse gallery images across types, books, and bbox sizes
const images = [
  // Frontispieces (large bbox)
  { thumb: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6953e55777f38f6761bf05cf/6953e55877f38f6761bf060a-0-thumb.jpg', full: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6953e55777f38f6761bf05cf/6953e55877f38f6761bf060a-0.jpg', desc: 'Druid stone circle engraving', book: 'Stonehenge', type: 'frontispiece', bw: 0.67 },
  { thumb: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6953e55777f38f6761bf05cf/6953e55777f38f6761bf05d1-0-thumb.jpg', full: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6953e55777f38f6761bf05cf/6953e55777f38f6761bf05d1-0.jpg', desc: 'Anatomical dissection scene', book: 'De Humani Corporis Fabrica', type: 'frontispiece', bw: 1.0 },

  // Emblems (medium bbox)
  { thumb: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/69520c46ab34727b1f044141/69520c46ab34727b1f044158-0-thumb.jpg', full: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/69520c46ab34727b1f044141/69520c46ab34727b1f044158-0.jpg', desc: 'Pelican hermetic emblem', book: 'Atalanta fugiens', type: 'emblem', bw: 0.31 },
  { thumb: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6975158ba88d83c830d99e24/697627ff392c2251e0d13990-0-thumb.jpg', full: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6975158ba88d83c830d99e24/697627ff392c2251e0d13990-0.jpg', desc: 'Allegorical title engraving', book: 'Atalanta fugiens', type: 'emblem', bw: 0.45 },

  // Woodcuts (medium-large bbox)
  { thumb: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/69906f694b3bd4d1fffd0b26/69906f6a4b3bd4d1fffd0b61-3-thumb.jpg', full: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/69906f694b3bd4d1fffd0b26/69906f6a4b3bd4d1fffd0b61-3.jpg', desc: 'Acephalous monsters (Blemmyes)', book: 'Bodleian MS', type: 'woodcut', bw: 0.22 },
  { thumb: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6953ccb377f38f6761be31c1/6953ccb477f38f6761be31d4-0-thumb.jpg', full: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6953ccb377f38f6761be31c1/6953ccb477f38f6761be31d4-0.jpg', desc: 'Botanical taproot', book: 'Voynich Manuscript', type: 'woodcut', bw: 0.85 },

  // Diagrams (large bbox)
  { thumb: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6991e953efe0293c6e9e9df9/6991e953efe0293c6e9e9e6b-0-thumb.jpg', full: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6991e953efe0293c6e9e9df9/6991e953efe0293c6e9e9e6b-0.jpg', desc: 'Leonardo perspective diagram', book: 'Trattato della pittura', type: 'diagram', bw: 0.85 },
  { thumb: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6991e953efe0293c6e9e9df9/6991e953efe0293c6e9e9eb1-1-thumb.jpg', full: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6991e953efe0293c6e9e9df9/6991e953efe0293c6e9e9eb1-1.jpg', desc: 'Da Vinci mechanical sketches', book: 'Trattato della pittura', type: 'diagram', bw: 0.55 },

  // Engravings (medium-large bbox)
  { thumb: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6952d0fa77f38f6761bc5aef/6952d0fa77f38f6761bc5b39-0-thumb.jpg', full: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6952d0fa77f38f6761bc5aef/6952d0fa77f38f6761bc5b39-0.jpg', desc: 'Astronomical sextant', book: 'Instruments of Astronomy', type: 'engraving', bw: 0.69 },
  { thumb: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6953e55777f38f6761bf05cf/6953e55877f38f6761bf0726-0-thumb.jpg', full: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6953e55777f38f6761bf05cf/6953e55877f38f6761bf0726-0.jpg', desc: 'Nervous system anatomy', book: 'De Humani Corporis Fabrica', type: 'engraving', bw: 0.53 },

  // Portrait (full-page)
  { thumb: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6952dac277f38f6761bc66b0/6952dac277f38f6761bc66cb-0-thumb.jpg', full: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6952dac277f38f6761bc66b0/6952dac277f38f6761bc66cb-0.jpg', desc: 'Full body proportions study', book: 'Dürer Symmetry', type: 'portrait', bw: 0.75 },

  // Kepler planetary spheres (geometric)
  { thumb: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6952d12e77f38f6761bc5bec/6952d12f77f38f6761bc5d02-0-thumb.jpg', full: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6952d12e77f38f6761bc5bec/6952d12f77f38f6761bc5d02-0.jpg', desc: 'Planetary spheres model', book: 'Kepler Harmonices Mundi', type: 'diagram', bw: 0.40 },

  // Clockwork
  { thumb: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6955d43928a09ca6592805b3/6955d43928a09ca6592805cb-0-thumb.jpg', full: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6955d43928a09ca6592805b3/6955d43928a09ca6592805cb-0.jpg', desc: 'Clockwork mechanism', book: 'Horologium Oscillatorium', type: 'engraving', bw: 0.46 },

  // Small decorative initials (BAD examples — what the homepage filter should exclude)
  { thumb: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6953e55777f38f6761bf05cf/6953e55777f38f6761bf0805-0-thumb.jpg', full: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/6953e55777f38f6761bf05cf/6953e55777f38f6761bf0805-0.jpg', desc: 'Historiated initial C (tiny)', book: 'De Humani Corporis Fabrica', type: 'decorative', bw: 0.07 },
  { thumb: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/adefe2d5-88a7-4595-9885-903a93abee51/69500535f426a210d109f8bd-0-thumb.jpg', full: 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/gallery/adefe2d5-88a7-4595-9885-903a93abee51/69500535f426a210d109f8bd-0.jpg', desc: 'Initial O with portrait (tiny)', book: 'Plato Complete Works', type: 'decorative', bw: 0.08 },
];

function GalleryGrid({ items, label }: { items: typeof images; label: string }) {
  return (
    <div className="mb-10">
      <h3 className="text-sm font-medium text-secondary mb-3 uppercase tracking-wide">
        {label} <span className="text-muted font-normal normal-case">(aspect-square, object-contain — used on /gallery)</span>
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {items.map((img, i) => (
          <a key={i} href={img.full} target="_blank" rel="noopener noreferrer" className="group">
            <div className="relative aspect-square bg-stone-100 rounded-lg overflow-hidden border border-border-light hover:border-accent-rust/40 transition-all hover:shadow-md">
              <img
                src={img.thumb}
                alt={img.desc}
                className="absolute inset-0 w-full h-full object-contain group-hover:scale-105 transition-transform duration-300"
              />
              <span className="absolute top-1 left-1 text-[10px] bg-accent-rust/80 text-white px-1.5 py-0.5 rounded leading-none">
                {img.type}
              </span>
              <span className="absolute bottom-1 right-1 text-[10px] bg-dark/70 text-white px-1.5 py-0.5 rounded leading-none">
                {Math.round(img.bw * 100)}%
              </span>
            </div>
            <p className="text-xs text-secondary mt-1.5 truncate">{img.desc}</p>
            <p className="text-[10px] text-muted truncate">{img.book}</p>
          </a>
        ))}
      </div>
    </div>
  );
}

function HomepageGrid({ items, label, useFull }: { items: typeof images; label: string; useFull: boolean }) {
  return (
    <div className="mb-10">
      <h3 className="text-sm font-medium text-secondary mb-3 uppercase tracking-wide">
        {label} <span className="text-muted font-normal normal-case">(aspect-3/4, object-cover — homepage &quot;From the Collection&quot;)</span>
      </h3>
      <p className="text-xs text-muted mb-3">
        Using: <code className="bg-warm px-1 py-0.5 rounded">{useFull ? 'extracted_url (full crop)' : 'thumbnail_url (300px)'}</code>
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 lg:gap-5">
        {items.map((img, i) => (
          <a key={i} href={img.full} target="_blank" rel="noopener noreferrer" className="group">
            <div className="relative aspect-[3/4] bg-cream rounded-lg overflow-hidden border border-border-light hover:border-accent-rust/40 transition-all hover:shadow-md">
              <img
                src={useFull ? img.full : img.thumb}
                alt={img.desc}
                className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
              <span className="absolute top-1.5 left-1.5 text-[10px] bg-accent-rust/80 text-white px-1.5 py-0.5 rounded leading-none">
                {img.type}
              </span>
              <span className="absolute bottom-1.5 right-1.5 text-[10px] bg-dark/70 text-white px-1.5 py-0.5 rounded leading-none">
                {Math.round(img.bw * 100)}%
              </span>
            </div>
            <p className="text-xs text-secondary mt-1.5 truncate">{img.desc}</p>
            <p className="text-[10px] text-muted truncate">{img.book}</p>
          </a>
        ))}
      </div>
    </div>
  );
}

export default function ThumbnailComparePage() {
  const good = images.filter(img => img.bw >= 0.1);
  const bad = images.filter(img => img.bw < 0.1);

  return (
    <div className="min-h-screen bg-cream">
      <div className="max-w-6xl mx-auto px-6 py-10">
        <h1 className="text-3xl font-display text-primary mb-2">Gallery Image Quality Comparison</h1>
        <p className="text-muted mb-10 max-w-3xl">
          Diverse gallery images across types (frontispiece, emblem, woodcut, diagram, engraving, portrait) and bounding box sizes.
          The homepage &quot;From the Collection&quot; now uses <code className="text-xs bg-warm px-1 py-0.5 rounded">extracted_url</code> (full-size crop) instead of <code className="text-xs bg-warm px-1 py-0.5 rounded">thumbnail_url</code> (300px).
          It also filters out decorative initials, symbols, and images with bbox &lt; 10%.
        </p>

        {/* Section 1: Good images */}
        <div className="mb-16">
          <h2 className="text-2xl font-display text-primary mb-6">Good Images (bbox &ge; 10%)</h2>

          <GalleryGrid items={good} label="Gallery Grid (thumbnail_url)" />

          <HomepageGrid items={good} label="Homepage — OLD (thumbnail_url 300px)" useFull={false} />

          <HomepageGrid items={good} label="Homepage — NEW (extracted_url full crop)" useFull={true} />
        </div>

        <hr className="border-border-light mb-16" />

        {/* Section 2: Bad examples that should be filtered */}
        <div className="mb-16">
          <h2 className="text-2xl font-display text-primary mb-2">Filtered Out (bbox &lt; 10%)</h2>
          <p className="text-sm text-muted mb-6">These tiny decorative initials are now excluded from the homepage showcase by the new <code className="text-xs bg-warm px-1 py-0.5 rounded">bbox.width &ge; 0.1</code> filter.</p>

          <GalleryGrid items={bad} label="Gallery Grid (still shown in gallery)" />

          <HomepageGrid items={bad} label="Homepage — would look like this (now filtered)" useFull={false} />
        </div>

        <div className="mt-8 p-5 bg-warm rounded-lg text-sm text-secondary">
          <strong>Changes made:</strong>
          <ul className="list-disc ml-5 mt-2 space-y-1">
            <li><code className="text-xs bg-cream px-1 py-0.5 rounded">getCollectionShowcase()</code> now passes <code className="text-xs bg-cream px-1 py-0.5 rounded">extracted_url</code> to the frontend (was missing, always fell back to 300px thumbnail)</li>
            <li>Homepage excludes decorative, symbol, musical_score, exlibris, bookplate types</li>
            <li>Homepage requires <code className="text-xs bg-cream px-1 py-0.5 rounded">bbox.width &ge; 0.1</code> (at least 10% of page width)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
