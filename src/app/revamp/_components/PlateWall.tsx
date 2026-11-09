/* eslint-disable @next/next/no-img-element */

/**
 * The /about wall with a collection's plates: whole rows, each plate at its own
 * proportions, drifting slowly sideways. The tint is the /about hero's recipe,
 * which is the book page's HeroScrim plus a bottom fade for the text.
 */
export const TINT =
  'linear-gradient(180deg, transparent 35%, rgba(14,10,7,.78) 100%), radial-gradient(120% 90% at 82% 18%, rgba(165,80,61,.22) 0%, transparent 55%), linear-gradient(90deg, rgba(14,10,7,.5) 0%, rgba(14,10,7,.12) 60%, transparent 100%), rgba(16,12,8,.62)';

export default function PlateWall({ tiles, rows = 4, still = false }: { tiles: string[]; rows?: number; still?: boolean }) {
  const lanes = Array.from({ length: rows }, (_, r) => tiles.filter((_t, i) => i % rows === r));
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden" style={{ background: '#14100c' }}>
      <div className="absolute inset-0 flex flex-col gap-2 py-1">
        {lanes.map((lane, r) => (
          <div key={r} className={`flex-1 min-h-0 flex gap-2 w-max ${still ? '' : 'plate-drift'}`} style={still ? { marginLeft: -r * 70 } : { animationDuration: `${150 + r * 35}s`, animationDirection: r % 2 ? 'reverse' : 'normal' }}>
            {[...lane, ...lane, ...lane, ...lane].map((t, i) => <img key={i} src={t} alt="" className="h-full w-auto block shrink-0" />)}
          </div>
        ))}
      </div>
      <div className="absolute inset-0" style={{ background: TINT }} />
      <style>{`
        @keyframes plate-drift { from { transform: translateX(0) } to { transform: translateX(-25%) } }
        .plate-drift { animation: plate-drift linear infinite; }
        @media (prefers-reduced-motion: reduce) { .plate-drift { animation: none } }
      `}</style>
    </div>
  );
}
