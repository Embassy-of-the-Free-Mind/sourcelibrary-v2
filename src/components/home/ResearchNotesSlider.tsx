'use client';

import Image from 'next/image';
import Link from 'next/link';
import HorizontalSlider from '@/components/HorizontalSlider';
import { type HomeBlogPost } from '@/lib/home-data';

/**
 * Research Notes as a wide horizontal slider (roughly 4x the width of a book
 * card, so ~1.5 land in view on desktop) instead of a static grid. Same slider
 * engine as the book sliders; the cards keep the existing 16:10 blog-card look.
 */
export default function ResearchNotesSlider({
  posts,
  deepDiveLabel,
  collectionLabel,
}: {
  posts: HomeBlogPost[];
  deepDiveLabel: string;
  collectionLabel: string;
}) {
  return (
    <HorizontalSlider ariaLabel="research notes">
      {posts.map((post) => (
        <div
          key={post.slug}
          data-card
          className="snap-start shrink-0 basis-[86%] sm:basis-[62%] lg:basis-[calc((100%-2rem)/2.3)]"
        >
          <Link
            href={`/blog/${post.slug}`}
            className="group flex flex-col h-full bg-white rounded-xl border border-border-light overflow-hidden hover:shadow-lg hover:border-accent-rust/20 transition-[box-shadow,border-color]"
          >
            {post.image && (
              <div className="aspect-[16/10] relative bg-warm overflow-hidden">
                <Image
                  src={post.image}
                  alt=""
                  fill
                  sizes="(max-width: 640px) 86vw, (max-width: 1024px) 62vw, 42vw"
                  className="object-cover group-hover:scale-105 transition-transform duration-500"
                  loading="lazy"
                />
              </div>
            )}
            <div className="p-5">
              <span className={`text-xs px-2 py-0.5 rounded-full ${post.tagColor}`}>
                {post.tagKey === 'deepDive' ? deepDiveLabel : collectionLabel}
              </span>
              <h3 className="font-display text-xl text-primary mt-2 group-hover:text-accent-rust transition-colors line-clamp-2 leading-snug">
                {post.title}
              </h3>
              <p className="text-sm text-muted mt-1.5 line-clamp-2">
                {post.subtitle}
              </p>
              <p className="text-xs text-faint mt-3">
                {post.date} &middot; {post.readTime}
              </p>
            </div>
          </Link>
        </div>
      ))}
    </HorizontalSlider>
  );
}
