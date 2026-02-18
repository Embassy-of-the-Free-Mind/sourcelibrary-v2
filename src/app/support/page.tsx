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
      {/* Hero Section - matches front page */}
      <section className="relative h-screen w-full overflow-hidden bg-black">
        {/* Poster image - loads immediately as background */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/hero-poster.jpg"
          alt=""
          className="absolute inset-0 w-full h-full object-cover z-0"
          fetchPriority="high"
        />

        {/* Video background */}
        <video
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          className="absolute inset-0 w-full h-full object-cover z-0"
        >
          <source src="https://cdn.prod.website-files.com/68d800cb1402171531a597f4/68d800cb1402171531a598cf_embassy-of-the-free-mind-montage-002-transcode.webm" type="video/webm" />
          <source src="https://cdn.prod.website-files.com/68d800cb1402171531a597f4/68d800cb1402171531a598cf_embassy-of-the-free-mind-montage-002-transcode.mp4" type="video/mp4" />
        </video>

        {/* Dark overlay */}
        <div className="absolute inset-0 bg-black/40 z-0" />

        {/* Header */}
        <header className="relative z-50 flex items-center justify-between px-6 md:px-12 py-4">
          <Link href="/" className="text-white flex items-center gap-3">
            <svg className="w-10 h-10 md:w-12 md:h-12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="1" />
              <circle cx="12" cy="12" r="7" stroke="white" strokeWidth="1" />
              <circle cx="12" cy="12" r="4" stroke="white" strokeWidth="1" />
            </svg>
            <span className="text-xl md:text-2xl uppercase tracking-wider text-white">
              <span className="font-semibold text-white">Source</span>
              <span className="font-light text-white">Library</span>
            </span>
          </Link>
          <Link
            href="/#library"
            className="flex items-center gap-2 px-4 py-2 bg-white/10 backdrop-blur-sm text-white rounded-full text-sm font-medium hover:bg-white/20 transition-colors border border-white/20"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            Browse Library
          </Link>
        </header>

        {/* Hero Content */}
        <div className="relative z-10 h-full flex items-center">
          <div className="px-6 md:px-12 max-w-3xl">
            <h1
              className="text-4xl md:text-5xl lg:text-6xl text-white mb-6 leading-tight tracking-wide"
              style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
            >
              Help Preserve Ancient Wisdom
            </h1>
            <p className="text-lg md:text-xl font-light text-white/90 leading-relaxed max-w-2xl">
              Your donation funds the digitization and translation of rare texts from the Bibliotheca Philosophica Hermetica.
            </p>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20">
          <svg className="w-6 h-6 text-white animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </div>
      </section>

      {/* Why Now */}
      <section className="bg-white py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-4xl mx-auto">
          <h2
            className="text-3xl md:text-4xl lg:text-5xl text-gray-900 mb-8 leading-tight"
            style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
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
            className="text-3xl md:text-4xl text-stone-900 mb-4 leading-tight"
            style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
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
                      <span className={`mt-1 shrink-0 ${tier.highlight ? 'text-amber-400' : 'text-stone-400'}`}>
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
        <div className="px-6 md:px-12 max-w-3xl mx-auto text-center">
          <h2
            className="text-3xl md:text-4xl text-gray-900 mb-4 leading-tight"
            style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
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
            <a href={`mailto:${CONTACT_EMAIL}?subject=Source%20Library%20%E2%80%94%20Large%20Gift%20Inquiry`} className="text-amber-700 hover:text-amber-800 underline">
              contact us directly
            </a>.
          </p>
        </div>
      </section>

      {/* Where Your Support Goes */}
      <section className="bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6] py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <h2
            className="text-3xl md:text-4xl text-stone-900 mb-12 leading-tight"
            style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
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
        <div className="px-6 md:px-12 max-w-4xl mx-auto">
          <h2
            className="text-3xl md:text-4xl text-gray-900 mb-8 leading-tight"
            style={{ fontFamily: 'Playfair Display, Georgia, serif' }}
          >
            How It All Connects
          </h2>
          <div className="text-gray-600 text-lg leading-relaxed space-y-6">
            <p>
              Source Library is a project of the Ancient Wisdom Trust, based at the{' '}
              <a href="https://embassyofthefreemind.com" target="_blank" rel="noopener noreferrer" className="text-amber-700 hover:text-amber-800 underline">
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

      {/* Footer */}
      <footer className="bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6] py-16 md:py-24">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          {/* Partner Logos */}
          <div className="flex items-center gap-8 mb-12">
            <img
              src="https://cdn.prod.website-files.com/68d800cb1402171531a5981e/68e1613213023b8399f2c4c0_embassy%20of%20the%20free%20mind%20logo2.png"
              alt="Embassy of the Free Mind"
              className="h-16 md:h-20 w-auto object-contain"
            />
            <img
              src="https://cdn.prod.website-files.com/68d800cb1402171531a5981e/68d800cb1402171531a599ea_partners-unesco.avif"
              alt="UNESCO Memory of the World"
              className="h-20 md:h-24 w-auto object-contain"
            />
          </div>

          {/* Other Ways to Help */}
          <div className="mb-12 pb-12 border-b border-stone-300">
            <p className="text-gray-600 text-lg">
              Not everyone gives money — some give time and expertise.{' '}
              <Link href="/contribute" className="text-amber-700 hover:text-amber-800 underline font-medium">
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
                className="text-amber-700 hover:text-amber-800 transition-colors"
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
