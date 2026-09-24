import Link from 'next/link';
import CollectionCardImage from '@/components/collections/CollectionCardImage';
import type { CuratedShowcaseItem } from '@/lib/home-data';
import { localePath, type Locale } from '@/lib/locale-path';

// The editorial lead of the homepage's Collections section: one exhibition
// large, three beside it. Museum-label treatment — the plate sits in a framed
// box and the text is set on the page beneath it — rather than white type over
// a darkened image, so the engraving stays legible at card size and the
// one-line hook (the collection's subtitle) is what sells the click.

interface Props {
  items: CuratedShowcaseItem[];
  /** Locale of the page mounting this — links keep the URL prefix. */
  lang: Locale;
  /** "32 books" — built by the caller so the word is in the page's language. */
  countLabel: (item: CuratedShowcaseItem) => string;
}

function LeadCard({ item, href, count }: { item: CuratedShowcaseItem; href: string; count: string }) {
  return (
    <Link href={href} className="group block">
      <div className="relative aspect-[4/3] overflow-hidden rounded-lg border border-border-light bg-warm">
        <CollectionCardImage
          candidates={item.leadImageCandidates}
          alt=""
          sizes="(max-width: 1024px) 100vw, 60vw"
          priority
          framing={item.framing}
        />
      </div>
      <div className="mt-4 sm:mt-5">
        <p className="text-xs uppercase tracking-[0.2em] text-accent-rust mb-1.5">{count}</p>
        <h3 className="font-display text-2xl md:text-3xl text-primary group-hover:text-accent-rust transition-colors">
          {item.name}
        </h3>
        <p className="mt-2 font-serif text-lg md:text-xl text-secondary leading-snug max-w-xl">
          {item.subtitle}
        </p>
      </div>
    </Link>
  );
}

function SideCard({ item, href, count }: { item: CuratedShowcaseItem; href: string; count: string }) {
  return (
    <Link href={href} className="group grid grid-cols-[104px_minmax(0,1fr)] sm:grid-cols-[132px_minmax(0,1fr)] gap-4 sm:gap-5 items-start">
      <div className="relative aspect-square overflow-hidden rounded-lg border border-border-light bg-warm">
        <CollectionCardImage
          candidates={item.imageCandidates}
          alt=""
          sizes="132px"
          framing={item.framing}
        />
      </div>
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-[0.2em] text-accent-rust mb-1">{count}</p>
        <h3 className="font-display text-lg md:text-xl text-primary group-hover:text-accent-rust transition-colors leading-tight">
          {item.name}
        </h3>
        <p className="mt-1.5 font-serif text-base md:text-lg text-secondary leading-snug line-clamp-3">
          {item.subtitle}
        </p>
      </div>
    </Link>
  );
}

export default function CuratedShowcase({ items, lang, countLabel }: Props) {
  if (items.length === 0) return null;
  const lp = (href: string) => localePath(href, lang);
  const [lead, ...rest] = items;

  return (
    <div className="grid gap-10 lg:grid-cols-[3fr_2fr] lg:gap-14 items-start">
      <LeadCard item={lead} href={lp(`/collections/${lead.slug}`)} count={countLabel(lead)} />
      {rest.length > 0 && (
        <div className="divide-y divide-border-light">
          {rest.map((item) => (
            <div key={item.slug} className="py-5 first:pt-0 last:pb-0">
              <SideCard item={item} href={lp(`/collections/${item.slug}`)} count={countLabel(item)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
