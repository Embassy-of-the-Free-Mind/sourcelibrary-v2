import { Metadata } from 'next';
import { getReadDb } from '@/lib/mongodb';
import { notFound, redirect } from 'next/navigation';
import type { Book } from '@/lib/types';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import CompareClient from './CompareClient';
import { canonWork, workEditionsFilter } from '@/lib/canon-works';
import { workAliasTarget } from '@/lib/work-alias';

// Must be a finite number — `false` would cache a bad render forever (same
// rule as the parent work page; see CLAUDE.md on ISR + fallible fetches).
export const revalidate = 21600;
export const dynamicParams = true;
export async function generateStaticParams() {
  return [];
}

interface PageProps {
  params: Promise<{ id: string }>;
}

interface EditionForCompare {
  id: string;
  slug: string;
  title: string;
  display_title?: string;
  author: string;
  published: string;
  language: string;
  pages_count: number;
  pages_translated: number;
  chapters: Array<{
    title: string;
    titleEn?: string;
    pageNumber: number;
    level: number;
  }>;
  thumbnail?: string;
  thumbnail_blob?: string;
  work_title?: string;
}

// Slug fallback for the <title> tag (no editions in scope yet). Strips the
// `local:{author_id}:` prefix of minted ids so it never reads "Local:a:…";
// the visible heading uses the curated work_title from the editions instead.
function workTitle(workId: string): string {
  const tail = workId.includes(':') ? workId.split(':').pop()! : workId;
  return tail.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
function workTitleFromEditions(editions: { work_title?: string }[], workId: string): string {
  const t = editions.find((e) => (e.work_title || '').trim())?.work_title;
  return (t && t.trim()) || workTitle(workId);
}

async function getEditionsForCompare(workId: string): Promise<EditionForCompare[]> {
  const db = await getReadDb();
  const editions = await db
    .collection('books')
    .find(
      workEditionsFilter(workId),
      {
        projection: {
          id: 1,
          slug: 1,
          title: 1,
          display_title: 1,
          author: 1,
          published: 1,
          language: 1,
          pages_count: 1,
          pages_translated: 1,
          chapters: 1,
          thumbnail: 1, image_display: 1,
          thumbnail_blob: 1, image_thumb: 1,
          work_title: 1,
        },
        sort: { published: 1 },
      }
    )
    .toArray();
  return editions.map((e) => ({
    id: (e.id || e._id?.toString()) as string,
    slug: e.slug as string,
    title: e.title as string,
    display_title: e.display_title as string | undefined,
    author: e.author as string,
    published: e.published as string,
    language: e.language as string,
    pages_count: (e.pages_count || 0) as number,
    pages_translated: (e.pages_translated || 0) as number,
    chapters: ((e.chapters || []) as Array<{ title: string; titleEn?: string; pageNumber: number; level: number; endPage?: number }>).map((ch) => ({
      title: ch.title,
      titleEn: ch.titleEn,
      pageNumber: ch.pageNumber,
      level: ch.level,
    })),
    thumbnail: e.thumbnail as string | undefined,
    thumbnail_blob: e.thumbnail_blob as string | undefined,
    work_title: e.work_title as string | undefined,
  }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id: rawId } = await params;
  // Decode non-ASCII work_id (CJK / accented) before use — see /work/[id]/page.tsx.
  const id = decodeURIComponent(rawId);
  const title = canonWork(id)?.title || workTitle(id);
  return {
    title: `Compare Translations — ${title} | Source Library`,
    description: `Compare translations across editions of ${title}. View original language texts alongside AI and human translations side by side.`,
    robots: { index: true, follow: true },
    alternates: { canonical: `/work/${id}/compare` },
  };
}

export default async function CompareWorkPage({ params }: PageProps) {
  const { id: rawId } = await params;
  const id = decodeURIComponent(rawId);
  const editions = await getEditionsForCompare(id);
  if (editions.length === 0) {
    // retired work_id (merged cluster, #3759) — follow the alias, keep old URLs alive
    const target = await workAliasTarget(await getReadDb(), id);
    if (target) redirect(`/work/${encodeURIComponent(target)}/compare`);
  }
  if (editions.length < 2) notFound();

  const title = canonWork(id)?.title || workTitleFromEditions(editions, id);
  const translatedEditions = editions.filter((e) => e.pages_translated > 0);

  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title={`Compare: ${title}`}
          subtitle={`${editions.length} editions, ${new Set(editions.map((e) => e.language)).size} languages`}
        />
      }
      bg="bg-cream"
    >
      <CompareClient editions={translatedEditions} workId={id} allEditions={editions} />
    </ContentPageLayout>
  );
}
