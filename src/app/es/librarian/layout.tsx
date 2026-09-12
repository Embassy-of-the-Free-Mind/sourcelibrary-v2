import type { Metadata } from 'next';
import { librarianMetadata } from '@/lib/librarian-i18n';

export const metadata: Metadata = librarianMetadata('es');

export default function EsLibrarianLayout({ children }: { children: React.ReactNode }) {
  return <div lang="es">{children}</div>;
}
