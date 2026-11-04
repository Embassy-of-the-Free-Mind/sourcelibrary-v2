import Image from 'next/image';
import Link from 'next/link';
import SiteHeader from '@/components/layout/SiteHeader';
import { readerHref, type Pick } from './histories';

// The top of a history: its word, its question, and a plate from one of its books, side by side on the site's dark
// ground. Same width as the chart below it, so the two line up. The plate links to its page in the reader.
export default function HistoryHero({ title, question, pick }: { title: string; question: string; pick: Pick }) {
  const { image } = pick;
  return (
    <>
      <SiteHeader variant="dark" />
      <div className="text-white bg-gradient-to-b from-[#2a1f17] to-[#1a1612]">
        <div className="mx-auto w-[min(calc(100%-2rem),980px)] py-10 md:py-16 grid gap-10 md:grid-cols-[minmax(0,1fr)_360px] md:items-end">
          <div>
            <p className="text-sm text-stone-300 mb-8 md:mb-10">
              <Link href="/explore" className="text-stone-300 hover:text-white">Explore</Link>
              {' / '}
              <Link href="/explore/histories" className="text-stone-300 hover:text-white">Histories</Link>
            </p>
            <h1 className="font-serif text-6xl md:text-7xl tracking-tight mb-3">{title}</h1>
            <p className="font-serif text-2xl text-stone-300 mb-8">
              {pick.word} <span className="italic">{pick.translit}</span>
            </p>
            <p className="font-body text-xl leading-relaxed text-stone-200 max-w-[34rem]">{question}</p>
          </div>
          <figure className="m-0">
            <Link href={readerHref(image.book, image.page)} className="block relative h-72 md:h-[22rem]">
              <Image src={image.src} alt={image.alt} fill priority sizes="(max-width: 768px) 100vw, 360px" className="object-contain object-left md:object-right-bottom" />
            </Link>
            <figcaption className="mt-3 text-sm leading-snug text-stone-400 md:text-right">{image.caption}</figcaption>
          </figure>
        </div>
      </div>
    </>
  );
}
