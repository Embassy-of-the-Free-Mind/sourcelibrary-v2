import { notFound } from 'next/navigation';
import { getReadDb } from '@/lib/mongodb';
import BPHBookDetail from './BPHBookDetail';

export const revalidate = 3600; // 1h ISR

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function BPHBookPage({ params }: Props) {
  const { slug } = await params;
  const db = await getReadDb();

  const book = await db.collection('books').findOne(
    {
      $or: [{ slug }, { id: slug }],
      'image_source.provider': 'bph',
      visible: true,
    },
    {
      projection: {
        _id: 0,
        id: 1,
        slug: 1,
        title: 1,
        display_title: 1,
        author: 1,
        language: 1,
        published: 1,
        year: 1,
        pages_count: 1,
        pages_translated: 1,
        pages_ocr: 1,
        thumbnail: 1,
        thumbnail_blob: 1,
        categories: 1,
        'dublin_core.dc_source': 1,
        'dublin_core.dc_description': 1,
        summary: 1,
        reading_summary: 1,
        chapters: 1,
        doi: 1,
        is_first_translation: 1,
      },
    }
  );

  if (!book) notFound();

  const summaryText = book.reading_summary?.overview
    || (typeof book.summary === 'string' ? book.summary : book.summary?.data)
    || null;

  const serialized = {
    id: book.id,
    slug: book.slug || book.id,
    title: book.title,
    display_title: book.display_title,
    author: book.author,
    language: book.language,
    published: book.published,
    year: book.year,
    pages_count: book.pages_count,
    pages_translated: book.pages_translated || 0,
    pages_ocr: book.pages_ocr || 0,
    thumbnail: book.thumbnail_blob || book.thumbnail,
    catalogue_number: book.dublin_core?.dc_source || null,
    description: book.dublin_core?.dc_description || null,
    summary: summaryText,
    categories: book.categories || [],
    chapters: book.chapters || [],
    doi: book.doi || null,
    is_first_translation: book.is_first_translation || false,
  };

  return <BPHBookDetail book={serialized} />;
}
