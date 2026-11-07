import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'Terms & Licensing - Source Library',
  description:
    'Want to use text from Source Library? Go for it. The only limitations, and how to reach out if they are too limiting.',
  alternates: {
    canonical: '/terms',
  },
};

const FREE_OR_ASK: Array<[string, 'Go for it' | 'Ask us' | 'License needed']> = [
  ['Reading, searching, studying, and quoting with a link', 'Go for it'],
  ['Teaching, including handouts for a course at a school or university', 'Go for it'],
  ['Research, theses, papers, and academic books that quote and cite', 'Go for it'],
  ['Sharing a text with friends, a reading group, a free blog, or social media', 'Go for it'],
  ['Quoting a passage in commercial work: a book, article, podcast, paid course or product, where our text is not the main thing being sold', 'Go for it'],
  ['An assistant fetching a page because a person asked it to', 'Go for it'],
  ['Non-profit academic research that uses AI or mines the text', 'Go for it'],
  ['Selling a book, course, app or membership where our text is the main thing people pay for', 'Ask us'],
  ['Training, fine-tuning or evaluating an AI model for a commercial product', 'License needed'],
  ['Copying a collection or a large part of the library', 'License needed'],
];

const LAYERS: Array<[string, string]> = [
  ['Original texts', 'Public domain. We claim nothing in them.'],
  ['Page images', 'The holding library’s terms apply, and each book shows them. We grant nothing in the scans.'],
  ['Our transcriptions, translations, summaries, indexes and image descriptions', 'CC BY-NC-SA 4.0, plus the extra permission on this page.'],
  ['Text taken from another open source', 'Keeps that source’s licence.'],
  ['Published editions with their own DOI', 'The licence stated on the edition.'],
  ['Essays and notes written by people', 'CC BY-NC-SA 4.0 unless the page says otherwise.'],
  ['The library as a whole', 'One creative work: its selection and arrangement of books, and how they are read, translated and connected. All rights in the whole are reserved, including copyright in the compilation and database rights.'],
  ['Software', 'AGPL-3.0-or-later.'],
];

export default function TermsPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Terms & Licensing"
          subtitle="How to use Source Library"
        />
      }
      bg="bg-cream"
    >
      <div className="prose-content max-w-none space-y-8">
        <p className="text-xl text-secondary leading-relaxed">
          Want to use text from Source Library? Go for it! Here are the only
          limitations, and{' '}
          <a href="mailto:team@sourcelibrary.org" className="text-accent-rust hover:underline">
            reach out
          </a>{' '}
          if they are too limiting.
        </p>

        <p className="text-sm text-muted">
          <strong>Effective date:</strong> November 6, 2026
          &middot; Operated by Stichting Het Wereldhart (Embassy of the Free Mind), Amsterdam, the Netherlands.
        </p>

        <p className="text-secondary">
          Source Library was created by Derek Lomas, who chose its books and set how they are read, translated and connected.
        </p>

        <section className="bg-white rounded-xl p-8 border border-border-light">
          <h2 className="text-2xl text-primary mb-4">The limitations</h2>
          <ol className="text-secondary space-y-3 list-decimal pl-5 leading-relaxed">
            <li><strong>Credit us.</strong> Name Source Library and link to the page you used.</li>
            <li><strong>Share alike.</strong> If you publish an adapted version, offer it on these same terms.</li>
            <li><strong>Ask first if our text is what you are selling.</strong> Quoting it inside your own commercial work is fine.</li>
            <li><strong>You need a license from us to train a commercial AI model on it, or to copy a large part of the library.</strong> Without one, you do not have permission.</li>
          </ol>
          <p className="text-secondary mt-4">
            To ask, write to{' '}
            <a href="mailto:team@sourcelibrary.org" className="text-accent-rust hover:underline">
              team@sourcelibrary.org
            </a>{' '}
            and say what you want to do. We often say yes for free. For licenses and rates, see{' '}
            <Link href="/licensing" className="text-accent-rust hover:underline">AI &amp; Data Licensing</Link>.
          </p>
        </section>

        <section className="bg-white rounded-xl p-8 border border-border-light">
          <h2 className="text-2xl text-primary mb-4">Examples</h2>
          <p className="text-secondary mb-4">
            A use is commercial if it is mainly meant to make money or gain a business
            advantage. What counts is the use, not who you are.
          </p>
          <ul className="space-y-2">
            {FREE_OR_ASK.map(([use, answer]) => (
              <li key={use} className="flex items-baseline justify-between gap-4 text-secondary border-b border-border-light pb-2">
                <span>{use}</span>
                <strong className="whitespace-nowrap text-primary">{answer}</strong>
              </li>
            ))}
          </ul>
          <p className="text-secondary mt-4">Not on the list? Ask. Nothing here limits what the law already lets you do, such as quoting or research under a statutory exception.</p>
        </section>

        <section className="bg-white rounded-xl p-8 border border-border-light">
          <h2 className="text-2xl text-primary mb-4">What licence applies to what</h2>
          <dl className="space-y-3">
            {LAYERS.map(([layer, rule]) => (
              <div key={layer}>
                <dt className="text-primary font-medium">{layer}</dt>
                <dd className="text-secondary">{rule}</dd>
              </div>
            ))}
          </dl>
          <p className="text-secondary mt-4">
            The licence is{' '}
            <a
              href="https://creativecommons.org/licenses/by-nc-sa/4.0/"
              className="text-accent-rust hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              CC BY-NC-SA 4.0
            </a>
            . The commercial quoting allowed above is an extra permission from us on top of it.
          </p>
          <p className="text-secondary mt-4">
            <strong>Earlier copies.</strong> Until November 5, 2026 we offered this text under CC BY-SA 4.0.
            Copies obtained under that licence stay under it. From that date we offer the text on these
            terms. A signed agreement with us takes priority over this page.
          </p>
          <p className="text-secondary mt-4">
            These terms also set the conditions for using this site and our API.
          </p>
        </section>

        <section className="bg-white rounded-xl p-8 border border-border-light">
          <h2 className="text-2xl text-primary mb-4">API, MCP server and automated access</h2>
          <p className="text-secondary mb-4">
            Programs should use our{' '}
            <Link href="/developers" className="text-accent-rust hover:underline">REST API or MCP server</Link>,
            within the posted limits, rather than scraping the website. Search engines and assistants reading
            on a person&rsquo;s behalf are welcome. Getting or using an API key means you agree to these terms.
          </p>
          <p className="text-secondary">
            We reserve commercial text and data mining under Article 4 of EU Directive 2019/790, in
            machine-readable form: <code>/.well-known/tdmrep.json</code>, the <code>TDM-Reservation</code>{' '}
            header and <a href="/robots.txt" className="text-accent-rust hover:underline">robots.txt</a>.
            We may rate-limit or block automated traffic that strains the service or ignores these limits.
          </p>
        </section>

        {/* ── The Embassy's collection. Asked for by src/lib/partner-terms.ts; a change of substance here needs a new PARTNER_TERMS_VERSION. ── */}
        <section id="embassy-collection" className="bg-white rounded-xl p-8 border border-border-light scroll-mt-24">
          <h2 className="text-2xl text-primary mb-4">
            The Embassy of the Free Mind&rsquo;s Collection
          </h2>
          <p className="text-secondary mb-4">
            Books from the Bibliotheca Philosophica Hermetica, held by the Embassy of the Free
            Mind in Amsterdam, are shown here in partnership with the Embassy. You are asked to
            agree to these terms before downloading one. You also agree to them when you create an
            API key, or when you run a program that downloads from this collection.
          </p>
          <div className="bg-cream rounded-lg p-6 mb-4">
            <ul className="text-secondary space-y-2 list-disc list-inside">
              <li><strong>What you may do:</strong> read, study, teach from and quote these books,
                with credit to the Embassy of the Free Mind and Source Library.</li>
              <li><strong>Bulk copying:</strong> you may not download or scrape the collection, or a
                substantial part of it, by automated means without written permission.</li>
              <li><strong>AI training:</strong> you may not use the collection to train AI models
                without a licence. See{' '}
                <Link href="/licensing" className="text-accent-rust hover:underline">licensing</Link>.</li>
              <li><strong>What a file allows:</strong> a licence stated on a file you have downloaded
                continues to apply to that file. These terms govern how you get it.</li>
              <li><strong>What we keep:</strong> when you agree, we record the date, these terms&rsquo;
                version, the book and format, your account if you are signed in, your browser&rsquo;s
                description of itself, and a hash of your network address, not the address.</li>
            </ul>
          </div>
          <p className="text-secondary text-sm">Version 2026-11-04.</p>
        </section>

        {/* ── Asked by the edge rule in scripts/maintenance/reader-terms-rule.mjs. A change of substance here needs a new READER_TERMS_VERSION. ── */}
        <section id="reading-terms" className="bg-white rounded-xl p-8 border border-border-light scroll-mt-24">
          <h2 className="text-2xl text-primary mb-4">Reading the library</h2>
          <p className="text-secondary mb-4">
            If you open a page of a book directly, without following a link or a citation, we ask you
            once to agree to these terms. You agree by ticking the box and continuing.
          </p>
          <div className="bg-cream rounded-lg p-6 mb-4">
            <ul className="text-secondary space-y-2 list-disc list-inside">
              <li><strong>What you may do:</strong> read, study, teach from and quote the library, as
                set out at the top of this page.</li>
              <li><strong>Bulk copying:</strong> you may not copy the library, a collection or a large
                part of either by automated means without written permission. Non-profit academic
                research can use our{' '}
                <Link href="/developers" className="text-accent-rust hover:underline">API</Link> within
                the posted limits.</li>
              <li><strong>AI training:</strong> training, fine-tuning or evaluating an AI model for a
                commercial product needs a{' '}
                <Link href="/licensing" className="text-accent-rust hover:underline">licence</Link>.</li>
              <li><strong>What we keep:</strong> when you agree, we record the date, these
                terms&rsquo; version, the page, your browser&rsquo;s description of itself, and a hash
                of your network address, not the address. A cookie remembers your answer for a year.</li>
            </ul>
          </div>
          <p className="text-secondary text-sm">Version 2026-11-06.</p>
        </section>

        <section>
          <h2 className="text-xl text-primary mb-4">Your contributions</h2>
          <p className="text-secondary">
            If you send corrections, reviews or other contributions, you keep your rights in them and give
            us a free, non-exclusive, worldwide licence to publish, adapt and license them as part of the
            library, including under commercial agreements.
          </p>
        </section>

        <section>
          <h2 className="text-xl text-primary mb-4">Purchases and donations</h2>
          <p className="text-secondary">
            The price and what you receive are shown before you pay. If you are a consumer, the rights
            consumer law gives you are not affected.
          </p>
        </section>

        <section>
          <h2 className="text-xl text-primary mb-4">Acceptable use</h2>
          <ul className="text-secondary space-y-1 list-disc list-inside">
            <li>Do not interfere with the service or get around its limits.</li>
            <li>Do not remove attribution from what you redistribute.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl text-primary mb-4">Disclaimer</h2>
          <p className="text-secondary">
            The service is provided as is. Translations may contain errors, so check them against the
            original before relying on them. This does not limit liability that the law
            does not allow us to limit.
          </p>
        </section>

        <section>
          <h2 className="text-xl text-primary mb-4">Changes</h2>
          <p className="text-secondary">
            We may update these terms. We change the effective date above, and tell you directly about
            significant changes where we can. Changes apply to use after that date.
          </p>
        </section>

        <section>
          <h2 className="text-xl text-primary mb-4">Governing law</h2>
          <p className="text-secondary">
            Dutch law applies, and disputes go to the courts of Amsterdam. If you are a consumer, you keep
            the protections and the right to go to court that the law of your home country gives you.
          </p>
        </section>

        <section className="pb-8">
          <h2 className="text-xl text-primary mb-4">Contact</h2>
          <p className="text-secondary">
            Questions, permission requests, or a concern about something on the site:{' '}
            <a href="mailto:team@sourcelibrary.org" className="text-accent-rust hover:underline">
              team@sourcelibrary.org
            </a>
          </p>
        </section>
      </div>
    </ContentPageLayout>
  );
}
