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
      {/* Shared cards turn rust on hover. Prototype only: no red text or hover red. */}
      <style>{`
        .revamp-scope .group:hover .group-hover\\:text-accent-rust { color: inherit; text-decoration: none; }
        .revamp-scope [class*="hover:shadow"]:hover { box-shadow: none; }
        .revamp-scope .hover\\:border-accent-rust:hover, .revamp-scope [class*="hover:border-accent-rust"]:hover { border-color: var(--text-primary, #1a1612); }
        .revamp-scope .on-dark label { color: #fff; }
        .revamp-scope .on-dark [class*="text-muted"] { color: rgba(255,255,255,.72); }
        .revamp-scope .on-dark button[class*="underline"] { text-decoration-color: rgba(255,255,255,.4); }
        .revamp-scope .on-dark button[class*="underline"]:hover { color: #fff; text-decoration-color: #fff; }
        .revamp-scope .on-dark [data-catalog-bar] { border-color: transparent; }
        .revamp-scope :focus-visible { outline: 2px solid var(--text-primary, #1a1612); outline-offset: 2px; }
        .revamp-scope input:focus-visible, .revamp-scope textarea:focus-visible, .revamp-scope select:focus-visible { outline: none; }
        .revamp-scope select:focus, .revamp-scope textarea:focus { border-color: var(--text-primary, #1a1612); box-shadow: 0 0 0 1px var(--text-primary, #1a1612); }
        .revamp-scope .on-dark :focus-visible { outline-color: #fff; }
      `}</style>
      <div className="revamp-scope">{children}</div>
    </>
  );
}
