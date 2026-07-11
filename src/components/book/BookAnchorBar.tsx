'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Share2, Code2, Link2, Check } from 'lucide-react';

interface Section { id: string; label: string }

/**
 * "On this page" sub-nav for the book page — mirrors the collection-page
 * MycoAnchorBar. Jump links inline on desktop, collapse to a dropdown on
 * tablet/mobile; Share + Embed popovers. Existing tokens only.
 */
export default function BookAnchorBar({ sections, slug }: { sections: Section[]; slug: string }) {
  const [open, setOpen] = useState<null | 'jump' | 'share' | 'embed'>(null);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(null);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pageUrl = typeof window !== 'undefined' ? window.location.href.split('#')[0] : `https://sourcelibrary.org/book/${slug}`;
  const embedSnippet = `<iframe src="https://sourcelibrary.org/book/${slug}" width="100%" height="720" style="border:0" loading="lazy"></iframe>`;

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* noop */ }
  };

  return (
    <nav aria-label="On this page" className="border-b border-border-light bg-cream">
      <div ref={rootRef} className="max-w-[var(--container-wide)] mx-auto px-6 md:px-12 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="hidden lg:flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="text-muted">On this page</span>
          {sections.map((s) => (
            <a key={s.id} href={`#${s.id}`} className="text-secondary hover:text-accent-rust transition-colors">{s.label}</a>
          ))}
        </div>

        <div className="relative lg:hidden">
          <button type="button" onClick={() => setOpen(open === 'jump' ? null : 'jump')}
            className="inline-flex items-center gap-1 text-sm text-secondary hover:text-accent-rust">
            Jump to <ChevronDown className={`w-4 h-4 transition-transform ${open === 'jump' ? 'rotate-180' : ''}`} />
          </button>
          {open === 'jump' && (
            <div className="absolute left-0 top-full mt-2 w-56 bg-white shadow-lg border border-border-light py-1.5 z-50">
              {sections.map((s) => (
                <a key={s.id} href={`#${s.id}`} onClick={() => setOpen(null)} className="block px-3 py-1.5 text-sm text-secondary hover:bg-warm hover:text-accent-rust">{s.label}</a>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <button type="button" onClick={() => setOpen(open === 'share' ? null : 'share')} className="inline-flex items-center gap-1.5 text-sm text-secondary border border-border-light rounded-full px-3 py-1.5 hover:bg-warm transition-colors">
              <Share2 className="w-3.5 h-3.5" /> Share
            </button>
            {open === 'share' && (
              <div className="absolute right-0 top-full mt-2 w-72 bg-white shadow-lg border border-border-light p-3 z-50">
                <div className="flex items-center gap-2 mb-3">
                  <input readOnly value={pageUrl} className="flex-1 min-w-0 text-xs px-2 py-1.5 border border-border-light bg-warm text-secondary" />
                  <button type="button" onClick={() => copy(pageUrl)} className="shrink-0 inline-flex items-center gap-1 text-xs px-2 py-1.5 rounded border border-border-light hover:bg-warm">
                    {copied ? <Check className="w-3.5 h-3.5 text-accent-rust" /> : <Link2 className="w-3.5 h-3.5" />}{copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <a className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer" href={`https://twitter.com/intent/tweet?url=${encodeURIComponent(pageUrl)}`}>X</a>
                  <span className="text-border-medium">·</span>
                  <a className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer" href={`https://bsky.app/intent/compose?text=${encodeURIComponent(pageUrl)}`}>Bluesky</a>
                  <span className="text-border-medium">·</span>
                  <a className="text-accent-rust hover:underline" href={`mailto:?body=${encodeURIComponent(pageUrl)}`}>Email</a>
                </div>
              </div>
            )}
          </div>

          <div className="relative">
            <button type="button" onClick={() => setOpen(open === 'embed' ? null : 'embed')} className="inline-flex items-center gap-1.5 text-sm text-secondary border border-border-light rounded-full px-3 py-1.5 hover:bg-warm transition-colors">
              <Code2 className="w-3.5 h-3.5" /> Embed
            </button>
            {open === 'embed' && (
              <div className="absolute right-0 top-full mt-2 w-80 bg-white shadow-lg border border-border-light p-3 z-50">
                <textarea readOnly value={embedSnippet} rows={3} className="w-full text-[11px] font-mono px-2 py-1.5 border border-border-light bg-warm text-secondary resize-none" />
                <button type="button" onClick={() => copy(embedSnippet)} className="mt-2 inline-flex items-center gap-1 text-xs px-2 py-1.5 rounded border border-border-light hover:bg-warm">
                  {copied ? <Check className="w-3.5 h-3.5 text-accent-rust" /> : <Link2 className="w-3.5 h-3.5" />}{copied ? 'Copied' : 'Copy snippet'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
