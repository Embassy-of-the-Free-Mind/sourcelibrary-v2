import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'How Long Would It Take to Translate the Renaissance? - Research Notes - Source Library',
  description:
    'We measured the rate of new Latin translations and counted what is left. At the current pace, finishing the Latin Renaissance alone would take roughly ten thousand years.',
  openGraph: {
    images: [{ url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library — Digitizing and translating ancient texts' }],
    title: 'How Long Would It Take to Translate the Renaissance?',
    description:
      'We did the division. At the current rate of scholarly translation, the Latin Renaissance alone would take about ten thousand years to finish.',
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library — Digitizing and translating ancient texts' }],
  },
  alternates: {
    canonical: '/blog/how-long-to-translate',
  },
};

const SCENARIOS = [
  { rate: '4 / year', who: 'I Tatti Renaissance Library, the flagship dedicated series (~100 volumes in 25 years)', years: '~89,000 years' },
  { rate: '20 / year', who: 'low end of our estimate for Renaissance-specific first translations', years: '~18,000 years' },
  { rate: '30 / year', who: 'mid-range', years: '~12,000 years', highlight: true },
  { rate: '40 / year', who: 'high end of our peak-era estimate', years: '~9,000 years' },
  { rate: '72 / year', who: 'every first translation of any pre-modern Latin or Greek work (overcounts heavily)', years: '~5,000 years' },
];

export default function HowLongToTranslatePage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="How Long Would It Take to Translate the Renaissance?"
          subtitle="We did the division. At the current rate, the Latin Renaissance alone would take about ten thousand years."
        >
          <p className="text-stone-400 text-sm mt-4">31 May 2026 &middot; 8 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="mb-8">
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors text-sm"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All notes
        </Link>
      </div>

      <article className="prose-content max-w-none">
        <p className="text-secondary leading-relaxed mb-6 font-body">
          This is the third time we have tried to put a number on the same problem. First we{' '}
          <Link href="/blog/untranslated-renaissance" className="text-accent-rust hover:underline">counted how much of the Renaissance has been translated into English</Link>{' '}
          (almost none of it). Then we measured{' '}
          <Link href="/blog/translation-rate" className="text-accent-rust hover:underline">how many new translations appear each year</Link>{' '}
          (fewer than anyone guesses). That second post ended on a question we did not answer: at the current rate, how long would it take to finish? This is the division.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The short answer, for Latin alone, is about ten thousand years.
        </p>

        <h2 className="font-serif text-2xl md:text-3xl text-primary mt-12 mb-6">The rate</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          To know how long the work would take, you first need to know how fast it goes. We have a unified catalogue of 13,862 English translations of pre-modern works, drawn from the UNESCO Index Translationum, the Library of Congress, the Loeb and I Tatti series, and about forty other sources. At its best-documented stretch, 2000 to 2008, roughly 145 unique translations appeared each year across every source we track. Of those, about 72 were first translations of a work that had never been in English before; the rest were new versions of things already available, the forty-first <em>Aeneid</em>.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          But those 72 are first translations of <em>all</em> pre-modern Latin and Greek, most of it classical and medieval. The number that appear from the Renaissance window specifically, 1450 to 1700, is smaller: our best estimate is 20 to 40 a year at peak, and fewer now that UNESCO stopped collecting in 2009. For a hard external anchor, Harvard&rsquo;s I Tatti Renaissance Library, the single most ambitious effort ever mounted to translate Renaissance Latin, has produced about 100 volumes since 2001, or roughly four a year.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          So the rate is somewhere between four a year, for the organised, funded, flagship effort, and forty a year, for everyone on earth combined at the most productive moment we can document. Call it a few dozen. It is not rising.
        </p>

        <h2 className="font-serif text-2xl md:text-3xl text-primary mt-12 mb-6">What is left</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The Universal Short Title Catalogue records <strong className="text-stone-800">499,607 Latin editions</strong> printed in Europe between 1450 and 1700, which cluster into roughly <strong className="text-stone-800">362,000 distinct works</strong>. How many have an English translation?
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          This is where you have to be careful, and we have learned to be. If you flag every Latin edition written by an author who has <em>any</em> translation to his name, about 13 per cent of editions light up. But a{' '}
          <Link href="/blog/untranslated-renaissance" className="text-accent-rust hover:underline">hand-audit</Link>{' '}
          shows that flag is only about 70 per cent precise at the level of the individual work, and badly unit-sensitive: a translated author drags along his untranslated minor works (Grotius&rsquo;s wedding poems, Erasmus&rsquo;s school grammar), and prolific famous authors have far more editions than obscure ones, so counting by edition over-represents the translated. Count by <em>work</em> instead, and the figure collapses to <strong className="text-stone-800">one to two per cent</strong>. About 98 per cent of the Latin works of the early modern period — on the order of <strong className="text-stone-800">355,000 of them</strong> — have never been translated into English at all.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Much of that is exactly what you would expect to find at the bottom of a print archive: almanacs, funeral orations, dissertations, papal bulls, occasional poems for weddings and coronations. But the same audit keeps turning up real books too, by real authors, that simply no one has ever carried into English. The bulk is genuinely dark.
        </p>

        <h2 className="font-serif text-2xl md:text-3xl text-primary mt-12 mb-6">The division</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          355,000 untranslated works, divided by a few dozen new translations a year. The arithmetic is brutal and not very sensitive to the assumptions you choose.
        </p>

        <div className="bg-warm rounded-lg border border-border-light p-6 md:p-8 my-8">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-medium">
                <th className="text-left py-2 text-secondary font-medium">Rate</th>
                <th className="text-left py-2 text-secondary font-medium hidden md:table-cell px-4">Whose pace this is</th>
                <th className="text-right py-2 text-secondary font-medium">Time to finish Latin alone</th>
              </tr>
            </thead>
            <tbody>
              {SCENARIOS.map((s) => (
                <tr key={s.rate} className={`border-b border-border-light ${s.highlight ? 'bg-accent-rust/5' : ''}`}>
                  <td className={`py-2.5 font-medium tabular-nums ${s.highlight ? 'text-accent-rust' : 'text-secondary'}`}>{s.rate}</td>
                  <td className="py-2.5 text-muted text-xs hidden md:table-cell px-4">{s.who}</td>
                  <td className={`py-2.5 text-right tabular-nums ${s.highlight ? 'text-accent-rust font-medium' : 'text-muted'}`}>{s.years}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The central estimate is about <strong className="text-stone-800">ten thousand years</strong>. Push every assumption in the optimistic direction at once, and assume our catalogue undercounts the real translation rate by a factor of three, and that half of the untranslated works are trivial ephemera you would never bother with, and the answer is still over <strong className="text-stone-800">two thousand years</strong>. There is no honest set of numbers that brings it under a millennium.
        </p>

        <h2 className="font-serif text-2xl md:text-3xl text-primary mt-12 mb-6">Ten thousand years</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          It helps to hold that figure against some others. Writing itself is about five thousand years old. The printing press is not yet six hundred. The Loeb Classical Library, the longest continuously running translation series in existence, has produced about 540 volumes in its 115 years. At the Loeb&rsquo;s lifetime pace, the Latin Renaissance would outlast the species that started it. We are not behind on this work. We were never going to finish it. The gap was not a backlog; it was a permanent condition.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          And this is Latin only. It leaves out Greek, and the larger manuscript tradition before print, and the eighteenth century, which probably produced more books than the previous 250 years combined. It leaves out the entire written inheritance of China, India, the Islamic world, and everywhere else, all of it translated at similar rates or worse. The ten thousand years is a floor on a corner of the problem.
        </p>

        <h2 className="font-serif text-2xl md:text-3xl text-primary mt-12 mb-6">What changed</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          We ran these numbers because we are watching the constant in them break. The reason the gap never closed is that the cost of a translation was fixed at a human scale: months of a skilled person&rsquo;s life per book, and only so many such people. That is the budget that produced ten thousand years. Machine translation has not improved that budget. It has removed it. A current model reads a page of seventeenth-century Latin and returns a serviceable English draft in seconds, for a fraction of a cent.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          We have spent the past few years building a library on that fact. It now holds more than 15,000 historical books translated into English, thousands of them Latin, each shown beside the original page. What the table above frames as a hundred centuries of work is, at machine speed, a matter of years. That is the whole of the claim, and it is enough.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          It is not a claim that the machine replaces the scholar. A fast translation is not a true one, and a model that has learned the music of a language can perform it over an emptiness; the original has to stay beside the translation, and the reading and the checking and the judgment are still entirely human, and there is now an almost unimaginable amount of them to be done. But the bottleneck that fixed the budget for five hundred years is gone. The question was never whether the Renaissance was worth translating. It was whether anyone could afford the time. For five centuries the answer was no. It has just become yes, and a harder question takes its place: not whether we can translate it, but whether we can read it.
        </p>

        <p className="text-sm text-muted leading-relaxed mt-10 font-body">
          Sources: Universal Short Title Catalogue (Latin editions 1450&ndash;1700, queried 31 May 2026); Source Library translation catalogue and rate analysis; manual QC audit of the Latin author-match flag, 31 May 2026. The work-level translation rate is an estimate with real error bars; the order of magnitude is robust, the precise figure is not.
        </p>
      </article>

    </ContentPageLayout>
  );
}
