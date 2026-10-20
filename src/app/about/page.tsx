import { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import ContentPageLayout from '@/components/layout/ContentPageLayout';
import SiteHeader from '@/components/layout/SiteHeader';
import AboutHero, { type HeroStat } from '@/components/about/AboutHero';
import WrittenPastChart from '@/components/about/WrittenPastChart';
import ReadingDemo from '@/components/about/ReadingDemo';
import { getSiteStats } from '@/lib/site-stats';

// The hero stats come from system_config.homepage_stats, which a job refreshes
// daily at 05:00. Without a revalidate window this page was prerendered once per
// deploy and its numbers froze until the next merge.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'About - Source Library',
  description: 'Source Library scans rare books and manuscripts, translates them with AI beside the original page, and makes them free to read, quote and cite. An initiative of the Embassy of the Free Mind, Amsterdam.',
  alternates: {
    canonical: '/about',
  },
};

// Links as in the articles (.claude/docs/article-rules.md): body colour, thin
// gold underline that darkens on hover. No red text.
const link = 'underline decoration-1 underline-offset-[0.2em] decoration-accent-gold/70 hover:decoration-primary transition-colors';
const h2 = 'font-serif text-3xl md:text-4xl text-primary leading-tight tracking-tight';

// Facts checked 2026-10-19 against embassyofthefreemind.com (/collection,
// /governance-team, /research) and the SEP entry on Ficino. The BPH is on
// UNESCO's DUTCH Memory of the World register (2022), not the international
// one; Dijstelberge's title is Librarian; Ficino translated all of Plato and
// Plotinus but only selections of Iamblichus and Proclus.
const ADVISORY_BOARD: [string, string][] = [
  ['Wouter Hanegraaff', 'University of Amsterdam'],
  ['Lawrence Principe', 'Johns Hopkins University'],
  ['Bernard McGinn', 'University of Chicago, emer.'],
  ['Georgiana Hedesan', 'Oxford University'],
  ['Didier Kahn', 'CNRS, France'],
  ['Yuval Harari', 'Ben Gurion University of the Negev'],
  ['Matthew Melvin-Koushki', 'University of South Carolina'],
  ['Mike Driedger', 'Brock University, Canada'],
  ['Vladimír Urbánek', 'Academy of Sciences, Czech Republic'],
];

const STEPS: { title: string; body: ReactNode }[] = [
  {
    title: 'Scan',
    body: 'We digitise rare books at the Embassy of the Free Mind and bring in scans from libraries around the world.',
  },
  {
    title: 'Read',
    body: 'AI transcribes each page, old typefaces, abbreviations and handwriting included.',
  },
  {
    title: 'Translate',
    body: 'Each page is translated into English and shown next to the scan, so any line can be checked against the original.',
  },
  {
    title: 'Index',
    body: 'Names, places, dates, terms and illustrations are tagged where they sit on the page, so you can search the library for what is in the books, not just their titles.',
  },
  {
    title: 'Share',
    body: (
      <span>
        Everything is free to read and cite. Published editions get a DOI through{' '}
        <a href="https://zenodo.org" target="_blank" rel="noopener noreferrer" className={link}>Zenodo</a>, and researchers and AI tools can use the{' '}
        <Link href="/developers" className={link}>API and MCP server</Link>, or{' '}
        <Link href="/connect" className={link}>connect it to Claude or ChatGPT</Link>.
      </span>
    ),
  },
];

export default async function AboutPage() {
  const stats = await getSiteStats();
  const fmt = (n: number) => n.toLocaleString('en-GB');

  // Number colours follow the site's badge colours where one fits (green =
  // translated, yellow = first translation).
  const headlineStats: HeroStat[] = [
    { value: fmt(stats.totalBooks), label: 'books digitised', href: '/search', color: '#60a5fa' },
    // stats.languageCount is now an honest distinct-language count: compound
    // labels are split into atomic languages and variants/junk are dropped
    // (scripts/lib/language-count.mjs). ~105 as of 2026-06-26, so 100+ is a
    // defensible floor.
    { value: '100+', label: 'languages', color: '#c4b5fd' },
    { value: fmt(stats.readableInEnglish), label: 'readable in English', href: '/search?has_translation=true', color: '#4ade80' },
    { value: fmt(stats.firstTranslationCount), label: 'first-ever English translations', href: '/search?first_translation=true', color: '#facc15' },
    { value: fmt(stats.illustrationCount), label: 'illustrations catalogued', href: '/gallery', color: '#fb923c' },
  ];

  return (
    <ContentPageLayout header={<><SiteHeader variant="light" /><AboutHero stats={headlineStats} /></>} bg="bg-cream" maxWidth="wide" noPadding>
      {/* The gap */}
      <section className="px-6 md:px-12 py-14 md:py-16 border-b border-border-light">
        <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-10 lg:gap-16 items-start">
          <div>
            <h2 className={h2}>How much of the written past can anyone read today?</h2>
            <p className="mt-6 text-lg text-secondary leading-relaxed">
              Very little. Start with the books one small country printed before 1700, then keep zooming out.
            </p>
            <p className="mt-4 text-secondary leading-relaxed">
              Machine reading and translation are now good enough to make a first pass at all of it, quickly, with the original page always beside the English so anyone can check it. That is the job Source Library has taken on: to build the world&apos;s largest open-access collection of translated primary sources, so that scholars, seekers and AI systems can draw on the whole of the human intellectual tradition.
            </p>
            <p className="mt-4 text-secondary leading-relaxed">
              These are not obscure footnotes. They are the roots of modern science, psychology and philosophy of mind, and of the old questions about what it means to be human.
            </p>
            <p className="mt-4 text-secondary leading-relaxed">
              It also matters for AI. Today&apos;s models were trained on Reddit, not the Renaissance. Give a capable model the actual texts, every line checkable against its scan, and it becomes a research instrument. Ask it <em>what is mind?</em> and it can set{' '}
              <Link href="/q/BhIfljO2ApigrcHcTeD" className={link}>Plato&apos;s Greek</Link> beside{' '}
              <Link href="/q/BgRsFohtofMtBqdNmop" className={link}>Śaṅkara&apos;s Sanskrit</Link>, a Tibetan master&apos;s{' '}
              <Link href="/q/BijCMw143jlgk5jBxGl" className={link}>pointing-out instructions</Link> and{' '}
              <Link href="/q/Bojb0GnS1vOWqoRET4E" className={link}>Xunzi&apos;s Chinese</Link>, quoting each and linking to the page it sits on.
            </p>
          </div>
          <div>
            <WrittenPastChart />
            <p className="mt-5 text-xs text-muted leading-relaxed">
              Europe: distinct works printed before 1700 in the Universal Short Title Catalogue, matched against 30 translation catalogues (May 2026). Tibetan: works in the BDRC catalogue. Arabic script and India: estimated surviving manuscripts (mss.), counted in copies, not works. Chinese: 200,000 titles and 500,000 editions catalogued to 1912, a floor. Still uncounted: Japanese, Korean, Persian, Hebrew, Armenian, Ethiopian, Byzantine Greek and medieval Latin manuscripts.{' '}
              <Link href="/research/translation-gap" className={link}>How we measured it</Link>
            </p>
          </div>
        </div>
      </section>

      {/* What we do: a real page read in front of you */}
      <section className="px-6 md:px-12 py-14 md:py-20 border-b border-border-light">
        <ReadingDemo>
          <h2 className={h2}>What we do</h2>
          <ol className="mt-8 space-y-5">
            {STEPS.map((st, i) => (
              <li key={st.title} data-i={i} className="rd-step grid grid-cols-[2.5rem_1fr] gap-3">
                <span className="rd-num text-sm font-semibold tabular-nums pt-0.5">{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <h3 className="text-lg font-semibold text-primary">{st.title}</h3>
                  <p className="mt-1 text-secondary leading-relaxed">{st.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-8 text-secondary">
            Follow one real page from the scan to the checks that run after it is published:{' '}
            <Link href="/how-it-works" className={link}>How Source Library works</Link>.
          </p>
        </ReadingDemo>
      </section>

      {/* Where it started */}
      <section className="px-6 md:px-12 py-16 md:py-24 border-b border-border-light">
        <div className="grid grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-10 lg:gap-16 items-start">
          <div className="md:order-1 order-2">
            <h2 className={h2}>Where it started</h2>
            <p className="mt-6 text-secondary leading-relaxed">
              Around 1460 a monk, Leonardo of Pistoia, brought a Greek manuscript of the <em>Corpus Hermeticum</em> to Florence from Macedonia. Cosimo de&apos; Medici was paying the young scholar Marsilio Ficino (1433&ndash;1499) to translate Plato into Latin. Old and ill, Cosimo asked him to put Plato aside and translate Hermes first, sure that it held the oldest wisdom of all. Ficino went on to put all of Plato and Plotinus into Latin, along with selected works of Iamblichus, Proclus and other Neoplatonists, and with them the idea of a <em>prisca theologia</em>, one ancient wisdom shared by every seeker of truth. Those translations helped set off the Renaissance. We think it is time for another.
            </p>
            <p className="mt-4 text-secondary leading-relaxed">
              Five and a half centuries later, Derek Lomas found he couldn&apos;t read Ficino&apos;s own books. He came across Ficino&apos;s <em>Liber de Voluptate</em> at the Embassy of the Free Mind in Amsterdam and couldn&apos;t read it, because most of what the Renaissance wrote has never been translated. He started Source Library there in 2022, under the bust of Ficino that still watches over the work.
            </p>
            <p className="mt-4 text-secondary leading-relaxed">
              Derek studied cognitive science at Yale, did his PhD in human-computer interaction at Carnegie Mellon, and teaches at TU Delft. His{' '}
              <Link href="/articles/vision" className={link}>founder&apos;s letter</Link> sets out where the project goes next.
            </p>
          </div>
          <figure className="md:order-2 order-1 max-w-[440px] md:ml-auto">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/about/derek-ficino.jpg"
              alt="Derek Lomas standing beside a bronze bust of Marsilio Ficino at the Embassy of the Free Mind"
              width={690}
              height={630}
              className="w-full h-auto border border-border-light"
              loading="lazy"
            />
            <figcaption className="text-sm text-muted mt-3">
              Derek Lomas with the bust of Marsilio Ficino at the Embassy of the Free Mind.
            </figcaption>
          </figure>
        </div>
      </section>

      {/* Partner */}
      <section className="px-6 md:px-12 py-16 md:py-24 border-b border-border-light">
        <div className="grid grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-10 lg:gap-16 items-start">
          <figure>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/vision/embassy.jpg"
              alt="The Embassy of the Free Mind in the Huis met de Hoofden, Keizersgracht, Amsterdam"
              width={600}
              height={800}
              className="w-full h-auto border border-border-light"
              loading="lazy"
            />
            <figcaption className="text-sm text-muted mt-3">The Embassy of the Free Mind, in the Huis met de Hoofden on the Keizersgracht, Amsterdam.</figcaption>
          </figure>
          <div>
            <h2 className={h2}>Our partners</h2>
            <p className="mt-6 text-lg text-secondary leading-relaxed">
              Source Library is an initiative of the{' '}
              <a href="https://embassyofthefreemind.com" target="_blank" rel="noopener noreferrer" className={link}>Embassy of the Free Mind</a>, a museum and library in the Huis met de Hoofden on Amsterdam&apos;s Keizersgracht. The Embassy gives the project its home, its books and its scholars.
            </p>
            <p className="mt-4 text-secondary leading-relaxed">
              Its library is the Bibliotheca Philosophica Hermetica, which Joost R. Ritman began collecting in 1957: over 28,000 volumes on Hermetic philosophy, alchemy, mysticism and religion, including some 5,000 manuscripts. The collection is on UNESCO&apos;s Dutch Memory of the World Register and holds the{' '}
              <a href="https://www.guinnessworldrecords.com/world-records/777560-largest-library-dedicated-to-magic-and-mysticism" target="_blank" rel="noopener noreferrer" className={link}>Guinness World Record</a>{' '}
              for the largest library dedicated to magic and mysticism.
            </p>
            <p className="mt-4 text-secondary leading-relaxed">
              Librarian <strong className="font-semibold text-primary">Paul Dijstelberge</strong>, a historian of the book, guides our work with the collection, and senior researcher <strong className="font-semibold text-primary">Carlos Gilly</strong>, at the BPH for over thirty years, is a leading authority on Rosicrucianism.
            </p>

            <p className="mt-4 text-secondary leading-relaxed">
              Two more partners help build it.{' '}
              <a href="https://frond-studio.com" target="_blank" rel="noopener noreferrer" className={link}>Frond Studio</a>, a design and technology studio, works on how Source Library looks and reads.{' '}
              <a href="https://folium-studio.com" target="_blank" rel="noopener noreferrer" className={link}>Folium</a>, Frond&apos;s platform for libraries, museums and archives, takes what we have learned here to other collections. The Embassy&apos;s own catalogue runs on it.
            </p>

            <h3 className="mt-10 text-base font-semibold text-primary">
              The Embassy&apos;s{' '}
              <a href="https://www.embassyofthefreemind.com/research" target="_blank" rel="noopener noreferrer" className={link}>Academic Advisory Board</a>
            </h3>
            <ul className="mt-4 grid sm:grid-cols-2 gap-x-8 gap-y-2.5">
              {ADVISORY_BOARD.map(([name, institution]) => (
                <li key={name} className="text-sm leading-snug">
                  <span className="text-primary">{name}</span>
                  <span className="text-muted">, {institution}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Supporters + join */}
      <section className="px-6 md:px-12 py-16 md:py-24">
        <div className="grid grid-cols-[minmax(0,1fr)] md:grid-cols-2 gap-10 lg:gap-16">
          <div>
            <h2 className={h2}>With the support of</h2>
            <p className="mt-6 text-secondary leading-relaxed">
              Source Library and the Embassy of the Free Mind are made possible by people who believe in this work. We are grateful to the{' '}
              <strong className="font-semibold text-primary">Wisdom Frontiers Society</strong> of La Jolla, California, and the{' '}
              <a href="https://gambrellfoundation.org" target="_blank" rel="noopener noreferrer" className={link}>Gambrell Foundation</a>{' '}
              of Charlotte, North Carolina.
            </p>
            <a
              href="https://gambrellfoundation.org"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="The Gambrell Foundation"
              className="mt-8 inline-block hover:opacity-80 transition-opacity"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/partners/gambrell-foundation.svg" alt="The Gambrell Foundation" className="h-14 w-auto object-contain" />
            </a>
          </div>
          <div className="border border-border-medium p-8 md:p-10">
            <h2 className={h2}>Join the work</h2>
            <p className="mt-4 text-secondary leading-relaxed">
              We want this to outlast us: a lasting home for humanity&apos;s written heritage, from books to oral histories to expeditions in the field. The work is kept going by the people who use and value it. Read the plan, explore the library, or help pay for the next translation.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/support" className="px-5 py-2.5 bg-accent-rust text-white hover:opacity-90 transition-opacity font-medium">
                Support the project
              </Link>
              <Link href="/articles/vision" className="px-5 py-2.5 border border-stone-400 text-primary hover:bg-[var(--bg-warm)] transition-colors font-medium">
                Read the vision
              </Link>
              <Link href="/" className="px-5 py-2.5 border border-stone-400 text-primary hover:bg-[var(--bg-warm)] transition-colors">
                Browse the library
              </Link>
            </div>
          </div>
        </div>

        <nav aria-label="More about Source Library" className="mt-16 pt-8 border-t border-border-light flex flex-wrap gap-x-8 gap-y-3 text-secondary">
          {[
            ['/how-it-works', 'How it works'],
            ['/census', 'Translation Census'],
            ['/about/progress', 'Our progress'],
            ['/about/sources', 'Source libraries'],
            ['/about/faq', 'FAQ'],
            ['/developers', 'API and MCP server'],
          ].map(([href, label]) => (
            <Link key={href} href={href} className={link}>
              {label} →
            </Link>
          ))}
        </nav>
      </section>
    </ContentPageLayout>
  );
}
