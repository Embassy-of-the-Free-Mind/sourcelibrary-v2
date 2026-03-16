import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'Strategic Plan — Source Library',
  description:
    'Source Library\'s 3-year plan to build the world\'s leading translated primary source library. A program of the Embassy of the Free Mind.',
  alternates: { canonical: '/plan' },
};

export default function PlanPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Source Library"
          subtitle="A Program of the Embassy of the Free Mind"
        />
      }
      bg="bg-cream"
    >
      <div className="prose-content max-w-none">

        {/* Lead */}
        <p className="text-xl text-secondary leading-relaxed mb-4">
          Source Library is building the world&apos;s largest freely accessible library of translated primary sources.
          Based at the Embassy of the Free Mind in Amsterdam, we use AI to make texts that have been locked behind
          dead languages and institutional walls available to everyone — scholars, students, and the curious public.
        </p>
        <p className="text-xl text-secondary leading-relaxed mb-12">
          This is the plan to make it real.
        </p>

        {/* ── The Problem ── */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-4">The Problem</h2>

        <div className="border-l-4 border-accent-gold/30 pl-6 mb-8">
          <p className="text-secondary italic">
            Millions of historical texts sit in digital archives, photographed but unread. They&apos;re in Latin, Greek,
            Arabic, Hebrew, German Fraktur, Classical Chinese. The photographs exist. The translations don&apos;t.
          </p>
        </div>

        <p className="text-secondary mb-4">
          The Bibliotheca Philosophica Hermetica alone holds ~25,000 volumes — Hermetic, alchemical, Kabbalistic,
          Rosicrucian works that exist in 1-3 copies worldwide. Most are unscanned. None are translated. The scholars
          who can read them are retiring.
        </p>
        <p className="text-secondary mb-8">
          This is a narrow window: AI translation works <em>now</em>, the source material exists, but the
          scholars who can validate the output won&apos;t be here forever.
        </p>

        {/* ── What We've Built ── */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-4">What We&apos;ve Built</h2>
        <p className="text-muted text-sm mb-6">December 2025 – February 2026 (77 days)</p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { value: '4,430+', label: 'Books', color: 'text-accent-rust' },
            { value: '1.67M', label: 'Page images', color: 'text-accent-sage' },
            { value: '467K', label: 'Pages OCR\'d', color: 'text-accent-violet' },
            { value: '285K', label: 'Pages translated', color: 'text-accent-gold' },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl p-4 border border-border-light text-center">
              <div className={`text-2xl md:text-3xl font-serif ${s.color}`}>{s.value}</div>
              <div className="text-muted text-sm">{s.label}</div>
            </div>
          ))}
        </div>

        <div className="grid md:grid-cols-2 gap-4 mb-12">
          {[
            { value: '1,077', label: 'Fully processed books (OCR + translation + index + images)' },
            { value: '71K', label: 'Illustrations extracted with AI metadata' },
            { value: '30+', label: 'Languages (Latin, German, French, Arabic, Hebrew, Chinese...)' },
            { value: '13', label: 'Digital library sources (IA, Gallica, BnF, Vatican, Bodleian...)' },
            { value: '~$3,400', label: 'Total AI processing cost to date' },
            { value: '$0.77', label: 'Average cost per book (full pipeline)' },
          ].map(s => (
            <div key={s.label} className="flex items-baseline gap-3 bg-white rounded-lg p-3 border border-border-light">
              <span className="text-accent-rust font-serif text-lg whitespace-nowrap">{s.value}</span>
              <span className="text-secondary text-sm">{s.label}</span>
            </div>
          ))}
        </div>

        {/* ── The Activities ── */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-2">What Source Library Needs to Do</h2>
        <p className="text-secondary mb-8">
          The question isn&apos;t &ldquo;what&apos;s the right number.&rdquo; It&apos;s: what does Source Library
          need to do, and what does each thing cost?
        </p>

        {/* Activity 1: Run the Program */}
        <div className="bg-white rounded-xl p-6 border border-border-light mb-6">
          <h3 className="text-xl text-primary mb-1">1. Run the Program</h3>
          <p className="text-muted text-sm mb-4">$260K/year</p>
          <p className="text-secondary mb-4">
            Someone has to run the pipeline, make technology decisions, manage the collection, write grants, talk
            to partners, and set direction. Today that&apos;s Derek, full-time. The Head of Collections is the key
            hire that makes this a program rather than a one-person project.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted border-b border-border-light">
                  <th className="pb-2 pr-4">Role</th>
                  <th className="pb-2 pr-4">Cost</th>
                  <th className="pb-2">Notes</th>
                </tr>
              </thead>
              <tbody className="text-secondary">
                <tr className="border-b border-border-light/50"><td className="py-2 pr-4">Program Director (Derek)</td><td className="py-2 pr-4 whitespace-nowrap">$130K</td><td className="py-2">Salary + benefits</td></tr>
                <tr className="border-b border-border-light/50"><td className="py-2 pr-4">Head of Collections</td><td className="py-2 pr-4 whitespace-nowrap">$90K</td><td className="py-2">Curation, metadata QA, archive relationships, scholarly liaison</td></tr>
                <tr><td className="py-2 pr-4">Operations coordinator (part-time)</td><td className="py-2 pr-4 whitespace-nowrap">$40K</td><td className="py-2">Donor relations, newsletter, event logistics</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Activity 2: Scan Books */}
        <div className="bg-white rounded-xl p-6 border border-border-light mb-6">
          <h3 className="text-xl text-primary mb-1">2. Scan Books</h3>
          <p className="text-muted text-sm mb-4">$100K–$300K/year depending on scope</p>
          <p className="text-secondary mb-4">
            This is the single highest-value thing money buys. AI can translate a scan; nothing can replace
            creating one. Every book scanned is a primary source — often existing in 1-3 copies worldwide —
            made permanently accessible.
          </p>
          <p className="text-secondary mb-4">
            <strong>The EFM collection alone justifies this.</strong> The Bibliotheca Philosophica Hermetica
            holds ~25,000 volumes, many unscanned. These are the crown jewels.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted border-b border-border-light">
                  <th className="pb-2 pr-4">Scenario</th>
                  <th className="pb-2 pr-4">Cost</th>
                  <th className="pb-2">Books/year</th>
                </tr>
              </thead>
              <tbody className="text-secondary">
                <tr className="border-b border-border-light/50"><td className="py-2 pr-4">EFM only</td><td className="py-2 pr-4 whitespace-nowrap">$100K</td><td className="py-2">600–800</td></tr>
                <tr className="border-b border-border-light/50"><td className="py-2 pr-4">EFM + 3 partner libraries</td><td className="py-2 pr-4 whitespace-nowrap">$200K</td><td className="py-2">1,000–1,300</td></tr>
                <tr><td className="py-2 pr-4">EFM + 5 partners + commissions</td><td className="py-2 pr-4 whitespace-nowrap">$300K</td><td className="py-2">1,200–1,500</td></tr>
              </tbody>
            </table>
          </div>
          <p className="text-muted text-xs mt-3">
            Over 3 years, even the modest scenario produces 2,000+ newly digitized primary sources.
          </p>
        </div>

        {/* Activity 3: Engage Scholars */}
        <div className="bg-white rounded-xl p-6 border border-border-light mb-6">
          <h3 className="text-xl text-primary mb-1">3. Engage Scholars</h3>
          <p className="text-muted text-sm mb-4">$120K–$350K/year depending on scope</p>
          <p className="text-secondary mb-4">
            The AI produces first drafts. Scholars produce knowledge. Without scholarly engagement,
            Source Library is a tech demo. With it, it&apos;s a research institution.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted border-b border-border-light">
                  <th className="pb-2 pr-4">Program</th>
                  <th className="pb-2 pr-4">Cost</th>
                  <th className="pb-2">Output</th>
                </tr>
              </thead>
              <tbody className="text-secondary">
                <tr className="border-b border-border-light/50"><td className="py-2 pr-4">Advisory Board (10-12 members)</td><td className="py-2 pr-4 whitespace-nowrap">$40K</td><td className="py-2">Direction, peer network, legitimacy</td></tr>
                <tr className="border-b border-border-light/50"><td className="py-2 pr-4">Visiting Scholars (4-6/year)</td><td className="py-2 pr-4 whitespace-nowrap">$60–90K</td><td className="py-2">Validated sub-collections, corrected translations</td></tr>
                <tr className="border-b border-border-light/50"><td className="py-2 pr-4">Research Commissions (5/year)</td><td className="py-2 pr-4 whitespace-nowrap">$40–50K</td><td className="py-2">Original scholarship using the collection</td></tr>
                <tr className="border-b border-border-light/50"><td className="py-2 pr-4">Scholarly Editions (20-30/year)</td><td className="py-2 pr-4 whitespace-nowrap">$25–30K</td><td className="py-2">DOI-minted, peer-reviewed publications</td></tr>
                <tr className="border-b border-border-light/50"><td className="py-2 pr-4">Conference Presence</td><td className="py-2 pr-4 whitespace-nowrap">$25–30K</td><td className="py-2">RSA, ADHO, ESSWE, History of Science</td></tr>
                <tr><td className="py-2 pr-4">Course Materials (10-15 courses)</td><td className="py-2 pr-4 whitespace-nowrap">$15K</td><td className="py-2">Free teaching collections at partner universities</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Activity 4: Tell the Story */}
        <div className="bg-white rounded-xl p-6 border border-border-light mb-6">
          <h3 className="text-xl text-primary mb-1">4. Tell the Story</h3>
          <p className="text-muted text-sm mb-4">$45K–$200K/year depending on scope</p>
          <p className="text-secondary mb-4">
            Source Library has a story the public cares about: hidden ancient texts, AI translation, lost
            knowledge recovered. The &ldquo;first-ever translation&rdquo; angle alone generates press.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted border-b border-border-light">
                  <th className="pb-2 pr-4">Program</th>
                  <th className="pb-2 pr-4">Cost</th>
                  <th className="pb-2">Impact</th>
                </tr>
              </thead>
              <tbody className="text-secondary">
                <tr className="border-b border-border-light/50"><td className="py-2 pr-4">Press/PR officer (part-time)</td><td className="py-2 pr-4 whitespace-nowrap">$40K</td><td className="py-2">10-15 press hits/year</td></tr>
                <tr className="border-b border-border-light/50"><td className="py-2 pr-4">Documentary series (6-8 films)</td><td className="py-2 pr-4 whitespace-nowrap">$50K</td><td className="py-2">Permanent storytelling asset</td></tr>
                <tr className="border-b border-border-light/50"><td className="py-2 pr-4">Events at EFM (4/year)</td><td className="py-2 pr-4 whitespace-nowrap">$20K</td><td className="py-2">Donor cultivation, press hooks</td></tr>
                <tr className="border-b border-border-light/50"><td className="py-2 pr-4">Patron program (&ldquo;The Ficino Circle&rdquo;)</td><td className="py-2 pr-4 whitespace-nowrap">$15K</td><td className="py-2">Recurring small donations</td></tr>
                <tr className="border-b border-border-light/50"><td className="py-2 pr-4">Exhibition (&ldquo;Hidden in Plain Sight&rdquo;)</td><td className="py-2 pr-4 whitespace-nowrap">$30K</td><td className="py-2">Touring physical exhibition</td></tr>
                <tr><td className="py-2 pr-4">Newsletter + social media</td><td className="py-2 pr-4 whitespace-nowrap">$10K</td><td className="py-2">Ongoing visibility</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Activity 5: AI + Infrastructure */}
        <div className="bg-white rounded-xl p-6 border border-border-light mb-12">
          <h3 className="text-xl text-primary mb-1">5. AI Processing & Infrastructure</h3>
          <p className="text-muted text-sm mb-4">$80–100K/year</p>
          <p className="text-secondary mb-4">
            The cheapest part. This is the whole point — the technology cost is trivial compared to everything else.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted border-b border-border-light">
                  <th className="pb-2 pr-4">Item</th>
                  <th className="pb-2 pr-4">Cost</th>
                  <th className="pb-2">Notes</th>
                </tr>
              </thead>
              <tbody className="text-secondary">
                <tr className="border-b border-border-light/50"><td className="py-2 pr-4">Gemini API</td><td className="py-2 pr-4 whitespace-nowrap">$40–60K</td><td className="py-2">Processes 40,000–60,000 books through full pipeline</td></tr>
                <tr className="border-b border-border-light/50"><td className="py-2 pr-4">AWS Lambda workers</td><td className="py-2 pr-4 whitespace-nowrap">$10K</td><td className="py-2">SQS queues, compute</td></tr>
                <tr className="border-b border-border-light/50"><td className="py-2 pr-4">MongoDB Atlas</td><td className="py-2 pr-4 whitespace-nowrap">$10K</td><td className="py-2">Database</td></tr>
                <tr className="border-b border-border-light/50"><td className="py-2 pr-4">Vercel + Blob storage</td><td className="py-2 pr-4 whitespace-nowrap">$10K</td><td className="py-2">Web app, image hosting</td></tr>
                <tr><td className="py-2 pr-4">Dev tools, monitoring</td><td className="py-2 pr-4 whitespace-nowrap">$5K</td><td className="py-2" /></tr>
              </tbody>
            </table>
          </div>
          <p className="text-muted text-xs mt-3">
            This doesn&apos;t change much with scale. Going from 30,000 to 100,000 books adds maybe $20-30K in API costs.
          </p>
        </div>

        {/* ── Three Scenarios ── */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-8">Three Scenarios</h2>

        <div className="grid md:grid-cols-3 gap-6 mb-12">
          {/* Lean */}
          <div className="bg-white rounded-xl p-6 border border-border-light">
            <h3 className="text-lg text-primary mb-1">Lean</h3>
            <div className="text-2xl font-serif text-accent-sage mb-2">$600K<span className="text-base text-muted font-sans">/year</span></div>
            <p className="text-secondary text-sm mb-4">
              3-person team. 600-800 books scanned/year from EFM. 10 scholarly editions. Basic public presence.
            </p>
            <ul className="text-xs text-muted space-y-1">
              <li>Team: $260K</li>
              <li>Scanning (EFM only): $100K</li>
              <li>Scholars: $120K</li>
              <li>Marketing: $45K</li>
              <li>AI + infra: $80K</li>
            </ul>
          </div>

          {/* Strong */}
          <div className="bg-white rounded-xl p-6 border-2 border-accent-rust/30 ring-1 ring-accent-rust/10">
            <div className="text-xs text-accent-rust font-semibold uppercase tracking-wider mb-2">Recommended</div>
            <h3 className="text-lg text-primary mb-1">Strong</h3>
            <div className="text-2xl font-serif text-accent-rust mb-2">$1.2M<span className="text-base text-muted font-sans">/year</span></div>
            <p className="text-secondary text-sm mb-4">
              1,000-1,300 books scanned/year. 6 visiting scholars. 25 scholarly editions. Documentary series.
              Exhibition. A credible institution.
            </p>
            <ul className="text-xs text-muted space-y-1">
              <li>Team: $260K</li>
              <li>Scanning (EFM + partners): $250K</li>
              <li>Scholars: $220K</li>
              <li>Marketing + exhibition: $200K</li>
              <li>AI + infra: $100K</li>
              <li>Research fund: $50K</li>
              <li>Contingency: $20K</li>
            </ul>
            <p className="text-accent-rust text-xs mt-3 font-medium">$3.6M over 3 years</p>
          </div>

          {/* Ambitious */}
          <div className="bg-white rounded-xl p-6 border border-border-light">
            <h3 className="text-lg text-primary mb-1">Ambitious</h3>
            <div className="text-2xl font-serif text-accent-violet mb-2">$1.5M<span className="text-base text-muted font-sans">/year</span></div>
            <p className="text-secondary text-sm mb-4">
              1,500+ books scanned/year. Funded PhD positions. Annual conference. Research fund. The leading
              institution for AI-assisted cultural heritage.
            </p>
            <ul className="text-xs text-muted space-y-1">
              <li>Team: $330K</li>
              <li>Scanning (EFM + 5 partners): $300K</li>
              <li>Scholars + PhDs: $350K</li>
              <li>Full marketing: $200K</li>
              <li>AI + infra: $100K</li>
              <li>Research fund: $100K</li>
              <li>Conference: $50K</li>
              <li>Contingency: $70K</li>
            </ul>
          </div>
        </div>

        {/* ── Comparison ── */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">How This Compares</h2>

        <div className="overflow-x-auto mb-12">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-b border-border-light">
                <th className="pb-2 pr-4" />
                <th className="pb-2 pr-4">Source Library ($1.2M)</th>
                <th className="pb-2 pr-4">Perseus Digital Library</th>
                <th className="pb-2 pr-4">Endangered Archives (Arcadia)</th>
              </tr>
            </thead>
            <tbody className="text-secondary">
              <tr className="border-b border-border-light/50"><td className="py-2 pr-4 text-muted">Budget</td><td className="py-2 pr-4 font-medium text-accent-rust">$1.2M/year</td><td className="py-2 pr-4">$1-2M/year (est.)</td><td className="py-2 pr-4">$2M/year</td></tr>
              <tr className="border-b border-border-light/50"><td className="py-2 pr-4 text-muted">Books processed</td><td className="py-2 pr-4">50,000+/year</td><td className="py-2 pr-4">~25,000 total (38 years)</td><td className="py-2 pr-4">16M images (no translation)</td></tr>
              <tr className="border-b border-border-light/50"><td className="py-2 pr-4 text-muted">Languages</td><td className="py-2 pr-4">30+</td><td className="py-2 pr-4">2 (Greek, Latin)</td><td className="py-2 pr-4">All</td></tr>
              <tr className="border-b border-border-light/50"><td className="py-2 pr-4 text-muted">Translation</td><td className="py-2 pr-4">Yes (all books)</td><td className="py-2 pr-4">Some</td><td className="py-2 pr-4">No</td></tr>
              <tr className="border-b border-border-light/50"><td className="py-2 pr-4 text-muted">Scholarly editions</td><td className="py-2 pr-4">25-30/year</td><td className="py-2 pr-4">-</td><td className="py-2 pr-4">-</td></tr>
              <tr className="border-b border-border-light/50"><td className="py-2 pr-4 text-muted">Scanning new material</td><td className="py-2 pr-4">1,000+/year</td><td className="py-2 pr-4">No</td><td className="py-2 pr-4">Yes (their whole mission)</td></tr>
              <tr><td className="py-2 pr-4 text-muted">Cost per book</td><td className="py-2 pr-4">~$24 all-in</td><td className="py-2 pr-4">~$50-100 (est.)</td><td className="py-2 pr-4">N/A</td></tr>
            </tbody>
          </table>
        </div>

        {/* ── Funding ── */}
        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Funding Strategy</h2>

        <div className="bg-accent-gold/5 rounded-lg p-6 border border-accent-gold/15 mb-8">
          <p className="text-stone-700 leading-relaxed mb-0">
            <strong>Target: $1.2M/year for 3 years ($3.6M total).</strong> One anchor funder at $500K-$1M
            (Arcadia or Mellon), supplemented with NEH ($150-350K), tech philanthropy (Google, individual donors),
            and the Ficino Circle patron program for recurring small donations.
          </p>
        </div>

        <div className="overflow-x-auto mb-12">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-b border-border-light">
                <th className="pb-2 pr-4">Funder</th>
                <th className="pb-2 pr-4">Likely size</th>
                <th className="pb-2">Why they&apos;d fund this</th>
              </tr>
            </thead>
            <tbody className="text-secondary">
              <tr className="border-b border-border-light/50"><td className="py-2 pr-4 font-medium">Arcadia Fund</td><td className="py-2 pr-4 whitespace-nowrap">$500K–$2M</td><td className="py-2">Archives & Manuscripts programme. $386M given to culture. Perfect fit.</td></tr>
              <tr className="border-b border-border-light/50"><td className="py-2 pr-4 font-medium">Mellon Foundation</td><td className="py-2 pr-4 whitespace-nowrap">$500K–$1.5M</td><td className="py-2">$540M awarded in 2024. Digital humanities is core.</td></tr>
              <tr className="border-b border-border-light/50"><td className="py-2 pr-4 font-medium">NEH</td><td className="py-2 pr-4 whitespace-nowrap">$150K–$350K</td><td className="py-2">DHAG, Preservation & Access, Scholarly Editions. Stackable.</td></tr>
              <tr className="border-b border-border-light/50"><td className="py-2 pr-4 font-medium">Google.org</td><td className="py-2 pr-4 whitespace-nowrap">Credits + $200-500K</td><td className="py-2">Source Library is a major Gemini Batch API user. AI + cultural heritage showcase.</td></tr>
              <tr><td className="py-2 pr-4 font-medium">Individual donors</td><td className="py-2 pr-4 whitespace-nowrap">$50–$10K each</td><td className="py-2">The Ficino Circle: &ldquo;$200 translates a book.&rdquo;</td></tr>
            </tbody>
          </table>
        </div>

        {/* ── The Ask ── */}
        <div className="bg-stone-900 text-white rounded-xl p-8 mb-12">
          <h2 className="text-2xl font-serif mb-4">The Ask</h2>
          <p className="text-stone-300 text-lg leading-relaxed mb-4">
            $1.2M/year makes Source Library the world&apos;s leading translated primary source library within 3 years.
          </p>
          <p className="text-stone-400 leading-relaxed">
            That&apos;s not hyperbole — no one else is doing this at any budget. The technology works, the collection
            exists, the institutional home is ready. What&apos;s needed is the funding to build the scholarly program,
            scan the books, and tell the story.
          </p>
        </div>

        {/* Links */}
        <div className="flex flex-wrap gap-4 pt-8 border-t border-border-light">
          <Link
            href="/"
            className="px-5 py-2.5 bg-stone-900 text-white rounded-full hover:bg-stone-800 transition-colors"
          >
            Browse the Library
          </Link>
          <Link
            href="/progress"
            className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
          >
            Development Progress
          </Link>
          <Link
            href="/data?admin=true"
            className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
          >
            Full Collection Data
          </Link>
          <Link
            href="/about"
            className="px-5 py-2.5 bg-white border border-stone-300 text-stone-700 rounded-full hover:bg-stone-50 transition-colors"
          >
            About
          </Link>
        </div>
      </div>
    </ContentPageLayout>
  );
}
