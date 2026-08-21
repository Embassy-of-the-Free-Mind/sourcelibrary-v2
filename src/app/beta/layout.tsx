import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Source Library — Early Access',
  description: 'Sign up for early access to Source Library. 1,200+ rare Hermetic, alchemical, and esoteric texts digitized and translated into modern English.',
  openGraph: {
    images: [{ url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library — Digitizing and translating ancient texts' }],
    title: 'Source Library — Early Access',
    description: 'Sign up for early access to Source Library. Rare Hermetic & Renaissance texts digitized and translated with AI.',
  },
};

export default function BetaLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Hide the global footer — this page has its own */}
      <style>{`#main-content ~ footer { display: none !important; }`}</style>
      {children}
    </>
  );
}
