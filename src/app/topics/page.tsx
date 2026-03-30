import { getDb } from '@/lib/mongodb';
import Link from 'next/link';
import Image from 'next/image';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';
import type { Metadata } from 'next';
import { FACETS, DOMAIN_GROUPS, facetDbField } from '@/lib/taxonomy/faceted-vocabulary';
import DomainTreemap, { type SubDomain } from '@/components/topics/DomainTreemap';

// ISR: rebuild every 6 hours. Allow 60s for first-hit generation.
export const revalidate = 21600;
export const maxDuration = 60;

export const metadata: Metadata = {
  title: 'Browse by Topic | Source Library',
  description: 'Explore historical texts across six dimensions: tradition, domain, form, cultural sphere, era, and epistemic mode. Filter and combine to find exactly what you\'re looking for.',
  alternates: { canonical: '/topics' },
};

function facetSlug(facetId: string, valueId: string): string {
  return `${facetId}--${valueId}`;
}

interface FacetCount {
  id: string;
  label: string;
  count: number;
  thumbnails: string[];
}

interface FacetGroup {
  id: string;
  label: string;
  question: string;
  values: FacetCount[];
}

async function fetchFacetCounts(): Promise<{ groups: FacetGroup[]; totalBooks: number }> {
  const db = await getDb();
  const maxTimeMS = 30000;
  const baseMatch = { faceted_tags: { $exists: true }, visible: true };

  // Single $facet aggregation — one collection scan for all 6 facets
  const facetStages: Record<string, object[]> = {};
  for (const facet of FACETS) {
    const field = `faceted_tags.${facetDbField(facet)}`;
    facetStages[facet.id] = [
      { $unwind: `$${field}` },
      { $group: { _id: `$${field}`, count: { $sum: 1 }, sample_thumb: { $first: '$thumbnail_blob' } } },
      { $sort: { count: -1 } },
    ];
  }
  facetStages['_total'] = [{ $count: 'n' }];

  const [result] = await db.collection('books').aggregate([
    { $match: baseMatch },
    { $facet: facetStages },
  ], { maxTimeMS, allowDiskUse: true }).toArray();

  const totalBooks = result._total?.[0]?.n ?? 0;

  const groups: FacetGroup[] = FACETS.map((facet) => {
    const results = (result[facet.id] || []) as Array<{ _id: string; count: number; sample_thumb?: string }>;
    const values: FacetCount[] = results.map((r) => {
      const vocabValue = facet.values.find((v) => v.id === r._id);
      return {
        id: r._id,
        label: vocabValue?.label || r._id,
        count: r.count,
        thumbnails: r.sample_thumb ? [r.sample_thumb] : [],
      };
    });
    return { id: facet.id, label: facet.label, question: facet.question, values };
  });

  return { groups, totalBooks };
}


/** Single aggregation: all domain co-occurrences in one pass */
async function fetchDomainCrossTab(): Promise<Map<string, SubDomain[]>> {
  const db = await getDb();
  // Efficient: project array as two copies, unwind both, filter out self-pairs
  const results = await db.collection('books').aggregate([
    { $match: { 'faceted_tags.knowledge_domain.1': { $exists: true }, visible: true } },
    { $project: { a: '$faceted_tags.knowledge_domain', b: '$faceted_tags.knowledge_domain' } },
    { $unwind: '$a' },
    { $unwind: '$b' },
    { $match: { $expr: { $gt: ['$b', '$a'] } } },  // ordered pairs only (avoids dupes)
    { $group: { _id: { d1: '$a', d2: '$b' }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ], { allowDiskUse: true, maxTimeMS: 8000 }).toArray();

  const map = new Map<string, SubDomain[]>();
  const labelify = (s: string) => s.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
  for (const r of results) {
    const d1 = r._id.d1 as string;
    const d2 = r._id.d2 as string;
    const count = r.count as number;
    if (count < 5) continue;
    // Add to both domains (symmetric)
    for (const [domain, coDomain] of [[d1, d2], [d2, d1]]) {
      const arr = map.get(domain) || [];
      if (arr.length < 8) {
        arr.push({ id: coDomain, label: labelify(coDomain), count });
      }
      map.set(domain, arr);
    }
  }
  return map;
}

function FacetValueCard({ value, facetId }: { value: FacetCount; facetId: string }) {
  return (
    <Link
      href={`/topics/${facetId}--${value.id}`}
      className="group relative block overflow-hidden rounded-lg border border-border-light bg-white hover:border-accent-rust/30 hover:shadow-md transition-all"
    >
      {value.thumbnails.length > 0 && (
        <div className="flex h-16 overflow-hidden">
          {value.thumbnails.slice(0, 4).map((url, i) => (
            <div key={i} className="relative flex-1 overflow-hidden">
              <Image
                src={url}
                alt=""
                fill
                sizes="(max-width: 640px) 25vw, 12vw"
                className="object-cover group-hover:scale-105 transition-transform duration-500"
                unoptimized
              />
            </div>
          ))}
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-white" />
        </div>
      )}
      <div className="p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-display text-sm font-semibold text-primary group-hover:text-accent-rust transition-colors leading-tight">
            {value.label}
          </h3>
          <span className="text-xs text-muted whitespace-nowrap flex-shrink-0">
            {value.count.toLocaleString()}
          </span>
        </div>
      </div>
    </Link>
  );
}

function FacetGrid({ values, facetId }: { values: FacetCount[]; facetId: string }) {
  return (
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {values.map((value) => (
        <FacetValueCard key={value.id} value={value} facetId={facetId} />
      ))}
    </div>
  );
}

function DomainGroupedGrid({ values, facetId }: { values: FacetCount[]; facetId: string }) {
  const valueMap = new Map(values.map(v => [v.id, v]));

  // Filter to groups that have at least one domain with books
  const activeGroups = DOMAIN_GROUPS
    .map(g => ({
      ...g,
      domainValues: g.domains
        .map(id => valueMap.get(id))
        .filter((v): v is FacetCount => !!v && v.count > 0),
    }))
    .filter(g => g.domainValues.length > 0);

  return (
    <div className="space-y-8">
      {activeGroups.map((group) => (
        <div key={group.id}>
          <h3 className="font-display text-base text-secondary mb-3">
            {group.label}
          </h3>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {group.domainValues.map((value) => (
              <FacetValueCard key={value.id} value={value} facetId={facetId} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default async function TopicsPage() {
  const { groups, totalBooks } = await fetchFacetCounts().catch((err) => {
    console.error('Facet counts fetch failed:', err);
    return { groups: [] as FacetGroup[], totalBooks: 0 };
  });

  // Cross-tab is optional — don't let it block the page
  const crossTab = await fetchDomainCrossTab().catch((err) => {
    console.error('Cross-tab fetch failed (non-fatal):', err?.message);
    return new Map<string, SubDomain[]>();
  });

  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Browse the Library"
          subtitle={`${totalBooks.toLocaleString()} books across six dimensions. Click any tag to explore, or combine tags to narrow your search.`}
        />
      }
    >

      <div className="space-y-12">
        {groups.map((group) => (
          <section key={group.id}>
            <div className="mb-4">
              <h2 className="font-display text-xl md:text-2xl text-primary">
                {group.label}
              </h2>
              <p className="text-sm text-muted mt-1">{group.question}</p>
            </div>

            {/* Domain facet: treemap only */}
            {group.id === 'domain' ? (
              <DomainTreemap
                  domains={group.values
                    .filter(v => v.count > 0)
                    .map(v => {
                      const dg = DOMAIN_GROUPS.find(g => g.domains.includes(v.id));
                      return {
                        id: v.id,
                        label: v.label,
                        count: v.count,
                        groupId: dg?.id || 'reference',
                        groupLabel: dg?.label || 'Other',
                      };
                    })}
                  totalBooks={totalBooks}
                />
            ) : (
              <FacetGrid values={group.values} facetId={group.id} />
            )}
          </section>
        ))}
      </div>

      {/* Link to old cluster view */}
      <div className="mt-16 pt-8 border-t border-border-light">
        <p className="text-sm text-muted">
          Looking for the AI-discovered topic clusters?{' '}
          <Link href="/topics/clusters" className="text-accent-rust hover:underline">
            Browse 48 clusters
          </Link>{' '}
          found by embedding analysis.
        </p>
      </div>
    </ContentPageLayout>
  );
}
