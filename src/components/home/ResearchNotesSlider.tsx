'use client';

import Image from 'next/image';
import Link from 'next/link';
import HorizontalSlider from '@/components/HorizontalSlider';
import { type HomeBlogPost } from '@/lib/home-data';

/**
 * Research Notes as a horizontal slider: 4 cards per view on desktop / 2 on
 * tablet / ~1 on mobile, advancing one card per arrow click (the shared
 * HorizontalSlider steps one card at a time). Cards keep the existing 16:10
 * blog-card look.
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
          className="snap-start shrink-0 basis-[80%] sm:basis-[calc((100%-1rem)/2)] lg:basis-[calc((100%-3rem)/4)]"
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
                  sizes="(max-width: 640px) 80vw, (max-width: 1024px) 50vw, 24vw"
                  className="object-cover group-hover:scale-105 transition-transform duration-500"
                  loading="lazy"
                />
              </div>
            )}
            <div className="p-4">
              <span className={`text-xs px-2 py-0.5 rounded-full ${post.tagColor}`}>
                {post.tagKey === 'deepDive' ? deepDiveLabel : collectionLabel}
              </span>
              <h3 className="font-display text-lg text-primary mt-2 group-hover:text-accent-rust transition-colors line-clamp-2 leading-snug">
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
