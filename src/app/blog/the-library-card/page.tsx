import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'The Library Card - Research Notes - Source Library',
  description:
    'We used to badge books as "first translations" — a claim about the absence of any prior, which no search can prove. We replaced the badge with something older and better: a library card. One list of known English translations per work, cited, checkable, and honest about where we looked.',
  openGraph: {
    title: 'The Library Card',
    description:
      'We replaced an unprovable claim with a library card: one cited list of known English translations per work, spot-checked by independent verifiers, live on every book page.',
    images: [{ url: 'https://images.sourcelibrary.org/archived/6958ea099659a6529d577d58/1.jpg', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: 'https://images.sourcelibrary.org/archived/6958ea099659a6529d577d58/1.jpg' }],
  },
  alternates: {
    canonical: '/blog/the-library-card',
  },
};

export default function TheLibraryCardPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="The Library Card"
          subtitle="We replaced our boldest claim with something a reader can check"
          image="https://images.sourcelibrary.org/archived/6958ea099659a6529d577d58/1.jpg"
          imageAlt="A page of the 1546 Latin De Materia Medica of Dioscorides — a work whose English translation history is now written on its card."
        >
          <p className="text-stone-400 text-sm mt-4">11 August 2026 &middot; 7 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="mb-6">
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All notes
        </Link>
      </div>

      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8">
          Here is a question no institution on earth can answer: <em>has this book ever been
          translated into English?</em> There is no registry of translations. The closest thing
          ever attempted has been moribund for a decade. And yet for two years we put a badge on
          thousands of books that quietly answered it anyway: <em>First Translation</em> &mdash;
          a claim that nobody, anywhere, ever, had done this before. We have now replaced that
          badge with something older, humbler, and much harder to argue with: a library card.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          This is a sequel to{' '}
          <Link href="/blog/nobody-knows-what-has-been-scanned" className="text-accent-rust underline">
            <em>Nobody Knows What Has Been Scanned</em>
          </Link>
          , which argued that the digitization question is unanswerable for lack of a shared list.
          The translation question is worse. A scan is an artifact an institution holds; build the
          list and the question closes. A prior translation may survive as a Victorian periodical
          chapter, a dissertation appendix, or a privately printed pamphlet no union catalogue has
          ever indexed. Absence from every list is where the question <em>starts</em>. You cannot
          look up a negative. You can only search, and say where you searched.
        </p>

        <h2 className="font-display text-2xl text-primary mt-12 mb-4">The problem with the badge</h2>

        <p className="text-secondary leading-relaxed mb-6">
          A &ldquo;First Translation&rdquo; badge is a boolean wearing a tuxedo. Behind ours stood
          a genuinely serious apparatus &mdash; grounded search agents, an append-only ledger of
          every query ever run, an eight-way verdict taxonomy, a nightly reconciliation job with a
          safety valve &mdash; and the apparatus kept growing, because a universal negative can
          never be settled. Every incident added a mechanism. Nothing ever retired one. When we{' '}
          <Link href="/blog/counting-first-translations" className="text-accent-rust underline">
            audited the badge with independent agents
          </Link>
          , the deepest finding was not that some badges were wrong. It was that the largest error
          class was not error at all but <em>ill-posedness</em>: badges on multi-work volumes,
          on liturgy copies, on unique documents &mdash; books for which the question
          &ldquo;first?&rdquo; has no clean meaning.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          The fault was structural. A first translation is a fact about a <em>work</em> &mdash;
          about the <em>Colliget</em>, not about our particular scan of it &mdash; and we were
          asking the question per book. Ask it at the wrong grain and it must be re-derived
          forever; five scans of one text can end up telling readers five different stories.
          Twelve of the first twenty works we checked had sibling editions that publicly
          disagreed with each other about the badge.
        </p>

        <h2 className="font-display text-2xl text-primary mt-12 mb-4">The card</h2>

        <p className="text-secondary leading-relaxed mb-6">
          What a librarian would have done from the start is keep a card. One card per work: the
          list of known English translations, each with a citation. Possibly empty &mdash; with a
          note saying where we looked. That is the whole design. Three rules govern it:
        </p>

        <ol className="list-decimal pl-6 text-secondary leading-relaxed mb-8 space-y-2">
          <li>
            <strong>One list per work.</strong> Editions inherit it. A composite volume decomposes
            into its constituent works&rsquo; cards instead of carrying one ill-posed badge.
          </li>
          <li>
            <strong>One sentence on the site.</strong> If the list is empty and we hold an English
            rendering: <em>&ldquo;No earlier English translation of this work is known to
            us&rdquo;</em> &mdash; with the search behind it. That sentence is the badge now.
            &ldquo;Known to us&rdquo; plus a documented search is the truth; the old boolean was
            a promise nobody could keep.
          </li>
          <li>
            <strong>One process.</strong> Anyone &mdash; human or machine &mdash; proposes an
            entry <em>with a citation</em>. A reviewer merges it. Nothing lands on a card
            unreviewed.
          </li>
        </ol>

        <p className="text-secondary leading-relaxed mb-8">
          The cards are live. Averroes&rsquo;s{' '}
          <Link href="/book/colliget-averroes" className="text-accent-rust underline">
            <em>Colliget</em>
          </Link>{' '}
          carries the first register: no earlier English translation known to us. Dioscorides&rsquo;s{' '}
          <Link href="/book/de-materia-medica-versio-latina-dioscorides" className="text-accent-rust underline">
            <em>De Materia Medica</em>
          </Link>{' '}
          carries the other: English translations exist, and the card names the earliest &mdash;
          John Goodyer&rsquo;s, made 1652&ndash;55, unpublished until Oxford printed it in 1934 &mdash;
          with the records to check. Every entry is a claim you can follow to its source. That is
          the difference between a badge and a card: a badge asks to be believed; a card asks to
          be checked.
        </p>

        <h2 className="font-display text-2xl text-primary mt-12 mb-4">Checking our own cards</h2>

        <p className="text-secondary leading-relaxed mb-6">
          We seeded 919 cards from claims our verification pipeline had already independently
          confirmed, then spent three rounds attacking them. The method is deliberately
          adversarial: independent AI verifiers, <em>unprimed</em> &mdash; they are handed the
          work, never our card &mdash; and told either to open every cited record and confirm it
          says what we say, or to hunt for the translation our empty card claims does not exist.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          Three findings, in ascending order of comfort. First: our entry extraction was noisy
          &mdash; 41.5% of machine-suggested entries died under one rule, <em>no citation, no
          entry</em>. Second: five entries were fabrications, and every one wore the same
          disguise &mdash; a real scholar&rsquo;s name attached to an invented title. A
          &ldquo;C.J.S. Thompson, 1932, <em>Chrysopoeia</em>&rdquo; looks exactly like
          scholarship; Thompson&rsquo;s actual 1932 book, when you read it, contains no such
          thing. No formatting rule catches this class. Only a verifier who goes and reads the
          book does &mdash; which is why the process rule exists. Third, and the comfort: across
          every round, every attack on an <em>absence</em> claim failed. Fourteen of fourteen
          &ldquo;none known to us&rdquo; cards survived genuine attempts to refute them. The
          searching was never the weak layer. The weak layers were hygiene and identity &mdash;
          and those are exactly what cards make visible and cheap to fix.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          Verification cut the other way too. Our card for Paracelsus&rsquo;s theological works
          listed four claimed prior translations. All four died under checking &mdash; two were
          medical works in disguise, one an anthology of fragments, one a fabrication. The
          theological Paracelsus, it turns out, has genuinely never been Englished. The claim
          came out of the audit <em>stronger</em>. Honest verification does that: it does not
          only demote.
        </p>

        <h2 className="font-display text-2xl text-primary mt-12 mb-4">The address problem</h2>

        <p className="text-secondary leading-relaxed mb-8">
          The sharpest discovery was not about translations at all. A card is a fact filed under
          an address &mdash; a work identifier &mdash; and when we sampled cards keyed to
          Wikidata entities, four of five were filed under the wrong one. Our flagship Hermetica
          card sat on the node for the <em>Asclepius</em> &mdash; a different Hermetic work.
          A twelfth-century Iliad codex hung, with six printed editions, off the identifier for{' '}
          <em>Pope&rsquo;s 1720 English translation</em>. At book grain these errors were
          invisible for months. At card grain they surfaced in an afternoon, because a card
          filed wrongly collides with what is already known about its address. The lesson
          generalizes: get the identity layer right and the facts check themselves.
        </p>

        <h2 className="font-display text-2xl text-primary mt-12 mb-4">Publish the search</h2>

        <p className="text-secondary leading-relaxed mb-6">
          The principle under all of this fits in a sentence: <strong>do not assert the
          negative &mdash; publish the search.</strong> A library cannot prove that no prior
          translation exists. It can say, checkably: here is what is known to us, here is where
          we looked, here is the evidence behind every line, and here is how to tell us we are
          wrong. That is not a weaker claim than the badge. It is the only version of the claim
          that was ever true.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          The cards now govern what the badges once asserted; the search ledger behind them
          &mdash; some 68,000 documented attempts &mdash; is being prepared as a citable open
          dataset; and the machinery the cards replace is scheduled not for migration but for
          deletion. If you find a card that is wrong, the feedback button is on every page, and
          a corrected card is one cited edit away. That is the point. We spent two years
          building a system that could assert a negative, and the honest version turned out to
          be a piece of library technology that predates the computer: one work, one card, one
          list of what is known &mdash; signed, cited, and open to correction.
        </p>
      </article>
    </ContentPageLayout>
  );
}
