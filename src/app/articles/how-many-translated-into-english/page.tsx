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
  'Of some 855,000 works printed in Europe before 1700, between 26,000 and 73,000 have ever been put into English. Three ways of counting, and why the catalogues see so little.';

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
          Of the roughly 855,000 works printed in Latin, German, French, Italian, Spanish and Dutch
          before 1700, somewhere between 26,000 and 73,000 have ever been published in English. That
          is between three and nine in every hundred. The figure has never been counted directly,
          because there is no list to count. This is how we estimated it, and why the obvious method
          gives an answer ten to fifty times too small.
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
            Grouping the editions of the same text gives works: our grouping of the six largest
            languages comes to about 855,000 works, 306,000 of them in Latin. The method and its
            limits are in{' '}
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
            Searching all 855,000 works would take years. Searching a random sample takes days, and
            the share found in the sample, multiplied by the number of works, gives the total. We
            drew 1,000 Latin works at random in June 2026 and about 300 works in each of five other
            languages in October. An AI search agent looked for any published English translation of
            each, and recorded the translator, the publisher, the year and a line of evidence. For
            sixty works in each of the five languages a second model searched blind, and a third
            settled the disagreements by opening the sources.
          </p>
          <ByLanguageChart />
          <Table
            head={['Language', 'Works printed 1400–1700', 'Share ever in English', 'Works ever in English']}
            rows={[
              ['Latin', '306,352', '7% to 15%', '21,400 to 46,000'],
              ['French', '124,168', '1.3% to 8.7%', '1,600 to 10,800'],
              ['Dutch', '74,378', '0.7% to 7.6%', '500 to 5,700'],
              ['Spanish', '59,582', '1.7% to 7.6%', '1,000 to 4,500'],
              ['Italian', '68,819', '1.7% to 4.9%', '1,200 to 3,400'],
              ['German', '221,931', '0.3% to 1.3%', '700 to 2,900'],
              ['All six', '855,230', '3% to 9%', '26,400 to 73,200'],
            ]}
          />
          <p className={P}>
            The ranges are wide for two different reasons. For Latin the question is which works
            count. Of Latin works composed in the Renaissance, 7% have an English translation. Of all
            Latin works printed in the period, 15% do, because the printers also reissued Cicero,
            Augustine and Aquinas, and those were translated long ago.
          </p>
          <p className={P}>
            For the other languages the samples are small: about a dozen confirmed translations
            across the five double-checked subsets. The low end counts only works written in that
            language and later put into English. The high end also counts editions that were
            themselves translations, a French version of a Latin treatise or a Dutch printing of an
            English sermon, and it corrects for the search agent missing about four translations in
            ten. German is lowest: German printers produced vast numbers of sermons, disputations,
            ordinances and newsletters, and almost none of them have reached English.
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
            That is between a tenth and a fiftieth of what the sample finds. The method assumes the
            lists are independent catches, and these are not. All three are modern library records,
            and they favour the same famous works in the same recent translations. Lists that share
            a blind spot overlap more than independent ones would, and the estimate comes out too
            small. So capture and recapture here measures something narrower: how much of the
            English record the catalogues are able to see. The direct checks agree. For Latin the
            catalogues find English for 1.4% of works, against 7% to 15% in the sample. In the
            October samples, none of the 72 English editions the searches found were in the
            catalogue lists.
          </p>
          <p className={P}>
            This is the main finding of the exercise. A count built from catalogues, however
            carefully matched, sees only a few in every hundred of the translations that exist. Any statement
            that a book &ldquo;has never been translated&rdquo; resting on catalogue searches alone is
            weak evidence, which is why each Source Library book is searched individually before it
            is marked as a first translation.
          </p>
        </section>

        <section className="mb-16">
          <h2 className={H2}>What one scholarly catalogue counted</h2>
          <p className={P}>
            Scholars have counted one corner by hand. The Renaissance Cultural Crossroads catalogue,
            built at the University of Warwick by Brenda Hosington, Sara Barker and colleagues, lists
            the translations printed in England, Scotland and Ireland from 1473 to 1640, and English
            translations printed abroad. The project described &ldquo;over four thousand
            translations&rdquo;; by 2020 it held 6,482 entries, according to a review in{' '}
            <em>Renaissance et Réforme</em>. Philemon Holland&apos;s{' '}
            <Link href="/book/the-historie-of-the-world-commonly-called-the-naturall-trans?page=11">Pliny</Link>{' '}
            of 1601 is one of them.
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
            The catalogue counts editions, not works, and includes translations into Latin and other
            languages printed in Britain. So it holds fewer than 6,482 works in English, perhaps
            around 3,700 if reprints run at the rate they do in English printing generally. It covers
            only 168 years and only books printed then, while our estimate counts translations made at
            any date up to today. It should come out well below 26,000, and it does. It is a floor,
            not a check on the upper end.
          </p>
        </section>

        <section className="mb-16">
          <h2 className={H2}>Where Source Library stands</h2>
          <p className={P}>
            Within the same six languages and the same works, Source Library has 6,533 works readable
            in English: 5,234 in Latin, 652 in German, 221 in Dutch, 204 in French, 193 in Italian and
            29 in Spanish. Set against an English record of 26,000 to 73,000 works, that is the same
            order as a tenth to a quarter of everything ever translated from early European print,
            although some of ours had been translated before. Across the whole library, all periods
            and languages, 11,357 books are marked as the first English translation of their work,
            each after its own search.
          </p>
          <p className={P}>
            In German the two figures are closest. The sample suggests that 700 to 2,900 German works
            printed before 1700 had ever been published in English. Source Library has 652.
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
            readers. Where they disagreed with a second model, a third read the sources, and the
            known error rate is built into the high end of each range. Missed translations push the
            estimate down, so if it is wrong it is more likely too low than too high.
          </p>
          <p className="font-body text-sm text-stone-500 leading-relaxed">
            Sources: Universal Short Title Catalogue (St Andrews), grouped into works by Source
            Library (October 2026). Library of Congress MARC records (2016 snapshot), Open Library and
            Wikidata, matched to those works. Renaissance Cultural Crossroads, University of Warwick;
            review in <em>Renaissance et Réforme</em> 43.3 (2020). Samples, searches and arithmetic:{' '}
            <a href="https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/blob/main/scripts/eval/experiments/2026-11-02-english-translations-ever-estimate.md">the experiment note</a>.
          </p>
        </section>
      </article>
    </ContentPageLayout>
  );
}
