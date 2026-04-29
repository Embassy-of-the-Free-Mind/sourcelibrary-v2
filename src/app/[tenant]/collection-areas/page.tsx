/**
 * Collection Areas list page for a tenant
 * Shows all thematic/domain areas (Alchemy, Hermeticism, etc.)
 * with book counts specific to this tenant
 */

import { Metadata } from 'next';
import Link from 'next/link';
import { getReadDb } from '@/lib/mongodb';
import { getTenantContextFromRequest } from '@/lib/tenant-context';
import { headers } from 'next/headers';
import SiteHeader from '@/components/layout/SiteHeader';
import { LIBRARY_CATEGORIES } from '@/app/api/categories/route';
import { notFound } from 'next/navigation';

interface Props {
    params: Promise<{ tenant: string }>;
}

export const metadata: Metadata = {
    title: 'Collection Areas - Source Library',
    description: 'Browse thematic areas of the Source Library collection',
};

interface AreaWithCount {
    id: string;
    name: string;
    description: string;
    icon: string;
    count: number;
}

async function getAreaCounts(tenantId: string): Promise<AreaWithCount[]> {
    try {
        const db = await getReadDb();
        const counts = await db.collection('books').aggregate([
            { $match: { tenantId, visible: true, pages_translated: { $gt: 0 } } },
            { $unwind: '$categories' },
            { $group: { _id: '$categories', count: { $sum: 1 } } },
            { $project: { _id: 0, category: '$_id', count: 1 } },
        ]).toArray() as Array<{ category: string; count: number }>;

        const countMap = new Map<string, number>();
        counts.forEach(({ category, count }) => {
            countMap.set(category, count);
        });

        return LIBRARY_CATEGORIES.map(cat => ({
            ...cat,
            count: countMap.get(cat.id) || 0,
        })).filter(cat => cat.count > 0);
    } catch (err) {
        console.error('Failed to fetch area counts:', err);
        return LIBRARY_CATEGORIES.map(cat => ({ ...cat, count: 0 }));
    }
}

export default async function CollectionAreasPage({ params }: Props) {
    const { tenant } = await params;
    const { id: tenantId } = getTenantContextFromRequest(await headers());

    if (!tenantId) {
        notFound();
    }

    const areas = await getAreaCounts(tenantId);
    const areasWithBooks = areas.filter(a => a.count > 0);

    return (
        <div className="min-h-screen bg-stone-50">
            <SiteHeader variant="light" />

            {/* Hero */}
            <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white">
                <div className="max-w-5xl mx-auto px-4 py-12">
                    <h1 className="text-3xl sm:text-4xl font-serif font-bold mb-3">
                        Collection Areas
                    </h1>
                    <p className="text-stone-300 max-w-2xl">
                        Explore our collection organized by thematic and philosophical domains
                    </p>
                </div>
            </div>

            {/* Content */}
            <main className="max-w-5xl mx-auto px-4 py-12">
                {areasWithBooks.length === 0 ? (
                    <div className="text-center py-12">
                        <p className="text-stone-500 mb-4">No collection areas available yet</p>
                    </div>
                ) : (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {areasWithBooks.map(area => (
                            <Link
                                key={area.id}
                                href={`/${tenant}/collection-areas/${area.id}`}
                                className="group flex flex-col p-6 bg-white rounded-lg border border-stone-200 hover:border-accent-gold/30 hover:shadow-md transition-all"
                            >
                                <div className="text-3xl mb-3">{area.icon}</div>
                                <h2 className="font-semibold text-lg text-primary group-hover:text-accent-rust transition-colors mb-2">
                                    {area.name}
                                </h2>
                                <p className="text-sm text-muted mb-4 flex-grow">
                                    {area.description}
                                </p>
                                <div className="text-xs font-medium text-secondary">
                                    {area.count} {area.count === 1 ? 'book' : 'books'}
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </main>
        </div>
    );
}
