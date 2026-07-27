import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'How Many First Translations, Really? - Research Notes - Source Library',
  description:
    'We badge ~5,700 books as first-ever English translations. Are they? We sent an AI agent to fact-check a random sample of both the badged books and the never-assessed ones — and found the bigger error was the firsts we missed, not the ones we over-claimed.',
  openGraph: {
    title: 'How Many First Translations, Really?',
    description:
      'A two-sided census of Source Library\'s first-translation claim: measuring both false positives and missed firsts with stratified sampling and per-book AI adjudication.',
    images: [{ url: 'https://images.sourcelibrary.org/archived/69af0a0a4c57359b8d2d0f49/1.jpg', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: 'https://images.sourcelibrary.org/archived/69af0a0a4c57359b8d2d0f49/1.jpg' }],
  },
  alternates: {
    canonical: '/blog/counting-first-translations',
  },
};

export default function CountingFirstTranslationsPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="How Many First Translations, Really?"
          subtitle="A census of a claim — measuring both the firsts we over-claim and the firsts we miss"
          image="https://images.sourcelibrary.org/archived/69af0a0a4c57359b8d2d0f49/1.jpg"
          imageAlt="Title page of Athanasius Kircher's Arithmologia, 1665 — a genuine first English translation"
        >
          <p className="text-stone-400 text-sm mt-4">19 June 2026 &middot; 11 min read</p>
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
          Source Library shows a &ldquo;First Translation&rdquo; badge on thousands of books &mdash; texts we believe have never before been rendered into English. It is the boldest claim the library makes. So we decided to fact-check it properly: not by re-running the system that produced the claim, but by sending an AI research agent to independently investigate a random sample of books, one at a time, and report back with evidence. What we found changed the number &mdash; and, more surprisingly, changed which direction the error ran.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          This is a companion to{' '}
          <Link href="/blog/first-translation-methodology" className="text-accent-rust hover:text-accent-rust underline">
            <em>How We Identify First Translations</em>
          </Link>
          , which describes the classification pipeline. This post is about something narrower and harder: once you&apos;ve made thousands of these claims, how do you know how many are <em>true</em>?
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">The asymmetry that makes this hard</h2>

        <p className="text-secondary leading-relaxed mb-6">
          A &ldquo;first translation&rdquo; is a claim about absence: <em>no one has ever translated this text into English before.</em> You cannot prove a negative by looking it up. And the claim fails in two opposite ways, which call for two opposite kinds of checking.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          A <strong>false first</strong> is a book we badge as first when a prior translation actually exists. These cluster around <em>famous</em> texts in <em>under-catalogued</em> traditions &mdash; a celebrated Tibetan treatise the Western catalogs can&apos;t see, which nonetheless has a well-known academic translation. A <strong>missed first</strong> is the reverse: a genuine first translation that we never flagged at all, because the book was never assessed. These hide in the long tail of obscure works in well-catalogued languages &mdash; a 1576 Latin pamphlet nobody ever thought to check.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          Counting only the books we already badge measures the first kind of error and is blind to the second. To get an honest number you have to sample <em>both</em> the books we claim and the books we never looked at.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">The method: sample, then send an agent to investigate</h2>

        <p className="text-secondary leading-relaxed mb-6">
          We can&apos;t exhaustively research all ~14,000 eligible books &mdash; each careful investigation costs real effort. So we sampled. We divided the library into strata by catalogue density (how famous/findable the author is), language family, and current status, then drew random books from each stratum. For every sampled book, an AI agent ran a focused investigation: identify the exact work (and separate it from look-alike relatives), search the <em>tradition-appropriate</em> sources &mdash; 84000 and BDRC for Tibetan, CTEXT for Chinese, GRETIL for Sanskrit, Sefaria for Hebrew, the usual catalogs for European works &mdash; apply the source-language rule (a translation from a <em>different</em> original language still counts), and judge complete-versus-partial. Each agent returned a graded verdict plus its full evidence trail.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          From the per-stratum results we compute a false-first (or genuine-first) rate with a Wilson confidence interval, scale each stratum back up to its population size, and sum. The output isn&apos;t a single false-precision number &mdash; it&apos;s an estimate with an honest error bar.
        </p>

        <div className="bg-amber-50/60 border border-amber-200/60 rounded-xl p-6 mb-8">
          <p className="text-secondary leading-relaxed mb-0">
            <strong>An honest aside about our own method.</strong> The first time we ran this at scale, the agents marked far too many books &ldquo;not applicable.&rdquo; The cause was a flaw in <em>our</em> instructions: we&apos;d told the agent to disqualify any book whose text was in the original language &mdash; but holding the original <em>and</em> translating it is exactly what Source Library does. The sample&apos;s own internal inconsistency exposed the bug (one Latin oration was correctly called a first; a near-identical one was wrongly disqualified). We fixed the instruction and re-ran. We mention it because the whole point of an auditable method is that it catches its own mistakes, including the auditor&apos;s.
          </p>
        </div>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Side one: are the badged firsts real?</h2>

        <p className="text-secondary leading-relaxed mb-6">
          We badge <strong>5,696</strong> books as first translations. A stratified sample of 462 of them, each independently investigated, breaks down like this:
        </p>

        <ul className="list-disc pl-6 text-secondary leading-relaxed mb-6 space-y-2">
          <li><strong>46% genuine firsts</strong> &mdash; no prior English translation found, with the search bounded in competent sources.</li>
          <li><strong>18% already translated</strong> &mdash; a real prior exists; the badge is wrong and should come off. (Hagakure, Sextus Empiricus in the Loeb, Proclus&apos;s <em>Cratylus</em> commentary&hellip;)</li>
          <li><strong>30% not a clean single-work claim</strong> &mdash; mostly multi-work containers (an <em>Opera Omnia</em>, a miscellany) where &ldquo;first translation&rdquo; is ill-defined, plus some non-English editions, scripture fragments, and visual-art volumes.</li>
          <li><strong>6% unresolved</strong> &mdash; conflicting evidence or an identity we couldn&apos;t pin down.</li>
        </ul>

        <p className="text-secondary leading-relaxed mb-8">
          Scaled up: of the books we currently badge, roughly <strong>3,774</strong> (95% interval ~3,300&ndash;4,300) hold up as genuine, defensible firsts. The rest are over-claims &mdash; not lies, but a badge applied too broadly, especially to multi-volume containers.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Side two: how many firsts did we miss?</h2>

        <p className="text-secondary leading-relaxed mb-6">
          Here is the part that only sampling can reveal. <strong>8,306</strong> translated, non-English books in the library carry <em>no first-translation decision at all</em> &mdash; they were never assessed, because the automated checks only ever <em>removed</em> the flag, never added it. We drew a random sample from this never-examined pool and ran the same investigation.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          In a random sample of this pool, <strong>just under a quarter turned out to be genuine first translations</strong> &mdash; books with no prior English version anywhere we could find. Scaled across the 8,300, that&apos;s on the order of <strong>1,900 first translations we simply never claimed</strong> (with a wide margin &mdash; somewhere between ~1,300 and ~2,800).
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          These are real first translations sitting in plain sight without a badge: an uncatalogued Bhutanese terma prophecy, a 1681 devotional work by Antoinette Bourignon never Englished, a 1576 Latin Eucharist tract by Lambert Daneau. Nobody had ever made the claim for them &mdash; so nobody could see them.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">The surprise: the bigger error is the firsts we miss</h2>

        <p className="text-secondary leading-relaxed mb-6">
          Put the two sides together and the headline shifts. The badged set <em>over</em>-claims by roughly 1,900 books (containers, art, already-translated). But the never-assessed pool <em>under</em>-claims by a strikingly similar amount &mdash; an estimated <strong>~1,900 genuine firsts we never flagged.</strong> The two errors very nearly cancel: the true total lands close to the number we badge today, but it is made of <em>different books</em>. The system isn&apos;t mostly over-claiming &mdash; it is mis-aiming in both directions at once.
        </p>

        <div className="bg-white rounded-xl border border-border-light p-6 mb-8">
          <p className="text-primary font-semibold mb-2">Best current estimate</p>
          <p className="text-secondary leading-relaxed mb-0">
Roughly <strong>5,700 genuine first English translations</strong> across the library (95% interval ~4,900&ndash;6,400) &mdash; about <strong>3,800</strong> among the books we badge today plus another <strong>~1,900</strong> we never flagged &mdash; against ~14,000 translated, non-English books in all. That&apos;s a first translation for something like <strong>two of every five</strong> eligible books.
          </p>
        </div>

        <p className="text-secondary leading-relaxed mb-8">
          So the round &ldquo;roughly six thousand first English translations&rdquo; turns out to be roughly defensible &mdash; but its <em>composition</em> is different from what the badges currently show. The right move isn&apos;t to shrink the claim; it&apos;s to <em>re-balance</em> it: take the badge off the ~1,900 over-claims and put it on the ~1,900 genuine firsts we&apos;d overlooked. The headline number barely moves &mdash; but every claim then has an evidence trail behind it.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Fame, not language</h2>

        <p className="text-secondary leading-relaxed mb-6">
          A tempting shortcut is to distrust the non-Western claims, since Western catalogs can&apos;t see Tibetan or Sanskrit works. The data says the real axis is <em>fame</em>, not language. Obscure Tibetan terma and obscure Latin pamphlets are <em>both</em> usually genuine firsts. The false firsts are the <em>famous</em> works in any tradition &mdash; the ones important enough that a scholar already translated them.
        </p>

        <p className="text-secondary leading-relaxed mb-6">
          This is why the celebrated cases survive in both directions. Athanasius Kircher&apos;s <em>Arithmologia</em> (1665) and Robert Fludd&apos;s great treatises are famous <em>and</em> genuinely untranslated &mdash; the method keeps their badges (it even restored Kircher&apos;s after an earlier automated pass wrongly removed it). Tsongkhapa&apos;s <em>Essence of True Eloquence</em> is famous and was translated by Robert Thurman in 1984 &mdash; the method takes that badge off. The same logic, opposite results, each backed by a found source.
        </p>

        <h2 className="text-2xl md:text-3xl text-primary mt-16 mb-6">Why we&apos;re telling you the messy version</h2>

        <p className="text-secondary leading-relaxed mb-6">
          A claim like &ldquo;first English translation&rdquo; is only worth making if it can be checked. The value of this exercise isn&apos;t the single number at the end; it&apos;s that every book in the sample now carries a recorded investigation &mdash; what was searched, what was found, how strong the absence of evidence really is. A first-translation claim should be a falsifiable, sourced assertion, not a marketing flourish. That is the standard we want to hold ourselves to, and the reason we&apos;d rather publish the confidence interval than a tidy round number.
        </p>

        <p className="text-secondary leading-relaxed mb-8">
          The work continues: re-balancing the badges so the over-claims come off and the missed firsts go on, widening the samples to tighten the error bars, and attaching the evidence trail to each book&apos;s page so you can see for yourself how a &ldquo;first translation&rdquo; was established. When that&apos;s live, the badge won&apos;t just be a claim &mdash; it&apos;ll be a citation.
        </p>

        <p className="text-secondary leading-relaxed mb-8 text-muted text-sm">
          Methodology and code are tracked in our public repository (issue #2564). Figures from a 462-book sample of the badged firsts and a 150-book sample of the never-assessed pool, June 2026; sampling intervals are 95% Wilson. The re-balancing has not yet run, so the per-book badges will catch up to these aggregate numbers over the coming weeks.
        </p>
      </article>

    </ContentPageLayout>
  );
}
