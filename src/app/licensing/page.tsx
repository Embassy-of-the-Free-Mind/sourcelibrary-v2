import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'AI & Data-Mining Licensing - Source Library',
  description:
    'How AI training and text-and-data-mining use of Source Library works. Search indexing and individual use are welcome; large-scale AI training requires a separate license.',
  alternates: {
    canonical: '/licensing',
  },
};

export default function LicensingPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="AI & Data-Mining Licensing"
          subtitle="What's open, what's reserved, and how to license training use"
        />
      }
      bg="bg-cream"
    >
      <div className="prose-content max-w-none space-y-8">
        <p className="text-xl text-secondary leading-relaxed">
          We want these texts read, cited, and built upon — including by AI. This
          page states plainly how that works, so there&rsquo;s no ambiguity about
          what is freely permitted and what requires a separate license.
        </p>

        <p className="text-sm text-muted">
          <strong>Effective date:</strong> July 4, 2026
          &middot; Operated by the Embassy of the Free Mind, Amsterdam, the Netherlands.
          &middot; Companion to our <Link href="/terms" className="text-accent-rust hover:underline">Terms &amp; Licensing</Link>.
        </p>

        {/* ── Open ── */}
        <section className="bg-white rounded-xl p-8 border border-border-light">
          <h2 className="text-2xl text-primary mb-4">Freely permitted — no license needed</h2>
          <ul className="space-y-2 text-secondary leading-relaxed list-disc pl-5">
            <li>
              <strong>Original texts &amp; page images</strong> are in the public domain.
              Use them freely.
            </li>
            <li>
              <strong>Our AI-generated translations and editorial content</strong> are
              licensed <strong>CC&nbsp;BY-SA&nbsp;4.0</strong> — free for individuals,
              researchers, and organizations, with attribution and ShareAlike.
            </li>
            <li>
              <strong>Search indexing.</strong> Search engines and AI search crawlers
              (Googlebot, Bingbot, Claude-SearchBot, OAI-SearchBot, …) are welcome to
              index our pages so readers can discover and cite them.
            </li>
            <li>
              <strong>AI assistants reading on a user&rsquo;s behalf.</strong> When a
              person asks an assistant to read or quote a specific Source Library page,
              that&rsquo;s welcome — please show the quote with its page number and the
              page&rsquo;s sourcelibrary.org link.
            </li>
            <li>
              <strong>The public API &amp; MCP server</strong>, within posted rate limits,
              for research and individual use. See <Link href="/developers" className="text-accent-rust hover:underline">/developers</Link>.
            </li>
          </ul>
        </section>

        {/* ── Reserved ── */}
        <section className="bg-white rounded-xl p-8 border border-border-light">
          <h2 className="text-2xl text-primary mb-4">Reserved — a separate license is required</h2>
          <p className="text-secondary leading-relaxed mb-4">
            <strong>Using our content to train, fine-tune, or build AI models, and
            bulk text-and-data-mining (TDM) for those purposes, is expressly
            reserved and requires a separate license from us.</strong> That
            reservation rests on several independent grounds:
          </p>
          <ul className="space-y-3 text-secondary leading-relaxed list-disc pl-5">
            <li>
              <strong>TDM reservation.</strong> We reserve text-and-data-mining rights
              within the meaning of Article&nbsp;4 of EU Directive 2019/790, expressed
              in machine-readable form via <code>/.well-known/tdmrep.json</code> (TDM
              Reservation Protocol), the <code>TDM-Reservation: 1</code> HTTP header on
              every response, and the training-crawler rules in <code>/robots.txt</code>.
              General-purpose AI providers serving the EU market are required to
              identify and respect this reservation.
            </li>
            <li>
              <strong>Database right.</strong> The Source Library corpus — the curated,
              verified, and structured collection of texts, transcriptions,
              translations, and metadata — is a database within the meaning of EU
              Directive 96/9/EC, reflecting substantial investment by the Embassy of
              the Free Mind. Extraction or re-utilization of a substantial part of it
              (including the OCR and metadata layers) requires our authorization,
              independent of the copyright status of any individual item.
            </li>
            <li>
              <strong>First publication of unpublished works.</strong> Where we are
              the first to lawfully publish a previously unpublished public-domain
              work — as with a number of the manuscripts we digitize — we hold the
              exclusive economic rights granted by Article&nbsp;4 of EU Directive
              2006/116/EC for 25 years from publication.
            </li>
            <li>
              <strong>Copyright.</strong> Human-authored editorial content (collection
              essays, blog posts, curatorial descriptions) is protected by copyright.
              Our AI-generated translations and annotations are offered under
              CC&nbsp;BY-SA&nbsp;4.0 — and that license&rsquo;s <em>ShareAlike</em> term
              would require a model built on this material to be released under
              CC&nbsp;BY-SA, which proprietary models do not do. The free license
              therefore does not authorize proprietary AI training.
            </li>
          </ul>
          <p className="text-secondary leading-relaxed mt-4">
            Bulk or training access is available — through the API or a dataset
            license, under the standard terms below or a partnership. We&rsquo;d
            genuinely like these texts in the models that shape how people learn; we
            just ask for a conversation and attribution. Please don&rsquo;t scrape the
            full corpus around the controls.
          </p>
        </section>

        {/* ── Rate card ── */}
        <section className="bg-white rounded-xl p-8 border border-border-light">
          <h2 className="text-2xl text-primary mb-4">Standard training license — rate card</h2>
          <p className="text-secondary leading-relaxed mb-4">
            A training license is available to anyone, on standard terms:
          </p>
          <ul className="space-y-2 text-secondary leading-relaxed list-disc pl-5">
            <li>
              <strong>Per book:</strong> at least <strong>$250 per book</strong> (per
              edition, as listed in our catalog), non-exclusive.
            </li>
            <li>
              <strong>Full corpus:</strong> <strong>$200,000 per year</strong>,
              non-exclusive, with quarterly refresh, delivered as structured data via
              the API or dataset export — no crawling required.
            </li>
          </ul>
          <p className="text-secondary leading-relaxed mt-4 mb-4">
            The license covers training, fine-tuning, and embedding-index use of our
            translations, transcriptions, and editorial content, with attribution.
            What you&rsquo;re licensing is unique: billions of words of <em>aligned
            parallel text</em> — original and English translation, page by page —
            across more than a hundred languages, including scarce low-resource ones
            (Latin, classical Chinese, Sanskrit, Tibetan, Syriac), none of it in
            Common Crawl. Corpus partners additionally receive priority input on what
            gets translated next through our{' '}
            <a href="mailto:derek@sourcelibrary.org?subject=AI%20Partnership" className="text-accent-rust hover:underline">sponsorship program</a>.
          </p>
          <p className="text-secondary leading-relaxed">
            <strong>Unlicensed training use is unauthorized.</strong> Where we identify
            training use of our content without a license, we will invoice at the
            standard rates above and pursue payment under the reserved rights described
            in the previous section.
          </p>
        </section>

        {/* ── Get a license ── */}
        <section className="bg-white rounded-xl p-8 border border-border-light">
          <h2 className="text-2xl text-primary mb-4">Licensing &amp; partnerships</h2>
          <p className="text-secondary leading-relaxed">
            For an AI-training or bulk-dataset license, or a research partnership,
            contact <a href="mailto:derek@sourcelibrary.org?subject=AI%20Licensing%20Inquiry" className="text-accent-rust hover:underline">derek@sourcelibrary.org</a> with
            the subject &ldquo;AI Licensing Inquiry.&rdquo; We respond within a day.
          </p>
        </section>

        <p className="text-sm text-muted">
          This page states our position and our express reservation of rights; it is
          not legal advice. Nothing here waives any right not expressly granted.
        </p>
      </div>
    </ContentPageLayout>
  );
}
