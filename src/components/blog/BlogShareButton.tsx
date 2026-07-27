'use client';

import { usePathname } from 'next/navigation';
import ShareButton from '@/components/ui/ShareButton';

/**
 * Floating share control for blog posts.
 *
 * Rendered once from the blog layout so every post gets it without per-post
 * edits. Sits bottom-right, above the table-of-contents mobile button (which
 * occupies bottom-6). Hidden on the /blog index — there's no single post to
 * share there.
 *
 * Sharing itself is handled by the site-wide ShareButton (X, Bluesky,
 * WhatsApp, Pinterest, copy link — with share tracking); this component only
 * places it. `dropUp` opens the desktop menu above the button so it doesn't
 * fall off the bottom of the viewport.
 */
export default function BlogShareButton() {
  const pathname = usePathname();
  if (!pathname || pathname === '/blog' || pathname === '/blog/') return null;

  return (
    <div className="fixed bottom-20 right-6 z-40 print:hidden">
      <ShareButton
        variant="icon"
        dropUp
        className="!w-12 !h-12 !rounded-full justify-center bg-white/95 backdrop-blur-sm border border-border-light shadow-lg hover:!bg-stone-50"
      />
    </div>
  );
}
