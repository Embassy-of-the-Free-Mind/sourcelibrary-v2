import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { withArticleMeta } from '@/lib/article-metadata';
import PageFigure from '@/components/articles/PageFigure';
import SourceQuote from '@/components/articles/SourceQuote';
import { CycleWheels, CyclesMeet, DateCounter, KauaSequences, NumeralBuilder } from './MayaInteractives';
import { GearTrain } from './MayaGears';
import { EclipseTable, VenusTable } from './MayaTables';

// Every quotation below is copied from the stored text of the page it links to (#6925): the served English
// translation for Landa, the Motul dictionary, the Kaua book and Förstemann's commentary (Förstemann's is the
// printed 1906 English), and the printed English for Bowditch. The Dresden pages were identified by eye on
// 2026-10-18: reader pages 25 to 29 are the five Venus pages (Förstemann's 46 to 50). The arithmetic in the
// interactives is pinned by tests/maya-calendar.test.ts.

const DRESDEN_ID = '69dfd990220eedf04e13b0cf';
const HERO = `https://images.sourcelibrary.org/archived/${DRESDEN_ID}/27.jpg`;
const HERO_ALT =
  'A Venus page of the Dresden Codex: columns of day signs and bar-and-dot numbers beside three painted panels, the top one a seated god on a blue ground.';

const TITLE = 'How the Maya Counted';
const DESCRIPTION =
  'Bars, dots and a shell for zero; a count by twenties with one place of eighteen; and calendar cycles that meet after whole numbers of days. Try the numerals and the counts, with the codex pages and the colonial sources beside them.';

export const metadata: Metadata = withArticleMeta('maya-mathematics', {
  title: `${TITLE} - Articles - Source Library`,
  description: DESCRIPTION,
  openGraph: {
    images: [{ url: HERO, alt: HERO_ALT }],
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: { card: 'summary_large_image', images: [{ url: HERO, alt: HERO_ALT }] },
  alternates: { canonical: '/articles/maya-mathematics' },
});

const SLUG = {
  landa: 'relation-des-choses-de-yucatan-de-diego-de-landa-ed',
  motul2: 'diccionario-de-motul-maya-espanol-vol-2-antonio-de-ciudad-real',
  bowditch: 'the-numeration-calendar-systems-and-astronomical-knowledge-of-the-maya',
  forstemann: 'commentary-on-the-maya-manuscript-in-the-royal-public-forstemann',
  dresden: 'dresden-codex-codex-dresdensis',
  paris: 'paris-codex-codex-peresianus',
  kaua: 'chilam-balam-de-kaua-maler-photographs-1887',
  brinton: 'the-maya-chronicles-library-of-aboriginal-american-brinton',
};
const ID = {
  landa: '69ee93b9f2c6312502f6a526',
  motul2: '6acc3d6c230e9a56175ccae2',
  bowditch: '6abfbf413c453a90d66637dc',
  forstemann: '6a09ff94fa20006dbaba9ecb',
};
const img = (id: string, n: number) => `https://images.sourcelibrary.org/archived/${id}/${n}.jpg`;
const at = (slug: string, n: number) => `/book/${slug}?page=${n}`;

const BOWDITCH = <>Bowditch, <em>The Numeration, Calendar Systems and Astronomical Knowledge of the Mayas</em> (1910)</>;
const FORSTEMANN = <>Förstemann, <em>Commentary on the Maya Manuscript in the Royal Public Library of Dresden</em> (1906)</>;

const p = 'text-secondary leading-relaxed mb-6 font-body';
const h2 = 'text-2xl md:text-3xl text-primary mt-20 mb-6 scroll-mt-24';
const h3 = 'text-xl md:text-2xl text-primary mt-12 mb-5';

export default function MayaMathematicsPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader feature headerVariant="dark" title={TITLE} subtitle={DESCRIPTION} image={HERO} imageAlt={HERO_ALT}>
          <p className="text-stone-400 text-sm mt-4">18 October 2026 &middot; 15 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <article className="prose-content max-w-none article-page">
        <p className={p}>
          Four books written by Maya scribes before the Spanish conquest are known to survive: the codices now in
          Dresden, Madrid and Paris, and the Grolier Codex in Mexico City, whose authenticity is still argued over.
          They are screenfolds of bark paper coated with lime plaster and painted in black, red and blue, and much of
          what is on their pages is arithmetic. The <Link href={`/book/${SLUG.dresden}`}>Dresden Codex</Link> carries
          a Venus table that runs for 104 years, a table of 405 lunar months that tracks the eclipse seasons, a
          multiplication table, and counts of more than twelve million days.
        </p>

        <div className="max-w-md mx-auto">
          <PageFigure linkToPage
            src={img(DRESDEN_ID, 26)}
            alt="A Venus page of the Dresden Codex: columns of glyphs and numbers on the left, and three painted panels on the right, the middle one a figure with a spear, the bottom one a speared animal."
            href={at(SLUG.dresden, 26)}
            source={<em>Dresden Codex</em>}
          >
            One of the five Venus pages of the Dresden Codex (Förstemann&apos;s pages 46 to 50). The columns hold day
            names and the intervals between them; the paintings show Venus as a spear-thrower and the one it strikes.
          </PageFigure>
        </div>

        <p className={p}>
          This article reads that arithmetic piece by piece: how the numbers were written, how the counts of days fit
          together, and how the scribes kept them in step with Venus and the moon. Each part has something to try, and
          beside it the page it comes from: the Dresden Codex itself; Ernst Förstemann and Charles Bowditch, who first
          worked out its arithmetic; and the colonial sources that recorded how the Maya counted aloud, Diego de
          Landa&apos;s <Link href={at(SLUG.landa, 252)}>Relación</Link>, the Motul dictionary and the Books of Chilam
          Balam.
        </p>

        <nav aria-label="On this page" data-card className="not-prose my-10 grid gap-4 sm:grid-cols-2 rounded-lg border border-border-light bg-white/60 p-5 font-sans text-sm">
          {[
            { href: '#numbers', title: 'Numbers', text: 'Counting by twenties, the bar, the dot and the shell, and how the scribes multiplied.', tries: 'Write a number' },
            { href: '#days', title: 'Days', text: 'The Long Count, the 260-day count and the 365-day year, and the 52 years it takes them to meet.', tries: 'Convert a date; turn the wheels and gears; the Kaua rows' },
            { href: '#sky', title: 'The sky', text: 'Venus, the moon and the largest numbers in the Dresden Codex.', tries: 'Find where cycles meet; the Venus gears' },
            { href: '#since', title: 'What has been found since', text: 'San Bartolo, Xultun, the earliest Long Counts, the 819-day count, the eclipse table.', tries: 'The 819-day gears' },
          ].map((s) => (
            <a key={s.href} href={s.href} className="block group">
              <span className="block font-serif text-lg text-primary group-hover:underline">{s.title}</span>
              <span className="block text-secondary mt-1">{s.text}</span>
              <span className="block text-muted mt-1">Try: {s.tries}</span>
            </a>
          ))}
        </nav>

        <h2 id="numbers" className={h2}>Numbers</h2>

        <h3 className={h3}>Twenty, four hundred, eight thousand</h3>

        <p className={p}>
          The codices write numbers; the colonial sources say how they were spoken. Diego de Landa, the Franciscan who
          burned the Maya books he found at Maní in 1562, describes how the Yucatec Maya counted:
        </p>

        <SourceQuote linkToPage
          book={SLUG.landa} page={252} printedPage={134} src={img(ID.landa, 252)}
          source={<>Diego de Landa, <em>Relación de las cosas de Yucatán</em>, §XXIV (1864 edition)</>}
          pageAlt="Page 134 of Brasseur's 1864 edition of Landa, with the section on how the Yucatecans count"
        >
          Their count is from 5 to 5 until 20, and from 20 to 20 until 100, and from 100 to 100 until 400, and from
          400 to 400 until 8,000. And they made much use of this count for the trade of cacao. They have other very
          long counts, and which they extend <em>in infinitum</em>, counting them 8,000 twenty times, which is
          160,000, and returning to 20 they double these 160,000, and then continue in this way doubling by 20 until
          they make an uncountable number: they count on the ground or on a flat thing.
        </SourceQuote>

        <p className={p}>
          The great Motul dictionary, compiled by Franciscans in the sixteenth century, gives the words for each step.
        </p>

        <SourceQuote linkToPage
          book={SLUG.motul2} page={417} src={img(ID.motul2, 417)}
          source={<><em>Diccionario de Motul</em>, Spanish-Maya part</>}
          pageAlt="A page of the Motul dictionary with the Maya words for twenty, four hundred and eight thousand"
        >
          the number twenty: hunkal. … twenty twenties: hunbak, 400. twenty times 400: hunpic: 8000.
        </SourceQuote>

        <p className={p}>
          <em>Hun</em> is one, so <em>hunkal</em> is one twenty, <em>hunbak</em> one four hundred, <em>hunpic</em> one
          eight thousand. These are the units Landa lists, and the same entry gives <em>hunkatun</em> for twenty years.
          Each unit is twenty of the one below it. Landa adds that the counts were kept on the ground or on a flat
          surface, which fits what we find in the codices: a number is a stack of places, each one worth twenty times
          the place beneath it.
        </p>

        <h3 className={h3}>Three marks</h3>

        <p className={p}>
          The written numbers use three signs. A dot is one, a bar is five, and a shell is zero. Any number from 1 to
          19 is some dots over some bars: seven is two dots over a bar, nineteen is four dots over three bars. Twenty
          cannot be written in one place, so it moves up: one dot in the second place and a shell in the first.
        </p>

        <PageFigure linkToPage
          src="/articles/maya-mathematics/dresden-numerals.jpg"
          alt="Detail of a Dresden Codex page: rows of bar-and-dot numbers in black, a row of day signs each with a red number, and a red row beneath, next to a painted sky band with a hanging figure."
          href={at(SLUG.dresden, 31)}
          source={<em>Dresden Codex</em>}
        >
          Bars and dots on a page of the Dresden Codex. Black numbers above, day signs with red numbers in the middle,
          and more numbers in red and black below.
        </PageFigure>

        <p className={p}>
          Because a place can hold only nineteen, the position of a mark says what it is worth. This is the same
          idea as our own place value, built on twenty instead of ten. Try it below: type a number, or press the
          buttons beside each place.
        </p>

        <NumeralBuilder />

        <p className={p}>
          The two settings show the one irregularity in the system, which comes in the next section. In plain
          counting the third place is worth 400. In the calendar it is worth 360.
        </p>

        <h3 className={h3}>Zero, and how the scribes multiplied</h3>

        <p className={p}>
          A place-value system needs a way to say that a place is empty, or the stack falls apart: 400 and 20 and 1
          would all be a single dot. The Maya had a zero, written as a shell in the codices and as several other
          signs in stone. Bowditch, working through the Dresden Codex in 1910, showed what it was by doing the
          scribe&apos;s sums. On Dresden 24 a series rises in steps of 2,920 days, and the fifth term has a zero in
          it. He works the multiplication the way the scribe would have to.
        </p>

        <SourceQuote linkToPage
          book={SLUG.bowditch} page={70} printedPage={46} src={img(ID.bowditch, 70)}
          source={BOWDITCH}
          pageAlt="Page 46 of Bowditch, on the red zero of Dresden 24"
        >
          To perform the multiplication we should say, &ldquo;Five times zero units give no units; put down the zero;
          five times 2 twenties give 10 twenties; put down the 10; five times 8 three-hundred-and-sixties give 40; but
          this is the same as 2 of the fourth place, with none left of the third place; therefore put down zero in the
          third place and 2 in the fourth place, as shown in the codex.&rdquo;
        </SourceQuote>

        <p className={p}>
          So 2,920 is written 8 · 2 · 0 (eight 360s, two 20s, no units), and 5 × 2,920 = 14,600 is 2 · 0 · 10 · 0.
          The scribe carries just as we do, except that 18 in the third place makes one in the fourth, not 20. Press
          14,600 in the number builder above to see it written out. On the monuments the zero is sometimes a face.
          Bowditch identified one form by the same reasoning, from what the number had to be for the date to come out.
        </p>

        <SourceQuote linkToPage
          book={SLUG.bowditch} page={122} printedPage={98} src={img(ID.bowditch, 122)}
          source={BOWDITCH}
          pageAlt="Page 98 of Bowditch, on the head form of zero"
        >
          the form of the head with a hand across the face must mean zero, since the day given in A6 is Ahau, and any
          other kin number (among those which we have heretofore found in such connection) if counted from Ahau,
          either forward or backward, would bring some other day than Ahau.
        </SourceQuote>

        <h2 id="days" className={h2}>Days</h2>

        <h3 className={h3}>Eighteen in the second place: the Long Count</h3>

        <p className={p}>
          When the Maya counted days, they broke the pattern once. Twenty days make a winal, but eighteen winals, not
          twenty, make a tun of 360 days, close to a year. Above that the count is in twenties again.
        </p>

        <SourceQuote linkToPage
          book={SLUG.bowditch} page={82} printedPage={58} src={img(ID.bowditch, 82)}
          source={BOWDITCH}
          pageAlt="Page 58 of Bowditch, setting out the units of the long count"
        >
          To express higher numbers the Mayas used the vigesimal system up to the katun and beyond, as will be
          explained later, except in the second term. Thus, 20 kins = 1 uinal. 18 uinals = 1 tun. 20 tuns = 1 katun.
        </SourceQuote>

        <p className={p}>
          Twenty tuns make a k&apos;atun of 7,200 days, and twenty k&apos;atuns a b&apos;ak&apos;tun of 144,000.
          The monuments give dates as a count of days in these units from a fixed starting day, so that 9.9.2.4.8 means
          nine b&apos;ak&apos;tuns, nine k&apos;atuns, two tuns, four winals and eight days. That starting day is
          written 13.0.0.0.0 and named 4 Ajaw 8 Kumk&apos;u. The second name is its place in two other counts, the
          260-day count and the 365-day year, both of which run alongside the Long Count.
        </p>

        <p className={p}>
          Choose a date below to see it in every count at once. To turn a Maya day number into a date in our
          calendar you need to know which of our days was day zero. The standard answer, the Goodman-Martinez-Thompson
          correlation, puts it on 11 August 3114 BCE. Radiocarbon dates from carved wooden lintels at Tikal agree with
          it (<a href="https://www.nature.com/articles/srep01597">Kennett and others, <em>Scientific Reports</em>,
          2013</a>). A variant two days later is in some astronomy software, and the converter lets you switch.
        </p>

        <DateCounter />

        <h3 className={h3}>Wheels, gears and fifty-two years</h3>

        <p className={p}>
          The 260-day count pairs a number from 1 to 13 with one of twenty day names. Both advance every day: 1 Imix,
          2 Ik&apos;, 3 Ak&apos;b&apos;al, and so on, until 13 Ben is followed by 1 Ix. Because 13 and 20 have no
          common factor, every pairing occurs once before the cycle repeats, after 260 days. The 365-day year runs
          beside it, eighteen months of twenty days and five more at the end. A given day in both counts comes back
          only when both have come round, after 18,980 days, or 52 years. Landa describes how the four day names that
          can begin a year divided the years among four gods, which is the subject of{' '}
          <Link href="/articles/maya-ritual-in-the-colonial-dictionaries">another article</Link>.
        </p>

        <CycleWheels />

        <p className={p}>
          The same counts can be drawn as meshing gears with one tooth for each day: a gear of 13 teeth, one of 20 and
          one of 365, all turning a tooth a day. The gears are a picture, not a mechanism: the counts are separate
          tallies, and all the picture shows is when they come round together. The colonial books drew the k&apos;atuns on a wheel; gears are a modern picture
          of the same arithmetic. Each gear has a gold mark that starts on the reading line. Turn them and see how long it takes for
          all the marks to come back to it together.
        </p>

        <GearTrain />

        <p className={p}>
          The same arithmetic explains three rows of numbers in the Book of Chilam Balam of Kaua, a Yucatec manuscript
          copied in the eighteenth century and photographed by Teobert Maler in 1887. The page lists the numbers that
          come round when one counts by months and by k&apos;atuns.
        </p>

        <SourceQuote linkToPage
          book={SLUG.kaua} page={278}
          src="https://images.sourcelibrary.org/pages/6a878ac1d71f2514794f9e40/spl4cs-0278-full.jpg"
          source={<>Book of Chilam Balam of Kaua, Maler&apos;s photographs</>}
          pageAlt="A page of the Kaua manuscript with rows of numbers for the months and the k'atuns"
        >
          There was another number that they call Katun, which served almost as a key to find and establish the Katuns
          according to the order of their movement. … Katuns: 13. 11. 9. 7. 5. 3. 1. 12. 10. 8. 6. 4. 2.
        </SourceQuote>

        <p className={p}>
          A k&apos;atun is 7,200 days, and 7,200 is 553 thirteens with 11 left over. So each k&apos;atun moves the day
          number on by 11, which in a count of 13 is the same as going back 2. The k&apos;atuns were named by the day
          on which they ended, always a day Ajaw, and their numbers fall by two each time. The other two rows on the
          page come out the same way from 20 days and 360 days.
        </p>

        <KauaSequences />

        <h2 id="sky" className={h2}>The sky</h2>

        <h3 className={h3}>Whole numbers instead of fractions</h3>

        <p className={p}>
          Venus takes about 583.92 days to return to the same place in the sky as seen from the Earth. The Maya
          scribes had no fractions. What they had instead was the habit of looking for a number of days in which
          several cycles all come out even. Five Venus cycles of 584 days are 2,920 days, and so are eight years of
          365. Five pages of the Dresden Codex are built on this; the page at the top of this article is one of them.
        </p>


        <SourceQuote linkToPage
          book={SLUG.bowditch} page={79} printedPage={55} src={img(ID.bowditch, 79)}
          source={BOWDITCH}
          pageAlt="Page 55 of Bowditch, on the Venus pages of the Dresden Codex"
        >
          Now 2920 = 5 × 584 = 8 × 365. But 583.92 days is the length of the synodical revolution of the planet
          Venus, and 365.25 days is the length of the solar revolution of the earth.
        </SourceQuote>

        <p className={p}>
          The table runs the 2,920-day count thirteen times, so that it also comes out even with the 260-day count.
          Bowditch shows that the whole table returns to the day it started from.
        </p>

        <SourceQuote linkToPage
          book={SLUG.bowditch} page={80} printedPage={56} src={img(ID.bowditch, 80)}
          source={BOWDITCH}
          pageAlt="Page 56 of Bowditch, on the 37,960 days of the Venus table"
        >
          The whole thirteen rows will then cover 13 × 2920 days, or 37,960 days, or 8 × 13 = 104 years of 365 days,
          or 65 synodical revolutions of Venus.
        </SourceQuote>

        <p className={p}>
          37,960 days is 146 runs of the 260-day count, 104 years and 65 Venus cycles. Whole days cannot match the sky exactly: by the end of the 37,960 days the 584-day Venus
          count has run about five days ahead of the planet. The table has places that look like corrections for this,
          and how they work is still argued over.
        </p>

        <p className={p}>
          Below is the table itself, laid out as Bowditch reads it: thirteen rows, each running across the five pages,
          every day named in the 260-day count. Step through it and watch the count pull ahead of the planet.
        </p>

        <VenusTable />

        <p className={p}>
          The same method works for any set of cycles. Choose some below to see where they meet.
        </p>

        <CyclesMeet />

        <GearTrain initial="venus" />

        <h3 className={h3}>A multiplication table, and the moon</h3>

        <p className={p}>
          Dresden 24, the page with the zero Bowditch worked through, is in effect a multiplication table.
        </p>

        <SourceQuote linkToPage
          book={SLUG.bowditch} page={235} printedPage={211} src={img(ID.bowditch, 235)}
          source={BOWDITCH}
          pageAlt="Page 211 of Bowditch, opening the chapter on other astronomical knowledge"
        >
          On Dresden 24 this number 2920 is used as a factor or difference, the page affording a kind of
          multiplication table up to 13 times 2920, or 5.5.8.0.
        </SourceQuote>

        <p className={p}>
          The moon is harder, because a lunar month is about 29.53 days and no small whole number of months comes out
          even. The eclipse table on Dresden 51 to 58 lists 405 lunar months. Förstemann read how the scribe made it
          add up: months of 29 and 30 days grouped into runs of six, with a few runs of five.
        </p>

        <SourceQuote linkToPage
          book={SLUG.forstemann} page={160} src={img(ID.forstemann, 160)}
          source={FORSTEMANN}
          pageAlt="A page of Förstemann's commentary on the lunar table of the Dresden Codex"
        >
          Now the Mayas had determined the lunar revolution so exactly that they perceived the incompatibility of the
          period of 11,960 days with a multiple of lunar revolutions. They found that 405 lunar revolutions amounted
          approximately to 11,958 days, which is, in fact, the largest number on the second half of page 58.
        </SourceQuote>

        <p className={p}>
          At the modern length of the month, 405 months are 11,959.9 days. Förstemann goes on to show the steps the
          table uses: 177 days for six months (three of 29 and three of 30) and 148 for five, mixed so that the
          average month comes out close to the true one. The span of the table, 11,960 days, is also exactly 46 runs
          of the 260-day count, so the table starts again on the same day of the ritual calendar.
        </p>

        <p className={p}>
          Förstemann also lists the whole series: 69 groups, each of 177, 178 or 148 days, with the 148s always in the
          same place before one of the table&apos;s pictures. Step through it below. The groups are counted in lunar
          months, but the pattern of fives and sixes keeps the table in step with something else as well: the eclipse
          seasons, the times of year when the moon crosses the sun&apos;s path and an eclipse can happen.
        </p>

        <EclipseTable />

        <h3 className={h3}>Serpent numbers</h3>

        <p className={p}>
          The largest numbers in the codex are painted inside the coils of serpents on pages 61 to 69. They are
          counts of more than twelve million days, more than 34,000 years, and each one lands on a chosen day in both
          the 260-day count and the year. Förstemann, checking them, noticed how closely they were related.
        </p>

        <SourceQuote linkToPage
          book={SLUG.forstemann} page={190} src={img(ID.forstemann, 190)}
          source={FORSTEMANN}
          pageAlt="A page of Förstemann's commentary on the serpent numbers"
        >
          Further, it is to be noted that the largest of the eight numbers, 12,489,781, is separated from the lowest,
          12,388,121 (i.e., the black number from the red one of the first serpent), by only 101,660. … 101,660 = 5 ×
          18,980 + 26 × 260 or 391 × 260 or 7,820 × 13.
        </SourceQuote>

        <p className={p}>
          The difference between the two numbers is a whole number of 260-day counts, so both land on the same day of
          that count. Förstemann ends the passage by asking how the person who made the table worked the values out.
          The method is the one this article has followed from the start: place value in twenties, with eighteen in
          the third place, and cycles that meet after a whole number of days.
        </p>

        <h2 id="since" className={h2}>What has been found since</h2>

        <p className={p}>
          Bowditch and Förstemann had the three codices and a few hundred inscriptions. Most of what has changed
          since then has come out of the ground.
        </p>

        <h3 className={h3}>The oldest dated day</h3>

        <p className={p}>
          In 2022 David Stuart, Heather Hurst, Boris
          Beltrán and William Saturno published two fragments of painted plaster from San Bartolo in Guatemala that
          carry the day 7 Deer, written as a bar and two dots beside a deer&apos;s head. Charcoal from the same sealed
          layer dates them to roughly 300 to 200 BCE, which makes them the earliest securely dated record of the
          260-day count (<a href="https://www.science.org/doi/10.1126/sciadv.abl9290">Stuart and others,{' '}
          <em>Science Advances</em>, 2022</a>). The count was already written down, bars and dots and all, some
          fifteen centuries before the Dresden Codex.
        </p>

        <h3 className={h3}>Older still, in the buildings</h3>

        <p className={p}>
          A lidar survey of 415 ceremonial
          complexes on the southern Gulf Coast of Mexico, built between about 1100 BCE and 250 CE, found most of them
          aligned to sunrises on dates spaced by multiples of 13 and 20 days, the units of the 260-day count. Ivan
          Šprajc, Takeshi Inomata and Anthony Aveni read this as the count in use centuries before any surviving
          inscription (<a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC9821873/"><em>Science Advances</em>,
          2023</a>). Aguada Fénix, the largest early Maya platform, is among them.
        </p>

        <h3 className={h3}>Tables on a wall</h3>

        <p className={p}>
          At Xultun in Guatemala, in a small room painted
          in the early ninth century, Saturno, Stuart, Aveni and Franco Rossi found columns of numbers written on the
          plaster: lunar tables, and possibly tables for Venus and Mars, some five hundred years older than the Dresden
          Codex. One array of 4,784 days, 162 lunar months, is laid out much like the Dresden eclipse table
          (<a href="https://mayadecipherment.com/2012/05/">Stuart, <em>Maya Decipherment</em>, 2012</a>; the report
          is in <em>Science</em> 336, 2012). The astronomy of the codices had a long working life behind it.
        </p>

        <h3 className={h3}>The 819-day count</h3>

        <p className={p}>
          Many Classic inscriptions give a fourth count,
          of 819 days, which is 7 × 9 × 13. Its purpose was long unclear. John Linden and Victoria Bricker proposed in
          2023 that it was meant to be run twenty times: 20 × 819 = 16,380 days, which is a whole number of 260-day
          counts and of 780-day Mars cycles, and close to whole numbers of the other visible planets. The authors
          say the count is still not completely explained (
          <a href="https://doi.org/10.1017/S0956536122000323"><em>Ancient Mesoamerica</em>, 2023</a>). Choose the
          819-day count and Mars in the cycles above, or the third set of gears, to see where they meet. It is the same
          method as the Venus pages.
        </p>

        <h3 className={h3}>The first Long Counts</h3>

        <p className={p}>
          The oldest Long Count dates are not Maya. Stela 2 at Chiapa de Corzo in Chiapas carries 7.16.3.2.13, a day in
          36 BCE, and Stela C at Tres Zapotes in Veracruz carries 7.16.6.16.18, in 32 BCE; both come from the
          Isthmian region west of the Maya area. The earliest securely Maya Long Count is on Stela 29 at Tikal,
          8.12.14.8.15, in 292 CE. The place-value count with its 360-day tun was in use before the Maya cities carved
          it on their monuments.
        </p>

        <h3 className={h3}>Correcting Venus</h3>

        <p className={p}>
          A count of 584 days runs ahead of Venus by about two days in every 25 cycles, and the Dresden table has
          places where it seems to be reset. How the reset works has been argued since John Teeple in the 1930s.
          Harvey and Victoria Bricker&apos;s <em>Astronomy in the Maya Codices</em> (American Philosophical Society,
          2011) works through the Venus pages table by table. Gerardo Aldana argued that the correction was a
          discovery of its own, made at Chichén Itzá between about 800 and 1000 CE (
          <a href="https://escholarship.org/uc/item/6cr1s6jd"><em>Journal of Astronomy in Culture</em>, 2016</a>). A
          fourth Maya book, the Grolier Codex, also holds a Venus calendar; Stephen Houston, Michael Coe, Mary Miller
          and Karl Taube argued in 2016 that it is genuine, which not everyone accepts (
          <a href="https://www.brown.edu/news/2016-09-07/mayacodex">Brown University report</a>).
        </p>

        <h3 className={h3}>How the eclipse table was used</h3>

        <p className={p}>
          John Justeson and Justin Lowry
          argued in 2025 that the Dresden table began as a lunar calendar, fitted to the 260-day count through the 46
          runs it contains, and was then reset at its end in ways that kept its eclipse warnings usable for centuries
          (<a href="https://skyandtelescope.org/astronomy-news/maya-260-day-calendar-provides-key-to-solar-eclipse-predictions/">reported
          in <em>Sky &amp; Telescope</em></a>; the paper is in <em>Science Advances</em>, 2025).
        </p>

        <p className={p}>
          Stuart&apos;s book <em>The Order of Days</em> is the readable account of how these counts fit into Maya
          ideas about time, written in the run-up to 2012. Its main point about that year is the one the arithmetic
          above makes: 13.0.0.0.0 was the completion of a count, and the counts kept going. Inscriptions at Palenque
          name dates thousands of years beyond it.
        </p>

        <h3 className={h3}>Elsewhere</h3>

        <p className={p}>
          The Smithsonian&apos;s <a href="https://maya.nmai.si.edu/calendar/maya-calendar-converter">Living Maya Time</a>{' '}
          converts dates with the glyphs drawn, in English and Spanish. The Saxon State Library in Dresden shows the
          codex itself at high resolution in its <a href="https://digital.slub-dresden.de/werkansicht/dlf/2967/1">digital
          collections</a>, and FAMSI keeps Förstemann&apos;s facsimiles (
          <a href="https://www.famsi.org/mayawriting/codices/dresden.html">famsi.org</a>).
        </p>

        <p className="text-sm text-muted leading-relaxed mt-12 font-body">
          The English of Landa, the Motul dictionary and the Kaua book is the library&apos;s translation. Bowditch and
          Förstemann are quoted from their printed English. The Paris Codex and Brinton&apos;s{' '}
          <Link href={`/book/${SLUG.brinton}?page=60`}>Maya Chronicles</Link>, on the colonial count of k&apos;atuns,
          are also in the library. The date converter uses the proleptic Gregorian calendar for all dates.
        </p>
      </article>
    </ContentPageLayout>
  );
}
