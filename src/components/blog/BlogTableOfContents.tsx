'use client';

import { useEffect, useState, useRef } from 'react';

interface TocEntry {
  id: string;
  text: string;
}

/**
 * Floating table of contents for long blog posts.
 * Scans for h2 elements inside the nearest <article>, assigns IDs, and
 * renders a sticky sidebar nav on desktop (hidden on mobile — uses a
 * collapsible button instead).
 *
 * Drop into any blog page: <BlogTableOfContents />
 * Only renders if ≥ 3 headings are found.
 */
export default function BlogTableOfContents() {
  const [entries, setEntries] = useState<TocEntry[]>([]);
  const [activeId, setActiveId] = useState('');
  const [mobileOpen, setMobileOpen] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const article = document.querySelector('article');
    if (!article) return;

    const headings = Array.from(article.querySelectorAll('h2'));
    if (headings.length < 3) return;

    // Assign IDs and build entries
    const tocEntries: TocEntry[] = headings.map((h) => {
      if (!h.id) {
        h.id = (h.textContent || '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
      }
      return { id: h.id, text: h.textContent || '' };
    });
    setEntries(tocEntries);

    // Track active heading via IntersectionObserver
    observerRef.current = new IntersectionObserver(
      (ioEntries) => {
        for (const entry of ioEntries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      { rootMargin: '-80px 0px -70% 0px', threshold: 0 }
    );

    for (const h of headings) {
      observerRef.current.observe(h);
    }

    return () => observerRef.current?.disconnect();
  }, []);

  if (entries.length === 0) return null;

  const handleClick = (id: string) => {
    setMobileOpen(false);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <>
      {/* Desktop: sticky sidebar */}
      <nav className="hidden xl:block fixed top-32 w-52 max-h-[calc(100vh-10rem)] overflow-y-auto" style={{ right: 'max(1.5rem, calc((100vw - 1024px) / 2 - 15rem))' }}>
        <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-3">Contents</p>
        <ul className="space-y-1.5 border-l border-border-light pl-3">
          {entries.map((e) => (
            <li key={e.id}>
              <button
                onClick={() => handleClick(e.id)}
                className={`text-left text-[13px] leading-snug transition-colors hover:text-accent-rust block w-full ${
                  activeId === e.id
                    ? 'text-accent-rust font-medium'
                    : 'text-muted'
                }`}
              >
                {e.text}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Mobile: floating button + dropdown */}
      <div className="xl:hidden fixed bottom-6 right-6 z-50">
        {mobileOpen && (
          <div className="absolute bottom-14 right-0 w-72 max-h-80 overflow-y-auto bg-white rounded-xl shadow-xl border border-border-light p-4">
            <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Contents</p>
            <ul className="space-y-2">
              {entries.map((e) => (
                <li key={e.id}>
                  <button
                    onClick={() => handleClick(e.id)}
                    className={`text-left text-sm leading-snug transition-colors hover:text-accent-rust block w-full ${
                      activeId === e.id
                        ? 'text-accent-rust font-medium'
                        : 'text-secondary'
                    }`}
                  >
                    {e.text}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="w-12 h-12 rounded-full bg-stone-900 text-white shadow-lg flex items-center justify-center hover:bg-stone-800 transition-colors"
          aria-label="Table of contents"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h12" />
          </svg>
        </button>
      </div>
    </>
  );
}
