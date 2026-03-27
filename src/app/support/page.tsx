'use client';

import Link from 'next/link';

// TODO: Ask NAF for a Source Library-specific DonorPerfect form.
// When available, replace this URL so donors see "Source Library" instead of the generic Embassy form.
const DONORPERFECT_URL = 'https://form-renderer-app.donorperfect.io/give/naf/embassyofthefreemind';

const CONTACT_EMAIL = 'derek@ancientwisdomtrust.org';

const MEMBERSHIP_TIERS = [
  {
    name: 'Friend',
    price: '$100',
    period: '/ year',
    description: 'Join the community and follow the work as it unfolds.',
    benefits: [
      'Monthly digest of newly translated texts',
      'Name on the Source Library supporters page',
      'Museum access at the Embassy of the Free Mind',
      'Community event invitations',
    ],
  },
  {
    name: 'Freethinker',
    price: '$500',
    period: '/ year',
    highlight: true,
    description: 'Sustain the scholarly pipeline and shape which texts come next.',
    benefits: [
      'Everything in Friend',
      'Quarterly reports on the translation pipeline',
      'Vote on which texts are prioritized for review',
      'Invitations to exclusive events and openings',
    ],
  },
  {
    name: 'Pioneer',
    price: '$1,000',
    period: '/ year',
    description: 'Leave your mark on the collection and help build the foundation.',
    benefits: [
      'Everything in Freethinker',
      'Named acknowledgment on reviewed books',
      'Private rare book tour for you and guests',
      'Direct updates from the project lead',
    ],
  },
];

export default function SupportPage() {
  return (
    <div className="min-h-screen">
      {/* Header */}
      <section className="bg-gradient-to-b from-[#f6f3ee] to-white pt-8 pb-16 md:pt-12 md:pb-24">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <Link href="/" className="inline-flex items-center gap-2 text-sm mb-10 hover:opacity-70 transition-opacity" style={{ color: 'var(--text-muted)' }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to library
          </Link>
          <h1 className="text-3xl md:text-4xl lg:text-5xl text-stone-900 mb-6 leading-tight font-display">
            Support Source Library
          </h1>
          <p className="text-lg md:text-xl text-stone-600 leading-relaxed max-w-3xl">
            Your donation funds the digitization and translation of rare texts from the Bibliotheca Philosophica Hermetica — making 2,500 years of wisdom freely available to everyone.
          </p>
        </div>
      </section>

      {/* Why Now */}
      <section className="bg-white py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <h2
            className="text-3xl md:text-4xl lg:text-5xl text-gray-900 mb-8 leading-tight font-display"
          >
            Why now?
          </h2>
          <p className="text-lg md:text-xl text-gray-600 leading-relaxed">
            Foundation AI models are being trained today on datasets that will shape how artificial intelligence reasons about philosophy, ethics, consciousness, and meaning for years to come. The Hermetic tradition, Renaissance natural philosophy, and 2,500 years of esoteric thought are almost entirely absent from these datasets. Getting this material in now — verified, citable, linked to scans of original pages — means it shapes AI&apos;s understanding from the ground up.
          </p>
        </div>
      </section>

      {/* Become a Member */}
      <section className="bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6] py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <h2
            className="text-3xl md:text-4xl text-stone-900 mb-4 leading-tight font-display"
          >
            Become a Member
          </h2>
          <p className="text-lg text-stone-600 mb-12 max-w-3xl">
            Join an international community dedicated to making universal wisdom accessible — to humanity and to the AI systems shaping our future.
          </p>

          {/* Tier Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
            {MEMBERSHIP_TIERS.map((tier) => (
              <div
                key={tier.name}
                className={`rounded-2xl p-8 flex flex-col ${
                  tier.highlight
                    ? 'bg-stone-900 text-white ring-2 ring-stone-700'
                    : 'bg-white border border-stone-200 shadow-sm'
                }`}
              >
                <h3 className={`text-xl font-semibold mb-1 ${tier.highlight ? 'text-white' : 'text-stone-900'}`}>
                  {tier.name}
                </h3>
                <div className="mb-4">
                  <span className={`text-3xl font-bold ${tier.highlight ? 'text-white' : 'text-stone-900'}`}>
                    {tier.price}
                  </span>
                  <span className={`text-sm ${tier.highlight ? 'text-stone-400' : 'text-stone-500'}`}>
                    {' '}{tier.period}
                  </span>
                </div>
                <p className={`text-sm leading-relaxed mb-6 ${tier.highlight ? 'text-stone-300' : 'text-stone-600'}`}>
                  {tier.description}
                </p>
                <ul className={`text-sm space-y-2 mb-8 flex-1 ${tier.highlight ? 'text-stone-300' : 'text-stone-600'}`}>
                  {tier.benefits.map((benefit) => (
                    <li key={benefit} className="flex gap-2">
                      <span className={`mt-1 shrink-0 ${tier.highlight ? 'text-accent-gold' : 'text-stone-400'}`}>
                        &#10003;
                      </span>
                      {benefit}
                    </li>
                  ))}
                </ul>
                <a
                  href={`mailto:${CONTACT_EMAIL}?subject=Source%20Library%20Membership%20%E2%80%94%20${encodeURIComponent(tier.name)}&body=I%20would%20like%20to%20become%20a%20${encodeURIComponent(tier.name)}%20member%20of%20Source%20Library.`}
                  className={`block w-full text-center py-3 px-6 rounded-full transition-colors text-base font-medium ${
                    tier.highlight
                      ? 'bg-white text-stone-900 hover:bg-stone-100'
                      : 'bg-stone-900 text-white hover:bg-stone-800'
                  }`}
                >
                  Become a {tier.name}
                </a>
              </div>
            ))}
          </div>

          {/* Patron tier */}
          <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-8 md:p-10 mb-10">
            <div className="md:flex md:items-start md:justify-between md:gap-8">
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-stone-900 mb-1">Patrons</h3>
                <p className="text-stone-500 text-sm mb-4">Apollo &middot; Minerva &middot; Mercury</p>
                <p className="text-2xl font-bold text-stone-900 mb-4">
                  $5,000 &middot; $10,000 &middot; $25,000
                  <span className="text-sm font-normal text-stone-500"> / year</span>
                </p>
                <p className="text-stone-600 text-sm leading-relaxed max-w-2xl">
                  Patrons receive all Pioneer benefits plus personalized involvement in Source Library&apos;s direction — including the annual Patrons&apos; Dinner at the Embassy of the Free Mind, venue access, and a direct role in shaping which collections, languages, and traditions are prioritized. Each patron relationship is unique.
                </p>
              </div>
              <div className="mt-6 md:mt-0 md:shrink-0">
                <a
                  href={`mailto:${CONTACT_EMAIL}?subject=Source%20Library%20%E2%80%94%20Patron%20Inquiry&body=I%20am%20interested%20in%20becoming%20a%20patron%20of%20Source%20Library.`}
                  className="inline-block bg-stone-900 text-white py-3 px-8 rounded-full hover:bg-stone-800 transition-colors text-base font-medium"
                >
                  Get in Touch
                </a>
              </div>
            </div>
          </div>

          <p className="text-center text-stone-500 text-sm">
            All donations are tax-deductible for US taxpayers through the Netherland-America Foundation (501(c)(3)).
          </p>
        </div>
      </section>

      {/* Give Once */}
      <section className="bg-white py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-2xl mx-auto text-center">
          <h2
            className="text-3xl md:text-4xl text-gray-900 mb-4 leading-tight font-display"
          >
            Give Once
          </h2>
          <p className="text-lg text-gray-600 mb-8">
            Not ready for a membership? A one-time gift of any size moves the work forward. Please write &ldquo;Source Library&rdquo; in the comments field.
          </p>
          <a
            href={DONORPERFECT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block bg-stone-900 text-white py-4 px-10 rounded-full hover:bg-stone-800 transition-colors text-lg font-medium"
          >
            Donate Now
          </a>
          <p className="text-stone-500 text-xs mt-4 leading-relaxed">
            Secure donation through the Netherland-America Foundation &middot; 501(c)(3) &middot; EIN: 13-2989216<br />
            Tax-deductible to the full extent permitted by law
          </p>
          <p className="text-stone-500 text-sm mt-6">
            For wire transfers, stock gifts, or donations over $10,000,{' '}
            <a href={`mailto:${CONTACT_EMAIL}?subject=Source%20Library%20%E2%80%94%20Large%20Gift%20Inquiry`} className="text-accent-rust hover:text-accent-gold-dark underline">
              contact us directly
            </a>.
          </p>
        </div>
      </section>

      {/* Where Your Support Goes */}
      <section className="bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6] py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <h2
            className="text-3xl md:text-4xl text-stone-900 mb-12 leading-tight font-display"
          >
            Where Your Support Goes
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {[
              {
                title: 'Scholarly Review & Certification',
                text: 'The majority of funds go directly to classical language experts — specialists in Latin, Greek, Sanskrit, Arabic, and Hebrew — who review every AI-generated translation for accuracy. This is what makes Source Library a citable, trustworthy resource rather than raw AI output.',
              },
              {
                title: 'Digitization of Unscanned Texts',
                text: 'Many rare books in the Bibliotheca Philosophica Hermetica have never been digitized. We work page by page to create high-resolution scans that preserve these fragile works for anyone with an internet connection.',
              },
              {
                title: 'Open Access for Everyone',
                text: 'Everything we produce — scans, OCR text, translations — is released under CC0 public domain. No paywalls, no restrictions. Wisdom belongs to everyone, and your support keeps it that way.',
              },
              {
                title: 'Enriching AI with Ancient Knowledge',
                text: 'By making this material available now, we ensure the next generation of AI systems understands not just modern knowledge but the full depth of human thought — from Hermetic philosophy to Neoplatonist metaphysics to Renaissance natural philosophy.',
              },
            ].map((item) => (
              <div key={item.title} className="bg-white rounded-xl border border-stone-200 p-6 md:p-8">
                <h3 className="text-lg font-semibold text-stone-900 mb-3">{item.title}</h3>
                <p className="text-stone-600 text-sm leading-relaxed">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How It All Connects */}
      <section className="bg-white py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <h2
            className="text-3xl md:text-4xl text-gray-900 mb-8 leading-tight font-display"
          >
            How It All Connects
          </h2>
          <div className="text-gray-600 text-lg leading-relaxed space-y-6">
            <p>
              Source Library is a project of the Ancient Wisdom Trust, based at the{' '}
              <a href="https://embassyofthefreemind.com" target="_blank" rel="noopener noreferrer" className="text-accent-rust hover:text-accent-gold-dark underline">
                Embassy of the Free Mind
              </a>{' '}
              in Amsterdam — home to the Bibliotheca Philosophica Hermetica (BPH). The Embassy, supported by the Worldheart Foundation, preserves and shares the physical collection. Source Library extends that mission digitally, making these texts freely accessible worldwide.
            </p>
            <p>
              US tax-deductible donations are processed through the{' '}
              <strong>Netherland-America Foundation</strong> (NAF), a 501(c)(3) public charity (EIN: 13-2989216) that strengthens bonds between the Netherlands and the United States. European donors can give directly through the Worldheart Foundation (ANBI-registered).
            </p>
          </div>
        </div>
      </section>

      {/* Scan the Renaissance */}
      <section className="bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6] py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-5xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl text-stone-900 mb-4 leading-tight font-display">
            Scan the Renaissance
          </h2>
          <p className="text-lg text-stone-600 mb-6 leading-relaxed">
            1.15 million Renaissance editions remain unscanned. A single gift can open an entire subject area.
          </p>
          <Link
            href="/scan-the-renaissance"
            className="inline-block bg-stone-900 text-white py-3 px-8 rounded-full hover:bg-stone-800 transition-colors text-base font-medium"
          >
            Read the Vision
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6] py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          {/* Partner Logos */}
          <div className="flex items-center gap-8 mb-12">
            <img
              src="https://images.sourcelibrary.org/assets/embassy-of-the-free-mind-logo.png"
              alt="Embassy of the Free Mind"
              className="h-16 md:h-20 w-auto object-contain"
            />
            <img
              src="https://images.sourcelibrary.org/assets/partners-unesco.avif"
              alt="UNESCO Memory of the World"
              className="h-20 md:h-24 w-auto object-contain"
            />
          </div>

          {/* Other Ways to Help */}
          <div className="mb-12 pb-12 border-b border-stone-300">
            <p className="text-gray-600 text-lg">
              Not everyone gives money — some give time and expertise.{' '}
              <Link href="/contribute" className="text-accent-rust hover:text-accent-gold-dark underline font-medium">
                Participate
              </Link>{' '}
              as a translator, reviewer, or community volunteer.
            </p>
          </div>

          {/* Footer Links */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center">
            <div className="mb-4 md:mb-0 text-gray-600">
              &copy; {new Date().getFullYear()} Source Library — A project of the Ancient Wisdom Trust
            </div>
            <div className="flex flex-wrap items-center gap-4 md:gap-6 text-gray-600">
              <Link
                href="/"
                className="hover:text-gray-900 transition-colors"
              >
                Home
              </Link>
              <span className="hidden md:inline">•</span>
              <span>CC0 Public Domain</span>
              <span className="hidden md:inline">•</span>
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="text-accent-rust hover:text-accent-gold-dark transition-colors"
              >
                {CONTACT_EMAIL}
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
