import Link from 'next/link';
import OutboundLink from '@/components/analytics/OutboundLink';
import type { Metadata } from 'next';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'For Libraries & Cultural Institutions | Source Library',
  description:
    'Put your archive online in a day. Source Library offers libraries, museums, and cultural institutions a turnkey platform for searchable, AI-translated, citable, embeddable digital collections — used by the Embassy of the Free Mind for the Bibliotheca Philosophica Hermetica.',
  alternates: {
    canonical: '/for-libraries',
  },
};

const CONTACT_EMAIL = 'team@sourcelibrary.org';

export default function ForLibrariesPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="For Libraries & Cultural Institutions"
          subtitle="Put your archive online in a day. Searchable, AI-translated, citable, and embeddable — under your brand, on your domain. Trusted by the Embassy of the Free Mind."
        />
      }
    >
      {/* Proof / lede */}
      <section className="mb-16">
        <div className="bg-white rounded-xl border border-border-light p-6 md:p-8">
          <p className="text-lg text-secondary leading-relaxed mb-4">
            Source Library hosts and powers digital collections for heritage libraries, museums, and
            academic archives. Your books are scanned, OCR&apos;d, translated into English by AI, and
            made searchable across the full text &mdash; with stable citation URLs for every page.
            You keep your brand, your domain, and full control over what&apos;s public.
          </p>
          <p className="text-secondary leading-relaxed">
            The{' '}
            <a
              href="https://www.embassyofthefreemind.com/digital-collection-search"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-rust hover:underline"
            >
              Embassy of the Free Mind
            </a>{' '}
            uses Source Library to publish the{' '}
            <a
              href="https://bph.sourcelibrary.org"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-rust hover:underline"
            >
              Bibliotheca Philosophica Hermetica
            </a>{' '}
            &mdash; thousands of early-modern Hermetic, alchemical, and Rosicrucian works, now
            readable and quotable in English by anyone in the world.
          </p>
        </div>
      </section>

      {/* Two integration paths */}
      <section className="mb-16">
        <h2 className="text-2xl md:text-3xl text-primary mb-3">Two ways to integrate</h2>
        <p className="text-secondary mb-8 max-w-2xl">
          Start with the drop-in embed and your collection is live on your site this afternoon.
          Move to the API later if you want a custom UI &mdash; the data, search, and citations are
          the same.
        </p>

        <div className="grid md:grid-cols-2 gap-6">
          {/* Iframe / drop-in script */}
          <div className="bg-white rounded-xl border border-border-light p-6 md:p-7">
            <div className="flex items-center gap-3 mb-3">
              <span className="inline-block px-2.5 py-1 bg-emerald-100 text-emerald-800 text-xs font-medium rounded-full">
                Fastest
              </span>
              <h3 className="text-xl font-semibold text-primary">Drop-in embed</h3>
            </div>
            <p className="text-secondary text-[15px] leading-relaxed mb-5">
              One line of HTML. We host the entire reading interface &mdash; search, page viewer,
              translations, citations &mdash; inside an iframe on your site. Your CSS, your nav, your
              branding around it. No code to maintain.
            </p>

            <div className="bg-white rounded-lg border border-border-light overflow-hidden mb-5">
              <div className="bg-stone-100 px-4 py-2 border-b border-border-light">
                <span className="text-sm font-medium text-stone-700">HTML snippet</span>
              </div>
              <pre className="p-4 text-sm overflow-x-auto bg-stone-900 text-stone-100">
{`<div id="sl-embed"></div>
<script
  src="https://sourcelibrary.org/embed.js"
  data-library="your-tenant"
  data-target="sl-embed">
</script>`}
              </pre>
            </div>

            <ul className="text-[14px] text-secondary space-y-2 mb-2">
              <li className="flex gap-2"><span className="text-emerald-600">&#10003;</span> Works on Webflow, Squarespace, WordPress, any CMS</li>
              <li className="flex gap-2"><span className="text-emerald-600">&#10003;</span> Auto-updates when we ship new reader features</li>
              <li className="flex gap-2"><span className="text-emerald-600">&#10003;</span> Optional CNAME so URLs stay on your domain</li>
              <li className="flex gap-2"><span className="text-emerald-600">&#10003;</span> Closed-system: visitors can never click out to another institution&apos;s books</li>
            </ul>
          </div>

          {/* REST API + MCP */}
          <div className="bg-white rounded-xl border border-border-light p-6 md:p-7">
            <div className="flex items-center gap-3 mb-3">
              <span className="inline-block px-2.5 py-1 bg-indigo-100 text-indigo-800 text-xs font-medium rounded-full">
                Most control
              </span>
              <h3 className="text-xl font-semibold text-primary">REST API + MCP</h3>
            </div>
            <p className="text-secondary text-[15px] leading-relaxed mb-5">
              Build your own search UI, plug the collection into your AI assistant, or feed it into
              digital-humanities tools. A tenant-scoped API key locks every request to your
              collection &mdash; no cross-institution leakage by design.
            </p>

            <div className="bg-white rounded-lg border border-border-light overflow-hidden mb-3">
              <div className="bg-stone-100 px-4 py-2 border-b border-border-light">
                <span className="text-sm font-medium text-stone-700">REST</span>
              </div>
              <pre className="p-4 text-sm overflow-x-auto bg-stone-900 text-stone-100">
{`curl https://sourcelibrary.org/api/your-tenant/search?q=hermes \\
  -H "Authorization: Bearer sk_..."`}
              </pre>
            </div>

            <div className="bg-white rounded-lg border border-border-light overflow-hidden mb-5">
              <div className="bg-stone-100 px-4 py-2 border-b border-border-light">
                <span className="text-sm font-medium text-stone-700">MCP (for AI assistants)</span>
              </div>
              <pre className="p-4 text-sm overflow-x-auto bg-stone-900 text-stone-100">
{`claude mcp add your-library \\
  https://sourcelibrary.org/api/mcp/your-tenant`}
              </pre>
            </div>

            <ul className="text-[14px] text-secondary space-y-2 mb-2">
              <li className="flex gap-2"><span className="text-indigo-600">&#10003;</span> Books, pages, OCR, translations, images, citations</li>
              <li className="flex gap-2"><span className="text-indigo-600">&#10003;</span> Semantic + full-text search scoped to your collection</li>
              <li className="flex gap-2"><span className="text-indigo-600">&#10003;</span> MCP server for Claude, ChatGPT, and any MCP-compatible agent</li>
              <li className="flex gap-2"><span className="text-indigo-600">&#10003;</span> Rate limits set per partner, audit log per key</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Live demos */}
      <section className="mb-16">
        <h2 className="text-2xl md:text-3xl text-primary mb-3">A live partner library</h2>
        <p className="text-secondary mb-8 max-w-2xl">
          The collection below is live, embedded right here using the same one-line script
          shown above &mdash; a complete reading room running on the platform.
        </p>

        {/* BPH demo */}
        <div className="bg-white rounded-xl border border-border-light overflow-hidden shadow-sm">
          <div className="bg-stone-100 px-4 py-2.5 border-b border-border-light flex items-center justify-between">
            <div>
              <span className="text-sm font-medium text-stone-700">
                Bibliotheca Philosophica Hermetica &mdash; Embassy of the Free Mind
              </span>
              <span className="hidden md:inline text-xs text-muted ml-2">
                Hermetic, alchemical &amp; Rosicrucian works
              </span>
            </div>
            <a
              href="https://bph.sourcelibrary.org"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-accent-rust hover:underline whitespace-nowrap"
            >
              Open in new tab &rarr;
            </a>
          </div>
          <iframe
            src="https://bph.sourcelibrary.org"
            title="Bibliotheca Philosophica Hermetica live embed"
            className="w-full"
            style={{ height: '640px', border: 0 }}
            loading="lazy"
          />
        </div>
      </section>

      {/* What you get */}
      <section className="mb-16">
        <h2 className="text-2xl md:text-3xl text-primary mb-6">What partners get</h2>
        <div className="grid md:grid-cols-2 gap-6">
          <FeatureCard
            title="High-resolution page viewer"
            description="Deep-zoom scans with side-by-side OCR transcription and English translation. Readers can jump to any page, copy text, or download images under your license."
          />
          <FeatureCard
            title="Search across the whole collection"
            description="Lexical and semantic search over OCR and translations. Results link to exact pages with snippet previews."
          />
          <FeatureCard
            title="AI translation pipeline"
            description="Every book OCR'd and translated by Gemini, with quality signals and warnings inline. Translation prompt and model version recorded on every page for auditability."
          />
          <FeatureCard
            title="Citation-ready URLs"
            description="Stable short links for every page (sourcelibrary.org/q/...) plus auto-generated Chicago, MLA, APA, and BibTeX citations. DOI minting via Zenodo for published editions."
          />
          <FeatureCard
            title="Illustration catalog"
            description="Every illustration extracted, classified, and described with AI vision — subjects, figures, technique, symbolism. Browse as a visual gallery."
          />
          <FeatureCard
            title="Analytics dashboard"
            description="Usage by book, country, referrer, and search term. Know which texts are being read and how readers arrive."
          />
          <FeatureCard
            title="Your brand, your domain"
            description="Custom logo, colors, footer, and OG images. CNAME so URLs read library.your-institution.org while we run the infrastructure."
          />
          <FeatureCard
            title="Closed-system isolation"
            description="Your subdomain is a sealed environment — readers cannot navigate, follow links, or be redirected to other institutions' books. Verified by automated leak audits."
          />
        </div>
      </section>

      {/* Trust / isolation */}
      <section className="mb-16">
        <h2 className="text-2xl md:text-3xl text-primary mb-4">Data isolation &amp; control</h2>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
          <ul className="space-y-3 text-[15px] text-stone-800 leading-relaxed">
            <li>
              <strong>Tenant subdomain lockdown.</strong> Every partner gets a dedicated subdomain.
              Internal links, search results, related-books, and redirects are filtered to your
              collection only &mdash; enforced at the proxy, the API, and the UI layer.
            </li>
            <li>
              <strong>Tenant-bound API keys.</strong> A partner key can only see and act on its own
              collection. Cross-tenant requests are rejected at the auth layer, not at the query
              layer.
            </li>
            <li>
              <strong>You keep your rights.</strong> Source Library never claims ownership of your
              scans, metadata, or translations. You can export everything at any time and walk away.
            </li>
            <li>
              <strong>Open standards.</strong> OAI-PMH and IIIF endpoints available for harvesting
              and interoperability with consortium catalogs.
            </li>
          </ul>
        </div>
      </section>

      {/* Use cases */}
      <section className="mb-16">
        <h2 className="text-2xl md:text-3xl text-primary mb-6">Who this is for</h2>
        <div className="grid md:grid-cols-2 gap-6">
          <FeatureCard
            title="Heritage libraries &amp; foundations"
            description="Like the Embassy of the Free Mind / Bibliotheca Philosophica Hermetica — specialized historical collections that deserve a global readership but lack the engineering team to build a modern digital platform."
          />
          <FeatureCard
            title="Academic & university libraries"
            description="Special-collections and rare-books departments that want their holdings discoverable, searchable, and citable without procuring a six-figure IR platform."
          />
          <FeatureCard
            title="Museums & archives"
            description="Institutions whose textual holdings (manuscripts, ephemera, exhibition catalogs) sit underused next to their object collections. Make them readable in any language."
          />
          <FeatureCard
            title="Scholarly societies & research projects"
            description="Edited corpora, society publications, and themed series that need a citable, searchable home with versioned, DOI-backed editions."
          />
        </div>
      </section>

      {/* Pricing / model */}
      <section className="mb-16">
        <h2 className="text-2xl md:text-3xl text-primary mb-4">How it works commercially</h2>
        <div className="bg-white rounded-xl border border-border-light p-6 md:p-8">
          <p className="text-secondary leading-relaxed mb-4">
            We work with each partner individually. Typical engagements include one-time digitization
            and pipeline setup, plus an annual hosting and translation fee scaled to collection size.
            Non-commercial heritage institutions often receive subsidized or grant-funded terms.
          </p>
          <p className="text-secondary leading-relaxed">
            We&apos;re a small team and prefer to start with a short call to understand your
            collection, your audience, and your constraints before quoting anything.
          </p>
        </div>
      </section>

      {/* Contact CTA */}
      <section className="mb-12">
        <div className="bg-gradient-to-br from-stone-900 to-stone-800 text-white rounded-2xl p-8 md:p-10">
          <h2 className="text-2xl md:text-3xl mb-3">Talk to us</h2>
          <p className="text-stone-300 mb-6 max-w-2xl leading-relaxed">
            Tell us about your collection &mdash; what you have, who reads it, where it lives today.
            We&apos;ll get back within a few days with concrete next steps and an honest assessment
            of whether Source Library is the right fit.
          </p>
          <div className="flex flex-wrap gap-3">
            <OutboundLink
              href={`mailto:${CONTACT_EMAIL}?subject=Source%20Library%20partnership%20inquiry`}
              surface="for_libraries"
              channel="email"
              intent="inquiry"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-stone-900 rounded-full hover:bg-stone-100 transition-colors text-sm font-medium"
            >
              Email {CONTACT_EMAIL}
            </OutboundLink>
            <Link
              href="/about"
              className="inline-flex items-center gap-2 px-5 py-2.5 border border-stone-600 text-stone-100 rounded-full hover:bg-stone-700 transition-colors text-sm"
            >
              About Source Library
            </Link>
          </div>
        </div>
      </section>

      {/* Related */}
      <section>
        <h2 className="text-xl text-primary mb-4">Related</h2>
        <div className="grid md:grid-cols-3 gap-4">
          <RelatedCard
            href="/for-researchers"
            title="For Researchers"
            desc="Bulk data, API access, citation guidance for academic work."
          />
          <RelatedCard
            href="/developers"
            title="For Developers"
            desc="MCP server, REST API, CLI — get an API key and start building."
          />
          <RelatedCard
            href="/about"
            title="About Source Library"
            desc="Our mission, methodology, and how the translation pipeline works."
          />
        </div>
      </section>
    </ContentPageLayout>
  );
}

/* ── Subcomponents ── */

function FeatureCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="bg-white rounded-xl border border-border-light p-5">
      <h3 className="font-semibold text-primary mb-2">{title}</h3>
      <p className="text-secondary text-[15px] leading-relaxed">{description}</p>
    </div>
  );
}

function RelatedCard({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link
      href={href}
      className="block bg-white rounded-xl p-5 border border-border-light hover:border-accent-rust/30 transition-colors"
    >
      <div className="font-semibold text-primary">{title}</div>
      <div className="text-sm text-muted mt-1">{desc}</div>
    </Link>
  );
}
