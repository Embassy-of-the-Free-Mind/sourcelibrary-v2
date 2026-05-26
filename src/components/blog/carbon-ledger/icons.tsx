// Hand-drawn inline SVG icons for the equivalents visualization.
// Designed to be small (24x24 base), monochromatic, and tileable into
// pictographic isotype grids. Use `style` to color via CSS / Tailwind.

interface IconProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

/** Side view of a stacked beef burger: bun + lettuce + patty + bun */
export function BurgerIcon({ size = 24, className = '', style }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      style={style}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Top bun */}
      <path d="M3 9c0-3 4-6 9-6s9 3 9 6" fill="currentColor" fillOpacity="0.15" />
      {/* Sesame seeds */}
      <circle cx="9" cy="6" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="13" cy="5" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="16" cy="6.5" r="0.6" fill="currentColor" stroke="none" />
      {/* Cheese (slight droop) */}
      <path d="M3 11h18l-1 1.5H4z" fill="currentColor" fillOpacity="0.4" />
      {/* Patty */}
      <rect x="3" y="13" width="18" height="2.5" rx="0.5" fill="currentColor" fillOpacity="0.6" />
      {/* Bottom bun */}
      <path d="M3 16h18v2c0 1.5-2 3-9 3s-9-1.5-9-3v-2z" fill="currentColor" fillOpacity="0.15" />
    </svg>
  );
}

/** Side view of a compact mid-size hatchback */
export function CarIcon({ size = 24, className = '', style }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      style={style}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Body */}
      <path
        d="M2 16v-3l2-1 2-4c.4-.6 1-1 1.7-1h8.6c.7 0 1.3.4 1.7 1l2 4 2 1v3"
        fill="currentColor" fillOpacity="0.15"
      />
      <path d="M2 16h20" />
      {/* Windows */}
      <path d="M5.5 11l1.5-3h10l1.5 3" fill="currentColor" fillOpacity="0.05" />
      <path d="M12 8v3" />
      {/* Wheels */}
      <circle cx="7" cy="17" r="1.8" fill="currentColor" fillOpacity="0.4" />
      <circle cx="17" cy="17" r="1.8" fill="currentColor" fillOpacity="0.4" />
    </svg>
  );
}

/** Vertical book spine — taller, with subtle ridges and a title block */
export function BookIcon({ size = 24, className = '', style }: IconProps) {
  const w = size * 0.42;
  return (
    <svg
      width={w}
      height={size}
      viewBox="0 0 10 24"
      className={className}
      style={style}
      aria-hidden="true"
      fill="currentColor"
    >
      {/* Spine body */}
      <rect x="0.5" y="0.5" width="9" height="23" rx="0.4" fillOpacity="0.9" />
      {/* Inner edge band */}
      <rect x="1.2" y="1.5" width="7.6" height="21" rx="0.2" fill="none" stroke="white" strokeOpacity="0.3" strokeWidth="0.3" />
      {/* Title block — small rectangle higher on the spine */}
      <rect x="2" y="6" width="6" height="3" fill="white" fillOpacity="0.55" />
      {/* Author/decorative band lower on spine */}
      <rect x="2" y="17" width="6" height="0.7" fill="white" fillOpacity="0.45" />
      <rect x="2.5" y="18.3" width="5" height="0.5" fill="white" fillOpacity="0.35" />
    </svg>
  );
}

/** Top-down plane silhouette */
export function PlaneIcon({ size = 24, className = '', style }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      style={style}
      aria-hidden="true"
      fill="currentColor"
    >
      <path d="M2.5 19.5l8-3.5v4l-2 1.5v1l3-1 3 1v-1l-2-1.5v-4l8 3.5v-2l-8-5.5V6c0-1.1-.9-2-2-2s-2 .9-2 2v6.5l-8 5.5v2z" />
    </svg>
  );
}
