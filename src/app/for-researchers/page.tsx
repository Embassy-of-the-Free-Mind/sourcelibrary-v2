import Link from 'next/link';
import { BookOpen, Database, Globe, FileText, GraduationCap, Search, Languages, Shield, Code2, Quote } from 'lucide-react';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import AcademicAccessForm from '@/components/researchers/AcademicAccessForm';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'For Researchers | Source Library',
  description: 'Source Library provides free access to 17,000+ historical texts with AI translations and OCR transcriptions. Apply for API access, bulk data, and corpus downloads.',
  alternates: {
    canonical: '/for-researchers',
  },
};

export default function ForResearchersPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="For Researchers"
          subtitle="Source Library is a free, open-access digital library of historical texts with AI-generated translations. We make primary sources readable to scholars who don't read the original languages — and machine-readable to those building on them."
          image="https://images.sourcelibrary.org/archived/695591547bd6d2cd1d618a62/154.jpg"
          imageAlt="Historical manuscript page"
        />
      }
      bg="bg-cream"
    >
      <div className="prose-content max-w-none">

        {/* What's in the collection */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          The Collection
        </h2>

        <p className="text-xl text-secondary leading-relaxed mb-8">
          Source Library holds over 17,000 digitized books spanning the 15th&ndash;19th centuries,
          drawn from 50+ institutional partners including Internet Archive, Gallica,
          the Bavarian State Library, the Embassy of the Free Mind, and others.
          Subjects range from alchemy, natural philosophy, and theology to
          early science, medicine, law, and world literature.
        </p>

        <div className="grid md:grid-cols-3 gap-4 mb-16">
          <StatCard number="17,000+" label="Digitized books" icon={<BookOpen className="w-5 h-5" />} />
          <StatCard number="30+" label="Languages" icon={<Globe className="w-5 h-5" />} />
          <StatCard number="4M+" label="Pages translated" icon={<Languages className="w-5 h-5" />} />
        </div>

        {/* What researchers get */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          What We Offer Researchers
        </h2>

        <div className="grid md:grid-cols-2 gap-6 mb-16">
          <OfferCard
            icon={<FileText className="w-5 h-5 text-blue-600" />}
            iconBg="bg-blue-100"
            title="Parallel Texts"
            description="Every page is available as the original scan, an OCR transcription in the source language, and an English translation. Switch between views freely. The original is never hidden."
          />
          <OfferCard
            icon={<Search className="w-5 h-5 text-violet-600" />}
            iconBg="bg-violet-100"
            title="Full-Text Search"
            description="Semantic search across the entire corpus in English, with results linked to specific pages. Search translations, then verify against the original text."
          />
          <OfferCard
            icon={<Quote className="w-5 h-5 text-accent-rust" />}
            iconBg="bg-red-50"
            title="Citable Editions"
            description="Published editions receive DOIs via Zenodo with auto-generated Chicago, MLA, and BibTeX citations. Stable URLs for every page."
          />
          <OfferCard
            icon={<Code2 className="w-5 h-5 text-green-600" />}
            iconBg="bg-green-100"
            title="API & MCP Access"
            description="Programmatic access to book metadata, OCR text, translations, and images. An MCP server lets AI assistants query the library directly."
          />
          <OfferCard
            icon={<Database className="w-5 h-5 text-amber-600" />}
            iconBg="bg-amber-100"
            title="Bulk Data"
            description="Request corpus exports for computational analysis — full OCR and translation text, metadata, and image annotations in structured formats."
          />
          <OfferCard
            icon={<Shield className="w-5 h-5 text-stone-600" />}
            iconBg="bg-stone-100"
            title="Transparent Methodology"
            description="Every translation records the model, prompt version, and date. Quality signals include semantic alignment scores and inline OCR warnings. Nothing is a black box."
          />
        </div>

        {/* How to cite */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          How to Cite
        </h2>

        <p className="text-secondary mb-6">
          Source Library texts are AI translations, not human translations.
          We recommend the following citation format for academic work:
        </p>

        <div className="bg-white rounded-xl border border-border-light p-6 mb-4">
          <p className="text-sm text-muted mb-3">General citation format</p>
          <p className="font-mono text-sm text-primary leading-relaxed">
            [Author], <em>[Title]</em>, trans. Source Library AI (Gemini, [year]),
            sourcelibrary.org/book/[slug], p. [N].
          </p>
        </div>

        <div className="bg-white rounded-xl border border-border-light p-6 mb-4">
          <p className="text-sm text-muted mb-3">Example</p>
          <p className="font-mono text-sm text-primary leading-relaxed">
            Agrippa, Heinrich Cornelius. <em>De Occulta Philosophia</em>, trans. Source Library AI
            (Gemini, 2026), sourcelibrary.org/book/de-occulta-philosophia-agrippa, p. 42.
          </p>
        </div>

        <p className="text-secondary text-[15px] leading-relaxed mb-16">
          For DOI-backed editions, use the generated citation on the book page &mdash; it includes
          a persistent identifier suitable for reference lists. We encourage researchers to
          verify passages against the original text, which is always available alongside the translation.
        </p>

        {/* Transparency */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          AI Translation: What You Should Know
        </h2>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 mb-16">
          <div className="space-y-4 text-stone-800 text-[15px] leading-relaxed">
            <p>
              <strong>These are AI translations.</strong> They are produced by Google Gemini models
              reading directly from page scans. They have not been reviewed by human translators
              on a per-book basis. They are designed to make texts <em>accessible</em>, not to replace
              critical editions.
            </p>
            <p>
              <strong>Quality varies by source material.</strong> Well-printed Latin and German texts
              translate reliably. Damaged manuscripts, unusual scripts, and highly technical
              alchemical vocabulary are more challenging. OCR warnings appear inline when the
              model encounters difficulty.
            </p>
            <p>
              <strong>The original is always present.</strong> Every page preserves the source-language
              transcription alongside the translation. Switch to the &ldquo;Original&rdquo; tab to read
              the OCR text, or view the scan directly.
            </p>
            <p>
              For a detailed assessment of translation quality with benchmark comparisons,
              see <Link href="/about/research" className="text-accent-rust hover:underline">How Our Translations Work</Link>.
            </p>
          </div>
        </div>

        {/* Use cases */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Research Use Cases
        </h2>

        <div className="grid md:grid-cols-2 gap-6 mb-16">
          <UseCaseCard
            title="History of Science & Ideas"
            description="Trace concepts across centuries of natural philosophy, alchemy, and early science. Full-text search across translations lets you find thematic connections across works that were previously locked behind Latin, German, or Arabic."
          />
          <UseCaseCard
            title="Digital Humanities"
            description="Build corpora for computational text analysis, topic modeling, or network analysis of intellectual communities. Export structured text with metadata via the API."
          />
          <UseCaseCard
            title="Religious & Theological Studies"
            description="Access Hermetic, Kabbalistic, Rosicrucian, and theological texts in parallel with their originals. Many are first-ever English translations."
          />
          <UseCaseCard
            title="Book History & Bibliography"
            description="Explore printing history with scans linked to institutional catalogs. Each book tracks its source library, digitizer, and publication metadata."
          />
        </div>

        {/* Application form */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6" id="apply">
          <GraduationCap className="w-7 h-7 inline-block mr-2 -mt-1" />
          Apply for Research Access
        </h2>

        <p className="text-secondary mb-8">
          The library is free and open to everyone. If you need API access, bulk data exports,
          or want to discuss a research collaboration, tell us about your work. We respond within
          a few days.
        </p>

        <div className="bg-white rounded-xl border border-border-light p-6 md:p-8 mb-16">
          <AcademicAccessForm />
        </div>

        {/* Related */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Related</h2>

        <div className="grid md:grid-cols-2 gap-4 mb-8">
          <RelatedCard href="/about/research" title="How Our Translations Work" desc="Pipeline details, models, quality signals, and benchmark studies." />
          <RelatedCard href="/developers" title="API & MCP Server" desc="Technical documentation for programmatic access." />
          <RelatedCard href="/about/sources" title="Source Libraries" desc="The 50+ institutional partners we draw from." />
          <RelatedCard href="/explore" title="Explore the Collection" desc="Browse by subject, period, language, or collection." />
        </div>
      </div>
    </ContentPageLayout>
  );
}

/* ── Subcomponents ── */

function StatCard({ number, label, icon }: { number: string; label: string; icon: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-border-light p-5 text-center">
      <div className="flex justify-center mb-3">
        <div className="p-2.5 bg-stone-100 rounded-lg text-stone-600">
          {icon}
        </div>
      </div>
      <div className="text-2xl font-semibold text-primary mb-1">{number}</div>
      <div className="text-sm text-secondary">{label}</div>
    </div>
  );
}

function OfferCard({ icon, iconBg, title, description }: { icon: React.ReactNode; iconBg: string; title: string; description: string }) {
  return (
    <div className="bg-white rounded-xl border border-border-light p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className={`p-2 rounded-lg ${iconBg}`}>{icon}</div>
        <h3 className="font-semibold text-primary">{title}</h3>
      </div>
      <p className="text-secondary text-[15px] leading-relaxed">{description}</p>
    </div>
  );
}

function UseCaseCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="bg-white rounded-xl border border-border-light p-5">
      <h3 className="font-semibold text-primary mb-2">{title}</h3>
      <p className="text-secondary text-[15px] leading-relaxed">{description}</p>
    </div>
  );
}

function RelatedCard({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link href={href} className="block bg-white rounded-xl p-5 border border-border-light hover:border-accent-rust/30 transition-colors">
      <div className="font-semibold text-primary">{title}</div>
      <div className="text-sm text-muted mt-1">{desc}</div>
    </Link>
  );
}
