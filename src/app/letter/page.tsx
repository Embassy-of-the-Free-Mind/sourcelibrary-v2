import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'March 2026 Update — Source Library',
  description:
    '4,500+ books translated across 30+ languages in 84 days. What AI-powered infrastructure for lost knowledge looks like.',
  alternates: { canonical: '/letter' },
};

/* ── Image constants ── */
const BLOB = 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com';

const T = `${BLOB}/thumbnails`; // thumbnail prefix (150px — for small book cards)
const A = `${BLOB}/archived`;   // archived prefix (full-res — for gallery strips & sidebar images)

const IMAGES = {
  // Full-res for gallery strips and sidebar display
  atalantaFrontispiece: `${A}/69520c46ab34727b1f044141/7.jpg`,
  fluddIntegraNaturae: `${A}/6952dac677f38f6761bc683a/13.jpg`,
  fluddSun: `${A}/6952dac677f38f6761bc683a/27.jpg`,
  fluddCosmos: `${A}/6952dac677f38f6761bc683a/45.jpg`,
  solomonPentacle: `${A}/695285cdab34727b1f04c25a/34.jpg`,
  corpusHermeticum: `${A}/694f3d6cbe37f451a5324e10/10.jpg`,
  agrippa: `${A}/694bf8d2343422769f237558/2.jpg`,
  pico: `${A}/694f8d99efce46492e19fdad/7.jpg`,
  // Thumbnails for small book card images (80px wide)
  fluddCoverThumb: `${T}/6952dac677f38f6761bc683a/5.jpg`,
  solomonCoverThumb: `${T}/695285cdab34727b1f04c25a/5.jpg`,
  atalantaThumb: `${T}/69520c46ab34727b1f044141/7.jpg`,
  corpusThumb: `${T}/694f3d6cbe37f451a5324e10/10.jpg`,
  agrippaThumb: `${T}/694bf8d2343422769f237558/2.jpg`,
  picoThumb: `${T}/694f8d99efce46492e19fdad/7.jpg`,
  drebbel: `${T}/6836f8ee811c8ab472a49e36/1.jpg`,
};

export default function LetterPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Three Months of Source Library"
          subtitle="March 2026 Update"
        />
      }
      bg="bg-cream"
    >
      <div className="max-w-none">
        <p className="text-muted text-sm mb-12">March 2026 &middot; Derek Lomas, Program Director</p>

        {/* ── Opening: A specific book ── */}
        <p className="font-body text-2xl md:text-3xl text-secondary leading-snug mb-8" style={{ lineHeight: 1.5 }}>
          Cornelius Drebbel built the first navigable submarine. He demonstrated a perpetual-motion
          clock to King James I. He invented an early thermostat. His theoretical writings &mdash;
          where he explains the natural philosophy behind his inventions &mdash; have been sitting
          in Latin, largely unread, since they were published in 1628.
        </p>

        <p className="font-body text-xl md:text-2xl text-secondary leading-relaxed mb-4">
          A copy is held at the{' '}
          <a href="https://embassyofthefreemind.com" className="text-accent-rust hover:underline">Embassy of the Free Mind</a>{' '}
          in Amsterdam. Today, for the first time, you can{' '}
          <a href="https://sourcelibrary.org/book/6836f8ee811c8ab472a49e36" className="text-accent-rust hover:underline">read every page in English</a>.
          No subscription, no paywall, no academic affiliation required.
        </p>

        <p className="font-body text-xl md:text-2xl text-secondary leading-relaxed mb-12">
          Drebbel&apos;s book is one of <strong>4,800+</strong>. Since the first commit on December&nbsp;12,&nbsp;2025,{' '}
          <a href="https://sourcelibrary.org" className="text-accent-rust hover:underline">Source Library</a> has
          become the world&apos;s largest freely available collection of translated historical primary
          sources &mdash; spanning 30+ languages, 13 digital library sources, and more than 1.8 million
          page images. Texts that have never had an English translation now have one. Texts that existed
          only behind institutional paywalls are now open to anyone with a browser.
        </p>

        {/* ── Gallery strip ── */}
        <div className="grid grid-cols-4 gap-2 mb-16 rounded-xl overflow-hidden">
          {[
            { src: IMAGES.atalantaFrontispiece, alt: 'Atalanta Fugiens frontispiece', href: 'https://sourcelibrary.org/book/69520c46ab34727b1f044141?page=7' },
            { src: IMAGES.fluddIntegraNaturae, alt: 'Fludd, Integra Naturae — the mirror of all nature and the image of art', href: 'https://sourcelibrary.org/book/6952dac677f38f6761bc683a?page=13' },
            { src: IMAGES.solomonPentacle, alt: 'Key of Solomon — kabbalistic pentacle', href: 'https://sourcelibrary.org/book/695285cdab34727b1f04c25a?page=34' },
            { src: IMAGES.fluddCosmos, alt: 'Fludd, cosmological engraving', href: 'https://sourcelibrary.org/book/6952dac677f38f6761bc683a?page=45' },
          ].map(img => (
            <a key={img.alt} href={img.href} className="aspect-[3/4] overflow-hidden bg-warm block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.src}
                alt={img.alt}
                className="w-full h-full object-cover hover:scale-105 transition-transform duration-500"
                loading="lazy"
              />
            </a>
          ))}
        </div>

        {/* ── Why It Matters ── */}
        <h2 className="font-serif text-3xl md:text-4xl text-primary mt-16 mb-8">Why This Matters</h2>

        <div className="md:grid md:grid-cols-[1fr_280px] md:gap-10 mb-10">
          <div>
            <p className="font-body text-lg text-secondary leading-relaxed mb-5">
              The Renaissance began with a translation. In 1463, Cosimo de&apos; Medici acquired a Greek
              manuscript of the <em>Corpus Hermeticum</em> &mdash; a collection of texts attributed to Hermes
              Trismegistus, believed to contain the oldest theology in the world. He ordered Marsilio Ficino
              to drop everything, including his work on Plato, and translate it immediately. Ficino did. Within
              a generation, those ideas had reshaped European philosophy, inspired Botticelli&apos;s paintings,
              and helped set the intellectual conditions for Copernicus and the scientific revolution.
            </p>

            <p className="font-body text-lg text-secondary leading-relaxed mb-5">
              That pattern &mdash; recovering lost texts, translating them, and watching the ideas transform
              a civilization &mdash; is the story of the Renaissance itself.{' '}
              <a href="https://sourcelibrary.org/encyclopedia/Copernicus" className="text-accent-rust hover:underline">Copernicus</a> read{' '}
              <a href="https://sourcelibrary.org/encyclopedia/Hermes%20Trismegistus" className="text-accent-rust hover:underline">Hermes Trismegistus</a>.{' '}
              <a href="https://sourcelibrary.org/encyclopedia/Kepler" className="text-accent-rust hover:underline">Kepler</a> drew
              on Pythagorean harmonic theory to develop his laws of planetary motion.{' '}
              <a href="https://sourcelibrary.org/encyclopedia/Newton" className="text-accent-rust hover:underline">Newton</a> devoted
              decades to alchemical research, filling over a million words of laboratory notebooks.{' '}
              <a href="https://sourcelibrary.org/encyclopedia/Leibniz" className="text-accent-rust hover:underline">Leibniz</a> studied
              the Kabbalah.
            </p>
          </div>

          {/* Corpus Hermeticum illustration */}
          <div className="hidden md:block">
            <a href="https://sourcelibrary.org/book/694f3d6cbe37f451a5324e10" className="block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={IMAGES.corpusHermeticum}
                alt="Corpus Hermeticum — Ficino's Argumentum, 1481 Venice edition"
                className="w-full rounded-lg shadow-md"
                loading="lazy"
              />
              <p className="text-muted text-xs mt-2 text-center italic">
                Corpus Hermeticum, Venice 1481 &mdash; Ficino&apos;s translation
              </p>
            </a>
          </div>
        </div>

        {/* Pull quote */}
        <blockquote className="border-l-4 border-accent-rust/40 pl-6 md:pl-8 py-4 my-10 bg-accent-rust/[0.03] rounded-r-lg">
          <p className="font-body text-xl md:text-2xl text-primary leading-relaxed italic">
            The intellectual context for the greatest acceleration of progress in Western history
            was a body of literature that is, today, mostly untranslated and unread.
          </p>
        </blockquote>

        <p className="font-body text-lg text-secondary leading-relaxed mb-5">
          Producing a professional critical edition of a 300-page Latin text takes years and
          costs $30,000&ndash;$60,000. Across all of academia, fewer than a hundred pre-modern
          texts are translated into English each year. Some estimate that there are hundreds of
          thousands of unscanned and untranslated Latin books &mdash; and perhaps 30 million
          Sanskrit manuscripts. Are these all worth translating? How to know without translating them?
        </p>

        <p className="font-body text-lg text-secondary leading-relaxed mb-12">
          The Source Library has made thousands of books available in English for the first time.
          The translations are first drafts, not critical editions, but they make texts
          accessible to researchers who can then decide which ones merit deeper scholarly work.
        </p>

        {/* ── What you can do ── */}
        <h2 className="font-serif text-3xl md:text-4xl text-primary mt-16 mb-8">Explore the Collection</h2>

        <p className="font-body text-lg text-secondary leading-relaxed mb-8">
          When you open a book in the Source Library, you&apos;ll see the original scanned pages
          side by side with an English translation. You can{' '}
          <a href="https://sourcelibrary.org/search" className="text-accent-rust hover:underline">search across the full text</a>,
          browse a{' '}
          <a href="https://sourcelibrary.org/gallery" className="text-accent-rust hover:underline">gallery of 73,000+ illustrations</a>,
          or explore an{' '}
          <a href="https://sourcelibrary.org/encyclopedia" className="text-accent-rust hover:underline">encyclopedia</a>{' '}
          linking people, places, and ideas across books and centuries.
        </p>

        {/* Featured books with images */}
        <div className="grid md:grid-cols-2 gap-6 mb-12">
          {[
            {
              title: 'Atalanta Fugiens',
              author: 'Michael Maier, 1618',
              detail: 'Fifty alchemical emblems with Latin verse, musical fugues, and allegorical commentary. 229 pages, fully translated from Latin.',
              href: 'https://sourcelibrary.org/book/69520c46ab34727b1f044141',
              image: IMAGES.atalantaThumb,
            },
            {
              title: 'Corpus Hermeticum: Pimander',
              author: 'Hermes Trismegistus (trans. Ficino), 1481',
              detail: 'Ficino\u2019s Latin translation of the Hermetic texts that launched the Renaissance revival of ancient theology. 96 pages.',
              href: 'https://sourcelibrary.org/book/694f3d6cbe37f451a5324e10',
              image: IMAGES.corpusThumb,
            },
            {
              title: 'Three Books of Occult Philosophy',
              author: 'Heinrich Cornelius Agrippa, 1550',
              detail: 'The foundational encyclopedia of Renaissance magic and natural philosophy. 626 pages, fully translated from Latin.',
              href: 'https://sourcelibrary.org/book/694bf8d2343422769f237558',
              image: IMAGES.agrippaThumb,
            },
            {
              title: 'Utriusque Cosmi Historia',
              author: 'Robert Fludd, 1617',
              detail: 'Fludd\u2019s illustrated history of the macrocosm and microcosm \u2014 fully translated for the first time. 1,036 pages.',
              href: 'https://sourcelibrary.org/book/6952dac677f38f6761bc683a',
              image: IMAGES.fluddCoverThumb,
            },
            {
              title: 'Key of Solomon',
              author: 'Anonymous, 17th century',
              detail: 'A Hebrew manuscript of ceremonial magic with diagrams and incantations. 192 pages, fully translated from Hebrew.',
              href: 'https://sourcelibrary.org/book/695285cdab34727b1f04c25a',
              image: IMAGES.solomonCoverThumb,
            },
            {
              title: '900 Theses',
              author: 'Giovanni Pico della Mirandola, 1486',
              detail: 'The 900 conclusions from all branches of knowledge that Pico offered to debate publicly in Rome. Condemned by the Pope. Fully translated from Latin.',
              href: 'https://sourcelibrary.org/book/694f8d99efce46492e19fdad',
              image: IMAGES.picoThumb,
            },
          ].map(b => (
            <a key={b.title} href={b.href} className="group flex gap-4 bg-white rounded-xl p-4 border border-border-light hover:border-accent-rust/30 hover:shadow-md transition-all">
              <div className="w-20 h-28 flex-shrink-0 rounded-md overflow-hidden bg-warm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={b.image}
                  alt={b.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  loading="lazy"
                />
              </div>
              <div className="min-w-0">
                <div className="text-primary font-medium text-lg leading-tight mb-0.5">{b.title}</div>
                <div className="text-muted text-sm mb-1.5">{b.author}</div>
                <div className="text-secondary text-sm leading-relaxed">{b.detail}</div>
              </div>
            </a>
          ))}
        </div>

        <p className="font-body text-lg text-secondary leading-relaxed mb-5">
          None of these texts had a freely available English translation before. Some had never been fully
          translated at all. Browse the{' '}
          <a href="https://sourcelibrary.org/library" className="text-accent-rust hover:underline">full collection</a>{' '}
          or explore by{' '}
          <a href="https://sourcelibrary.org/collections" className="text-accent-rust hover:underline">collection</a> &mdash; from{' '}
          <a href="https://sourcelibrary.org/collections/alchemy" className="text-accent-rust hover:underline">Alchemy</a> and{' '}
          <a href="https://sourcelibrary.org/collections/kabbalah" className="text-accent-rust hover:underline">Kabbalah</a> to{' '}
          <a href="https://sourcelibrary.org/collections/natural-philosophy" className="text-accent-rust hover:underline">Natural Philosophy</a> and{' '}
          <a href="https://sourcelibrary.org/collections/rosicrucianism" className="text-accent-rust hover:underline">Rosicrucianism</a>.
        </p>

        <p className="font-body text-lg text-secondary leading-relaxed mb-16">
          For developers and AI researchers, the full collection is also available as an{' '}
          <a href="https://sourcelibrary.org/developers" className="text-accent-rust hover:underline">MCP server and CLI tool</a>.
          Install with one command. Any AI assistant &mdash; Claude, GPT, or custom agents &mdash;
          can search the full text of 4,800+ books, retrieve translations with per-page citation
          URLs, and explore 73,000+ extracted illustrations. The entire corpus is machine-readable
          by design.
        </p>

        {/* ── The Numbers ── */}
        <h2 className="font-serif text-3xl md:text-4xl text-primary mt-16 mb-8">By the Numbers</h2>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-5 mb-10">
          {[
            { value: '4,849', label: 'Books in collection' },
            { value: '1.84M', label: 'Page images' },
            { value: '1.12M', label: 'Pages with OCR' },
            { value: '635K', label: 'Pages translated to English' },
            { value: '3,708', label: 'Books with English translation' },
            { value: '73K+', label: 'Illustrations extracted' },
            { value: '30+', label: 'Languages' },
            { value: '13', label: 'Digital library sources' },
            { value: '84 days', label: 'Since first commit' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl p-5 border border-border-light text-center">
              <div className="text-3xl md:text-4xl font-serif text-accent-rust mb-1">{s.value}</div>
              <div className="text-muted text-sm">{s.label}</div>
            </div>
          ))}
        </div>

        <p className="font-body text-lg text-secondary leading-relaxed mb-5">
          The pipeline is currently translating roughly 50,000 pages per day. At that rate,
          the full catalog should be translated within a few weeks. Readers from 40+ countries
          have used the site. For developers and AI researchers, the entire collection is accessible via{' '}
          <a href="https://sourcelibrary.org/developers" className="text-accent-rust hover:underline">MCP server and CLI</a> &mdash;
          any AI assistant can search, cite, and retrieve full texts directly.
        </p>

        {/* Second gallery strip — different images */}
        <div className="grid grid-cols-3 gap-2 mb-12 rounded-xl overflow-hidden">
          {[
            { src: IMAGES.fluddSun, alt: 'Fludd — personified sun engraving', href: 'https://sourcelibrary.org/book/6952dac677f38f6761bc683a?page=27' },
            { src: IMAGES.agrippa, alt: 'Agrippa — Three Books of Occult Philosophy', href: 'https://sourcelibrary.org/book/694bf8d2343422769f237558' },
            { src: IMAGES.pico, alt: 'Pico della Mirandola — 900 Theses', href: 'https://sourcelibrary.org/book/694f8d99efce46492e19fdad' },
          ].map(img => (
            <a key={img.alt} href={img.href} className="aspect-[4/5] overflow-hidden bg-warm block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.src}
                alt={img.alt}
                className="w-full h-full object-cover hover:scale-105 transition-transform duration-500"
                loading="lazy"
              />
            </a>
          ))}
        </div>

        {/* ── Costs ── */}
        <h3 className="font-serif text-2xl md:text-3xl text-primary mt-12 mb-6">What It Cost</h3>

        <p className="font-body text-lg text-secondary leading-relaxed mb-6">
          Here are the actual hard costs to build and run the Source Library for its first three months:
        </p>

        <div className="bg-white rounded-xl border border-border-light overflow-hidden mb-8">
          <table className="w-full">
            <thead>
              <tr className="bg-warm border-b border-border-light">
                <th className="text-left py-3 px-5 font-medium text-primary">Service</th>
                <th className="text-right py-3 px-5 font-medium text-primary">Monthly</th>
                <th className="text-right py-3 px-5 font-medium text-primary">To Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-light text-[15px]">
              {[
                { name: 'Gemini AI', desc: 'OCR, translation, summaries, image extraction', monthly: 'varies', total: '$7,432', highlight: true },
                { name: 'Claude', desc: '2 Max accounts \u2014 development, curation, QA', monthly: '$400', total: '$1,200' },
                { name: 'Vercel', desc: 'Hosting, serverless functions, blob storage, CDN', monthly: 'varies', total: '$848' },
                { name: 'AWS Lambda', desc: 'OCR, translation, and image extraction workers', monthly: 'varies', total: '~$460' },
                { name: 'Resend', desc: 'Transactional email', monthly: '$20', total: '$60' },
                { name: 'Hetzner', desc: 'Archive server for batch image processing', monthly: '~$15', total: '~$45' },
                { name: 'MongoDB Atlas', desc: 'Database', monthly: '~$50', total: '~$150' },
              ].map(row => (
                <tr key={row.name}>
                  <td className="py-3 px-5 text-secondary">
                    <strong>{row.name}</strong>
                    <span className="block text-muted text-xs mt-0.5">{row.desc}</span>
                  </td>
                  <td className="py-3 px-5 text-right text-secondary">{row.monthly}</td>
                  <td className={`py-3 px-5 text-right ${row.highlight ? 'text-accent-rust font-semibold' : 'text-secondary'}`}>{row.total}</td>
                </tr>
              ))}
              <tr className="bg-warm/50 font-semibold">
                <td className="py-3.5 px-5 text-primary">Total hard costs</td>
                <td className="py-3.5 px-5 text-right text-muted">&mdash;</td>
                <td className="py-3.5 px-5 text-right text-accent-rust text-lg">~$10,200</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="font-body text-lg text-secondary leading-relaxed mb-5">
          That&apos;s <strong>under $10,000 in infrastructure</strong> to process 3,700+ books through a full
          AI pipeline. Labor is separate: I work on this full-time as Program Director,
          with two part-time research assistants, funded by the Embassy of the Free Mind.
          The infrastructure costs are what scales &mdash; and they&apos;re already dropping as
          the one-time processing completes.
        </p>

        <p className="font-body text-lg text-secondary leading-relaxed mb-16">
          For context: a professional human translation of a single 300-page Latin text costs
          $30,000&ndash;$60,000 and takes years.
          The Source Library processed 3,700+ books for about $3 each.
        </p>

        {/* ── How It Works ── */}
        <h2 className="font-serif text-3xl md:text-4xl text-primary mt-16 mb-8">How It Works</h2>

        <p className="font-body text-lg text-secondary leading-relaxed mb-6">
          The Source Library connects to{' '}
          <a href="https://sourcelibrary.org/fulldata" className="text-accent-rust hover:underline">13 digital library sources</a>{' '}
          worldwide &mdash;{' '}
          <a href="https://archive.org" className="text-accent-rust hover:underline">Internet Archive</a>,{' '}
          <a href="https://gallica.bnf.fr" className="text-accent-rust hover:underline">Gallica</a>,{' '}
          the Bavarian State Library, the Bodleian, the Vatican, Cambridge, and seven more.
          When a book is imported, the system runs it through a fully automated pipeline:
        </p>

        {/* Pipeline as visual cards instead of numbered list */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-10">
          {[
            { step: '1', name: 'Archive', desc: 'Download and host all page images', color: 'var(--accent-sage)' },
            { step: '2', name: 'OCR', desc: 'AI reads text from scanned pages', color: 'var(--accent-sage)' },
            { step: '3', name: 'Translate', desc: 'Full English translation with context', color: 'var(--accent-rust)' },
            { step: '4', name: 'Enrich', desc: 'Summaries, indexes, chapters', color: 'var(--accent-violet)' },
            { step: '5', name: 'Extract', desc: 'Illustrations with museum metadata', color: 'var(--accent-gold)' },
          ].map(s => (
            <div key={s.step} className="bg-white rounded-xl p-4 border border-border-light text-center">
              <div
                className="w-8 h-8 rounded-full text-white text-sm font-semibold flex items-center justify-center mx-auto mb-2"
                style={{ backgroundColor: s.color }}
              >
                {s.step}
              </div>
              <div className="text-primary font-medium text-sm mb-1">{s.name}</div>
              <div className="text-muted text-xs leading-snug">{s.desc}</div>
            </div>
          ))}
        </div>

        <p className="font-body text-lg text-secondary leading-relaxed mb-16">
          The pipeline runs autonomously. Once imported, no human intervention is needed until a
          scholar wants to review the output. See the{' '}
          <Link href="/progress" className="text-accent-rust hover:underline">development timeline</Link>{' '}
          for how this was built over 1,400+ commits in three months.
        </p>

        {/* ── What We Learned ── */}
        <h2 className="font-serif text-3xl md:text-4xl text-primary mt-16 mb-8">What We&apos;ve Learned</h2>

        <div className="space-y-8 mb-16">
          <div className="md:grid md:grid-cols-[1fr_200px] md:gap-8 bg-white rounded-xl border border-border-light p-6 md:p-8">
            <div>
              <p className="text-primary font-medium text-lg mb-3">AI translation quality is better than expected.</p>
              <p className="font-body text-secondary leading-relaxed">
                We&apos;ve processed texts in Latin, German Fraktur, Arabic, Hebrew, Classical Chinese, and
                more. The output isn&apos;t perfect, but for giving a researcher their first orientation in
                an unfamiliar text, the quality is genuinely useful. First drafts are what scholarship
                needs most.
              </p>
            </div>
            <div className="hidden md:block">
              <a href="https://sourcelibrary.org/book/6952dac677f38f6761bc683a?page=13">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={IMAGES.fluddIntegraNaturae} alt="Fludd's Integra Naturae" className="rounded-lg w-full" loading="lazy" />
              </a>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-border-light p-6 md:p-8">
            <p className="text-primary font-medium text-lg mb-3">The technology is not the hard part.</p>
            <p className="font-body text-secondary leading-relaxed">
              Building the pipeline took three months and under $10,000. But someone has to decide
              which texts matter, validate the output, and connect the work to living research
              communities. The technology is ready. The institutional structure is what needs building.
            </p>
          </div>

          <div className="bg-white rounded-xl border border-border-light p-6 md:p-8">
            <p className="text-primary font-medium text-lg mb-3">Scanning is the real bottleneck.</p>
            <p className="font-body text-secondary leading-relaxed">
              The <a href="https://embassyofthefreemind.com" className="text-accent-rust hover:underline">Embassy of the Free Mind</a> holds
              approximately 25,000 volumes, mostly unscanned. AI can translate a scan in minutes, but
              digitizing a 500-year-old binding requires physical access, professional equipment and
              human labor. A professional can scan approximately 6&ndash;8 books per day.
            </p>
          </div>

          <div className="md:grid md:grid-cols-[200px_1fr] md:gap-8 bg-white rounded-xl border border-border-light p-6 md:p-8">
            <div className="hidden md:block">
              <a href="https://sourcelibrary.org/book/694f8d99efce46492e19fdad">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={IMAGES.pico} alt="Pico della Mirandola, 900 Theses" className="rounded-lg w-full" loading="lazy" />
              </a>
            </div>
            <div>
              <p className="text-primary font-medium text-lg mb-3">Open access changes who can participate.</p>
              <p className="font-body text-secondary leading-relaxed">
                When Pico&apos;s{' '}
                <a href="https://sourcelibrary.org/book/694f8d99efce46492e19fdad" className="text-accent-rust hover:underline"><em>900 Theses</em></a>{' '}
                exists only behind university paywalls, the study of Renaissance philosophy is limited
                to well-funded institutions. When it&apos;s freely available, a student in Lagos or Lima
                can engage with the same primary sources as a professor at the Warburg Institute.
              </p>
            </div>
          </div>
        </div>

        {/* ── Where We're Going ── */}
        <div className="bg-dark text-white rounded-2xl p-8 md:p-12 mb-16 -mx-4 md:-mx-8">
          <h2 className="font-serif text-3xl md:text-4xl mb-8">What Comes Next</h2>

          <p className="font-body text-lg text-stone-300 leading-relaxed mb-5">
            The Source Library is a program of the{' '}
            <a href="https://embassyofthefreemind.com" className="text-accent-gold hover:underline">Embassy of the Free Mind</a>{' '}
            in Amsterdam, which holds one of the world&apos;s great collections of Hermetic, alchemical, and
            esoteric manuscripts. By aligning ourselves with one of the greatest collections of
            Renaissance wisdom, we hope to create a longstanding institution for digital access.
          </p>

          <p className="font-body text-lg text-stone-300 leading-relaxed mb-6">
            We&apos;ve published a{' '}
            <Link href="/plan" className="text-accent-gold hover:underline">full strategic plan and budget</Link>{' '}
            built from first principles:
          </p>

          <div className="bg-white/10 rounded-xl p-6 md:p-8 mb-8 border border-white/10">
            <p className="text-xl font-semibold text-white mb-5">
              $1.2M/year for 3 years
            </p>
            <div className="grid md:grid-cols-2 gap-4">
              {[
                { name: 'Scanning', detail: '1,000\u20131,300 books/year from EFM and partner libraries', amount: '$250K' },
                { name: 'Core team', detail: 'Program director, digital humanities lead, research coordinator', amount: '$260K' },
                { name: 'Scholarly engagement', detail: 'Advisory board, 6 visiting scholars, 25 scholarly editions', amount: '$220K' },
                { name: 'Public engagement', detail: 'Press, documentary series, patron program, touring exhibition', amount: '$200K' },
                { name: 'Infrastructure', detail: 'AI processing, hosting, long-term digital preservation', amount: '$100K' },
              ].map(item => (
                <div key={item.name} className="flex items-start gap-3">
                  <span className="text-accent-gold font-semibold text-sm whitespace-nowrap mt-0.5">{item.amount}</span>
                  <div>
                    <span className="text-white font-medium">{item.name}</span>
                    <span className="text-stone-400 text-sm block leading-snug">{item.detail}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white/10 rounded-xl p-6 md:p-8 mb-8 border border-white/10">
            <p className="text-xl font-semibold text-white mb-4">
              What $50,000 Enables
            </p>
            <p className="font-body text-stone-300 leading-relaxed mb-4">
              At current costs (~$3/book for the full pipeline), $50K is enough to take the Source Library
              from proof of concept to permanent infrastructure:
            </p>
            <ul className="text-stone-300 space-y-2 ml-5 list-disc font-body">
              <li>Complete AI translation of the full 4,800-book catalog (~$5K remaining)</li>
              <li>Two full years of hosting and infrastructure &mdash; Vercel, AWS, MongoDB, CDN (~$17K)</li>
              <li>Scanning equipment and a part-time operator to digitize 1,000+ unscanned EFM volumes (~$23K)</li>
              <li>Scholarly review and DOI minting for the most-cited texts (~$5K)</li>
            </ul>
          </div>

          <div className="bg-white/10 rounded-xl p-6 md:p-8 mb-8 border border-white/10">
            <p className="text-xl font-semibold text-white mb-4">
              Path to Sustainability
            </p>
            <p className="font-body text-stone-300 leading-relaxed">
              The 999 Embassy of the Free Mind books are being published as Kindle ebooks ($9.99)
              and premium print-on-demand editions ($55&ndash;$95). At modest sales volumes, the catalog
              generates ongoing revenue with near-zero marginal cost. Institutional licensing
              ($500&ndash;$2,000/year for university library access) provides a second channel. The $50K
              ask is bridge funding while these revenue streams develop &mdash; not an ongoing
              dependency.
            </p>
          </div>

          <p className="font-body text-lg text-stone-300 leading-relaxed mb-5">
            The entire tradition of Renaissance Neoplatonism &mdash; which shaped Botticelli, Copernicus,
            and the intellectual culture of early modern Europe &mdash; traces back to Cosimo&apos;s
            patronage of one translator working on one manuscript. The opportunity here is the same
            impulse at a different scale: thousands of texts, freely available to the world.
          </p>

          {/* Closing pull quote */}
          <blockquote className="border-l-4 border-accent-gold/60 pl-6 py-4 my-8">
            <p className="font-body text-xl md:text-2xl text-white leading-relaxed italic">
              The Renaissance happened because a handful of people decided that recovering lost knowledge
              was worth investing in. The knowledge is still there. Most of it has never been recovered.
              The tools to do it now exist.
            </p>
            <p className="text-accent-gold font-medium mt-4 text-lg">
              What&apos;s needed is the same thing that was needed in 1463: someone who understands what&apos;s at stake.
            </p>
          </blockquote>

          <p className="font-body text-lg text-stone-300 leading-relaxed">
            If you are interested in this work &mdash; as a funder, scholar, or partner institution &mdash;
            we would welcome the conversation.
          </p>
        </div>

        {/* ── FAQ ── */}
        <h2 className="font-serif text-3xl md:text-4xl text-primary mt-16 mb-8">Questions You Might Have</h2>

        <div className="space-y-6 mb-16">
          {[
            {
              q: 'How good are the translations?',
              a: 'They are AI first drafts, not critical scholarly editions. For well-structured Latin or German texts, the output is genuinely useful \u2014 comparable to a competent graduate student\u2019s first pass. For fragmentary manuscripts or highly technical alchemical terminology, quality varies. The key insight is that a usable first draft is what scholarship needs most: it lets researchers quickly identify which texts merit deeper work. Every translation is paired with the original page image so scholars can always check the source.',
            },
            {
              q: 'How does this compare to existing projects?',
              a: 'Perseus Digital Library covers ~400 Classical texts. EEBO (Early English Books Online) has scans but no translations and costs $100K+/year for institutional access. The Loeb Classical Library covers ~520 volumes at $30 each. None of these projects translate from manuscript scans in 30+ languages at this pace or cost. The closest comparison might be Google Books, which scans but does not OCR historical scripts or translate.',
            },
            {
              q: 'What happens if you stop working on it?',
              a: 'The site runs on standard infrastructure (Vercel, MongoDB Atlas, AWS) with no proprietary dependencies. All source code is version-controlled. The collection data could be exported and rehosted by any competent developer. The processing pipeline is fully documented. We\u2019re also minting DOIs for scholarly editions through Zenodo, giving translated texts permanent, citable identifiers independent of any hosting platform.',
            },
            {
              q: 'Why not just use Google Translate?',
              a: 'Three reasons. First, you need high-quality OCR before you can translate \u2014 most of these texts are in historical typefaces (Fraktur, Renaissance Latin ligatures, Hebrew manuscripts) that standard OCR cannot read. Second, the translation uses full-page context, not sentence-by-sentence, which is critical for texts with complex syntax and domain-specific terminology. Third, the pipeline extracts structural metadata (chapters, illustrations, indexes, cross-references) that transforms a raw scan into a navigable digital edition.',
            },
            {
              q: 'What\u2019s the right balance between speed and quality?',
              a: 'We don\u2019t fully know yet. Processing 4,800 books in 84 days prioritized breadth over depth. Some texts would benefit enormously from human editorial review. Others are perfectly served by AI output. We\u2019re developing a triage system: the most-read and most-cited texts get human scholarly attention first. But the question of how to allocate scarce scholarly time across thousands of newly accessible texts is genuinely new territory.',
            },
            {
              q: 'Should AI translations carry a warning label?',
              a: 'Yes, and they do \u2014 every page shows the AI model and processing source. But the broader question of how AI-generated scholarship should be received by academic communities is genuinely open. Some scholars welcome the access; others are skeptical of any AI output in humanities research. We think the right answer is radical transparency: show the original, show the translation, let scholars evaluate both.',
            },
          ].map(item => (
            <div key={item.q} className="bg-white rounded-xl border border-border-light p-6">
              <p className="text-primary font-medium text-lg mb-3">{item.q}</p>
              <p className="font-body text-secondary leading-relaxed">{item.a}</p>
            </div>
          ))}
        </div>

        {/* Sign-off */}
        <div className="border-t border-border-light pt-8 mb-8">
          <p className="text-secondary text-lg mb-1">Derek Lomas</p>
          <p className="text-muted text-sm">Program Director, Source Library</p>
          <p className="text-muted text-sm">Embassy of the Free Mind, Amsterdam</p>
        </div>

        {/* Links */}
        <div className="flex flex-wrap gap-3 pt-4 mb-4">
          <Link
            href="/"
            className="px-6 py-3 bg-stone-900 text-white rounded-full hover:bg-stone-800 transition-colors font-medium"
          >
            Browse the Library
          </Link>
          <Link
            href="/plan"
            className="px-6 py-3 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
          >
            Strategic Plan &amp; Budget
          </Link>
          <Link
            href="/gallery"
            className="px-6 py-3 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
          >
            Gallery (73K+ Images)
          </Link>
          <Link
            href="/encyclopedia"
            className="px-6 py-3 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
          >
            Encyclopedia
          </Link>
          <Link
            href="/progress"
            className="px-6 py-3 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
          >
            Development Timeline
          </Link>
          <Link
            href="/developers"
            className="px-6 py-3 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
          >
            Developers / MCP
          </Link>
          <Link
            href="/fulldata"
            className="px-6 py-3 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
          >
            Full Collection Data
          </Link>
        </div>
      </div>
    </ContentPageLayout>
  );
}
