import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import { PASSAGES } from './passages';

// A static reading page that belongs to the Drebbel collection (#5936). It
// lives beside `collections/[id]`, which still answers `/collections/drebbel`
// because this folder has no page of its own at that level.
//
// The edition these passages were read from stays hidden (rights), so nothing
// here links to it and no page image from it is shown.

export const metadata: Metadata = {
  title: 'Beeckman on Drebbel: the journal passages, 1619–1634 - Source Library',
  description:
    'What Isaac Beeckman wrote in his journal about Cornelis Drebbel’s machines: the boat that went under water, the perpetual motion, the weather-glass, the sun-driven harpsichord. His own Dutch and Latin, with an English translation, the date and the manuscript leaf.',
  openGraph: {
    title: 'Beeckman on Drebbel: the journal passages, 1619–1634',
    description:
      'Isaac Beeckman’s notes on Cornelis Drebbel’s machines, in his own Dutch and Latin with an English translation beside each.',
  },
  alternates: {
    canonical: '/collections/drebbel/beeckman',
  },
};

export default function BeeckmanOnDrebbelPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Beeckman on Drebbel"
          subtitle="What Isaac Beeckman wrote in his journal about Cornelis Drebbel&rsquo;s machines, 1619 to 1634, in his own words with an English translation"
        />
      }
      bg="bg-cream"
    >
      <div className="mb-8">
        <Link
          href="/collections/drebbel"
          className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors text-sm"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          Cornelis Drebbel collection
        </Link>
      </div>

      <article className="max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8 font-body">
          Isaac Beeckman kept a notebook from 1604 to 1634, first in Zeeland and then as a
          schoolmaster in Utrecht, Rotterdam and Dordrecht. Cornelis Drebbel was at work in London for most
          of those years, and Beeckman followed him from a distance: through a letter from his
          father, through people who had seen the machines, and at the end through Drebbel&rsquo;s
          own son-in-law. He wrote down what he heard and then worked out for himself how each
          machine might be made.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          These are the passages in which he names Drebbel, in the order he wrote them. Each is
          given in his own words, Dutch or Latin as he wrote it, with a literal English translation
          beside it, the date, and the leaf of the manuscript. Long entries are cut down to the
          part about Drebbel, and a cut is marked [&hellip;]. The line in italics above a passage
          is Beeckman&rsquo;s own heading, written in his margin.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The manuscript is kept at the ZB, the library of Zeeland, in Middelburg. The text here
          follows the transcription of Cornelis de Waard (<em>Journal tenu par Isaac Beeckman de
          1604 &agrave; 1634</em>, The Hague, 1939&ndash;1953), and each passage was checked
          against his printed page. His notes and commentary are not reproduced. Spelling is
          Beeckman&rsquo;s and punctuation follows the edition. Where de Waard corrected or
          supplied a word, the manuscript reading he records is printed, and the translation says
          so when it matters. The English is Source Library&rsquo;s own, made with AI assistance
          as a literal aid to the original; [?] marks a reading we are not sure of.
        </p>

        <hr className="border-border-light my-12" />

        {PASSAGES.map((p) => (
          <section key={p.id} id={p.id} className="mb-16 scroll-mt-24">
            <h2 className="font-serif text-2xl md:text-3xl text-primary mb-2">{p.title}</h2>
            <p className="text-sm text-muted mb-6">
              {p.date} &middot; {p.source}
            </p>

            <div className="bg-warm rounded-xl p-6 border border-border-light">
              {p.head && (
                <p lang="la" className="text-secondary italic font-body leading-relaxed mb-4">
                  {p.head}
                </p>
              )}
              <div className="grid gap-8 md:grid-cols-2">
                <div lang={p.lang}>
                  {p.original.map((para, i) => (
                    <p key={i} className="text-secondary font-body leading-relaxed mb-4 last:mb-0">
                      {para}
                    </p>
                  ))}
                </div>
                <div>
                  {p.translation.map((para, i) => (
                    <p key={i} className="text-primary font-body leading-relaxed mb-4 last:mb-0">
                      {para}
                    </p>
                  ))}
                </div>
              </div>
            </div>

            {p.note && <p className="text-sm text-muted leading-relaxed mt-4">{p.note}</p>}
          </section>
        ))}

        <hr className="border-border-light my-12" />

        <section className="mb-8">
          <h2 className="font-serif text-2xl text-primary mb-4">Left out</h2>
          <p className="text-secondary leading-relaxed mb-6 font-body">
            One entry that de Waard&rsquo;s index files under Drebbel is not here: the
            weather-glass Beeckman saw on 9 November 1621 in the best room of the town hall at
            Delft, a gift to the magistrates from some people from Bohemia (fol. 161bis r&ndash;v).
            He describes it closely and heads the entry <em lang="la">Vitrum aeris calorem
            indicans prim&ograve; a me visum</em>, a glass showing the heat of the air, seen by me
            for the first time, but he does not name Drebbel. It is the glass &ldquo;in the town
            hall at Delft&rdquo; that he looks back to in 1622.
          </p>
          <p className="text-secondary leading-relaxed font-body">
            Drebbel&rsquo;s own books, and what other contemporaries wrote about him, are in the{' '}
            <Link href="/collections/drebbel" className="text-accent-rust hover:underline">
              Cornelis Drebbel collection
            </Link>
            .
          </p>
        </section>
      </article>
    </ContentPageLayout>
  );
}
