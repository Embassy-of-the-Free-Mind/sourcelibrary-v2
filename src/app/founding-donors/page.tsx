import { Metadata } from 'next';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'Founding Donors - Source Library',
  description:
    'Join Source Library as a founding donor. Help translate 100,000 rare historical texts into English — the entire digitized Renaissance.',
  robots: { index: false }, // internal page, not indexed
};

const BLOB = 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com';

export default function FoundingDonorsPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Founding Donors"
          subtitle="Source Library &middot; Embassy of the Free Mind"
          image={`${BLOB}/archived/6952dac677f38f6761bc683a/13.jpg`}
          imageAlt="Robert Fludd, Integra Naturae — the mirror of all nature and the image of art"
        />
      }
      bg="bg-cream"
    >
      <div className="max-w-none">

        {/* ── The Problem ── */}
        <h2 className="font-serif text-3xl md:text-4xl text-primary leading-snug mb-6">
          95% of what the Renaissance wrote has never been translated.
        </h2>

        <div className="space-y-5 font-body text-lg text-secondary leading-relaxed">
          <p>
            Thousands of books on alchemy, natural philosophy, and the origins of modern
            science sit in European libraries &mdash; digitized but unreadable, locked behind
            Latin, German, and Greek. The books that inspired Copernicus and shaped
            Newton&rsquo;s thinking are inaccessible to virtually everyone alive today.
          </p>

          <p>
            Source Library uses AI to translate these texts at unprecedented scale and cost.
            Our pipeline reads every page in its original language, translates it into English,
            and presents the translation alongside the original scan &mdash; so scholars can
            verify every line.
          </p>

          <p className="text-primary font-semibold text-xl">
            Cost per book: $1.54. A professional translator charges $15,000&ndash;$50,000.
          </p>
        </div>

        {/* ── Traction ── */}
        <h3 className="font-serif text-2xl text-primary pt-12 mb-6">Where we are today</h3>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
          {[
            { number: '10,000+', label: 'Books in collection' },
            { number: '4,300+', label: 'Books fully translated' },
            { number: '800K+', label: 'Pages translated' },
            { number: '15+', label: 'Source languages' },
            { number: '< 5,000', label: 'Perseus + Loeb + Sacred-texts combined' },
            { number: 'Free', label: 'Open access to all' },
          ].map((stat) => (
            <div key={stat.label} className="bg-white rounded-xl p-5 border border-primary/10">
              <div className="text-2xl md:text-3xl text-accent-rust font-light mb-1">
                {stat.number}
              </div>
              <div className="text-muted text-sm">{stat.label}</div>
            </div>
          ))}
        </div>

        <p className="font-body text-lg text-secondary leading-relaxed">
          Larger than every comparable platform combined &mdash; and free.
        </p>

        {/* ── The Opportunity ── */}
        <h3 className="font-serif text-2xl text-primary pt-12 mb-6">The opportunity</h3>

        <div className="space-y-5 font-body text-lg text-secondary leading-relaxed">
          <p>
            150,000&ndash;250,000 premodern books are already digitized in European research
            libraries via IIIF, waiting to be translated. The technology exists. The pipeline
            works. The unit economics are proven.
          </p>

          <p className="text-primary font-semibold text-xl">
            $250K translates 100,000 books by June &mdash; essentially the entire digitized Renaissance.
          </p>
        </div>

        {/* ── Impact Table ── */}
        <h3 className="font-serif text-2xl text-primary pt-12 mb-6">What your support funds</h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left font-body text-base">
            <thead>
              <tr className="border-b-2 border-primary/20">
                <th className="py-3 pr-6 text-primary font-semibold">Gift</th>
                <th className="py-3 text-primary font-semibold">Impact</th>
              </tr>
            </thead>
            <tbody className="text-secondary">
              {[
                ['$1,000', '650 books translated \u2014 more than the entire Loeb Classical Library'],
                ['$10,000', 'One month of full-scale operations'],
                ['$50,000', '3 months of scaling + first editorial hire'],
                ['$100,000', '10,000 \u2192 50,000 translated texts'],
                ['$250,000', '100,000 translated texts by June \u2014 the entire digitized Renaissance'],
              ].map(([gift, impact]) => (
                <tr key={gift} className="border-b border-primary/10">
                  <td className="py-3 pr-6 font-semibold text-accent-rust whitespace-nowrap">{gift}</td>
                  <td className="py-3">{impact}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Founding Donor Tiers ── */}
        <h3 className="font-serif text-2xl text-primary pt-12 mb-6">Founding donor recognition</h3>

        <div className="space-y-4">
          {[
            {
              tier: 'Patron of the Renaissance',
              range: '$100,000+',
              perks: 'Named translation series, Advisory Board seat, private BPH tour (20 guests), logo on site',
            },
            {
              tier: 'Keeper of Knowledge',
              range: '$50,000\u2013$99,999',
              perks: 'Sponsored translation volume, BPH tour (10 guests), early access to translations',
            },
            {
              tier: 'Guardian of Wisdom',
              range: '$25,000\u2013$49,999',
              perks: 'Logo on site, BPH tour (5 guests), translation previews',
            },
            {
              tier: 'Friend of the Trust',
              range: '$10,000\u2013$24,999',
              perks: 'Name on Founding Donors page, group BPH tour',
            },
            {
              tier: 'Founding Supporter',
              range: '$1,000\u2013$9,999',
              perks: 'Name on Founding Donors page, quarterly updates',
            },
          ].map((t) => (
            <div key={t.tier} className="bg-white rounded-xl p-5 border border-primary/10">
              <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1 mb-2">
                <h4 className="font-serif text-lg text-primary">{t.tier}</h4>
                <span className="text-accent-rust font-semibold text-sm">{t.range}</span>
              </div>
              <p className="text-muted text-sm">{t.perks}</p>
            </div>
          ))}
        </div>

        {/* ── Institutional Home ── */}
        <h3 className="font-serif text-2xl text-primary pt-12 mb-6">Institutional home</h3>

        <div className="space-y-5 font-body text-lg text-secondary leading-relaxed">
          <p>
            The <strong>Embassy of the Free Mind</strong> in Amsterdam houses the Bibliotheca
            Philosophica Hermetica &mdash; one of the world&rsquo;s most important collections of
            esoteric and philosophical texts, inscribed on the{' '}
            <strong>UNESCO Memory of the World Register</strong>. Source Library is an initiative
            of the Ancient Wisdom Trust (Wereldhart), the Embassy&rsquo;s supporting foundation.
          </p>

          <p>
            Founded by <strong>James Derek Lomas, PhD</strong> (TU Delft), following his work
            preparing the first English translation of Marsilio Ficino&rsquo;s{' '}
            <em>Liber de Voluptate</em> (1457) for the Embassy.
          </p>

          <p className="font-semibold text-primary">
            Fiscally sponsored by the National Arts Fund (NAF). All donations are tax-deductible.
          </p>
        </div>

        {/* ── CTA ── */}
        <div className="mt-12 p-8 bg-[#2a1f17] rounded-xl text-white text-center">
          <h3 className="font-serif text-2xl mb-3">Become a founding donor</h3>
          <p className="text-white/70 mb-6 max-w-lg mx-auto">
            Join the charter group supporting the largest translation project since the Renaissance itself.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="https://form-renderer-app.donorperfect.io/give/naf/embassyofthefreemind"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block px-8 py-3 bg-accent-rust text-white rounded-lg font-semibold hover:bg-accent-rust/90 transition-colors"
            >
              Donate Now
            </a>
            <a
              href="mailto:derek@sourcelibrary.org"
              className="inline-block px-8 py-3 border border-white/30 text-white rounded-lg font-semibold hover:border-white/60 transition-colors"
            >
              Get in Touch
            </a>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="mt-12 pt-8 border-t border-primary/10 text-muted text-sm text-center space-y-1">
          <p>derek@sourcelibrary.org &middot; +31-6-3404-5748</p>
          <p>sourcelibrary.org</p>
        </div>

      </div>
    </ContentPageLayout>
  );
}
