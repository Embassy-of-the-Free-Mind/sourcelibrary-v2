import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

const HERO = 'https://images.sourcelibrary.org/pages/69b1863dc4be2cdd0edc573a/0011.jpg';
const HERO_ALT = 'Title page of Oriatrike, or Physick Refined, the 1662 English Van Helmont, with an ink blot over one word.';

export const metadata: Metadata = {
  title: 'The Reading We Did Not Have to Pay For - Research Notes - Source Library',
  description:
    'Five and a half million of our untranscribed pages come from the Internet Archive, and the Archive already read them once. We tested that reading book by book against our own, took it where the two agree, and measured whether a cheap language model can rescue the rest.',
  openGraph: {
    images: [{ url: HERO, alt: HERO_ALT }],
    title: 'The Reading We Did Not Have to Pay For',
    description:
      'The Internet Archive already read 5.5 million of our pages. We tested its reading book by book against our own and took it where the two agree.',
  },
  twitter: { card: 'summary_large_image', images: [{ url: HERO, alt: HERO_ALT }] },
  alternates: { canonical: '/blog/free-reading' },
};

const P = 'text-secondary leading-relaxed mb-6 font-body';
const H2 = 'font-serif text-2xl md:text-3xl text-primary mb-6';
const TH = 'text-left font-medium text-primary py-2 pr-4 border-b border-border-light';
const TD = 'py-2 pr-4 align-top border-b border-border-light text-secondary';

export default function FreeReadingPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="The Reading We Did Not Have to Pay For"
          subtitle="Five and a half million of our pages were already read once, by a machine we did not run. Here is how we decided which of those readings to trust."
          image={HERO}
          imageAlt={HERO_ALT}
        >
          <p className="text-stone-400 text-sm mt-4">12 September 2026 &middot; 9 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="mb-8">
        <Link href="/blog" className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors text-sm">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All notes
        </Link>
      </div>

      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8 font-body">
          The library holds 21.2 million page images. Machines have read 6.5 million of them into text
          you can search, quote and translate. The other 12.6 million pages are pictures. A picture of a
          page cannot be searched, cannot be cited by sentence, and cannot be translated, so until a page
          is read it is not really in the library at all.
        </p>
        <p className={P}>
          Reading pages costs money. Our current reader, a Gemini vision model, transcribes a page for
          about a seventh of a cent when we batch the work, and rather more when we do not. Across 12.6
          million pages that is real money, and it is why so many books in the catalogue still show the
          first twenty-five pages as text and the rest as scans.
        </p>
        <p className={P}>
          But 5.5 million of those unread pages, in 26,348 books, came to us from the Internet Archive.
          And the Archive reads everything it scans. Every item carries a file of machine text, one block
          per leaf, produced by a conventional optical character reader, ABBYY FineReader or Tesseract
          depending on the year. That reading is free, it is instant, and for a hundred years of clean
          roman type it is often very good.
        </p>
        <p className={P}>
          It is also, on other books, very bad. This note is about how we tell the difference without
          looking at every page, what we found when we ran the test across our English books, and whether
          a cheap language model can fix the readings that fail.
        </p>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className={H2}>Where the unread pages are</h2>
          <p className={P}>
            Before deciding anything, we counted. The unread pages are not spread evenly.
          </p>
          <div className="overflow-x-auto mb-6">
            <table className="w-full text-sm font-body">
              <thead>
                <tr>
                  <th className={TH}>Language</th>
                  <th className={TH}>Pages not yet read</th>
                  <th className={TH}>Of which Internet Archive scans</th>
                </tr>
              </thead>
              <tbody>
                <tr><td className={TD}>Latin</td><td className={TD}>6,446,000</td><td className={TD}>2,511,000</td></tr>
                <tr><td className={TD}>Chinese</td><td className={TD}>1,660,000</td><td className={TD}>1,591,000</td></tr>
                <tr><td className={TD}>Greek</td><td className={TD}>1,633,000</td><td className={TD}>234,000</td></tr>
                <tr><td className={TD}>German</td><td className={TD}>756,000</td><td className={TD}>147,000</td></tr>
                <tr><td className={TD}>English</td><td className={TD}>458,000</td><td className={TD}>447,000</td></tr>
                <tr><td className={TD}>Sanskrit</td><td className={TD}>237,000</td><td className={TD}>212,000</td></tr>
                <tr><td className={TD}>French</td><td className={TD}>104,000</td><td className={TD}>82,000</td></tr>
              </tbody>
            </table>
          </div>
          <p className={P}>
            English is a small slice of the whole, but almost all of it is Archive material, and English
            roman type is the case the Archive&apos;s reader was built for. So English is where we started.
            Latin is the prize: two and a half million Archive pages, mostly nineteenth-century editions of
            classical and patristic texts in clean type. Chinese is the trap: the Archive&apos;s reader
            produces almost nothing usable on it, which we already knew from a July comparison of its
            output with ours across scripts and centuries.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className={H2}>Two readers, one leaf</h2>
          <p className={P}>
            The test is simple. Almost every book in the catalogue, however unfinished, already has its
            first twenty-five pages read by our own model. Those pages were paid for. The Archive read the
            same leaves. So for each book we can lay the two readings side by side, page for page, and ask
            how often they agree.
          </p>
          <p className={P}>
            Agreement is measured as the share of words that appear in the same order in both readings. A
            page where both say &ldquo;Arcas then, being the grandson of the antediluvian Lycaon&rdquo; scores
            near one. A page where the Archive says &ldquo;Areas then, being the grandfon of the ante-diluvian
            Lycaon, and the fon of CaUifto&rdquo; scores lower, and the words it lost tell you why: the
            book is from 1803, it is set with the long s, and a conventional reader sees an f.
          </p>
          <p className={P}>
            We take a book only when the median agreement across its sample pages is 0.85 or better. That
            threshold is deliberately strict. Agreement is not accuracy: two readers can make the same
            mistake, and where they differ we do not know from the score alone which one is right. What
            the score gives us is a bound. Where the two independent readings match on nineteen words in
            twenty, the free text is at least as reliable as the text we would have paid for, because the
            readers share no mechanism. One is a generative model that can, on a bad day, recite what it
            remembers instead of what it sees. The other is a pattern matcher that cannot remember anything.
            When they agree, neither failure mode is in play.
          </p>
          <p className={P}>
            The rule is per book, never per date. A 1848 Shaker memoir clears the bar at 0.93. A 1812
            Shaker treatise, three printers earlier and still using the long s, fails at 0.75. Same shelf,
            same decade, opposite verdicts, and the score sees it without anyone reading a page.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className={H2}>What happened on the English shelf</h2>
          <p className={P}>
            We ran the test across every English book in the catalogue with Archive scans and unread
            pages: 2,076 books. The Archive had no text file at all for 258 of them. For 452 more we had
            fewer than five pages of our own reading to compare against, so no verdict was possible. That
            left 1,366 books with a score.
          </p>
          <div className="overflow-x-auto mb-6">
            <table className="w-full text-sm font-body">
              <thead>
                <tr>
                  <th className={TH}>Verdict</th>
                  <th className={TH}>Books</th>
                  <th className={TH}>Pages we can fill</th>
                </tr>
              </thead>
              <tbody>
                <tr><td className={TD}>Accepted, agreement 0.85 or better</td><td className={TD}>624</td><td className={TD}>66,322</td></tr>
                <tr><td className={TD}>Rejected</td><td className={TD}>742</td><td className={TD}>136,545</td></tr>
                <tr><td className={TD}>No reference pages to compare</td><td className={TD}>452</td><td className={TD}>197,914</td></tr>
                <tr><td className={TD}>No Archive text file</td><td className={TD}>258</td><td className={TD}>&mdash;</td></tr>
              </tbody>
            </table>
          </div>
          <p className={P}>
            The accepted pages, 66,322 of them, were written into the library on 12 September. They carry a
            label in the page record saying where the text came from and what the agreement score was, so
            they can be found, measured separately, and replaced if a better reading ever arrives. Showing
            that label in the reader is the next step.
          </p>
          <p className={P}>
            The books that gained the most are the ones that were nearly done. Max M&uuml;ller&apos;s 1881
            translation of Kant&apos;s{' '}
            <Link href="/book/6954346c1479a63c11089602" className="text-accent-rust hover:underline">Critique of Pure Reason</Link>{' '}
            had 214 pages read and 380 unread; it gained 369 pages at agreement 0.93 and is now complete
            but for eleven leaves with too little text to take. The{' '}
            <Link href="/book/699246d6bc722ec0ee814ea5" className="text-accent-rust hover:underline">general index to the Sacred Books of the East</Link>{' '}
            gained 118 pages and is now searchable end to end.{' '}
            <Link href="/book/69aea4994f4f1b07d870c4c7" className="text-accent-rust hover:underline">A Report upon the Herculaneum Manuscripts</Link>{' '}
            (1811),{' '}
            <Link href="/book/69bf60dc065df5d87d778866" className="text-accent-rust hover:underline">Facts and Documents Illustrative of the History, Doctrine and Rites of the Ancient Albigenses</Link>{' '}
            (1832), the first volume of Blavatsky&apos;s{' '}
            <Link href="/book/6953e32877f38f6761beb98c" className="text-accent-rust hover:underline">Secret Doctrine</Link>, and Evans-Wentz&apos;s{' '}
            <Link href="/book/699249c9a2d53df4853bff47" className="text-accent-rust hover:underline">Fairy-Faith in Celtic Countries</Link>{' '}
            each gained between forty and seventy pages.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className={H2}>The rejects that were our fault</h2>
          <p className={P}>
            The first pass rejected far more than it should have. 292 books, a fifth of everything scored,
            sat in a narrow band of agreement between 0.10 and 0.20. That is too low to be bad reading: a
            reader that garbles every fifth word still scores around 0.8. A cluster that large and that
            uniform is nearly always the instrument, not the books.
          </p>
          <p className={P}>
            It was. On those items the Archive&apos;s text file starts one leaf later than our page
            numbering. Compare each of our pages with the Archive&apos;s block for the leaf before, and
            Jung&apos;s <em>Studies in Word-Association</em> goes from 0.15 to 0.94 across 592 pages;{' '}
            <em>Collectanea Chemica</em> goes from 0.16 to 0.91. The reader had been fine all along. The
            test now tries each book at several offsets, takes the one most pages agree on, and refuses
            any book whose alignment drifts from page to page. The 292 books are being re-scored.
          </p>
          <p className={P}>
            The two long-s books in the same cluster went from 0.15 to 0.77 and 0.69, and stayed rejected.
            That is the test working: the alignment was wrong and the reading was also not good enough.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className={H2}>Can a cheap model fix the rest?</h2>
          <p className={P}>
            The obvious next idea: the rejected text is mostly right and wrong in systematic ways, so hand
            it to a small language model, tell it to fix the long s and the broken words, and skip the
            image entirely. Text in, text out, no picture to upload. Surely that is cheaper than reading
            the page again.
          </p>
          <p className={P}>
            We tried it on sixty pages from ten books across the whole range, from a 1917 journal that
            already agreed at 0.92 down to the 1662 English Van Helmont on this page&apos;s header, with the
            cheapest current Gemini model and its reasoning switched off. Agreement with our image reading,
            before and after cleanup:
          </p>
          <div className="overflow-x-auto mb-6">
            <table className="w-full text-sm font-body">
              <thead>
                <tr>
                  <th className={TH}>Books</th>
                  <th className={TH}>Before</th>
                  <th className={TH}>After cleanup</th>
                </tr>
              </thead>
              <tbody>
                <tr><td className={TD}>Journal proceedings, 1912 and 1917</td><td className={TD}>0.92</td><td className={TD}>0.94</td></tr>
                <tr><td className={TD}>Illustrated magazine, 1880s, text pages</td><td className={TD}>0.90</td><td className={TD}>0.94</td></tr>
                <tr><td className={TD}>Same magazine, title and index pages</td><td className={TD}>0.61</td><td className={TD}>0.62</td></tr>
                <tr><td className={TD}>Van Helmont, 1662, long s throughout</td><td className={TD}>0.67</td><td className={TD}>0.76</td></tr>
                <tr><td className={TD}>Aristotle and Faber, 1801 and 1803, long s</td><td className={TD}>0.70</td><td className={TD}>0.78</td></tr>
              </tbody>
            </table>
          </div>
          <p className={P}>
            It helps, a little, everywhere. It does not get any rejected book over the bar. And two other
            things came out of those sixty pages that matter more than the averages.
          </p>
          <p className={P}>
            First, the price. The cleanup cost 0.13 cents a page. Reading the image with the same model in
            batch costs 0.15. The saving is not a tenth of the cost; it is a seventh, because what you pay
            for is the words coming out, and a cleaned page has as many words as a read one. The picture
            going in was never the expensive part.
          </p>
          <p className={P}>
            Second, what the model does when it cannot read something. On the Van Helmont title page there
            is an ink blot over the word &ldquo;Toparch&rdquo; in &ldquo;Toparch or Governor, in Merode,
            Royenborch, Oorschot, Pellines&rdquo;. Our image reader transcribed the line and flagged the blot.
            The Archive&apos;s reader produced a string of symbols. The cleanup model, given only those
            symbols, wrote &ldquo;Lord of Merode, Royenborch, Oorschot, Pellines&rdquo;. Fluent, plausible,
            and not on the page.
          </p>
          <p className={P}>
            On the index page of an 1888 magazine volume, the Archive had mangled every author&apos;s name
            into fragments. The cleanup model restored them: <em>John G. Nicolay</em> for the article on
            Lincoln and secession, <em>M. G. van Rensselaer</em> for the one on Mary Magdalene,{' '}
            <em>William L. Greene</em> for the postal service. The page says R. D. Mussey, H. W. Compton and
            Thomas L. Greene. Of eight names it supplied, one was right. The text it produced was twice as
            long as the text it was given, and every added word was a guess dressed as a reading.
          </p>
          <p className={P}>
            That is the failure we built this whole test to avoid. A conventional reader cannot invent; a
            language model with no image in front of it can do nothing else where the input is broken. So
            the answer is no. Where the Archive&apos;s reading fails, we read the page again, from the
            picture, and we pay the seventh of a cent.
          </p>
        </section>

        <hr className="border-border-light my-12" />

        <section className="mb-16">
          <h2 className={H2}>What it adds up to</h2>
          <p className={P}>
            For English, the free share is worth a few hundred dollars of reading and a great deal of
            waiting: the accepted pages arrive today rather than when the queue reaches them. The 452 books
            with no reference pages are the larger opportunity. Reading eight pages of each, enough to run
            the test, costs about five dollars in total, and would let the same free reading fill on the
            order of a hundred thousand pages more.
          </p>
          <p className={P}>
            For Latin, the same test will now run shelf by shelf. That July comparison of the
            Archive&apos;s reading against ours, by script and century, says what to expect:
            nineteenth-century French agreed at 82 percent, nineteenth-century Latin at 68, German in
            Fraktur at 59, and everything printed before 1700 at half or less. Most early books will be
            refused, and that is the point. The test costs nothing to run and the refusals are what
            makes the acceptances worth having.
          </p>
          <p className={P}>
            The principle underneath is one we keep returning to. A reading is not trustworthy because of
            who made it; it is trustworthy because something independent agrees with it. The Archive gave
            us a second witness for five and a half million pages. We are using it as a witness, not as an
            oracle.
          </p>
        </section>

        <section className="mb-16">
          <h2 className={H2}>Books to check</h2>
          <p className={P}>
            These are the books that gained the most pages from the Archive&apos;s reading in the first
            pass, with the agreement score the test measured for each. If you read one and find a page
            the reading got wrong, the feedback button on the page reaches us.
          </p>
          <div className="overflow-x-auto mb-6">
            <table className="w-full text-sm font-body">
              <thead>
                <tr>
                  <th className={TH}>Book</th>
                  <th className={TH}>Pages filled</th>
                  <th className={TH}>Agreement</th>
                </tr>
              </thead>
              <tbody>
                <tr><td className={TD}><Link href="/book/6954346c1479a63c11089602" className="text-accent-rust hover:underline">Kant, Critique of Pure Reason, tr. M&uuml;ller (1881)</Link></td><td className={TD}>369</td><td className={TD}>0.93</td></tr>
                <tr><td className={TD}><Link href="/book/699246d6bc722ec0ee814ea5" className="text-accent-rust hover:underline">Sacred Books of the East, General Index</Link></td><td className={TD}>118</td><td className={TD}>0.90</td></tr>
                <tr><td className={TD}><Link href="/book/69bf60dc065df5d87d778866" className="text-accent-rust hover:underline">Facts and Documents on the Ancient Albigenses (1832)</Link></td><td className={TD}>65</td><td className={TD}>0.92</td></tr>
                <tr><td className={TD}><Link href="/book/69aea4994f4f1b07d870c4c7" className="text-accent-rust hover:underline">A Report upon the Herculaneum Manuscripts (1811)</Link></td><td className={TD}>54</td><td className={TD}>0.88</td></tr>
                <tr><td className={TD}><Link href="/book/6953e32877f38f6761beb98c" className="text-accent-rust hover:underline">Blavatsky, The Secret Doctrine, vol. I (1899 printing)</Link></td><td className={TD}>51</td><td className={TD}>0.93</td></tr>
                <tr><td className={TD}><Link href="/book/699249c9a2d53df4853bff47" className="text-accent-rust hover:underline">Evans-Wentz, The Fairy-Faith in Celtic Countries (1911)</Link></td><td className={TD}>46</td><td className={TD}>0.94</td></tr>
                <tr><td className={TD}><Link href="/book/69bd959cd9007d72ade0c81c" className="text-accent-rust hover:underline">Cumont, The Oriental Religions in Roman Paganism (1911)</Link></td><td className={TD}>30</td><td className={TD}>0.92</td></tr>
                <tr><td className={TD}><Link href="/book/69905961aaa7f10ed4cfaf55" className="text-accent-rust hover:underline">Heindel, The Rosicrucian Cosmo-Conception (1910)</Link></td><td className={TD}>30</td><td className={TD}>0.94</td></tr>
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted font-body">
            Method and code: the test is <code>scripts/import/ia-ocr-ingest.mjs</code> in the public
            repository; the cleanup experiment and its sixty page-triplets are recorded there too. All
            counts are from 12 September 2026 and will drift.
          </p>
        </section>
      </article>
    </ContentPageLayout>
  );
}
