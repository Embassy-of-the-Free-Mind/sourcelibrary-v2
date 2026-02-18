import Link from 'next/link';
import {
  Download, Shield, Eye, Languages, Brain,
  Image, CheckCircle2, ArrowRight, BookOpen,
  Globe, List, Search,
} from 'lucide-react';
import ContentPageLayout, { SubPageHeader } from '@/components/layout/ContentPageLayout';
import { getDb } from '@/lib/mongodb';

export const revalidate = 3600;

export const metadata = {
  title: 'How It Works | Source Library',
  description: 'How Source Library digitizes, transcribes, and translates rare historical texts using AI — making centuries of knowledge accessible in English.',
  alternates: {
    canonical: '/about/processing',
  },
};

// ---------------------------------------------------------------------------
// Server data
// ---------------------------------------------------------------------------

interface PipelineStats {
  totalBooks: number;
  totalPages: number;
  pagesTranslated: number;
  languageCount: number;
}

async function getPipelineStats(): Promise<PipelineStats | null> {
  try {
    const db = await getDb();
    const [totalBooks, totalPages, agg, languages] = await Promise.all([
      db.collection('books').estimatedDocumentCount(),
      db.collection('pages').estimatedDocumentCount(),
      db.collection('books').aggregate([{
        $group: {
          _id: null,
          pagesTranslated: { $sum: { $ifNull: ['$pages_translated', 0] } },
        },
      }]).toArray(),
      db.collection('books').distinct('language'),
    ]);
    const s = agg[0] || {};
    return {
      totalBooks,
      totalPages,
      pagesTranslated: s.pagesTranslated || 0,
      languageCount: languages.filter((l: string) => l && l !== 'Unknown').length,
    };
  } catch {
    return null;
  }
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString('en-US');
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function ProcessingPage() {
  const stats = await getPipelineStats();

  return (
    <ContentPageLayout maxWidth="narrow" bg="bg-cream">
      <SubPageHeader
        title="How It Works"
        subtitle="From manuscript scan to searchable, translated text"
      />

      {/* -- Introduction -- */}
      <p className="text-secondary mb-8 leading-relaxed">
        Source Library makes rare historical texts accessible to modern readers. We import
        high-resolution scans from the world&apos;s great digital archives, use AI to read
        and transcribe the original text, translate it into English, and build searchable
        indexes of the people, places, and ideas within. Every step is automated, logged,
        and traceable back to the source.
      </p>

      {/* -- Live Stats -- */}
      {stats && (
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          {[
            { label: 'Books', value: fmt(stats.totalBooks) },
            { label: 'Pages', value: fmt(stats.totalPages) },
            { label: 'Translated', value: fmt(stats.pagesTranslated) },
            { label: 'Languages', value: String(stats.languageCount) },
          ].map((s) => (
            <div key={s.label} className="bg-warm rounded-xl border border-border-light p-4 text-center">
              <div className="text-2xl font-bold text-primary font-serif">{s.value}</div>
              <div className="text-xs text-muted mt-1">{s.label}</div>
            </div>
          ))}
        </section>
      )}

      {/* ----------------------------------------------------------------
          THE JOURNEY: visual pipeline
      ---------------------------------------------------------------- */}

      <section className="bg-white rounded-xl border border-border-light p-6 mb-10">
        <h2 className="text-xl font-semibold text-primary font-serif mb-2">The Journey of a Book</h2>
        <p className="text-secondary text-sm mb-6">
          Every book follows the same path from archive scan to fully searchable text.
        </p>

        {/* Desktop horizontal */}
        <div className="hidden md:flex items-start justify-between gap-1">
          {PIPELINE.map((stage, i) => (
            <div key={stage.label} className="flex items-start gap-1">
              <div className="flex flex-col items-center gap-1.5 min-w-[80px]">
                <div className={`p-2.5 rounded-lg ${stage.bg}`}>
                  <stage.Icon className={`w-5 h-5 ${stage.fg}`} />
                </div>
                <span className="text-[11px] font-medium text-secondary text-center leading-tight">
                  {stage.label}
                </span>
                <span className="text-[10px] text-muted text-center leading-tight max-w-[90px]">
                  {stage.blurb}
                </span>
              </div>
              {i < PIPELINE.length - 1 && (
                <ArrowRight className="w-3.5 h-3.5 text-border-medium flex-shrink-0 mt-3" />
              )}
            </div>
          ))}
        </div>

        {/* Mobile vertical */}
        <div className="md:hidden space-y-2">
          {PIPELINE.map((stage, i) => (
            <div key={stage.label}>
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${stage.bg}`}>
                  <stage.Icon className={`w-4 h-4 ${stage.fg}`} />
                </div>
                <div>
                  <span className="text-sm font-medium text-primary">{stage.label}</span>
                  <span className="text-xs text-muted ml-2">{stage.blurb}</span>
                </div>
              </div>
              {i < PIPELINE.length - 1 && (
                <div className="ml-[18px] border-l-2 border-border-light h-2" />
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ----------------------------------------------------------------
          STEP 1: SCANNING & IMPORTING
      ---------------------------------------------------------------- */}

      <h2 className="text-xl font-semibold text-primary font-serif mb-1">Scanning & Importing</h2>
      <p className="text-muted text-sm mb-4">
        We gather scans from the world&apos;s leading digital archives.
      </p>

      <section className="bg-white rounded-xl border border-border-light p-6 mb-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 bg-warm rounded-lg">
            <Download className="w-5 h-5 text-secondary" />
          </div>
          <h3 className="text-lg font-semibold text-primary">Importing from Archives</h3>
        </div>
        <p className="text-secondary text-sm mb-3">
          Books are imported from thirteen digital archives worldwide, including the Internet Archive,
          Gallica (France), the Bavarian State Library, the Bodleian (Oxford), the Vatican Library,
          and the Library of Congress. We capture high-resolution page images along with catalog
          metadata like title, author, and date.
        </p>
        <p className="text-secondary text-sm mb-3">
          The original source URL for every page is preserved permanently, so provenance
          back to the source institution is never lost.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {['Internet Archive', 'Gallica', 'Bavarian State Library', 'Wellcome', 'e-rara',
            'Bodleian', 'Cambridge', 'Vatican', 'LOC', '+ 4 more'].map((s) => (
            <span key={s} className="text-[11px] bg-warm text-muted px-2 py-0.5 rounded-full">{s}</span>
          ))}
        </div>
      </section>

      <section className="bg-white rounded-xl border border-border-light p-6 mb-10">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 bg-accent-gold/10 rounded-lg">
            <Shield className="w-5 h-5 text-accent-gold-dark" />
          </div>
          <h3 className="text-lg font-semibold text-primary">Preserving the Images</h3>
        </div>
        <p className="text-secondary text-sm">
          Page images are downloaded and re-hosted on our own infrastructure to protect
          against link rot. If a source archive changes URLs or goes offline, the images
          remain available. The original URL, download date, and file checksum are recorded
          for every page.
        </p>
      </section>

      {/* ----------------------------------------------------------------
          STEP 2: TRANSCRIPTION
      ---------------------------------------------------------------- */}

      <h2 className="text-xl font-semibold text-primary font-serif mb-1">Transcription</h2>
      <p className="text-muted text-sm mb-4">
        AI reads the text on every page, even in difficult historical typefaces.
      </p>

      <section className="bg-white rounded-xl border border-border-light p-6 mb-10">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 bg-accent-sage/15 rounded-lg">
            <Eye className="w-5 h-5 text-accent-sage-dark" />
          </div>
          <h3 className="text-lg font-semibold text-primary">AI-Powered OCR</h3>
        </div>
        <p className="text-secondary text-sm mb-4">
          Each page image is processed by AI that can read historical typefaces including
          blackletter (Fraktur), Renaissance Latin ligatures, Hebrew, Arabic, and Greek.
          Language-specific instructions help the AI handle abbreviations, marginal notes,
          and multi-column layouts correctly.
        </p>
        <div className="grid md:grid-cols-2 gap-3">
          {[
            { label: 'Transcribed text', desc: 'Full text with paragraph structure preserved' },
            { label: 'Page type', desc: 'Title page, contents, index, frontispiece, or body text' },
            { label: 'Column layout', desc: 'Multi-column pages are detected and rendered correctly' },
            { label: 'Illustrations', desc: 'Preliminary detection of woodcuts, diagrams, and emblems' },
          ].map((item) => (
            <div key={item.label} className="bg-accent-sage/5 rounded-lg p-3">
              <span className="text-xs font-medium text-accent-sage-dark">{item.label}</span>
              <p className="text-xs text-secondary mt-0.5">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ----------------------------------------------------------------
          STEP 3: TRANSLATION
      ---------------------------------------------------------------- */}

      <h2 className="text-xl font-semibold text-primary font-serif mb-1">Translation</h2>
      <p className="text-muted text-sm mb-4">
        Most books are in Latin, German, Greek, Hebrew, or Arabic.
        AI translation makes them readable for modern English-speaking audiences.
      </p>

      <section className="bg-white rounded-xl border border-border-light p-6 mb-10">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 bg-accent-rust/10 rounded-lg">
            <Languages className="w-5 h-5 text-accent-rust" />
          </div>
          <h3 className="text-lg font-semibold text-primary">Translation to English</h3>
        </div>
        <p className="text-secondary text-sm mb-4">
          Pages are translated sequentially — each page receives context from the previous
          page&apos;s translation, so terminology stays consistent across page breaks and
          cross-page sentences are handled gracefully. English texts from before 1700 are
          modernized rather than translated.
        </p>

        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <div className="bg-accent-rust/5 rounded-lg p-4">
            <h4 className="text-sm font-medium text-accent-rust mb-1">Contextual continuity</h4>
            <p className="text-xs text-secondary">
              The AI sees the previous page&apos;s translation before working on the next,
              creating continuity in terminology and style throughout the book.
            </p>
          </div>
          <div className="bg-accent-rust/5 rounded-lg p-4">
            <h4 className="text-sm font-medium text-accent-rust mb-1">Quality benchmarked</h4>
            <p className="text-xs text-secondary">
              AI translations are compared against published scholarly editions
              for accuracy assessment.{' '}
              <Link href="/about/research" className="text-accent-rust hover:underline">
                See the research
              </Link>
            </p>
          </div>
        </div>

        <div className="bg-warm rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Globe className="w-4 h-4 text-accent-rust" />
            <h4 className="text-sm font-medium text-primary">Languages we handle</h4>
          </div>
          <div className="space-y-1.5 text-sm">
            {[
              { lang: 'Latin', note: 'Including Neo-Latin abbreviations and ligatures' },
              { lang: 'German', note: 'Fraktur / blackletter and Early Modern German' },
              { lang: 'Hebrew', note: 'With Aramaic support' },
              { lang: 'Arabic', note: 'Including Persian and Ottoman Turkish' },
              { lang: 'Greek', note: 'Ancient and Byzantine' },
              { lang: 'English', note: 'Pre-1700 texts modernized to contemporary English' },
            ].map((l) => (
              <div key={l.lang} className="flex gap-2">
                <span className="font-medium text-primary w-16 flex-shrink-0">{l.lang}</span>
                <span className="text-secondary text-xs mt-0.5">{l.note}</span>
              </div>
            ))}
            <p className="text-muted text-xs mt-2">
              Plus Italian, French, Dutch, Chinese, Sanskrit, and more.
            </p>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------------
          STEP 4: INDEXING & ENRICHMENT
      ---------------------------------------------------------------- */}

      <h2 className="text-xl font-semibold text-primary font-serif mb-1">Indexing & Enrichment</h2>
      <p className="text-muted text-sm mb-4">
        Once transcribed and translated, each book is enriched with summaries, indexes,
        chapter navigation, and an illustration catalog.
      </p>

      <section className="bg-white rounded-xl border border-border-light p-6 mb-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 bg-accent-violet/10 rounded-lg">
            <Brain className="w-5 h-5 text-accent-violet" />
          </div>
          <h3 className="text-lg font-semibold text-primary">Summary & Index</h3>
        </div>
        <p className="text-secondary text-sm mb-3">
          All translated pages are analyzed together to produce a reading summary (overview,
          key themes, and notable quotes) and a searchable index of people, places, concepts,
          and key terms.
        </p>
        <p className="text-secondary text-sm">
          People, places, and ideas are linked across books. Searching for
          &ldquo;Hermes Trismegistus&rdquo; surfaces every book that mentions him,
          regardless of spelling variations. Browse these connections in the{' '}
          <Link href="/encyclopedia" className="text-accent-rust hover:underline">encyclopedia</Link>.
        </p>
      </section>

      <section className="bg-white rounded-xl border border-border-light p-6 mb-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 bg-accent-violet/10 rounded-lg">
            <List className="w-5 h-5 text-accent-violet" />
          </div>
          <h3 className="text-lg font-semibold text-primary">Chapters</h3>
        </div>
        <p className="text-secondary text-sm">
          The AI identifies headings and table-of-contents pages to produce a clean chapter
          structure with page references. This powers the chapter dropdown in the reader,
          letting you jump directly to any section.
        </p>
      </section>

      <section className="bg-white rounded-xl border border-border-light p-6 mb-10">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 bg-accent-gold/10 rounded-lg">
            <Image className="w-5 h-5 text-accent-gold-dark" />
          </div>
          <h3 className="text-lg font-semibold text-primary">Illustration Detection</h3>
        </div>
        <p className="text-secondary text-sm mb-3">
          Every page is scanned for woodcuts, engravings, diagrams, emblems, and other
          illustrations. Each detection gets a description and classification, populating
          the{' '}
          <Link href="/gallery" className="text-accent-rust hover:underline">image gallery</Link>{' '}
          where you can browse thousands of historical illustrations.
        </p>
      </section>

      {/* ----------------------------------------------------------------
          THE RESULT
      ---------------------------------------------------------------- */}

      <section className="bg-white rounded-xl border border-border-light p-6 mb-8">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 bg-accent-rust/10 rounded-lg">
            <CheckCircle2 className="w-5 h-5 text-accent-rust" />
          </div>
          <h3 className="text-lg font-semibold text-primary">The Result</h3>
        </div>
        <p className="text-secondary text-sm mb-4">
          A fully processed book becomes a searchable, citable scholarly resource:
        </p>
        <div className="grid md:grid-cols-3 gap-4 text-sm">
          <div className="bg-warm rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <Search className="w-4 h-4 text-accent-sage-dark" />
              <h4 className="font-medium text-primary">Searchable</h4>
            </div>
            <p className="text-xs text-secondary">
              Full-text search across translations, with concept and entity indexes
              for cross-referencing between books.
            </p>
          </div>
          <div className="bg-warm rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <BookOpen className="w-4 h-4 text-accent-rust" />
              <h4 className="font-medium text-primary">Citable</h4>
            </div>
            <p className="text-xs text-secondary">
              Versioned scholarly editions with DOIs, complete with front matter
              and contributor credits.
            </p>
          </div>
          <div className="bg-warm rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <Globe className="w-4 h-4 text-accent-violet" />
              <h4 className="font-medium text-primary">Open</h4>
            </div>
            <p className="text-xs text-secondary">
              All source material is public domain (CC0). Schema.org metadata
              supports Google Scholar discovery.
            </p>
          </div>
        </div>
      </section>

      {/* -- Transparency Note -- */}
      <section className="bg-accent-sage/5 border border-accent-sage/20 rounded-xl p-6 mb-8">
        <h3 className="text-sm font-medium text-accent-sage-dark mb-2">Transparency & Provenance</h3>
        <p className="text-sm text-secondary">
          Every AI operation on every page is logged with full provenance. Each book has a
          processing history timeline showing what happened, when, and with what tools.
          Manual edits are snapshotted before reprocessing so human work is never lost.
          We use controlled experiments and scholarly benchmarks to validate quality.{' '}
          <Link href="/about/research" className="text-accent-rust hover:underline">
            Read about our research methodology
          </Link>
        </p>
      </section>

      {/* -- Footer links -- */}
      <div className="flex flex-wrap justify-center gap-6 text-sm">
        <Link href="/about/research" className="text-accent-rust hover:underline">
          Translation Research
        </Link>
        <Link href="/about/standards" className="text-accent-rust hover:underline">
          Scholarly Standards
        </Link>
        <Link href="/developers" className="text-accent-rust hover:underline">
          Developer API
        </Link>
      </div>
    </ContentPageLayout>
  );
}

// ---------------------------------------------------------------------------
// Pipeline stage data (used in the visual flow only)
// ---------------------------------------------------------------------------

const PIPELINE = [
  { label: 'Import',     Icon: Download,     bg: 'bg-warm',              fg: 'text-secondary',        blurb: '13 archives' },
  { label: 'Preserve',   Icon: Shield,       bg: 'bg-accent-gold/10',   fg: 'text-accent-gold-dark', blurb: 'Archive images' },
  { label: 'Transcribe', Icon: Eye,          bg: 'bg-accent-sage/15',   fg: 'text-accent-sage-dark', blurb: 'Read the text' },
  { label: 'Translate',  Icon: Languages,    bg: 'bg-accent-rust/10',   fg: 'text-accent-rust',      blurb: 'Into English' },
  { label: 'Enrich',     Icon: Brain,        bg: 'bg-accent-violet/10', fg: 'text-accent-violet',    blurb: 'Summary & index' },
  { label: 'Structure',  Icon: List,         bg: 'bg-accent-violet/10', fg: 'text-accent-violet',    blurb: 'Chapters' },
  { label: 'Illustrate', Icon: Image,        bg: 'bg-accent-gold/10',   fg: 'text-accent-gold-dark', blurb: 'Find artwork' },
  { label: 'Complete',   Icon: CheckCircle2, bg: 'bg-green-100',        fg: 'text-green-700',        blurb: 'Ready to read' },
];
