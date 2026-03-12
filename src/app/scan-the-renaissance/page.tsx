import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import PrintButton from './PrintButton';

export const metadata: Metadata = {
  title: 'Scan the Renaissance — Source Library',
  description:
    '1.15 million Renaissance editions remain unscanned. Source Library is building the infrastructure to translate them all — starting with the Bibliotheca Klossiana.',
  alternates: { canonical: '/scan-the-renaissance' },
};

/* ── Image constants ── */
const BLOB = 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com';
const A = `${BLOB}/archived`;

const IMAGES = {
  corpusHermeticum: `${A}/694f3d6cbe37f451a5324e10/10.jpg`,
  fluddCosmos: `${A}/6952dac677f38f6761bc683a/45.jpg`,
  atalanta: `${A}/69520c46ab34727b1f044141/7.jpg`,
};

export default function ScanTheRenaissancePage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Scan the Renaissance"
          subtitle="A finite problem. A solvable one."
          image={IMAGES.corpusHermeticum}
          imageAlt="Corpus Hermeticum — one of the texts that sparked the Renaissance"
        />
      }
      bg="bg-cream"
    >
      <div className="prose-content max-w-none">

        {/* ══════════════════════════════════════════════
            PART I — THE BIG PICTURE
            ══════════════════════════════════════════════ */}

        {/* Lead */}
        <p className="font-body text-2xl md:text-3xl text-secondary leading-snug mb-6">
          The Renaissance began when one man funded one translation.
        </p>
        <p className="font-body text-lg text-secondary leading-relaxed mb-4">
          In 1462, Cosimo de&apos; Medici directed Marsilio Ficino to set aside his translation of Plato
          and instead translate the <em>Corpus Hermeticum</em> — a Greek manuscript that had arrived in
          Florence two years earlier. Cosimo was elderly and dying; he wanted to read it before the end.
          Ficino completed the translation by April 1463. The resulting text reshaped philosophy, science,
          and religion across Europe.
        </p>
        <p className="font-body text-lg text-secondary leading-relaxed mb-12">
          Five centuries later, the vast majority of texts from that revolution remain unread.
        </p>

        {/* The scale */}
        <h2 className="font-serif text-3xl md:text-4xl text-primary mt-16 mb-8">The Scale of the Problem</h2>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { value: '1.65M', label: 'Editions printed 1450–1700', color: 'text-accent-rust' },
            { value: '~30%', label: 'Have a linked digital scan', color: 'text-accent-sage' },
            { value: '~1.15M', label: 'Editions still unscanned', color: 'text-accent-violet' },
            { value: '~$3', label: 'AI cost to translate one book', color: 'text-accent-gold' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl p-5 border border-border-light text-center">
              <div className={`text-3xl md:text-4xl font-serif ${s.color}`}>{s.value}</div>
              <div className="text-muted text-sm mt-1">{s.label}</div>
            </div>
          ))}
        </div>

        <p className="font-body text-lg text-secondary leading-relaxed mb-4">
          The Universal Short Title Catalogue records over 1.65 million editions printed in Europe between 1450 and 1700.
          Only about 30% have a linked digital scan — roughly half a million editions. The remaining{' '}
          <strong>1.15 million editions</strong> — books that shaped the modern world — sit in archives,
          unscanned, untranslated, effectively invisible.
        </p>
        <p className="font-body text-lg text-secondary leading-relaxed mb-8">
          The scholars who can read them are retiring. The physical books are deteriorating.
          This is a narrow window.
        </p>

        {/* The opportunity */}
        <h2 className="font-serif text-3xl md:text-4xl text-primary mt-16 mb-8">The Opportunity</h2>

        <div className="border-l-4 border-accent-rust/40 pl-6 md:pl-8 py-4 my-10 bg-accent-rust/[0.03] rounded-r-lg">
          <p className="font-body text-xl text-secondary italic leading-relaxed mb-0">
            Source Library has proven that AI can OCR and translate a rare Latin text for approximately $3.
            But AI can only read what&apos;s been photographed.
            <strong className="not-italic"> The bottleneck is scanning, not translation.</strong>
          </p>
        </div>

        <p className="font-body text-lg text-secondary leading-relaxed mb-4">
          The total cost to scan every remaining undigitized Renaissance edition is on the order
          of $100–200 million — depending on conservation requirements and institutional access.
          At Internet Archive bulk rates the floor is lower; for fragile manuscripts it&apos;s higher.
        </p>
        <p className="font-body text-lg text-secondary leading-relaxed mb-4">
          That sounds like a lot until you compare it to what we already spend on cultural preservation.
          It&apos;s less than a single large museum renovation. Less than what the NEH distributes in a year.
          Less than what the Arcadia Fund has already given to endangered archives.
        </p>
        <p className="font-body text-lg text-secondary leading-relaxed mb-12">
          This is not an intractable problem. It&apos;s a solvable one.
          It just needs someone to start.
        </p>


        {/* ══════════════════════════════════════════════
            PART II — THE KLOSS LIBRARY
            ══════════════════════════════════════════════ */}

        <div className="border-t-2 border-accent-gold/20 pt-16 mt-16">
          <p className="text-accent-gold text-xs font-semibold uppercase tracking-[0.15em] mb-4">
            Where We Start
          </p>
          <h2 className="font-serif text-3xl md:text-4xl text-primary mb-8">
            The Bibliotheca Klossiana
          </h2>
        </div>

        <p className="font-body text-2xl md:text-3xl text-secondary leading-snug mb-6">
          In The Hague, behind closed doors, sits one of the world&apos;s most extraordinary
          collections of esoteric texts.
        </p>

        <p className="font-body text-lg text-secondary leading-relaxed mb-4">
          The Bibliotheca Klossiana — 7,000 books and 2,000 manuscripts on Masonic ritual,
          Rosicrucian treatises, alchemical works, and documents of the Bavarian Illuminati —
          bears the name of Georg Kloss (1787–1854), a Frankfurt physician and obsessive
          collector. Kloss first built one of Europe&apos;s great incunabula libraries by
          purchasing entire monastery collections, then sold it all at Sotheby&apos;s in 1835
          to fund a second, even more ambitious project: a comprehensive library of Freemasonry
          and its antecedents.
        </p>
        <p className="font-body text-lg text-secondary leading-relaxed mb-4">
          That collection was acquired by Prince Frederik of the Netherlands, Grand Master
          of the Dutch Masonic Order, who donated it in 1866 to mark fifty years of his
          Grand Mastership. It has been held ever since at the Cultureel Maconniek Centrum
          &ldquo;Prins Frederik&rdquo; in The Hague.
        </p>
        <p className="font-body text-lg text-secondary leading-relaxed mb-4">
          Today, while the building houses a small public museum, the library and archive
          themselves are accessible only by appointment — and none of the collection has
          been digitized. For the vast majority of researchers, these 9,000 volumes are
          effectively unreachable.
        </p>
        <p className="font-body text-lg text-secondary leading-relaxed mb-12">
          Source Library and the Embassy of the Free Mind are exploring a collaboration
          with CMC Prins Frederik to change that — to digitize, OCR, translate, and publish
          the entire Kloss collection as a freely accessible online resource.
        </p>

        {/* Why Kloss */}
        <h3 className="font-serif text-2xl md:text-3xl text-primary mt-12 mb-6">Why This Collection</h3>

        <div className="grid md:grid-cols-2 gap-4 mb-12">
          {[
            {
              title: 'Rare Rosicrucian manuscripts',
              desc: 'Exceptional Gold- und Rosenkreuzer material rarely found outside specialist archives — primary sources for the history of esoteric orders.',
            },
            {
              title: 'Masonic history',
              desc: 'One of the deepest collections of Masonic ritual and correspondence anywhere in the world.',
            },
            {
              title: 'Fills scholarly gaps',
              desc: 'Covers traditions the BPH/Ritman collection doesn\'t — particularly Germanic lodge documents and Illuminati materials.',
            },
            {
              title: 'Collaboration in progress',
              desc: 'Source Library and the Embassy of the Free Mind are in discussions with CMC Prins Frederik to enable digitization access.',
            },
          ].map(item => (
            <div key={item.title} className="bg-white rounded-xl p-5 border border-border-light">
              <h4 className="text-primary font-medium mb-2">{item.title}</h4>
              <p className="text-secondary text-sm leading-relaxed mb-0">{item.desc}</p>
            </div>
          ))}
        </div>

        {/* The project */}
        <h3 className="font-serif text-2xl md:text-3xl text-primary mt-12 mb-6">The Project</h3>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { value: '9,000', label: 'Volumes (books + manuscripts)', color: 'text-accent-rust' },
            { value: '~2.1M', label: 'Estimated pages', color: 'text-accent-sage' },
            { value: '2–3 yrs', label: 'Timeline', color: 'text-accent-violet' },
            { value: '$500K–$1M', label: 'Scanning cost', color: 'text-accent-gold' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl p-5 border border-border-light text-center">
              <div className={`text-2xl md:text-3xl font-serif ${s.color}`}>{s.value}</div>
              <div className="text-muted text-sm mt-1">{s.label}</div>
            </div>
          ))}
        </div>

        <p className="font-body text-lg text-secondary leading-relaxed mb-12">
          The outcome: every text OCR&apos;d, translated to English, and freely available on
          sourcelibrary.org — with scholarly metadata, IIIF manifests, and DOI-backed scholarly editions.
          The entire Kloss Library, accessible to anyone with an internet connection, forever.
        </p>

        {/* Funding tiers */}
        <h3 className="font-serif text-2xl md:text-3xl text-primary mt-12 mb-6">Funding Tiers</h3>

        <div className="space-y-4 mb-12">
          {[
            {
              amount: '$25K',
              label: '50 books',
              desc: 'One subject area — e.g., the Gold und Rosenkreuzer manuscripts.',
            },
            {
              amount: '$100K',
              label: '200 books',
              desc: 'Scanned and fully processed through the AI pipeline — OCR, translation, metadata, images.',
            },
            {
              amount: '$250K',
              label: '500 books',
              desc: 'One quarter of the collection, with scholarly review and DOI-minted editions.',
              highlight: false,
            },
            {
              amount: '$500K',
              label: 'Half the library',
              desc: 'Digitized, translated, and published. A transformative gift.',
              highlight: true,
            },
            {
              amount: '$1M',
              label: 'The complete Bibliotheca Klossiana',
              desc: 'Every book. Every manuscript. Free forever.',
              highlight: true,
            },
            {
              amount: '$5M+',
              label: 'Kloss + expansion',
              desc: 'Complete the Kloss Library and extend to additional partner archives across Europe.',
            },
          ].map(tier => (
            <div
              key={tier.amount}
              className={`flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 rounded-xl p-5 border ${
                tier.highlight
                  ? 'bg-white border-accent-rust/30 ring-1 ring-accent-rust/10'
                  : 'bg-white border-border-light'
              }`}
            >
              <div className="sm:w-24 shrink-0">
                <span className={`text-2xl font-serif ${tier.highlight ? 'text-accent-rust' : 'text-primary'}`}>
                  {tier.amount}
                </span>
              </div>
              <div>
                <div className="font-medium text-primary">{tier.label}</div>
                <div className="text-secondary text-sm">{tier.desc}</div>
              </div>
            </div>
          ))}
        </div>


        {/* ── Operational Plan ── */}
        <h3 className="font-serif text-2xl md:text-3xl text-primary mt-16 mb-6">How It Works: The Operational Plan</h3>

        <p className="font-body text-lg text-secondary leading-relaxed mb-8">
          This is not a speculative proposal. Every step below uses proven methods and existing relationships.
        </p>

        {/* Phase 1 */}
        <div className="bg-white rounded-xl p-6 border border-border-light mb-4">
          <div className="flex items-baseline gap-3 mb-3">
            <span className="text-xs font-semibold text-accent-rust bg-accent-rust/10 px-2 py-0.5 rounded-full">Phase 1</span>
            <h4 className="text-lg text-primary">Survey &amp; Conservation Assessment</h4>
          </div>
          <p className="text-muted text-sm mb-3">Months 1–4 &middot; ~$40K</p>
          <ul className="text-secondary text-sm space-y-2">
            <li>On-site inventory: catalog every volume and manuscript by subject, condition, and language</li>
            <li>Conservation assessment: identify fragile items requiring special handling or repair before scanning</li>
            <li>Prioritize: rank subject areas by scholarly value and scanning readiness</li>
            <li>Technical planning: select scanning equipment, define image standards (600 DPI, RAW + JPEG2000), IIIF spec</li>
            <li>Deliverable: complete catalog, condition report, and digitization schedule</li>
          </ul>
        </div>

        {/* Phase 2 */}
        <div className="bg-white rounded-xl p-6 border border-border-light mb-4">
          <div className="flex items-baseline gap-3 mb-3">
            <span className="text-xs font-semibold text-accent-sage bg-accent-sage/10 px-2 py-0.5 rounded-full">Phase 2</span>
            <h4 className="text-lg text-primary">Scanning</h4>
          </div>
          <p className="text-muted text-sm mb-3">Months 4–30 &middot; $400K–$800K (bulk of cost)</p>
          <ul className="text-secondary text-sm space-y-2">
            <li>On-site scanning station: conservation-grade V-cradle book scanner (e.g. Zeutschel OS 15000) installed at CMC Prins Frederik</li>
            <li>Two trained operators, supervised by a conservator for fragile items</li>
            <li>Target throughput: 100–150 volumes/month (200–400 pages each)</li>
            <li>Manuscript handling: flatbed scanning with UV/IR capture for palimpsests and faded inks</li>
            <li>Images uploaded nightly to Vercel Blob storage with automated quality checks</li>
            <li>Weekly progress reports published to sourcelibrary.org/scan-the-renaissance/progress</li>
          </ul>
        </div>

        {/* Phase 3 */}
        <div className="bg-white rounded-xl p-6 border border-border-light mb-4">
          <div className="flex items-baseline gap-3 mb-3">
            <span className="text-xs font-semibold text-accent-violet bg-accent-violet/10 px-2 py-0.5 rounded-full">Phase 3</span>
            <h4 className="text-lg text-primary">AI Processing Pipeline</h4>
          </div>
          <p className="text-muted text-sm mb-3">Ongoing from month 5 &middot; ~$25K (AI costs for 9,000 volumes)</p>
          <ul className="text-secondary text-sm space-y-2">
            <li>OCR: Gemini AI reads each scanned page — Latin, German, French, Dutch, and manuscript hands</li>
            <li>Translation: every page translated to English with full-book context continuity</li>
            <li>Image extraction: illustrations, diagrams, and symbols cataloged with AI-generated metadata</li>
            <li>Index generation: automated subject indices, named entity recognition, cross-references</li>
            <li>Processing runs in parallel with scanning — books enter the pipeline as soon as they&apos;re scanned</li>
            <li>Proven at scale: Source Library has already processed 5,000+ books through this exact pipeline</li>
          </ul>
        </div>

        {/* Phase 4 */}
        <div className="bg-white rounded-xl p-6 border border-border-light mb-4">
          <div className="flex items-baseline gap-3 mb-3">
            <span className="text-xs font-semibold text-accent-gold bg-accent-gold/10 px-2 py-0.5 rounded-full">Phase 4</span>
            <h4 className="text-lg text-primary">Scholarly Review &amp; Publication</h4>
          </div>
          <p className="text-muted text-sm mb-3">Ongoing from month 8 &middot; $50K–$100K</p>
          <ul className="text-secondary text-sm space-y-2">
            <li>Expert review: specialists in Masonic history, Rosicrucianism, and Western esotericism review AI translations</li>
            <li>Scholarly editions: key texts published with introductions, apparatus, and DOI registration via Zenodo</li>
            <li>IIIF manifests: every volume available through standard digital library protocols, interoperable with major platforms</li>
            <li>Open access: all materials published under CC0 — no paywalls, no restrictions, forever</li>
            <li>Metadata alignment: catalog records cross-referenced with WorldCat, USTC, and library union catalogs</li>
          </ul>
        </div>

        {/* Phase 5 */}
        <div className="bg-white rounded-xl p-6 border border-border-light mb-12">
          <div className="flex items-baseline gap-3 mb-3">
            <span className="text-xs font-semibold text-primary bg-stone-100 px-2 py-0.5 rounded-full">Phase 5</span>
            <h4 className="text-lg text-primary">Long-term Stewardship</h4>
          </div>
          <p className="text-muted text-sm mb-3">Year 3+ &middot; covered by Source Library operating budget</p>
          <ul className="text-secondary text-sm space-y-2">
            <li>Permanent hosting on sourcelibrary.org with CDN-backed image delivery</li>
            <li>Ongoing AI model improvements retroactively improve OCR and translation quality</li>
            <li>Scholar-contributed corrections integrated through edition versioning system</li>
            <li>Digital preservation: IIIF + METS packaging for deposit in institutional repositories</li>
          </ul>
        </div>

        {/* Budget summary */}
        <div className="bg-accent-gold/5 rounded-lg p-6 border border-accent-gold/15 mb-12">
          <h4 className="text-primary font-medium mb-3">Budget Summary</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted border-b border-border-light">
                  <th className="pb-2 pr-4">Phase</th>
                  <th className="pb-2 pr-4">Cost</th>
                  <th className="pb-2">Notes</th>
                </tr>
              </thead>
              <tbody className="text-secondary">
                <tr className="border-b border-border-light/50"><td className="py-2 pr-4">Survey &amp; assessment</td><td className="py-2 pr-4 whitespace-nowrap">$40K</td><td className="py-2">On-site inventory, conservation report, catalog</td></tr>
                <tr className="border-b border-border-light/50"><td className="py-2 pr-4">Scanning (9,000 volumes)</td><td className="py-2 pr-4 whitespace-nowrap">$400K–$800K</td><td className="py-2">Equipment, operators, conservator oversight</td></tr>
                <tr className="border-b border-border-light/50"><td className="py-2 pr-4">AI processing</td><td className="py-2 pr-4 whitespace-nowrap">~$25K</td><td className="py-2">OCR, translation, images, indexing — entire collection</td></tr>
                <tr className="border-b border-border-light/50"><td className="py-2 pr-4">Scholarly review</td><td className="py-2 pr-4 whitespace-nowrap">$50K–$100K</td><td className="py-2">Expert review, DOI editions, metadata</td></tr>
                <tr className="border-b border-border-light/50"><td className="py-2 pr-4">Project management</td><td className="py-2 pr-4 whitespace-nowrap">$80K</td><td className="py-2">Coordination across 2–3 years</td></tr>
                <tr className="font-medium"><td className="py-2 pr-4">Total</td><td className="py-2 pr-4 whitespace-nowrap text-accent-rust">$600K–$1.05M</td><td className="py-2">Complete digitization of the Bibliotheca Klossiana</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* ══════════════════════════════════════════════
            CREDIBILITY & CTA
            ══════════════════════════════════════════════ */}

        <div className="border-t-2 border-border-light pt-16 mt-16">
          <h2 className="font-serif text-3xl md:text-4xl text-primary mb-8">Why Source Library</h2>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { value: '5,000+', label: 'Books processed', color: 'text-accent-rust' },
            { value: '2,400+', label: 'First-ever English translations', color: 'text-accent-sage' },
            { value: '30+', label: 'Languages', color: 'text-accent-violet' },
            { value: 'CC0', label: 'Open access', color: 'text-accent-gold' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl p-5 border border-border-light text-center">
              <div className={`text-3xl md:text-4xl font-serif ${s.color}`}>{s.value}</div>
              <div className="text-muted text-sm mt-1">{s.label}</div>
            </div>
          ))}
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-12">
          {[
            'IIIF manifests for interoperability with global digital library infrastructure',
            'DOI-minted scholarly editions for permanent citation',
            'Embassy of the Free Mind — institutional home (Amsterdam)',
            'BPH / Bibliotheca Philosophica Hermetica — Netherlands UNESCO Memory of the World Register',
            'Full cost transparency — see our strategic plan and annual letter',
            'Every text freely available, forever — no paywalls, no subscriptions',
          ].map(item => (
            <div key={item} className="flex items-start gap-3 bg-white rounded-lg p-3 border border-border-light">
              <span className="text-accent-sage mt-0.5 shrink-0">&#10003;</span>
              <span className="text-secondary text-sm">{item}</span>
            </div>
          ))}
        </div>


        {/* ── Call to Action ── */}
        <div className="bg-stone-900 text-white rounded-xl p-8 md:p-10 mb-12">
          <h2 className="text-2xl md:text-3xl font-serif mb-4">Get Involved</h2>
          <p className="text-stone-300 text-lg leading-relaxed mb-6">
            The Renaissance was funded by patrons who believed lost knowledge was worth recovering.
            The work isn&apos;t finished.
          </p>

          <div className="space-y-4 mb-8">
            <div>
              <h3 className="text-white text-lg mb-1">Contact</h3>
              <p className="text-stone-400 mb-0">
                <a href="mailto:derek@sourcelibrary.org" className="text-accent-gold hover:text-accent-gold/80 transition-colors">
                  derek@sourcelibrary.org
                </a>
              </p>
            </div>

            <div>
              <h3 className="text-white text-lg mb-1">US Donors</h3>
              <p className="text-stone-400 mb-0">
                Tax-deductible via the{' '}
                <a
                  href="https://thenaf.org"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-gold hover:text-accent-gold/80 transition-colors"
                >
                  Netherland-America Foundation
                </a>{' '}
                (501(c)(3))
              </p>
            </div>

            <div>
              <h3 className="text-white text-lg mb-1">European Donors</h3>
              <p className="text-stone-400 mb-0">
                <a
                  href="https://worldheartfoundation.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-gold hover:text-accent-gold/80 transition-colors"
                >
                  Worldheart Foundation
                </a>{' '}
                (ANBI)
              </p>
            </div>

            <div>
              <h3 className="text-white text-lg mb-1">Name a Collection</h3>
              <p className="text-stone-400 mb-0">
                Large donors can sponsor a specific subject area within the Kloss Library —
                your name permanently associated with making that knowledge accessible.
              </p>
            </div>
          </div>
        </div>

        {/* Links */}
        <div className="flex flex-wrap gap-4 pt-8 border-t border-border-light print:hidden">
          <Link
            href="/support"
            className="px-5 py-2.5 bg-stone-900 text-white rounded-full hover:bg-stone-800 transition-colors"
          >
            Support Source Library
          </Link>
          <PrintButton />
          <Link
            href="/plan"
            className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
          >
            Strategic Plan
          </Link>
          <Link
            href="/letter"
            className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
          >
            Annual Letter
          </Link>
          <Link
            href="/"
            className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
          >
            Browse the Library
          </Link>
        </div>
      </div>
    </ContentPageLayout>
  );
}
