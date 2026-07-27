/**
 * Collection Area detail page — shows books in a specific thematic area
 * Mirrors the categories detail functionality but at /{tenant}/collection-areas/[id]
 */

import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { BookOpen, Book as BookIcon } from 'lucide-react';
import { headers } from 'next/headers';
import SiteHeader from '@/components/layout/SiteHeader';
import { getReadDb } from '@/lib/mongodb';
import { LIBRARY_CATEGORIES } from '@/app/api/categories/route';
import { notFound } from 'next/navigation';
import { tenantBookUrl } from '@/lib/slugify';
import { AISection } from '@/components/embed/AISection';
import { getTenantContextFromRequest } from '@/lib/tenant-context';
import { getBookThumbnailUrl } from '@/lib/utils';

interface Book {
    id: string;
    slug?: string;
    title: string;
    display_title?: string;
    author: string;
    language: string;
    published: string;
    thumbnail?: string;
    thumbnail_blob?: string;
    pages_count?: number;
    pages_translated?: number;
    translation_percent?: number;
    summary?: { data: string } | string;
}

interface Props {
    params: Promise<{ id: string }>;
}

function getArea(id: string) {
    return LIBRARY_CATEGORIES.find(c => c.id === id);
}

async function getAreaBooks(id: string, tenantId: string | null): Promise<Book[]> {
    try {
        const db = await getReadDb();
        const books = await db.collection('books').find(
            { categories: id, visible: true, pages_translated: { $gt: 0 }, ...(tenantId ? { tenantId } : {}) },
            { maxTimeMS: 30000 }
        )
            .project({ _id: 0, pages_array: 0 })
            .sort({ pages_translated: -1, title: 1 })
            .toArray();
        return books as unknown as Book[];
    } catch (err) {
        console.error(`Collection area books fetch failed for ${id}:`, err);
        return [];
    }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { id } = await params;
    const area = getArea(id);
    if (!area) return { title: 'Area Not Found' };

    return {
        title: `${area.name} — Source Library`,
        description: `Browse ${area.description.toLowerCase()} in Source Library's collection of rare historical texts.`,
        alternates: { canonical: `/collection-areas/${id}` },
        openGraph: {
            images: [{ url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library — Digitizing and translating ancient texts' }],
            title: `${area.name} — Source Library`,
            description: area.description,
        },
        twitter: {
            card: 'summary_large_image',
            title: `${area.name} — Source Library`,
            description: area.description,
        },
    };
}

export default async function CollectionAreaPage({ params }: Props) {
    const { id } = await params;
    const { slug: tenantSlug, id: tenantId } = getTenantContextFromRequest(await headers());

    const area = getArea(id);
    if (!area) notFound();

    const books = await getAreaBooks(id, tenantId);

    return (
        <div className="min-h-screen bg-stone-50">
            <SiteHeader variant="light" />

            {/* Hero */}
            <div className="bg-gradient-to-b from-stone-800 to-stone-900 text-white">
                <div className="max-w-5xl mx-auto px-4 py-12">
                    <div className="flex items-center gap-4">
                        <span className="text-4xl">{area.icon}</span>
                        <div>
                            <h1 className="text-3xl sm:text-4xl font-serif font-bold">
                                {area.name}
                            </h1>
                            {area.description && (
                                <p className="text-stone-300 mt-2">{area.description}</p>
                            )}
                        </div>
                    </div>
                    <p className="text-accent-gold mt-4 font-medium">
                        {books.length} book{books.length !== 1 ? 's' : ''} in this area
                    </p>
                </div>
            </div>

            {/* Content */}
            <main className="max-w-5xl mx-auto px-4 py-8">
                {books.length === 0 ? (
                    <div className="text-center py-16">
                        <BookOpen className="w-16 h-16 text-stone-300 mx-auto mb-4" />
                        <h2 className="text-xl font-semibold text-stone-700 mb-2">
                            No books in this area yet
                        </h2>
                        <p className="text-stone-500">
                            Books will appear here as they are categorized.
                        </p>
                    </div>
                ) : (
                    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                        {books.map(book => {
                            const summaryText = typeof book.summary === 'string'
                                ? book.summary
                                : book.summary?.data;

                            return (
                                <Link
                                    key={book.id}
                                    href={tenantBookUrl(book, tenantSlug)}
                                    className="group bg-white rounded-xl border border-stone-200 overflow-hidden hover:border-accent-gold/20 hover:shadow-lg transition-all"
                                >
                                    {/* Thumbnail */}
                                    <div className="aspect-[3/2] bg-stone-100 relative overflow-hidden">
                                        {getBookThumbnailUrl(book) ? (
                                            <Image
                                                src={getBookThumbnailUrl(book)!}
                                                alt={book.title}
                                                fill
                                                className="object-cover group-hover:scale-105 transition-transform duration-300"
                                                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                                            />
                                        ) : (
                                            <div className="absolute inset-0 flex items-center justify-center">
                                                <BookIcon className="w-12 h-12 text-stone-300" />
                                            </div>
                                        )}
                                        {/* Translation badge */}
                                        {book.translation_percent !== undefined && (
                                            <div
                                                className={`absolute top-2 right-2 px-2 py-1 rounded-full text-xs font-medium ${(book.translation_percent ?? 0) >= 95
                                                        ? 'bg-status-success text-white'
                                                        : (book.translation_percent ?? 0) > 0
                                                            ? 'bg-accent-gold/80 text-white'
                                                            : 'bg-stone-500 text-white'
                                                    }`}
                                            >
                                                {(book.translation_percent ?? 0) >= 95
                                                    ? 'Translated'
                                                    : `${book.translation_percent}%`}
                                            </div>
                                        )}
                                    </div>

                                    {/* Content */}
                                    <div className="p-4">
                                        <h3 className="font-semibold text-sm group-hover:text-accent-rust transition-colors line-clamp-2">
                                            {book.display_title || book.title}
                                        </h3>
                                        <p className="text-xs text-muted mt-1 line-clamp-1">
                                            {book.author}
                                        </p>
                                        {summaryText && (
                                            <AISection>
                                                <p className="text-xs text-secondary mt-2 line-clamp-2">
                                                    {summaryText}
                                                </p>
                                            </AISection>
                                        )}
                                        {book.pages_count && (
                                            <p className="text-xs text-muted mt-2">
                                                {book.pages_count} pages
                                                {book.pages_translated ? ` • ${book.pages_translated} translated` : ''}
                                            </p>
                                        )}
                                    </div>
                                </Link>
                            );
                        })}
                    </div>
                )}
            </main>
        </div>
    );
}
