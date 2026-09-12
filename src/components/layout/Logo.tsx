import Link from 'next/link';
import { localePath, type Locale } from '@/lib/locale-path';

interface LogoProps {
  /** White text/stroke for dark backgrounds */
  white?: boolean;
  /** Compact sizing for tight headers (reader, breadcrumb rows) */
  compact?: boolean;
  /** Extra-compact: icon only on mobile, text on sm+ (used in reader header) */
  mini?: boolean;
  /**
   * Keep the wordmark at every width. For surfaces that have the room and
   * need the full identity: the reader's full-screen site menu is the whole
   * screen, so the three rings alone read as an unlabelled dot.
   */
  alwaysWordmark?: boolean;
  /**
   * Surface locale. The wordmark is the most-clicked nav element on the site and
   * its href used to be a hard-coded `/`: on every `/es` page it dropped a
   * Spanish reader onto the ENGLISH homepage, silently ending their localized
   * session. Passed down (not read from `usePathname`) because the homepage is
   * statically prerendered, where the pathname is null at build time and the
   * link would only become correct after hydration.
   */
  lang?: Locale;
}

export default function Logo({ white, compact, mini, alwaysWordmark, lang = 'en' }: LogoProps) {
  const strokeColor = white ? 'white' : 'currentColor';

  const iconSize = mini
    ? 'w-6 h-6'
    : compact
      ? 'w-8 h-8'
      : 'w-8 h-8 md:w-[2.4rem] md:h-[2.4rem]';

  const textSize = mini
    ? 'text-sm'
    : compact
      ? 'text-lg'
      : 'text-base md:text-[1.2rem]';

  // When to reveal the "Source Library" wordmark. The reader header (mini) is
  // dense on mobile — logo, a long title, the chapter dropdown and the page
  // navigator all share one row — so the wordmark stays hidden until `lg`
  // (the same width at which the site nav stops collapsing to a hamburger),
  // leaving just the three rings on phones/tablets. Reader feedback: the logo
  // read as "smooshed" and "should collapse to just the circles" (#3085).
  // The marketing/site header keeps its wordmark from `sm` up.
  const wordmarkVisibility = alwaysWordmark
    ? 'inline'
    : mini ? 'hidden lg:inline' : 'hidden sm:inline';

  return (
    <Link
      href={localePath('/', lang)}
      className={`inline-flex items-center ${mini ? 'gap-1.5' : 'gap-3'} ${
        white
          ? 'text-white hover:opacity-80'
          : 'text-primary hover:text-secondary'
      } transition-colors`}
      aria-label="Source Library home"
    >
      <svg
        className={iconSize}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" stroke={strokeColor} strokeWidth="1" />
        <circle cx="12" cy="12" r="7" stroke={strokeColor} strokeWidth="1" />
        <circle cx="12" cy="12" r="4" stroke={strokeColor} strokeWidth="1" />
      </svg>
      <span
        className={`${textSize} uppercase tracking-wider ${wordmarkVisibility}`}
      >
        <span className="font-semibold">Source</span>
        <span className="font-light">Library</span>
        {!mini && (
          <sup className="text-[0.6em] font-light tracking-normal normal-case ml-1 opacity-80 relative -top-[0.5em]">
            Beta
          </sup>
        )}
      </span>
    </Link>
  );
}
