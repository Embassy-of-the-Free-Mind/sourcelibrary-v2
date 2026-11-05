import { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import ContentPageLayout from '@/components/layout/ContentPageLayout';
import SiteHeader from '@/components/layout/SiteHeader';
import HeroWall, { type HeroStat } from '@/components/about/HeroWall';
import StatementReveal from '@/components/about/StatementReveal';
import CountersVis from '@/components/about/CountersVis';
import WrittenPastChart from '@/components/about/WrittenPastChart';
import ReadingDemo from '@/components/about/ReadingDemo';
import Reveal from '@/components/about/Reveal';
import Pic from '@/components/about/Pic';
import { PAGES as FREETHINKERS } from '@/components/about/freethinkers-data';
import { WonderFigure, SoulFigure } from '@/components/about/MarkedFigures';
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
// Same container as the hero and the site header; text keeps its own max widths.
const WIDE = 'mx-auto w-full max-w-[var(--container-wide)] px-6 md:px-12';
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
const MORE_LINKS: [string, string][] = [
  // Trimmed 2026-11-05 while the other pages are being revised (old numbers):
  // /how-it-works, /census, /about/progress, /about/sources. Add back once updated.
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
    text: 'Folium builds digital libraries for other libraries, museums and archives on the same system as Source Library: every page transcribed, translated and tagged, and published under the institution’s own name. The Embassy’s own catalogue already runs on it.',
  },
];

const STEPS: { title: string; body: ReactNode }[] = [
  { title: 'Scan', body: 'We scan books at the Embassy of the Free Mind and bring in scans from libraries worldwide.' },
  { title: 'Transcribe', body: 'AI reads each page and types it out, old print and handwriting included.' },
  { title: 'Translate', body: 'Each page is translated into English and set beside the original, so anyone can check every line.' },
  { title: 'Tag', body: 'Names, places, ideas and pictures are tagged, so you can search inside the books.' },
  {
    title: 'Share',
    body: (
      <span>
        Every translation can be{' '}
        <a href="https://zenodo.org" target="_blank" rel="noopener noreferrer" className={link}>cited</a>, and other software and AI tools can{' '}
        <Link href="/developers" className={link}>use it</Link>.
      </span>
    ),
  },
];

// What the library is for, for people. Each line is something it does today,
// not a promise.
const AUDIENCES: [string, string][] = [
  ['Students', 'Read the books behind the textbooks, in English.'],
  ['Scholars', 'Search inside thousands of books at once, and cite the page.'],
  ['Writers and artists', 'Find images, ideas and stories in books few people have been able to read.'],
  ['Anyone curious', 'Browse, search and ask questions across thousands of old books.'],
];

function StepList({ mark = false }: { mark?: boolean }) {
  return (
    <ol className={`mt-8 space-y-5 ${mark ? 'rd-mark' : ''}`}>
      {STEPS.map((st, i) => (
        <li key={st.title} data-i={i} className="rd-step">
          <h3 className="text-lg font-semibold text-primary">{st.title}</h3>
          <p className="mt-1 text-secondary leading-relaxed">{st.body}</p>
        </li>
      ))}
    </ol>
  );
}

function BookPair({ first, second }: { first: ReactNode; second: ReactNode }) {
  return (
    <>
      <Reveal className="mt-24 md:mt-32 max-w-4xl">
        <h3 className={h3}>Ficino gave Europe back Plato, Socrates and Hermes.</h3>
      </Reveal>
      <div className="mt-12 md:mt-16">{first}</div>
      <Reveal className="mt-24 md:mt-32 max-w-4xl">
        <h3 className={h3}>Ficino&apos;s own masterpiece waited more than 500 years for English. Millions of other books are still waiting.</h3>
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
            intro={<>Source Library gathers old books and manuscripts from around the world and translates them, so anyone can read them.</>}
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
      <section className={SCENE}>
        <div className={WIDE}>
          {/* The heading changes with each step of the chart. */}
          <Reveal>
            <WrittenPastChart palette="hues" titleClass={`${h3} max-w-5xl`} />
            <details className="group mt-6 text-sm text-muted">
              <summary className="inline-flex items-center gap-1.5 cursor-pointer list-none select-none hover:text-primary [&::-webkit-details-marker]:hidden">
                Sources and method
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="transition-transform group-open:rotate-180"><path d="M1.5 3.5 5 7l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
              </summary>
              <p className="mt-3 text-xs leading-relaxed max-w-4xl">
              Europe: distinct works printed before 1700 in the Universal Short Title Catalogue, matched against 30 translation catalogues (May 2026). Tibetan: works in the BDRC catalogue. Arabic (including Persian and Ottoman Turkish, written in Arabic script) and Indian languages: estimated surviving manuscripts, counted in handwritten copies, not works. Chinese: 200,000 titles and 500,000 editions catalogued to 1912, a floor. Still uncounted: Japanese, Korean, Persian, Hebrew, Armenian, Ethiopian, Byzantine Greek and medieval Latin manuscripts.{' '}
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
            <h2 className={h2}>Translation once changed art, science and how people thought, in a revolution known as the Renaissance.</h2>
            <p className={`mt-8 ${lead}`}>
              In the 1460s Cosimo de&apos; Medici, the most powerful man in Florence, backed Marsilio Ficino to translate Plato and the Hermetic writings from Greek into Latin. Ideas Western Europe had only known second-hand were suddenly in the hands of its scholars, artists and physicians. Renaissance means rebirth: old knowledge, readable again.
            </p>
          </Reveal>
          {/* The two pages, tried as pairs: what Ficino gave back, then what is still waiting. */}
          {/* Laura, 2026-11-05: Plato (Theaetetus) to open, Ficino's Platonic Theology to close. */}
          <BookPair first={<WonderFigure />} second={<SoulFigure />} />
        </div>
      </section>

      {/* A new Renaissance: what the library is for, for people. The next
          section is what it gives AI; the ones after come back to people. */}
      <section className="py-28 md:py-40">
        <div className={WIDE}>
          <Reveal className="max-w-5xl">
            <h2 className={`${h2} md:text-7xl`}>We think it is time for another Renaissance, and we want to help start it</h2>
          </Reveal>
          <div className="mt-16 md:mt-24 grid grid-cols-[minmax(0,1fr)] md:grid-cols-2 gap-6">
            <Reveal className="bg-[var(--bg-warm)] border border-border-light p-8 md:p-10">
              <p className="text-sm font-semibold text-muted">Then</p>
              <p className="mt-4 font-serif text-3xl md:text-4xl text-primary leading-tight">One translator, one patron, a lifetime of work.</p>
              <p className={`mt-5 ${body}`}>Ficino spent much of his life putting Plato and Plotinus into Latin, and his translations helped shape the Renaissance.</p>
            </Reveal>
            <Reveal delay={150} className="bg-[var(--bg-warm)] border border-border-light p-8 md:p-10">
              <p className="text-sm font-semibold text-muted">Now</p>
              <p className="mt-4 font-serif text-3xl md:text-4xl text-primary leading-tight">Whole libraries, open to anyone who wants to read them.</p>
              <p className={`mt-5 ${body}`}>With help from AI, every page from every tradition can get a careful first translation, in a fraction of the time.</p>
            </Reveal>
          </div>
          <Reveal className="mt-20 md:mt-28 max-w-4xl">
            <h3 className={h3}>So the written past can be read by everyone it belongs to</h3>
          </Reveal>
          <ul className="mt-12 grid grid-cols-[minmax(0,1fr)] sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {AUDIENCES.map(([t, d], i) => (
              <li key={t} className="grid">
                <Reveal delay={i * 100} className="bg-[var(--bg-warm)] border border-border-light p-8 md:p-10">
                  <h4 className="font-serif text-2xl text-primary">{t}</h4>
                  <p className={`mt-3 ${body}`}>{d}</p>
                </Reveal>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* AI and the freethinkers */}
            <section className="py-24 md:py-32 bg-[var(--bg-warm)]">
              <div className={WIDE}>
                <div className="max-w-4xl">
                  <Reveal>
                    <h2 className={h2}>AI has read Reddit,{' '}<br className="hidden md:inline" />but not the freethinkers</h2>
                  </Reveal>
                  <Reveal delay={120} className="mt-8 md:mt-10 max-w-2xl">
                    <p className={lead}>AI is fast becoming how people look things up and think things through, but it learned from the open web. The thinkers who changed how we see the heavens, nature and the body are mostly missing, because their books were never scanned, translated or put online. We are translating them so AI can learn from them too.</p>
                  </Reveal>
                </div>
                <Reveal className="mt-14 md:mt-20">
                  <h3 className="text-lg font-semibold text-primary">First complete English translations, all by Source Library</h3>
                </Reveal>
                {/* Two-row subgrid: every page sits on the same bottom line, captions hang below it. */}
                <ul className="mt-8 grid grid-flow-col grid-rows-[auto_auto] auto-cols-[10rem] md:auto-cols-[12rem] lg:auto-cols-fr gap-x-5 md:gap-x-6 overflow-x-auto pb-4 -mx-6 px-6 md:-mx-12 md:px-12 lg:mx-0 lg:px-0 snap-x scroll-px-6 md:scroll-px-12 lg:scroll-px-0">
                  {FREETHINKERS.map((p, i) => (
                    <Reveal as="li" key={p.src} delay={i * 80} className="row-span-2 grid grid-rows-subgrid snap-start">
                      <Link href={p.href} className="group self-end block">
                        <Pic src={p.src} alt={p.alt} width={p.w} height={p.h} className="block w-full h-auto shadow-[0_1px_0_rgba(0,0,0,.08),0_8px_24px_-12px_rgba(0,0,0,.35)] transition-transform duration-500 group-hover:-translate-y-1" />
                      </Link>
                      <Link href={p.href} className="block pt-4">
                        <span className="block text-sm text-muted tabular-nums">{p.year}{p.lang ? ` · ${p.lang}` : ''}</span>
                        <span className="block mt-1 font-serif text-lg text-primary leading-snug">{p.title ?? p.who}</span>
                        {p.title && <span className="block text-sm font-medium text-primary">{p.who}</span>}
                        <span className="block mt-2 text-sm text-secondary leading-snug">{p.what}</span>
                      </Link>
                    </Reveal>
                  ))}
                </ul>
                              </div>
            </section>

      {/* What we do: a real page read in front of you */}
      <section className="py-24 md:py-32">
        <div className={WIDE}>
          <ReadingDemo>
            <h2 className={h2}>How a page becomes readable</h2>
            <StepList mark />
          </ReadingDemo>
        </div>
      </section>

      {/* Every day, another first */}
      <section className={`${SCENE} bg-[var(--bg-warm)]`}>
        <div className={WIDE}>
          <Reveal>
            <h3 className={`${h3} max-w-4xl text-balance`}>So far, we have translated thousands of books into English for the first time</h3>
          </Reveal>
          <Reveal className="mt-8 max-w-2xl">
            <p className={lead}>
              For comparison, Harvard&apos;s I Tatti Renaissance Library, one of the most ambitious translation series of our time, has published about 100 volumes since 2001.
            </p>
          </Reveal>
          <div className="mt-14 md:mt-16">
            <CountersVis mode="bars" stats={stats} />
          </div>
        </div>
      </section>

      {/* Who */}
      <section className="py-24 md:py-32">
        <div className={WIDE}>
          <Reveal>
            <h2 className={h2}>Started at the Embassy of the Free Mind in Amsterdam</h2>
          </Reveal>
          <div className="mt-14 md:mt-16 grid grid-cols-[minmax(0,1fr)] md:grid-cols-2 gap-x-6 gap-y-12 items-start">
            <Reveal>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/vision/embassy.jpg" alt="The Embassy of the Free Mind in the Huis met de Hoofden, Keizersgracht, Amsterdam" width={600} height={800} className="block w-full aspect-[4/3] object-cover" loading="lazy" />
              <h3 className="mt-6 font-serif text-2xl text-primary">The Embassy of the Free Mind</h3>
              <p className={`mt-3 ${body} max-w-xl`}>
                The{' '}
                <a href="https://embassyofthefreemind.com" target="_blank" rel="noopener noreferrer" className={link}>Embassy</a>{' '}
                is home to the Bibliotheca Philosophica Hermetica: over 28,000 volumes on Hermetic philosophy, alchemy, mysticism and religion, on UNESCO&apos;s Dutch Memory of the World Register and holder of the{' '}
                <a href="https://www.guinnessworldrecords.com/world-records/777560-largest-library-dedicated-to-magic-and-mysticism" target="_blank" rel="noopener noreferrer" className={link}>Guinness World Record</a>{' '}
                for the largest library dedicated to magic and mysticism. Librarian Paul Dijstelberge and senior researcher Carlos Gilly guide our work with the collection.
              </p>
            </Reveal>
            <Reveal delay={150}>
              <Pic src="/about/derek-ficino.jpg" alt="Derek Lomas standing beside a bronze bust of Marsilio Ficino at the Embassy of the Free Mind" width={687} height={629} className="block w-full aspect-[4/3] object-cover object-top" />
              <h3 className="mt-6 font-serif text-2xl text-primary">Derek Lomas, founder</h3>
              <p className={`mt-3 ${body} max-w-xl`}>
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
                <a href={pt.href} target="_blank" rel="noopener noreferrer" className="group flex flex-col h-full bg-[var(--bg-warm)] border border-border-light text-primary p-8 md:p-10 hover:border-border-medium transition-colors">
                  <div className="h-10 flex items-center">
                    {pt.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={pt.logo} alt={pt.name} className="h-9 w-auto brightness-0" loading="lazy" />
                    ) : (
                      <span className="text-2xl font-semibold tracking-tight">{pt.name}</span>
                    )}
                  </div>
                  <p className="mt-8 text-lg leading-relaxed text-secondary">{pt.text}</p>
                  <span className="mt-auto pt-6 inline-block text-sm text-muted group-hover:text-primary">{pt.site} →</span>
                </a>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Join */}
      <section className="py-24 md:py-36 bg-cream border-t border-border-light">
        <div className={`${WIDE} grid grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,7fr)_minmax(0,4fr)] gap-14 md:gap-20`}>
          <div>
            <StatementReveal text="Help fund the next first translation." className={`${h2} md:text-7xl max-w-3xl`} />
            <Reveal className="mt-8 max-w-xl">
              <p className={lead}>The translations are free to read. Gifts pay for scanning fragile books, translating them and keeping the library online.</p>
              <div className="mt-10 flex flex-wrap gap-3">
                <Link href="/support" className="px-6 py-3 bg-[#1a1612] text-white hover:bg-black transition-colors font-medium">Donate</Link>
                <Link href="/articles/vision" className="px-6 py-3 border border-border-medium text-primary hover:bg-black/[0.04] transition-colors font-medium">Read the vision</Link>
              </div>
            </Reveal>
          </div>
          <nav aria-label="More about Source Library" className="md:pt-3">
            <ul className="divide-y divide-border-light border-y border-border-light">
              {[['/', 'Browse the library'] as [string, string], ...MORE_LINKS].map(([href, label]) => (
                <li key={href}>
                  <Link href={href} className="flex justify-between py-3.5 text-primary hover:underline underline-offset-4 transition-colors">
                    {label} <span aria-hidden="true">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </section>
    </ContentPageLayout>
  );
}
