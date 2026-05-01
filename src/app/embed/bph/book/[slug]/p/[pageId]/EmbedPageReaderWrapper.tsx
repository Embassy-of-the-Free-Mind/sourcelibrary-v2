'use client';

import dynamic from 'next/dynamic';
import type { Book, Page } from '@/lib/types';

const PageEditorClient = dynamic(
  () => import('@/components/book/PageEditorClient'),
  { ssr: false, loading: () => <div className="flex items-center justify-center min-h-screen"><div className="animate-pulse text-stone-400">Loading page reader...</div></div> }
);

interface Props {
  book: Book;
  page: Page;
  pageList: Page[];
}

export default function EmbedPageReaderWrapper({ book, page, pageList }: Props) {
  return (
    <PageEditorClient
      initialBook={book}
      initialPage={page}
      initialPageList={pageList}
    />
  );
}
