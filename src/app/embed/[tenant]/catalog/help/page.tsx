import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

/**
 * BPH catalogue editor — help / how-to page. The in-app version of the
 * onboarding instructions for cataloguers (Paul, José). Reachable from the
 * "Help" button on the catalogue toolbar. Public (no secrets), robots-noindex.
 *
 * Issue #1877.
 */

export const metadata: Metadata = {
  title: 'Editing the catalogue — help · BPH',
  robots: { index: false, follow: false },
};

interface Props {
  params: Promise<{ tenant: string }>;
}

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="flex items-baseline gap-2 text-lg text-primary font-display mb-2">
        <span className="text-accent-rust">{n}</span>
        <span>{title}</span>
      </h2>
      <div className="text-[15px] text-secondary leading-relaxed space-y-2">{children}</div>
    </section>
  );
}

export default async function CatalogHelpPage({ params }: Props) {
  const { tenant } = await params;
  if (tenant !== 'bph') notFound();

  return (
    <div className="bg-cream min-h-screen">
      <div className="max-w-2xl mx-auto px-6 py-8">
        <a
          href="/catalog"
          className="inline-flex items-center text-sm text-muted hover:text-primary mb-4 transition-colors"
        >
          ← Back to catalogue
        </a>
        <h1 className="text-2xl sm:text-3xl text-primary font-display leading-tight mb-2">
          Editing the BPH catalogue
        </h1>
        <p className="text-sm text-muted mb-8">
          You can correct and enrich catalogue records directly on this site. Every change is saved
          under your name with the source you cite, so the catalogue keeps a full, scholarly record of
          who changed what and why. Here is the whole workflow.
        </p>

        <Step n="1" title="Sign in">
          <p>
            Use the <strong>Sign in</strong> link with your email — you&rsquo;ll get a one-time link, no
            password to remember. You&rsquo;re set up as an <em>editor</em>, which means your changes go
            live immediately.
          </p>
        </Step>

        <Step n="2" title="Open a record and click “Edit”">
          <p>
            Find any catalogue entry (search, or open it by its UBN). When you&rsquo;re signed in
            you&rsquo;ll see an <strong>Edit catalogue entry</strong> button at the top of the record,
            alongside <strong>History</strong> and (for editors) <strong>Review queue</strong> and{' '}
            <strong>Team</strong>.
          </p>
        </Step>

        <Step n="3" title="Make the change, cite your source, save">
          <p>
            The form begins by asking <strong>where the correction comes from</strong> — a title page, a
            USTC record, the scan, an accession note. That one line is what turns an edit into a citable,
            accountable change, so it&rsquo;s required.
          </p>
          <p>
            Below it the fields are grouped just like the catalogue display: Title, Authorship (with a
            built-in VIAF name lookup), Imprint, Subject &amp; language, Physical description, Location at
            the BPH, Notes, and Identifiers. Change what you need and click <strong>Save changes</strong>.
          </p>
        </Step>

        <Step n="4" title="Add a brand-new record">
          <p>
            Use the <strong>+ New record</strong> button on the catalogue toolbar. It opens the same form
            with a fresh <strong>UBN</strong> (catalogue id) already filled in — an{' '}
            <code className="text-xs bg-warm px-1 rounded">SL-…</code> id that won&rsquo;t clash with the
            BPH&rsquo;s own numbering. If the book already has a real BPH UBN, just type it over the
            suggestion. Fill in at least a title, cite your source, and click <strong>Create record</strong>.
          </p>
        </Step>

        <Step n="5" title="Every change is on the record">
          <p>
            Click <strong>History</strong> on any entry to see every edit: which field changed, from what
            to what, who made it, and the source they cited. It&rsquo;s append-only — a mistake is
            corrected with a new edit, never by erasing the old one. This is the catalogue&rsquo;s audit
            trail.
          </p>
        </Step>

        <div className="border-t border-border-light pt-6 mt-2 text-[15px] text-secondary leading-relaxed space-y-2">
          <h2 className="text-lg text-primary font-display mb-2">A few notes</h2>
          <p>
            <strong>Found something off, or have an idea?</strong> Use the <strong>Feedback</strong> button
            on any of these pages — it comes straight to us, and your hands-on notes shape the tool.
          </p>
          <p>
            Maybe start with a handful of records you know well. The editor is young and your feedback is
            exactly what makes it better.
          </p>
        </div>
      </div>
    </div>
  );
}
