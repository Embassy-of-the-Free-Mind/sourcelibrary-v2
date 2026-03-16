import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import BlogComments from '@/components/blog/BlogComments';
import InputWidget from '@/components/InputWidget';

export const metadata: Metadata = {
  title: 'The World\'s Largest Collection of Translated Ancient and Early Modern Texts — Source Library',
  description:
    'With 4,200+ translated books and 800,000+ translated pages, Source Library is the world\'s largest collection of ancient and early modern texts translated into English — including 2,400+ first-ever English translations.',
  openGraph: {
    title: 'The World\'s Largest Collection of Translated Ancient and Early Modern Texts',
    description:
      'With 4,200+ translated books — 2,400+ for the first time ever — Source Library surpasses every comparable collection. And it\'s free.',
    images: [
      {
        url: 'https://sourcelibrary.org/og-image.png',
        width: 1200,
        height: 630,
      },
    ],
  },
  alternates: {
    canonical: '/blog/worlds-largest-collection',
  },
};

// Comparison data — scholarly print series
const PRINT_SERIES = [
  { name: 'Source Library', count: 4284, year: '2025–', access: 'Free & open', color: '#9e4a3a', type: 'AI translation' },
  { name: 'Loeb Classical Library', count: 540, year: '1911–', access: 'Paywall', color: '#7c5db5', type: 'Human scholarly' },
  { name: 'I Tatti Renaissance Library', count: 100, year: '2001–', access: 'Paywall', color: '#c9a86c', type: 'Human scholarly' },
  { name: 'Dumbarton Oaks Medieval Library', count: 75, year: '2010–', access: 'Paywall', color: '#8b9a7d', type: 'Human scholarly' },
  { name: 'Translated Texts for Historians', count: 60, year: '1985–', access: 'Paywall', color: '#7c5db5', type: 'Human scholarly' },
];
const MAX_COUNT = 4284;

// Comparison data — digital libraries
const DIGITAL_LIBRARIES = [
  { name: 'Source Library', translations: 4284, newTranslations: true, scope: '100+ languages, antiquity–1900', note: 'AI-generated, 2,400+ are first-ever English translations' },
  { name: 'Internet Archive', translations: null, newTranslations: false, scope: '40M+ texts total', note: 'General archive — hosts existing translations, does not produce new ones' },
  { name: 'Perseus Digital Library', translations: 1000, newTranslations: false, scope: 'Greek & Latin classics', note: 'Public domain Victorian-era translations (Loeb, etc.)' },
  { name: 'Sacred Texts Archive', translations: 1700, newTranslations: false, scope: 'Religious & mythological texts', note: 'Reprints of existing public domain translations' },
  { name: 'Chinese Text Project', translations: 400, newTranslations: true, scope: 'Pre-modern Chinese', note: 'Mix of published translations + AI-generated (2026)' },
  { name: 'Global Medieval Sourcebook', translations: 200, newTranslations: true, scope: 'Medieval texts', note: 'New scholarly translations (Stanford)' },
  { name: 'LacusCurtius', translations: 75, newTranslations: false, scope: 'Roman history & geography', note: 'Rekeyed public domain Loeb editions' },
];

const LANGUAGES = [
  { lang: 'Latin', n: 961 },
  { lang: 'German', n: 541 },
  { lang: 'Chinese', n: 398 },
  { lang: 'Sumerian', n: 373 },
  { lang: 'Greek', n: 259 },
  { lang: 'Sanskrit', n: 259 },
  { lang: 'French', n: 247 },
  { lang: 'Italian', n: 100 },
  { lang: 'Dutch', n: 86 },
  { lang: 'Hebrew', n: 31 },
];
const MAX_LANG = 961;

// Top source institutions (contributing libraries, not intermediaries)
const SOURCE_INSTITUTIONS = [
  { name: 'Bavarian State Library (MDZ)', books: '1,380+', access: 'IIIF direct' },
  { name: 'Embassy of the Free Mind', books: '1,090+', access: 'IIIF direct' },
  { name: 'Electronic Text Corpus of Sumerian Literature', books: '370+', access: 'Direct' },
  { name: 'University of Toronto', books: '450+', access: 'via Internet Archive' },
  { name: 'Koninklijke Bibliotheek (Netherlands)', books: '200+', access: 'via Internet Archive' },
  { name: 'Getty Research Institute', books: '170+', access: 'via Internet Archive' },
  { name: 'Biblioth\u00e8que nationale de France (Gallica)', books: '170+', access: 'IIIF direct' },
  { name: 'Biblioteca Nazionale Centrale di Firenze', books: '165+', access: 'via Internet Archive' },
  { name: 'National Central Library of Rome', books: '160+', access: 'via Internet Archive' },
  { name: 'Peking University Library', books: '135+', access: 'via CADAL' },
  { name: 'Harvard University', books: '115+', access: 'via Internet Archive' },
  { name: 'University of Michigan', books: '115+', access: 'via Internet Archive' },
  { name: 'Wellcome Library', books: '105+', access: 'IIIF direct + via IA' },
  { name: 'Biblioteca Medicea Laurenziana', books: '100+', access: 'IIIF direct' },
  { name: 'Bodleian Library, Oxford', books: '90+', access: 'IIIF direct + via IA' },
  { name: 'Biblioteca Apostolica Vaticana', books: '85+', access: 'IIIF direct' },
  { name: 'Smithsonian Libraries', books: '65+', access: 'via Internet Archive' },
  { name: 'Boston Public Library', books: '65+', access: 'via Internet Archive' },
  { name: 'Library of Congress', books: '60+', access: 'IIIF direct' },
];

export default function WorldsLargestCollectionPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="The World&rsquo;s Largest Collection of Translated Ancient and Early Modern Texts"
          subtitle="4,200+ books translated, 800,000+ pages, 100+ languages &mdash; free and open to everyone"
        >
          <p className="text-stone-400 text-sm mt-4">12 March 2026 &middot; 8 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="mb-8">
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors text-sm"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All notes
        </Link>
      </div>

      <article className="prose-content max-w-none">
        {/* Lede */}
        <p className="text-xl text-secondary leading-relaxed mb-8 font-body">
          Source Library now holds over 4,200 books translated into English &mdash; 1,300+ fully
          translated, with the remainder in progress &mdash; spanning Latin, German, Chinese,
          Sumerian, Sanskrit, Greek, French, and dozens of other languages across 100+ in total.
          With more than 800,000 translated pages, it is the world&rsquo;s largest collection
          of ancient and early modern texts made available in English.
        </p>

        <p className="text-secondary leading-relaxed mb-10 font-body">
          No comparable project &mdash; print or digital &mdash; comes close to this scale.
          The Loeb Classical Library, founded in 1911, has published roughly 540 volumes. The I Tatti
          Renaissance Library reached its 100th volume in 2025 after 24 years. Perseus hosts about
          1,000 public domain translations of Greek and Latin classics. Source Library has more
          translated books than all of them combined &mdash; and every page is free. Of these,
          2,400+ are <em>first-ever</em> English translations &mdash; texts that have never
          appeared in English before in any form.
        </p>

        {/* === Comparison chart: print series === */}
        <div className="my-12 bg-warm rounded-lg border border-border-light p-6 md:p-8">
          <h3 className="font-serif text-xl text-primary mb-6">Translated texts by collection</h3>
          <div className="space-y-4">
            {PRINT_SERIES.map((col) => (
              <div key={col.name}>
                <div className="flex justify-between items-baseline mb-1">
                  <span className="text-sm text-secondary font-medium">{col.name}</span>
                  <span className="text-xs text-muted">
                    {col.count.toLocaleString()} texts &middot; {col.access}
                  </span>
                </div>
                <div className="w-full bg-cream rounded-full h-6 overflow-hidden">
                  <div
                    className="h-6 rounded-full flex items-center pl-2"
                    style={{
                      width: `${Math.max((col.count / MAX_COUNT) * 100, 3)}%`,
                      backgroundColor: col.color,
                    }}
                  >
                    <span className="text-xs text-white font-medium">{col.count.toLocaleString()}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted mt-4">
            Loeb counts from Harvard UP catalog. I Tatti milestone from Harvard UP announcement (March 2025).
            Dumbarton Oaks and TTH from publisher catalogs.
          </p>
        </div>

        {/* === Stat block === */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 my-12">
          {[
            { number: '4,284', label: 'Books translated' },
            { number: '800,000+', label: 'Pages translated' },
            { number: '10,083', label: 'Total books' },
            { number: '76,000+', label: 'Extracted illustrations' },
          ].map((stat) => (
            <div key={stat.label} className="text-center py-5 px-3 bg-warm rounded-lg border border-border-light">
              <div className="font-serif text-3xl md:text-4xl text-accent-rust mb-1">{stat.number}</div>
              <div className="text-xs text-muted leading-tight">{stat.label}</div>
            </div>
          ))}
        </div>

        <hr className="border-border-light my-12" />

        {/* === Section 1: What makes this different === */}
        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            What makes this different
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The comparison deserves context. The Loeb Classical Library, I Tatti Renaissance Library,
            and Dumbarton Oaks Medieval Library are among the most important scholarly publishing
            projects of the past century. Each volume is edited by specialists, reviewed by peers,
            and published with critical apparatus, introductions, and notes. They are works of deep
            expertise produced over years or decades per volume.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Source Library&rsquo;s translations are produced by AI &mdash; specifically, Google&rsquo;s
            Gemini vision models reading directly from digitized page images. The original text is
            always preserved alongside the translation for verification. These are working translations:
            the first time a modern English reader can sit down and read these texts from beginning
            to end. They are not critical editions.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            But this is precisely the point. The Loeb Classical Library has been publishing for over
            a century and has produced 540 volumes. At that rate, translating the roughly 2,400 books
            in Source Library that are{' '}
            <Link href="/blog/first-translations" className="text-accent-rust hover:underline">
              first-ever English translations
            </Link>{' '}
            would take another 450 years. The traditional model produces extraordinary quality.
            It does not produce access at scale.
          </p>

          {/* Pull quote */}
          <div className="border-l-4 border-accent-rust pl-6 my-10">
            <p className="text-lg text-secondary italic font-body leading-relaxed">
              For 2,400+ of these books, the alternative is not a better translation.
              The alternative is no translation at all.
            </p>
          </div>

          <p className="text-secondary leading-relaxed font-body">
            A Latin alchemical treatise from 1617 that has never been rendered into English is
            invisible to anyone who cannot read 17th-century Latin. An imperfect translation that
            makes the text legible for the first time is, we believe, a genuine contribution &mdash;
            one that complements rather than competes with traditional scholarship.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* === Section 2: Digital libraries comparison === */}
        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            What about other digital libraries?
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Print series like Loeb are one kind of comparator. The more natural question is:
            what about the major digital text projects? The Internet Archive, Perseus, the Chinese
            Text Project, Project Gutenberg, Sacred Texts &mdash; between them, they make millions
            of pages available online. How can Source Library be larger?
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The answer lies in a distinction that matters enormously: <em>hosting</em> existing
            translations versus <em>creating</em> new ones.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Start with the biggest.{' '}
            <a href="https://archive.org/" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">
              The Internet Archive
            </a>{' '}
            holds over 40 million digitized texts, including thousands of English translations of
            classical, medieval, and early modern works &mdash; every old Bohn&rsquo;s Classical Library
            volume, the Sacred Books of the East, countless 19th-century renderings of Greek, Latin, and
            Sanskrit texts. It is, in fact, Source Library&rsquo;s primary upstream source: over 5,600 of
            our books come from IA&rsquo;s digitized collections. But the Internet Archive is a general-purpose
            archive. It preserves and hosts what already exists. The translations it contains were published
            decades or centuries ago and happen to be in its collection. It does not produce new translations,
            and it does not organize its holdings as a curated translation library.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The{' '}
            <a href="https://scaife.perseus.org/" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">
              Perseus Digital Library
            </a>{' '}
            is the definitive digital repository for Greek and Latin texts. Its catalog contains roughly
            1,000 English translations of classical works. But these are all pre-existing public domain
            translations &mdash; Victorian-era Loeb editions, 19th-century scholarly renderings, works
            that were already available in university libraries. Perseus digitized them superbly and made
            them searchable. It did not translate anything new.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The same is true of{' '}
            <a href="https://sacred-texts.com/" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">
              Sacred Texts
            </a>{' '}
            (~1,700 books, all public domain reprints),{' '}
            <a href="https://www.gutenberg.org/" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">
              Project Gutenberg
            </a>{' '}
            (thousands of translated works, but all pre-1928 and heavily skewed toward modern-language
            novels &mdash; Tolstoy, Dumas, Verne &mdash; not pre-modern scholarly texts), and{' '}
            <a href="https://penelope.uchicago.edu/Thayer/E/Roman/home.html" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">
              LacusCurtius
            </a>{' '}
            (~75 rekeyed Loeb volumes). These are invaluable resources. But they are libraries of
            existing translations, not producers of new ones.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The{' '}
            <a href="https://ctext.org/" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">
              Chinese Text Project
            </a>{' '}
            is the closest parallel to what Source Library is doing. With over 30,000 pre-modern Chinese
            texts and a recent AI translation initiative covering the pre-Qin philosophical canon and the
            25 Standard Histories, ctext.org is also using AI to make pre-modern texts readable for the
            first time. Their English translation coverage is currently in the hundreds of works. Source
            Library has broader language coverage but ctext.org goes far deeper into the Chinese
            literary tradition.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Stanford&rsquo;s{' '}
            <a href="https://sourcebook.stanford.edu/" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">
              Global Medieval Sourcebook
            </a>{' '}
            deserves mention as one of the few projects producing genuinely new scholarly translations
            of pre-modern texts, with about 200 works &mdash; each translated by specialists.
          </p>

          {/* Digital libraries comparison table */}
          <div className="bg-warm rounded-lg border border-border-light p-6 md:p-8 overflow-x-auto">
            <h3 className="font-serif text-xl text-primary mb-4">Digital libraries with English translations</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-medium">
                  <th className="text-left py-2 text-secondary font-medium">Project</th>
                  <th className="text-right py-2 text-secondary font-medium px-4">Translations</th>
                  <th className="text-left py-2 text-secondary font-medium">New?</th>
                  <th className="text-left py-2 text-secondary font-medium hidden md:table-cell">Note</th>
                </tr>
              </thead>
              <tbody>
                {DIGITAL_LIBRARIES.map((lib) => (
                  <tr key={lib.name} className="border-b border-border-light">
                    <td className="py-2.5 text-secondary font-medium">{lib.name}</td>
                    <td className="py-2.5 text-right px-4 text-muted tabular-nums">
                      {lib.translations ? `~${lib.translations.toLocaleString()}` : 'thousands'}
                    </td>
                    <td className="py-2.5">
                      {lib.newTranslations ? (
                        <span className="text-status-success text-xs font-medium">New</span>
                      ) : (
                        <span className="text-muted text-xs">Existing</span>
                      )}
                    </td>
                    <td className="py-2.5 text-xs text-muted hidden md:table-cell">{lib.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-muted mt-4">
              Perseus count estimated from catalog. Sacred Texts from site listing.
              ctext.org AI translations announced March 2026.
              Global Medieval Sourcebook from Stanford project page.
            </p>
          </div>

          <p className="text-secondary leading-relaxed mt-6 font-body">
            EEBO-TCP (60,000+ early English printed books) and HathiTrust (18 million digitized volumes)
            are sometimes mentioned in this context, but neither is a translation project &mdash; they
            provide access to texts in their original languages. The Internet Archive is the largest
            digital library in the world, but it is an archive, not a translator. Source Library uses
            IA as its primary source of page images and then does something IA does not: translates them.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* === Section 3: Languages === */}
        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            100+ languages and counting
          </h2>

          <p className="text-secondary leading-relaxed mb-8 font-body">
            The collection spans far more than the Latin and Greek of the classical tradition.
            German Fraktur manuscripts, Sumerian cuneiform tablets, Chinese rare books from the
            Library of Congress, Sanskrit astrological treatises, Hebrew Kabbalistic texts, Greek
            Church Fathers, Dutch pamphlets, and Italian humanist texts &mdash; across 104
            languages in total &mdash; all flow through the same pipeline.
          </p>

          <div className="bg-warm rounded-lg border border-border-light p-6 md:p-8">
            <h3 className="font-serif text-xl text-primary mb-6">Source languages</h3>
            <div className="space-y-3">
              {LANGUAGES.map((l) => (
                <div key={l.lang} className="flex items-center gap-3">
                  <span className="text-sm text-secondary w-40 shrink-0">{l.lang}</span>
                  <div className="flex-1 bg-cream rounded-full h-4 overflow-hidden">
                    <div
                      className="h-4 rounded-full bg-accent-rust"
                      style={{ width: `${(l.n / MAX_LANG) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted w-12 text-right">{l.n}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <hr className="border-border-light my-12" />

        {/* === Section 4: IIIF === */}
        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            160+ libraries, one pipeline
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Source Library draws on books from over 160 libraries and institutions worldwide.
            Some &mdash; the Bavarian State Library, the Biblioth&egrave;que nationale de France,
            the Bodleian, the Vatican &mdash; expose their collections directly through the{' '}
            <a href="https://iiif.io/" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">
              International Image Interoperability Framework
            </a>{' '}
            (IIIF). Others are accessible through the Internet Archive, which hosts digitized
            books from hundreds of contributing libraries &mdash; the Getty Research Institute,
            the Koninklijke Bibliotheek, the Biblioteca Nazionale in Florence, Harvard, and
            many more.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            IIIF is the infrastructural key. Because these institutions expose their digitized
            pages through a standard protocol, Source Library can consume images from any of them
            through a single, uniform input layer. Adding a new institutional source requires only
            a manifest parser. The entire downstream pipeline &mdash; OCR, translation, illustration
            detection, metadata enrichment, scholarly edition publishing &mdash; works unchanged
            regardless of origin.
          </p>

          <p className="text-secondary leading-relaxed mb-8 font-body">
            IIIF was designed to make images interoperable for human viewers. It turns out to be
            even more transformative when the consumer is an AI model. A standardized way to access
            page images at arbitrary resolution from any institution is exactly what an automated
            translation pipeline needs. The interoperability promise of IIIF &mdash; write once,
            access anywhere &mdash; becomes a force multiplier for AI-powered scholarship.
          </p>

          {/* Institutional sources table */}
          <div className="bg-warm rounded-lg border border-border-light p-6 md:p-8">
            <h3 className="font-serif text-xl text-primary mb-4">Largest source institutions</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2">
              {SOURCE_INSTITUTIONS.map((p) => (
                <div key={p.name} className="flex justify-between py-1.5 border-b border-border-light last:border-0">
                  <span className="text-sm text-secondary">{p.name}</span>
                  <span className="text-xs text-muted">{p.books}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted mt-4">
              160+ institutions total. Many contribute through the Internet Archive and Google Books
              digitization programs. Counts reflect books currently in the collection.
            </p>
          </div>
        </section>

        <hr className="border-border-light my-12" />

        {/* === Section 5: The pipeline === */}
        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            From manifest to readable book
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Every book in Source Library follows the same automated pipeline:
          </p>

          <div className="space-y-4 mb-8">
            {[
              { step: 'Import', desc: 'IIIF manifest consumed, page images registered in the database' },
              { step: 'Archive', desc: 'Images downloaded and re-hosted for long-term preservation' },
              { step: 'Split detection', desc: 'Two-page spreads identified and cropped into individual pages' },
              { step: 'OCR', desc: 'Gemini vision models read the page images, producing text in the original language' },
              { step: 'Metadata enrichment', desc: 'AI analysis classifies language, subject, century, and determines if this is a first English translation' },
              { step: 'Translation', desc: 'Original text translated into modern English with previous-page context for continuity' },
              { step: 'Enrichment', desc: 'Reading summary, index of people/places/concepts, and chapter structure generated' },
              { step: 'Image extraction', desc: 'Illustrations, emblems, diagrams, and maps detected with bounding boxes and museum-style descriptions' },
              { step: 'Edition publishing', desc: 'Scholarly editions with DOIs minted via Zenodo for citability' },
            ].map((item, i) => (
              <div key={item.step} className="flex gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-accent-rust/10 flex items-center justify-center">
                  <span className="text-sm font-medium text-accent-rust">{i + 1}</span>
                </div>
                <div>
                  <span className="text-sm font-medium text-primary">{item.step}.</span>{' '}
                  <span className="text-sm text-secondary">{item.desc}</span>
                </div>
              </div>
            ))}
          </div>

          <p className="text-secondary leading-relaxed font-body">
            The entire pipeline is automated. A newly imported book typically reaches full translation
            within hours. The cost averages roughly $2 per book for a 300-page volume &mdash; about
            what a single page of professional human translation costs.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* === Section 6: Mission === */}
        <section className="mb-16">
          <h2 className="font-serif text-2xl md:text-3xl text-primary mb-6">
            Translate the Renaissance, create a new one
          </h2>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            Source Library is an initiative of the{' '}
            <a href="https://embassyofthefreemind.com/" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">
              Embassy of the Free Mind
            </a>{' '}
            in Amsterdam, home to the Bibliotheca Philosophica Hermetica &mdash; a collection
            of over 25,000 volumes in Hermeticism, alchemy, mysticism, and the history of ideas,
            awarded UNESCO Memory of the World status in 2022.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The physical collection is extraordinary. But the ambition of Source Library goes beyond
            any single set of shelves. By using IIIF to curate texts from institutions across Europe
            and beyond, we are assembling the broadest possible view of early modern intellectual
            life &mdash; theology, natural philosophy, medicine, mathematics, mysticism, alchemy,
            astrology, and literature &mdash; and making all of it readable in English for the first time.
          </p>

          <p className="text-secondary leading-relaxed mb-6 font-body">
            The premise is simple: the ideas that drove the Renaissance &mdash; the conviction
            that ancient wisdom could be recovered, that nature could be understood through
            observation and experiment, that human knowledge was cumulative and improvable &mdash;
            are not only of historical interest. They are ideas the world needs now. But they have
            been locked behind languages that fewer and fewer people can read.
          </p>

          <p className="text-secondary leading-relaxed font-body">
            Over 4,200 books are now unlocked &mdash; 2,400+ of them for the first time in English.
            The collection is growing every day. And every page is free.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        {/* === CTA === */}
        <section className="mb-16 text-center">
          <h2 className="font-serif text-2xl text-primary mb-4">
            Explore the collection
          </h2>
          <div className="flex flex-wrap justify-center gap-4">
            <Link
              href="/"
              className="inline-block bg-accent-rust text-white px-6 py-3 rounded-lg hover:bg-accent-rust/90 transition-colors font-medium"
            >
              Browse the library
            </Link>
            <Link
              href="/blog/first-translations"
              className="inline-block border border-accent-rust text-accent-rust px-6 py-3 rounded-lg hover:bg-accent-rust/5 transition-colors font-medium"
            >
              First English translations
            </Link>
            <Link
              href="/gallery"
              className="inline-block border border-accent-rust text-accent-rust px-6 py-3 rounded-lg hover:bg-accent-rust/5 transition-colors font-medium"
            >
              Illustration gallery
            </Link>
          </div>
        </section>

        <BlogComments slug="worlds-largest-collection" />
        <InputWidget />
      </article>
    </ContentPageLayout>
  );
}
