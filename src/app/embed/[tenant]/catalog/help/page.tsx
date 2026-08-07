import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getTenantContext } from '@/lib/tenant-context';
import { catalogIndexPath } from '@/lib/catalog-nav';

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

  const catalogueIndexHref = catalogIndexPath((await getTenantContext())?.source ?? null, tenant);

  return (
    <div className="bg-cream min-h-screen">
      <div className="max-w-[1500px] mx-auto px-6 py-8">
        {/* Wide container so the page shares the top bar's left edge;
            inner measure so prose stays readable at 1500px. */}
        <div className="max-w-2xl">
        <a
          href={catalogueIndexHref}
          className="inline-flex items-center text-sm text-muted hover:text-primary mb-4 transition-colors"
        >
          ← Back to catalogue
        </a>
        <h1 className="text-2xl sm:text-3xl text-primary font-display leading-tight mb-2">
          Editing the BPH catalogue
        </h1>
        <p className="text-sm text-muted mb-8">
          You can correct and enrich catalogue records directly on this site. Every change is
          proposed, reviewed by a librarian, and then saved under your name with the source you
          cited — so the catalogue keeps a full, scholarly record of who changed what and why.
          Here is the whole workflow.
        </p>

        <Step n="1" title="Sign in">
          <p>
            Use the <strong>Sign in</strong> link with your email — you&rsquo;ll get a one-time link,
            no password to remember. Once you&rsquo;re in, the dark bar across the top is the
            editor view of the catalogue; the public sees the same records without it.
          </p>
        </Step>

        <Step n="2" title="Open a record and click “Edit”">
          <p>
            Find any catalogue entry (search from <strong>Browse</strong>, or open it by its UBN).
            Signed in, you&rsquo;ll see <strong>Edit catalogue entry</strong> and{' '}
            <strong>History</strong> on the record itself.
          </p>
        </Step>

        <Step n="3" title="Make the change and cite your source">
          <p>
            The form begins by asking <strong>where the correction comes from</strong> — a title
            page, a USTC record, the scan, an accession note. That one line is what turns an edit
            into a citable, accountable change, so it&rsquo;s required.
          </p>
          <p>
            Below it the fields are grouped just like the catalogue display: Title, Authorship (with
            a built-in VIAF name lookup), Imprint, Subject &amp; language, Physical description,
            Location at the BPH, Notes, and Identifiers. Change what you need and save.
          </p>
        </Step>

        <Step n="4" title="A librarian reviews it">
          <p>
            <strong>Every change goes through review, including an editor&rsquo;s own.</strong> Your
            edit does not touch the live catalogue when you save it — it goes to{' '}
            <strong>Inbox → Edits</strong> as a proposal, with the old and new values side by side.
          </p>
          <p>
            A reviewing librarian can <strong>approve</strong> it, <strong>correct it first and then
            approve</strong> (useful when the correction is right but the wording or the cited source
            needs a touch — the amendment is recorded against the reviewer&rsquo;s name), or{' '}
            <strong>decline</strong> it with a note explaining why.
          </p>
          <p>
            This is deliberately one road in. It means no change reaches the public catalogue that a
            second person has not read.
          </p>
        </Step>

        <Step n="5" title="Add a brand-new record">
          <p>
            Use <strong>+ New record</strong> in the top bar. It opens the same form with a fresh{' '}
            <strong>UBN</strong> (catalogue id) already filled in — an{' '}
            <code className="text-xs bg-warm px-1 rounded">SL-…</code> id that won&rsquo;t clash with
            the BPH&rsquo;s own numbering. If the book already has a real BPH UBN, type it over the
            suggestion. Fill in at least a title, cite your source, and click{' '}
            <strong>Create record</strong>.
          </p>
        </Step>

        <Step n="6" title="Every change stays on the record">
          <p>
            Click <strong>History</strong> on any entry to see every edit: which field changed, from
            what to what, who proposed it, who approved it, and the source cited. It&rsquo;s
            append-only — a mistake is corrected with a new edit, never by erasing the old one. This
            is the catalogue&rsquo;s audit trail.
          </p>
        </Step>

        <div className="border-t border-border-light pt-6 mt-2 mb-8 text-[15px] text-secondary leading-relaxed space-y-3">
          <h2 className="text-lg text-primary font-display mb-2">What the top bar does</h2>
          <p>
            <strong>Browse</strong> — the full catalogue, the same view the public gets.
          </p>
          <p>
            <strong>Inbox</strong> — everything waiting for you, in two tabs.{' '}
            <em>Edits</em> are proposed changes awaiting approval. <em>Feedback</em> is messages
            from people using the site. The number on the bar counts both.
          </p>
          <p>
            <strong>My work</strong> — what you have catalogued, and the records that need a
            librarian&rsquo;s decision.
          </p>
          <p>
            <strong>Team</strong> — invite colleagues and set what they can do. A{' '}
            <em>contributor</em> can propose changes; an <em>editor</em> can also review and approve
            them.
          </p>
        </div>

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
    </div>
  );
}
