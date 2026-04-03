import Link from 'next/link';
import { BookOpen, Scale, CheckCircle2, Languages, Layers, Shield, Cpu, GitBranch } from 'lucide-react';
import ContentPageLayout, { SubPageHeader } from '@/components/layout/ContentPageLayout';

export const metadata = {
  title: 'How Our Translations Work | Source Library',
  description: 'How Source Library produces AI translations of historical texts: the pipeline, models, quality signals, and benchmark studies.',
  alternates: {
    canonical: '/about/research',
  },
};

export default function ResearchPage() {
  return (
    <ContentPageLayout
      maxWidth="narrow"
      bg="bg-stone-50"
    >
      <SubPageHeader
        title="How Our Translations Work"
        subtitle="Every translation in Source Library is produced by AI and preserved alongside the original text. Here's how."
      />

      {/* Overview */}
      <section className="bg-white rounded-xl border border-border-light p-6 mb-6">
        <p className="text-secondary leading-relaxed mb-4">
          Source Library uses Google&apos;s Gemini language models to read and translate historical texts
          from their original languages into English. The original language text is always preserved
          alongside the translation &mdash; every page can be viewed as the original scan, the OCR
          transcription, or the English translation.
        </p>
        <p className="text-secondary leading-relaxed mb-4">
          These are AI translations, not human translations. They are designed to make texts
          <em> accessible</em> to readers who cannot read the source language, not to replace
          critical scholarly editions. We encourage researchers to verify passages against the
          original text, which is always one click away.
        </p>
        <div className="flex flex-wrap gap-3 mt-4 text-sm">
          <Link href="/about/processing" className="text-accent-rust hover:underline">
            Full pipeline overview &rarr;
          </Link>
          <Link href="/developers/pipeline" className="text-accent-rust hover:underline">
            Technical architecture &rarr;
          </Link>
        </div>
      </section>

      {/* The Translation Process */}
      <section className="bg-white rounded-xl border border-border-light p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-blue-100 rounded-lg">
            <Layers className="w-5 h-5 text-blue-600" />
          </div>
          <h2 className="text-xl font-semibold text-primary">The Translation Process</h2>
        </div>

        <div className="space-y-4 text-secondary text-[15px] leading-relaxed">
          <div>
            <h3 className="font-medium text-primary mb-1">1. OCR &mdash; Reading the Original</h3>
            <p>
              Gemini vision models read directly from page images, handling blackletter (Fraktur),
              early modern Latin abbreviations, ligatures, and multi-column layouts. The OCR prompt
              (currently Standard v6) classifies each page by type (text, illustration, title page,
              table of contents) and flags quality issues like fading or damage inline.
            </p>
          </div>

          <div>
            <h3 className="font-medium text-primary mb-1">2. Translation &mdash; Page by Page with Context</h3>
            <p>
              Pages are translated <strong>sequentially</strong>, not in isolation. Each page receives
              the previous page&apos;s translation as context, so the AI maintains consistent terminology
              and handles sentences that cross page boundaries. All non-English text is translated,
              including embedded Latin, Greek, Hebrew, or Arabic phrases.
            </p>
          </div>

          <div>
            <h3 className="font-medium text-primary mb-1">3. Scholarly Markup</h3>
            <p>
              Translations include structured annotations that readers can toggle on or off:
            </p>
            <ul className="mt-2 space-y-1 ml-4 text-sm">
              <li><code className="bg-stone-100 px-1.5 py-0.5 rounded text-xs">&lt;term&gt;</code> / <code className="bg-stone-100 px-1.5 py-0.5 rounded text-xs">&lt;gloss&gt;</code> &mdash; technical terms with English glosses</li>
              <li><code className="bg-stone-100 px-1.5 py-0.5 rounded text-xs">&lt;note&gt;</code> &mdash; translator&apos;s notes and clarifications</li>
              <li><code className="bg-stone-100 px-1.5 py-0.5 rounded text-xs">&lt;margin&gt;</code> &mdash; marginal annotations from the original</li>
              <li><code className="bg-stone-100 px-1.5 py-0.5 rounded text-xs">&lt;unclear&gt;</code> &mdash; illegible or damaged passages</li>
              <li><code className="bg-stone-100 px-1.5 py-0.5 rounded text-xs">&lt;summary&gt;</code> / <code className="bg-stone-100 px-1.5 py-0.5 rounded text-xs">&lt;keywords&gt;</code> &mdash; page-level summaries and index terms</li>
            </ul>
          </div>

          <div>
            <h3 className="font-medium text-primary mb-1">4. Enrichment</h3>
            <p>
              After translation, each book receives a reading summary, an index of people, places,
              and concepts, subject classification, chapter detection, and image extraction. These
              are all visible on the book&apos;s detail page.
              See <Link href="/about/processing" className="text-accent-rust hover:underline">How We Process Books</Link> for
              the full 8-stage pipeline.
            </p>
          </div>
        </div>
      </section>

      {/* Models */}
      <section className="bg-white rounded-xl border border-border-light p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-violet-100 rounded-lg">
            <Cpu className="w-5 h-5 text-violet-600" />
          </div>
          <h2 className="text-xl font-semibold text-primary">Models</h2>
        </div>

        <p className="text-secondary text-[15px] leading-relaxed mb-4">
          We use two tiers of Google Gemini models, routed by source collection:
        </p>

        <div className="grid md:grid-cols-2 gap-4 text-sm">
          <div className="bg-stone-50 rounded-lg p-4">
            <div className="font-medium text-primary mb-1">Embassy of the Free Mind books</div>
            <div className="font-mono text-stone-600 text-xs mb-2">gemini-3-flash-preview</div>
            <p className="text-secondary text-sm">
              Full-quality model for the BPH collection &mdash; complex scripts,
              manuscripts, and rare typefaces that benefit from higher capability.
            </p>
          </div>
          <div className="bg-stone-50 rounded-lg p-4">
            <div className="font-medium text-primary mb-1">All other sources</div>
            <div className="font-mono text-stone-600 text-xs mb-2">gemini-3.1-flash-lite-preview</div>
            <p className="text-secondary text-sm">
              Cost-efficient model (50% less) for standard printed books.
              Comparable quality for well-preserved typefaces.
            </p>
          </div>
        </div>

        <p className="text-sm text-muted mt-4">
          Translation prompts are stored as immutable versions in the database. Every page records
          which prompt version and model produced its text. Prompts are never edited after deployment &mdash; improvements
          ship as new versions.
          See <Link href="/developers/pipeline" className="text-accent-rust hover:underline">Pipeline Architecture</Link> for
          technical details.
        </p>
      </section>

      {/* Quality Signals */}
      <section className="bg-white rounded-xl border border-border-light p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-green-100 rounded-lg">
            <Shield className="w-5 h-5 text-green-600" />
          </div>
          <h2 className="text-xl font-semibold text-primary">Quality Signals</h2>
        </div>

        <div className="space-y-4 text-secondary text-[15px] leading-relaxed">
          <div>
            <h3 className="font-medium text-primary mb-1">Semantic Alignment Scoring</h3>
            <p>
              After translation, we compute a cosine similarity score between the original text
              and the translation using cross-lingual embeddings. Pages that fall below a
              language-specific threshold (e.g. 0.83 for Latin, 0.80 for Greek) are flagged
              for review. This catches mistranslations, hallucinations, and OCR-to-translation drift.
            </p>
          </div>

          <div>
            <h3 className="font-medium text-primary mb-1">First-Translation Verification</h3>
            <p>
              Books flagged as &ldquo;first translation into English&rdquo; are automatically verified
              against 8 authoritative catalog sources: Open Library, Google Books, Internet Archive,
              OpenAlex, Library of Congress, USTC, and our own translation catalog data. A Gemini
              model evaluates search results for relevance and makes a disposition (confirmed first,
              partial exists, prior translation found, etc.). Results are shown on each book&apos;s page.
              See <Link href="/blog/first-translation-methodology" className="text-accent-rust hover:underline">First Translation Methodology</Link> for
              full details.
            </p>
          </div>

          <div>
            <h3 className="font-medium text-primary mb-1">OCR Warnings</h3>
            <p>
              When the OCR model encounters faded text, water damage, binding obscuring text,
              or other quality issues, it inserts inline warnings that propagate to the translation
              panel. Readers can see exactly where the source material was difficult to read.
            </p>
          </div>

          <div>
            <h3 className="font-medium text-primary mb-1">Page Revisions</h3>
            <p>
              Any script or process that overwrites OCR or translation data must first create
              a revision snapshot. Manual corrections are never silently overwritten. The full
              history is available on each book&apos;s admin page.
            </p>
          </div>
        </div>
      </section>

      {/* What You See on Each Book */}
      <section className="bg-white rounded-xl border border-border-light p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-accent-gold/15 rounded-lg">
            <BookOpen className="w-5 h-5 text-accent-rust" />
          </div>
          <h2 className="text-xl font-semibold text-primary">What You See on Each Book</h2>
        </div>

        <div className="space-y-3 text-secondary text-[15px] leading-relaxed">
          <p><strong>Reading interface:</strong> Three tabs per page &mdash; original scan, OCR transcription, English translation. Switch freely to compare.</p>
          <p><strong>Book metadata:</strong> Language, date, source institution, page count, translation completeness, and image count. Source attribution with links to the digitizing library.</p>
          <p><strong>First Translation badge:</strong> When verified, shows the disposition (confirmed first, first from this language, etc.) with the reasoning and catalog search results.</p>
          <p><strong>Summary &amp; Index:</strong> AI-generated reading overview, plus an extracted index of people, places, concepts, and vocabulary terms.</p>
          <p><strong>Chapter navigation:</strong> Table of contents extracted from the text, linked to specific pages.</p>
          <p><strong>DOI citations:</strong> Published editions receive DOIs via Zenodo with auto-generated Chicago, MLA, and BibTeX citations.</p>
          <p><strong>Image gallery:</strong> Detected illustrations, emblems, and diagrams with bounding boxes, descriptions, and quality scores.</p>
        </div>
      </section>

      {/* Benchmark Studies */}
      <section className="bg-white rounded-xl border border-border-light p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-purple-100 rounded-lg">
            <Scale className="w-5 h-5 text-purple-600" />
          </div>
          <h2 className="text-xl font-semibold text-primary">Benchmark: Poimandres (Greek &rarr; English)</h2>
        </div>

        <p className="text-secondary text-[15px] leading-relaxed mb-4">
          To validate translation quality, we compare AI translations against established
          scholarly editions. Below is a side-by-side comparison of the <em>Corpus Hermeticum I</em> (Poimandres)
          against Walter Scott&apos;s 1924 <em>Hermetica</em> (Clarendon Press, Oxford).
        </p>

        <div className="space-y-4 mb-6">
          {/* Section 1 */}
          <div className="border border-border-light rounded-lg overflow-hidden">
            <div className="bg-stone-100 px-3 py-1.5 text-xs font-medium text-secondary">
              &sect;1 &mdash; Opening
            </div>
            <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border-light">
              <div className="p-3">
                <div className="text-xs text-blue-600 font-medium mb-1">AI Translation</div>
                <p className="text-sm text-stone-700">
                  A thought once arose in me concerning existing things, and my intellect,
                  soaring greatly aloft, while my bodily senses were overcome by sleep&mdash;not,
                  however, like those weighed down from satiety of food or from bodily fatigue...
                </p>
              </div>
              <div className="p-3 bg-accent-gold/5">
                <div className="text-xs text-accent-rust font-medium mb-1">Scott (1924)</div>
                <p className="text-sm text-stone-700">
                  Once on a time, when I had begun to think about the things that are, and
                  my thoughts had soared high aloft, while my bodily senses had been put
                  under restraint by sleep,&mdash;yet not such sleep as that of men weighed down
                  by fullness of food or by bodily weariness...
                </p>
              </div>
            </div>
          </div>

          {/* Section 4 */}
          <div className="border border-border-light rounded-lg overflow-hidden">
            <div className="bg-stone-100 px-3 py-1.5 text-xs font-medium text-secondary">
              &sect;4 &mdash; The Vision
            </div>
            <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border-light">
              <div className="p-3">
                <div className="text-xs text-blue-600 font-medium mb-1">AI Translation</div>
                <p className="text-sm text-stone-700">
                  ...I saw an infinite vision, a light which had become all things, both
                  gentle and joyful. And I was amazed at the sight.
                </p>
              </div>
              <div className="p-3 bg-accent-gold/5">
                <div className="text-xs text-accent-rust font-medium mb-1">Scott (1924)</div>
                <p className="text-sm text-stone-700">
                  ...I beheld a boundless view; all was changed into light, a mild and
                  joyous light; and I marvelled when I saw it.
                </p>
              </div>
            </div>
          </div>

          {/* Section 6 */}
          <div className="border border-border-light rounded-lg overflow-hidden">
            <div className="bg-stone-100 px-3 py-1.5 text-xs font-medium text-secondary">
              &sect;6 &mdash; Theological Statement
            </div>
            <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border-light">
              <div className="p-3">
                <div className="text-xs text-blue-600 font-medium mb-1">AI Translation</div>
                <p className="text-sm text-stone-700">
                  &quot;That light,&quot; I said, &quot;is Mind, the first God, who existed before the
                  watery nature which appeared from the darkness; and the luminous Word
                  is the Son of God.&quot;
                </p>
              </div>
              <div className="p-3 bg-accent-gold/5">
                <div className="text-xs text-accent-rust font-medium mb-1">Scott (1924)</div>
                <p className="text-sm text-stone-700">
                  &apos;That Light,&apos; he said, &apos;is I, even Mind, the first God, who was before
                  the watery substance which appeared out of the darkness; and the Word
                  which came forth from the Light is son of God.&apos;
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Assessment */}
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle2 className="w-5 h-5 text-status-success" />
            <span className="font-semibold text-green-800">Accuracy: ~92%</span>
          </div>
          <p className="text-sm text-green-900">
            Core theological and philosophical concepts accurately rendered. Greek vocabulary
            (&nu;&omicron;&upsilon;&sigmaf; &rarr; Mind, &lambda;&omicron;&gamma;&omicron;&sigmaf; &rarr; Word) handled correctly.
            The AI produces modern, readable English; Scott&apos;s 1924 edition uses period-appropriate archaic style.
          </p>
        </div>

        <div className="text-sm text-muted">
          <p>
            Source: <Link href="/book/6953a93977f38f6761bd58f4" className="text-accent-rust hover:underline">
              Scott, Hermetica Vol. I
            </Link> (Internet Archive). Study conducted December 2025.
          </p>
        </div>
      </section>

      {/* Limitations */}
      <section className="bg-white rounded-xl border border-border-light p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-amber-100 rounded-lg">
            <GitBranch className="w-5 h-5 text-amber-600" />
          </div>
          <h2 className="text-xl font-semibold text-primary">Limitations</h2>
        </div>

        <div className="space-y-3 text-secondary text-[15px] leading-relaxed">
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
          <p>
            <strong>Early Modern English.</strong> Books originally in English from before 1700 are
            &ldquo;translated&rdquo; into modern English rather than left in their original form.
            The original is always preserved.
          </p>
        </div>
      </section>

      {/* Related Pages */}
      <section className="bg-stone-100 rounded-xl p-6 mb-6">
        <h2 className="text-lg font-semibold text-primary mb-4">Related</h2>
        <div className="grid md:grid-cols-2 gap-3 text-sm">
          <Link href="/about/processing" className="block bg-white rounded-lg p-4 border border-border-light hover:border-accent-rust/30 transition-colors">
            <div className="font-medium text-primary">How We Process Books</div>
            <div className="text-muted mt-1">The full 8-stage pipeline from import to publication, with live stats.</div>
          </Link>
          <Link href="/about/sources" className="block bg-white rounded-lg p-4 border border-border-light hover:border-accent-rust/30 transition-colors">
            <div className="font-medium text-primary">Source Libraries</div>
            <div className="text-muted mt-1">The 50+ digital libraries, archives, and repositories we draw from.</div>
          </Link>
          <Link href="/blog/first-translation-methodology" className="block bg-white rounded-lg p-4 border border-border-light hover:border-accent-rust/30 transition-colors">
            <div className="font-medium text-primary">First Translation Methodology</div>
            <div className="text-muted mt-1">How we verify that a translation is the first into English.</div>
          </Link>
          <Link href="/developers/pipeline" className="block bg-white rounded-lg p-4 border border-border-light hover:border-accent-rust/30 transition-colors">
            <div className="font-medium text-primary">Pipeline Architecture</div>
            <div className="text-muted mt-1">Technical details: Lambda workers, SQS queues, Gemini routing.</div>
          </Link>
          <Link href="/blog/ocr-consistency" className="block bg-white rounded-lg p-4 border border-border-light hover:border-accent-rust/30 transition-colors">
            <div className="font-medium text-primary">OCR Consistency Study</div>
            <div className="text-muted mt-1">How consistent are AI OCR results across repeated runs?</div>
          </Link>
          <Link href="/developers" className="block bg-white rounded-lg p-4 border border-border-light hover:border-accent-rust/30 transition-colors">
            <div className="font-medium text-primary">API &amp; MCP Server</div>
            <div className="text-muted mt-1">Programmatic access to the collection for researchers and AI systems.</div>
          </Link>
        </div>
      </section>
    </ContentPageLayout>
  );
}
