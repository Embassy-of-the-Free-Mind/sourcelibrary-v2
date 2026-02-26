import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'February 2026 Update — Source Library',
  description:
    'Two months in: 4,400+ books, 30+ languages, a full AI pipeline, and the plan to build a real institution.',
  alternates: { canonical: '/letter' },
};

export default function LetterPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Two Months of Source Library"
          subtitle="February 2026 Update"
        />
      }
      bg="bg-cream"
    >
      <div className="prose-content max-w-none">
        <p className="text-muted text-sm mb-8">February 26, 2026 &middot; Derek Lomas, Program Director</p>

        {/* ── Opening: A specific book ── */}
        <p className="text-xl text-secondary leading-relaxed mb-6">
          In 1400, an unknown Arabic scholar compiled the{' '}
          <a href="https://sourcelibrary.org/book/6953b56577f38f6761bd979d" className="text-accent-rust hover:underline"><em>Kit&#257;b al-Bulh&#257;n</em></a>{' '}
          &mdash; a &ldquo;Book of Wonders&rdquo; filled with zodiacal illustrations, demonic portraits,
          and cosmological diagrams. The manuscript has been digitized by the Bodleian Library, but for
          six centuries its Arabic text has been inaccessible to most of the world. Today, you can read
          every page in English on Source Library. It took about fifteen minutes to process and cost $2.87.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          That book is one of 4,400. In 77 days, Source Library has become the world&apos;s largest
          collection of translated historical primary sources &mdash; spanning 30+ languages, 13 digital
          library sources, and more than a million and a half page images.
        </p>

        {/* ── Why It Matters ── */}
        <h2 className="text-2xl md:text-3xl text-primary mt-12 mb-6">Why This Matters Now</h2>

        <p className="text-secondary leading-relaxed mb-4">
          The first Renaissance was, at its core, a translation project. When Ficino translated the{' '}
          <em>Corpus Hermeticum</em> for Cosimo de&apos; Medici in 1463, he didn&apos;t just render Greek into
          Latin &mdash; he made an entire tradition of thought accessible to a civilization that had lost
          touch with it. That single act of recovery helped ignite a transformation in art, science,
          philosophy, and the Western understanding of what it means to be human.
        </p>

        <p className="text-secondary leading-relaxed mb-4">
          Today, we face a different kind of forgetting. The intellectual traditions that shaped
          the modern world &mdash; Hermetic philosophy, Neoplatonism, alchemical science, Kabbalistic
          cosmology, the Arabic transmission of Greek thought &mdash; remain locked in languages most
          people can&apos;t read, in archives most people can&apos;t visit. Scholars spend entire careers
          translating a single text. The vast majority of the pre-modern intellectual heritage has
          never been translated at all.
        </p>

        <p className="text-secondary leading-relaxed mb-4">
          This matters because the questions these thinkers wrestled with &mdash; the nature of consciousness,
          the relationship between mind and cosmos, the possibility of transforming the self through
          knowledge &mdash; are precisely the questions our civilization is struggling with again. As AI
          reshapes what it means to think, as the ecological crisis forces us to rethink our relationship
          with nature, as meaning-making becomes the central challenge of modern life, the insights of
          five centuries of deep inquiry are not academic curiosities. They are resources we need.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          Source Library exists to make those resources available &mdash; to scholars, to seekers, and
          to the AI systems that are increasingly shaping how humanity thinks. Not in fifty years. Now.
        </p>

        {/* ── What you can do ── */}
        <h2 className="text-2xl md:text-3xl text-primary mt-12 mb-6">What You Can Do Right Now</h2>

        <p className="text-secondary leading-relaxed mb-4">
          Go to{' '}
          <a href="https://sourcelibrary.org" className="text-accent-rust hover:underline">sourcelibrary.org</a>{' '}
          and try it. Pick a book &mdash; any book. You&apos;ll see the original scanned pages side by side with
          an English translation. You can search across the full text of the entire collection. You can browse
          a gallery of 71,000+ extracted illustrations. You can explore an encyclopedia that links people, places,
          and ideas across books and centuries.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Here are a few places to start:
        </p>

        <div className="space-y-4 mb-8">
          {[
            {
              title: 'Atalanta Fugiens',
              author: 'Michael Maier, 1618',
              detail: 'Fifty alchemical emblems with Latin verse, musical fugues, and allegorical commentary. 229 pages, fully translated from Latin.',
              href: 'https://sourcelibrary.org/book/69520c46ab34727b1f044141',
            },
            {
              title: 'Corpus Hermeticum: Pimander',
              author: 'Marsilio Ficino, 1481',
              detail: 'Ficino\u2019s Latin translation of the Hermetic texts that launched the Renaissance revival of ancient theology. 96 pages.',
              href: 'https://sourcelibrary.org/book/694f3d6cbe37f451a5324e10',
            },
            {
              title: 'Three Books of Occult Philosophy',
              author: 'Heinrich Cornelius Agrippa, 1550',
              detail: 'The foundational encyclopedia of Renaissance magic and natural philosophy. 626 pages, fully translated from Latin.',
              href: 'https://sourcelibrary.org/book/694bf8d2343422769f237558',
            },
            {
              title: 'Sepher Maphteah Shelomo (Key of Solomon)',
              author: 'Anonymous, 17th century',
              detail: 'A Hebrew manuscript of ceremonial magic with diagrams and incantations. 192 pages, fully translated from Hebrew.',
              href: 'https://sourcelibrary.org/book/695285cdab34727b1f04c25a',
            },
            {
              title: 'Utriusque Cosmi Historia',
              author: 'Robert Fludd, 1617',
              detail: 'Fludd\u2019s illustrated history of the macrocosm and microcosm \u2014 one of the most ambitious cosmological works of the early modern period. 1,036 pages.',
              href: 'https://sourcelibrary.org/book/6952dac677f38f6761bc683a',
            },
          ].map(b => (
            <a key={b.title} href={b.href} className="block bg-white rounded-lg p-4 border border-border-light hover:border-accent-rust/30 transition-colors">
              <div className="text-primary font-medium">{b.title}</div>
              <div className="text-muted text-sm mb-1">{b.author}</div>
              <div className="text-secondary text-sm">{b.detail}</div>
            </a>
          ))}
        </div>

        <p className="text-secondary leading-relaxed mb-8">
          None of these texts had a freely available English translation before. Some had never been fully
          translated at all. A scholar working with the Latin originals might spend years producing a
          critical edition of one. The AI translations are not critical editions &mdash; they&apos;re first
          drafts. But they make the texts <em>accessible</em>, and accessibility is what turns a rare book
          collection into a living research library.
        </p>

        {/* ── The Numbers ── */}
        <h2 className="text-2xl md:text-3xl text-primary mt-12 mb-6">The Numbers</h2>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
          {[
            { value: '4,430+', label: 'Books in collection' },
            { value: '1.67M', label: 'Page images' },
            { value: '467K', label: 'Pages with OCR' },
            { value: '285K', label: 'Pages translated' },
            { value: '1,077', label: 'Fully processed books' },
            { value: '71K', label: 'Illustrations extracted' },
            { value: '30+', label: 'Languages' },
            { value: '~$4,200', label: 'Total AI cost' },
            { value: '77 days', label: 'Since first commit' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-lg p-3 border border-border-light text-center">
              <div className="text-xl font-serif text-accent-rust">{s.value}</div>
              <div className="text-muted text-xs">{s.label}</div>
            </div>
          ))}
        </div>

        <p className="text-secondary leading-relaxed mb-4">
          The cost figure is worth lingering on. <strong>$4,200 in total AI processing costs</strong> to OCR,
          translate, summarize, index, and extract illustrations from 4,400+ books. The average cost to fully
          process a single book is about <strong>$2.40</strong>. Using batch processing, it drops
          to <strong>$1.40</strong>.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          For context: a professional human translation of a 300-page Latin text costs $30,000&ndash;$60,000
          and takes months. The AI does a credible first draft in minutes for $2.40. This doesn&apos;t
          replace scholarly translation &mdash; it <em>enables</em> it, by giving scholars a working draft to
          refine rather than asking them to start from a blank page.
        </p>

        {/* ── How It Works ── */}
        <h2 className="text-2xl md:text-3xl text-primary mt-12 mb-6">How It Works</h2>

        <p className="text-secondary leading-relaxed mb-4">
          Source Library connects to 13 digital library sources worldwide &mdash; Internet Archive, Gallica,
          the Bavarian State Library, the Bodleian, the Vatican, Cambridge, and seven more. When a book is
          imported, the system runs it through a fully automated pipeline:
        </p>

        <ol className="space-y-3 text-secondary mb-8 list-decimal list-inside">
          <li><strong>Archive</strong> page images to our own storage for reliability and speed</li>
          <li><strong>OCR</strong> with language-specific AI prompts that handle Fraktur, Latin abbreviations, multi-column layouts, and drop caps</li>
          <li><strong>Translate</strong> to English with cross-page context continuity (or modernize Early Modern English)</li>
          <li><strong>Enrich</strong> with AI-generated summaries, indexes of people, places, and concepts, and chapter extraction</li>
          <li><strong>Extract</strong> illustrations, emblems, and diagrams with museum-style metadata</li>
        </ol>

        <p className="text-secondary leading-relaxed mb-8">
          The pipeline runs autonomously &mdash; a cron advances books through each stage every ten minutes.
          Once a book is imported, no human intervention is needed until a scholar wants to review the output.
          For the technically inclined, the{' '}
          <Link href="/progress" className="text-accent-rust hover:underline">development timeline</Link>{' '}
          shows how this was built over 1,024 commits in 77 days.
        </p>

        {/* ── What We Learned ── */}
        <h2 className="text-2xl md:text-3xl text-primary mt-12 mb-6">What We&apos;ve Learned</h2>

        <div className="space-y-6 mb-8">
          <div className="border-l-4 border-accent-sage/30 pl-6">
            <p className="text-primary font-medium mb-2">AI translation quality is better than expected.</p>
            <p className="text-secondary text-sm leading-relaxed">
              We&apos;ve processed texts in Latin, German Fraktur, Arabic, Hebrew, Classical Chinese, Dutch,
              Italian, French, Spanish, and more. The output isn&apos;t perfect &mdash; specialists will find
              errors, and the AI sometimes misses period-specific idioms. But for making a 16th-century Latin
              treatise comprehensible to a graduate student, or giving a researcher their first orientation in
              an unfamiliar text, the quality is genuinely useful. The translations are first drafts, not final
              products &mdash; but first drafts are what scholarship needs most.
            </p>
          </div>

          <div className="border-l-4 border-accent-rust/30 pl-6">
            <p className="text-primary font-medium mb-2">The technology is not the hard part.</p>
            <p className="text-secondary text-sm leading-relaxed">
              Building the pipeline took two months and $4,200. But technology without scholarship is a
              curiosity. Someone has to decide which texts matter, validate the AI output, contextualize
              the translations, and connect the work to living research communities. That requires people &mdash;
              scholars, librarians, editors &mdash; and people require sustained funding. The technology is
              ready. The institutional structure is what needs building.
            </p>
          </div>

          <div className="border-l-4 border-accent-violet/30 pl-6">
            <p className="text-primary font-medium mb-2">Scanning, not AI, is the bottleneck.</p>
            <p className="text-secondary text-sm leading-relaxed">
              The Embassy of the Free Mind holds approximately 25,000 volumes. Most are unscanned. AI can
              translate a scan in minutes, but creating a high-quality scan of a 500-year-old binding
              requires physical access, careful handling, and professional equipment. The books that need
              translating most are the books that haven&apos;t been digitized yet. This is where funding
              has the highest return.
            </p>
          </div>

          <div className="border-l-4 border-accent-gold/30 pl-6">
            <p className="text-primary font-medium mb-2">Open access changes who can participate.</p>
            <p className="text-secondary text-sm leading-relaxed">
              When Pico della Mirandola&apos;s{' '}
              <a href="https://sourcelibrary.org/book/694f8d99efce46492e19fdad" className="text-accent-rust hover:underline"><em>900 Theses</em></a>{' '}
              is only available in a $200 academic edition or behind a university paywall, the study of
              Renaissance philosophy is limited to people at well-funded institutions. When it&apos;s freely
              available with a readable English translation, a student in Lagos or Lima can engage with the
              same primary sources as a professor at the Warburg Institute. That&apos;s the point.
            </p>
          </div>
        </div>

        {/* ── Where We're Going ── */}
        <h2 className="text-2xl md:text-3xl text-primary mt-12 mb-6">What Comes Next</h2>

        <p className="text-secondary leading-relaxed mb-4">
          Source Library is a program of the{' '}
          <a href="https://embassyofthefreemind.com" className="text-accent-rust hover:underline">Embassy of the Free Mind</a>{' '}
          in Amsterdam, which holds one of the world&apos;s great collections of Hermetic, alchemical, and
          esoteric manuscripts. The technology works. The collection exists. What&apos;s needed now is the
          institutional structure to sustain it.
        </p>

        <p className="text-secondary leading-relaxed mb-4">
          We&apos;ve published a{' '}
          <Link href="/plan" className="text-accent-rust hover:underline">full strategic plan and budget</Link>{' '}
          built from first principles:
        </p>

        <div className="bg-accent-gold/5 rounded-lg p-6 border border-accent-gold/15 mb-8">
          <p className="text-stone-700 leading-relaxed mb-4">
            <strong>$1.2M/year for 3 years</strong> to build Source Library into a permanent institution:
          </p>
          <ul className="text-stone-600 text-sm space-y-2">
            <li><strong>Scanning</strong> &mdash; 1,000&ndash;1,300 books/year from EFM and partner libraries ($250K)</li>
            <li><strong>Core team</strong> &mdash; Program director, digital humanities lead, research coordinator ($260K)</li>
            <li><strong>Scholarly engagement</strong> &mdash; Advisory board, 6 visiting scholars, 25 scholarly editions, 5 research commissions ($220K)</li>
            <li><strong>Public engagement</strong> &mdash; Press, documentary series, patron program, touring exhibition ($200K)</li>
            <li><strong>Infrastructure</strong> &mdash; AI processing, hosting, preservation ($100K)</li>
          </ul>
        </div>

        <p className="text-secondary leading-relaxed mb-4">
          The proposition is straightforward: <strong>$1.2M/year would make Source Library the world&apos;s
          leading translated primary source library within three years.</strong> No comparable effort exists
          at any budget. The technology has been proven. The physical collection &mdash; 25,000 volumes,
          many unscanned, spanning five centuries of intellectual history &mdash; is waiting.
        </p>

        <p className="text-secondary leading-relaxed mb-4">
          Cosimo de&apos; Medici funded one translator working on one manuscript, and it helped launch
          the Renaissance. The opportunity before us is to do what Cosimo did &mdash; but for thousands
          of texts at once, making them freely available to the entire world.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          If you are interested in this work &mdash; as a funder, scholar, or partner institution &mdash;
          we would welcome the conversation.
        </p>

        {/* Sign-off */}
        <div className="border-t border-border-light pt-8 mb-8">
          <p className="text-secondary mb-1">Derek Lomas</p>
          <p className="text-muted text-sm">Program Director, Source Library</p>
          <p className="text-muted text-sm">Embassy of the Free Mind, Amsterdam</p>
        </div>

        {/* Links */}
        <div className="flex flex-wrap gap-4 pt-4">
          <Link
            href="/"
            className="px-5 py-2.5 bg-stone-900 text-white rounded-full hover:bg-stone-800 transition-colors"
          >
            Browse the Library
          </Link>
          <Link
            href="/plan"
            className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
          >
            Strategic Plan & Budget
          </Link>
          <Link
            href="/progress"
            className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
          >
            Development Timeline
          </Link>
          <Link
            href="/fulldata"
            className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
          >
            Full Collection Data
          </Link>
        </div>
      </div>
    </ContentPageLayout>
  );
}
