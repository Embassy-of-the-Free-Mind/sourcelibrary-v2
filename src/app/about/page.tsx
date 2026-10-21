import { Metadata } from 'next';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import ContentPageLayout from '@/components/layout/ContentPageLayout';
import SiteHeader from '@/components/layout/SiteHeader';
import AboutHero, { type HeroStat } from '@/components/about/AboutHero';
import WrittenPastChart from '@/components/about/WrittenPastChart';
import TranslatedShare from '@/components/about/TranslatedShare';
import ReadingDemo from '@/components/about/ReadingDemo';
import Reveal from '@/components/about/Reveal';
import { PrefaceFigure, ChainFigure } from '@/components/about/PimanderFigures';
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

// The page is one long read with a single grammar: text in one reading column
// (COL), pictures and charts breaking out wider (WIDE), and a large statement
// between chapters. Things animate only as they come into and out of view.
const COL = 'mx-auto w-full max-w-[42rem] px-6';
const WIDE = 'mx-auto w-full max-w-6xl px-6 md:px-10';
const CHAPTER = 'py-20 md:py-28';
const h2 = 'font-serif text-4xl md:text-5xl text-primary leading-[1.1] tracking-tight';
const lead = 'text-xl md:text-2xl text-primary leading-snug';
const body = 'text-lg text-secondary leading-relaxed';
const caption = 'text-sm text-muted leading-relaxed';
const statement = 'font-serif text-4xl md:text-6xl text-primary leading-[1.08] tracking-tight';
// In a justified row each picture's share of the width follows its proportions,
// so every picture in the row ends up the same height. Phones stack them.
const JUSTIFIED = 'min-w-0 sm:[flex:var(--ar)_1_0%]';
const ar = (w: number, h: number) => ({ '--ar': w / h }) as CSSProperties;

// Links as in the articles (.claude/docs/article-rules.md): body colour, thin
// gold underline that darkens on hover. No red text.
const link = 'underline decoration-1 underline-offset-[0.2em] decoration-accent-gold/70 hover:decoration-primary transition-colors';

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

const PLOTINUS_TITLE = '/book/plotinus-enneads-xxvii-liv-ficino-translation-translator/page/69b43d3706b196d69f66f5bd';

// What the recovered classics led to, each shown with a page from a copy in
// the library. Dates and claims: Euclid editio princeps (Ratdolt, Venice 1482);
// Ptolemy's Geography put into Latin by Jacopo Angeli, 1406, printed at Ulm
// 1482; Copernicus cites Trismegistus in De revolutionibus I.10; the Aldine
// Greek Galen appeared in 1525.
type Turn = { year: string; title: ReactNode; line: string; src: string; w: number; h: number; href: string; alt: string };
const TURNS: Turn[][] = [
  [
    { year: '1482', title: <>Euclid, <em>Elements</em></>, line: 'Greek geometry in print for the first time. Schools taught from it for four hundred years.', src: '/about/renaissance/euclid.jpg', w: 900, h: 1296, href: '/book/elements-euclid/page/694f45b610e4f9487722ec45', alt: 'The opening page of Euclid printed in Venice in 1482, with geometric figures in the margin' },
    { year: '1482', title: <>Ptolemy, <em>Geography</em></>, line: 'Put into Latin in 1406. Its maps changed how Europe pictured the world.', src: '/about/renaissance/ptolemy.jpg', w: 1400, h: 1055, href: '/book/clavdii-ptholomei-viri-alexandrini-cosmographie-beatissimo-nicolaus/page/69b631cc1c1c21a37380aeb8', alt: "Hand-coloured map of Italy from Ptolemy's Geography, Ulm 1482" },
    { year: '1543', title: <>Copernicus, <em>On the Revolutions</em></>, line: 'The sun at the centre, with Hermes Trismegistus quoted in support.', src: '/about/renaissance/copernicus.jpg', w: 900, h: 1252, href: '/book/de-revolutionibus-1543-first-edition-copernicus/page/695004fcf426a210d109b9b2', alt: "Copernicus's diagram of the planets circling the sun" },
  ],
  [
    { year: '1543', title: <>Vesalius, <em>On the Fabric of the Human Body</em></>, line: 'Anatomy from dissection, correcting Galen, whose Greek had just been printed.', src: '/about/renaissance/vesalius.jpg', w: 900, h: 1274, href: '/book/de-humani-corporis-fabrica-1543-first-edition-vesalius/page/6953e55777f38f6761bf0698', alt: 'The first muscle man, a flayed figure standing in a landscape' },
    { year: '1596', title: <>Kepler, <em>The Cosmic Mystery</em></>, line: "The planets' orbits fitted between Plato's five solids.", src: '/about/renaissance/kepler.jpg', w: 900, h: 1165, href: '/book/mysterium-cosmographicum-1596-first-edition-kepler/page/695004e8f426a210d109a8c1', alt: "Kepler's model of nested Platonic solids inside the planetary spheres" },
    { year: '1610', title: <>Galileo, <em>The Starry Messenger</em></>, line: 'The moon seen through a telescope, mountains and all.', src: '/about/renaissance/galileo.jpg', w: 900, h: 1195, href: '/book/sidereus-nuncius-1610-venice-galilei/page/695004dbf426a210d109a2fa', alt: "Galileo's drawing of the moon's surface" },
  ],
];

// "What is mind?" answered from four traditions, each a quote link to its page.
const MIND: [string, string, string][] = [
  ['/q/BhIfljO2ApigrcHcTeD', 'Plato', 'Greek'],
  ['/q/BgRsFohtofMtBqdNmop', 'Śaṅkara', 'Sanskrit'],
  ['/q/BijCMw143jlgk5jBxGl', 'A Tibetan master', 'pointing-out instructions'],
  ['/q/Bojb0GnS1vOWqoRET4E', 'Xunzi', 'Chinese'],
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
      {/* 1. How translation started the Renaissance */}
      <section className={CHAPTER}>
        <Reveal className={COL}>
          <h2 className={h2}>How translation started the Renaissance</h2>
          <p className={`mt-8 ${lead}`}>
            In 1438 almost nobody in western Europe could read Plato. Fifty years later all of him was in print. It began with a banker, a doctor&apos;s son and a manuscript from Macedonia.
          </p>
          <p className={`mt-6 ${body}`}>
            That year the leaders of the Greek and Latin churches met in Florence to try to reunite them. With the Greeks came the philosopher Gemistos Plethon, who lectured the Florentines on Plato, a famous name in the West but one hardly anyone could read: only a handful of his dialogues had ever been put into Latin. Ficino later wrote that Cosimo de&apos; Medici, the banker who ran the city, went to hear him again and again.
          </p>
        </Reveal>

        <div className={`${WIDE} mt-14 md:mt-20 flex flex-col sm:flex-row gap-10 sm:gap-6`}>
          <Reveal as="figure" className={JUSTIFIED} style={ar(667, 900)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/about/cosimo-pontormo.jpg" alt="Cosimo de' Medici in profile, in a red robe and cap" width={667} height={900} className="block w-full h-auto" loading="lazy" />
            <figcaption className="mt-4">
              <span className="block font-serif text-2xl text-primary">Cosimo de&apos; Medici, 1389&ndash;1464</span>
              <span className={`block mt-1 ${caption}`}>Banker, and for thirty years the man who ran Florence. Jacopo Pontormo, about 1519. Uffizi.</span>
            </figcaption>
          </Reveal>
          <Reveal as="figure" delay={150} className={JUSTIFIED} style={ar(1044, 900)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/about/ficino-ghirlandaio.jpg" alt="Four Florentine scholars in red cloaks; Ficino, smiling, is on the left" width={1044} height={900} className="block w-full h-auto" loading="lazy" />
            <figcaption className="mt-4">
              <span className="block font-serif text-2xl text-primary">Marsilio Ficino, 1433&ndash;1499</span>
              <span className={`block mt-1 ${caption}`}>Doctor, priest and translator, on the left, with Landino, Poliziano and Chalkondyles. Domenico Ghirlandaio, 1486&ndash;90. Santa Maria Novella.</span>
            </figcaption>
          </Reveal>
        </div>

        <Reveal className={`${COL} mt-14 md:mt-20`}>
          <p className={body}>
            Cosimo spent his fortune on books as well as on buildings and paintings. He paid for the library at San Marco, which opened to scholars in the 1440s, and he chose the son of his own doctor, Marsilio Ficino, to learn Greek and translate Plato. In 1462 he gave Ficino a house at Careggi and Greek manuscripts to work from.
          </p>
          <p className={`mt-6 ${body}`}>
            Then a monk, Leonardo of Pistoia, brought a Greek manuscript of the <em>Corpus Hermeticum</em> to Florence from Macedonia. Its author was thought to be Hermes Trismegistus, an Egyptian sage as old as Moses. Cosimo was old and ill, and he asked Ficino to put Plato aside and translate Hermes first. Ficino finished it in a few months, in 1463, and dedicated it to Cosimo.
          </p>
        </Reveal>

        <div className={`${WIDE} mt-14 md:mt-20`}>
          <PrefaceFigure />
        </div>

        <Reveal className={`${COL} mt-14 md:mt-20`}>
          <p className={body}>
            In that preface Ficino set out a chain of teachers running from Hermes to Plato: one ancient theology, a <em>prisca theologia</em>, behind them all. It gave the Renaissance its conviction that the oldest wisdom could be found again, if only someone would read it.
          </p>
        </Reveal>

        <div className={`${WIDE} mt-14 md:mt-20`}>
          <ChainFigure />
        </div>

        <Reveal className={`${COL} mt-14 md:mt-20`}>
          <p className={body}>
            Then he went back to Plato. All of Plato was printed in Latin in 1484, and for the next three centuries most Europeans who read Plato read Ficino&apos;s Latin. Plotinus followed in 1492, dedicated to Cosimo&apos;s grandson Lorenzo.
          </p>
          <figure className="mt-10 max-w-[340px]">
            <Link href={PLOTINUS_TITLE} className="block hover:opacity-90 transition-opacity">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/about/plotinus-lorenzo.jpg" alt="An illuminated title page in a wreath of leaves and gems, with a flame above" width={702} height={1000} className="block w-full h-auto" loading="lazy" />
            </Link>
            <figcaption className={`mt-3 ${caption}`}>
              Ficino&apos;s Plotinus, &ldquo;translated and explained for Lorenzo de&apos; Medici&rdquo;, 1490.{' '}
              <Link href={PLOTINUS_TITLE} className={link}>Read it</Link>
            </figcaption>
          </figure>
        </Reveal>
      </section>

      <Reveal className={`${WIDE} py-16 md:py-24`}>
        <p className={`${statement} max-w-5xl`}>Within a lifetime the lost classics were back in print, and Europe began to build on them.</p>
      </Reveal>

      {/* 2. What the Renaissance gave us */}
      <section className={CHAPTER}>
        <Reveal className={COL}>
          <h2 className={h2}>What the Renaissance gave us</h2>
          <p className={`mt-8 ${body}`}>
            Ficino was one of many. Scholars across Italy hunted down Greek and Latin manuscripts, translated them and sent them to the new printing presses. Going back to the original sources became a habit, and it changed how Europe measured the earth, studied the body and looked at the sky.
          </p>
        </Reveal>

        <div className={`${WIDE} mt-14 md:mt-20 space-y-14 md:space-y-16`}>
          {TURNS.map((row, r) => (
            <div key={r} className="grid grid-cols-2 sm:flex gap-x-4 gap-y-10 sm:gap-6 items-start">
              {row.map((t, k) => (
                <Reveal
                  key={t.src}
                  as="figure"
                  delay={k * 140}
                  className={`${JUSTIFIED} ${t.w > t.h ? 'col-span-2 order-last sm:order-none' : ''}`}
                  style={ar(t.w, t.h)}
                >
                  <Link href={t.href} className="group block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={t.src} alt={t.alt} width={t.w} height={t.h} className="block w-full h-auto group-hover:opacity-90 transition-opacity" loading="lazy" />
                    <figcaption className="mt-4">
                      <span className="block font-serif text-3xl text-primary tabular-nums leading-none">{t.year}</span>
                      <span className="block mt-2 font-medium text-primary">{t.title}</span>
                      <span className={`block mt-1 ${caption}`}>{t.line}</span>
                    </figcaption>
                  </Link>
                </Reveal>
              ))}
            </div>
          ))}
        </div>

        <Reveal className={`${COL} mt-14 md:mt-20`}>
          <p className={body}>
            Five centuries on, the habit is still with us: check the source, read the original. Yet most of what that age wrote has never been translated, Ficino&apos;s own books among it.
          </p>
        </Reveal>
      </section>

      {/* 3. The gap */}
      <section className={`${CHAPTER} bg-[var(--bg-warm)]`}>
        <Reveal className={COL}>
          <h2 className={h2}>How much of the written past can anyone read today?</h2>
          <p className={`mt-8 ${lead}`}>
            Very little. Start with Latin, the language of the Renaissance, then keep zooming out.
          </p>
        </Reveal>
        <Reveal className={`${WIDE} mt-14 md:mt-16`}>
          <WrittenPastChart />
          <p className="mt-6 text-xs text-muted leading-relaxed">
            Europe: distinct works printed before 1700 in the Universal Short Title Catalogue, matched against 30 translation catalogues (May 2026). Tibetan: works in the BDRC catalogue. Arabic script and India: estimated surviving manuscripts (mss.), counted in copies, not works. Chinese: 200,000 titles and 500,000 editions catalogued to 1912, a floor. Still uncounted: Japanese, Korean, Persian, Hebrew, Armenian, Ethiopian, Byzantine Greek and medieval Latin manuscripts.{' '}
            <Link href="/research/translation-gap" className={link}>How we measured it</Link>
          </p>
        </Reveal>
        <div className={`${WIDE} mt-20 md:mt-28`}>
          <TranslatedShare />
        </div>
      </section>

      <Reveal className={`${WIDE} py-24 md:py-36`}>
        <p className={`${statement} max-w-5xl`}>Rediscovering ancient wisdom helped spark the Renaissance. We think it is time for another.</p>
      </Reveal>

      {/* 4. A new Renaissance */}
      <section className={`${CHAPTER} pt-0 md:pt-0`}>
        <Reveal className={COL}>
          <h2 className={h2}>A new Renaissance</h2>
          <p className={`mt-8 ${body}`}>
            Ficino had one patron, one city and a printing press that had only just been invented, and it took him most of his life to put Plato and Plotinus into Latin. At the pace human translators work, the books in that chart would take many lifetimes.
          </p>
          <p className={`mt-6 ${body}`}>
            Machine reading and translation are now good enough to make a first pass at all of it, quickly, with the original page always beside the English so anyone can check it. So we are building the world&apos;s largest open-access collection of translated primary sources, for scholars, seekers and AI systems alike.
          </p>
          <p className={`mt-6 ${body}`}>
            These are not obscure footnotes. They are the roots of modern science, psychology and philosophy of mind, and of the old questions about what it means to be human.
          </p>
          <p className={`mt-6 ${body}`}>
            Today&apos;s AI models were trained on Reddit, not the Renaissance. Give one the actual texts, every line checkable against its scan, and it becomes a research instrument. Ask it <em className="text-primary">what is mind?</em> and it can quote:
          </p>
        </Reveal>
        <ul className={`${COL} mt-8 grid grid-cols-2 gap-3`}>
          {MIND.map(([href, who, lang], k) => (
            <Reveal as="li" key={href} delay={k * 100}>
              <Link href={href} className="group block h-full border border-border-medium p-4 hover:border-primary hover:bg-[var(--bg-warm)] transition-colors">
                <span className="block font-serif text-xl text-primary leading-tight">{who}</span>
                <span className="mt-1 block text-sm text-muted">{lang}</span>
                <span className="mt-3 block text-sm text-secondary group-hover:text-primary">Read the page →</span>
              </Link>
            </Reveal>
          ))}
        </ul>
      </section>

      {/* 5. What we do: a real page read in front of you */}
      <section className={`${CHAPTER} bg-[var(--bg-warm)]`}>
        <div className={WIDE}>
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
        </div>
      </section>

      {/* 6. How Source Library started */}
      <section className={CHAPTER}>
        <Reveal className={COL}>
          <h2 className={h2}>How Source Library started</h2>
          <p className={`mt-8 ${body}`}>
            Five and a half centuries after Ficino, Derek Lomas came across Ficino&apos;s <em>Liber de Voluptate</em> at the Embassy of the Free Mind in Amsterdam and couldn&apos;t read it, because most of what the Renaissance wrote has never been translated. He started Source Library there in 2022, under the bust of Ficino that still watches over the work.
          </p>
        </Reveal>
        <Reveal as="figure" className={`${COL} mt-12`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/about/derek-ficino.jpg" alt="Derek Lomas standing beside a bronze bust of Marsilio Ficino at the Embassy of the Free Mind" width={690} height={630} className="block w-full h-auto" loading="lazy" />
          <figcaption className={`mt-3 ${caption}`}>Derek Lomas with the bust of Marsilio Ficino at the Embassy of the Free Mind.</figcaption>
        </Reveal>
        <Reveal className={`${COL} mt-12`}>
          <p className={body}>
            Derek studied cognitive science at Yale, did his PhD in human-computer interaction at Carnegie Mellon, and teaches at TU Delft. His{' '}
            <Link href="/articles/vision" className={link}>founder&apos;s letter</Link> sets out where the project goes next.
          </p>
        </Reveal>
      </section>

      {/* 7. Partners */}
      <section className={`${CHAPTER} pt-0 md:pt-0`}>
        <Reveal className={COL}>
          <h2 className={h2}>Our partners</h2>
          <p className={`mt-8 ${body}`}>
            Source Library is an initiative of the{' '}
            <a href="https://embassyofthefreemind.com" target="_blank" rel="noopener noreferrer" className={link}>Embassy of the Free Mind</a>, a museum and library in the Huis met de Hoofden on Amsterdam&apos;s Keizersgracht. The Embassy gives the project its home, its books and its scholars.
          </p>
        </Reveal>
        <Reveal as="figure" className={`${COL} mt-12 md:mt-16`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/vision/embassy.jpg" alt="The Embassy of the Free Mind in the Huis met de Hoofden, Keizersgracht, Amsterdam" width={600} height={800} className="block w-full max-w-[420px] h-auto" loading="lazy" />
          <figcaption className={`mt-3 ${caption}`}>The Huis met de Hoofden on the Keizersgracht.</figcaption>
        </Reveal>
        <Reveal className={`${COL} mt-12 md:mt-16`}>
          <p className={body}>
            Its library is the Bibliotheca Philosophica Hermetica, which Joost R. Ritman began collecting in 1957: over 28,000 volumes on Hermetic philosophy, alchemy, mysticism and religion, including some 5,000 manuscripts. The collection is on UNESCO&apos;s Dutch Memory of the World Register and holds the{' '}
            <a href="https://www.guinnessworldrecords.com/world-records/777560-largest-library-dedicated-to-magic-and-mysticism" target="_blank" rel="noopener noreferrer" className={link}>Guinness World Record</a>{' '}
            for the largest library dedicated to magic and mysticism.
          </p>
          <p className={`mt-6 ${body}`}>
            Librarian <strong className="font-semibold text-primary">Paul Dijstelberge</strong>, a historian of the book, guides our work with the collection, and senior researcher <strong className="font-semibold text-primary">Carlos Gilly</strong>, at the BPH for over thirty years, is a leading authority on Rosicrucianism.
          </p>
          <p className={`mt-6 ${body}`}>
            Two more partners help build it.{' '}
            <a href="https://frond-studio.com" target="_blank" rel="noopener noreferrer" className={link}>Frond Studio</a>, a design and technology studio, works on how Source Library looks and reads.{' '}
            <a href="https://folium-studio.com" target="_blank" rel="noopener noreferrer" className={link}>Folium</a>, Frond&apos;s platform for libraries, museums and archives, takes what we have learned here to other collections. The Embassy&apos;s own catalogue runs on it.
          </p>
          <h3 className="mt-12 text-base font-semibold text-primary">
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
        </Reveal>
      </section>

      {/* 8. Join */}
      <section className={`${CHAPTER} bg-[var(--bg-warm)]`}>
        <Reveal className={COL}>
          <h2 className={h2}>Join the work</h2>
          <p className={`mt-8 ${body}`}>
            We want this to outlast us: a lasting home for humanity&apos;s written heritage, from books to oral histories to expeditions in the field. The work is kept going by the people who use and value it.
          </p>
          <p className={`mt-6 ${body}`}>
            We are grateful to the <strong className="font-semibold text-primary">Wisdom Frontiers Society</strong> of La Jolla, California, and the{' '}
            <a href="https://gambrellfoundation.org" target="_blank" rel="noopener noreferrer" className={link}>Gambrell Foundation</a>{' '}
            of Charlotte, North Carolina, who make Source Library and the Embassy of the Free Mind possible.
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
          <div className="mt-10 flex flex-wrap gap-3">
            <Link href="/support" className="px-5 py-2.5 bg-accent-rust text-white hover:opacity-90 transition-opacity font-medium">
              Support the project
            </Link>
            <Link href="/articles/vision" className="px-5 py-2.5 border border-stone-400 text-primary hover:bg-cream transition-colors font-medium">
              Read the vision
            </Link>
            <Link href="/" className="px-5 py-2.5 border border-stone-400 text-primary hover:bg-cream transition-colors">
              Browse the library
            </Link>
          </div>
          <nav aria-label="More about Source Library" className="mt-16 pt-8 border-t border-border-medium flex flex-wrap gap-x-8 gap-y-3 text-secondary">
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
        </Reveal>
      </section>
    </ContentPageLayout>
  );
}
