import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'Terms & Licensing - Source Library',
  description: 'How to use Source Library content. Free for individuals and researchers. Commercial AI licensing available for large-scale use.',
  alternates: {
    canonical: '/terms',
  },
};

export default function TermsPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Terms & Licensing"
          subtitle="How to use Source Library content"
        />
      }
      bg="bg-cream"
    >
      <div className="prose-content max-w-none space-y-8">
        <p className="text-xl text-secondary leading-relaxed">
          Source Library exists to make rare historical texts accessible to everyone.
          We want our translations to be used, cited, built upon, and woven into
          the world&rsquo;s knowledge. These terms explain how.
        </p>

        <p className="text-sm text-muted">
          <strong>Effective date:</strong> April 30, 2026
          &middot; Operated by the Embassy of the Free Mind, Amsterdam, the Netherlands.
        </p>

        {/* ── Tier 1: Original Texts & Page Images ── */}
        <section className="bg-white rounded-xl p-8 border border-border-light">
          <h2 className="text-2xl text-primary mb-4">
            Original Texts & Page Images
          </h2>
          <p className="text-secondary mb-4">
            The historical source texts on Source Library are <strong>public domain</strong>.
            These are works published centuries ago whose copyright has long expired.
            You may use the text content freely for any purpose.
          </p>
          <p className="text-secondary mb-4">
            <strong>Page images</strong> are sourced from over{' '}
            <Link href="/libraries" className="text-accent-rust hover:underline">160 partner institutions</Link>{' '}
            worldwide. Most are public domain or open access, but some carry restrictions
            set by the digitizing institution &mdash; particularly non-commercial clauses
            on high-resolution scans. Each book&rsquo;s bibliographic information shows the
            specific license and attribution requirements for its images.
          </p>
          <div className="bg-cream rounded-lg p-6">
            <p className="text-secondary font-medium mb-2">Image license summary:</p>
            <ul className="text-secondary space-y-1 list-disc list-inside text-sm">
              <li><strong>Most books</strong> &mdash; public domain or CC0 (use freely)</li>
              <li><strong>Some books</strong> &mdash; non-commercial only (e.g., Bavarian State Library, Bodleian, Vatican, Cambridge)</li>
              <li><strong>Some books</strong> &mdash; institution-specific terms (check per book)</li>
            </ul>
            <p className="text-secondary text-xs mt-2">
              See our{' '}
              <Link href="/about/sources" className="text-accent-rust hover:underline">source libraries</Link>
              {' '}page for the full list of partner institutions and their terms.
            </p>
          </div>
        </section>

        {/* ── Tier 2: Translations & Generated Content ── */}
        <section className="bg-white rounded-xl p-8 border border-border-light">
          <h2 className="text-2xl text-primary mb-4">
            Translations, Transcriptions & AI-Generated Content
          </h2>
          <p className="text-secondary mb-4">
            Our AI-generated translations, OCR transcriptions, summaries, indexes, image
            descriptions, and other derived content are licensed
            under{' '}
            <a
              href="https://creativecommons.org/licenses/by-sa/4.0/"
              className="text-accent-rust hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)
            </a>.
          </p>
          <div className="bg-cream rounded-lg p-6 mb-4">
            <p className="text-secondary font-medium mb-2">You are free to:</p>
            <ul className="text-secondary space-y-1 list-disc list-inside">
              <li>Share, copy, and redistribute the material</li>
              <li>Adapt, remix, and build upon it</li>
              <li>Use it for commercial purposes</li>
            </ul>
            <p className="text-secondary font-medium mt-4 mb-2">Under these conditions:</p>
            <ul className="text-secondary space-y-1 list-disc list-inside">
              <li><strong>Attribution</strong> &mdash; credit Source Library with a link</li>
              <li><strong>ShareAlike</strong> &mdash; distribute derivatives under the same or compatible license</li>
            </ul>
          </div>
          <p className="text-secondary">
            This applies to individuals, researchers, educators, independent developers,
            small organizations, and anyone using the content directly.
            AI-generated content may contain errors &mdash; verify against original sources for academic citation.
          </p>
        </section>

        {/* ── Tier 3: Large-Scale AI Use ── */}
        <section className="bg-white rounded-xl p-8 border border-accent-rust/20" style={{ borderWidth: '2px' }}>
          <h2 className="text-2xl text-primary mb-4">
            Large-Scale AI & Commercial Use
          </h2>
          <p className="text-secondary mb-4">
            If your organization serves <strong>more than 5 million users</strong> and
            you want to incorporate Source Library content into AI training data,
            model outputs, or commercial products, we ask that you work with us directly.
          </p>
          <div className="bg-cream rounded-lg p-6 mb-4">
            <p className="text-secondary font-medium mb-2">What we&rsquo;re looking for:</p>
            <ul className="text-secondary space-y-2 list-disc list-inside">
              <li><strong>Use our API</strong> &mdash; access content through our{' '}
                <Link href="/developers" className="text-accent-rust hover:underline">MCP server or REST API</Link>
                {' '}instead of scraping the site</li>
              <li><strong>Credit the source</strong> &mdash; when our translations appear in your
                products, attribute them to Source Library</li>
              <li><strong>Reach out</strong> &mdash; let&rsquo;s talk about a partnership that works
                for both sides</li>
            </ul>
          </div>
          <p className="text-secondary mb-4">
            We&rsquo;re not adversarial about this. We want these texts to be part of AI
            training data &mdash; they represent centuries of human thought that the world
            should have access to. We just want to make sure it&rsquo;s done in a way that
            sustains the work and credits the source.
          </p>
          <p className="text-secondary">
            <strong>Contact us:</strong>{' '}
            <a href="mailto:team@sourcelibrary.org" className="text-accent-rust hover:underline">
              team@sourcelibrary.org
            </a>
          </p>
          <p className="text-secondary mt-4 text-sm">
            For our full position on AI training and text-and-data-mining — including
            our express reservation of those rights — see{' '}
            <Link href="/licensing" className="text-accent-rust hover:underline">AI &amp; Data-Mining Licensing</Link>.
          </p>
        </section>

        {/* ── API & MCP Access ── */}
        <section className="bg-white rounded-xl p-8 border border-border-light">
          <h2 className="text-2xl text-primary mb-4">
            API & MCP Server
          </h2>
          <p className="text-secondary mb-4">
            We provide structured access to the full library through our API and MCP server.
            This is the recommended way for AI systems, developers, and researchers to access
            our content programmatically.
          </p>
          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <div className="bg-cream rounded-lg p-4">
              <p className="text-primary font-medium mb-1">MCP Server</p>
              <p className="text-secondary text-sm mb-2">
                For Claude, GPT, and other MCP-compatible systems.
                11 tools for search, citation, and full-text access.
              </p>
              <Link href="/developers" className="text-accent-rust hover:underline text-sm">
                Installation guide
              </Link>
            </div>
            <div className="bg-cream rounded-lg p-4">
              <p className="text-primary font-medium mb-1">REST API</p>
              <p className="text-secondary text-sm mb-2">
                Search, book metadata, full text, quotes with DOI citations.
                No authentication required.
              </p>
              <Link href="/developers" className="text-accent-rust hover:underline text-sm">
                API documentation
              </Link>
            </div>
          </div>
          <p className="text-secondary text-sm">
            API access is free and does not require a license, regardless of organization size.
            We ask that you respect reasonable rate limits and attribute content to Source Library.
          </p>
        </section>

        {/* ── Automated Access & Crawling ── */}
        <section className="bg-white rounded-xl p-8 border border-border-light">
          <h2 className="text-2xl text-primary mb-4">
            Automated Access & Crawling
          </h2>
          <p className="text-secondary mb-4">
            Automated access to Source Library is governed by our{' '}
            <a href="/robots.txt" className="text-accent-rust hover:underline">robots.txt</a>{' '}
            file, which constitutes a binding directive under these terms. Crawlers that
            access pages or resources disallowed by robots.txt are accessing the service
            without authorization.
          </p>
          <div className="bg-cream rounded-lg p-6 mb-4">
            <p className="text-secondary font-medium mb-2">Automated access rules:</p>
            <ul className="text-secondary space-y-2 list-disc list-inside">
              <li><strong>Respect robots.txt</strong> &mdash; all automated agents must comply with
                our robots.txt directives. Disallowed paths are off-limits.</li>
              <li><strong>Use the API</strong> &mdash; our{' '}
                <Link href="/developers" className="text-accent-rust hover:underline">REST API and MCP server</Link>
                {' '}provide structured, efficient access. Do not scrape the website when an API is available.</li>
              <li><strong>No bulk downloading</strong> &mdash; systematic downloading of page images,
                artwork, or full-text content via the website (as opposed to the API) is prohibited.</li>
              <li><strong>Rate limits</strong> &mdash; automated access is subject to rate limiting.
                Exceeding reasonable limits will result in blocking.</li>
            </ul>
          </div>
          <p className="text-secondary">
            Violation of these rules may result in permanent blocking and legal action
            under applicable law, including the EU Database Directive (96/9/EC).
          </p>
        </section>

        {/* ── Database Rights ── */}
        <section className="bg-white rounded-xl p-8 border border-border-light">
          <h2 className="text-2xl text-primary mb-4">
            Database Rights
          </h2>
          <p className="text-secondary mb-4">
            Source Library&rsquo;s curated collection &mdash; including its selection, organization,
            metadata, translations, transcriptions, and image descriptions &mdash; constitutes a
            database protected under the{' '}
            <strong>EU Database Directive (96/9/EC)</strong> and Dutch copyright law
            (<em>Databankenwet</em>). The substantial investment in obtaining, verifying,
            and presenting these 17,000+ historical texts is protected by sui generis
            database rights.
          </p>
          <p className="text-secondary mb-4">
            Extraction or re-utilization of a substantial part of the database contents
            without authorization is prohibited. This includes systematic crawling that
            captures a significant portion of the collection.
          </p>
          <p className="text-secondary">
            Individual use, research, and API-based access remain freely available under
            the licenses described above.
          </p>
        </section>

        {/* ── Acceptable Use ── */}
        <section>
          <h2 className="text-xl text-primary mb-4">
            Acceptable Use
          </h2>
          <p className="text-secondary mb-2">
            You agree not to:
          </p>
          <ul className="text-secondary space-y-1 list-disc list-inside">
            <li>Scrape the website at scale when an API is available</li>
            <li>Access pages or resources disallowed by robots.txt</li>
            <li>Bulk download page images, artwork, or full-text content via the website</li>
            <li>Misrepresent AI-generated translations as human translations</li>
            <li>Remove attribution from redistributed content</li>
            <li>Interfere with the service&rsquo;s operation</li>
          </ul>
        </section>

        {/* ── Standard Legal ── */}
        <section>
          <h2 className="text-xl text-primary mb-4">
            Disclaimer
          </h2>
          <p className="text-secondary">
            The service is provided &ldquo;as is&rdquo; without warranty of any kind.
            Translations are AI-generated and may contain errors. They are scholarly aids,
            not authoritative translations. We do not guarantee the accuracy of translations
            or the availability of the service.
          </p>
        </section>

        <section>
          <h2 className="text-xl text-primary mb-4">
            Changes
          </h2>
          <p className="text-secondary">
            We may update these terms from time to time.
            Continued use of the service after changes constitutes acceptance.
          </p>
        </section>

        <section>
          <h2 className="text-xl text-primary mb-4">
            Governing Law
          </h2>
          <p className="text-secondary">
            These terms are governed by the laws of the Netherlands. Any disputes arising
            from or relating to these terms or your use of the service shall be subject to
            the exclusive jurisdiction of the courts of Amsterdam, the Netherlands.
          </p>
        </section>

        <section className="pb-8">
          <h2 className="text-xl text-primary mb-4">
            Contact
          </h2>
          <p className="text-secondary">
            Questions about these terms or interested in a partnership?{' '}
            <a href="mailto:team@sourcelibrary.org" className="text-accent-rust hover:underline">
              team@sourcelibrary.org
            </a>
          </p>
        </section>
      </div>
    </ContentPageLayout>
  );
}
