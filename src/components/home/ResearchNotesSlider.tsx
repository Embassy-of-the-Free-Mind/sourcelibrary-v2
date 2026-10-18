'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import HorizontalSlider from '@/components/HorizontalSlider';
import { ArticleCard } from '@/app/articles/BlogIndex';
import type { BlogPost } from '@/app/articles/posts';

/**
 * The homepage Articles section's slider: the newest articles in the same card
 * as /articles, 3 per view on desktop, 2 on tablet, ~1 on mobile. The section
 * title sits on the arrow row, with the "All articles" button beside the arrows.
 */
export default function ResearchNotesSlider({
  posts,
  heading,
  subtitle,
  allLabel,
}: {
  posts: BlogPost[];
  heading: string;
  subtitle: string;
  allLabel: string;
}) {
  return (
    <HorizontalSlider
      ariaLabel="articles"
      header={
        <>
          <h2 className="text-3xl md:text-4xl text-primary font-display">{heading}</h2>
          <p className="text-secondary mt-2 max-w-2xl">{subtitle}</p>
        </>
      }
      action={
        <Link
          href="/articles"
          className="h-11 inline-flex items-center gap-2 px-5 bg-primary text-sm font-medium text-white hover:bg-primary/80 transition-colors whitespace-nowrap"
        >
          {allLabel}
          <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </Link>
      }
    >
      {posts.map((post) => (
        <div
          key={post.slug}
          data-card
          className="snap-start shrink-0 basis-[85%] sm:basis-[calc((100%-1rem)/2)] lg:basis-[calc((100%-2rem)/3)]"
        >
          <ArticleCard post={post} />
        </div>
      ))}
    </HorizontalSlider>
  );
}
