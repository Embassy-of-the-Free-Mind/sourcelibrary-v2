import { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import ContentPageLayout from '@/components/layout/ContentPageLayout';
import SiteHeader from '@/components/layout/SiteHeader';
import HeroWall, { type HeroStat } from '@/components/about/HeroWall';
import StatementReveal from '@/components/about/StatementReveal';
import FreethinkersFan from '@/components/about/FreethinkersFan';
import Counters from '@/components/about/Counters';
import WrittenPastChart from '@/components/about/WrittenPastChart';
import ReadingDemo from '@/components/about/ReadingDemo';
import Reveal from '@/components/about/Reveal';
import { VariantProvider, Variant } from '@/components/about/Variants';
import { PAGES as FREETHINKERS } from '@/components/about/freethinkers-data';
import { VoluptateFigure, WonderFigure, CosimoFigure, LightFigure, LibraryFigure, SoulFigure } from '@/components/about/MarkedFigures';
import { getSiteStats } from '@/lib/site-stats';

// The hero stats come from system_config.homepage_stats, which a job refreshes
// daily at 05:00. Without a revalidate window this page was prerendered once per
// deploy and its numbers froze until the next merge.
export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'About - Source Library',
  description: 'Source Library translates old books and manuscripts into English with AI, every translation beside the original page, free to read, quote and cite. An initiative of the Embassy of the Free Mind, Amsterdam.',
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

const MORE_LINKS: [string, string][] = [
  ['/how-it-works', 'How it works'],
  ['/census', 'Translation Census'],
  ['/about/progress', 'Our progress'],
  ['/about/sources', 'Source libraries'],
  ['/about/faq', 'FAQ'],
  ['/developers', 'API and MCP server'],
];

// Partners. Facts: Wisdom Frontiers (La Jolla, California) is the US society
// behind the project's research (/research: "a project of Wisdom Frontiers";
// the 2025 goal to translate the untranslated Renaissance, origin-story
// article). The Gambrell Foundation (Charlotte, NC) funds the Embassy of the
// Free Mind and Source Library (gambrellfoundation.org lists the Embassy as a
// case study). Frond and Folium copy is Laura's (2026-10-27).
const PARTNERS: { name: string; href: string; site: string; logo?: string; invert?: boolean; text: string }[] = [
  {
    name: 'Wisdom Frontiers',
    href: 'https://wisdomfrontiers.org',
    site: 'wisdomfrontiers.org',
    logo: '/ai-partners/wisdom-frontiers-white.svg',
    text: 'Wisdom Frontiers, a society in La Jolla, California, backs Source Library and its research, and set out with us in 2025 to translate the untranslated works of the Renaissance.',
  },
  {
    name: 'Gambrell Foundation',
    href: 'https://gambrellfoundation.org',
    site: 'gambrellfoundation.org',
    logo: '/ai-partners/gambrell-foundation.svg',
    invert: true,
    text: 'The Gambrell Foundation of Charlotte, North Carolina, invests in thinkers working on what makes a good life, and supports the Embassy of the Free Mind and Source Library.',
  },
  {
    name: 'Frond Studio',
    href: 'https://frond-studio.com',
    site: 'frond-studio.com',
    logo: '/ai-partners/frond-studio-white.png',
    text: 'Frond Studio designs and builds Source Library: the site, the reader and the tools behind them.',
  },
  {
    name: 'Folium',
    href: 'https://folium-studio.com',
    site: 'folium-studio.com',
    logo: '/ai-partners/folium-white.png',
    text: 'Folium is our partnership to offer the same scanning, translation and reading to other libraries, museums and archives. The Embassy’s own catalogue already runs on it.',
  },
];

const STEPS: { title: string; body: ReactNode }[] = [
  { title: 'Scan', body: 'We scan books at the Embassy of the Free Mind and bring in scans from libraries worldwide.' },
  { title: 'Read', body: 'AI transcribes each page, old type and handwriting included.' },
  { title: 'Translate', body: 'Each page is translated into English, beside the original.' },
  { title: 'Index', body: 'Names, places, ideas and pictures are tagged, so you can search inside the books.' },
  {
    title: 'Share',
    body: (
      <span>
        Translations are free to read and cite, with DOIs from{' '}
        <a href="https://zenodo.org" target="_blank" rel="noopener noreferrer" className={link}>Zenodo</a> and an{' '}
        <Link href="/developers" className={link}>API and MCP server</Link>.
      </span>
    ),
  },
];

// What the library is for, for people. Each line is something it does today,
// not a promise.
const GOALS: [string, string][] = [
  ['Go back to the sources', 'Read what was actually written, not only what was later said about it.'],
  ['Bring traditions together', 'Philosophy, medicine, alchemy and religion from more than 100 languages, side by side and searchable in one place.'],
  ['Find what was forgotten', 'Books that shaped science, art and medicine, and many that were simply lost from view, readable again.'],
  ['Check every line', 'Every translation sits beside the page it came from, so anyone can check it, quote it and cite it.'],
];

const AUDIENCES: [string, string][] = [
  ['Students', 'Read the books behind the textbooks, in English, next to the original.'],
  ['Scholars', 'Search inside thousands of books at once, and cite the page.'],
  ['Writers and artists', 'Find images, ideas and stories in books few people have been able to read.'],
  ['Anyone curious', 'Every translation is free to read, quote and cite.'],
];

function BookPair({ first, second }: { first: ReactNode; second: ReactNode }) {
  return (
    <>
      <Reveal className="mt-24 md:mt-32 max-w-4xl">
        <h3 className={h3}>Ficino gave Europe back Plato, Socrates and Hermes.</h3>
      </Reveal>
      <div className="mt-12 md:mt-16">{first}</div>
      <Reveal className="mt-24 md:mt-32 max-w-4xl">
        <h3 className={h3}>Ficino&apos;s own books, and millions of others, are still waiting.</h3>
      </Reveal>
      <div className="mt-12 md:mt-16">{second}</div>
    </>
  );
}

function Second({ title }: { title: string }) {
  return (
    <>
      <h2 className="font-serif text-5xl md:text-7xl text-white leading-[1.02] tracking-tight">{title}</h2>
      <p className="mt-6 text-xl md:text-2xl text-stone-200 leading-snug max-w-xl">
        Of everything anyone has counted, from Latin to Tibetan, less than 1% has been translated into English. On this wall, they are the few that stay lit.
      </p>
    </>
  );
}

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
    <VariantProvider>
    <ContentPageLayout
      header={
        <>
          <SiteHeader variant="light" />
          {/* Hero = what we are doing (the mission); second panel = the
              situation it answers. The titles are written to run on. */}
          <HeroWall
            stats={headlineStats}
            secondTone="dark"
            title={<>Making the world&apos;s written past readable</>}
            intro={<>Source Library gathers old books and manuscripts from around the world, translates them, and sets each translation beside its original page, so anyone can read them and check every line.</>}
            second={
              <div className="max-w-2xl md:bg-transparent bg-[#1a1612]/85 p-5 md:p-0 -mx-1 md:mx-0">
                <Second title="Today, most of it can only be read in the language it was written in." />
              </div>
            }
          />
        </>
      }
      bg="bg-cream"
      maxWidth="full"
      noPadding
    >
      {/* How far there is to go */}
      <section className="py-24 md:py-32">
        <div className={WIDE}>
          {/* The heading changes with each step of the chart. */}
          <Reveal>
            <Variant id="chart" options={{
              a: <WrittenPastChart palette="strong" titleClass={`${h3} max-w-5xl`} />,
              b: <WrittenPastChart palette="dark" titleClass={`${h3} max-w-5xl`} />,
              c: <WrittenPastChart palette="hues" titleClass={`${h3} max-w-5xl`} />,
            }} />
            <details className="group mt-6 text-sm text-muted">
              <summary className="inline-flex items-center gap-1.5 cursor-pointer list-none select-none hover:text-primary [&::-webkit-details-marker]:hidden">
                Sources and method
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="transition-transform group-open:rotate-180"><path d="M1.5 3.5 5 7l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
              </summary>
              <p className="mt-3 text-xs leading-relaxed max-w-4xl">
              Europe: distinct works printed before 1700 in the Universal Short Title Catalogue, matched against 30 translation catalogues (May 2026). Tibetan: works in the BDRC catalogue. Arabic script and India: estimated surviving manuscripts (mss.), counted in copies, not works. Chinese: 200,000 titles and 500,000 editions catalogued to 1912, a floor. Still uncounted: Japanese, Korean, Persian, Hebrew, Armenian, Ethiopian, Byzantine Greek and medieval Latin manuscripts.{' '}
              <Link href="/research/translation-gap" className={link}>How we measured it</Link>
              </p>
            </details>
          </Reveal>
        </div>
      </section>

      {/* It happened once */}
      <section className="py-24 md:py-36 bg-[var(--bg-warm)]">
        <div className={WIDE}>
          <Reveal className="max-w-4xl">
            <h2 className={h2}>Translation has started a revolution before. It changed art, science and how people thought, and we call it the Renaissance.</h2>
            <p className={`mt-8 ${lead}`}>
              In the 1460s Cosimo de&apos; Medici, the most powerful man in Florence, backed Marsilio Ficino to translate Plato and the Hermetic writings from Greek into Latin. Ideas Western Europe had only known second-hand were suddenly in the hands of its scholars, artists and physicians. Renaissance means rebirth: old knowledge, readable again.
            </p>
          </Reveal>
          {/* The two pages, tried as pairs: what Ficino gave back, then what is still waiting. */}
          <Variant id="books" options={{
            a: <BookPair first={<LightFigure />} second={<VoluptateFigure />} />,
            b: <BookPair first={<LightFigure />} second={<SoulFigure />} />,
            c: <BookPair first={<WonderFigure />} second={<VoluptateFigure />} />,
            d: <BookPair first={<WonderFigure />} second={<LibraryFigure />} />,
            e: <BookPair first={<CosimoFigure />} second={<SoulFigure />} />,
            f: <BookPair first={<LightFigure />} second={<LibraryFigure />} />,
          }} />
        </div>
      </section>

      {/* A new Renaissance: what the library is for, for people. The next
          section is what it gives AI; the ones after come back to people. */}
      <Variant
        id="renaissance"
        options={{
          // A: the statement, then four goals, numbered and large.
          a: (
            <section className="py-28 md:py-40">
              <div className={WIDE}>
                <StatementReveal
                  text="Now that we can translate all of it, we think it is time for another Renaissance."
                  className="font-serif text-5xl md:text-7xl text-primary leading-[1.04] tracking-tight max-w-5xl"
                />
                <Reveal className="mt-10 md:mt-14 max-w-2xl">
                  <p className={lead}>
                    Machine reading and translation can now make a careful first pass at whole libraries, from every tradition, with the original page beside every line. We want to put that knowledge back in people&apos;s hands, and see what they make of it.
                  </p>
                </Reveal>
                <ol className="mt-20 md:mt-28 grid grid-cols-[minmax(0,1fr)] md:grid-cols-2 gap-x-16 gap-y-14 md:gap-y-20">
                  {GOALS.map(([t, d], i) => (
                    <li key={t}>
                      <Reveal delay={(i % 2) * 120} className="grid grid-cols-[3rem_minmax(0,1fr)] md:grid-cols-[4.5rem_minmax(0,1fr)] gap-x-4">
                        <span className="font-serif text-4xl md:text-5xl text-accent-rust leading-none tabular-nums">{i + 1}</span>
                        <div>
                          <h3 className="font-serif text-2xl md:text-3xl text-primary leading-snug">{t}</h3>
                          <p className={`mt-3 ${body}`}>{d}</p>
                        </div>
                      </Reveal>
                    </li>
                  ))}
                </ol>
              </div>
            </section>
          ),
          // B: then and now, side by side, then who it is for.
          b: (
            <section className="py-28 md:py-40">
              <div className={WIDE}>
                <Reveal className="max-w-5xl">
                  <h2 className={`${h2} md:text-7xl`}>We think it is time for another Renaissance, and we want to help start it</h2>
                </Reveal>
                <div className="mt-16 md:mt-24 grid grid-cols-[minmax(0,1fr)] md:grid-cols-2 border-t border-border-medium">
                  <Reveal className="pt-8 md:pr-12 pb-10 md:border-r border-border-medium">
                    <p className="text-sm font-semibold text-muted">Then</p>
                    <p className="mt-4 font-serif text-3xl md:text-4xl text-primary leading-tight">One translator, one patron, a lifetime of work.</p>
                    <p className={`mt-5 ${body}`}>Ficino spent much of his life putting Plato and Plotinus into Latin, and his translations helped shape the Renaissance.</p>
                  </Reveal>
                  <Reveal delay={150} className="pt-8 md:pl-12 pb-10 border-t md:border-t-0 border-border-medium">
                    <p className="text-sm font-semibold text-accent-rust">Now</p>
                    <p className="mt-4 font-serif text-3xl md:text-4xl text-primary leading-tight">Machines that can read and translate whole libraries.</p>
                    <p className={`mt-5 ${body}`}>A careful first pass at every page, from every tradition, with the original always beside the English so people can check and improve it.</p>
                  </Reveal>
                </div>
                <Reveal className="mt-20 md:mt-28 max-w-4xl">
                  <h3 className={h3}>So the written past can be read by everyone it belongs to</h3>
                </Reveal>
                <ul className="mt-12 grid grid-cols-[minmax(0,1fr)] sm:grid-cols-2 lg:grid-cols-4 gap-10 border-t border-border-light pt-10">
                  {AUDIENCES.map(([t, d], i) => (
                    <li key={t}>
                      <Reveal delay={i * 100}>
                        <h4 className="font-serif text-2xl text-primary">{t}</h4>
                        <p className={`mt-3 ${body}`}>{d}</p>
                      </Reveal>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ),
          // C: one long statement in two beats, the goals as a quiet list beside it.
          c: (
            <section className="py-28 md:py-40 bg-[var(--bg-warm)]">
              <div className={`${WIDE} grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-16 lg:gap-20`}>
                <div>
                  <StatementReveal
                    text="Translation started one Renaissance. Now we can translate the rest."
                    className="font-serif text-5xl md:text-7xl text-primary leading-[1.04] tracking-tight"
                  />
                  <Reveal className="mt-10 max-w-xl">
                    <p className={lead}>
                      We think it is time for another, and we want to contribute to it: the world&apos;s old books, newly translated, open to read, and free to quote and cite.
                    </p>
                  </Reveal>
                </div>
                <ul className="lg:pt-4 divide-y divide-border-medium border-y border-border-medium">
                  {GOALS.map(([t, d], i) => (
                    <li key={t} className="py-6">
                      <Reveal delay={i * 90}>
                        <h3 className="text-lg font-semibold text-primary">{t}</h3>
                        <p className="mt-1.5 text-secondary leading-relaxed">{d}</p>
                      </Reveal>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ),
        }}
      />

      {/* AI and the freethinkers */}
      <Variant
        id="ai"
        options={{
          // A: a shelf. The six pages in one row at their own proportions,
          // each captioned, under a left-aligned title and text.
          a: (
            <section className="py-24 md:py-32 bg-[var(--bg-warm)]">
              <div className={WIDE}>
                <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-8 lg:gap-16 items-end">
                  <Reveal>
                    <h2 className={h2}>AI has read Reddit, but not the freethinkers</h2>
                  </Reveal>
                  <Reveal delay={120}>
                    <p className={body}>AI is fast becoming how people look things up and think things through. It learned from the open web. The thinkers who changed what we know about science, art, consciousness and the body are mostly missing, because their books were never scanned, translated or put online. We are giving them to it, every line linked to its page so an answer can be checked.</p>
                  </Reveal>
                </div>
                <ul className="mt-14 md:mt-20 flex gap-5 md:gap-6 overflow-x-auto pb-4 -mx-6 px-6 md:mx-0 md:px-0 snap-x">
                  {FREETHINKERS.map((p, i) => (
                    <li key={p.src} className="shrink-0 snap-start w-40 md:w-auto md:flex-1">
                      <Reveal delay={i * 80}>
                        <Link href={p.href} className="group block">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.src} alt={p.alt} width={p.w} height={p.h} className="block w-full h-auto shadow-[0_1px_0_rgba(0,0,0,.08),0_8px_24px_-12px_rgba(0,0,0,.35)] transition-transform duration-500 group-hover:-translate-y-1" loading="lazy" />
                          <span className="block mt-4 text-sm text-muted tabular-nums">{p.year}</span>
                          <span className="block font-medium text-primary">{p.who}</span>
                          <span className="block text-sm text-secondary leading-snug">{p.what}</span>
                        </Link>
                      </Reveal>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ),
          // B: what AI has read against what it has not, side by side.
          b: (
            <section className="py-24 md:py-32 bg-[var(--bg-warm)]">
              <div className={WIDE}>
                <Reveal className="max-w-4xl">
                  <h2 className={h2}>AI has read Reddit, but not the freethinkers</h2>
                  <p className={`mt-8 ${lead} max-w-3xl`}>AI is fast becoming how people look things up and think things through. It learned from the open web. The thinkers who changed what we know about science, art, consciousness and the body are mostly missing, because their books were never scanned, translated or put online. We are giving them to it, every line linked to its page so an answer can be checked.</p>
                </Reveal>
                <div className="mt-14 md:mt-20 grid grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] gap-10 md:gap-16 border-t border-border-medium pt-10">
                  <Reveal>
                    <h3 className="text-sm font-semibold text-primary">What AI has read</h3>
                    <ul className="mt-5 space-y-2 font-serif text-2xl md:text-3xl text-muted leading-tight">
                      <li>Reddit</li>
                      <li>Forums</li>
                      <li>News</li>
                      <li>Wikipedia</li>
                      <li>The open web</li>
                    </ul>
                  </Reveal>
                  <div>
                    <h3 className="text-sm font-semibold text-primary">What it has not</h3>
                    <ul className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-x-5 gap-y-8">
                      {FREETHINKERS.map((p, i) => (
                        <li key={p.src}>
                          <Reveal delay={(i % 3) * 90}>
                            <Link href={p.href} className="group block">
                              <div className="aspect-[3/4] overflow-hidden bg-black/[0.04]">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={p.src} alt={p.alt} width={p.w} height={p.h} className="w-full h-full object-contain transition-transform duration-500 group-hover:scale-[1.03]" loading="lazy" />
                              </div>
                              <span className="block mt-3 text-sm text-muted tabular-nums">{p.year}</span>
                              <span className="block font-medium text-primary">{p.who}</span>
                              <span className="block text-sm text-secondary leading-snug">{p.what}</span>
                            </Link>
                          </Reveal>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </section>
          ),
          // C: the original, title and text side by side, the fan below.
          c: (
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
          ),
        }}
      />

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
              <Link href="/how-it-works" className={link}>Follow one real page through it</Link>
            </p>
          </ReadingDemo>
        </div>
      </section>

      {/* Every day, another first */}
      <section className={`${SCENE} bg-[var(--bg-warm)]`}>
        <div className={WIDE}>
          <Reveal>
            <h3 className={h3}>So far, thousands of books translated into English for the first time</h3>
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

      {/* Who */}
      <section className="py-24 md:py-32">
        <div className={WIDE}>
          <Reveal>
            <h2 className={h2}>Started at the Embassy of the Free Mind in Amsterdam</h2>
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
          <Reveal className="mt-20 md:mt-28">
            <h3 className={h3}>And built with partners</h3>
          </Reveal>
          <div className="mt-10 grid grid-cols-[minmax(0,1fr)] md:grid-cols-2 gap-6">
            {PARTNERS.map((pt, i) => (
              <Reveal key={pt.name} delay={(i % 2) * 120}>
                <a href={pt.href} target="_blank" rel="noopener noreferrer" className="group flex flex-col h-full bg-[#1a1612] text-white p-8 md:p-10 hover:bg-[#241d17] transition-colors">
                  <div className="h-10 flex items-center">
                    {pt.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={pt.logo} alt={pt.name} className={`h-9 w-auto ${pt.invert ? 'brightness-0 invert' : ''}`} loading="lazy" />
                    ) : (
                      <span className="text-2xl font-semibold tracking-tight">{pt.name}</span>
                    )}
                  </div>
                  <p className="mt-8 text-lg leading-relaxed text-stone-200">{pt.text}</p>
                  <span className="mt-auto pt-6 inline-block text-sm text-stone-300 group-hover:text-white">{pt.site} →</span>
                </a>
              </Reveal>
            ))}
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
      <section className="py-24 md:py-36 bg-cream border-t border-border-light">
        <div className={`${WIDE} grid grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,7fr)_minmax(0,4fr)] gap-14 md:gap-20`}>
          <div>
            <StatementReveal text="Help pay for the next first translation." className={`${h2} md:text-7xl max-w-3xl`} />
            <Reveal className="mt-8 max-w-xl">
              <p className={lead}>The translations are free to read, and they are kept going by the people who use and value them.</p>
              <div className="mt-10 flex flex-wrap gap-3">
                <Link href="/support" className="px-6 py-3 bg-[#1a1612] text-white hover:bg-black transition-colors font-medium">Support the project</Link>
                <Link href="/articles/vision" className="px-6 py-3 border border-border-medium text-primary hover:bg-black/[0.04] transition-colors font-medium">Read the vision</Link>
              </div>
            </Reveal>
          </div>
          <nav aria-label="More about Source Library" className="md:pt-3">
            <ul className="divide-y divide-border-light border-y border-border-light">
              {[['/', 'Browse the library'] as [string, string], ...MORE_LINKS].map(([href, label]) => (
                <li key={href}>
                  <Link href={href} className="flex justify-between py-3.5 text-primary hover:text-accent-rust transition-colors">
                    {label} <span aria-hidden="true">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </section>
    </ContentPageLayout>
    </VariantProvider>
  );
}
