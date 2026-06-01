import { Metadata } from 'next';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'Founding Donors - Source Library',
  description:
    'A letter from Source Library founder Derek Lomas inviting a circle of founding donors to build a permanent home for the translated wisdom of every civilization.',
  robots: { index: false }, // internal page, not indexed
};

const BLOB = 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com';
const DONATE_URL = 'https://form-renderer-app.donorperfect.io/give/naf/embassyofthefreemind';

export default function FoundingDonorsPage() {
  return (
    <ContentPageLayout
      maxWidth="wide"
      header={
        <ContentHeader maxWidth="wide"
          title="A letter to our founding donors"
          subtitle="Source Library &middot; an initiative of the Embassy of the Free Mind, Amsterdam"
          image={`${BLOB}/archived/6952dac677f38f6761bc683a/13.jpg`}
          imageAlt="Robert Fludd, Integra Naturae — the mirror of all nature and the image of art"
        />
      }
      bg="bg-cream"
    >
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-12 lg:gap-16 items-start">

        {/* ───────────── LETTER ───────────── */}
        <article className="font-body text-[1.0625rem] md:text-lg text-secondary leading-[1.8] max-w-[68ch]">

          <p className="font-serif italic text-muted mb-8">
            Amsterdam, May 2026
          </p>

          <p className="mb-6">
            Dear Friend,
          </p>

          <p className="mb-6">
            The first Renaissance began when a small circle of translators in fifteenth-century
            Florence brought Plato and the Hermetic texts out of Greek into Latin. The library
            where that movement was sustained &mdash; the{' '}
            <strong className="text-primary">Bibliotheca Philosophica Hermetica</strong>, now
            part of the Embassy of the Free Mind in Amsterdam &mdash; still holds many of
            those founding volumes today, inscribed on the UNESCO Memory of the World Register.
          </p>

          <p className="mb-6">
            Source Library is the digital continuation of that work. We are using artificial
            intelligence to translate the ancient sources of every civilization &mdash; Latin,
            Greek, Egyptian, Chinese, Sanskrit, Arabic, Hebrew &mdash; into modern English,
            published alongside their original scans so that any scholar can verify every
            line, and any reader can encounter the text at the source.
          </p>

          {/* Pull quote — Joost Ritman */}
          <figure className="my-12 pl-8 border-l-2 border-accent-rust">
            <blockquote className="font-serif italic text-2xl md:text-[1.625rem] text-primary leading-snug">
              &ldquo;We always say here, <em>ad fontes</em> &mdash; go back to the source.
              When you go back deeper and further, you become part of the source. Then you
              can <em>be</em> the source. That&rsquo;s where the magic happens.&rdquo;
            </blockquote>
            <figcaption className="mt-4 text-sm tracking-wide uppercase text-muted">
              Joost Ritman, Founder, Bibliotheca Philosophica Hermetica
            </figcaption>
          </figure>

          <h2 className="font-serif text-2xl md:text-3xl text-primary leading-snug mb-6 mt-12">
            What we have done so far
          </h2>

          <p className="mb-6">
            In our first phase, supported by two seed donors, we built the platform and
            translated more than <strong className="text-primary">10,000 books</strong>{' '}
            into English &mdash; over <strong className="text-primary">5,000 of them for
            the first time in history</strong>. Today, Source Library catalogues 44,000 works
            and hosts more than 6 million pages of original text, fully searchable, free
            to read, free to cite. It is already the largest open-access collection of
            translated ancient texts in the world &mdash; larger than Perseus, Loeb, and
            Sacred-Texts combined.
          </p>

          <p className="mb-6">
            The library is connected by API and MCP to the AI systems that are now reading
            alongside us. A frontier model can today reach into the corpus and answer a
            question about Ficino, Paracelsus, Iamblichus, Lao Tzu, or Ibn Sina, in the
            voice of the source. Two years ago this was not possible at scale. Two years
            from now, training data of this quality and provenance will be the constraint
            on humanities AI itself.
          </p>

          <p className="mb-6">
            The economics have changed too. It now costs about{' '}
            <strong className="text-primary">$1.54 in compute</strong> to translate a book
            through our pipeline. A human translator charges fifteen to fifty thousand for
            the same work. The barrier is no longer the translation. It is the institution
            around it: the curation, the scholarly review, the permanent hosting, the
            partnerships with the world&rsquo;s libraries.
          </p>

          <h2 className="font-serif text-2xl md:text-3xl text-primary leading-snug mb-6 mt-12">
            What we are raising now
          </h2>

          <p className="mb-6">
            We are raising{' '}
            <strong className="text-primary">$10 million over five years</strong>{' '}
            to build Source Library into a permanent institution. The plan is concrete: translate
            another 250,000 books, scan 50,000 more from holding libraries that have not yet
            been digitized, build a partnership network of a thousand library and archive
            collaborators, and convene a standing braintrust of linguists and scholars to
            steward the corpus. Three yearly gatherings &mdash; in Amsterdam, in the Americas,
            and in the East &mdash; will return the project to its founding spirit: people in
            a room with the original texts.
          </p>

          <p className="mb-6">
            We are convening a <strong className="text-primary">founding-donor circle of ten
            to fifty people</strong>. Founding donors will be named, in perpetuity, on the
            translations and programs they make possible. We are inviting them to take part
            in the work directly &mdash; in Amsterdam, at the Embassy, with the original books.
          </p>

          <p className="mb-6">
            If this resonates with you and the means are within reach, I would be honoured
            to discuss what your gift could make possible. Please write to me at{' '}
            <a href="mailto:derek@sourcelibrary.org" className="text-accent-rust hover:underline">
              derek@sourcelibrary.org
            </a>{' '}
            or +31&nbsp;6&nbsp;3404&nbsp;5748. I read every message myself.
          </p>

          <p className="mb-4">
            With gratitude,
          </p>
          <div className="flex items-center gap-4">
            <img
              src="/founder-derek.jpg"
              alt="James Derek Lomas, PhD — Founder, Source Library"
              width={72}
              height={72}
              className="w-[72px] h-[72px] rounded-full object-cover border border-primary/15 shadow-sm shrink-0"
            />
            <div>
              <div className="text-primary font-serif text-lg font-semibold leading-tight">
                James Derek Lomas, PhD
              </div>
              <div className="text-muted text-sm tracking-wide mt-1">
                Founder, Source Library &middot; Embassy of the Free Mind
              </div>
            </div>
          </div>

          <p className="mt-10 text-sm text-muted leading-relaxed border-t border-primary/10 pt-6">
            Source Library is an initiative of the Embassy of the Free Mind (Stichting Het
            Wereldhart, Amsterdam). Donations from US donors are tax-deductible via the
            Netherlands-America Foundation, a 501(c)(3) public charity. Dutch donors give
            via Stichting Het Wereldhart, which holds Cultural ANBI status &mdash; private
            gifts are 125% deductible from taxable income, and five-year periodic gifts
            are fully deductible with no minimum threshold.
          </p>

        </article>

        {/* ───────────── DONATE SIDEBAR ───────────── */}
        <aside className="lg:sticky lg:top-8 self-start">
          <div className="bg-white border border-primary/15 rounded-lg shadow-sm overflow-hidden">

            <div className="bg-[#2a1f17] text-white px-6 py-5">
              <h2 className="font-serif text-xl mb-1">Make a gift</h2>
              <p className="text-white/70 text-sm">Tax-deductible in the US and the Netherlands</p>
            </div>

            <div className="p-6 space-y-5">

              <div>
                <div className="text-xs uppercase tracking-widest text-muted mb-3">Suggested gift</div>
                <div className="grid grid-cols-3 gap-2">
                  {['$100', '$500', '$1,000', '$10,000', '$50,000', '$100K+'].map((amt) => (
                    <a
                      key={amt}
                      href={DONATE_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="border border-primary/20 rounded px-3 py-2 text-center font-semibold text-primary hover:border-accent-rust hover:text-accent-rust transition-colors text-sm"
                    >
                      {amt}
                    </a>
                  ))}
                </div>
              </div>

              <a
                href={DONATE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full text-center px-6 py-3 bg-accent-rust text-white rounded font-semibold hover:bg-accent-rust/90 transition-colors"
              >
                Donate Now
              </a>

              <div className="text-xs text-muted leading-relaxed border-t border-primary/10 pt-4 space-y-1">
                <div>US: 501(c)(3) via Netherlands-America Foundation</div>
                <div>NL: Cultural ANBI via Stichting Het Wereldhart</div>
              </div>

              <div className="border-t border-primary/10 pt-4">
                <div className="text-xs uppercase tracking-widest text-muted mb-2">Major gifts</div>
                <p className="text-sm text-secondary leading-relaxed">
                  For gifts of $25,000 or more, including planned giving, stock, and
                  multi-year commitments, please contact Derek directly.
                </p>
                <a
                  href="mailto:derek@sourcelibrary.org"
                  className="inline-block mt-2 text-sm text-accent-rust hover:underline"
                >
                  derek@sourcelibrary.org
                </a>
              </div>

            </div>
          </div>

          {/* Trust strip */}
          <div className="mt-6 px-2 text-xs text-muted leading-relaxed">
            <p className="mb-2">
              <strong className="text-primary">Institutional home:</strong> Embassy of the
              Free Mind (Amsterdam), home of the Bibliotheca Philosophica Hermetica, inscribed
              on the UNESCO Memory of the World Register.
            </p>
            <p>
              <strong className="text-primary">Fiscal sponsorship (US):</strong>{' '}
              Netherlands-America Foundation, EIN 13-1893924.
            </p>
          </div>
        </aside>

      </div>

      {/* ───────────── FOUNDING DONOR CIRCLE ───────────── */}
      <section className="mt-24 max-w-[68ch]">
        <h2 className="font-serif text-2xl md:text-3xl text-primary leading-snug mb-3">
          The founding-donor circle
        </h2>
        <p className="text-muted text-sm tracking-wide uppercase mb-8">
          Recognition and the work each gift sustains
        </p>

        <dl className="font-body text-secondary text-base leading-relaxed space-y-7">

          <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] md:gap-8 border-b border-primary/10 pb-7">
            <dt>
              <div className="font-serif text-primary text-lg">Founding Visionary</div>
              <div className="text-accent-rust font-semibold text-sm mt-1">$1,000,000+</div>
            </dt>
            <dd>
              One of ten named pillars of the institution. Permanent recognition on every
              translated work within a chosen language or tradition. Advisory Board seat.
              Annual private convening at the Embassy of the Free Mind. Multi-year
              stewardship.
            </dd>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] md:gap-8 border-b border-primary/10 pb-7">
            <dt>
              <div className="font-serif text-primary text-lg">Patron of the Renaissance</div>
              <div className="text-accent-rust font-semibold text-sm mt-1">$100,000 &ndash; $999,999</div>
            </dt>
            <dd>
              A named translation series. Advisory Board seat. Private tour of the
              Bibliotheca Philosophica Hermetica for up to twenty guests. Recognition on
              the donor wall in perpetuity.
            </dd>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] md:gap-8 border-b border-primary/10 pb-7">
            <dt>
              <div className="font-serif text-primary text-lg">Keeper of Knowledge</div>
              <div className="text-accent-rust font-semibold text-sm mt-1">$50,000 &ndash; $99,999</div>
            </dt>
            <dd>
              A sponsored translation volume. Private BPH tour for up to ten guests. Early
              access to translations in progress.
            </dd>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] md:gap-8 border-b border-primary/10 pb-7">
            <dt>
              <div className="font-serif text-primary text-lg">Guardian of Wisdom</div>
              <div className="text-accent-rust font-semibold text-sm mt-1">$25,000 &ndash; $49,999</div>
            </dt>
            <dd>
              Recognition on the donor wall. Private BPH tour for up to five guests.
              Translation previews.
            </dd>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] md:gap-8 border-b border-primary/10 pb-7">
            <dt>
              <div className="font-serif text-primary text-lg">Friend of the Trust</div>
              <div className="text-accent-rust font-semibold text-sm mt-1">$10,000 &ndash; $24,999</div>
            </dt>
            <dd>
              Name on the Founding Donors page. Group tour of the Bibliotheca.
            </dd>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] md:gap-8">
            <dt>
              <div className="font-serif text-primary text-lg">Founding Supporter</div>
              <div className="text-accent-rust font-semibold text-sm mt-1">$1,000 &ndash; $9,999</div>
            </dt>
            <dd>
              Name on the Founding Donors page. Quarterly updates from the program.
            </dd>
          </div>

        </dl>
      </section>

      {/* ───────────── INSTITUTIONAL HOME ───────────── */}
      <section className="mt-24 max-w-[68ch] font-body text-base text-secondary leading-relaxed border-t border-primary/10 pt-10">
        <h2 className="font-serif text-2xl text-primary mb-6">About the founder</h2>
        <p>
          Derek Lomas (PhD, TU Delft) founded Source Library following his work preparing
          the first English translation of Ficino&rsquo;s Latin <em>De Mysteriis</em>{' '}
          (Iamblichus, 1497) for the Embassy of the Free Mind. He works alongside the
          Embassy&rsquo;s team and the Ritman family, who have been stewards of the
          Bibliotheca Philosophica Hermetica since 1957.
        </p>
      </section>

    </ContentPageLayout>
  );
}
