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

// Books in the library that the Renaissance sections point at.
const PIMANDER = '/book/hermes-trismegistus-pimander-1472-editio-princeps-trans';
const PIMANDER_PREFACE = `${PIMANDER}/page/69b4cc20bb3208142d7bc486`;
const PLOTINUS = '/book/plotinus-enneads-xxvii-liv-ficino-translation-translator';
const PLOTINUS_TITLE = `${PLOTINUS}/page/69b43d3706b196d69f66f5bd`;
const THEOLOGIA = '/book/theologia-platonica-editio-princeps-1482-ficino';
const PLATO = '/book/omnia-divini-platonis-opera-ficino-translation-ficino';

// Dates checked against the SEP entry on Ficino and Ficino's own prefaces.
// Casaubon (1614) dated the Hermetica to the early Christian era.
const AFTER: { year: string; body: ReactNode }[] = [
  {
    year: '1463',
    body: (
      <>
        Ficino finishes the <em>Pimander</em> in a few months. Cosimo dies the next year, with Ficino reading Plato to him.{' '}
        <Link href={PIMANDER} className={link}>Read it in English</Link>
      </>
    ),
  },
  { year: '1471', body: <>The <em>Pimander</em> is printed, the first of many editions over the next century.</> },
  {
    year: '1482',
    body: (
      <>
        Ficino&apos;s own <em>Platonic Theology</em> argues that the soul is immortal, with Plato and Christianity on the same side.{' '}
        <Link href={THEOLOGIA} className={link}>Read the first edition</Link>
      </>
    ),
  },
  {
    year: '1484',
    body: (
      <>
        All of Plato is printed in Latin for the first time. For the next three centuries most Europeans who read Plato read Ficino&apos;s Latin.{' '}
        <Link href={PLATO} className={link}>Read a 1561 edition</Link>
      </>
    ),
  },
  { year: '1486', body: <>Pico della Mirandola, a young friend of Ficino&apos;s in Florence, writes the <em>Oration on the Dignity of Man</em>.</> },
  {
    year: '1492',
    body: (
      <>
        Ficino&apos;s Plotinus is printed, dedicated to Cosimo&apos;s grandson Lorenzo.{' '}
        <Link href={PLOTINUS} className={link}>Read the manuscript made for Lorenzo</Link>
      </>
    ),
  },
  { year: '1543', body: <>Copernicus, in the book that puts the sun at the centre, quotes Hermes Trismegistus calling the sun a &ldquo;visible god&rdquo;.</> },
  { year: '1614', body: <>Isaac Casaubon shows the Hermetic texts were written in the early Christian era, not in the time of Moses. By then the ideas had done their work.</> },
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
      {/* How translation started the Renaissance */}
      <section className="px-6 md:px-12 py-16 md:py-24 border-b border-border-light">
        <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-10 lg:gap-16 items-start">
          <div>
            <h2 className={h2}>How translation started the Renaissance</h2>
            <p className="mt-6 text-lg text-secondary leading-relaxed">
              In 1438 the leaders of the Greek and Latin churches met in Florence to try to reunite them. With the Greeks came the philosopher Gemistos Plethon, who lectured the Florentines on Plato. Only a handful of Plato&apos;s dialogues had ever been put into Latin, so for most of the West he was a famous name nobody could read. Ficino later wrote that Cosimo de&apos; Medici, the banker who ran the city, went to hear him again and again.
            </p>
            <p className="mt-4 text-secondary leading-relaxed">
              Cosimo spent his fortune on books as well as on buildings and paintings. He paid for the library at San Marco, which opened to scholars in the 1440s, and he chose the son of his own doctor, Marsilio Ficino, to learn Greek and translate Plato. In 1462 he gave Ficino a house at Careggi, near his villa, and Greek manuscripts to work from.
            </p>
            <p className="mt-4 text-secondary leading-relaxed">
              Then a monk, Leonardo of Pistoia, brought a Greek manuscript of the <em>Corpus Hermeticum</em> to Florence from Macedonia. Its author was thought to be Hermes Trismegistus, an Egyptian sage from the time of Moses. Cosimo was old and ill, and he asked Ficino to put Plato aside and translate Hermes first.
            </p>
            <p className="mt-4 text-secondary leading-relaxed">
              In his preface Ficino set out a chain of teachers running from Hermes through Orpheus, Pythagoras and Philolaus to Plato: one ancient theology, a <em>prisca theologia</em>, behind all of them. Then he went back to Plato. He translated every dialogue, then Plotinus, then parts of Iamblichus and Proclus. The new printing presses carried his Latin across Europe, and with it the idea that the oldest wisdom could be recovered and read.
            </p>
          </div>
          <figure className="max-w-[440px] lg:ml-auto">
            <Link href={PIMANDER_PREFACE} className="block hover:opacity-90 transition-opacity">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/about/pimander-1472.jpg"
                alt="A printed page of Ficino's Latin preface to the Pimander, 1472"
                width={760}
                height={1000}
                className="w-full h-auto border border-border-light"
                loading="lazy"
              />
            </Link>
            <figcaption className="mt-4">
              <blockquote className="text-secondary leading-relaxed">
                &ldquo;Lately, having been brought from Macedonia into Italy through the diligence of Leonardo the Macedonian, a learned and pious monk, it has come to us. When I, provoked by your exhortations, had decided to translate it from the Greek language into Latin, I thought it would be fair, happy Cosimo, to dedicate the booklet to your name.&rdquo;
              </blockquote>
              <p className="text-sm text-muted mt-3">
                Ficino&apos;s preface to Cosimo in the <em>Pimander</em>, printed 1472. Bayerische Staatsbibliothek.{' '}
                <Link href={PIMANDER_PREFACE} className={link}>Read the page</Link>
              </p>
            </figcaption>
          </figure>
        </div>

        <div className="mt-14 md:mt-20 grid grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,0.74fr)_minmax(0,1.16fr)] gap-10 lg:gap-14 items-start">
          <figure>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/about/cosimo-pontormo.jpg" alt="Cosimo de' Medici in profile, in a red robe and cap" width={667} height={900} className="w-full h-auto" loading="lazy" />
            <figcaption className="mt-5">
              <h3 className="font-serif text-2xl text-primary leading-tight">Cosimo de&apos; Medici</h3>
              <p className="text-sm text-muted mt-1">1389&ndash;1464</p>
              <p className="mt-3 text-secondary leading-relaxed">
                Banker, and for thirty years the man who ran Florence without holding its highest office. He collected Greek and Latin manuscripts, paid for libraries, and paid Ficino to translate. Florence called him <em>Pater Patriae</em>, father of his country.
              </p>
              <p className="text-xs text-muted mt-3">Jacopo Pontormo, about 1519. Uffizi, Florence.</p>
            </figcaption>
          </figure>
          <figure>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/about/ficino-ghirlandaio.jpg" alt="Four Florentine scholars in red cloaks; Ficino, smiling, is on the left" width={1044} height={900} className="w-full h-auto" loading="lazy" />
            <figcaption className="mt-5">
              <h3 className="font-serif text-2xl text-primary leading-tight">Marsilio Ficino</h3>
              <p className="text-sm text-muted mt-1">1433&ndash;1499</p>
              <p className="mt-3 text-secondary leading-relaxed">
                Doctor, priest, philosopher and translator. He put all of Plato and Plotinus into Latin, wrote the <em>Platonic Theology</em> and the <em>Three Books on Life</em>, and gave Europe the phrase &ldquo;Platonic love&rdquo;. Much of his own writing has still never been translated.
              </p>
              <p className="text-xs text-muted mt-3">Ficino (left) with Cristoforo Landino, Angelo Poliziano and Demetrios Chalkondyles. Domenico Ghirlandaio, fresco, 1486&ndash;90. Santa Maria Novella, Florence.</p>
            </figcaption>
          </figure>
        </div>
      </section>

      {/* What it changed */}
      <section className="px-6 md:px-12 py-16 md:py-24 border-b border-border-light">
        <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-10 lg:gap-16 items-start">
          <div>
            <h2 className={h2}>What it changed</h2>
            <p className="mt-6 text-lg text-secondary leading-relaxed">
              Ficino&apos;s translations reached painters, poets, doctors and astronomers. The dignity of the human mind, love as a path to the divine, a single truth behind many religions, a cosmos ordered by number: these ideas came into European thought through the books he translated.
            </p>
            <p className="mt-4 text-secondary leading-relaxed">
              Five centuries on they still shape how we think about science, art and ourselves. And most of what that age wrote, Ficino included, still can&apos;t be read by anyone without Latin.
            </p>
            <figure className="mt-10 max-w-[360px]">
              <Link href={PLOTINUS_TITLE} className="block hover:opacity-90 transition-opacity">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/about/plotinus-lorenzo.jpg" alt="An illuminated title page in a wreath of leaves and gems, with a flame above" width={702} height={1000} className="w-full h-auto border border-border-light" loading="lazy" />
              </Link>
              <figcaption className="text-sm text-muted mt-3">
                Ficino&apos;s Plotinus, &ldquo;translated and explained by Marsilio Ficino of Florence for Lorenzo de&apos; Medici&rdquo;, 1490.{' '}
                <Link href={PLOTINUS_TITLE} className={link}>Read it</Link>
              </figcaption>
            </figure>
          </div>
          <ol className="border-t border-border-light">
            {AFTER.map((e) => (
              <li key={e.year} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-4 py-5 border-b border-border-light">
                <span className="font-serif text-2xl text-primary tabular-nums leading-none pt-0.5">{e.year}</span>
                <p className="text-secondary leading-relaxed">{e.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* The gap */}
      <section className="px-6 md:px-12 py-14 md:py-16 border-b border-border-light">
        <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-10 lg:gap-16 items-start">
          <div>
            <h2 className={h2}>How much of the written past can anyone read today?</h2>
            <p className="mt-6 text-lg text-secondary leading-relaxed">
              Very little. Start with the books one small country printed before 1700, then keep zooming out.
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

      {/* A new Renaissance */}
      <section className="px-6 md:px-12 py-16 md:py-24 border-b border-border-light">
        <div className="max-w-3xl">
          <h2 className={h2}>A new Renaissance</h2>
          <p className="mt-6 text-lg text-secondary leading-relaxed">
            Ficino had one patron, one city and a printing press that had only just been invented, and it took him most of his life to put Plato and Plotinus into Latin. At the pace human translators work, the books in that chart would take many lifetimes. Rediscovering ancient wisdom helped spark the Renaissance. We think it is time for another.
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
            <h2 className={h2}>How Source Library started</h2>
            <p className="mt-6 text-secondary leading-relaxed">
              Five and a half centuries after Ficino, Derek Lomas found he couldn&apos;t read Ficino&apos;s own books. He came across Ficino&apos;s <em>Liber de Voluptate</em> at the Embassy of the Free Mind in Amsterdam and couldn&apos;t read it, because most of what the Renaissance wrote has never been translated. He started Source Library there in 2022, under the bust of Ficino that still watches over the work.
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
