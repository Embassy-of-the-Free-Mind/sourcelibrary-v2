import Link from 'next/link';
import { ArrowLeft, Heart, BookOpen, Globe, Sparkles, Building2, ExternalLink, Mail, Target } from 'lucide-react';

// Fundraising progress
const GOAL = 100000;
const RAISED = 55000;

export const metadata = {
  title: 'Support Source Library | Help Preserve Ancient Wisdom',
  description: 'Support the digitization and translation of rare Hermetic, alchemical, and Renaissance texts. Your donation helps make centuries-old wisdom freely accessible to all.',
};

export default function SupportPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6]">
      <div className="max-w-4xl mx-auto px-6 py-12">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-stone-500 hover:text-stone-700 mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Library
          </Link>
          <h1 className="text-3xl font-bold text-stone-900" style={{ fontFamily: 'Playfair Display, Georgia, serif' }}>
            Support Source Library
          </h1>
          <p className="text-stone-600 mt-2">
            Help us preserve and translate rare texts for future generations
          </p>
        </div>

        {/* Fundraising Thermometer */}
        <section className="bg-white rounded-xl border border-stone-200 p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-green-100 rounded-lg">
              <Target className="w-5 h-5 text-green-600" />
            </div>
            <h2 className="text-xl font-semibold text-stone-900">2025 Campaign</h2>
          </div>

          <div className="mb-4">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-stone-600">
                <span className="text-2xl font-bold text-green-600">${(RAISED / 1000).toFixed(0)}k</span>
                {' '}raised
              </span>
              <span className="text-stone-500">${(GOAL / 1000).toFixed(0)}k goal</span>
            </div>

            {/* Thermometer bar */}
            <div className="h-4 bg-stone-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-green-500 to-green-400 rounded-full transition-all duration-500"
                style={{ width: `${(RAISED / GOAL) * 100}%` }}
              />
            </div>

            <p className="text-sm text-stone-500 mt-2 text-center">
              {Math.round((RAISED / GOAL) * 100)}% of our goal — help us reach $100k!
            </p>
          </div>
        </section>

        {/* Mission Section */}
        <section className="bg-white rounded-xl border border-stone-200 p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-amber-100 rounded-lg">
              <Heart className="w-5 h-5 text-amber-600" />
            </div>
            <h2 className="text-xl font-semibold text-stone-900">Our Mission</h2>
          </div>

          <p className="text-stone-600 mb-4">
            Source Library is dedicated to making rare historical texts freely accessible to everyone.
            We digitize, transcribe, and translate works from the Western esoteric tradition—alchemy,
            Hermetica, Kabbalah, Rosicrucianism, and early modern philosophy—that have been locked away
            in archives for centuries.
          </p>

          <p className="text-stone-600">
            Using AI-assisted OCR and translation, we&apos;re able to process texts in Latin, German,
            French, and other languages, making them searchable and readable in English for the first time.
          </p>
        </section>

        {/* Impact Section */}
        <section className="bg-white rounded-xl border border-stone-200 p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Sparkles className="w-5 h-5 text-blue-600" />
            </div>
            <h2 className="text-xl font-semibold text-stone-900">What Your Support Enables</h2>
          </div>

          <div className="grid sm:grid-cols-2 gap-4 mb-6">
            <div className="bg-stone-50 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <BookOpen className="w-4 h-4 text-amber-600" />
                <span className="font-medium text-stone-800">Digitization</span>
              </div>
              <p className="text-sm text-stone-600">
                Import rare books from archives worldwide—Internet Archive, Gallica,
                Bavarian State Library, and more.
              </p>
            </div>

            <div className="bg-stone-50 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <Globe className="w-4 h-4 text-amber-600" />
                <span className="font-medium text-stone-800">Translation</span>
              </div>
              <p className="text-sm text-stone-600">
                AI-powered translation of Latin, German, French, and other historical texts
                into readable English.
              </p>
            </div>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <p className="text-amber-900 text-sm">
              <strong>Every dollar directly funds processing.</strong> Server costs, AI translation credits,
              and image storage are our primary expenses. There are no administrative overheads—this
              is a passion project run by volunteers.
            </p>
          </div>
        </section>

        {/* Embassy of the Free Mind Section */}
        <section className="bg-white rounded-xl border border-stone-200 p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-stone-100 rounded-lg">
              <Building2 className="w-5 h-5 text-stone-600" />
            </div>
            <h2 className="text-xl font-semibold text-stone-900">Embassy of the Free Mind</h2>
          </div>

          <p className="text-stone-600 mb-4">
            Source Library is developed in partnership with the{' '}
            <a
              href="https://embassyofthefreemind.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-600 hover:underline"
            >
              Embassy of the Free Mind
            </a>
            {' '}in Amsterdam, home to the world-renowned Bibliotheca Philosophica Hermetica—one of
            the largest collections of Hermetic, alchemical, and mystical texts in existence.
          </p>

          <p className="text-stone-600">
            Your donation supports the Embassy&apos;s mission to preserve and share these
            invaluable texts with scholars and seekers worldwide.
          </p>
        </section>

        {/* Donation Section */}
        <section className="bg-white rounded-xl border border-stone-200 p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-green-100 rounded-lg">
              <Heart className="w-5 h-5 text-green-600" />
            </div>
            <h2 className="text-xl font-semibold text-stone-900">Make a Donation</h2>
          </div>

          <p className="text-stone-600 mb-6">
            Donations are processed through the{' '}
            <a
              href="https://thenaf.org"
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-600 hover:underline"
            >
              Netherland-America Foundation
            </a>
            , a 501(c)(3) nonprofit organization. Your gift is tax-deductible in the United States.
          </p>

          {/* Donation Options */}
          <div className="grid sm:grid-cols-2 gap-4 mb-6">
            <div className="border border-stone-200 rounded-lg p-4 hover:border-amber-300 transition-colors">
              <h3 className="font-medium text-stone-800 mb-1">One-Time Gift</h3>
              <p className="text-sm text-stone-500 mb-3">Support a specific digitization project</p>
              <div className="flex flex-wrap gap-2 text-sm">
                <span className="px-3 py-1 bg-stone-100 rounded-full text-stone-600">$25</span>
                <span className="px-3 py-1 bg-stone-100 rounded-full text-stone-600">$50</span>
                <span className="px-3 py-1 bg-stone-100 rounded-full text-stone-600">$100</span>
                <span className="px-3 py-1 bg-stone-100 rounded-full text-stone-600">$250</span>
              </div>
            </div>

            <div className="border border-amber-200 bg-amber-50 rounded-lg p-4">
              <h3 className="font-medium text-amber-800 mb-1">Monthly Patron</h3>
              <p className="text-sm text-amber-700 mb-3">Ongoing support for translation work</p>
              <div className="flex flex-wrap gap-2 text-sm">
                <span className="px-3 py-1 bg-amber-100 rounded-full text-amber-700">$10/mo</span>
                <span className="px-3 py-1 bg-amber-100 rounded-full text-amber-700">$25/mo</span>
                <span className="px-3 py-1 bg-amber-100 rounded-full text-amber-700">$50/mo</span>
              </div>
            </div>
          </div>

          {/* Donate Button */}
          <a
            href="https://form-renderer-app.donorperfect.io/give/naf/embassyofthefreemind"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full bg-amber-600 hover:bg-amber-700 text-white font-medium py-3 px-6 rounded-lg transition-colors"
          >
            <Heart className="w-5 h-5" />
            Donate Now
            <ExternalLink className="w-4 h-4 ml-1" />
          </a>

          <p className="text-xs text-stone-500 text-center mt-3">
            Secure payment via DonorPerfect. Credit card and PayPal accepted.
          </p>

          {/* Divider */}
          <div className="flex items-center gap-4 my-6">
            <div className="flex-1 h-px bg-stone-200" />
            <span className="text-sm text-stone-400">or</span>
            <div className="flex-1 h-px bg-stone-200" />
          </div>

          {/* Pledge Option */}
          <div className="bg-stone-50 border border-stone-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Mail className="w-4 h-4 text-stone-600" />
              <h3 className="font-medium text-stone-800">Make a Pledge</h3>
            </div>
            <p className="text-sm text-stone-600 mb-3">
              Prefer to donate by check, wire transfer, or another method? Just send us an email
              with your intended amount and we&apos;ll follow up with details.
            </p>
            <a
              href="mailto:derek@ancientwisdomtrust.org?subject=Source%20Library%20Pledge&body=I%20would%20like%20to%20pledge%20%24_____%20to%20support%20Source%20Library.%0A%0AIntention%20(optional)%3A%20"
              className="inline-flex items-center gap-2 text-amber-600 hover:text-amber-700 font-medium text-sm"
            >
              <Mail className="w-4 h-4" />
              Email your pledge to derek@ancientwisdomtrust.org
            </a>
          </div>
        </section>

        {/* Other Ways to Help */}
        <section className="bg-white rounded-xl border border-stone-200 p-6">
          <h2 className="text-xl font-semibold text-stone-900 mb-4">Other Ways to Help</h2>

          <div className="space-y-4 text-stone-600">
            <div className="flex gap-3">
              <span className="text-amber-600 font-medium">Share</span>
              <span>Tell researchers, students, and fellow seekers about Source Library.</span>
            </div>
            <div className="flex gap-3">
              <span className="text-amber-600 font-medium">Contribute</span>
              <span>
                Know of a rare text that should be digitized?{' '}
                <a href="mailto:derek@ancientwisdomtrust.org" className="text-amber-600 hover:underline">
                  Let us know
                </a>.
              </span>
            </div>
            <div className="flex gap-3">
              <span className="text-amber-600 font-medium">Improve</span>
              <span>
                Found a translation error? Help us improve by reporting issues on any page.
              </span>
            </div>
          </div>
        </section>

        {/* Footer */}
        <div className="mt-8 text-center text-sm text-stone-500">
          <p>
            Questions?{' '}
            <a href="mailto:derek@ancientwisdomtrust.org" className="text-amber-600 hover:underline">
              derek@ancientwisdomtrust.org
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
