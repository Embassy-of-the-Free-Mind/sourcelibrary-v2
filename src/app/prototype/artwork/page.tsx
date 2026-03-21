import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import SiteHeader from '@/components/layout/SiteHeader';
import { Calendar, MapPin, Ruler, Palette, ExternalLink, BookOpen, ZoomIn, Heart, Share2, Quote } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Artwork Prototype — Source Library',
  description: 'Prototype for visual art pages in Source Library',
};

// ─── Real data ───────────────────────────────────────────────────────────────

const ARTWORKS = {
  'birth-of-venus': {
    title: 'The Birth of Venus',
    originalTitle: 'La nascita di Venere',
    artist: 'Sandro Botticelli',
    artistDates: '1445–1510',
    date: 'c. 1484–1486',
    medium: 'Tempera on canvas',
    dimensions: '172.5 × 278.9 cm (67.9 × 109.6 in)',
    location: 'Galleria degli Uffizi, Florence',
    resourceType: 'painting' as const,
    // Real Commons image — 30,000 × 18,840 px original
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/Sandro_Botticelli_-_La_nascita_di_Venere_-_Google_Art_Project_-_edited.jpg/2560px-Sandro_Botticelli_-_La_nascita_di_Venere_-_Google_Art_Project_-_edited.jpg',
    fullResUrl: 'https://commons.wikimedia.org/wiki/File:Sandro_Botticelli_-_La_nascita_di_Venere_-_Google_Art_Project_-_edited.jpg',
    license: 'Public Domain',
    wikidataId: 'Q81689',
    description: `Commissioned by Lorenzo di Pierfrancesco de' Medici — a member of Ficino's inner circle — this painting depicts Venus arriving at the shore on a scallop shell, blown by Zephyr and the nymph Chloris, while a Hora (personification of Spring) offers her a flowered cloak.

The iconography draws directly from Marsilio Ficino's commentary on Plato's *Symposium* (*De Amore*), representing the birth of divine beauty into the material world. In Ficino's Neoplatonic cosmology, Venus embodies the soul's first moment of awareness of divine beauty — *pulchritudo* descending from the intelligible to the sensible realm. The nudity of Venus is not erotic but philosophical: the soul arrives in the world without the coverings of matter, pure in its divine origin.

The pose follows the classical *Venus Pudica* (modest Venus), known from ancient Roman copies of Praxiteles' Aphrodite of Knidos. Botticelli likely studied the Medici collection of classical sculptures, reinterpreting pagan form through Christian Neoplatonic theology — a synthesis Ficino explicitly advocated.`,
    iconography: [
      { element: 'Venus on shell', significance: 'The soul\'s descent into matter — beauty born from the sea of generation (Ficino, De Amore V.8)', relatedBookSlug: 'commentary-on-symposium-ficino' },
      { element: 'Zephyr & Chloris', significance: 'Divine breath (spiritus) animating earthly form. Zephyr represents the intellectual love that draws the soul toward beauty' },
      { element: 'Hora offering cloak', significance: 'Modesty veiling divine beauty for the material world. The Horae are guardians of cosmic order in Neoplatonic theology' },
      { element: 'Venus Pudica pose', significance: 'Classical sculptural type (after Praxiteles), reinterpreted as Christian modesty — the soul\'s innate dignity' },
      { element: 'Roses', significance: 'Love\'s emanation from the divine. In Ficino\'s system, beauty begets love, love begets roses — the sensible sign of the intelligible' },
      { element: 'Orange grove', significance: 'Garden of the Hesperides — immortality and the golden age. The Medici associated oranges with their family emblem' },
      { element: 'Gold highlights', significance: 'Botticelli used gold leaf and gold-tinted paint to suggest the divine light (lumen) that Ficino describes as the medium of beauty\'s transmission' },
    ],
    relatedTexts: [
      { title: 'Commentary on Plato\'s Symposium (De Amore)', author: 'Marsilio Ficino', year: '1484', relationship: 'Direct philosophical source for the painting\'s iconography. Ficino\'s theory of beauty\'s emanation from the divine One → Intellect → Soul → Body is the conceptual program behind this painting.', slug: 'commentary-on-symposium-ficino', hasTranslation: true },
      { title: 'Letters to Lorenzo di Pierfrancesco de\' Medici', author: 'Marsilio Ficino', year: '1477–1492', relationship: 'Ficino wrote directly to the patron who commissioned this painting, describing Venus as a symbol of Humanitas — the harmonious union of all virtues.', slug: null, hasTranslation: false },
      { title: 'Stanze per la giostra', author: 'Angelo Poliziano', year: '1478', relationship: 'Poliziano\'s poem describing the birth of Venus from the sea foam directly inspired the composition. Poliziano was Ficino\'s colleague in the Medici circle.', slug: null, hasTranslation: false },
      { title: 'Platonic Theology (Theologia Platonica)', author: 'Marsilio Ficino', year: '1482', relationship: 'The systematic philosophical framework — soul as mediator between intelligible and sensible — that underlies Botticelli\'s entire mythological program.', slug: 'platonic-theology-ficino', hasTranslation: true },
      { title: 'Metamorphoses', author: 'Ovid', year: '8 CE', relationship: 'Classical source for the Venus birth narrative (IV.535–537), filtered through Neoplatonic allegorical reading.', slug: null, hasTranslation: false },
    ],
    provenance: 'Commissioned by Lorenzo di Pierfrancesco de\' Medici for the Villa di Castello. Remained in the Medici family collection until 1815 when it entered the Uffizi.',
    views: [
      { type: 'primary', caption: 'Full painting' },
      { type: 'detail', caption: 'Venus — face and hair', url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4f/Sandro_Botticelli_046.jpg/1024px-Sandro_Botticelli_046.jpg' },
      { type: 'detail', caption: 'Zephyr and Chloris', url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c9/Sandro_Botticelli_-_Zephyr_and_Chloris_%28detail%29.jpg/1024px-Sandro_Botticelli_-_Zephyr_and_Chloris_%28detail%29.jpg' },
    ],
  },
  'melencolia-i': {
    title: 'Melencolia I',
    originalTitle: 'Melencolia § I',
    artist: 'Albrecht Dürer',
    artistDates: '1471–1528',
    date: '1514',
    medium: 'Engraving',
    dimensions: '24.0 × 18.8 cm (9.4 × 7.4 in)',
    location: 'Multiple impressions worldwide',
    resourceType: 'print' as const,
    imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/D%C3%BCrer_Melencholia_I.jpg/1024px-D%C3%BCrer_Melencholia_I.jpg',
    fullResUrl: 'https://commons.wikimedia.org/wiki/File:D%C3%BCrer_Melencholia_I.jpg',
    license: 'Public Domain',
    wikidataId: 'Q132565',
    description: `The most enigmatic and intellectually dense print in Western art. A winged figure sits surrounded by tools of geometry, carpentry, and alchemy, yet appears paralyzed by thought — the creative intellect overwhelmed by the gap between what it can conceive and what it can realize.

Dürer created this engraving during the same period that Agrippa von Nettesheim was writing *De Occulta Philosophia*, which systematized the Renaissance understanding of melancholy as the temperament of genius. In Agrippa's framework (drawing on Ficino's *De Vita Triplici*), Saturn — the planet of melancholy — governs both the depths of depression and the heights of intellectual illumination.

The "I" in the title suggests this is the first stage of melancholy: *imaginatio* (imagination), the melancholy of artists and craftsmen. Agrippa described three stages corresponding to the three faculties of the soul: imagination, reason, and intellect. This print depicts the first — the figure has mastered geometry and craft but cannot yet ascend to pure reason or divine contemplation.`,
    iconography: [
      { element: 'Magic square (4×4)', significance: 'The sum of each row, column, and diagonal is 34. The bottom row reads 15-14 (the year). This is Jupiter\'s magic square — used in Agrippa\'s De Occulta Philosophia to counteract Saturn\'s malefic influence.' },
      { element: 'Polyhedron (truncated rhombohedron)', significance: 'A geometrically impossible solid — the limit of what *imaginatio* can conceive but not fully comprehend. The bridge to *ratio* (reason).' },
      { element: 'Compass and tools', significance: 'Instruments of geometry and craft — the domain of the first stage of melancholy. Mastered but insufficient for higher knowledge.' },
      { element: 'Winged figure', significance: 'The soul aspiring to ascend but weighed down. Wings represent the capacity for intellectual flight; the seated pose represents its frustration.' },
      { element: 'Hourglass and bell', significance: 'Time passing and the call to action — Saturn (Chronos) governs both melancholy and time.' },
      { element: 'Comet and rainbow', significance: 'Celestial phenomena — the macrocosm that the melancholic genius perceives but cannot fully penetrate.' },
      { element: 'Starving dog', significance: 'The body neglected by the contemplative mind. Also a traditional symbol of fidelity and melancholy.' },
      { element: 'Keys at waist', significance: 'The power to unlock knowledge — possessed but not yet used. Alchemical readings identify these as keys to the Great Work.' },
    ],
    relatedTexts: [
      { title: 'De Occulta Philosophia', author: 'Heinrich Cornelius Agrippa', year: '1533', relationship: 'The systematic framework for understanding melancholy as the temperament of genius. Agrippa\'s three grades of melancholic furor map directly to Dürer\'s "I" numbering.', slug: 'de-occulta-philosophia-agrippa', hasTranslation: true },
      { title: 'De Vita Triplici (Three Books on Life)', author: 'Marsilio Ficino', year: '1489', relationship: 'Ficino\'s medical-astrological treatise on the scholar\'s health — the original Renaissance text linking Saturn, melancholy, and intellectual genius.', slug: 'de-vita-triplici-ficino', hasTranslation: true },
      { title: 'Problemata XXX.1', author: 'Pseudo-Aristotle', year: 'c. 3rd century BCE', relationship: 'The ancient source: "Why is it that all those who have become eminent in philosophy or politics or poetry or the arts are clearly melancholic?"', slug: null, hasTranslation: false },
    ],
    provenance: 'One of Dürer\'s three "master engravings" (Meisterstiche) alongside Knight, Death, and the Devil and Saint Jerome in His Study. Impressions held at major print rooms worldwide.',
    views: [],
  },
};

// ─── Components ──────────────────────────────────────────────────────────────

function ArtworkBadge({ type }: { type: string }) {
  const labels: Record<string, string> = {
    painting: 'Painting',
    print: 'Print',
    drawing: 'Drawing',
    emblem: 'Emblem',
    manuscript: 'Manuscript',
  };
  const colors: Record<string, string> = {
    painting: 'bg-accent-violet/15 text-accent-violet border-accent-violet/25',
    print: 'bg-accent-rust/15 text-accent-rust border-accent-rust/25',
    drawing: 'bg-accent-sage/15 text-accent-sage border-accent-sage/25',
    emblem: 'bg-accent-gold/15 text-[#8b7340] border-accent-gold/25',
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 text-xs font-medium rounded-full border ${colors[type] || colors.painting}`}>
      {labels[type] || type}
    </span>
  );
}

function IconographyTable({ items }: { items: typeof ARTWORKS['birth-of-venus']['iconography'] }) {
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div key={i} className="flex gap-4 py-3 border-b last:border-0" style={{ borderColor: 'var(--border-light)' }}>
          <div className="flex-shrink-0 w-40 sm:w-48">
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{item.element}</span>
          </div>
          <div className="flex-1">
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{item.significance}</p>
            {'relatedBookSlug' in item && item.relatedBookSlug && (
              <span className="inline-flex items-center gap-1 mt-1 text-xs text-accent-rust">
                <BookOpen className="w-3 h-3" />
                Read the source text →
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function RelatedTexts({ texts }: { texts: typeof ARTWORKS['birth-of-venus']['relatedTexts'] }) {
  return (
    <div className="space-y-4">
      {texts.map((text, i) => (
        <div key={i} className="flex gap-4 p-4 rounded-lg" style={{ background: 'var(--bg-warm)' }}>
          <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: 'var(--accent-rust)', color: 'white' }}>
            {i + 1}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h4 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                  {text.title}
                </h4>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {text.author}, {text.year}
                </p>
              </div>
              {text.hasTranslation && text.slug && (
                <Link
                  href={`/book/${text.slug}`}
                  className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors"
                  style={{ background: 'var(--accent-rust)', color: 'white' }}
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  Read Translation
                </Link>
              )}
            </div>
            <p className="text-sm mt-2 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {text.relationship}
            </p>
            {!text.hasTranslation && (
              <p className="text-xs mt-2 italic" style={{ color: 'var(--text-muted)' }}>
                Not yet in Source Library
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function ArtworkCard({ artwork, id }: { artwork: typeof ARTWORKS['birth-of-venus']; id: string }) {
  return (
    <div id={id}>
      {/* Hero image */}
      <div className="relative bg-stone-900 overflow-hidden">
        <div className="max-w-[var(--container-wide)] mx-auto">
          <div className={`relative ${artwork.resourceType === 'painting' ? 'aspect-[16/9] sm:aspect-[2.2/1]' : 'aspect-[3/4] max-w-lg mx-auto'}`}>
            <Image
              src={artwork.imageUrl}
              alt={artwork.title}
              fill
              className="object-contain"
              sizes="100vw"
              priority={id === 'birth-of-venus'}
            />
          </div>
          {/* Zoom overlay */}
          <div className="absolute bottom-4 right-4 flex gap-2">
            <a
              href={artwork.fullResUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-black/60 hover:bg-black/80 text-white text-xs rounded-lg backdrop-blur-sm transition-colors"
            >
              <ZoomIn className="w-3.5 h-3.5" />
              View Full Resolution
            </a>
          </div>
        </div>
      </div>

      {/* Metadata header */}
      <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white">
        <div className="max-w-[var(--container-standard)] mx-auto px-6 md:px-12 py-8">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <ArtworkBadge type={artwork.resourceType} />
                <span className="text-xs text-stone-400">{artwork.license}</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-display font-bold">{artwork.title}</h2>
              {artwork.originalTitle !== artwork.title && (
                <p className="text-stone-400 italic mt-1 text-sm">{artwork.originalTitle}</p>
              )}
              <p className="text-lg text-stone-300 mt-2">{artwork.artist}</p>
              <p className="text-xs text-stone-500 mt-0.5">{artwork.artistDates}</p>

              <div className="flex flex-wrap items-center gap-4 mt-5 text-sm text-stone-400">
                <div className="flex items-center gap-1.5">
                  <Calendar className="w-4 h-4" />
                  {artwork.date}
                </div>
                <div className="flex items-center gap-1.5">
                  <Palette className="w-4 h-4" />
                  {artwork.medium}
                </div>
                <div className="flex items-center gap-1.5">
                  <Ruler className="w-4 h-4" />
                  {artwork.dimensions}
                </div>
                <div className="flex items-center gap-1.5">
                  <MapPin className="w-4 h-4" />
                  {artwork.location}
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-1 rounded-lg bg-white/5 px-1 py-0.5 flex-shrink-0">
              <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-stone-300 hover:text-white hover:bg-white/10 rounded-md transition-colors">
                <Quote className="w-4 h-4" />
                Cite
              </button>
              <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-stone-300 hover:text-white hover:bg-white/10 rounded-md transition-colors">
                <Heart className="w-4 h-4" />
                Like
              </button>
              <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-stone-300 hover:text-white hover:bg-white/10 rounded-md transition-colors">
                <Share2 className="w-4 h-4" />
                Share
              </button>
              {artwork.wikidataId && (
                <a
                  href={`https://www.wikidata.org/wiki/${artwork.wikidataId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-stone-300 hover:text-white hover:bg-white/10 rounded-md transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Wikidata
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="h-px bg-stone-200" />

      {/* Content sections */}
      <div className="max-w-[var(--container-standard)] mx-auto px-6 md:px-12 py-8 space-y-8">
        {/* Description */}
        <div className="card p-6">
          <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>About This Work</h3>
          <div className="prose-content max-w-none">
            {artwork.description.split('\n\n').map((p, i) => (
              <p key={i} className="mb-4 last:mb-0">{p}</p>
            ))}
          </div>
        </div>

        {/* Detail views (if any) */}
        {'views' in artwork && artwork.views.length > 0 && (
          <div className="card p-6">
            <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Detail Views</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {artwork.views.filter(v => v.type === 'detail' && 'url' in v && v.url).map((view, i) => (
                <div key={i} className="group relative rounded-lg overflow-hidden bg-stone-100">
                  <div className="aspect-square relative">
                    <Image
                      src={(view as { url: string }).url}
                      alt={view.caption || ''}
                      fill
                      className="object-cover group-hover:scale-105 transition-transform duration-300"
                      sizes="(max-width: 768px) 50vw, 33vw"
                    />
                  </div>
                  <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent p-3">
                    <p className="text-white text-xs">{view.caption}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Iconographic elements */}
        <div className="card p-6">
          <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Iconographic Elements</h3>
          <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
            Symbols, figures, and motifs — with their significance in the Neoplatonic tradition
          </p>
          <IconographyTable items={artwork.iconography} />
        </div>

        {/* Related texts — THE KILLER FEATURE */}
        <div className="card p-6 ring-1 ring-accent-rust/20">
          <div className="flex items-center gap-2 mb-1">
            <BookOpen className="w-5 h-5 text-accent-rust" />
            <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Related Texts in Source Library</h3>
          </div>
          <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>
            The books that inspired, explained, or contextualize this artwork — many translated into English for the first time
          </p>
          <RelatedTexts texts={artwork.relatedTexts} />
        </div>

        {/* Provenance */}
        <div className="card p-6">
          <h3 className="text-lg font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Provenance</h3>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{artwork.provenance}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ArtworkPrototypePage() {
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
      <SiteHeader variant="dark" />

      {/* Page intro */}
      <div className="bg-stone-900 text-white">
        <div className="max-w-[var(--container-standard)] mx-auto px-6 md:px-12 py-12">
          <p className="text-xs uppercase tracking-widest text-stone-500 mb-2">Prototype</p>
          <h1 className="text-3xl sm:text-4xl font-display font-bold">Visual Art Wing</h1>
          <p className="text-stone-400 mt-3 max-w-2xl leading-relaxed">
            What if Source Library went beyond books? Paintings, prints, and engravings from the same
            traditions — cross-referenced with the texts that inspired them. The philosophical sources
            you can read, alongside the art they produced.
          </p>
          <div className="flex gap-4 mt-6 text-sm">
            <a href="#birth-of-venus" className="text-accent-gold hover:text-white transition-colors">
              ↓ Birth of Venus (painting)
            </a>
            <a href="#melencolia-i" className="text-accent-gold hover:text-white transition-colors">
              ↓ Melencolia I (print)
            </a>
          </div>
        </div>
      </div>

      {/* Artworks */}
      <ArtworkCard artwork={ARTWORKS['birth-of-venus']} id="birth-of-venus" />

      {/* Divider */}
      <div className="max-w-[var(--container-standard)] mx-auto px-6 md:px-12 py-4">
        <div className="h-px" style={{ background: 'var(--border-medium)' }} />
      </div>

      <ArtworkCard artwork={ARTWORKS['melencolia-i']} id="melencolia-i" />

      {/* Footer note */}
      <div className="max-w-[var(--container-standard)] mx-auto px-6 md:px-12 py-12">
        <div className="card-warm p-6 text-center">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            This is a prototype. Images from Wikimedia Commons (Public Domain).
            Cross-references link to real Source Library books where available.
          </p>
          <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
            Full plan: <a href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/293" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">GitHub Issue #293</a>
          </p>
        </div>
      </div>
    </div>
  );
}
