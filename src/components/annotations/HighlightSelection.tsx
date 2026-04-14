'use client';

import { ReactNode } from 'react';

interface HighlightSelectionProps {
  bookId: string;
  pageId: string;
  pageNumber: number;
  bookTitle: string;
  bookAuthor?: string;
  bookYear?: string;
  doi?: string;
  children: ReactNode;
}

export default function HighlightSelection({ children }: HighlightSelectionProps) {
  return <>{children}</>;
}
