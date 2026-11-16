import Link from 'next/link';
import type { OpeningPassage } from '@/lib/book-opening-passage';
import { READER_UI_STRINGS } from '@/lib/reader-strings';
import { isUnreviewedMachineTranslation, textProducedAt } from '@/lib/text-provenance';

/**
 * A short passage of the book's own words on its front page, with the page it stands on (#103).
 *
 * Server-rendered and open (no <details>): the point is that a first-time reader, and a crawler that
 * does not run JavaScript, meet the source and not only our description of it. The passage is chosen
 * by src/lib/book-opening-passage.ts, which holds the rules for what may be shown. English page of the
 * main site only; the caller gates that.
 *
 * Styling: the card heading of the neighbouring sections, the quote rule of articles' SourceQuote, the
 * reader's machine-draft line (MachineDraftLine), and the Contents card's link colour. No new tokens.
 * `data-book-words` is what scripts measuring server HTML count (the #103 before/after table).
 */
export default function BookOpeningPassage({ passage, href }: { passage: OpeningPassage; href: string }) {
  const t = READER_UI_STRINGS.en.info;
  const machine = isUnreviewedMachineTranslation(passage.page);
  const at = machine ? textProducedAt(passage.page, 'translation') : null;
  return (
    <section data-book-words="" className="card reveal-in p-4 md:p-6" aria-labelledby="book-words-heading">
      <h3 id="book-words-heading" className="font-display font-medium text-[17px] md:text-[22px] mb-3 md:mb-4" style={{ color: '#2b2620' }}>
        From the text
      </h3>
      <blockquote cite={href} className="border-l-2 border-accent-gold/60 pl-5 font-body text-lg leading-relaxed text-primary">
        <p>{passage.text}</p>
      </blockquote>
      <p className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link href={href} className="text-[13px] font-medium whitespace-nowrap" style={{ color: '#a5503d' }}>
          {passage.truncated ? `Continue on page ${passage.pageNumber}` : `Read page ${passage.pageNumber}`}
        </Link>
        {machine && (
          <span data-machine-draft="" className="font-sans text-[11.5px] leading-snug" style={{ color: 'var(--accent-gold-dark)' }}>
            {at ? t.machineDraftNoticeDated(t.producedMonth(at)) : t.machineDraftNotice}
          </span>
        )}
      </p>
    </section>
  );
}
