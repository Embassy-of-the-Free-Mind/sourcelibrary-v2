'use client';

import Link from 'next/link';
import SocietyHeroSection from './SocietyHeroSection';

const MEMBERSHIP_TIERS = [
  {
    name: 'Free',
    description: 'Browse and read gateway texts',
    features: [
      'Browse the full catalog',
      'Read foundational texts',
      'Join public discussions',
    ],
    cta: 'Start Exploring',
    href: '#library',
    highlight: false,
  },
  {
    name: 'Member',
    price: '$15/month',
    description: 'Full access to all translated texts',
    features: [
      'Full library access',
      'Community forum & reading groups',
      'Vote on translation priorities',
      'One pass to gift a friend',
    ],
    cta: 'Become a Member',
    href: '/apply',
    highlight: true,
  },
  {
    name: 'Fellow',
    price: 'By invitation',
    description: 'For scholars and contributors',
    features: [
      'Everything in Member',
      'Input on acquisitions',
      'Unlimited guest passes',
      'Free lifetime access',
    ],
    cta: 'Learn More',
    href: '/fellows',
    highlight: false,
  },
];

interface SocietyLandingPageProps {
  bookCount?: number;
  translatedCount?: number;
}

export default function SocietyLandingPage({ bookCount = 0, translatedCount = 0 }: SocietyLandingPageProps) {
  return (
    <div className="min-h-screen bg-stone-50">
      {/* Hero Section */}
      <SocietyHeroSection />

      {/* Library Preview Section */}
      <section id="library" className="py-16 md:py-24 bg-gradient-to-b from-stone-100 to-stone-50">
        <div className="px-6 md:px-12 max-w-7xl mx-auto">
          <div className="text-center mb-12">
            <h2
              className="text-3xl md:text-4xl text-stone-900 mb-4"
              style={{ fontFamily: 'Cormorant Garamond, Playfair Display, Georgia, serif', fontWeight: 400 }}
            >
              The Library
            </h2>
            <p className="text-stone-600 max-w-xl mx-auto">
              {bookCount > 0 ? (
                <>{bookCount} texts in the collection, {translatedCount} with translations</>
              ) : (
                <>Rare texts from the Western esoteric tradition, freshly translated</>
              )}
            </p>
          </div>

          {/* CTA to browse */}
          <div className="text-center">
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-6 py-3 bg-stone-900 hover:bg-stone-800 text-white rounded-lg font-medium transition-colors"
            >
              Browse the Collection
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
          </div>
        </div>
      </section>

      {/* Membership Section */}
      <section id="membership" className="py-16 md:py-24 bg-white">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2
              className="text-3xl md:text-4xl text-stone-900 mb-4"
              style={{ fontFamily: 'Cormorant Garamond, Playfair Display, Georgia, serif', fontWeight: 400 }}
            >
              Membership
            </h2>
            <p className="text-stone-600 max-w-xl mx-auto">
              Your membership funds new translations. You decide what we work on next.
            </p>
          </div>

          {/* Tiers */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {MEMBERSHIP_TIERS.map((tier) => (
              <div
                key={tier.name}
                className={`rounded-xl p-6 ${
                  tier.highlight
                    ? 'bg-stone-900 text-white ring-2 ring-amber-500'
                    : 'bg-stone-50 text-stone-900 border border-stone-200'
                }`}
              >
                <div className="mb-4">
                  <h3
                    className="text-xl mb-1"
                    style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 500 }}
                  >
                    {tier.name}
                  </h3>
                  {tier.price && (
                    <p className={`text-2xl ${tier.highlight ? 'text-amber-400' : 'text-amber-700'}`}>
                      {tier.price}
                    </p>
                  )}
                </div>

                <p className={`text-sm mb-4 ${tier.highlight ? 'text-white/70' : 'text-stone-600'}`}>
                  {tier.description}
                </p>

                <ul className="space-y-2 mb-6">
                  {tier.features.map((feature) => (
                    <li
                      key={feature}
                      className={`flex items-start gap-2 text-sm ${
                        tier.highlight ? 'text-white/80' : 'text-stone-600'
                      }`}
                    >
                      <svg
                        className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                          tier.highlight ? 'text-amber-400' : 'text-amber-600'
                        }`}
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                      {feature}
                    </li>
                  ))}
                </ul>

                <Link
                  href={tier.href}
                  className={`block w-full py-3 rounded-lg font-medium text-center transition-colors ${
                    tier.highlight
                      ? 'bg-amber-500 hover:bg-amber-400 text-stone-900'
                      : 'bg-stone-900 hover:bg-stone-800 text-white'
                  }`}
                >
                  {tier.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 bg-stone-900 text-white/60">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-sm">
              &copy; {new Date().getFullYear()} The Ficino Society
            </p>
            <div className="flex gap-6 text-sm">
              <a href="https://sourcelibrary.org" className="hover:text-white transition-colors">Source Library</a>
              <a href="mailto:derek@ancientwisdomtrust.org" className="text-amber-400 hover:text-amber-300 transition-colors">
                Contact
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
