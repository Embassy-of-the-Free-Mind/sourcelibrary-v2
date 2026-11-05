import Link from 'next/link';

/**
 * Replaces the homepage's dark "Be part of this" block. Follows straight on
 * from HomeWall: the wall gives the why (the story), this gives the how (pay
 * for it, help with it, build on it), so neither repeats the other. Matches
 * the Join section on /about. Facts from /support ("Where your support goes").
 */
const WAYS: [string, string, string][] = [
  ['/auth/signin', 'Create a free account', 'Save books and keep track of your reading.'],
  ['/contribute', 'Volunteer', 'Help translate, review or improve the collection.'],
  ['/developers', 'Build on it', 'An API, a CLI and an MCP server for research tools and AI.'],
];

export default function HomeJoin() {
  return (
    <section className="py-24 md:py-32 bg-[var(--bg-warm)]">
      <div className="mx-auto w-full max-w-[1500px] px-6 md:px-12 grid grid-cols-[minmax(0,1fr)] md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-14 md:gap-24 items-start">
        <div>
          <h2 className="font-serif text-4xl md:text-6xl text-primary leading-[1.05] tracking-tight text-balance max-w-3xl">Help fund the next first translation</h2>
          <p className="mt-8 max-w-xl text-lg md:text-xl text-secondary leading-relaxed">
            The translations are free to read. Donations fund the scanning, the translating and keeping the library online.
          </p>
          <div className="mt-10">
            <Link href="/support" className="inline-block px-6 py-3 bg-[#1a1612] text-white hover:bg-black transition-colors font-medium">Donate</Link>
          </div>
        </div>
        <ul className="divide-y divide-border-medium border-y border-border-medium md:mt-3">
          {WAYS.map(([href, title, text]) => (
            <li key={href}>
              <Link href={href} className="group flex items-start justify-between gap-6 py-6 hover:bg-black/[0.03] transition-colors">
                <span>
                  <span className="block font-serif text-2xl text-primary">{title}</span>
                  <span className="block mt-1 text-base text-secondary">{text}</span>
                </span>
                <span aria-hidden="true" className="mt-1 text-primary transition-transform group-hover:translate-x-1">→</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
