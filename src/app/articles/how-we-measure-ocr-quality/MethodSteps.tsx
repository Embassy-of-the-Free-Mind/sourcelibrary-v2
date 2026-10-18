// The measurement as seven steps, in the order a run goes through them. Every rule and number here is
// one the article states in the section the step links to; nothing is added. Server-rendered HTML so
// the text stays at reading size on a phone; each step is a link to its section.

const STEPS: { n: number; href: string; name: string; rule: string }[] = [
  {
    n: 1,
    href: '#the-sample',
    name: 'Seal the sample',
    rule: 'One page per book, drawn with a seeded generator from the interior 10 to 90 percent. The registry file is the seal.',
  },
  {
    n: 2,
    href: '#look-at-the-leaf',
    name: 'Classify the leaf by eye',
    rule: 'Language, print or manuscript, typeface or hand. Cells are formed from what is on the leaf, never from the draw.',
  },
  {
    n: 3,
    href: '#references',
    name: 'Find a published reference',
    rule: 'A window of an e-text that prints this leaf, accepted at 35 percent of shared four-grams. No reference, no score.',
  },
  {
    n: 4,
    href: '#arms-and-controls',
    name: 'Run the arms on the same image',
    rule: 'One JPEG up to 2,400 px, one fixed instruction, temperature zero, and production run twice as the noise floor.',
  },
  {
    n: 5,
    href: '#what-we-measure',
    name: 'Score every page',
    rule: 'Character error rate, catastrophic pages above 50 percent, invention, loops, and the reading-order gap.',
  },
  {
    n: 6,
    href: '#evidence-grades',
    name: 'Grade the cell',
    rule: 'Under 30 referenced books exploratory, 30 to 49 directional, 50 or more decision-grade.',
  },
  {
    n: 7,
    href: '#preregistration',
    name: 'Apply the rule written before the run',
    rule: 'Better reader or cost lane, fixed in the preregistration. Deviations are reported, never folded in.',
  },
];

export default function MethodSteps() {
  return (
    <figure className="not-prose my-10 border border-border-light bg-white p-4 md:p-6 font-sans">
      <p className="text-sm text-primary mb-4">How a page becomes evidence</p>
      <ol className="relative">
        {STEPS.map((s, i) => (
          <li key={s.n} className="relative grid grid-cols-[2rem_1fr] gap-x-3 pb-4 last:pb-0">
            {i < STEPS.length - 1 && (
              <span aria-hidden="true" className="absolute left-[calc(1rem-0.5px)] top-8 bottom-0 w-px bg-stone-300" />
            )}
            <span
              aria-hidden="true"
              className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full border border-stone-400 bg-white text-sm text-primary tabular-nums"
            >
              {s.n}
            </span>
            <a href={s.href} className="block rounded -mx-1 px-1 py-0.5 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-gold">
              <span className="block text-[15px] font-medium text-primary leading-snug">{s.name}</span>
              <span className="block text-sm text-secondary leading-snug mt-0.5">{s.rule}</span>
            </a>
          </li>
        ))}
      </ol>
      <figcaption className="mt-4 text-xs text-muted">
        The steps of this note in the order a run takes them; select a step to read its section.
      </figcaption>
    </figure>
  );
}
