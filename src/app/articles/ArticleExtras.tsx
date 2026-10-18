'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { usePathname } from 'next/navigation';
import HorizontalSlider from '@/components/HorizontalSlider';
import BlogPostSchema from '@/components/seo/BlogPostSchema';
import { BASE_URL } from '@/components/seo/schema-utils';
import revisions from '@/generated/blog-revisions.json';
import ArticleBooks from './ArticleBooks';
import { ArticleCard } from './BlogIndex';
import { posts, LINKED_PAGES, type BlogPost } from './posts';

// Articles that render their own BlogPostSchema with hand-written fields.
const OWN_SCHEMA = new Set([
  '10000-books',
  'first-translations',
  'how-big-is-the-library',
  'nobody-knows-what-has-been-scanned',
  'reading-classical-chinese',
]);

const RELATED_COUNT = 9;

function isoDate(date: string) {
  const t = Date.parse(date);
  if (Number.isNaN(t)) return undefined;
  // Read in whatever time zone parsed it, written out as that calendar day:
  // server (UTC) and browser must render the same string.
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const newestFirst = (a: BlogPost, b: BlogPost) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0);

// Same category first, newest first, then the newest from the others.
function relatedTo(post: BlogPost): BlogPost[] {
  const pool = [...posts, ...LINKED_PAGES].filter((p) => p.slug !== post.slug).sort(newestFirst);
  const same = pool.filter((p) => p.kind === post.kind);
  const rest = pool.filter((p) => p.kind !== post.kind);
  return [...same, ...rest].slice(0, RELATED_COUNT);
}

function useListedPost(): BlogPost | undefined {
  const pathname = usePathname();
  const slug = pathname?.replace(/^\/articles\//, '').replace(/\/$/, '');
  return slug ? posts.find((p) => p.slug === slug) : undefined;
}

// Directly after the article: the books it quotes, as book cards.
export function ArticleBooksHere() {
  const post = useListedPost();
  return post ? <ArticleBooks slug={post.slug} /> : null;
}

// After the footer note: the article's JSON-LD (unless the page writes its
// own) and a slider of related articles, three to a view.
export default function ArticleExtras() {
  const post = useListedPost();
  if (!post) return null;

  const rev = (revisions as Record<string, { revised?: string }>)[post.slug];
  const image = post.image.startsWith('/') ? `${BASE_URL}${post.image}` : post.image;

  return (
    <>
      {!OWN_SCHEMA.has(post.slug) && (
        <BlogPostSchema
          slug={post.slug}
          title={post.title}
          description={post.summary}
          datePublished={isoDate(post.date) ?? ''}
          dateModified={rev?.revised ? rev.revised.slice(0, 10) : undefined}
          image={image}
        />
      )}
      <section className="bg-cream print:hidden" aria-labelledby="related-articles">
        <div className="max-w-[var(--container-wide)] mx-auto px-6 md:px-12 pb-20">
          <div className="border-t border-border-light pt-10" />
          <HorizontalSlider
            ariaLabel="related articles"
                  header={
              <>
                <h2 id="related-articles" className="font-serif text-3xl text-primary">
                  Related articles
                </h2>
                <p className="text-secondary font-body mt-2">More from the same category first, then the newest articles.</p>
              </>
            }
            action={
              <Link
                href="/articles"
                className="h-11 inline-flex items-center gap-2 px-5 bg-primary text-sm font-medium text-white hover:bg-primary/80 transition-colors whitespace-nowrap"
              >
                All articles
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </Link>
            }
          >
            {relatedTo(post).map((p) => (
              <div key={p.slug} data-card className="snap-start shrink-0 basis-[85%] sm:basis-[calc((100%-1rem)/2)] lg:basis-[calc((100%-2rem)/3)]">
                <ArticleCard post={p} />
              </div>
            ))}
          </HorizontalSlider>
        </div>
      </section>
    </>
  );
}
