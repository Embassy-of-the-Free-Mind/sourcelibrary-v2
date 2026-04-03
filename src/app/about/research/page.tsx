import Link from 'next/link';
import Image from 'next/image';
import { BookOpen, Scale, CheckCircle2, Layers, Shield, Cpu, AlertTriangle } from 'lucide-react';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'How Our Translations Work | Source Library',
  description: 'How Source Library produces AI translations of historical texts: the pipeline, models, quality signals, and benchmark studies.',
  alternates: {
    canonical: '/about/research',
  },
};

export default function ResearchPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="How Our Translations Work"
          subtitle="Every translation in Source Library is produced by AI and preserved alongside the original text. Here's how the process works, what quality signals we measure, and what the limitations are."
        />
      }
      bg="bg-cream"
    >
      <div className="prose-content max-w-none">

        {/* Overview */}
        <p className="text-xl text-secondary leading-relaxed mb-4">
          Source Library uses Google&apos;s Gemini language models to read and translate historical texts
          from their original languages into English. The original language text is always preserved
          alongside the translation &mdash; every page can be viewed as the original scan, the OCR
          transcription, or the English translation.
        </p>
        <p className="text-xl text-secondary leading-relaxed mb-12">
          These are AI translations, not human translations. They are designed to make texts
          <em> accessible</em> to readers who cannot read the source language. We encourage researchers
          to verify passages against the original text, which is always one click away.
        </p>

        {/* Visual: Three-tab reading interface */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          What You See on Each Book
        </h2>

        <p className="text-secondary mb-6">
          Every book page offers three views. Switch freely between them to compare the original with the translation.
        </p>

        <div className="grid md:grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-xl border border-border-light p-5 text-center">
            <div className="text-3xl mb-3">🖼</div>
            <h3 className="font-semibold text-primary mb-1">Original Scan</h3>
            <p className="text-sm text-secondary">
              The page image as digitized by the source library. High-resolution, zoomable.
            </p>
          </div>
          <div className="bg-white rounded-xl border border-border-light p-5 text-center">
            <div className="text-3xl mb-3">📜</div>
            <h3 className="font-semibold text-primary mb-1">OCR Transcription</h3>
            <p className="text-sm text-secondary">
              The original language text, read by AI from the page image. Searchable and copyable.
            </p>
          </div>
          <div className="bg-white rounded-xl border border-border-light p-5 text-center">
            <div className="text-3xl mb-3">🌐</div>
            <h3 className="font-semibold text-primary mb-1">English Translation</h3>
            <p className="text-sm text-secondary">
              AI translation with scholarly annotations: glosses, marginal notes, and page summaries.
            </p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-16">
          <InfoCard
            title="Book metadata"
            text="Language, date, source institution, page count, translation completeness, image count, and source attribution with links to the digitizing library."
          />
          <InfoCard
            title="First Translation badge"
            text="When verified, shows whether this is the first-ever English translation, with reasoning and the catalog sources searched."
          />
          <InfoCard
            title="Summary & Index"
            text="AI-generated reading overview, plus extracted indexes of people, places, concepts, and vocabulary terms."
          />
          <InfoCard
            title="Chapter navigation"
            text="Table of contents extracted from the text, linked to specific pages for quick navigation."
          />
          <InfoCard
            title="DOI citations"
            text="Published editions receive DOIs via Zenodo with auto-generated Chicago, MLA, and BibTeX citations."
          />
          <InfoCard
            title="Image gallery"
            text="Detected illustrations, emblems, and diagrams with bounding boxes, descriptions, and quality scores."
          />
        </div>

        {/* Example book */}
        <div className="bg-stone-800 rounded-xl p-6 mb-16 text-white">
          <p className="text-stone-400 text-sm mb-3">Example</p>
          <div className="flex flex-col sm:flex-row gap-5">
            <div className="flex-shrink-0">
              <Image
                src="https://images.sourcelibrary.org/book-thumbnails/695203a5ab34727b1f041c53.jpg"
                alt="The Hermetic Museum"
                width={120}
                height={160}
                className="rounded-lg"
                unoptimized
              />
            </div>
            <div>
              <h3 className="font-serif text-xl mb-1">The Hermetic Museum, Restored and Enlarged</h3>
              <p className="text-stone-400 text-sm mb-3">Latin &middot; 1678 &middot; 882 pages &middot; 97% translated</p>
              <p className="text-stone-300 text-sm leading-relaxed mb-3">
                A landmark anthology of 22 alchemical treatises, translated from the original Latin.
                Includes works by Sendivogius, Philalethes, Basil Valentine, and others. Each page
                preserves the original Latin alongside the English translation.
              </p>
              <Link
                href="/book/the-hermetic-museum-various-sendivogius"
                className="text-accent-gold hover:text-accent-gold/80 text-sm transition-colors"
              >
                Read this book &rarr;
              </Link>
            </div>
          </div>
        </div>

        {/* The Translation Process */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-8">The Translation Process</h2>

        <div className="space-y-6 mb-16">
          <StageCard
            number="1"
            title="OCR — Reading the Original"
            color="bg-green-50 text-green-700"
            detail="Gemini vision models read directly from page images, handling blackletter (Fraktur), early modern Latin abbreviations, ligatures, and multi-column layouts. The OCR prompt (currently Standard v6) classifies each page by type — text, illustration, title page, table of contents — and flags quality issues like fading or damage inline within the transcription."
          />
          <StageCard
            number="2"
            title="Translation — Page by Page with Context"
            color="bg-blue-50 text-blue-700"
            detail="Pages are translated sequentially, not in isolation. Each page receives the previous page's translation as context, so the AI maintains consistent terminology and handles sentences that cross page boundaries. All non-English text is translated, including embedded Latin, Greek, Hebrew, or Arabic phrases. Books originally in English before 1700 are modernized from Early Modern English."
          />
          <StageCard
            number="3"
            title="Scholarly Markup"
            color="bg-violet-50 text-violet-700"
          >
            <p className="text-secondary text-[15px] leading-relaxed mb-3">
              Translations include structured annotations that readers can toggle on or off:
            </p>
            <div className="grid sm:grid-cols-2 gap-2">
              <TagExample tag="term" gloss="gloss" desc="Technical terms with English glosses" />
              <TagExample tag="note" desc="Translator's notes and clarifications" />
              <TagExample tag="margin" desc="Marginal annotations from the original" />
              <TagExample tag="unclear" desc="Illegible or damaged passages" />
              <TagExample tag="summary" desc="Page-level content summaries" />
              <TagExample tag="keywords" desc="Index terms for searchability" />
            </div>
          </StageCard>
          <StageCard
            number="4"
            title="Enrichment"
            color="bg-accent-gold/8 text-accent-gold-dark"
            detail="After translation, each book receives a reading summary, an index of people, places, and concepts, subject classification, chapter detection, and image extraction with bounding boxes and descriptions. These are all visible on the book's detail page."
          />
        </div>

        {/* Models */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Models</h2>

        <p className="text-secondary mb-6">
          We use two tiers of Google Gemini models, routed by source collection:
        </p>

        <div className="grid md:grid-cols-2 gap-6 mb-6">
          <div className="bg-white rounded-xl border border-border-light p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-violet-100 rounded-lg">
                <Cpu className="w-5 h-5 text-violet-600" />
              </div>
              <div>
                <h3 className="font-semibold text-primary">Embassy of the Free Mind</h3>
                <p className="text-xs font-mono text-muted">gemini-3-flash-preview</p>
              </div>
            </div>
            <p className="text-secondary text-[15px] leading-relaxed">
              Full-quality model for the BPH collection &mdash; complex manuscripts, rare scripts,
              and typefaces that benefit from higher capability.
            </p>
          </div>
          <div className="bg-white rounded-xl border border-border-light p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Cpu className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h3 className="font-semibold text-primary">All other sources</h3>
                <p className="text-xs font-mono text-muted">gemini-3.1-flash-lite-preview</p>
              </div>
            </div>
            <p className="text-secondary text-[15px] leading-relaxed">
              Cost-efficient model (50% less) for standard printed books from Internet Archive,
              Gallica, Bavarian State Library, and other partners.
            </p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-border-light p-5 mb-16">
          <p className="text-sm text-secondary leading-relaxed">
            Translation prompts are stored as <strong>immutable versions</strong> in the database. Every page records
            which prompt version and model produced its text. Prompts are never edited after deployment &mdash; improvements
            ship as new versions.
            See <Link href="/developers/pipeline" className="text-accent-rust hover:underline">Pipeline Architecture</Link> for
            technical details.
          </p>
        </div>

        {/* Quality Signals */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Quality Signals</h2>

        <p className="text-secondary mb-8">
          Every step in the pipeline is logged, versioned, and auditable. We treat these texts as
          cultural heritage. Processing should be transparent, not a black box.
        </p>

        <div className="grid md:grid-cols-2 gap-6 mb-16">
          <QualityCard
            icon={<Scale className="w-5 h-5 text-purple-600" />}
            iconBg="bg-purple-100"
            title="Semantic Alignment Scoring"
            description="After translation, we compute a cosine similarity score between the original text and the translation using cross-lingual embeddings. Pages below a language-specific threshold (0.83 for Latin, 0.80 for Greek) are flagged for review. This catches mistranslations, hallucinations, and drift."
          />
          <QualityCard
            icon={<CheckCircle2 className="w-5 h-5 text-green-600" />}
            iconBg="bg-green-100"
            title="First-Translation Verification"
            description="Books flagged as 'first translation into English' are automatically verified against 8 catalog sources: Open Library, Google Books, Internet Archive, OpenAlex, Library of Congress, USTC, and our own catalog data."
          />
          <QualityCard
            icon={<AlertTriangle className="w-5 h-5 text-amber-600" />}
            iconBg="bg-amber-100"
            title="OCR Warnings"
            description="When the OCR model encounters faded text, water damage, or binding obscuring text, it inserts inline warnings that propagate to the translation panel. Readers see exactly where the source material was difficult to read."
          />
          <QualityCard
            icon={<Shield className="w-5 h-5 text-blue-600" />}
            iconBg="bg-blue-100"
            title="Page Revisions"
            description="Any process that overwrites OCR or translation data must first create a revision snapshot. Manual corrections are never silently overwritten. The full revision history is always available."
          />
        </div>

        {/* Benchmark */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">
          Benchmark: Poimandres (Greek &rarr; English)
        </h2>

        <p className="text-secondary mb-6">
          To validate translation quality, we compare AI translations against established
          scholarly editions. Below: the <em>Corpus Hermeticum I</em> (Poimandres)
          against Walter Scott&apos;s 1924 <em>Hermetica</em> (Clarendon Press, Oxford).
        </p>

        <div className="space-y-4 mb-6">
          <ComparisonBlock
            section="§1 — Opening"
            ai="A thought once arose in me concerning existing things, and my intellect, soaring greatly aloft, while my bodily senses were overcome by sleep—not, however, like those weighed down from satiety of food or from bodily fatigue..."
            scholarly="Once on a time, when I had begun to think about the things that are, and my thoughts had soared high aloft, while my bodily senses had been put under restraint by sleep,—yet not such sleep as that of men weighed down by fullness of food or by bodily weariness..."
            scholarLabel="Scott (1924)"
          />
          <ComparisonBlock
            section="§4 — The Vision"
            ai="...I saw an infinite vision, a light which had become all things, both gentle and joyful. And I was amazed at the sight."
            scholarly="...I beheld a boundless view; all was changed into light, a mild and joyous light; and I marvelled when I saw it."
            scholarLabel="Scott (1924)"
          />
          <ComparisonBlock
            section="§6 — Theological Statement"
            ai={`"That light," I said, "is Mind, the first God, who existed before the watery nature which appeared from the darkness; and the luminous Word is the Son of God."`}
            scholarly={`'That Light,' he said, 'is I, even Mind, the first God, who was before the watery substance which appeared out of the darkness; and the Word which came forth from the Light is son of God.'`}
            scholarLabel="Scott (1924)"
          />
        </div>

        <div className="bg-green-50 border border-green-200 rounded-lg p-5 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="w-5 h-5 text-status-success" />
            <span className="font-semibold text-green-800">Accuracy: ~92%</span>
          </div>
          <p className="text-sm text-green-900 leading-relaxed">
            Core theological and philosophical concepts accurately rendered. Greek vocabulary
            (nous &rarr; Mind, logos &rarr; Word) handled correctly.
            The AI produces modern, readable English; Scott&apos;s 1924 edition uses period-appropriate archaic style.
          </p>
        </div>

        <p className="text-sm text-muted mb-16">
          Source: <Link href="/book/6953a93977f38f6761bd58f4" className="text-accent-rust hover:underline">
            Scott, Hermetica Vol. I
          </Link> (Internet Archive). Study conducted December 2025.
        </p>

        {/* Limitations */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Limitations</h2>

        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 mb-16">
          <div className="space-y-4 text-stone-800 text-[15px] leading-relaxed">
            <p>
              <strong>These are AI translations.</strong> They have not been reviewed by human translators
              on a per-book basis. Technical terminology in specialized domains (medical, legal, alchemical)
              may reflect the AI&apos;s general training rather than period-specific usage.
            </p>
            <p>
              <strong>No per-book glossaries yet.</strong> The translation prompt handles terminology consistently
              within a book via cross-page context, but there is no explicit glossary of terminological
              decisions for individual works. This is planned for flagship texts.
            </p>
            <p>
              <strong>Citation format.</strong> The translator credit reads &ldquo;Source Library AI&rdquo; rather than
              a named human translator. For peer-reviewed citation, we recommend including the model
              and date: &ldquo;Source Library AI (Gemini, 2026).&rdquo;
              DOI-backed editions provide a more formal citation path.
            </p>
          </div>
        </div>

        {/* Related Pages */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Related</h2>

        <div className="grid md:grid-cols-2 gap-4 mb-8">
          <RelatedCard href="/about/processing" title="How We Process Books" desc="The full 8-stage pipeline from import to publication, with live stats." />
          <RelatedCard href="/about/sources" title="Source Libraries" desc="The 50+ digital libraries, archives, and repositories we draw from." />
          <RelatedCard href="/blog/first-translation-methodology" title="First Translation Methodology" desc="How we verify that a translation is the first into English." />
          <RelatedCard href="/developers/pipeline" title="Pipeline Architecture" desc="Technical details: Lambda workers, SQS queues, Gemini routing." />
          <RelatedCard href="/blog/ocr-consistency" title="OCR Consistency Study" desc="How consistent are AI OCR results across repeated runs?" />
          <RelatedCard href="/developers" title="API & MCP Server" desc="Programmatic access to the collection for researchers and AI systems." />
        </div>
      </div>
    </ContentPageLayout>
  );
}

/* ── Subcomponents ── */

function InfoCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="bg-white rounded-xl border border-border-light p-5">
      <h3 className="font-semibold text-primary mb-2">{title}</h3>
      <p className="text-secondary text-[15px] leading-relaxed">{text}</p>
    </div>
  );
}

function StageCard({ number, title, color, detail, children }: { number: string; title: string; color: string; detail?: string; children?: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-border-light p-6">
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${color}`}>
          {number}
        </div>
        <div>
          <h3 className="font-semibold text-primary">{title}</h3>
        </div>
      </div>
      <div className="ml-11">
        {detail && <p className="text-secondary text-[15px] leading-relaxed">{detail}</p>}
        {children}
      </div>
    </div>
  );
}

function TagExample({ tag, gloss, desc }: { tag: string; gloss?: string; desc: string }) {
  return (
    <div className="bg-stone-50 rounded-lg px-3 py-2 text-sm">
      <span className="font-mono text-xs text-stone-500">
        &lt;{tag}&gt;{gloss ? <> / &lt;{gloss}&gt;</> : null}
      </span>
      <span className="text-secondary ml-2">{desc}</span>
    </div>
  );
}

function QualityCard({ icon, iconBg, title, description }: { icon: React.ReactNode; iconBg: string; title: string; description: string }) {
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

function ComparisonBlock({ section, ai, scholarly, scholarLabel }: { section: string; ai: string; scholarly: string; scholarLabel: string }) {
  return (
    <div className="border border-border-light rounded-xl overflow-hidden">
      <div className="bg-stone-100 px-4 py-2 text-xs font-medium text-secondary">
        {section}
      </div>
      <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border-light">
        <div className="p-4">
          <div className="text-xs text-blue-600 font-medium mb-2">AI Translation</div>
          <p className="text-sm text-stone-700 leading-relaxed">{ai}</p>
        </div>
        <div className="p-4 bg-accent-gold/5">
          <div className="text-xs text-accent-rust font-medium mb-2">{scholarLabel}</div>
          <p className="text-sm text-stone-700 leading-relaxed">{scholarly}</p>
        </div>
      </div>
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
