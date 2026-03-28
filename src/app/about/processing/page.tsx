import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { getDb } from '@/lib/mongodb';

export const metadata: Metadata = {
  title: 'How Processing Works | Source Library',
  description:
    'From scanned page images to searchable, translated text: how Source Library transforms rare historical books using AI.',
  alternates: { canonical: '/about/processing' },
};

// ISR: rebuild every 6 hours
export const revalidate = 21600;

/* ── Data fetching ── */

async function getStats() {
  try {
    const db = await getDb();
    const books = db.collection('books');

    const maxTimeMS = 10000;
    const [totalBooks, visibleBooks, pageAgg, languages, sources, funnel] =
      await Promise.all([
        books.countDocuments({}, { maxTimeMS }),
        books.countDocuments({ hidden: { $ne: true } }, { maxTimeMS }),
        books
          .aggregate([
            {
              $group: {
                _id: null,
                pages: { $sum: '$pages_count' },
                ocr: { $sum: '$pages_ocr' },
                translated: { $sum: '$pages_translated' },
              },
            },
          ], { maxTimeMS })
          .toArray(),
        books
          .aggregate([
            { $match: { hidden: { $ne: true }, language: { $exists: true, $ne: 'Unknown' } } },
            { $group: { _id: '$language', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 },
          ], { maxTimeMS })
          .toArray(),
        books
          .aggregate([
            { $match: { hidden: { $ne: true }, 'image_source.provider_name': { $exists: true } } },
            { $group: { _id: '$image_source.provider_name', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 8 },
          ], { maxTimeMS })
          .toArray(),
        books
          .aggregate([
            { $match: { 'pipeline_auto.status': { $exists: true } } },
            { $group: { _id: '$pipeline_auto.status', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
          ], { maxTimeMS })
          .toArray(),
      ]);

    const agg = pageAgg[0] || { pages: 0, ocr: 0, translated: 0 };
    const complete = funnel.find((f) => f._id === 'complete')?.count || 0;

    return {
      totalBooks,
      visibleBooks,
      totalPages: agg.pages as number,
      pagesOcr: agg.ocr as number,
      pagesTranslated: agg.translated as number,
      complete,
      languages: languages.map((l) => ({
        name: (l._id as string) || 'Unknown',
        count: l.count as number,
      })),
      sources: sources.map((s) => ({
        name: (s._id as string) || 'Unknown',
        count: s.count as number,
      })),
    };
  } catch {
    return null;
  }
}

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(n >= 10_000 ? 0 : 1) + 'k';
  return n.toLocaleString();
}

/* ── Pipeline stages ── */

const STAGES = [
  {
    name: 'Import',
    color: 'bg-stone-100 text-stone-600',
    icon: '1',
    summary: 'Books arrive from digital libraries worldwide',
    detail:
      'We import from 13 digital library sources including Internet Archive, Gallica (BnF), the Bavarian State Library, Wellcome Collection, and e-rara. Each import fetches metadata and high-resolution page images via IIIF manifests.',
  },
  {
    name: 'Archive',
    color: 'bg-accent-gold/8 text-accent-gold-dark',
    icon: '2',
    summary: 'Images preserved on our infrastructure',
    detail:
      'Original page images are archived from external sources to our own storage, ensuring long-term availability. Original URLs are always preserved for provenance. Thumbnails are generated for fast browsing.',
  },
  {
    name: 'OCR',
    color: 'bg-green-50 text-green-700',
    icon: '3',
    summary: 'AI reads historical typefaces and handwriting',
    detail:
      'Gemini vision models extract text from page images, handling blackletter (Fraktur), early modern Latin abbreviations, ligatures, and multi-column layouts. Language-specific prompts improve accuracy for Latin, German, and other languages. Pages are classified by type (text, illustration, title page, table of contents).',
  },
  {
    name: 'Translation',
    color: 'bg-blue-50 text-blue-700',
    icon: '4',
    summary: 'Latin, German, and other languages rendered into English',
    detail:
      'Pages are translated sequentially so the AI can maintain consistent terminology and handle sentences that cross page boundaries. English books from before 1700 are modernized from Early Modern English instead. The original language text is always preserved alongside the translation.',
  },
  {
    name: 'Enrichment',
    color: 'bg-violet-50 text-violet-700',
    icon: '5',
    summary: 'Summary, index, and metadata generated',
    detail:
      'AI generates a reading summary, extracts an index of people, places, concepts, and key terms, identifies the book\'s language and subject categories, and writes a scholarly description. This makes every book searchable and browsable.',
  },
  {
    name: 'Chapters',
    color: 'bg-violet-50 text-violet-700',
    icon: '6',
    summary: 'Structural divisions identified',
    detail:
      'Chapter and section headings are extracted from the OCR text and linked to specific pages, creating a navigable table of contents for the reader.',
  },
  {
    name: 'Images',
    color: 'bg-accent-gold/8 text-accent-gold-dark',
    icon: '7',
    summary: 'Illustrations and emblems detected and cataloged',
    detail:
      'AI vision scans every page for illustrations, emblems, diagrams, and decorative elements. Each detection includes bounding box coordinates, a description, subject tags, and a museum-style label. High-quality detections appear in the gallery.',
  },
  {
    name: 'Publication',
    color: 'bg-stone-100 text-stone-600',
    icon: '8',
    summary: 'Scholarly editions with DOIs',
    detail:
      'Completed books can be published as citable scholarly editions with DOIs minted through Zenodo. Each edition is an immutable snapshot with generated front matter, contributor attribution, and exports in multiple formats.',
  },
];

/* ── Page component ── */

export default async function ProcessingPage() {
  const stats = await getStats();

  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="How We Process Books"
          subtitle="From scanned page images to searchable, translated text. Every step is automated, auditable, and open."
        />
      }
      bg="bg-cream"
    >
      <div className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-12">
          Every book in Source Library passes through an automated pipeline that reads, translates,
          and enriches historical texts. The original source material is always preserved. AI
          processing adds layers of accessibility on top, never replacing what came before.
        </p>

        {/* ── Live stats ── */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-16">
            <StatCard label="Books" value={fmt(stats.visibleBooks)} />
            <StatCard label="Pages transcribed" value={fmt(stats.pagesOcr)} />
            <StatCard label="Pages translated" value={fmt(stats.pagesTranslated)} />
            <StatCard label="Fully processed" value={fmt(stats.complete)} />
          </div>
        )}

        {/* ── Pipeline diagram ── */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-8">The Pipeline</h2>

        <div className="relative mb-16">
          {/* Desktop: horizontal flow */}
          <div className="hidden md:flex items-start gap-0 overflow-x-auto pb-4">
            {STAGES.map((stage, i) => (
              <div key={stage.name} className="flex items-start">
                <div className="flex flex-col items-center min-w-[100px]">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold ${stage.color}`}
                  >
                    {stage.icon}
                  </div>
                  <span className="text-xs font-medium text-secondary mt-2 text-center">
                    {stage.name}
                  </span>
                </div>
                {i < STAGES.length - 1 && (
                  <div className="flex items-center h-10 px-1">
                    <div className="w-4 h-px bg-border-medium" />
                    <svg className="w-2 h-2 text-stone-400 -ml-0.5" viewBox="0 0 8 8" fill="currentColor">
                      <path d="M0 0 L8 4 L0 8 Z" />
                    </svg>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Mobile: vertical flow */}
          <div className="md:hidden flex flex-col gap-2">
            {STAGES.map((stage, i) => (
              <div key={stage.name} className="flex items-center gap-3">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold ${stage.color}`}
                  >
                    {stage.icon}
                  </div>
                  {i < STAGES.length - 1 && <div className="w-px h-4 bg-border-medium mt-1" />}
                </div>
                <span className="text-sm text-secondary">{stage.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Stage details ── */}
        <div className="space-y-6 mb-16">
          {STAGES.map((stage) => (
            <div
              key={stage.name}
              className="bg-white rounded-xl border border-border-light p-6"
            >
              <div className="flex items-center gap-3 mb-3">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${stage.color}`}
                >
                  {stage.icon}
                </div>
                <div>
                  <h3 className="font-semibold text-primary">{stage.name}</h3>
                  <p className="text-sm text-muted">{stage.summary}</p>
                </div>
              </div>
              <p className="text-secondary text-[15px] leading-relaxed ml-11">
                {stage.detail}
              </p>
            </div>
          ))}
        </div>

        {/* ── Quality & Provenance ── */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Quality & Provenance
        </h2>

        <p className="text-secondary mb-8">
          Every step in the pipeline is logged, versioned, and auditable. We treat these texts as
          cultural heritage. Processing should be transparent, not a black box.
        </p>

        <div className="grid md:grid-cols-2 gap-6 mb-16">
          <QualityCard
            title="Prompt versioning"
            description="OCR and translation prompts are stored as immutable versions in our database. Every page records which prompt version produced its text, so results can be compared across versions and reprocessed with improvements."
          />
          <QualityCard
            title="Original preservation"
            description="The original page image URL is never overwritten. Archived copies, cropped versions, and thumbnails are layered on top. If our processing ever introduces errors, the source material is always available."
          />
          <QualityCard
            title="Audit trail"
            description="Every AI call is logged with model, token count, cost, and result status. Admin actions, metadata changes, and pipeline state transitions all feed into a per-book history timeline visible on each book's page."
          />
          <QualityCard
            title="Snapshot protection"
            description="When a page has been manually edited by a human, reprocessing automatically creates a backup snapshot first. Manual corrections are never silently overwritten by automation."
          />
          <QualityCard
            title="Language-specific prompts"
            description="Latin, German (Fraktur), and standard OCR each use specialized prompts tuned for their specific challenges: abbreviation expansion, blackletter character sets, and period-appropriate conventions."
          />
          <QualityCard
            title="Open standards"
            description="Every book publishes a IIIF manifest. Translations follow W3C Web Annotation conventions. Scholarly editions receive DOIs via Zenodo. Data is accessible via API and MCP server."
          />
        </div>

        {/* ── Sources & Languages ── */}
        {stats && (stats.languages.length > 0 || stats.sources.length > 0) && (
          <>
            <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
              Collection
            </h2>

            <div className="grid md:grid-cols-2 gap-8 mb-16">
              {stats.languages.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-muted uppercase tracking-wide mb-4">
                    Languages
                  </h3>
                  <div className="space-y-2">
                    {stats.languages.map((l) => (
                      <div key={l.name} className="flex items-center justify-between">
                        <span className="text-secondary">{l.name}</span>
                        <span className="text-sm text-muted tabular-nums">
                          {l.count} {l.count === 1 ? 'book' : 'books'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {stats.sources.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-muted uppercase tracking-wide mb-4">
                    Sources
                  </h3>
                  <div className="space-y-2">
                    {stats.sources.map((s) => (
                      <div key={s.name} className="flex items-center justify-between">
                        <span className="text-secondary">{s.name}</span>
                        <span className="text-sm text-muted tabular-nums">
                          {s.count} {s.count === 1 ? 'book' : 'books'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Explore ── */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          See It in Action
        </h2>

        <p className="text-secondary mb-6">
          Every book page shows the original scan alongside its transcription and translation.
          Book detail pages include a history timeline showing every processing step with timestamps,
          models used, and costs.
        </p>

        <div className="flex flex-wrap gap-4 pt-4">
          <Link
            href="/"
            className="px-5 py-2.5 bg-stone-900 text-white rounded-full hover:bg-stone-800 transition-colors"
          >
            Browse the Library
          </Link>
          <Link
            href="/gallery"
            className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
          >
            Image Gallery
          </Link>
          <Link
            href="/about/standards"
            className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
          >
            Standards & Interoperability
          </Link>
          <Link
            href="/developers"
            className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
          >
            API & MCP Server
          </Link>
        </div>
      </div>
    </ContentPageLayout>
  );
}

/* ── Subcomponents ── */

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-border-light p-5 text-center">
      <div className="text-2xl md:text-3xl font-semibold text-primary">{value}</div>
      <div className="text-sm text-muted mt-1">{label}</div>
    </div>
  );
}

function QualityCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="bg-white rounded-xl border border-border-light p-5">
      <h3 className="font-semibold text-primary mb-2">{title}</h3>
      <p className="text-secondary text-[15px] leading-relaxed">{description}</p>
    </div>
  );
}
