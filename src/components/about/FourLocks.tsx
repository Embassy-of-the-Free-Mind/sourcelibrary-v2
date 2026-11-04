import Reveal from './Reveal';

/**
 * Why old books stay unread, and what we do about each reason. Static rows
 * that fade in on arrival; the earlier word-flip animation was dropped
 * (2026-11-04: it read as strange). "Paywalled" was dropped too, so the page
 * does not set itself against the libraries and sellers who hold the books.
 */

const ROWS: { problem: string; why: string; how: string }[] = [
  {
    problem: 'Unscanned.',
    why: 'Most of the world’s old books and manuscripts have never been digitised.',
    how: 'We scan them at the Embassy of the Free Mind and bring in scans from libraries around the world.',
  },
  {
    problem: 'Untranslated.',
    why: 'Wherever anyone has counted, only a few in every hundred can be read in English.',
    how: 'We translate every page and set it beside the original.',
  },
  {
    problem: 'Unfindable.',
    why: 'A catalogue lists a title, not what is inside the book.',
    how: 'We index the names, ideas and pictures on every page.',
  },
];

export default function FourLocks() {
  return (
    <ol className="divide-y divide-border-light border-y border-border-light">
      {ROWS.map((r, k) => (
        <li key={r.problem}>
          <Reveal delay={k * 80} className="grid grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] gap-x-12 gap-y-3 py-8 md:py-10 items-baseline">
            <p className="font-serif text-5xl md:text-7xl text-primary leading-[1.05] tracking-tight">{r.problem}</p>
            <div className="text-lg leading-relaxed max-w-md">
              <p className="text-secondary">{r.why}</p>
              <p className="mt-2 text-primary">{r.how}</p>
            </div>
          </Reveal>
        </li>
      ))}
    </ol>
  );
}
