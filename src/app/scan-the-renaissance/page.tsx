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
          In 1460, Cosimo de&apos; Medici asked Marsilio Ficino to translate the <em>Corpus Hermeticum</em> —
          a decision that helped spark the most consequential intellectual revolution in Western history.
          Ficino set aside Plato to do it. The resulting text reshaped philosophy, science, and religion
          across Europe.
        </p>
        <p className="font-body text-lg text-secondary leading-relaxed mb-12">
          Five centuries later, the vast majority of texts from that revolution remain unread.
        </p>

        {/* The scale */}
        <h2 className="font-serif text-3xl md:text-4xl text-primary mt-16 mb-8">The Scale of the Problem</h2>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { value: '1.6M', label: 'Editions printed 1450–1700', color: 'text-accent-rust' },
            { value: '~28%', label: 'Have any digital scan', color: 'text-accent-sage' },
            { value: '1.15M', label: 'Editions still unscanned', color: 'text-accent-violet' },
            { value: '~$3', label: 'AI cost to translate one book', color: 'text-accent-gold' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl p-5 border border-border-light text-center">
              <div className={`text-3xl md:text-4xl font-serif ${s.color}`}>{s.value}</div>
              <div className="text-muted text-sm mt-1">{s.label}</div>
            </div>
          ))}
        </div>

        <p className="font-body text-lg text-secondary leading-relaxed mb-4">
          The Universal Short Title Catalogue records 1.6 million editions printed in Europe between 1450 and 1700.
          Only about 28% have been digitized in any form. The remaining <strong>1.15 million editions</strong> —
          books that shaped the modern world — sit in archives, unscanned, untranslated, effectively invisible.
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
          The total cost to scan every remaining undigitized Renaissance edition is estimated at $50–100 million.
        </p>
        <p className="font-body text-lg text-secondary leading-relaxed mb-4">
          That&apos;s less than one endowed university chair. Less than one year of NEH grants.
          Less than what a single large foundation distributes in a quarter.
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
          Rosicrucian treatises, alchemical works, and Illuminati documents — was assembled
          by Georg Kloss, a 19th-century Frankfurt physician who spent decades acquiring
          entire monastery libraries. It is held today at the Cultureel Maconniek Centrum
          &ldquo;Prins Frederik&rdquo; in The Hague.
        </p>
        <p className="font-body text-lg text-secondary leading-relaxed mb-4">
          Since 2023, the archive has been shuttered. No one can access it. None of it is digitized.
        </p>
        <p className="font-body text-lg text-secondary leading-relaxed mb-12">
          A partnership between the Embassy of the Free Mind and CMC Prins Frederik
          now makes access possible — if the scanning can be funded.
        </p>

        {/* Why Kloss */}
        <h3 className="font-serif text-2xl md:text-3xl text-primary mt-12 mb-6">Why This Collection</h3>

        <div className="grid md:grid-cols-2 gap-4 mb-12">
          {[
            {
              title: 'Unique Rosicrucian manuscripts',
              desc: 'Gold- und Rosenkreuzer material found nowhere else — primary sources for the history of esoteric orders.',
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
              title: 'Partnership ready',
              desc: 'The Embassy of the Free Mind and CMC Prins Frederik have agreed to collaborate. Access is possible now.',
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


        {/* ══════════════════════════════════════════════
            CREDIBILITY & CTA
            ══════════════════════════════════════════════ */}

        <div className="border-t-2 border-border-light pt-16 mt-16">
          <h2 className="font-serif text-3xl md:text-4xl text-primary mb-8">Why Source Library</h2>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { value: '5,000+', label: 'Books processed', color: 'text-accent-rust' },
            { value: '1,873', label: 'First-ever English translations', color: 'text-accent-sage' },
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
            'BPH / Bibliotheca Philosophica Hermetica — UNESCO Memory of the World',
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
