import type { Metadata } from 'next';
import { librarianMetadata } from '@/lib/librarian-i18n';

export const metadata: Metadata = librarianMetadata('zh');

export default function ZhLibrarianLayout({ children }: { children: React.ReactNode }) {
  return <div lang="zh-Hans">{children}</div>;
}
