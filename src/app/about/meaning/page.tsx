import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { EVIDENCE, GAPS, IDEA_EXAMPLE, LIVE, MEASURED_ON, PICTURE_EXAMPLE, PLANS } from './content';

export const metadata: Metadata = {
  title: 'Search by Meaning | Source Library',
  description:
    'How the library finds passages that say the same thing in different words and different languages: two real examples, what works today, what does not, and what we plan to build.',
  alternates: { canonical: '/about/meaning' },
};

const A = 'text-accent-rust hover:underline';
const H2 = 'text-2xl md:text-3xl text-primary mb-3';
const P = 'text-secondary leading-relaxed mb-4';

function PageImage({ img }: { img: { src: string; width: number; height: number; alt: string; caption: string; href: string } }) {
  return (
    <figure className="m-0 min-w-0">
      <Link href={img.href} className="block border border-light rounded bg-white/60 p-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img.src} alt={img.alt} width={img.width} height={img.height} loading="lazy" className="block w-full h-auto max-h-[420px] object-contain" />
      </Link>
      <figcaption className="text-xs text-muted mt-2 leading-snug">{img.caption}</figcaption>
    </figure>
  );
}

function Quote({ text, who, where, href }: { text: string; who: string; where?: string; href: string }) {
  return (
    <blockquote className="m-0 border-l-2 border-accent-rust pl-4 py-1">
      <p className="text-primary leading-relaxed mb-1">“{text}”</p>
      <footer className="text-sm text-muted">
        {where && <span className="font-semibold text-secondary">{where}. </span>}
        {who}. <Link href={href} className={A}>Read the page</Link>
      </footer>
    </blockquote>
  );
}

export default function MeaningPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Search by Meaning"
          subtitle="How the library finds passages that say the same thing in different words, what that makes possible, and what does not work yet."
        />
      }
      bg="bg-cream"
    >
      <div className="max-w-3xl">
        <p className="text-lg text-secondary leading-relaxed mb-4">
          The books here are in Latin, Greek, Arabic, Hebrew, Sanskrit, Chinese, Tibetan and a dozen other languages.
          Two of them can describe the same thing and share no word. A search for words will find one and miss the
          other.
        </p>
        <p className={P}>
          So each page also gets a second kind of index entry. A model reads the page and writes a list of 768 numbers
          that stands for what the page is about. Pages about the same thing get similar numbers, whatever their
          language. About 6.7 million pages and 150,000 pictures have one. Comparing those numbers is what we mean by
          searching by meaning.
        </p>
        <p className={P}>
          Below are two things this has done with real pages, then what it does for readers today, where it falls
          short, and what we plan to build. The figures were measured on {MEASURED_ON}, and each links to its test.
        </p>
      </div>

      <section className="mt-12" id="picture">
        <div className="max-w-3xl">
          <h2 className={H2}>Example 1. A picture finds the page that explains it</h2>
          <p className={P}>
            Michael Maier’s <em>Atalanta fugiens</em> (1618) is a book of fifty alchemical emblems. We gave the model
            the picture alone, with no caption, and asked which page of an English manuscript translation of the book
            it belonged to. The manuscript has 194 pages and no pictures.
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-2 max-w-4xl mt-2">
          <PageImage img={PICTURE_EXAMPLE.picture} />
          <PageImage img={PICTURE_EXAMPLE.page} />
        </div>
        <div className="max-w-3xl mt-6">
          <p className={P}>For the picture on the left, the first page it chose was the one on the right. It reads:</p>
          <Quote text={PICTURE_EXAMPLE.page.quote} who="Atalanta fugiens, English manuscript, discourse 21" href={PICTURE_EXAMPLE.page.href} />
          <p className={`${P} mt-5`}>
            Across the 44 emblems we hold a clean picture of, the first page chosen belonged to the right emblem 34
            times. Picking a page at random would be right less than once. This is a test, not yet a feature of the
            site. <a href={EVIDENCE.prototypes} className={A}>The test</a>
          </p>
        </div>
      </section>

      <section className="mt-14 max-w-3xl" id="idea">
        <h2 className={H2}>Example 2. One idea in four traditions</h2>
        <p className={P}>
          At the end of the <em>Republic</em>, Plato tells of a soldier who dies, sees the dead judged, and comes back
          to report it.
        </p>
        <Quote text={IDEA_EXAMPLE.start.quote} who={IDEA_EXAMPLE.start.who} where={IDEA_EXAMPLE.start.where} href={IDEA_EXAMPLE.start.href} />
        <p className={`${P} mt-5`}>
          We asked for the nearest page to this one in each other tradition in a test set of 304 books. These are the
          three it returned. None of them mentions Plato.
        </p>
        <div className="space-y-5">
          {IDEA_EXAMPLE.found.map(f => (
            <Quote key={f.href} text={f.quote} who={f.who} where={f.where} href={f.href} />
          ))}
        </div>
        <p className={`${P} mt-5`}>
          The quotations are from our machine translations; follow each link to see the original page beside it. This
          was the best result of 25 tries, not a typical one. The typical result is under{' '}
          <a href="#gaps" className={A}>what does not work yet</a>.
        </p>
      </section>

      <section className="mt-14" id="live">
        <h2 className={`${H2} max-w-3xl`}>What it does today</h2>
        <div className="grid gap-4 md:grid-cols-2 max-w-4xl">
          {LIVE.map(r => (
            <article key={r.title} className="border border-light rounded bg-white/60 p-4 min-w-0">
              <h3 className="text-lg text-primary font-semibold mb-1">{r.title}</h3>
              <p className="text-sm text-secondary leading-snug mb-2">{r.body}</p>
              {r.href && <Link href={r.href} className={`text-sm ${A}`}>{r.link}</Link>}
            </article>
          ))}
        </div>
        <p className="text-sm text-muted mt-4 max-w-3xl">
          Which models do this work is listed on <Link href="/about/models#search" className={A}>the models we use</Link>.
        </p>
      </section>

      <section className="mt-14 max-w-3xl scroll-mt-24" id="gaps">
        <h2 className={H2}>What does not work yet</h2>
        <ul className="list-none p-0 m-0 space-y-5">
          {GAPS.map(g => (
            <li key={g.title}>
              <h3 className="text-lg text-primary font-semibold mb-1">{g.title}</h3>
              <p className="text-secondary leading-relaxed">
                {g.body} <a href={g.evidence} className={A}>The test</a>
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-14" id="plans">
        <div className="max-w-3xl">
          <h2 className={H2}>What we plan to build</h2>
          <p className={P}>
            In the order we expect to build them. “Tested” means a small trial with real pages is linked on this page;
            “planned” means no trial yet.
          </p>
        </div>
        <ol className="list-none p-0 m-0 grid gap-4 md:grid-cols-2 max-w-4xl">
          {PLANS.map((p, i) => (
            <li key={p.title} className="border border-light rounded bg-white/60 p-4 min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 mb-1">
                <h3 className="text-lg text-primary font-semibold">{i + 1}. {p.title}</h3>
                <span className={`inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] ${p.status === 'tested' ? 'text-primary border-accent-rust' : 'text-secondary border-light'}`}>{p.status}</span>
              </div>
              <p className="text-sm text-secondary leading-snug">{p.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-14 max-w-3xl" id="cost">
        <h2 className={H2}>What it costs</h2>
        <p className={P}>
          Writing the numbers for a page costs a few thousandths of a cent, and a few hundred dollars for every page in
          the library. The two-sentence descriptions that help a search cross traditions would cost about $530 for
          every page, so we are testing them on a part of the library first.
        </p>
        <p className={P}>
          The full list of ideas we considered, with the published work each rests on, is in{' '}
          <a href={EVIDENCE.opportunities} className={A}>our working notes</a>. How the index is built is in{' '}
          <a href={EVIDENCE.howItWorks} className={A}>the technical description</a>, and the steps every book goes
          through are in <Link href="/how-it-works" className={A}>how Source Library works</Link>.
        </p>
      </section>
    </ContentPageLayout>
  );
}
