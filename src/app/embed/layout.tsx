import type { Metadata } from 'next';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/**
 * Layout for embed routes. Adds data-embed attribute to hide
 * SiteHeader, GlobalFooter, and other chrome via CSS.
 * The root layout still wraps this — we just signal "embed mode".
 */
export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-embed="" className="embed-mode">
      {children}
    </div>
  );
}
