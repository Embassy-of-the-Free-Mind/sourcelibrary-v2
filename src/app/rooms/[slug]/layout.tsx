import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import { notFound } from 'next/navigation';
import { TenantLayoutWrapper } from '@/components/tenant/TenantLayoutWrapper';
import EmbedResizeReporter from '@/components/embed/EmbedResizeReporter';
import EmbedNavigationOverlay from '@/components/embed/EmbedNavigationOverlay';
import { getCachedRoom } from '@/components/rooms/room-loader';

/**
 * Layout for /rooms/[slug]/* — a self-serve reading room (#5266).
 *
 * Same shell as src/app/embed/layout.tsx: `data-embed` + `.embed-mode` hide
 * the global header, footer and cookie banner via CSS, TenantLayoutWrapper
 * feeds EmbedContext, and the client hooks treat `/rooms/<slug>` as an
 * embedded surface (src/lib/reading-rooms-paths.ts), so the book page and
 * reader render exactly as they do inside a partner room.
 *
 * The owner's accent colour is applied here as the site's primary accent
 * token, scoped to the room, so buttons and links inside read as theirs
 * without any component knowing about rooms.
 *
 * Rooms are noindex for now: they are user-made public pages, and their
 * content is already indexed at the canonical /book URLs. Opening them to
 * search is a later decision (#5266, out of scope).
 */

export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default async function RoomLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const room = await getCachedRoom(slug);
  if (!room) notFound();

  const accent = room.theme.accent_hex;
  const style = accent
    ? ({ '--accent-rust': accent, '--color-accent-rust': accent } as CSSProperties)
    : undefined;

  return (
    <TenantLayoutWrapper>
      <div data-embed="" data-room={room.slug} className="embed-mode min-h-screen" style={style}>
        {children}
        <EmbedResizeReporter />
        <EmbedNavigationOverlay />
      </div>
    </TenantLayoutWrapper>
  );
}
