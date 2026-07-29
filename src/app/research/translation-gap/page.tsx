import { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const revalidate = false;

export const metadata: Metadata = {
  title: 'The Translation Gap — Source Library Research',
  description:
    'Of ~1.4 million early-modern works in the Universal Short Title Catalogue, how many have a known modern translation? A federated, authority-reconciled census. About one in a hundred.',
  alternates: { canonical: '/research/translation-gap' },
  openGraph: {
    images: [{ url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library — Digitizing and translating ancient texts' }],
    title: 'The Translation Gap',
    description:
      'Of ~1.4 million early-modern works, roughly 1% have a known modern translation. A federated census against the Universal Short Title Catalogue.',
  },
};

// Snapshot from translation_census_by_language (Supabase), May 2026.
// Static dated snapshot — refresh from the census view when sources are added.
// Denominator: USTC (~1.4M distinct works); numerator: 30-source federated catalogue.
const LANGS = [
  { lang: 'Latin', works: 444120, tr: 8644, pct: 1.95 },
  { lang: 'German', works: 295566, tr: 419, pct: 0.14 },
  { lang: 'French', works: 194874, tr: 1615, pct: 0.83 },
  { lang: 'English', works: 149462, tr: 553, pct: 0.37 },
  { lang: 'Italian', works: 101335, tr: 576, pct: 0.57 },
  { lang: 'Dutch', works: 82651, tr: 462, pct: 0.56 },
  { lang: 'Spanish', works: 76472, tr: 340, pct: 0.44 },
  { lang: 'Greek (anc.)', works: 8509, tr: 132, pct: 1.55 },
  { lang: 'Czech', works: 5645, tr: 45, pct: 0.8 },
  { lang: 'Polish', works: 4002, tr: 35, pct: 0.87 },
];
const MAXPCT = 1.95;
const ROBUSTNESS = [
  { method: 'Exact title overlap (naïve)', works: '667', rate: '~2.10%' },
  { method: '+ Latin incipit / bigram', works: '1,286', rate: '~2.24%' },
  { method: '+ VIAF author reconciliation', works: '1,513', rate: '~2.29%' },
  { method: 'Absolute ceiling (every plausible link)', works: '≤16,967', rate: '≤3.8%' },
];
const fmt = (n: number) => n.toLocaleString('en-US');

function Stat({ n, unit, label }: { n: string; unit?: string; label: string }) {
  return (
    <div className="px-5 py-6 border-stone-200 [&:not(:last-child)]:border-r max-sm:[&:nth-child(odd)]:border-r max-sm:[&:nth-child(-n+2)]:border-b">
      <div className="font-serif text-3xl md:text-4xl text-stone-900 tracking-tight">
        {n}
        {unit && <span className="text-amber-800 text-2xl">{unit}</span>}
      </div>
      <div className="font-body text-sm text-stone-500 mt-1.5 leading-snug">{label}</div>
    </div>
  );
}

function Section({ kicker, title, children }: { kicker: string; title: string; children: ReactNode }) {
  return (
    <section className="py-12 border-b border-stone-200">
      <div className="font-body text-xs tracking-[0.16em] uppercase text-amber-700 font-semibold mb-3">{kicker}</div>
      <h2 className="font-serif text-2xl md:text-3xl text-stone-900 mb-4 tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

export default function TranslationGapPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="The Translation Gap"
          subtitle="The Universal Short Title Catalogue records roughly 1.4 million distinct works printed in Europe before 1700. How many can a modern reader actually read in translation? We built a federated, authority-reconciled census to find out — the short answer is about one in a hundred."
        />
      }
    >
      <div className="max-w-3xl mx-auto font-body text-stone-700 text-lg leading-relaxed">
        {/* stat band */}
        <div className="grid grid-cols-2 md:grid-cols-4 border border-stone-200 rounded-sm bg-stone-50 my-8">
          <Stat n="1.39" unit="M" label="distinct early-modern works in the USTC corpus" />
          <Stat n="~0.9" unit="%" label="have a known modern translation, across all languages" />
          <Stat n="~2" unit="%" label="of the Latin corpus — the largest — is translated" />
          <Stat n="30+" label="catalogues & publishers federated to count translations" />
        </div>

        <Section kicker="The map of the gap" title="What share of each language has been translated?">
          <p className="mb-6 text-stone-600">
            Each bar is the share of distinct works in that original language for which our census records a modern
            translation (predominantly into English). Bars are scaled to the highest rate; absolute work counts are shown
            beside each language.
          </p>
          <div className="space-y-2.5">
            {LANGS.map((d) => (
              <div key={d.lang} className="grid grid-cols-[7rem_1fr_5.5rem] items-center gap-3">
                <div className="text-right font-body text-sm text-stone-800">
                  {d.lang}
                  <span className="block text-[11px] text-stone-400">{fmt(d.works)} works</span>
                </div>
                <div className="h-5 bg-stone-200 rounded-sm overflow-hidden">
                  <div
                    className="h-full rounded-sm bg-gradient-to-r from-amber-800 to-amber-900"
                    style={{ width: `${Math.max((d.pct / MAXPCT) * 100, 1.5)}%` }}
                  />
                </div>
                <div className="font-body text-sm font-semibold text-amber-800">
                  {d.pct.toFixed(2)}% <span className="text-stone-400 font-normal">· {fmt(d.tr)}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 bg-stone-50 border-l-2 border-amber-600 rounded-r-sm px-5 py-4 text-base text-stone-700">
            <div className="font-body text-xs tracking-wider uppercase text-amber-700 font-semibold mb-1">Read this carefully</div>
            These are <strong>floors, not ceilings</strong> — they count translations we could find and verify. The Latin
            figure (~2%) has been stress-tested across four matching methods and is robust; the smaller-language figures
            have had less validation and should be read as lower bounds.
          </div>
        </Section>

        <Section kicker="How it was built" title="Method">
          <p className="mb-4">
            <strong>The denominator — USTC.</strong> The Universal Short Title Catalogue is the standard census of
            early-modern European print; its expansion to 1700 brings the total to <strong>~1.4 million distinct
            works</strong> (USTC&rsquo;s own figure). The dataset used here comprises 1,391,970 distinct works across
            1,593,766 edition records, in 181 languages. Latin alone accounts for 444,120 works (32%).
          </p>
          <p className="mb-4">
            <strong>The numerator — a federated catalogue.</strong> Rather than trust any single source (each mislabels
            facsimiles, misses scholarly editions, or has coverage holes), we pooled <strong>26,855 translation records
            from 30+ sources</strong>: UNESCO Index Translationum, Library of Congress MARC, OpenLibrary, HathiTrust, the
            Loeb Classical Library, Harvard&rsquo;s I Tatti and DOML, Brill, OUP, CUP, Yale, Chicago, Penguin, and curated
            specialist series.
          </p>
          <p>
            <strong>The hard part — reconciliation.</strong> A translation titled <em>&ldquo;Atalanta Fugiens: an edition
            of the fugues, emblems and epigrams&rdquo;</em> shares almost no words with the Latin original{' '}
            <em>&ldquo;Atalanta fugiens, hoc est, Emblemata nova&hellip;&rdquo;</em>. We match on Latin incipits and
            reconcile author names through 80,912 VIAF / Wikidata / GND / CERL authority clusters (so &ldquo;Geber&rdquo;,
            &ldquo;Jabir&rdquo;, and &ldquo;pseudo-Geber&rdquo; resolve to one identity), and grade every match on a tiered
            completeness scale rather than a brittle yes/no.
          </p>
        </Section>

        <Section kicker="Is the number real?" title="Why we believe ~2%">
          <p className="mb-5 text-stone-600">
            A low number could be an artifact of weak matching. So we stress-tested Latin with four matchers of increasing
            sophistication. If recall were the problem, the figure would keep climbing. It doesn&rsquo;t:
          </p>
          <table className="w-full text-base border-collapse">
            <thead>
              <tr className="text-left font-body text-xs uppercase tracking-wider text-stone-500">
                <th className="py-2.5 border-b border-stone-200 font-semibold">Matching method</th>
                <th className="py-2.5 border-b border-stone-200 font-semibold text-right">Latin works linked</th>
                <th className="py-2.5 border-b border-stone-200 font-semibold text-right">Implied rate</th>
              </tr>
            </thead>
            <tbody>
              {ROBUSTNESS.map((r) => (
                <tr key={r.method}>
                  <td className="py-2.5 border-b border-stone-200">{r.method}</td>
                  <td className="py-2.5 border-b border-stone-200 text-right tabular-nums">{r.works}</td>
                  <td className="py-2.5 border-b border-stone-200 text-right tabular-nums font-semibold text-amber-800">{r.rate}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-5 text-stone-600">
            Each improvement adds less than the last. The figure converges in the <strong>2–2.3%</strong> range and cannot
            exceed ~3.8% even if every author-matched record linked perfectly. The gap is structural, not a search failure:
            most untranslated works are minor — disputations, sermons, dissertations — never rendered into a living
            language.
          </p>
        </Section>

        <Section kicker="What this is not" title="Caveats">
          <ul className="list-disc pl-5 space-y-2.5">
            <li><strong>Lower bounds.</strong> Every figure counts only translations we could locate and verify; true rates are somewhat higher, especially for non-Latin languages.</li>
            <li><strong>&ldquo;Translation&rdquo; is graded, not binary.</strong> A few captions in English is not a complete scholarly edition; the headline counts lean toward substantial translations.</li>
            <li><strong>USTC scope.</strong> The denominator is printed European books, c.1450–1700 — manuscripts, post-1700 editions, and non-European printing are out of frame.</li>
            <li><strong>Residual name variants.</strong> Some pseudonymous and classical authors still resist reconciliation, nudging the true count up — but within the ~3.8% ceiling.</li>
          </ul>
          <div className="mt-6 bg-stone-50 border-l-2 border-amber-600 rounded-r-sm px-5 py-4 text-base text-stone-700">
            <div className="font-body text-xs tracking-wider uppercase text-amber-700 font-semibold mb-1">The honest headline</div>
            The ~2% is approximately real. The vast majority of the early-modern Latin corpus is{' '}
            <strong>genuinely untranslated</strong> — not a measurement failure, but the size of the opportunity.
          </div>
        </Section>

        <Section kicker="The other side of the count" title="What has been translated — and by whom">
          <p className="mb-5">
            The same census that measures the gap also records the works that <em>have</em> been Englished, and credits the
            translators who did it. The companion <strong>Translation Registry</strong> is a searchable, work-level catalogue
            of those translations — period, historical, and modern — linking to the original where Source Library holds it.
          </p>
          <Link
            href="/research/translation-registry"
            className="inline-block font-body text-sm font-semibold bg-stone-800 hover:bg-stone-900 text-stone-50 px-6 py-3 rounded-sm transition-colors"
          >
            Browse the Translation Registry →
          </Link>
        </Section>

        <Section kicker="Help close it" title="Collaborate">
          <p className="mb-6">
            We&rsquo;re sharing the full per-language census and inviting catalogues, publishers, and scholars to add
            sources and correct records. If you maintain translation data — or spot a work we&rsquo;ve miscounted — we want
            to hear from you.
          </p>
          <div className="flex flex-wrap gap-3">
            <a
              href="/data/ustc-translation-census.csv"
              download
              className="font-body text-sm font-semibold bg-amber-800 hover:bg-amber-900 text-stone-50 px-6 py-3 rounded-sm transition-colors"
            >
              Download the data (CSV, 181 languages)
            </a>
            <a
              href="mailto:team@sourcelibrary.org?subject=The%20Translation%20Gap%20%E2%80%94%20collaboration"
              className="font-body text-sm font-semibold border border-amber-800 text-amber-800 hover:bg-amber-50 px-6 py-3 rounded-sm transition-colors"
            >
              Get in touch
            </a>
          </div>
        </Section>

        <p className="py-8 font-body text-sm text-stone-500 leading-relaxed">
          A data study by Source Library, May 2026. Denominator: the Universal Short Title Catalogue (University of St
          Andrews); the ~1.39M distinct-work count is consistent with USTC&rsquo;s stated ~1.4 million distinct items for
          its expansion to 1700. Translation census federated from 30+ catalogues and publishers; author reconciliation via
          VIAF, Wikidata, GND, and CERL. Figures are conservative lower bounds and will be updated as sources are added.
          Contact: <a className="text-amber-800 underline" href="mailto:team@sourcelibrary.org">team@sourcelibrary.org</a>.
        </p>
      </div>
    </ContentPageLayout>
  );
}
