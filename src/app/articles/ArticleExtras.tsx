'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import HorizontalSlider from '@/components/HorizontalSlider';
import BlogPostSchema from '@/components/seo/BlogPostSchema';
import { BASE_URL } from '@/components/seo/schema-utils';
import revisions from '@/generated/blog-revisions.json';
import { posts, LINKED_PAGES, KIND_INFO, postHref, type BlogPost } from './posts';

// Articles that render their own BlogPostSchema with hand-written fields.
const OWN_SCHEMA = new Set([
  '10000-books',
  'first-translations',
  'how-big-is-the-library',
  'nobody-knows-what-has-been-scanned',
  'reading-classical-chinese',
]);

const RELATED_COUNT = 8;

function isoDate(date: string) {
  const t = Date.parse(date);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString().slice(0, 10);
}

const newestFirst = (a: BlogPost, b: BlogPost) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0);

// Same category first, newest first, then the newest from the others.
function relatedTo(post: BlogPost): BlogPost[] {
  const pool = [...posts, ...LINKED_PAGES].filter((p) => p.slug !== post.slug).sort(newestFirst);
  const same = pool.filter((p) => p.kind === post.kind);
  const rest = pool.filter((p) => p.kind !== post.kind);
  return [...same, ...rest].slice(0, RELATED_COUNT);
}

function RelatedCard({ post }: { post: BlogPost }) {
  return (
    <div data-card className="snap-start shrink-0 basis-[80%] sm:basis-[calc((100%-1rem)/2)] lg:basis-[calc((100%-2rem)/3)] xl:basis-[calc((100%-3rem)/4)]">
      <Link href={postHref(post)} className="group block">
        <div className="relative aspect-[16/9] overflow-hidden bg-cover-bg">
          <Image
            src={post.image}
            alt={post.imageAlt || ''}
            fill
            sizes="(max-width: 640px) 80vw, (max-width: 1024px) 50vw, 25vw"
            className="object-cover group-hover:scale-[1.02] transition-transform duration-500"
            style={post.imagePosition ? { objectPosition: post.imagePosition } : undefined}
            loading="lazy"
          />
        </div>
        <p className="mt-3 text-sm text-muted">
          {KIND_INFO[post.kind].label}
          <span className="mx-2 text-border-light" aria-hidden="true">|</span>
          {post.date}
        </p>
        <h3 className="mt-1.5 font-serif text-xl text-primary leading-snug line-clamp-3">{post.title}</h3>
      </Link>
    </div>
  );
}

// Below every listed article: its Article JSON-LD (unless the page writes its
// own) and a slider of related articles. Rendered once from the layout.
export default function ArticleExtras() {
  const pathname = usePathname();
  const slug = pathname?.replace(/^\/articles\//, '').replace(/\/$/, '');
  const post = slug ? posts.find((p) => p.slug === slug) : undefined;
  if (!post) return null;

  const rev = (revisions as Record<string, { revised?: string }>)[post.slug];
  const image = post.image.startsWith('/') ? `${BASE_URL}${post.image}` : post.image;

  return (
    <>
      {!OWN_SCHEMA.has(post.slug) && (
        <BlogPostSchema
          slug={post.slug}
          title={post.title}
          description={post.subtitle}
          datePublished={isoDate(post.date) ?? ''}
          dateModified={rev?.revised ? rev.revised.slice(0, 10) : undefined}
          image={image}
        />
      )}
      <section className="bg-cream print:hidden" aria-labelledby="related-articles">
        <div className="max-w-[var(--container-wide)] mx-auto px-6 md:px-12 pb-20">
          <div className="border-t border-border-light pt-10 mb-6 flex items-baseline justify-between gap-4">
            <h2 id="related-articles" className="font-serif text-3xl text-primary">
              Related articles
            </h2>
            <Link href="/articles" className="text-sm text-primary underline decoration-border-light underline-offset-4 hover:decoration-primary">
              All articles
            </Link>
          </div>
          <HorizontalSlider ariaLabel="related articles">
            {relatedTo(post).map((p) => (
              <RelatedCard key={p.slug} post={p} />
            ))}
          </HorizontalSlider>
        </div>
      </section>
    </>
  );
}
