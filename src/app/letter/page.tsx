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

        <p className="text-xl text-secondary leading-relaxed mb-6">
          In December 2025, Source Library was a Next.js scaffold with a MongoDB connection.
          Today it holds 4,400+ books in 30+ languages with AI-powered OCR, translation,
          and scholarly publishing — and it cost about $4,200 in AI processing to get here.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          This letter is an honest account of what we&apos;ve built, what we&apos;ve learned, and where we&apos;re going.
          The short version: the technology works better than we hoped. The question now isn&apos;t whether
          AI can translate historical texts — it&apos;s how to build the institution around it.
        </p>

        {/* ── What Exists ── */}
        <h2 className="text-2xl md:text-3xl text-primary mt-12 mb-6">What Exists Today</h2>

        <p className="text-secondary leading-relaxed mb-4">
          Source Library is a web application at{' '}
          <a href="https://sourcelibrary.org" className="text-accent-rust hover:underline">sourcelibrary.org</a>.
          Anyone can browse the collection, read original texts alongside English translations,
          explore a gallery of 71,000+ extracted illustrations, and search across the entire corpus.
        </p>

        <p className="text-secondary leading-relaxed mb-4">
          Behind the public site is an automated pipeline that processes books from import to completion:
        </p>

        <ol className="space-y-3 text-secondary mb-8 list-decimal list-inside">
          <li><strong>Import</strong> from 13 digital library sources (Internet Archive, Gallica, Bavarian State Library, Bodleian, Vatican, Cambridge, and 7 more)</li>
          <li><strong>Archive</strong> page images to our own storage for reliability and speed</li>
          <li><strong>OCR</strong> with language-specific AI prompts that handle Fraktur, Latin abbreviations, multi-column layouts, and drop caps</li>
          <li><strong>Translate</strong> to English with cross-page context continuity (or modernize Early Modern English)</li>
          <li><strong>Enrich</strong> with AI-generated summaries, indexes of people/places/concepts, and chapter extraction</li>
          <li><strong>Extract</strong> illustrations, emblems, and diagrams with museum-style metadata</li>
        </ol>

        <p className="text-secondary leading-relaxed mb-8">
          The pipeline is fully automated — a cron runs every 10 minutes, advancing books through each stage.
          Three AWS Lambda workers handle OCR, translation, and image extraction in parallel.
          The Gemini Batch API provides 50% cost savings on large-scale processing.
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

        <p className="text-secondary leading-relaxed mb-8">
          The average cost to fully process a book — OCR, translation, summary, index, chapter extraction,
          image detection — is about <strong>$2.40</strong>. A 300-page Latin alchemical
          treatise costs roughly $2.40 to go from scanned images to a searchable, translated, indexed,
          illustrated digital edition. Using batch processing (50% discount), that drops to about $1.40.
        </p>

        {/* ── What We Built ── */}
        <h2 className="text-2xl md:text-3xl text-primary mt-12 mb-6">What We Built (Week by Week)</h2>

        <p className="text-secondary leading-relaxed mb-4">
          1,024 commits in 77 days. Here are the highlights:
        </p>

        <div className="space-y-4 mb-8">
          {[
            { week: 'Week 1 (Dec 12-18)', items: 'Project scaffold, MongoDB, first OCR and translation, custom prompts, split detection for two-page spreads' },
            { week: 'Week 2 (Dec 19-25)', items: 'Internet Archive import, batch OCR, MCP server for AI research tools, scholarly edition publishing, Gemini Batch API integration, chapter extraction, 97 commits on Christmas Day' },
            { week: 'Week 3 (Dec 26-Jan 1)', items: 'Image gallery with AI metadata, annotations and highlights, encyclopedia (cross-book entity index), Gallica and MDZ importers, social posting, XML annotation system, analytics' },
            { week: 'Week 4 (Jan 2-8)', items: 'Gallery redesign as discovery interface, SEO with structured data, about and developers pages, cron automation, gallery magnifier, batch image extraction' },
            { week: 'Week 5 (Jan 9-15)', items: 'Wellcome Collection, e-rara, Bodleian, Cambridge, Vatican, and HAB importers. Total library sources: 13. Unified search with diacritics support.' },
            { week: 'Weeks 6-7 (Jan 16-Feb 3)', items: 'Gallery collections and visitor bookshelves, Atom feeds, embedding-based similarity search, materialized views for fast rendering, thumbnail pipeline' },
            { week: 'Week 8 (Feb 4-10)', items: 'AWS Lambda workers (3 dedicated processors), SQS queue architecture, audit trail (every AI call logged), OG image improvements, homepage optimization (7.3MB to 1.4MB)' },
            { week: 'Week 9 (Feb 11-17)', items: 'Gemini Batch API for bulk OCR, IIIF manifests, Google Scholar meta tags, search UX overhaul, automated pipeline (import to complete), 6 new importers in one day, English modernization, blog launch' },
            { week: 'Weeks 10-11 (Feb 18-26)', items: 'Large-scale batch processing (700+ jobs), multi-key API management, pipeline quality validation, Wikidata alignment, attribution framework, strategic plan and budget' },
          ].map(w => (
            <div key={w.week} className="bg-white rounded-lg p-4 border border-border-light">
              <div className="text-primary font-medium text-sm mb-1">{w.week}</div>
              <div className="text-secondary text-sm">{w.items}</div>
            </div>
          ))}
        </div>

        <p className="text-secondary leading-relaxed mb-4">
          For the full development timeline with charts, see the{' '}
          <Link href="/progress" className="text-accent-rust hover:underline">progress page</Link>.
        </p>

        {/* ── What We Learned ── */}
        <h2 className="text-2xl md:text-3xl text-primary mt-12 mb-6">What We Learned</h2>

        <div className="space-y-4 mb-8">
          <div className="border-l-4 border-accent-sage/30 pl-6">
            <p className="text-primary font-medium mb-1">AI translation quality is surprisingly good.</p>
            <p className="text-secondary text-sm">
              Gemini handles Latin, German Fraktur, Arabic, Hebrew, Classical Chinese, and more.
              The output isn&apos;t perfect — it&apos;s a first draft — but it&apos;s good enough to make texts
              accessible to non-specialists, which is the whole point.
            </p>
          </div>

          <div className="border-l-4 border-accent-rust/30 pl-6">
            <p className="text-primary font-medium mb-1">The cost is negligible. The people aren&apos;t.</p>
            <p className="text-secondary text-sm">
              $4,200 in AI costs for 4,400 books. But someone has to decide what to scan, validate the output,
              engage scholars, write grants, and build institutional relationships. That&apos;s where the real
              investment goes.
            </p>
          </div>

          <div className="border-l-4 border-accent-violet/30 pl-6">
            <p className="text-primary font-medium mb-1">Scanning is the bottleneck, not translation.</p>
            <p className="text-secondary text-sm">
              The EFM holds ~25,000 volumes, most unscanned. AI can translate a scan in minutes. But creating
              a high-quality scan of a 500-year-old book requires physical access, careful handling, and
              professional equipment. This is where funding matters most.
            </p>
          </div>

          <div className="border-l-4 border-accent-gold/30 pl-6">
            <p className="text-primary font-medium mb-1">Scholar engagement is what turns this into an institution.</p>
            <p className="text-secondary text-sm">
              Without scholars validating, correcting, and building on the AI output, Source Library is a
              tech demo. With them, it&apos;s a research institution producing citable scholarship.
            </p>
          </div>
        </div>

        {/* ── Where We're Going ── */}
        <h2 className="text-2xl md:text-3xl text-primary mt-12 mb-6">Where We&apos;re Going</h2>

        <p className="text-secondary leading-relaxed mb-4">
          We&apos;ve published a{' '}
          <Link href="/plan" className="text-accent-rust hover:underline">full strategic plan and budget</Link>{' '}
          built from first principles. The summary:
        </p>

        <div className="bg-accent-gold/5 rounded-lg p-6 border border-accent-gold/15 mb-8">
          <p className="text-stone-700 leading-relaxed mb-4">
            <strong>$1.2M/year for 3 years</strong> to build Source Library into a real institution:
          </p>
          <ul className="text-stone-600 text-sm space-y-1">
            <li>3-person core team ($260K)</li>
            <li>Scan 1,000-1,300 books/year from EFM and partner libraries ($250K)</li>
            <li>Advisory board, 6 visiting scholars, 25 scholarly editions, 5 research commissions ($220K)</li>
            <li>Press, documentary series, patron program, touring exhibition ($200K)</li>
            <li>AI processing and infrastructure ($100K)</li>
          </ul>
        </div>

        <p className="text-secondary leading-relaxed mb-4">
          The pitch is simple: <strong>$1.2M/year makes Source Library the world&apos;s leading translated
          primary source library within 3 years.</strong> No one else is doing this at any budget.
          The technology works. The collection exists. The institutional home is ready.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          We&apos;re seeking an anchor funder (Arcadia Fund or Mellon Foundation) supplemented by NEH grants,
          tech philanthropy, and a patron program. If you&apos;re interested in supporting this work —
          as a funder, scholar, or partner institution — we&apos;d love to hear from you.
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
            Development Progress
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
