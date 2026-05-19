import type { Metadata } from 'next';
import Link from 'next/link';
import { BookOpen, FileText, Languages, Image as ImageIcon, Database, HardDrive, Sparkles, Globe, Building2, Cloud, Cpu, Coins, Hash } from 'lucide-react';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'By the Numbers — Source Library',
  description: 'How big is Source Library? A visual tour of the corpus: books, pages, languages, time periods, and the storage that holds it all.',
  alternates: { canonical: '/about/by-the-numbers' },
};

const fmt = (n: number) => n.toLocaleString('en-US');

// ---------- Data (snapshot 2026-05-07) ----------

const HERO = {
  books: 11_965,
  artworks: 14_412,
  totalWorks: 26_643,
  warehouse: 22_543,
  pages: 4_294_562, // pages of the book corpus (excludes single-image artworks)
  pagesOcr: 3_770_546,
  pagesTranslated: 3_602_478,
  readable: 11_032,
  firstTranslations: 6_033,
  galleryImages: 100_981,
  entities: 811_127,
  entityConcepts: 438_516,
  entityPeople: 264_049,
  entityPlaces: 111_677,
  collections: 337,
  bookEmbeddings: 30_564,
  totalLanguages: 199,
  authors: 7_421,
  chapters: 81_858,
  yearMin: -2880,
  yearMax: 2026,
  longestBookPages: 4_369,
  longestBookTitle: 'Greek Old Testament (Tischendorf)',
  oldestWorkTitle: 'Stela of King Raneb',
  oldestWorkYear: -2880,
};

const LANGUAGES: { name: string; count: number }[] = [
  { name: 'Latin', count: 4_200 },
  { name: 'German', count: 1_747 },
  { name: 'English', count: 1_422 },
  { name: 'Greek', count: 812 },
  { name: 'French', count: 659 },
  { name: 'Chinese', count: 582 },
  { name: 'Dutch', count: 443 },
  { name: 'Sumerian', count: 377 },
  { name: 'Sanskrit', count: 343 },
  { name: 'Russian', count: 242 },
  { name: 'Italian', count: 223 },
  { name: 'Hebrew', count: 210 },
  { name: 'Egyptian hieroglyphs', count: 129 },
];

const PERIODS: { label: string; count: number }[] = [
  { label: 'Pre-1000', count: 143 },
  { label: '1000s', count: 133 },
  { label: '1100s', count: 96 },
  { label: '1200s', count: 120 },
  { label: '1300s', count: 176 },
  { label: '1400s', count: 914 },
  { label: '1500s', count: 2_415 },
  { label: '1600s', count: 3_845 },
  { label: '1700s', count: 2_403 },
  { label: '1800s', count: 3_350 },
  { label: '1900s', count: 1_713 },
  { label: '2000s', count: 2_654 },
];

const SOURCES: { name: string; count: number; note?: string }[] = [
  { name: 'Wikimedia Commons', count: 11_287, note: 'Mostly artworks — open-licensed scans & paintings' },
  { name: 'Internet Archive', count: 5_216, note: 'Public-domain books' },
  { name: 'Embassy of the Free Mind (BPH)', count: 2_273, note: 'Hermetica, alchemy, Rosicrucian — books' },
  { name: 'Rijksmuseum', count: 1_697, note: 'Prints & illustrated artworks' },
  { name: 'Munich Digital Library (MDZ)', count: 1_338, note: 'German & Latin books' },
  { name: 'e-rara (Swiss libraries)', count: 537, note: 'Books from Swiss research libraries' },
  { name: 'National Gallery of Art', count: 452, note: 'Artworks' },
  { name: 'Allard Pierson (Amsterdam)', count: 421, note: 'Books' },
  { name: 'ETCSL (Sumerian Literature)', count: 373, note: 'Cuneiform & Sumerian texts' },
  { name: 'The Met', count: 362, note: 'Artworks' },
];

// ---------- Helpers ----------

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  accent = 'gold',
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon?: React.ComponentType<{ className?: string }>;
  accent?: 'gold' | 'rust' | 'sage' | 'violet' | 'stone';
}) {
  const accentMap: Record<string, string> = {
    gold: 'text-accent-gold-dark bg-accent-gold/10',
    rust: 'text-accent-rust bg-accent-rust/10',
    sage: 'text-accent-sage-dark bg-accent-sage/15',
    violet: 'text-accent-violet bg-accent-violet/10',
    stone: 'text-stone-700 bg-stone-100',
  };
  return (
    <div className="bg-white rounded-xl p-6 border border-border-light shadow-sm">
      <div className="flex items-start justify-between mb-3">
        <div className="text-sm uppercase tracking-wider text-secondary font-medium">{label}</div>
        {Icon && (
          <div className={`p-2 rounded-lg ${accentMap[accent]}`}>
            <Icon className="w-5 h-5" />
          </div>
        )}
      </div>
      <div className="font-serif text-4xl md:text-5xl text-primary tabular-nums leading-none">
        {typeof value === 'number' ? fmt(value) : value}
      </div>
      {sub && <div className="text-sm text-muted mt-2">{sub}</div>}
    </div>
  );
}

function HBar({ name, count, max, color }: { name: string; count: number; max: number; color: string }) {
  const pct = (count / max) * 100;
  return (
    <div className="grid grid-cols-[10rem_1fr_4rem] md:grid-cols-[12rem_1fr_5rem] items-center gap-3 py-1.5">
      <div className="text-sm text-secondary truncate">{name}</div>
      <div className="h-5 bg-stone-100 rounded-sm overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="text-sm tabular-nums text-primary text-right">{fmt(count)}</div>
    </div>
  );
}

function VBar({ label, count, max, highlight }: { label: string; count: number; max: number; highlight?: boolean }) {
  const pct = (count / max) * 100;
  return (
    <div className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
      <div className="text-xs tabular-nums text-secondary">{count >= 1000 ? `${(count / 1000).toFixed(1)}k` : count}</div>
      <div className="w-full bg-stone-100 rounded-t-sm relative" style={{ height: '180px' }}>
        <div
          className={`absolute bottom-0 left-0 right-0 ${highlight ? 'bg-accent-rust' : 'bg-accent-gold'} rounded-t-sm transition-all`}
          style={{ height: `${pct}%` }}
        />
      </div>
      <div className="text-xs text-muted whitespace-nowrap">{label}</div>
    </div>
  );
}

// ---------- Page ----------

export default function ByTheNumbersPage() {
  const langMax = Math.max(...LANGUAGES.map(l => l.count));
  const periodMax = Math.max(...PERIODS.map(p => p.count));
  const sourceMax = Math.max(...SOURCES.map(s => s.count));

  const ocrPct = (HERO.pagesOcr / HERO.pages) * 100;
  const trPct = (HERO.pagesTranslated / HERO.pages) * 100;

  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Source Library, by the Numbers"
          subtitle="A snapshot of the corpus — what's in it, where it came from, and what it takes to hold it together."
          image="https://images.sourcelibrary.org/archived/695591547bd6d2cd1d618a62/154.jpg"
          imageAlt="Historical manuscript page"
        />
      }
      maxWidth="wide"
      bg="bg-cream"
    >
      <div className="space-y-20">

        {/* ───── Hero numbers ───── */}
        <section>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Books" value={HERO.books} sub={`+${fmt(HERO.warehouse)} in the warehouse queue`} icon={BookOpen} accent="rust" />
            <StatCard label="Artworks" value={HERO.artworks} sub="Prints, paintings, illustrated single sheets" icon={ImageIcon} accent="gold" />
            <StatCard label="Pages translated" value={HERO.pagesTranslated} sub={`${trPct.toFixed(1)}% of all book pages`} icon={Languages} accent="violet" />
            <StatCard label="First translations" value={HERO.firstTranslations} sub="First English translation by Source Library" icon={Sparkles} accent="sage" />
          </div>
          <p className="text-sm text-muted mt-4 text-center">
            Source Library holds {fmt(HERO.totalWorks)} works in total — {fmt(HERO.books)} books and {fmt(HERO.artworks)} artworks.
            The numbers below describe the book corpus unless noted.
          </p>
        </section>

        {/* ───── Scale vs Wikipedia ───── */}
        <section>
          <h2 className="font-serif text-3xl text-primary mb-6">3.83 billion words on disk</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl border border-border-light p-6">
              <div className="text-sm uppercase tracking-wider text-secondary font-medium mb-3">Source Library</div>
              <div className="font-serif text-5xl text-primary tabular-nums leading-none mb-2">3.83B</div>
              <div className="text-sm text-secondary mb-4">words — original languages + English translation</div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-secondary">Original-language OCR</span><span className="tabular-nums text-primary">1.69B</span></div>
                <div className="flex justify-between"><span className="text-secondary">English translation</span><span className="tabular-nums text-primary">2.14B</span></div>
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-border-light p-6">
              <div className="text-sm uppercase tracking-wider text-secondary font-medium mb-3">English Wikipedia, for scale</div>
              <div className="font-serif text-5xl text-primary tabular-nums leading-none mb-2">~4.4B</div>
              <div className="text-sm text-secondary mb-4">words across ~6.9M articles</div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-secondary">Source Library / Wikipedia</span><span className="tabular-nums text-primary">87%</span></div>
                <div className="flex justify-between"><span className="text-secondary">Translation alone</span><span className="tabular-nums text-primary">49%</span></div>
              </div>
            </div>
          </div>
        </section>

        {/* ───── Reading-readiness ───── */}
        <section>
          <h2 className="font-serif text-3xl text-primary mb-2">From scan to readable text</h2>
          <p className="text-secondary mb-8 max-w-2xl">
            Every book page travels a pipeline: photographed, OCR'd, translated, indexed.
            Here's how far the {fmt(HERO.pages)} pages of the book corpus have come.
          </p>

          <div className="bg-white rounded-2xl border border-border-light p-6 md:p-8">
            <div className="space-y-6">
              <div>
                <div className="flex justify-between items-baseline mb-2">
                  <div className="text-sm font-medium text-primary">Pages digitized</div>
                  <div className="text-sm tabular-nums text-secondary">{fmt(HERO.pages)} <span className="text-muted">/ {fmt(HERO.pages)}</span></div>
                </div>
                <div className="h-3 bg-stone-100 rounded-full overflow-hidden">
                  <div className="h-full bg-stone-400" style={{ width: '100%' }} />
                </div>
              </div>

              <div>
                <div className="flex justify-between items-baseline mb-2">
                  <div className="text-sm font-medium text-primary">OCR transcribed</div>
                  <div className="text-sm tabular-nums text-secondary">{fmt(HERO.pagesOcr)} <span className="text-muted">({ocrPct.toFixed(1)}%)</span></div>
                </div>
                <div className="h-3 bg-stone-100 rounded-full overflow-hidden">
                  <div className="h-full bg-accent-gold" style={{ width: `${ocrPct}%` }} />
                </div>
              </div>

              <div>
                <div className="flex justify-between items-baseline mb-2">
                  <div className="text-sm font-medium text-primary">Translated to English</div>
                  <div className="text-sm tabular-nums text-secondary">{fmt(HERO.pagesTranslated)} <span className="text-muted">({trPct.toFixed(1)}%)</span></div>
                </div>
                <div className="h-3 bg-stone-100 rounded-full overflow-hidden">
                  <div className="h-full bg-accent-violet" style={{ width: `${trPct}%` }} />
                </div>
              </div>
            </div>

            <div className="mt-8 pt-6 border-t border-border-light grid grid-cols-2 md:grid-cols-4 gap-6">
              <div>
                <div className="font-serif text-3xl text-primary tabular-nums">{fmt(HERO.readable)}</div>
                <div className="text-sm text-secondary">Books fully readable <span className="text-muted">(&ge;90% translated)</span></div>
              </div>
              <div>
                <div className="font-serif text-3xl text-primary tabular-nums">{fmt(HERO.chapters)}</div>
                <div className="text-sm text-secondary">Chapters auto-extracted with AI</div>
              </div>
              <div>
                <div className="font-serif text-3xl text-primary tabular-nums">{fmt(HERO.authors)}</div>
                <div className="text-sm text-secondary">Distinct authors</div>
              </div>
              <div>
                <div className="font-serif text-3xl text-primary tabular-nums">{fmt(HERO.galleryImages)}</div>
                <div className="text-sm text-secondary">Illustrations extracted from page scans</div>
              </div>
            </div>
          </div>
        </section>

        {/* ───── Languages ───── */}
        <section>
          <h2 className="font-serif text-3xl text-primary mb-2">{HERO.totalLanguages} languages, from Sumerian to Russian</h2>
          <p className="text-secondary mb-8 max-w-2xl">
            Books in their original languages, before AI translation. The corpus spans {HERO.totalLanguages} distinct
            languages and language combinations — the top fourteen are below. Latin and German anchor the European
            corpus; ETCSL contributes Sumerian; dedicated import streams bring in Chinese, Sanskrit, and Hebrew.
          </p>
          <div className="bg-white rounded-2xl border border-border-light p-6 md:p-8">
            {LANGUAGES.map(l => (
              <HBar key={l.name} name={l.name} count={l.count} max={langMax} color="bg-accent-gold" />
            ))}
            <div className="mt-4 pt-4 border-t border-border-light text-sm text-muted">
              …plus {HERO.totalLanguages - LANGUAGES.length}+ more, including Akkadian, Avestan, Old Norse, Coptic, Aramaic, Classical Armenian, and dozens of bilingual editions.
            </div>
          </div>
        </section>

        {/* ───── Time periods ───── */}
        <section>
          <h2 className="font-serif text-3xl text-primary mb-2">Across nearly five thousand years</h2>
          <p className="text-secondary mb-8 max-w-2xl">
            Distribution of works by century of original composition. The earliest item dates to{' '}
            <span className="text-primary font-medium">2880 BCE</span> — a stela of King Raneb of Egypt's Second Dynasty —
            and the corpus runs unbroken through to the present. The book corpus peaks in the 1600s (the heyday of
            Hermetic and alchemical printing), with strong shoulders in the 1500s and 1800s.
          </p>
          <div className="bg-white rounded-2xl border border-border-light p-6 md:p-8">
            <div className="flex items-end gap-2 md:gap-3">
              {PERIODS.map(p => (
                <VBar key={p.label} label={p.label} count={p.count} max={periodMax} highlight={p.count === periodMax} />
              ))}
            </div>
            <div className="mt-6 pt-6 border-t border-border-light grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted mb-1">Earliest work</div>
                <div className="text-primary font-medium">{HERO.oldestWorkTitle}</div>
                <div className="text-secondary">{Math.abs(HERO.oldestWorkYear)} BCE — Egyptian Second Dynasty</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-muted mb-1">Longest book</div>
                <div className="text-primary font-medium">{HERO.longestBookTitle}</div>
                <div className="text-secondary">{fmt(HERO.longestBookPages)} pages</div>
              </div>
            </div>
          </div>
        </section>

        {/* ───── Sources ───── */}
        <section>
          <h2 className="font-serif text-3xl text-primary mb-2">Where the books come from</h2>
          <p className="text-secondary mb-8 max-w-2xl">
            Source Library mirrors and unifies digitized holdings from libraries and museums around the world.
            The provenance of every page is preserved.
          </p>
          <div className="bg-white rounded-2xl border border-border-light p-6 md:p-8">
            {SOURCES.map(s => (
              <div key={s.name} className="grid grid-cols-[1fr_auto] gap-4 py-3 border-b border-border-light last:border-0">
                <div>
                  <div className="text-primary font-medium flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-stone-400" /> {s.name}
                  </div>
                  {s.note && <div className="text-sm text-muted ml-6">{s.note}</div>}
                </div>
                <div className="text-right">
                  <div className="font-serif text-2xl text-primary tabular-nums">{fmt(s.count)}</div>
                  <div className="text-xs text-muted">books</div>
                </div>
              </div>
            ))}
            <div className="mt-4 pt-4 border-t border-border-light text-sm text-secondary">
              …plus dozens of smaller archives. Every book records its source library and original IIIF or IA identifier.
            </div>
          </div>
        </section>

        {/* ───── Storage ───── */}
        <section>
          <h2 className="font-serif text-3xl text-primary mb-2">What it takes to hold it</h2>
          <p className="text-secondary mb-8 max-w-2xl">
            Three primary stores keep the corpus alive: a metadata database, a search-and-text mirror, and an image archive.
          </p>

          <div className="grid md:grid-cols-3 gap-4">
            {/* MongoDB */}
            <div className="bg-white rounded-2xl border border-border-light p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-accent-rust/10 text-accent-rust"><Database className="w-5 h-5" /></div>
                <div>
                  <div className="font-medium text-primary">MongoDB Atlas</div>
                  <div className="text-xs text-muted">Primary metadata store</div>
                </div>
              </div>
              <div className="font-serif text-4xl text-primary tabular-nums leading-none mb-1">65 GB</div>
              <div className="text-sm text-secondary mb-4">data, +3 GB indexes</div>
              <ul className="text-sm text-secondary space-y-1">
                <li><span className="tabular-nums text-primary font-medium">5.7M</span> page records · 41 GB</li>
                <li><span className="tabular-nums text-primary font-medium">82K</span> chapter texts · 6.5 GB</li>
                <li><span className="tabular-nums text-primary font-medium">811K</span> entities · 1.4 GB</li>
                <li><span className="tabular-nums text-primary font-medium">92</span> collections, <span className="tabular-nums text-primary font-medium">25.5M</span> documents total</li>
              </ul>
            </div>

            {/* Supabase */}
            <div className="bg-white rounded-2xl border border-border-light p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-accent-sage/15 text-accent-sage-dark"><Cpu className="w-5 h-5" /></div>
                <div>
                  <div className="font-medium text-primary">Supabase Postgres</div>
                  <div className="text-xs text-muted">Search & embeddings</div>
                </div>
              </div>
              <div className="font-serif text-4xl text-primary tabular-nums leading-none mb-1">3.4M</div>
              <div className="text-sm text-secondary mb-4">page records (text mirror)</div>
              <ul className="text-sm text-secondary space-y-1">
                <li>Full-text search across every translated page</li>
                <li><span className="tabular-nums text-primary font-medium">30,564</span> book-level vector embeddings</li>
                <li>Per-page CLIP image embeddings for visual search</li>
                <li>7-lane semantic search powers <Link href="/search" className="underline decoration-accent-rust">/search</Link></li>
              </ul>
            </div>

            {/* R2 */}
            <div className="bg-white rounded-2xl border border-border-light p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-accent-violet/10 text-accent-violet"><Cloud className="w-5 h-5" /></div>
                <div>
                  <div className="font-medium text-primary">Cloudflare R2</div>
                  <div className="text-xs text-muted">Image archive</div>
                </div>
              </div>
              <div className="font-serif text-4xl text-primary tabular-nums leading-none mb-1">~2 TB</div>
              <div className="text-sm text-secondary mb-4">across ~12M image objects</div>
              <ul className="text-sm text-secondary space-y-1">
                <li><span className="tabular-nums text-primary font-medium">3.9M</span> archived full-res JPEGs (~286 KB each)</li>
                <li><span className="tabular-nums text-primary font-medium">3.9M</span> 1200px display images + thumbnails</li>
                <li><span className="tabular-nums text-primary font-medium">100K</span> extracted illustrations & artworks</li>
                <li>BPH JP2 originals from Embassy of the Free Mind</li>
              </ul>
            </div>
          </div>
        </section>

        {/* ───── Generated content ───── */}
        <section>
          <h2 className="font-serif text-3xl text-primary mb-2">Generated by AI</h2>
          <p className="text-secondary mb-8 max-w-2xl">
            Every translation, summary, and chapter index in Source Library is produced by Google Gemini models.
            The original text is always preserved — one click away on every page.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="OCR transcriptions" value={HERO.pagesOcr} sub="From scan to original-language text" icon={FileText} accent="gold" />
            <StatCard label="Page translations" value={HERO.pagesTranslated} sub="Original languages → English" icon={Languages} accent="violet" />
            <StatCard label="Book embeddings" value={HERO.bookEmbeddings} sub="For semantic similarity & search" icon={Sparkles} accent="sage" />
            <StatCard label="Illustrations catalogued" value={HERO.galleryImages} sub="Subjects, figures, symbols, technique" icon={ImageIcon} accent="rust" />
          </div>
        </section>

        {/* ───── Entities ───── */}
        <section>
          <h2 className="font-serif text-3xl text-primary mb-2">A knowledge graph of {fmt(HERO.entities)} entities</h2>
          <p className="text-secondary mb-8 max-w-2xl">
            Every translated page is scanned for the people it names, the places it mentions, and the concepts it
            invokes. The result is a connected graph that links Hermes Trismegistus to Marsilio Ficino to a print on
            the Rijksmuseum's wall.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl border border-border-light p-6">
              <div className="flex items-center gap-2 text-secondary mb-3">
                <Globe className="w-4 h-4" />
                <span className="text-sm uppercase tracking-wider font-medium">Concepts</span>
              </div>
              <div className="font-serif text-4xl text-primary tabular-nums leading-none mb-2">{fmt(HERO.entityConcepts)}</div>
              <div className="text-sm text-secondary">
                Ideas, doctrines, symbols, schools of thought — the abstract anchors of the Hermetic and Renaissance corpus.
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-border-light p-6">
              <div className="flex items-center gap-2 text-secondary mb-3">
                <Sparkles className="w-4 h-4" />
                <span className="text-sm uppercase tracking-wider font-medium">People</span>
              </div>
              <div className="font-serif text-4xl text-primary tabular-nums leading-none mb-2">{fmt(HERO.entityPeople)}</div>
              <div className="text-sm text-secondary">
                Authors, philosophers, alchemists, kings, mystics — every named person across the translated corpus.
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-border-light p-6">
              <div className="flex items-center gap-2 text-secondary mb-3">
                <Building2 className="w-4 h-4" />
                <span className="text-sm uppercase tracking-wider font-medium">Places</span>
              </div>
              <div className="font-serif text-4xl text-primary tabular-nums leading-none mb-2">{fmt(HERO.entityPlaces)}</div>
              <div className="text-sm text-secondary">
                Cities, monasteries, libraries, regions — geocoded where possible and linked to the books that mention them.
              </div>
            </div>
          </div>
        </section>

        {/* ───── Tokens & cost ───── */}
        <section>
          <h2 className="font-serif text-3xl text-primary mb-2">Tokens, end to end</h2>
          <p className="text-secondary mb-8 max-w-2xl">
            Reading the corpus and translating it has cost about <span className="text-primary font-medium">27 billion Gemini tokens</span> across
            every phase of the pipeline.
          </p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <StatCard label="Pipeline tokens" value="27.1B" sub="Total Gemini input + output, all phases" icon={Hash} accent="violet" />
            <StatCard label="Corpus words" value="3.83B" sub="OCR + translation, tags stripped" icon={FileText} accent="gold" />
            <StatCard label="Total AI cost" value="$17,674" sub="Cumulative spend, all Gemini calls" icon={Coins} accent="rust" />
            <StatCard label="API calls" value="5.7M" sub="Across OCR, translation, indexing, vision" icon={Cpu} accent="sage" />
          </div>

          <div className="bg-white rounded-2xl border border-border-light p-6 md:p-8">
            <h3 className="text-sm uppercase tracking-wider text-secondary font-medium mb-4">Tokens by pipeline phase</h3>
            {[
              { name: 'OCR (vision → original-language text)', tokens: 11_036_426_909, cost: 5611.7, color: 'bg-accent-gold' },
              { name: 'Translation (original → English)', tokens: 7_207_306_377, cost: 7366.3, color: 'bg-accent-violet' },
              { name: 'Indexing & summary', tokens: 4_212_550_809, cost: 2228.5, color: 'bg-accent-sage' },
              { name: 'Image extraction (vision)', tokens: 3_392_229_660, cost: 2009.0, color: 'bg-accent-rust' },
              { name: 'Transliteration', tokens: 565_507_539, cost: 156.7, color: 'bg-stone-400' },
              { name: 'FT verification & misc', tokens: 734_529_984, cost: 301.4, color: 'bg-stone-300' },
            ].map(p => {
              const max = 11_036_426_909;
              const pct = (p.tokens / max) * 100;
              return (
                <div key={p.name} className="grid grid-cols-[1fr_auto] gap-4 items-center py-2">
                  <div>
                    <div className="text-sm text-primary mb-1">{p.name}</div>
                    <div className="h-3 bg-stone-100 rounded-sm overflow-hidden">
                      <div className={`h-full ${p.color}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div className="text-right tabular-nums">
                    <div className="text-sm text-primary font-medium">{(p.tokens / 1e9).toFixed(2)}B</div>
                    <div className="text-xs text-muted">${fmt(Math.round(p.cost))}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ───── Footer note ───── */}
        <section className="text-center text-sm text-muted pt-8 border-t border-border-light">
          Snapshot taken 2026-05-07. Counts grow daily as the pipeline runs.
          See live status at <Link href="/status" className="underline">/status</Link>.
        </section>

      </div>
    </ContentPageLayout>
  );
}
