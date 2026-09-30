'use client';

import { useSyncExternalStore } from 'react';
import { ArrowLeft } from 'lucide-react';

const subscribeNever = () => () => {};
const isTopLevel = () => {
  try {
    return window.self === window.top;
  } catch {
    return false;
  }
};

/**
 * The room header's "Back to <the owner's site>" link — but only when the room
 * is the whole window. Inside an iframe on that very site the link is wrong
 * twice over: the visitor is already there, and an in-frame click would load
 * the owner's home page INSIDE the frame (their site nested in their site;
 * seen on the yam packet, #5266). The server renders neither case, so
 * the markup is the same for both until hydration.
 */
export default function RoomHomeLink({ href, label }: { href: string; label: string }) {
  // Server snapshot is false, so SSR and the first client render agree; the
  // real answer replaces it on hydration without a state update in an effect.
  const topLevel = useSyncExternalStore(subscribeNever, isTopLevel, () => false);
  if (!topLevel) return null;
  return (
    <a
      href={href}
      className="inline-flex items-center gap-1.5 text-sm shrink-0 no-underline hover:underline"
      style={{ color: 'var(--accent-rust)' }}
    >
      <ArrowLeft className="w-4 h-4" aria-hidden="true" />
      {label}
    </a>
  );
}
