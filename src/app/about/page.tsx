import { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import ContentPageLayout from '@/components/layout/ContentPageLayout';
import SiteHeader from '@/components/layout/SiteHeader';
import HeroWall, { type HeroStat } from '@/components/about/HeroWall';
import FourLocks from '@/components/about/FourLocks';
import StatementReveal from '@/components/about/StatementReveal';
import AskDemo from '@/components/about/AskDemo';
import FreethinkersFan from '@/components/about/FreethinkersFan';
import Counters from '@/components/about/Counters';
import WrittenPastChart from '@/components/about/WrittenPastChart';
import ReadingDemo from '@/components/about/ReadingDemo';
import Reveal from '@/components/about/Reveal';
import { PrefaceFigure, CompendiumFigure } from '@/components/about/MarkedFigures';
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

// The page is told in scenes. Most fill the screen and each has one piece of
// motion that plays when it arrives and resets when it leaves; nothing is tied
// to scroll position. The old Renaissance gets one scene; the rest is about
// what becomes possible now.
const WIDE = 'mx-auto w-full max-w-6xl px-6 md:px-10';
const SCENE = 'min-h-[100svh] flex flex-col justify-center py-24 md:py-32';
const h2 = 'font-serif text-4xl md:text-6xl text-primary leading-[1.05] tracking-tight';
const h3 = 'font-serif text-3xl md:text-5xl text-primary leading-[1.08] tracking-tight';
const lead = 'text-xl md:text-2xl text-secondary leading-snug';
const body = 'text-lg text-secondary leading-relaxed';

// Links as in the articles (.claude/docs/article-rules.md): body colour, thin
// gold underline that darkens on hover. No red text.
const link = 'underline decoration-1 underline-offset-[0.2em] decoration-accent-gold/70 hover:decoration-primary transition-colors';

// Facts checked 2026-10-19 against embassyofthefreemind.com (/collection,
// /governance-team, /research). The BPH is on UNESCO's DUTCH Memory of the
// World register (2022), not the international one; Dijstelberge's title is
// Librarian.
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
    <ContentPageLayout
      header={
        <>
          <SiteHeader variant="light" />
          <HeroWall
            stats={headlineStats}
            second={
              <div className="max-w-2xl md:bg-transparent bg-cream/90 p-5 md:p-0 -mx-1 md:mx-0">
                <h2 className="font-serif text-5xl md:text-7xl text-primary leading-[1.02] tracking-tight">
                  Most of the written past is still out of reach.
                </h2>
                <p className={`mt-6 ${lead} max-w-xl`}>
                  Fewer than 1 in 100 books printed in Europe before 1700 can be read in English. On this wall, they are the few that stay lit.
                </p>
                <p className={`mt-4 ${body} max-w-xl`}>
                  The rest are in Latin, German, French, Dutch and dozens of other languages, and most have never been scanned.
                </p>
              </div>
            }
          />
        </>
      }
      bg="bg-cream"
      maxWidth="full"
      noPadding
    >
      {/* Four locks: the problem, then the mission */}
      <section className="py-24 md:py-36 bg-[var(--bg-warm)]">
        <div className={WIDE}>
          <Reveal>
            <h2 className={`${h2} max-w-4xl`}>Why these books stay unread</h2>
          </Reveal>
          <div className="mt-16 md:mt-24">
            <FourLocks
              mission={
                <p className="font-serif text-3xl md:text-5xl text-primary leading-[1.1] tracking-tight">
                  Our mission is to unlock it: scans and translations that make these books accessible to people and AI systems everywhere.
                </p>
              }
            />
          </div>
        </div>
      </section>

      {/* It happened once */}
      <section className="py-24 md:py-36">
        <div className={WIDE}>
          <Reveal className="max-w-4xl">
            <h2 className={h2}>Translation has sparked a revolution before</h2>
            <p className={`mt-8 ${lead}`}>
              In 1463 Marsilio Ficino translated the Hermetic writings into Latin, then all of Plato. Europe could suddenly read what it had only heard of. The result was a small revolution we now call the Renaissance: new science, new art, new ideas about the body and the mind.
            </p>
          </Reveal>
          <div className="mt-14 md:mt-20">
            <PrefaceFigure />
          </div>
          <Reveal className="mt-24 md:mt-32 max-w-4xl">
            <h3 className={h3}>Ficino&apos;s own books waited more than five hundred years for a translation</h3>
          </Reveal>
          <div className="mt-12 md:mt-16">
            <CompendiumFigure />
          </div>
        </div>
      </section>

      {/* A new Renaissance */}
      <section className="py-28 md:py-40 bg-[var(--bg-warm)]">
        <div className={WIDE}>
          <StatementReveal
            text="Rediscovering ancient wisdom helped spark the Renaissance. We think it is time for another."
            className="font-serif text-5xl md:text-7xl lg:text-8xl text-primary leading-[1.02] tracking-tight max-w-6xl"
          />
          <Reveal className="mt-14 md:mt-20 max-w-2xl">
            <p className={lead}>
              Machine reading and translation can now make a first pass at all of it, with the original page always beside the English so anyone can check it. We are building the world&apos;s largest open-access collection of translated primary sources. Here is what that makes possible.
            </p>
          </Reveal>
        </div>
      </section>

      {/* Ask two thousand years a question */}
      <section className={SCENE}>
        <div className={WIDE}>
          <Reveal className="text-center max-w-3xl mx-auto">
            <h3 className={h3}>Ask the great thinkers a question, and hear them answer in their own words</h3>
            <p className={`mt-5 ${body}`}>Every answer quotes the original page, in its own words, with the scan one click away.</p>
          </Reveal>
          <div className="mt-14 md:mt-16">
            <AskDemo />
          </div>
        </div>
      </section>

      {/* AI and the freethinkers */}
      <section className="py-24 md:py-32 bg-[var(--bg-warm)] overflow-hidden">
        <div className={WIDE}>
          <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] gap-8 lg:gap-16 items-end">
            <Reveal>
              <h3 className={h3}>AI has read Reddit, but not the freethinkers</h3>
            </Reveal>
            <Reveal delay={150}>
              <p className={body}>
                AI is fast becoming how people look things up and think things through. It learned from the open web. The thinkers who changed what we know about science, art, consciousness and the body are mostly missing, because their books were never scanned, translated or put online. We are giving them to it, every line linked to its page so an answer can be checked.
              </p>
            </Reveal>
          </div>
          <div className="mt-12 md:mt-16 md:pb-24">
            <FreethinkersFan />
          </div>
        </div>
      </section>

      {/* Every day, another first */}
      <section className={SCENE}>
        <div className={WIDE}>
          <Reveal>
            <h3 className={h3}>Thousands of books, translated into English for the first time</h3>
          </Reveal>
          <div className="mt-14 md:mt-16">
            <Counters
              items={[
                { value: stats.totalBooks, label: 'books digitised', href: '/search' },
                { value: stats.readableInEnglish, label: 'readable in English', href: '/search?has_translation=true' },
                { value: stats.firstTranslationCount, label: 'first-ever English translations', href: '/search?first_translation=true' },
              ]}
            />
          </div>
        </div>
      </section>

      {/* How far there is to go */}
      <section className="py-24 md:py-32 bg-[var(--bg-warm)]">
        <div className={WIDE}>
          <Reveal className="max-w-3xl">
            <h2 className={h2}>Most of the world&apos;s writing is still waiting</h2>
            <p className={`mt-6 ${lead}`}>Start with Latin, the language of the Renaissance, then keep zooming out.</p>
          </Reveal>
          <Reveal className="mt-14 md:mt-16">
            <WrittenPastChart />
            <p className="mt-6 text-xs text-muted leading-relaxed">
              Europe: distinct works printed before 1700 in the Universal Short Title Catalogue, matched against 30 translation catalogues (May 2026). Tibetan: works in the BDRC catalogue. Arabic script and India: estimated surviving manuscripts (mss.), counted in copies, not works. Chinese: 200,000 titles and 500,000 editions catalogued to 1912, a floor. Still uncounted: Japanese, Korean, Persian, Hebrew, Armenian, Ethiopian, Byzantine Greek and medieval Latin manuscripts.{' '}
              <Link href="/research/translation-gap" className={link}>How we measured it</Link>
            </p>
          </Reveal>
        </div>
      </section>

      {/* What we do: a real page read in front of you */}
      <section className="py-24 md:py-32">
        <div className={WIDE}>
          <ReadingDemo>
            <h2 className={h2}>How a page becomes readable</h2>
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
        </div>
      </section>

      {/* Who */}
      <section className="py-24 md:py-32 bg-[var(--bg-warm)]">
        <div className={WIDE}>
          <Reveal>
            <h2 className={h2}>Who is behind Source Library</h2>
          </Reveal>
          <div className="mt-14 md:mt-16 grid grid-cols-[minmax(0,1fr)] md:grid-cols-2 gap-14 md:gap-16 items-start">
            <Reveal>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/vision/embassy.jpg" alt="The Embassy of the Free Mind in the Huis met de Hoofden, Keizersgracht, Amsterdam" width={600} height={800} className="block w-full max-w-[400px] h-auto" loading="lazy" />
              <h3 className="mt-6 font-serif text-2xl text-primary">The Embassy of the Free Mind</h3>
              <p className={`mt-3 ${body}`}>
                Source Library is an initiative of the{' '}
                <a href="https://embassyofthefreemind.com" target="_blank" rel="noopener noreferrer" className={link}>Embassy of the Free Mind</a>{' '}
                in Amsterdam, home of the Bibliotheca Philosophica Hermetica: over 28,000 volumes on Hermetic philosophy, alchemy, mysticism and religion, on UNESCO&apos;s Dutch Memory of the World Register and holder of the{' '}
                <a href="https://www.guinnessworldrecords.com/world-records/777560-largest-library-dedicated-to-magic-and-mysticism" target="_blank" rel="noopener noreferrer" className={link}>Guinness World Record</a>{' '}
                for the largest library dedicated to magic and mysticism. Librarian Paul Dijstelberge and senior researcher Carlos Gilly guide our work with the collection.
              </p>
            </Reveal>
            <Reveal delay={150}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/about/derek-ficino.jpg" alt="Derek Lomas standing beside a bronze bust of Marsilio Ficino at the Embassy of the Free Mind" width={690} height={630} className="block w-full max-w-[460px] h-auto" loading="lazy" />
              <h3 className="mt-6 font-serif text-2xl text-primary">Derek Lomas, founder</h3>
              <p className={`mt-3 ${body}`}>
                Derek came across Ficino&apos;s <em>Liber de Voluptate</em> at the Embassy and couldn&apos;t read it, because it had never been translated. He started Source Library there in 2022, under the bust of Ficino. He studied cognitive science at Yale, did his PhD at Carnegie Mellon and teaches at TU Delft. Read his{' '}
                <Link href="/articles/vision" className={link}>founder&apos;s letter</Link>.
              </p>
            </Reveal>
          </div>
          <div className="mt-20 md:mt-24 grid grid-cols-[minmax(0,1fr)] md:grid-cols-2 gap-6">
            <Reveal>
              <a href="https://frond-studio.com" target="_blank" rel="noopener noreferrer" className="group block h-full bg-[#1a1612] text-white p-8 md:p-10 hover:bg-[#241d17] transition-colors">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/partners/frond-studio-white.png" alt="Frond Studio" className="h-9 w-auto" loading="lazy" />
                <p className="mt-8 text-lg leading-relaxed text-stone-200">
                  Frond Studio designs and builds Source Library: the site, the reader and the tools behind them.
                </p>
                <span className="mt-6 inline-block text-sm text-stone-300 group-hover:text-white">frond-studio.com →</span>
              </a>
            </Reveal>
            <Reveal delay={120}>
              <a href="https://folium-studio.com" target="_blank" rel="noopener noreferrer" className="group block h-full bg-[#1a1612] text-white p-8 md:p-10 hover:bg-[#241d17] transition-colors">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/partners/folium-white.png" alt="Folium" className="h-9 w-auto" loading="lazy" />
                <p className="mt-8 text-lg leading-relaxed text-stone-200">
                  Folium is our partnership to offer the same scanning, translation and reading to other libraries, museums and archives. The Embassy&apos;s own catalogue already runs on it.
                </p>
                <span className="mt-6 inline-block text-sm text-stone-300 group-hover:text-white">folium-studio.com →</span>
              </a>
            </Reveal>
          </div>
          <Reveal className="mt-16 md:mt-20">
            <h3 className="text-base font-semibold text-primary">
              The Embassy&apos;s{' '}
              <a href="https://www.embassyofthefreemind.com/research" target="_blank" rel="noopener noreferrer" className={link}>Academic Advisory Board</a>
            </h3>
            <ul className="mt-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-2.5">
              {ADVISORY_BOARD.map(([name, institution]) => (
                <li key={name} className="text-sm leading-snug">
                  <span className="text-primary">{name}</span>
                  <span className="text-muted">, {institution}</span>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>

      {/* Join */}
      <section className="py-28 md:py-40 bg-accent-rust text-white">
        <div className={WIDE}>
          <StatementReveal
            text="Help pay for the next first translation."
            className="font-serif text-5xl md:text-7xl leading-[1.04] tracking-tight max-w-4xl"
          />
          <Reveal className="mt-10 max-w-2xl">
            <p className="text-lg md:text-xl leading-relaxed text-white/90">
              Everything here is free to read, and it is kept going by the people who use and value it. We are grateful to the Wisdom Frontiers Society of La Jolla, California, and the{' '}
              <a href="https://gambrellfoundation.org" target="_blank" rel="noopener noreferrer" className="underline decoration-1 underline-offset-[0.2em] decoration-white/60 hover:decoration-white">Gambrell Foundation</a>{' '}
              of Charlotte, North Carolina.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <Link href="/support" className="px-6 py-3 bg-white text-primary hover:bg-cream transition-colors font-medium">
                Support the project
              </Link>
              <Link href="/articles/vision" className="px-6 py-3 border border-white/70 text-white hover:bg-white/10 transition-colors font-medium">
                Read the vision
              </Link>
              <Link href="/" className="px-6 py-3 border border-white/70 text-white hover:bg-white/10 transition-colors">
                Browse the library
              </Link>
            </div>
          </Reveal>
          <nav aria-label="More about Source Library" className="mt-20 pt-8 border-t border-white/30 flex flex-wrap gap-x-8 gap-y-3 text-white/90">
            {[
              ['/how-it-works', 'How it works'],
              ['/census', 'Translation Census'],
              ['/about/progress', 'Our progress'],
              ['/about/sources', 'Source libraries'],
              ['/about/faq', 'FAQ'],
              ['/developers', 'API and MCP server'],
            ].map(([href, label]) => (
              <Link key={href} href={href} className="underline decoration-1 underline-offset-[0.2em] decoration-white/50 hover:decoration-white">
                {label} →
              </Link>
            ))}
          </nav>
        </div>
      </section>
    </ContentPageLayout>
  );
}
