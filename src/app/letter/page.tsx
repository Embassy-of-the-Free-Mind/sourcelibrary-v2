import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'March 2026 Update — Source Library',
  description:
    '4,500+ books, 30+ languages, a full AI pipeline, and the plan to build a real institution.',
  alternates: { canonical: '/letter' },
};

/* ── Image constants ── */
const BLOB = 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com';

const T = `${BLOB}/thumbnails`; // thumbnail prefix

const IMAGES = {
  atalantaFrontispiece: `${T}/69520c46ab34727b1f044141/7.jpg`,
  fluddIntegraNaturae: `${T}/6952dac677f38f6761bc683a/13.jpg`,
  fluddSun: `${T}/6952dac677f38f6761bc683a/27.jpg`,
  fluddCosmos: `${T}/6952dac677f38f6761bc683a/45.jpg`,
  solomonPentacle: `${T}/695285cdab34727b1f04c25a/34.jpg`,
  corpusHermeticum: `${T}/694f3d6cbe37f451a5324e10/10.jpg`,
  agrippa: `${T}/694bf8d2343422769f237558/2.jpg`,
  fluddCover: `${T}/6952dac677f38f6761bc683a/5.jpg`,
  solomonCover: `${T}/695285cdab34727b1f04c25a/5.jpg`,
  pico: `${T}/694f8d99efce46492e19fdad/7.jpg`,
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
          Drebbel&apos;s book is one of <strong>4,500</strong>. Since the first commit on December&nbsp;12,&nbsp;2025,{' '}
          <a href="https://sourcelibrary.org" className="text-accent-rust hover:underline">Source Library</a> has
          become the world&apos;s largest freely available collection of translated historical primary
          sources &mdash; spanning 30+ languages, 13 digital library sources, and more than 1.7 million
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
              <a href="https://sourcelibrary.org/encyclopedia/Kepler" className="text-accent-rust hover:underline">Kepler</a> described
              himself as a &ldquo;priest of God in the book of nature&rdquo; and drew on
              Pythagorean harmonic theory.{' '}
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
          A professional critical edition of a 300-page Latin text takes 5&ndash;10 years and
          costs $30,000&ndash;$60,000. Across all of academia, maybe a few hundred pre-modern
          texts get newly translated into English per year. The backlog is tens of thousands of
          volumes. The{' '}
          <a href="https://sourcelibrary.org/search?q=hermetic" className="text-accent-rust hover:underline">Hermetic writings</a>,
          the <a href="https://sourcelibrary.org/search?q=neoplatonism" className="text-accent-rust hover:underline">Neoplatonists</a>,
          the <a href="https://sourcelibrary.org/search?q=alchemy" className="text-accent-rust hover:underline">alchemical</a> and{' '}
          <a href="https://sourcelibrary.org/search?q=kabbalah" className="text-accent-rust hover:underline">Kabbalistic</a> traditions
          &mdash; thousands of volumes from the same intellectual world that produced the Renaissance
          have never been translated at all.
        </p>

        <p className="font-body text-lg text-secondary leading-relaxed mb-12">
          Source Library has made 4,500 of these books readable in English &mdash; many
          for the first time. The translations are first drafts, not critical editions, but they make texts
          accessible to researchers who can then decide which ones merit deeper scholarly work.
          Ficino&apos;s translation of the <em>Corpus Hermeticum</em> was also a first draft. It was enough.
        </p>

        {/* ── What you can do ── */}
        <h2 className="font-serif text-3xl md:text-4xl text-primary mt-16 mb-8">Explore the Collection</h2>

        <p className="font-body text-lg text-secondary leading-relaxed mb-8">
          Pick a book &mdash; any book. You&apos;ll see the original scanned pages side by side with
          an English translation. You can{' '}
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
              image: IMAGES.atalantaFrontispiece,
            },
            {
              title: 'Corpus Hermeticum: Pimander',
              author: 'Hermes Trismegistus (trans. Ficino), 1481',
              detail: 'Ficino\u2019s Latin translation of the Hermetic texts that launched the Renaissance revival of ancient theology. 96 pages.',
              href: 'https://sourcelibrary.org/book/694f3d6cbe37f451a5324e10',
              image: IMAGES.corpusHermeticum,
            },
            {
              title: 'Three Books of Occult Philosophy',
              author: 'Heinrich Cornelius Agrippa, 1550',
              detail: 'The foundational encyclopedia of Renaissance magic and natural philosophy. 626 pages, fully translated from Latin.',
              href: 'https://sourcelibrary.org/book/694bf8d2343422769f237558',
              image: IMAGES.agrippa,
            },
            {
              title: 'Utriusque Cosmi Historia',
              author: 'Robert Fludd, 1617',
              detail: 'Fludd\u2019s illustrated history of the macrocosm and microcosm \u2014 one of the most ambitious cosmological works of the early modern period. 1,036 pages.',
              href: 'https://sourcelibrary.org/book/6952dac677f38f6761bc683a',
              image: IMAGES.fluddCover,
            },
            {
              title: 'Key of Solomon',
              author: 'Anonymous, 17th century',
              detail: 'A Hebrew manuscript of ceremonial magic with diagrams and incantations. 192 pages, fully translated from Hebrew.',
              href: 'https://sourcelibrary.org/book/695285cdab34727b1f04c25a',
              image: IMAGES.solomonCover,
            },
            {
              title: '900 Theses',
              author: 'Giovanni Pico della Mirandola, 1486',
              detail: 'The 900 conclusions from all branches of knowledge that Pico offered to debate publicly in Rome. Condemned by the Pope. Fully translated from Latin.',
              href: 'https://sourcelibrary.org/book/694f8d99efce46492e19fdad',
              image: IMAGES.pico,
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
          For developers and researchers, Source Library is also available as an{' '}
          <a href="https://sourcelibrary.org/developers" className="text-accent-rust hover:underline">MCP server and CLI tool</a>{' '}
          &mdash; any AI assistant can search and cite the full collection directly.
        </p>

        {/* ── The Numbers ── */}
        <h2 className="font-serif text-3xl md:text-4xl text-primary mt-16 mb-8">By the Numbers</h2>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-5 mb-10">
          {[
            { value: '4,555', label: 'Books in collection' },
            { value: '1.71M', label: 'Page images' },
            { value: '992K', label: 'Pages with OCR' },
            { value: '507K', label: 'Pages translated to English' },
            { value: '1,083', label: 'Fully processed books' },
            { value: '73K+', label: 'Illustrations extracted' },
            { value: '30+', label: 'Languages' },
            { value: '13', label: 'Digital library sources' },
            { value: '83 days', label: 'Since Dec 12, 2025' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl p-5 border border-border-light text-center">
              <div className="text-3xl md:text-4xl font-serif text-accent-rust mb-1">{s.value}</div>
              <div className="text-muted text-sm">{s.label}</div>
            </div>
          ))}
        </div>

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
          Here are the actual hard costs to build and run Source Library for its first three months:
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
                { name: 'Vercel', desc: 'Hosting, serverless functions, blob storage, CDN', monthly: '$80\u2013680', total: '$848' },
                { name: 'AWS Lambda', desc: 'OCR, translation, and image extraction workers', monthly: '~$20', total: '~$60' },
                { name: 'Resend', desc: 'Transactional email', monthly: '$20', total: '$60' },
                { name: 'Hetzner', desc: 'Archive server for batch image processing', monthly: '$2', total: '$5' },
                { name: 'MongoDB Atlas', desc: 'Database (free tier)', monthly: '$0', total: '$0' },
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
                <td className="py-3.5 px-5 text-right text-accent-rust text-lg">~$9,600</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="font-body text-lg text-secondary leading-relaxed mb-5">
          That&apos;s <strong>under $10,000 in total hard costs</strong> to OCR, translate, summarize, index, and
          extract illustrations from 4,500+ books. No employees. No office. No equipment purchases.
          Just API calls and cloud services.
        </p>

        <p className="font-body text-lg text-secondary leading-relaxed mb-16">
          For context: a professional human translation of a single 300-page Latin text costs
          $30,000&ndash;$60,000 and takes months.
          Source Library processed 4,500 books for less than the cost of translating one.
        </p>

        {/* ── How It Works ── */}
        <h2 className="font-serif text-3xl md:text-4xl text-primary mt-16 mb-8">How It Works</h2>

        <p className="font-body text-lg text-secondary leading-relaxed mb-6">
          Source Library connects to{' '}
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
              approximately 25,000 volumes. Most are unscanned. AI can translate a scan in minutes, but
              digitizing a 500-year-old binding requires physical access and professional equipment.
              This is where funding has the highest return.
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
            Source Library is a program of the{' '}
            <a href="https://embassyofthefreemind.com" className="text-accent-gold hover:underline">Embassy of the Free Mind</a>{' '}
            in Amsterdam, which holds one of the world&apos;s great collections of Hermetic, alchemical, and
            esoteric manuscripts. The technology works. The collection exists. What&apos;s needed now is the
            institutional structure to sustain it.
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
