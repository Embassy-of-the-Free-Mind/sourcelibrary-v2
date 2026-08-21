/* eslint-disable @next/next/no-img-element */
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Thumbnail Quality Comparison',
  robots: 'noindex',
};

// Diverse gallery images across types, books, and bbox sizes — all verified on Vercel Blob
const images = [
  // Frontispieces (large bbox)
  { thumb: 'https://images.sourcelibrary.org/gallery/6ff1a28b-f7cd-4fcd-8d08-77d2f7818be1/695004d8f426a210d1099e4b-0-thumb.jpg', full: 'https://images.sourcelibrary.org/gallery/6ff1a28b-f7cd-4fcd-8d08-77d2f7818be1/695004d8f426a210d1099e4b-0.jpg', desc: 'Vesalius anatomical dissection scene', book: 'De Humani Corporis Fabrica (1555)', type: 'frontispiece', bw: 1.0 },
  { thumb: 'https://images.sourcelibrary.org/gallery/69906623ef12272ffdc952c7/69906624ef12272ffdc952ce-0-thumb.jpg', full: 'https://images.sourcelibrary.org/gallery/69906623ef12272ffdc952c7/69906624ef12272ffdc952ce-0.jpg', desc: 'Hobbes Leviathan sovereign figure', book: 'Leviathan (1651)', type: 'frontispiece', bw: 0.96 },

  // Emblems (medium-large bbox)
  { thumb: 'https://images.sourcelibrary.org/gallery/6952dbf977f38f6761bc7720/695906d94953388fe7ac7538-0-thumb.jpg', full: 'https://images.sourcelibrary.org/gallery/6952dbf977f38f6761bc7720/695906d94953388fe7ac7538-0.jpg', desc: 'Alchemical emblem from Splendor Solis', book: 'Splendor Solis', type: 'emblem', bw: 0.72 },
  { thumb: 'https://images.sourcelibrary.org/gallery/6952dbf977f38f6761bc7720/695906d94953388fe7ac755c-0-thumb.jpg', full: 'https://images.sourcelibrary.org/gallery/6952dbf977f38f6761bc7720/695906d94953388fe7ac755c-0.jpg', desc: 'Splendor Solis Plate 16 reproduction', book: 'Splendor Solis', type: 'emblem', bw: 0.75 },

  // Woodcuts (medium-large bbox)
  { thumb: 'https://images.sourcelibrary.org/gallery/6952dac277f38f6761bc66b0/6952dac277f38f6761bc67a8-0-thumb.jpg', full: 'https://images.sourcelibrary.org/gallery/6952dac277f38f6761bc66b0/6952dac277f38f6761bc67a8-0.jpg', desc: 'Anatomical woodcut, two male figures', book: 'On the Symmetry of Human Bodies', type: 'woodcut', bw: 0.85 },
  { thumb: 'https://images.sourcelibrary.org/gallery/6952dac277f38f6761bc66b0/6952dac277f38f6761bc67ae-0-thumb.jpg', full: 'https://images.sourcelibrary.org/gallery/6952dac277f38f6761bc66b0/6952dac277f38f6761bc67ae-0.jpg', desc: 'Female figure anatomical study', book: 'On the Symmetry of Human Bodies', type: 'woodcut', bw: 0.73 },

  // Diagrams
  { thumb: 'https://images.sourcelibrary.org/gallery/6952d12e77f38f6761bc5bec/6952d12f77f38f6761bc5d02-0-thumb.jpg', full: 'https://images.sourcelibrary.org/gallery/6952d12e77f38f6761bc5bec/6952d12f77f38f6761bc5d02-0.jpg', desc: 'Kepler planetary spheres model', book: 'Harmony of the World', type: 'diagram', bw: 0.40 },
  { thumb: 'https://images.sourcelibrary.org/gallery/6952dac277f38f6761bc66b0/6952dac277f38f6761bc6751-0-thumb.jpg', full: 'https://images.sourcelibrary.org/gallery/6952dac277f38f6761bc66b0/6952dac277f38f6761bc6751-0.jpg', desc: 'Female proportion studies (Dürer)', book: 'On the Symmetry of Human Bodies', type: 'diagram', bw: 0.78 },

  // Engravings (large bbox)
  { thumb: 'https://images.sourcelibrary.org/gallery/6952d0fa77f38f6761bc5aef/6952d0fa77f38f6761bc5b56-0-thumb.jpg', full: 'https://images.sourcelibrary.org/gallery/6952d0fa77f38f6761bc5aef/6952d0fa77f38f6761bc5b56-0.jpg', desc: 'Uraniborg observatory elevation', book: 'Instruments of the Restored Astronomy', type: 'engraving', bw: 0.95 },
  { thumb: 'https://images.sourcelibrary.org/gallery/6952dac677f38f6761bc683a/6952dac677f38f6761bc6847-0-thumb.jpg', full: 'https://images.sourcelibrary.org/gallery/6952dac677f38f6761bc683a/6952dac677f38f6761bc6847-0.jpg', desc: 'Integra Naturae Speculum (Fludd)', book: 'History of Both Worlds: Macrocosm', type: 'engraving', bw: 0.91 },

  // Portraits
  { thumb: 'https://images.sourcelibrary.org/gallery/6952587bab34727b1f045546/6959068695a91542b28bd761-0-thumb.jpg', full: 'https://images.sourcelibrary.org/gallery/6952587bab34727b1f045546/6959068695a91542b28bd761-0.jpg', desc: 'Michael Maier alchemist portrait', book: 'Symbola aureae mensae', type: 'portrait', bw: 0.80 },
  { thumb: 'https://images.sourcelibrary.org/gallery/6991e93135ed50020acc1458/6991e93135ed50020acc1460-0-thumb.jpg', full: 'https://images.sourcelibrary.org/gallery/6991e93135ed50020acc1458/6991e93135ed50020acc1460-0.jpg', desc: 'Leonardo da Vinci self-portrait', book: 'Notebooks of Leonardo da Vinci', type: 'portrait', bw: 0.83 },

  // Monas Hieroglyphica (frontispiece — different book for variety)
  { thumb: 'https://images.sourcelibrary.org/gallery/69520571ab34727b1f042c78/69520572ab34727b1f042c7a-0-thumb.jpg', full: 'https://images.sourcelibrary.org/gallery/69520571ab34727b1f042c78/69520572ab34727b1f042c7a-0.jpg', desc: 'John Dee Monas Hieroglyphica title page', book: 'Monas Hieroglyphica', type: 'frontispiece', bw: 0.87 },

  // Small decorative initials (BAD examples — what the homepage filter should exclude)
  { thumb: 'https://images.sourcelibrary.org/gallery/e532b010-6d2e-40ca-9f95-c67e74c5ee61/695004b4f426a210d10975b1-0-thumb.jpg', full: 'https://images.sourcelibrary.org/gallery/e532b010-6d2e-40ca-9f95-c67e74c5ee61/695004b4f426a210d10975b1-0.jpg', desc: 'Ornate initial S (tiny)', book: 'Instruction in Measurement', type: 'decorative', bw: 0.04 },
  { thumb: 'https://images.sourcelibrary.org/gallery/25dfd63a-8080-4864-aa79-a0fcb1c76102/695004c9f426a210d109890a-1-thumb.jpg', full: 'https://images.sourcelibrary.org/gallery/25dfd63a-8080-4864-aa79-a0fcb1c76102/695004c9f426a210d109890a-1.jpg', desc: 'Initial G with decoration (tiny)', book: 'Landino: Dante Commentary (1481)', type: 'decorative', bw: 0.04 },
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
      <div className="max-w-[1500px] mx-auto px-6 py-10">
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
