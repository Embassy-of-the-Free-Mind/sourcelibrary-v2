import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { unstable_cache } from 'next/cache';
import { getReadDb } from '@/lib/mongodb';
import { loadJourney } from '@/lib/journey/load-journey';
import { getTenantContext } from '@/lib/tenant-context';
import ConditionalSiteHeader from '@/components/layout/ConditionalSiteHeader';
import JourneyFilm from '@/components/journey/JourneyFilm';
import JourneyProse from '@/components/journey/JourneyProse';

/**
 * /book/<id>/journey?page=N — the journey film (#5861) for any translated
 * page: one page from the scan to a citable English page, built from the
 * page's own record. /how-it-works is the curated instance of this template.
 *
 * Not indexed: it is a view of a reader page that already has its own
 * canonical URL, and one per page of every book would be a crawl trap.
 * There is no loading.tsx in this segment, so notFound() is a real 404.
 */

export const preferredRegion = 'fra1';

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}

function pageParam(raw: string | undefined): number {
  const n = Number.parseInt(raw || '1', 10);
  return Number.isInteger(n) && n > 0 && n < 100000 ? n : 0;
}

const getJourney = (id: string, page: number) =>
  unstable_cache(
    async () => loadJourney(await getReadDb(), id, page),
    ['book-journey-v1', id, String(page)],
    { revalidate: 86400 },
  )();

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const page = pageParam(sp.page);
  const data = page ? await getJourney(id, page) : null;
  const robots = { index: false, follow: true };
  if (!data) return { title: 'Page not found · Source Library', robots };
  return {
    title: `How ${data.citation.locator} of ${data.displayTitle || data.title} was made · Source Library`,
    description: `One page of ${data.displayTitle || data.title}, from the scan to an English page that anyone can read and cite.`,
    robots,
  };
}

export default async function BookJourneyPage({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const page = pageParam(sp.page);
  if (!page) notFound();
  const [found, tenant] = await Promise.all([getJourney(id, page), getTenantContext()]);
  if (!found) notFound();
  // The proxy admits this book on a partner host (tenant-lockdown.md), but the
  // shelf of covers is drawn from the whole library — leave it out there.
  const data = tenant && (tenant.id || tenant.slug) ? { ...found, shelf: [], shelfLabel: undefined } : found;

  return (
    <main className="bg-cream">
      <ConditionalSiteHeader variant="light" />
      <JourneyFilm data={data} />
      <JourneyProse data={data} />
    </main>
  );
}
