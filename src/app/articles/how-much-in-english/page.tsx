import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { withArticleMeta } from '@/lib/article-metadata';

const HERO = 'https://images.sourcelibrary.org/archived/6990505e7d19f3f2aac1e2b7/5.jpg';
const HERO_ALT =
  'Engraved frontispiece of Athanasius Kircher, Turris Babel (Amsterdam, 1679): robed figures in the foreground, the tower rising in the background under a sky of angels.';

export const metadata: Metadata = withArticleMeta('how-much-in-english', {
  title: 'How Much of the Written Past Can You Read in English? - Articles - Source Library',
  description:
    'Tradition by tradition: how many old books and manuscripts survive, how many are scanned, and how many have ever been put into English.',
  openGraph: {
    images: [{ url: HERO, alt: HERO_ALT }],
    title: 'How Much of the Written Past Can You Read in English?',
    description:
      'Tradition by tradition: how many old books and manuscripts survive, how many are scanned, and how many have ever been put into English.',
  },
  twitter: { card: 'summary_large_image', images: [{ url: HERO, alt: HERO_ALT }] },
  alternates: { canonical: '/articles/how-much-in-english' },
});

const TH = 'text-left font-medium text-primary py-2 pr-4 border-b border-border-light';
const TD = 'py-2 pr-4 align-top border-b border-border-light text-secondary';
const P = 'text-secondary leading-relaxed mb-6 font-body';
const H2 = 'font-serif text-2xl md:text-3xl text-primary mb-6';

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto mb-8">
      <table className="w-full text-sm font-body">
        <thead>
          <tr>{head.map((h) => <th key={h} className={TH}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} className={TD}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function HowMuchInEnglishPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader feature headerVariant="dark"
          title="How Much of the Written Past Can You Read in English?"
          subtitle="What survives, what is scanned, and what has been translated, tradition by tradition"
          image={HERO}
          imageAlt={HERO_ALT}
        >
          <p className="text-stone-400 text-sm mt-4">30 October 2026 &middot; 9 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8 font-body">
          For each of the world&apos;s great written traditions there are three questions. How much
          survives? How much of it has been photographed and put online? And how much can a reader
          who knows only English actually read?
        </p>
        <p className={P}>
          The first question has rough answers almost everywhere. The second has answers for some
          libraries and some countries. The third has been measured in only three places: the
          Tibetan Kangyur, the Hebrew texts on Sefaria, and early modern Latin. Everywhere else the
          honest entry in the table is &ldquo;no estimate&rdquo;. What follows gathers the best
          published figures, with their units and dates, and our own counts where we have made them.
        </p>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className={H2}>Editions, works, manuscripts and pages</h2>
          <p className={P}>
            Numbers about old books are easy to misread because they count different things.
          </p>
          <ul className="list-disc pl-6 mb-6 text-secondary font-body leading-relaxed space-y-2">
            <li><strong>An edition</strong> is one printing: a particular publisher, place and year.</li>
            <li><strong>A work</strong> is the text itself, however many times it was printed. The <em>Imitation of Christ</em> is one work; the Universal Short Title Catalogue lists 252 Latin editions of it before 1700.</li>
            <li><strong>A manuscript</strong> is one handwritten copy. A popular text can survive in hundreds of manuscripts.</li>
            <li><strong>Pages</strong> or folios measure size, and are the unit for digitisation projects and for the Tibetan canon.</li>
          </ul>
          <p className={P}>
            The difference matters most for translation. Famous works were printed many times and are
            also the ones most often translated, so a count of editions makes the translated share
            look larger than a count of works. Translation happens to works, so the share translated
            should be a share of works. Most catalogues count editions or copies. Turning editions
            into works means grouping every printing of the same text together, which is how the
            work counts below were made.
          </p>
        </section>

        <section className="mb-16">
          <h2 className={H2}>European printed books, 1400 to 1700</h2>
          <p className={P}>
            Europe is the one region with a full census of what was printed. The Universal Short
            Title Catalogue at St Andrews lists more than 1.65 million surviving editions printed
            before 1700, in about 7 million copies in more than 10,000 libraries (2025). Grouping
            those editions into works gives the second column below. The last two columns are what
            is readable on Source Library and what has been translated anywhere.
          </p>
          <Table
            head={['Language', 'Editions (USTC)', 'Works', 'Works we hold', 'Readable here in English', 'Translated into English anywhere']}
            rows={[
              ['Latin', '499,604', 'about 306,000', '49,458', '5,243 (1.7%)', '7% to 15% (sampled, see below)'],
              ['German', '340,205', 'about 222,000', '22,745', '651 (0.3%)', 'no estimate'],
              ['French', '233,563', 'about 124,000', '1,521', '202 (0.2%)', 'no estimate'],
              ['Dutch', '113,839', 'about 74,000', '339', '223 (0.3%)', 'no estimate'],
              ['Italian', '110,331', 'about 69,000', '861', '193 (0.3%)', 'no estimate'],
              ['Spanish', '83,510', 'about 60,000', '176', '28', 'no estimate'],
            ]}
          />
          <p className={P}>
            <strong>Latin</strong> is the only European language where the translated share has
            been measured. A blind sample of 1,000 works, each searched for any published English
            translation, found that 93% of Latin works composed in the Renaissance have none, and
            85% of all Latin works printed in the period have none (the second figure is lower
            because the period&apos;s presses also reprinted Cicero, Ovid and Aquinas, who are well
            translated). The translation catalogues on their own find English versions of only 1.4%
            of Latin works, so they see well under half of what exists. The method and the dataset
            are described in <Link href="/articles/counting-the-gap">Counting the gap</Link> and on
            the <Link href="/census">census</Link> page.
          </p>
          <p className={P}>
            <strong>Scanning.</strong> About 58% of early modern Latin works have at least one
            digitised copy somewhere, counting only copies with a working IIIF image link, so this
            is a floor. For German printing the national bibliographies report about 72% of
            sixteenth-century editions imaged (VD16, 2025) and about half of seventeenth-century
            ones (VD17, 2020). USTC links more than 500,000 digital copies, but those are links, not
            distinct editions.
          </p>
        </section>

        <section className="mb-16">
          <h2 className={H2}>Books printed in English</h2>
          <p className={P}>
            Books printed in English need no translation, but they are not automatically readable:
            the type is old, the spelling varies and most survive only as photographs.
          </p>
          <Table
            head={['Question', 'Figure', 'Unit and source']}
            rows={[
              ['How much was printed', 'about 164,000 editions to 1700, grouped into about 93,600 works; about 500,000 records to 1800', 'editions and works, USTC and Source Library census; records, English Short Title Catalogue'],
              ['How much is scanned', 'more than 146,600 titles to 1700; 150,000 to 180,000 titles of the 1700s', 'titles, Early English Books Online and Eighteenth Century Collections Online (both subscription)'],
              ['How much is typed out and free', 'about 60,000 texts', 'texts, Text Creation Partnership (public domain since 2020)'],
              ['How much is on Source Library', '18,542 of the works to 1700 (20%)', 'works, Source Library'],
            ]}
          />
          <p className={P}>
            So almost every surviving English book from before 1700 has been photographed, though
            most of the images sit behind a subscription, and about two in five of those titles have
            been transcribed into free, searchable text.
          </p>
        </section>

        <section className="mb-16">
          <h2 className={H2}>Manuscript traditions of Europe and the Near East</h2>
          <Table
            head={['Tradition', 'How much survives', 'How much is scanned', 'How much is in English']}
            rows={[
              ['Hebrew', '85,000 to 100,000 manuscripts (National Library of Israel)', 'more than half catalogued in Ktiv, with images', '24% of the words in the Sefaria library are translated (all periods)'],
              ['Greek', 'about 40,000 to 50,000 manuscripts (Pinakes, IRHT)', 'no estimate', 'no estimate'],
              ['Medieval Latin', 'no census; about 90,000 manuscripts traced through sales and collections (Schoenberg Database)', 'Vatican Library about 15,000 of 80,000 codices online (2018)', 'no estimate'],
              ['Armenian', 'about 20,000 to 23,000 manuscripts in the Matenadaran, Yerevan', 'about a third (2016)', 'no estimate'],
              ['Syriac', '10,000 to 20,000 manuscripts (unverified)', 'no estimate', 'no estimate'],
              ["Ge'ez (Ethiopic)", '25,000 to more than 200,000 manuscripts, mostly 19th and 20th century copies', 'under 5%', 'no estimate'],
            ]}
          />
          <p className={P}>
            For these traditions the only translation figures are the sizes of particular series,
            such as the Dumbarton Oaks Medieval Library&apos;s ninety-odd volumes. None of them says
            what share of the whole has reached English.
          </p>
        </section>

        <section className="mb-16">
          <h2 className={H2}>Arabic, Persian, Turkish, Sanskrit and Tibetan</h2>
          <Table
            head={['Tradition', 'How much survives', 'How much is scanned', 'How much is in English']}
            rows={[
              ['Arabic, Persian, Ottoman Turkish', '3 to 4 million manuscripts worldwide, an estimate with no stated method (Roper, Déroche); Turkey about 250,000 (2005)', 'Turkey about 485,000 manuscripts and rare printed books online (2026); Qatar Digital Library 2.5 million pages', 'no estimate; one scholar’s guess that about 10% of classical Arabic works have been published at all (Makdisi)'],
              ['Sanskrit and other Indian languages', '5 to 10 million manuscripts in India, about three quarters Sanskrit (National Mission for Manuscripts)', 'about 800,000 digitised, 440,000 online (2026)', 'no estimate'],
              ['Tibetan', 'Kangyur and Tengyur canon: about 4,500 to 5,300 texts in 232,000 pages; no estimate for the rest', 'about 28 to 30 million pages scanned (BDRC)', 'Kangyur: 42% of its pages published in English (84000, December 2024); Tengyur: almost none'],
            ]}
          />
          <p className={P}>
            The Tibetan Kangyur is the one corpus in the world with a live count of how much is in
            English, because a single project set out to translate all of it and publishes its
            progress. Its target date is 2035.
          </p>
        </section>

        <section className="mb-16">
          <h2 className={H2}>China, Japan, Korea and Vietnam</h2>
          <Table
            head={['Tradition', 'How much survives', 'How much is scanned', 'How much is in English']}
            rows={[
              ['Chinese', 'more than 2.7 million registered copies in the national census; perhaps 200,000 distinct titles', 'about 130,000 items online (2023)', 'about 1% to 2% of the works in the Siku Quanshu (Source Library census)'],
              ['Japanese', 'about 500,000 works before 1868 (Kokusho Sōmokuroku)', '330,000 titles imaged (National Institute of Japanese Literature, 2026)', 'no estimate'],
              ['Korean', 'no national total; Kyujanggak alone holds more than 260,000 items', 'no estimate', 'no estimate'],
              ['Vietnamese Hán-Nôm', 'about 20,000 books at the Institute of Hán-Nôm Studies', 'about 1,300 of 5,200 titles at the National Library', 'no estimate'],
            ]}
          />
          <p className={P}>
            Japan has photographed its old books on the largest scale: 330,000 titles imaged and free
            to view, against about 500,000 works in its national bibliography. How much of that
            literature exists in English has not been counted.
          </p>
        </section>

        <section className="mb-16">
          <h2 className={H2}>Why the last column is mostly empty</h2>
          <p className={P}>
            Counting what exists is a librarian&apos;s job, and libraries have done it for centuries.
            Counting what is scanned is a by-product of digitisation projects. Counting what has
            been translated is nobody&apos;s job: translations are catalogued as new books in the
            language they were translated into, usually without a reliable link back to the
            original work. A catalogue search therefore finds only some of them, and for Latin we
            measured that it finds well under half.
          </p>
          <p className={P}>
            The way to fill the column is the one used for Latin: take a census of works, draw a
            random sample, and search each sampled work by hand or with a search-grounded checker
            for any published English translation. A few hundred works per tradition gives a share
            with a margin of a few percentage points. The censuses already exist for German, French,
            Italian, Spanish and Dutch print (USTC), for Chinese (the Siku Quanshu and the national
            register) and for Japanese (the Kokusho Sōmokuroku). We are building the
            translation side for the European languages next.
          </p>
        </section>

        <section className="mb-16">
          <h2 className={H2}>Sources</h2>
          <ul className="list-disc pl-6 text-sm text-secondary font-body leading-relaxed space-y-2">
            <li>Universal Short Title Catalogue, University of St Andrews: edition, copy and library totals (October 2025); per-language edition counts 1400 to 1700 drawn from the USTC data.</li>
            <li>Works, holdings and readable counts: Source Library census, October 2026. Editions are grouped into works within each author by matching the distinctive words of their titles; the grouping still splits some much-printed works and merges a few distinct ones.</li>
            <li>Latin translated share: blind stratified sample of 1,000 works, June 2026, two independent search-grounded checkers (agreement kappa 0.82): 93.3% [91.3 to 95.2] of Renaissance-composed works and 84.9% [82.3 to 87.3] of all printed Latin works without an English translation.</li>
            <li>VD16 and VD17 digitisation: Herzog August Bibliothek and Bayerische Staatsbibliothek reports (2025, 2020).</li>
            <li>English Short Title Catalogue (CERL); Early English Books Online and Eighteenth Century Collections Online title counts; Text Creation Partnership.</li>
            <li>Hebrew: National Library of Israel and Ktiv; Sefaria corpus statistics. Greek: Pinakes (IRHT). Medieval Latin: Schoenberg Database of Manuscripts; Vatican Library (2018). Armenian: Matenadaran (2016).</li>
            <li>Arabic script: Geoffrey Roper, <em>World Survey of Islamic Manuscripts</em>, and later estimates; Türkiye Yazma Eserler Kurumu (2005, 2026); Qatar Digital Library; George Makdisi as quoted by Devin Stewart (2015).</li>
            <li>India: National Mission for Manuscripts figures as reported by the Press Information Bureau (2026). Tibetan: 84000, <em>Year in Review 2024</em> and canon statistics; Buddhist Digital Resource Center (2025).</li>
            <li>China: national ancient-books census reports (2021, 2023). Japan: National Institute of Japanese Literature press release (July 2026). Korea: Kyujanggak; KORCIS. Vietnam: Institute of Hán-Nôm Studies.</li>
          </ul>
        </section>
      </article>
    </ContentPageLayout>
  );
}
