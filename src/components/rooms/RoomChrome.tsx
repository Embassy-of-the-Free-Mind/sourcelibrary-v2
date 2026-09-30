import Link from 'next/link';
import RoomHomeLink from '@/components/rooms/RoomHomeLink';
import type { ReadingRoom } from '@/lib/reading-rooms';
import { ROOMS_ROOT } from '@/lib/reading-rooms-paths';

/**
 * The owner's chrome around a reading room: a slim header carrying THEIR
 * wordmark, name and way home, and a footer with the one line that says
 * where the texts come from. Everything between is Source Library's shelf,
 * book page and reader in embedded mode.
 *
 * Design rules (collection-page-redesign-spec.md): no new primitives, every
 * value an existing token. The room accent, when set, is applied by the room
 * layout as `--accent-rust` on the wrapper, so links here just use the token.
 */

const HEADER_INNER = 'max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8';

export function RoomHeader({ room, showTagline = false }: { room: ReadingRoom; showTagline?: boolean }) {
  const shelfHref = `${ROOMS_ROOT}/${room.slug}`;
  const home = room.theme.home_url;
  const homeLabel = room.theme.home_label || 'Back to site';

  return (
    <header className="border-b" style={{ background: 'var(--bg-white)', borderColor: 'var(--border-light)' }}>
      <div className={`${HEADER_INNER} flex items-center justify-between gap-4 py-3`}>
        <Link href={shelfHref} className="flex items-center gap-3 min-w-0 no-underline">
          {room.theme.logo_url ? (
            // Plain <img>: an owner-supplied host is not on next/image's allowlist,
            // and a wordmark is small. referrerPolicy keeps the reader's page out
            // of the owner's image logs.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={room.theme.logo_url}
              alt=""
              className="h-8 w-auto max-w-[160px] object-contain shrink-0"
              referrerPolicy="no-referrer"
            />
          ) : null}
          <span className="font-serif text-xl md:text-2xl tracking-tight truncate" style={{ color: 'var(--text-primary)' }}>
            {room.name}
          </span>
        </Link>
        {home ? <RoomHomeLink href={home} label={homeLabel} /> : null}
      </div>
      {showTagline && room.tagline ? (
        <div className={`${HEADER_INNER} pb-4 -mt-1`}>
          <p className="font-body text-base md:text-lg max-w-3xl" style={{ color: 'var(--text-secondary)' }}>{room.tagline}</p>
        </div>
      ) : null}
    </header>
  );
}

export function RoomFooter() {
  return (
    <footer className="border-t mt-12" style={{ borderColor: 'var(--border-light)' }}>
      <div className={`${HEADER_INNER} py-5 text-xs flex flex-wrap items-center gap-x-3 gap-y-1`} style={{ color: 'var(--text-muted)' }}>
        <span>
          Texts and translations served by{' '}
          <a
            href="https://sourcelibrary.org"
            target="_blank"
            rel="noopener"
            className="underline underline-offset-2 hover:opacity-80"
            style={{ color: 'var(--text-secondary)' }}
          >
            Source Library
          </a>
          .
        </span>
        <span>Translations are AI-assisted; the original is always alongside.</span>
      </div>
    </footer>
  );
}
