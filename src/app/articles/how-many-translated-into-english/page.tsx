import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import PageFigure from '@/components/articles/PageFigure';
import { withArticleMeta } from '@/lib/article-metadata';
import { ByLanguageChart, InstrumentsChart } from './Charts';

const HERO = 'https://images.sourcelibrary.org/archived/6a19bfb49b13f9ea2b27283f/13.jpg';
const HERO_ALT =
  'Title page of The Divine Pymander of Hermes Mercurius Trismegistus (London, 1650), in a printed border: translated formerly out of the Arabick into Greek, thence into Latine and Dutch, and now into English by Doctor Everard.';
const TITLE = 'How Many Old Books Have Been Translated into English?';
const DESCRIPTION =
  'Of some 815,000 works printed in Europe before 1700, about 18,000 to 40,000 have ever been put into English. Three ways of counting, and why the catalogues see so little.';

export const metadata: Metadata = withArticleMeta('how-many-translated-into-english', {
  title: `${TITLE} - Articles - Source Library`,
  description: DESCRIPTION,
  openGraph: { images: [{ url: HERO, alt: HERO_ALT }], title: TITLE, description: DESCRIPTION },
  twitter: { card: 'summary_large_image', images: [{ url: HERO, alt: HERO_ALT }] },
  alternates: { canonical: '/articles/how-many-translated-into-english' },
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

export default function HowManyTranslatedPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader feature headerVariant="dark"
          title={TITLE}
          subtitle="An estimate for the books printed in Europe before 1700, made three ways"
          image={HERO}
          imageAlt={HERO_ALT}
        >
          <p className="text-stone-400 text-sm mt-4">2 November 2026 &middot; 9 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8 font-body">
          Of the roughly 815,000 works printed in Latin, German, French, Italian, Spanish and Dutch
          before 1700, somewhere around 18,000 to 40,000 have ever been published in English: two to
          five in every hundred. The figure has never been counted directly, because there is no
          list to count. This is how we estimated it, and why the obvious method gives an answer
          about ten times too small.
        </p>
        <p className={P}>
          In 1650 John Everard&apos;s{' '}
          <Link href="/book/the-divine-pymander-of-hermes-mercurius-trismegistus-in-everard?page=13">Divine Pymander</Link>{' '}
          gave English readers the Corpus Hermeticum for the first time. Its title page traces the
          text&apos;s journey &ldquo;out of the Arabick into Greek, and thence into Latine, and Dutch,
          and now out of the Original into English&rdquo;. Most of what Europe printed in its first
          two centuries of printing never made that last step.
        </p>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className={H2}>Why nobody knows</h2>
          <p className={P}>
            There is a good census of what was printed. The Universal Short Title Catalogue at St
            Andrews lists more than 1.65 million surviving editions printed in Europe before 1700.
            Grouping the editions of the same text gives works: about 267,000 in Latin and 550,000 in
            the five largest vernaculars. The method and its limits are in{' '}
            <Link href="/articles/how-much-in-english">How Much of the Written Past Can You Read in English?</Link>
          </p>
          <p className={P}>
            There is no census of translations. UNESCO&apos;s Index Translationum, the nearest thing,
            covers books published from 1979 and stopped being updated about a decade ago. Library
            catalogues record many translations, but they rarely say which work a translation is of,
            in a form a computer can match to a sixteenth-century edition. A translation may also
            survive only as a chapter in an anthology, an appendix to a thesis or a pamphlet no
            catalogue lists. So the question &ldquo;has this ever been translated?&rdquo; cannot be
            answered by looking it up. It has to be searched for, one work at a time.
          </p>
        </section>

        <section className="mb-16">
          <h2 className={H2}>Counting by sample</h2>
          <p className={P}>
            Searching every work would take years. Searching a random sample takes days, and the
            share found in the sample, multiplied by the number of works, gives the total. We drew
            1,000 Latin works at random in June 2026 and about 300 works in each of five other
            languages in October. An AI search agent looked for any published English translation of
            each, and recorded the translator, the publisher, the year and a line of evidence. A
            second model checked a share of them blind, and a third settled the disagreements by
            opening the sources.
          </p>
          <ByLanguageChart />
          <Table
            head={['Language', 'Works printed 1400–1700', 'Ever in English']}
            rows={[
              ['Latin', '266,593', '15,600 to 25,400'],
              ['French', '124,168', '650 to 4,200'],
              ['Italian', '68,819', '500 to 2,700'],
              ['Spanish', '59,582', '430 to 2,300'],
              ['German', '221,931', '300 to 4,200'],
              ['Dutch', '74,378', '140 to 1,800'],
              ['All six', 'about 815,000', 'about 18,000 to 40,000'],
            ]}
          />
          <p className={P}>
            Latin carries most of the total. Part of the reason is that the presses also reprinted
            ancient and medieval authors, and many of those have long been in English. Counting only
            Latin works written in the Renaissance, the figure is 5,700 to 9,300, under one in
            twenty-five. The Latin
            counts are in works, not editions or title groups. A famous text was printed under many
            title wordings, and counting each wording as a separate work would inflate the
            translated side about two and a half times, because the famous texts are the translated
            ones.
          </p>
          <p className={P}>
            For the other languages two corrections matter. Many of the editions the searches found
            in English were not translations into English at all: a French printing of the{' '}
            <em>London Gazette</em>, a Dutch version of an English pamphlet, a Spanish rendering of
            James II&apos;s reasons for leaving Rochester. Others were translations of a Latin or
            Spanish book, whose English version is already counted under that language. Neither kind
            is counted here; only works first written in the language are. That leaves few
            confirmed cases, seventeen across the five samples and one in German, so each range is a
            95% interval and most are wide. The search agent also misses about four translations in
            ten, which pushes the true figures up within those ranges.
          </p>
        </section>

        <section className="mb-16">
          <h2 className={H2}>Letting the catalogues count each other</h2>
          <p className={P}>
            The second method needs no searching. Ecologists use it to count animals they cannot see
            all of: catch and tag 100 fish, release them, later catch another 100, and if 10 of the
            second catch carry tags, the lake holds about 1,000 fish. It is called capture and
            recapture. Two incomplete lists of the same population work like the two catches. The
            less they overlap, the more they are both missing.
          </p>
          <p className={P}>
            We have three lists of English translations whose catalogue records name the language
            they were translated from: the Library of Congress, Open Library and Wikidata. Matched
            against the Latin works, they find 498, 104 and 53 works, and 576 between them. They
            overlap little: the Library of Congress and Open Library share about 45 works, the
            Library of Congress and Wikidata about 33, Open Library and Wikidata about 2. Paired up,
            the overlaps give a total of between about 800 and 1,900 Latin works in English.
          </p>
          <InstrumentsChart />
          <p className={P}>
            That is roughly a tenth of what the sample finds. The method assumes the lists are
            independent catches, and these are not. All three are modern library records, and they
            favour the same famous works in the same recent translations. Lists that share a blind
            spot overlap more than independent ones would, and the estimate comes out too small. So
            capture and recapture here measures something narrower: how much of the English record
            these catalogues are able to see.
          </p>
          <p className={P}>
            The sample confirms it directly. Of the Latin works it found translated, the much larger
            catalogue of translations we assembled earlier, from the Index Translationum, the Library
            of Congress, Open Library, HathiTrust and the scholarly series, lists between one in four
            and one in ten. In the October samples for the other languages, it listed none of the
            translations the searches found. A statement that a book &ldquo;has never been
            translated&rdquo; resting on catalogue searches alone is weak evidence, which is why each
            Source Library book is searched individually before it is marked as a first translation.
          </p>
        </section>

        <section className="mb-16">
          <h2 className={H2}>What one scholarly catalogue counted</h2>
          <p className={P}>
            Scholars have counted one corner by hand. The Renaissance Cultural Crossroads catalogue,
            built at the University of Warwick under Brenda Hosington, lists the translations printed
            in England, Scotland and Ireland from 1473 to 1640, and English translations printed
            abroad: &ldquo;over four thousand translations&rdquo;, in the project&apos;s words.
            Philemon Holland&apos;s{' '}
            <Link href="/book/the-historie-of-the-world-commonly-called-the-naturall-trans?page=11">Pliny</Link>{' '}
            of 1601 is the kind of book it lists.
          </p>
          <div className="max-w-md mx-auto">
            <PageFigure
              src="https://images.sourcelibrary.org/archived/69ee4f2e6dd925d126f430a7/11.jpg"
              alt="Title page of The Historie of the World, Commonly Called the Naturall Historie of C. Plinius Secundus, translated into English by Philemon Holland, London, Adam Islip, 1601, with an engraved oval of the heavens."
              href="/book/the-historie-of-the-world-commonly-called-the-naturall-trans?page=11"
              source={<>Pliny the Elder, <em>The Historie of the World</em>, translated by Philemon Holland (London, 1601)</>}
              credit="Digitised by Google"
            />
          </div>
          <p className={P}>
            The catalogue counts editions, not works, and it includes translations into Latin and
            other languages printed in Britain. It covers only 168 years and only books printed then,
            and it reaches beyond our six languages to Greek and the classics. Our estimate counts
            translations made at any date up to today. So the catalogue should come out well below
            our figure, and it does. It shows the estimate is not too low; it cannot check the upper
            end.
          </p>
        </section>

        <section className="mb-16">
          <h2 className={H2}>Where Source Library stands</h2>
          <p className={P}>
            Within the same six languages, Source Library has 6,533 works readable in English: 5,234
            in Latin, 652 in German, 221 in Dutch, 204 in French, 193 in Italian and 29 in Spanish.
            Set against an English record of about 18,000 to 40,000 works, that is a sixth to a
            third as many as all earlier translators produced, though some of ours had been
            translated before. Across the whole library, all periods and languages, 11,357 books are
            marked as the first English translation of their work, each after its own search.
          </p>
          <p className={P}>
            German shows how much a small sample can miss. The German sample found one work first
            written in German with an English translation: Andreas Osiander&apos;s catechism of 1533,
            which Thomas Cranmer published in English in 1548. One case in about 300 is consistent
            with anything from a hundred to four thousand works. A check on a single author narrows
            it from below. Luther alone has 1,507 works in the German count, and of 25 drawn at
            random at least nine are in English, most of them in the American edition of{' '}
            <em>Luther&apos;s Works</em>: among them{' '}
            <em>The Freedom of a Christian</em>, the eight Wittenberg sermons of 1522 and the Large
            Catechism. That puts Luther alone at roughly 300 to 900 works in English, before Thomas
            Müntzer, Andreas Karlstadt, Paracelsus, Johann Arndt and the rest. A larger German
            sample is the next measurement to make.
          </p>
        </section>

        <section className="mb-16">
          <h2 className={H2}>What the estimate leaves out</h2>
          <p className={P}>
            It covers six European languages in print before 1700. It leaves out manuscripts,
            everything printed after 1700, and the other written traditions. For most of those there
            is no translated share at all, only the size of particular series: 42% of the pages of
            the Tibetan Kangyur were in English by the end of 2024, and perhaps 1% to 2% of the works
            in the Chinese imperial library, the Siku Quanshu. Those figures, tradition by tradition,
            are in{' '}
            <Link href="/articles/how-much-in-english">How Much of the Written Past Can You Read in English?</Link>
          </p>
          <p className={P}>
            The searches were made by AI agents and have not yet been checked by a panel of human
            readers. Errors run both ways. A search that misses a translation pushes the count down;
            the Latin work counts are upper bounds, because some editions of the same text were not
            recognised as the same work. The Latin sample was drawn from books printed 1480 to 1620
            and extended to 1400 to 1700.
          </p>
          <p className="font-body text-sm text-stone-500 leading-relaxed">
            Sources: Universal Short Title Catalogue (St Andrews), grouped into works by Source
            Library (2026). Library of Congress MARC records (2016 snapshot), Open Library and
            Wikidata, matched to those works. Renaissance Cultural Crossroads, University of Warwick.
            Samples, searches and arithmetic:{' '}
            <a href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/blob/main/scripts/eval/experiments/2026-11-02-english-translations-ever-estimate.md">the experiment note</a>.
          </p>
        </section>
      </article>
    </ContentPageLayout>
  );
}
