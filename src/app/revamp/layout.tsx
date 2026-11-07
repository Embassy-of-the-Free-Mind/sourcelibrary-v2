import type { Metadata } from 'next';
import LinkOut from './_components/LinkOut';
import RevampHeader from './_components/RevampHeader';
import { navData } from './_lib/nav';

export const metadata: Metadata = {
  title: 'Collections revamp prototype',
  robots: { index: false, follow: false },
};

export default function RevampLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <LinkOut />
      <RevampHeader nav={navData()} />
      {children}
    </>
  );
}
