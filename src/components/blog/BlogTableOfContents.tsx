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
  const [visible, setVisible] = useState(false);
  // How far through the article the reader is, 0 to 1, for the progress line.
  const [progress, setProgress] = useState(0);
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

  // Show the TOC once the reader has scrolled past the hero/header area.
  // This prevents the sidebar from sitting on top of the full-bleed header image.
  useEffect(() => {
    if (entries.length === 0) return;

    const firstHeading = document.querySelector('article h2');
    const threshold = (() => {
      if (firstHeading) {
        const rect = firstHeading.getBoundingClientRect();
        return Math.max(0, rect.top + window.scrollY - 200);
      }
      return 500;
    })();

    // Hide again once the article ends (the related-articles slider comes up),
    // so the panel never sits over it.
    const onScroll = () => {
      const related = document.getElementById('related-articles');
      const ended = related ? related.getBoundingClientRect().top < window.innerHeight * 0.85 : false;
      setVisible(window.scrollY > threshold && !ended);
      const article = document.querySelector('article');
      if (article) {
        const rect = article.getBoundingClientRect();
        const read = (window.innerHeight * 0.4 - rect.top) / rect.height;
        setProgress(Math.min(1, Math.max(0, read)));
      }
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [entries.length]);

  if (entries.length === 0) return null;
  const activeIndex = entries.findIndex((e) => e.id === activeId);

  const handleClick = (id: string) => {
    setMobileOpen(false);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <>
      {/* Wide screens: sticky sidebar. It only clears the 928px article column from about 1500px
          (column + two 240px panels + gaps); below that it covered the line ends, so narrower
          screens get the floating button instead. */}
      <nav
        aria-label="Table of contents"
        className={`hidden min-[1500px]:block fixed top-28 w-60 max-h-[calc(100vh-9rem)] overflow-y-auto border border-border-light bg-white transition-opacity duration-300 ${
          visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        style={{ right: 'max(1.5rem, calc((100vw - 1024px) / 2 - 16.5rem))' }}
      >
        <div className="sticky top-0 bg-white px-5 pt-4 pb-3">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-medium text-primary">Contents</p>
            {activeIndex >= 0 && (
              <p className="text-xs text-muted tabular-nums">
                {activeIndex + 1} of {entries.length}
              </p>
            )}
          </div>
          {/* Reading progress through the article. */}
          <div className="mt-3 h-0.5 bg-border-light" aria-hidden="true">
            <div className="h-full bg-accent-gold transition-[width] duration-150" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        </div>
        <ol className="px-2 pb-3">
          {entries.map((e, i) => {
            const current = activeId === e.id;
            return (
              <li key={e.id}>
                <button
                  onClick={() => handleClick(e.id)}
                  aria-current={current ? 'location' : undefined}
                  className={`group flex w-full gap-3 border-l-2 px-3 py-1.5 text-left text-[13px] leading-snug transition-colors ${
                    current ? 'border-accent-gold-dark text-primary' : 'border-transparent text-muted hover:text-primary'
                  }`}
                >
                  <span className={`w-4 shrink-0 tabular-nums ${current ? 'text-accent-gold-dark' : 'text-faint'}`}>{i + 1}</span>
                  <span>{e.text}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Mobile: floating button + dropdown */}
      <div className="min-[1500px]:hidden fixed bottom-6 right-6 z-50">
        {mobileOpen && (
          <div className="absolute bottom-14 right-0 w-72 max-h-80 overflow-y-auto bg-white shadow-xl border border-border-light p-4">
            <p className="text-sm font-medium text-primary mb-2">Contents</p>
            <ol className="space-y-1">
              {entries.map((e, i) => (
                <li key={e.id}>
                  <button
                    onClick={() => handleClick(e.id)}
                    className={`flex w-full gap-3 border-l-2 px-3 py-1 text-left text-sm leading-snug transition-colors hover:text-primary ${
                      activeId === e.id ? 'border-accent-gold-dark text-primary' : 'border-transparent text-secondary'
                    }`}
                  >
                    <span className="w-4 shrink-0 tabular-nums text-faint">{i + 1}</span>
                    <span>{e.text}</span>
                  </button>
                </li>
              ))}
            </ol>
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
