/* eslint-disable @next/next/no-img-element */
import { UserRound } from 'lucide-react';

export interface Maker { kind: 'source-library' | 'reader'; name: string; avatar?: string; href?: string }
export const SOURCE_LIBRARY: Maker = { kind: 'source-library', name: 'Source Library' };

/** The Source Library mark (public/logo.svg), drawn inline so it takes the text colour. */
const Logo = ({ className = '' }: { className?: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden className={className}>
    <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);

/**
 * Who made a collection, with their picture: the Source Library mark for ours, the reader's own
 * avatar for theirs (a plain figure until they add one).
 */
export default function MakerBadge({ maker, color, size = 26 }: { maker: Maker; color?: string; size?: number }) {
  const face = maker.kind === 'source-library'
    ? <span data-avatar="true" className="grid place-items-center rounded-full bg-white text-[#1a1612] shrink-0" style={{ width: size, height: size }}><Logo className="w-[78%] h-[78%]" /></span>
    : maker.avatar
      ? <img data-avatar="true" src={maker.avatar} alt="" className="rounded-full object-cover shrink-0 bg-white/10" style={{ width: size, height: size }} />
      : <span data-avatar="true" className="grid place-items-center rounded-full bg-white/15 text-white/80 shrink-0" style={{ width: size, height: size }}><UserRound className="w-[60%] h-[60%]" aria-hidden /></span>;
  const inner = <>{face}<span style={{ color }}>Curated by <span className="font-semibold">{maker.name}</span></span></>;
  return maker.href
    ? <a href={maker.href} className="inline-flex items-center gap-2 hover:underline underline-offset-[3px]">{inner}</a>
    : <span className="inline-flex items-center gap-2">{inner}</span>;
}
