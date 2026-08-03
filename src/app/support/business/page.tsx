import Link from 'next/link';
import { Metadata } from 'next';
import SiteHeader from '@/components/layout/SiteHeader';

export const revalidate = 86400;

// NOTE: src/app/support/layout.tsx sets alternates.canonical = '/support' for every child.
// Metadata merges per top-level key, so this page must declare its own `alternates` or it
// would advertise /support as its canonical and drop itself from the index.
export const metadata: Metadata = {
  title: 'Giving through your company — Source Library',
  description:
    'How Dutch BV owners and US companies can support Source Library. Cultural ANBI deduction, the 150% multiplier, periodic gifts, and when sponsorship beats a donation.',
  alternates: { canonical: '/support/business' },
};

const CONTACT_EMAIL = 'team@sourcelibrary.org';
const MAILTO = `mailto:${CONTACT_EMAIL}?subject=Giving%20through%20my%20company%20%E2%80%94%20Source%20Library`;

const NAF_SOURCELIBRARY_URL =
  'https://form-renderer-app.donorperfect.io/give/embassyofthefreemindsourcelibrary';
const EFM_STRIPE_URL = 'https://donate.stripe.com/9B67sLbO1bOg2GxfxP9fW08';

// Worked examples for a Dutch BV, using the 2026 Vpb rates (19% on the first €200,000 of
// profit, 25.8% above) and the cultural-ANBI multiplier (first €5,000 deducted at 150%,
// extra deduction capped at €2,500).
const NL_EXAMPLES = [
  { gift: '€1,000', deduction: '€1,500', costLow: '€715', costHigh: '€613' },
  { gift: '€5,000', deduction: '€7,500', costLow: '€3,575', costHigh: '€3,065' },
  { gift: '€25,000', deduction: '€27,500', costLow: '€19,775', costHigh: '€17,905' },
  { gift: '€100,000', deduction: '€102,500', costLow: '€80,525', costHigh: '€73,555' },
];

export default function BusinessGivingPage() {
  return (
    <div className="min-h-screen bg-white">
      <SiteHeader />

      {/* Hero */}
      <section className="bg-[#faf8f5] border-b border-stone-200">
        <div className="px-6 md:px-12 max-w-5xl mx-auto py-14 md:py-20">
          <div className="text-xs uppercase tracking-[0.2em] text-stone-500 mb-3">
            For business owners
          </div>
          <h1 className="text-3xl md:text-4xl lg:text-5xl text-stone-900 mb-6 leading-tight font-display">
            Giving through your company.
          </h1>
          <p className="text-lg text-stone-600 leading-relaxed max-w-3xl">
            Most business owners assume a donation has to come out of their own pocket — salary or
            a dividend first, gift second. In the Netherlands that instinct is expensive. Giving
            directly from the company is usually the cheapest route by a wide margin, and almost
            nobody is told so.
          </p>
        </div>
      </section>

      {/* The principle */}
      <section className="bg-white py-14 md:py-20">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <div className="bg-stone-900 text-white rounded-xl p-6 md:p-10">
            <div className="text-xs uppercase tracking-[0.2em] text-[#c9a86c] mb-3">
              The short version
            </div>
            <h2 className="font-display text-2xl md:text-3xl mb-4 leading-snug">
              Give from wherever the money already sits.
            </h2>
            <p className="text-stone-300 leading-relaxed max-w-3xl">
              Taking money out of a BV costs a toll — 24.5% to 31% in box 2 on a dividend, or up to
              49.5% in box 1 on salary. The personal gift deduction then refunds you at a rate
              capped at 37.56%. You pay the toll to move money you were always going to give away,
              and the deduction never catches up. A gift straight from the company skips the toll
              entirely.
            </p>
          </div>
        </div>
      </section>

      {/* Netherlands */}
      <section className="bg-[#faf8f5] py-14 md:py-20 border-y border-stone-200">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <div className="text-xs uppercase tracking-[0.2em] text-stone-500 mb-3">
            Netherlands
          </div>
          <h2 className="text-3xl md:text-4xl text-stone-900 mb-6 leading-tight font-display">
            If you have a BV.
          </h2>

          <p className="text-lg text-stone-600 leading-relaxed mb-6 max-w-3xl">
            Source Library is a project of the Embassy of the Free Mind in Amsterdam, whose
            foundation — Stichting Het Wereldhart — is a registered{' '}
            <strong className="text-stone-800">cultural ANBI</strong>. For a Dutch company that is
            the most favourable class of recipient there is.
          </p>

          <ul className="space-y-3 text-stone-700 leading-relaxed mb-10 max-w-3xl">
            <li className="flex gap-3">
              <span className="text-[#9e4a3a] mt-1.5 shrink-0">▸</span>
              <span>
                Your BV deducts gifts against profit, up to 50% of profit with a ceiling of{' '}
                <strong>€100,000 per year</strong>.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-[#9e4a3a] mt-1.5 shrink-0">▸</span>
              <span>
                Because we are a <em>cultural</em> ANBI, the first €5,000 you give counts as{' '}
                <strong>€7,500</strong> for the deduction — a multiplier worth up to €2,500 of
                extra relief.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-[#9e4a3a] mt-1.5 shrink-0">▸</span>
              <span>
                No VAT applies to a genuine gift, so nothing is lost in the transfer.
              </span>
            </li>
          </ul>

          <div className="bg-white rounded-xl border border-stone-200 overflow-hidden mb-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#faf8f5] border-b border-stone-200">
                    <th className="text-left font-semibold text-stone-700 px-5 py-3">Your gift</th>
                    <th className="text-left font-semibold text-stone-700 px-5 py-3">
                      Deducted as
                    </th>
                    <th className="text-left font-semibold text-stone-700 px-5 py-3">
                      Net cost at 19%
                    </th>
                    <th className="text-left font-semibold text-stone-700 px-5 py-3">
                      Net cost at 25.8%
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {NL_EXAMPLES.map((row) => (
                    <tr key={row.gift} className="border-b border-stone-100 last:border-0">
                      <td className="px-5 py-3 font-semibold text-stone-900">{row.gift}</td>
                      <td className="px-5 py-3 text-stone-600">{row.deduction}</td>
                      <td className="px-5 py-3 text-stone-600">{row.costLow}</td>
                      <td className="px-5 py-3 text-stone-900 font-medium">{row.costHigh}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-xs text-stone-500 leading-relaxed mb-10 max-w-3xl">
            Corporate income tax runs at 19% on the first €200,000 of profit and 25.8% above it, so
            the right-hand column applies to most established companies. Figures assume the gift
            sits inside the 50%-of-profit limit.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-stone-200 p-6">
              <div className="text-xs uppercase tracking-wider text-stone-500 mb-2">
                Above €100,000
              </div>
              <p className="text-sm text-stone-600 leading-relaxed">
                Past the ceiling the arithmetic inverts. Since 1 January 2025, a gift above the
                deductible limit is treated as a distribution to you personally, so you pay the box
                2 toll and get no corporate relief. At that point a five-year{' '}
                <strong className="text-stone-800">periodieke schenking</strong> in your own name is
                the better instrument: no threshold, no 10% cap, deductible up to €1.5 million a
                year. Talk to us and we will prepare the agreement.
              </p>
            </div>
            <div className="bg-white rounded-xl border border-stone-200 p-6">
              <div className="text-xs uppercase tracking-wider text-stone-500 mb-2">
                Or sponsor instead
              </div>
              <p className="text-sm text-stone-600 leading-relaxed">
                If you would like your company named, sponsorship is fully deductible as a business
                cost with <strong className="text-stone-800">no ceiling at all</strong> — which
                matters once you are near the gift limit. It comes with recognition on the library,
                a private tour of the Bibliotheca for your team, and early access to what we
                publish. See{' '}
                <Link href="/sponsors" className="text-[#9e4a3a] underline hover:text-[#7e3a2e]">
                  corporate partnership
                </Link>
                .
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* United States */}
      <section className="bg-white py-14 md:py-20">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <div className="text-xs uppercase tracking-[0.2em] text-stone-500 mb-3">
            United States
          </div>
          <h2 className="text-3xl md:text-4xl text-stone-900 mb-6 leading-tight font-display">
            If your company is American.
          </h2>

          <p className="text-lg text-stone-600 leading-relaxed mb-6 max-w-3xl">
            US gifts are tax-deductible through{' '}
            <strong className="text-stone-800">The Netherland-America Foundation</strong>, a New
            York 501(c)(3) that holds a designated Source Library fund. A gift made directly to the
            Dutch foundation is not deductible in the US, so the NAF route is the one that works.
          </p>

          <div className="bg-[#faf8f5] rounded-xl border border-stone-200 p-6 md:p-8 max-w-3xl">
            <div className="text-xs uppercase tracking-wider text-stone-500 mb-2">
              One change worth knowing about
            </div>
            <p className="text-sm text-stone-600 leading-relaxed">
              From the 2026 tax year, a C corporation deducts charitable gifts only above a floor of
              1% of taxable income, up to the existing 10% ceiling. Below that floor the deduction
              is nothing, and it generally does not carry forward. Individuals face a comparable
              0.5% floor. A payment with genuine consideration behind it — sponsorship, naming,
              access, contracted work — is a business expense instead, with no floor and no cap. For
              many US companies that is now the better structure, and it is worth raising with your
              CPA before deciding.
            </p>
          </div>
        </div>
      </section>

      {/* How to give */}
      <section className="bg-[#faf8f5] py-14 md:py-20 border-t border-stone-200">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <h2 className="text-3xl md:text-4xl text-stone-900 mb-8 leading-tight font-display">
            How to give.
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
            <a
              href={EFM_STRIPE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-white rounded-xl border border-stone-200 p-5 hover:border-stone-400 transition-colors block"
            >
              <span className="block text-xs font-medium text-stone-400 uppercase tracking-wider mb-1">
                Netherlands &amp; EU
              </span>
              <span className="block text-sm font-semibold text-stone-900">
                Give to Stichting Het Wereldhart
              </span>
              <span className="block text-xs text-stone-500 mt-1">Cultural ANBI</span>
            </a>
            <a
              href={NAF_SOURCELIBRARY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-white rounded-xl border border-stone-200 p-5 hover:border-stone-400 transition-colors block"
            >
              <span className="block text-xs font-medium text-stone-400 uppercase tracking-wider mb-1">
                United States
              </span>
              <span className="block text-sm font-semibold text-stone-900">
                Give via the Netherland-America Foundation
              </span>
              <span className="block text-xs text-stone-500 mt-1">501(c)(3) public charity</span>
            </a>
            <a
              href={MAILTO}
              className="bg-white rounded-xl border border-stone-200 p-5 hover:border-stone-400 transition-colors block"
            >
              <span className="block text-xs font-medium text-stone-400 uppercase tracking-wider mb-1">
                Anything larger
              </span>
              <span className="block text-sm font-semibold text-stone-900">
                Talk to us directly
              </span>
              <span className="block text-xs text-stone-500 mt-1">
                Periodic gifts, sponsorship, in kind
              </span>
            </a>
          </div>

          <p className="text-sm text-stone-500 leading-relaxed max-w-3xl">
            <strong className="text-stone-700">This is general information, not tax advice.</strong>{' '}
            Rules described here are current for the 2026 tax year and the right answer depends on
            your company&apos;s profit, VAT position, and where you are resident. Confirm with your
            accountant before you give, and write to{' '}
            <a href={MAILTO} className="text-[#9e4a3a] underline hover:text-[#7e3a2e]">
              {CONTACT_EMAIL}
            </a>{' '}
            if it would help to have us talk it through with them.
          </p>
        </div>
      </section>

      {/* Where it goes */}
      <section className="bg-white py-14 md:py-20 border-t border-stone-200">
        <div className="px-6 md:px-12 max-w-5xl mx-auto">
          <h2 className="text-2xl md:text-3xl text-stone-900 mb-4 leading-tight font-display">
            What your gift pays for.
          </h2>
          <p className="text-stone-600 leading-relaxed max-w-3xl mb-6">
            Digitisation of fragile manuscripts and rare printed books, AI-assisted translation with
            scholarly review, and a free reading platform where the original and the translation sit
            side by side. Everything we produce is published openly under CC BY-SA and free to read.
          </p>
          <Link
            href="/support"
            className="inline-flex items-center px-5 py-3 rounded-md bg-[#9e4a3a] text-white text-sm font-semibold hover:bg-[#7e3a2e] transition-colors"
          >
            See all the ways to give
          </Link>
        </div>
      </section>
    </div>
  );
}
