import type { Metadata } from 'next';
import '../../globals.css';

export const metadata: Metadata = {
  title: 'Bibliotheca Philosophica Hermetica — Digital Catalogue',
  description: 'Browse the digitized collection of the Embassy of the Free Mind.',
  robots: { index: false, follow: false }, // Don't index embed pages
};

/**
 * Minimal layout for BPH embed pages.
 * No header, no footer, no analytics — just clean content for iframe embedding.
 */
export default function BPHEmbedLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#fafaf8] text-stone-900 antialiased" style={{ margin: 0, padding: 0 }}>
        {children}
      </body>
    </html>
  );
}
