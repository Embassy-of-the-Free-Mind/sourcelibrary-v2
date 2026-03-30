import Link from 'next/link';

interface LogoProps {
  /** White text/stroke for dark backgrounds */
  white?: boolean;
  /** Compact sizing for tight headers (reader, breadcrumb rows) */
  compact?: boolean;
  /** Extra-compact: icon only on mobile, text on sm+ (used in reader header) */
  mini?: boolean;
}

export default function Logo({ white, compact, mini }: LogoProps) {
  const strokeColor = white ? 'white' : 'currentColor';

  const iconSize = mini
    ? 'w-6 h-6'
    : compact
      ? 'w-8 h-8'
      : 'w-10 h-10 md:w-12 md:h-12';

  const textSize = mini
    ? 'text-sm'
    : compact
      ? 'text-lg'
      : 'text-xl md:text-2xl';

  return (
    <Link
      href="/"
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
        className={`${textSize} uppercase tracking-wider ${mini ? 'hidden sm:inline' : ''}`}
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
