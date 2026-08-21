import type { Metadata } from 'next';
import { librarianMetadata } from '@/lib/librarian-i18n';

export const metadata: Metadata = librarianMetadata('en');

export default function LibrarianLayout({ children }: { children: React.ReactNode }) {
  return children;
}
