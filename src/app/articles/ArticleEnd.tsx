'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import LikeButton from '@/components/ui/LikeButton';
import ShareButton from '@/components/ui/ShareButton';
import QuickSubscribe from '@/components/donate/QuickSubscribe';
import { posts } from './posts';

/**
 * The three things a reader can do on reaching the end of an article: keep it,
 * pass it on, or hear about the next one.
 *
 * The heart is PRIVATE: no count is shown, here or anywhere. With a handful of
 * readers per article a public count would read "0" or "1" and make the page
 * look abandoned; as a bookmark it files the article under the reader's
 * favorites (/favorites, "Saved articles"). Rendered once from the articles
 * layout, only on listed articles (not the index or category pages).
 */
export default function ArticleEnd() {
  const pathname = usePathname();
  const slug = pathname?.replace(/^\/articles\//, '').replace(/\/$/, '');
  const post = slug ? posts.find((p) => p.slug === slug) : undefined;
  const [saved, setSaved] = useState(false);

  if (!post) return null;

  return (
    <section className="bg-cream print:hidden" aria-label="Keep or share this article">
      <div className="max-w-[var(--container-standard)] mx-auto px-6 md:px-12 pb-10">
        <div className="border-t border-border-light pt-8 flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <LikeButton
              targetType="article"
              targetId={post.slug}
              showCount={false}
              size="md"
              label={saved ? 'Saved to your favorites' : 'Save to favorites'}
              onLikedChange={setSaved}
            />
            <ShareButton variant="icon" label="Share" title={post.title} surface="article_end" />
            {saved && (
              <Link href="/favorites" className="text-sm text-muted underline decoration-border-light underline-offset-2 hover:text-secondary">
                See your favorites
              </Link>
            )}
          </div>
          <div className="md:max-w-sm w-full">
            <p className="font-serif text-lg text-primary">Letters from the library</p>
            <p className="text-sm text-muted mb-3">New articles and finds from the collection, now and then.</p>
            <QuickSubscribe source="article" doneMessage="Thank you, you're on the list for the next letter." />
          </div>
        </div>
      </div>
    </section>
  );
}
