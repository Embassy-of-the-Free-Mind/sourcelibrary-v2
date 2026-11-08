import Link from 'next/link';

const ITEMS: [string, string, string][] = [
  ['/revamp/c/slime-moulds', 'Collection page', 'Your Mycology and Slime Moulds format as one template. Slime Moulds here is drawn from data, for comparing with the live page.'],
  ['/revamp/s/alchemy', 'Subject page', 'The same parts as a collection page in a different order: search first, then what is inside it.'],
  ['/revamp/c', 'Collections page', 'The new /collections: featured hero, then search and filters for who made it and what it holds.'],
  ['/revamp/home', 'Homepage layouts', 'Three full-height featured layouts built on single plates, with Popular this week as a smaller section below.'],
  ['/revamp/featured', 'Featured collection', 'One schedule file driving the homepage, Library and Gallery.'],
  ['/revamp/subjects', 'All subjects', 'The reader-facing list, with how subjects are chosen.'],
  ['/revamp/subjects/draft', 'Draft subject list', 'The working list for review: two levels, linked to FAST and Wikidata.'],
  ['/revamp/review', 'Sorting review', 'Every public collection and gallery set sorted into the new types, to correct.'],
];

export default function Page() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-14">
      <h1 className="text-4xl text-primary font-display mb-3">Collections revamp prototype</h1>
      <p className="text-secondary mb-2">This runs on your Mac only. It has no database connection and reads a saved copy of public data, so it can&apos;t change anything on the site. Links to books and images open on the live site in a new tab.</p>
      <div className="mt-8">
        {ITEMS.map(([href, title, note]) => (
          <Link key={href} href={href} className="block border-t border-border-light py-4 group">
            <span className="block text-lg text-primary group-hover:underline underline-offset-2">{title}</span>
            <span className="block text-sm text-muted">{note}</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
