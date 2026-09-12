'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { ChevronDown, Share2, Link2, Check } from 'lucide-react';
import { trackEvent } from '@/lib/track-event';
import LikeButton from '@/components/ui/LikeButton';

interface Section { id: string; label: string }

/**
 * Section bar for a collection page. Sits under the hero and sticks to the top
 * of the viewport once scrolled past. Jump links smooth-scroll to their
 * section and the one currently in view is brightened; the rest are dimmed.
 * On the right: Save (a collection like, same system as book likes) and
 * Share, which opens copy-link plus the social targets.
 *
 * `tone="dark"` sets the bar in the dark navbar's colour (bg-dark) so it reads
 * as a continuation of the header under a dark hero. Popovers stay white.
 */
export default function CollectionAnchorBar({ sections, slug, tone = 'light' }: { sections: Section[]; slug: string; tone?: 'light' | 'dark' }) {
  const [open, setOpen] = useState<null | 'jump' | 'share'>(null);
  const [copied, setCopied] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [canNativeShare, setCanNativeShare] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const dark = tone === 'dark';

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(null);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  useEffect(() => {
    // Deferred a frame: the value is client-only, so it cannot be a lazy
    // initial state without a hydration mismatch.
    const id = requestAnimationFrame(() => setCanNativeShare(typeof navigator.share === 'function'));
    return () => cancelAnimationFrame(id);
  }, []);

  // Scroll spy: the active section is the last one whose top has passed the
  // bottom edge of the (sticky) bar. Plain scroll math — an observer with
  // rootMargin gets the last, short section wrong at the foot of the page.
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      // Sections carry scroll-mt-16 (64px), so a jump lands a section's top a
      // little below the bar; the tolerance must cover that gap or the jump
      // target reads as inactive.
      const barBottom = (navRef.current?.getBoundingClientRect().height ?? 0) + 24;
      let current: string | null = null;
      for (const s of sections) {
        const el = document.getElementById(s.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top <= barBottom) current = s.id;
      }
      // At the very foot of the page the last section counts even if its top
      // never reaches the bar.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
        current = sections[sections.length - 1]?.id ?? current;
      }
      setActive(current);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [sections]);

  const jump = useCallback((e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    const el = document.getElementById(id);
    if (!el) return; // let the browser follow the hash
    e.preventDefault();
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    history.replaceState(null, '', `#${id}`);
    setOpen(null);
  }, []);

  const pageUrl = typeof window !== 'undefined' ? window.location.href.split('#')[0] : `https://sourcelibrary.org/collections/${slug}`;
  const pageTitle = typeof document !== 'undefined' ? document.title : 'Source Library';

  const copy = async (text: string, channel?: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (channel) trackEvent('share', { channel, url: pageUrl, surface: 'collection_anchor_bar' });
      setTimeout(() => setCopied(false), 1500);
    } catch { /* noop */ }
  };

  const logShare = (channel: string) =>
    trackEvent('share', { channel, url: pageUrl, surface: 'collection_anchor_bar' });

  const nativeShare = async () => {
    try {
      await navigator.share({ title: pageTitle, url: pageUrl });
      logShare('native');
    } catch { /* cancelled */ }
  };

  const u = encodeURIComponent(pageUrl);
  const t = encodeURIComponent(pageTitle);
  // Instagram has no web share endpoint; on phones the "More" (native share)
  // sheet reaches it, along with anything else installed.
  const targets: { key: string; label: string; href: string }[] = [
    { key: 'whatsapp', label: 'WhatsApp', href: `https://wa.me/?text=${t}%20${u}` },
    { key: 'facebook', label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${u}` },
    { key: 'twitter', label: 'X', href: `https://twitter.com/intent/tweet?url=${u}&text=${t}` },
    { key: 'bluesky', label: 'Bluesky', href: `https://bsky.app/intent/compose?text=${t}%20${u}` },
    { key: 'linkedin', label: 'LinkedIn', href: `https://www.linkedin.com/sharing/share-offsite/?url=${u}` },
    { key: 'email', label: 'Email', href: `mailto:?subject=${t}&body=${u}` },
  ];

  const linkCls = (id: string) => {
    const isActive = active === id;
    return dark
      ? `transition-opacity ${isActive ? 'text-white' : 'text-white/55 hover:text-white/85'}`
      : `transition-opacity ${isActive ? 'text-primary' : 'text-secondary/70 hover:text-primary'}`;
  };
  const pillCls = dark
    ? 'inline-flex items-center gap-1.5 text-sm text-white/85 border border-white/25 rounded-full px-3 py-1.5 hover:bg-white/10 transition-colors'
    : 'inline-flex items-center gap-1.5 text-sm text-secondary border border-border-light rounded-full px-3 py-1.5 hover:bg-warm transition-colors';

  return (
    <nav ref={navRef} aria-label="Sections" className={`sticky top-0 z-30 ${dark ? 'border-y border-white/10 bg-dark' : 'border-y border-border-light bg-cream'}`}>
      <div ref={rootRef} className="max-w-[1500px] mx-auto px-6 md:px-12 py-3 flex flex-wrap items-center justify-between gap-3">
        {/* Jump links — inline on desktop */}
        <div className="hidden lg:flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {sections.map((s) => (
            <a key={s.id} href={`#${s.id}`} onClick={(e) => jump(e, s.id)} aria-current={active === s.id ? 'location' : undefined} className={linkCls(s.id)}>{s.label}</a>
          ))}
        </div>

        {/* Jump dropdown — tablet/mobile */}
        <div className="relative lg:hidden">
          <button type="button" onClick={() => setOpen(open === 'jump' ? null : 'jump')}
            className={`inline-flex items-center gap-1 text-sm ${dark ? 'text-white/85 hover:text-white' : 'text-secondary hover:text-accent-rust'}`}>
            {sections.find((s) => s.id === active)?.label ?? 'Jump to'} <ChevronDown className={`w-4 h-4 transition-transform ${open === 'jump' ? 'rotate-180' : ''}`} />
          </button>
          {open === 'jump' && (
            <div className="absolute left-0 top-full mt-2 w-56 bg-white shadow-lg border border-border-light py-1.5 z-50">
              {sections.map((s) => (
                <a key={s.id} href={`#${s.id}`} onClick={(e) => jump(e, s.id)} className={`block px-3 py-1.5 text-sm hover:bg-warm hover:text-accent-rust ${active === s.id ? 'text-primary' : 'text-secondary'}`}>{s.label}</a>
              ))}
            </div>
          )}
        </div>

        {/* Save / Share */}
        <div className="flex items-center gap-2">
          {/* LikeButton hardcodes grey for the unliked heart and label; on the
              dark bar those are overridden to the pill's white. The liked
              state keeps its red. */}
          <div className={`${pillCls} ${dark ? '[&_.text-gray-400]:!text-white/85 [&_.text-gray-500]:!text-white/85' : ''}`}>
            <LikeButton targetType="collection" targetId={slug} size="sm" showCount label="Save" />
          </div>

          <div className="relative">
            <button type="button" onClick={() => setOpen(open === 'share' ? null : 'share')} className={pillCls}>
              <Share2 className="w-3.5 h-3.5" /> Share
            </button>
            {open === 'share' && (
              <div className="absolute right-0 top-full mt-2 w-72 bg-white shadow-lg border border-border-light p-3 z-50">
                <div className="flex items-center gap-2 mb-3">
                  <input readOnly value={pageUrl} className="flex-1 min-w-0 text-xs px-2 py-1.5 border border-border-light bg-warm text-secondary" />
                  <button type="button" onClick={() => copy(pageUrl, 'link')} className="shrink-0 inline-flex items-center gap-1 text-xs px-2 py-1.5 rounded border border-border-light hover:bg-warm">
                    {copied ? <Check className="w-3.5 h-3.5 text-accent-rust" /> : <Link2 className="w-3.5 h-3.5" />}{copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-1.5 text-sm">
                  {targets.map((s) => (
                    <a key={s.key} className="px-2 py-1.5 text-center border border-border-light text-secondary hover:text-accent-rust hover:border-accent-rust transition-colors" target="_blank" rel="noopener noreferrer" onClick={() => logShare(s.key)} href={s.href}>{s.label}</a>
                  ))}
                  {canNativeShare && (
                    <button type="button" onClick={nativeShare} className="px-2 py-1.5 text-center border border-border-light text-secondary hover:text-accent-rust hover:border-accent-rust transition-colors">More…</button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
