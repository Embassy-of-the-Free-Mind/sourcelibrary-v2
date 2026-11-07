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
import AboutSchema from '@/components/seo/AboutSchema';
import { PAGES as FREETHINKERS } from '@/components/about/freethinkers-data';
import { WonderFigure, SoulFigure } from '@/components/about/MarkedFigures';
import { getSiteStats } from '@/lib/site-stats';
import { ABOUT_NUMBER_LOCALE, ABOUT_STRINGS, type AboutStrings } from '@/lib/about-i18n';
import { localePath, type Locale } from '@/lib/locale-path';

// The page is told in scenes. Most fill the screen and each has one piece of
// motion that plays when it arrives and resets when it leaves; nothing is tied
// to scroll position. The old Renaissance gets one scene; the rest is about
// what becomes possible now.
// Same container as the hero and the site header; text keeps its own max widths.
const WIDE = 'mx-auto w-full max-w-[var(--container-wide)] px-6 md:px-12';
const SCENE = 'min-h-[100svh] flex flex-col justify-center py-24 md:py-32';
const h2 = 'font-serif text-4xl md:text-6xl text-primary leading-[1.05] tracking-tight';
const h3 = 'font-serif text-[26px] md:text-5xl text-primary leading-[1.08] tracking-tight';
const lead = 'text-lg md:text-xl text-secondary leading-relaxed';
const body = 'text-lg text-secondary leading-relaxed';
const cardBody = 'text-base md:text-lg text-secondary leading-relaxed';

// Links as in the articles (.claude/docs/article-rules.md): body colour, thin
// gold underline that darkens on hover. No red text.
const link = 'underline decoration-1 underline-offset-[0.2em] decoration-accent-gold/70 hover:decoration-primary transition-colors';

// Facts checked 2026-10-19 against embassyofthefreemind.com (/collection,
// /governance-team, /research). The BPH is on UNESCO's DUTCH Memory of the
// World register (2022), not the international one; Dijstelberge's title is
// Librarian.
// Partners. Facts: Wisdom Frontiers (La Jolla, California) is the US society
// behind the project's research (/research: "a project of Wisdom Frontiers";
// the 2025 goal to translate the untranslated Renaissance, origin-story
// article). The Gambrell Foundation (Charlotte, NC) funds the Embassy of the
// Free Mind and Source Library (gambrellfoundation.org lists the Embassy as a
// case study). Frond and Folium copy is Laura's (2026-10-27).
const PARTNERS: { name: string; href: string; site: string; logo?: string; invert?: boolean }[] = [
  {
    name: 'Wisdom Frontiers',
    href: 'https://wisdomfrontiers.org',
    site: 'wisdomfrontiers.org',
    logo: '/ai-partners/wisdom-frontiers-white.svg',
  },
  {
    name: 'Gambrell Foundation',
    href: 'https://gambrellfoundation.org',
    site: 'gambrellfoundation.org',
    logo: '/ai-partners/gambrell-foundation.svg',
    invert: true,
  },
  {
    name: 'Frond Studio',
    href: 'https://frond-studio.com',
    site: 'frond-studio.com',
    logo: '/ai-partners/frond-studio-white.png',
  },
  {
    name: 'Folium',
    href: 'https://folium-studio.com',
    site: 'folium-studio.com',
    logo: '/ai-partners/folium-white.png',
  },
];

function StepList({ t, lang, mark = false }: { t: AboutStrings['how']; lang: Locale; mark?: boolean }) {
  const steps: { title: string; body: ReactNode }[] = [
    ...t.steps,
    {
      title: t.share.title,
      body: (
        <span>
          {t.share.pre}
          <a href="https://zenodo.org" target="_blank" rel="noopener noreferrer" className={link}>{t.share.cited}</a>{t.share.mid}
          <Link href={localePath('/developers', lang)} className={link}>{t.share.use}</Link>{t.share.post}
        </span>
      ),
    },
  ];
  return (
    <ol className={`mt-8 space-y-5 ${mark ? 'rd-mark' : ''}`}>
      {steps.map((st, i) => (
        <li key={st.title} data-i={i} className="rd-step">
          <h3 className="text-lg font-semibold text-primary">{st.title}</h3>
          <p className="mt-1 text-secondary leading-relaxed">{st.body}</p>
        </li>
      ))}
    </ol>
  );
}

function BookPair({ t, first, second }: { t: AboutStrings['once']; first: ReactNode; second: ReactNode }) {
  return (
    <>
      <Reveal className="mt-24 md:mt-32 max-w-4xl">
        <h3 className={h3}>{t.pairFirst}</h3>
      </Reveal>
      <div className="mt-12 md:mt-16">{first}</div>
      <Reveal className="mt-24 md:mt-32 max-w-4xl">
        <h3 className={h3}>{t.pairSecond}</h3>
      </Reveal>
      <div className="mt-12 md:mt-16">{second}</div>
    </>
  );
}

function Second({ title, body }: { title: string; body: string }) {
  return (
    <>
      <h2 className="font-serif text-4xl md:text-6xl text-white leading-[1.05] tracking-tight">{title}</h2>
      <p className="mt-6 text-lg md:text-xl text-stone-200 leading-relaxed max-w-xl">
        {body}
      </p>
    </>
  );
}

export default async function AboutView({ lang = 'en' }: { lang?: Locale }) {
  const t = ABOUT_STRINGS[lang];
  const lp = (href: string) => localePath(href, lang);
  const stats = await getSiteStats();
  const nf = new Intl.NumberFormat(ABOUT_NUMBER_LOCALE[lang], { useGrouping: 'always' });
  const fmt = (n: number) => nf.format(n);

  // Number colours follow the site's badge colours where one fits (green =
  // translated, yellow = first translation).
  const headlineStats: HeroStat[] = [
    { value: fmt(stats.totalBooks), label: t.stats.digitised, href: lp('/search'), color: '#60a5fa' },
    // stats.languageCount is now an honest distinct-language count: compound
    // labels are split into atomic languages and variants/junk are dropped
    // (scripts/lib/language-count.mjs). ~105 as of 2026-06-26, so 100+ is a
    // defensible floor.
    { value: '100+', label: t.stats.languages, color: '#c4b5fd' },
    { value: fmt(stats.readableInEnglish), label: t.stats.readable, href: lp('/search?has_translation=true'), color: '#4ade80' },
    { value: fmt(stats.firstTranslationCount), label: t.stats.first, href: lp('/search?first_translation=true'), color: '#facc15' },
    { value: fmt(stats.illustrationCount), label: t.stats.illustrations, href: lp('/gallery'), color: '#fb923c' },
  ];

  return (
    <div lang={lang === 'en' ? undefined : lang}>
    <AboutSchema lang={lang} />
    <ContentPageLayout
      header={
        <>
          <SiteHeader variant="light" />
          {/* Hero = what we are doing (the mission); second panel = the
              situation it answers. The titles are written to run on. */}
          <HeroWall
            stats={headlineStats}
            secondTone="dark"
            title={<>{t.heroTitle}</>}
            intro={<>{t.heroIntro}</>}
            second={
              <div className="max-w-2xl md:bg-transparent bg-[#1a1612]/85 p-5 md:p-0 -mx-1 md:mx-0">
                <Second title={t.secondTitle} body={t.secondBody} />
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
            <WrittenPastChart palette="hues" titleClass={`${h3} max-w-5xl`} t={t.chart} lang={lang} />
            <details className="group mt-6 text-sm text-muted">
              <summary className="inline-flex items-center gap-1.5 cursor-pointer list-none select-none hover:text-primary [&::-webkit-details-marker]:hidden">
                {t.sources.summary}
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" className="transition-transform group-open:rotate-180"><path d="M1.5 3.5 5 7l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
              </summary>
              <p className="mt-3 text-xs leading-relaxed max-w-4xl">
              {t.sources.body}{' '}
              <Link href={lp('/research/translation-gap')} className={link}>{t.sources.link}</Link>
              </p>
            </details>
          </Reveal>
        </div>
      </section>

      {/* It happened once */}
      <section className="py-24 md:py-36 bg-[var(--bg-warm)]">
        <div className={WIDE}>
          <Reveal className="max-w-4xl">
            <h2 className={h2}>{t.once.title}</h2>
            <p className={`mt-8 ${lead}`}>
              {t.once.lead}
            </p>
          </Reveal>
          {/* The two pages, tried as pairs: what Ficino gave back, then what is still waiting. */}
          {/* Laura, 2026-11-05: Plato (Theaetetus) to open, Ficino's Platonic Theology to close. */}
          <BookPair t={t.once} first={<WonderFigure t={t.wonder} readEnglish={t.readEnglish} />} second={<SoulFigure t={t.soul} readEnglish={t.readEnglish} />} />
        </div>
      </section>

      {/* A new Renaissance: what the library is for, for people. The next
          section is what it gives AI; the ones after come back to people. */}
      <section className="py-28 md:py-40">
        <div className={WIDE}>
          <Reveal className="max-w-5xl">
            <h2 className={h2}>{t.renaissance.title}</h2>
          </Reveal>
          <div className="mt-16 md:mt-24 grid grid-cols-[minmax(0,1fr)] md:grid-cols-2 gap-6">
            <Reveal className="bg-[var(--bg-warm)] border border-border-light p-6 md:p-10">
              <p className="text-sm font-semibold text-muted">{t.renaissance.then}</p>
              <p className="mt-4 font-serif text-xl md:text-4xl text-primary leading-snug md:leading-tight">{t.renaissance.thenTitle}</p>
              <p className={`mt-3 md:mt-5 ${cardBody}`}>{t.renaissance.thenBody}</p>
            </Reveal>
            <Reveal delay={150} className="bg-[var(--bg-warm)] border border-border-light p-6 md:p-10">
              <p className="text-sm font-semibold text-muted">{t.renaissance.now}</p>
              <p className="mt-4 font-serif text-xl md:text-4xl text-primary leading-snug md:leading-tight">{t.renaissance.nowTitle}</p>
              <p className={`mt-3 md:mt-5 ${cardBody}`}>{t.renaissance.nowBody}</p>
            </Reveal>
          </div>
          <Reveal className="mt-20 md:mt-28 max-w-4xl">
            <h3 className={h3}>{t.renaissance.audienceTitle}</h3>
          </Reveal>
          <ul className="mt-12 grid grid-cols-[minmax(0,1fr)] sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {t.renaissance.audiences.map(([name, d], i) => (
              <li key={name} className="grid">
                <Reveal delay={i * 100} className="bg-[var(--bg-warm)] border border-border-light p-6 md:p-10">
                  <h4 className="font-serif text-xl md:text-2xl text-primary">{name}</h4>
                  <p className={`mt-2 md:mt-3 ${cardBody}`}>{d}</p>
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
                    <h2 className={h2}>{t.ai.titleStart}{' '}<br className="hidden md:inline" />{t.ai.titleEnd}</h2>
                  </Reveal>
                  <Reveal delay={120} className="mt-8 md:mt-10 max-w-2xl">
                    <p className={lead}>{t.ai.lead}</p>
                  </Reveal>
                </div>
                <Reveal className="mt-14 md:mt-20">
                  <h3 className="text-lg font-semibold text-primary">{t.ai.shelf}</h3>
                </Reveal>
                {/* Two-row subgrid: every page sits on the same bottom line, captions hang below it. */}
                <ul className="mt-8 grid grid-flow-col grid-rows-[auto_auto] auto-cols-[10rem] md:auto-cols-[12rem] lg:auto-cols-fr gap-x-5 md:gap-x-6 overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden pb-4 -mx-6 px-6 md:-mx-12 md:px-12 lg:mx-0 lg:px-0">
                  {FREETHINKERS.map((p, i) => (
                    <Reveal as="li" key={p.src} delay={i * 80} className="row-span-2 grid grid-rows-subgrid">
                      <Link href={lp(p.href)} className="group self-end block">
                        <Pic src={p.src} alt={t.ai.books[i].alt} width={p.w} height={p.h} className="block w-full h-auto shadow-[0_1px_0_rgba(0,0,0,.08),0_8px_24px_-12px_rgba(0,0,0,.35)] transition-transform duration-500 group-hover:-translate-y-1" />
                      </Link>
                      <Link href={lp(p.href)} className="block pt-4">
                        <span className="block text-sm text-muted tabular-nums">{p.year}{p.lang ? ` · ${t.ai.books[i].lang}` : ''}</span>
                        <span className="block mt-1 font-serif text-lg text-primary leading-snug">{p.title ?? p.who}</span>
                        {p.title && <span className="block text-sm font-medium text-primary">{p.who}</span>}
                        <span className="block mt-2 text-sm text-secondary leading-snug">{t.ai.books[i].what}</span>
                      </Link>
                    </Reveal>
                  ))}
                </ul>
                              </div>
            </section>

      {/* What we do: a real page read in front of you */}
      <section className="py-24 md:py-32">
        <div className={WIDE}>
          <ReadingDemo t={t.demo}>
            <h2 className={h2}>{t.how.title}</h2>
            <StepList t={t.how} lang={lang} mark />
          </ReadingDemo>
        </div>
      </section>

      {/* Every day, another first */}
      <section className={`${SCENE} bg-[var(--bg-warm)]`}>
        <div className={WIDE}>
          <Reveal>
            <h3 className={`${h3} max-w-4xl text-balance`}>{t.counters.title}</h3>
          </Reveal>
          <Reveal className="mt-8 max-w-2xl">
            <p className={lead}>
              {t.counters.lead}
            </p>
          </Reveal>
          <div className="mt-14 md:mt-16">
            <CountersVis mode="bars" stats={stats} t={t.counters} lang={lang} />
          </div>
        </div>
      </section>

      {/* Who */}
      <section className="py-24 md:py-32">
        <div className={WIDE}>
          <Reveal>
            <h2 className={h2}>{t.who.title}</h2>
          </Reveal>
          <div className="mt-14 md:mt-16 grid grid-cols-[minmax(0,1fr)] md:grid-cols-2 gap-x-6 gap-y-12 items-start">
            <Reveal>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/vision/embassy.jpg" alt={t.who.embassyAlt} width={600} height={800} className="block w-full aspect-[4/3] object-cover" loading="lazy" />
              <h3 className="mt-6 font-serif text-2xl text-primary">{t.who.embassyTitle}</h3>
              <p className={`mt-3 ${body} max-w-xl`}>
                {t.who.embassyPre}
                <a href="https://embassyofthefreemind.com" target="_blank" rel="noopener noreferrer" className={link}>{t.who.embassyLink}</a>
                {t.who.embassyMid}
                <a href="https://www.guinnessworldrecords.com/world-records/777560-largest-library-dedicated-to-magic-and-mysticism" target="_blank" rel="noopener noreferrer" className={link}>{t.who.guinness}</a>
                {t.who.embassyPost}
              </p>
            </Reveal>
            <Reveal delay={150}>
              <Pic src="/about/derek-ficino.jpg" alt={t.who.derekAlt} width={687} height={629} className="block w-full aspect-[4/3] object-cover object-top" />
              <h3 className="mt-6 font-serif text-2xl text-primary">{t.who.derekTitle}</h3>
              <p className={`mt-3 ${body} max-w-xl`}>
                {t.who.derekPre}<em>Liber de Voluptate</em>{t.who.derekMid}
                <Link href={lp('/articles/vision')} className={link}>{t.who.derekLink}</Link>{t.who.derekPost}
              </p>
            </Reveal>
          </div>
          <Reveal className="mt-20 md:mt-28">
            <h3 className={h3}>{t.who.partnersTitle}</h3>
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
                  <p className="mt-8 text-lg leading-relaxed text-secondary">{t.who.partners[i]}</p>
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
            <StatementReveal text={t.join.title} className={`${h2} max-w-3xl`} />
            <Reveal className="mt-8 max-w-xl">
              <p className={lead}>{t.join.body}</p>
              <div className="mt-10 flex flex-wrap gap-3">
                <Link href={lp('/support')} className="px-6 py-3 bg-[#1a1612] text-white hover:bg-black transition-colors font-medium">{t.join.donate}</Link>
                <Link href={lp('/articles/vision')} className="px-6 py-3 border border-border-medium text-primary hover:bg-black/[0.04] transition-colors font-medium">{t.join.vision}</Link>
              </div>
            </Reveal>
          </div>
          <nav aria-label={t.join.more} className="md:pt-3">
            <ul className="divide-y divide-border-light border-y border-border-light">
              {([['/', t.join.browse], ['/about/faq', t.join.faq], ['/developers', t.join.api]] as [string, string][]).map(([href, label]) => (
                <li key={href}>
                  <Link href={lp(href)} className="flex justify-between py-3.5 text-primary hover:underline underline-offset-4 transition-colors">
                    {label} <span aria-hidden="true">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </section>
    </ContentPageLayout>
    </div>
  );
}
