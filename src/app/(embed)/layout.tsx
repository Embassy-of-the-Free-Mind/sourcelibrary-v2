import type { Metadata } from 'next';
import '../globals.css';

export const metadata: Metadata = {
  title: 'Bibliotheca Philosophica Hermetica — Digital Catalogue',
  description: 'Browse the digitized collection of the Embassy of the Free Mind.',
  robots: { index: false, follow: false },
};

/**
 * Root layout for embedded BPH pages.
 * Replaces the main app layout — no header, footer, analytics, or providers.
 * Clean content only, designed for iframe embedding.
 */
export default function EmbedRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#fafaf8] text-stone-900 antialiased" style={{ margin: 0, padding: 0 }}>
        {children}
      </body>
    </html>
  );
}
