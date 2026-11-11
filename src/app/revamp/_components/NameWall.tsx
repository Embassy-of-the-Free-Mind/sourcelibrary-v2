import { TINT } from './PlateWall';

/**
 * A hero background of words instead of pictures: each language's own name for itself, in its own
 * script, in rows of cells like the plate wall. Bigger languages get bigger type.
 */
export default function NameWall({ names, rows = 4 }: { names: { text: string; size: number; lang?: string; dir?: 'rtl' }[]; rows?: number }) {
  const max = Math.max(...names.map((x) => x.size));
  const scale = (v: number) => 0.55 + 0.45 * (Math.log(v + 1) / Math.log(max + 1)); // 0.55 to 1
  const lanes = Array.from({ length: rows }, (_, r) => names.filter((_x, i) => i % rows === r));
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden select-none" style={{ background: '#14100c' }}>
      <div className="absolute inset-0 flex flex-col gap-[6px] py-[6px]">
        {lanes.map((lane, r) => (
          <div key={r} className="flex-1 flex gap-[6px] min-h-0" style={{ marginLeft: `${-(r % 2) * 60}px` }}>
            {[...lane, ...lane].map((x, i) => (
              <span key={i} lang={x.lang} dir={x.dir} className="shrink-0 grid place-items-center px-6 md:px-9 bg-[#2a221b] text-[#d9c9b3] whitespace-nowrap leading-none"
                style={{ fontSize: `clamp(22px, ${(scale(x.size) * 5.2).toFixed(2)}vw, ${Math.round(scale(x.size) * 88)}px)`, fontFamily: 'var(--font-display, serif)' }}>
                {x.text}
              </span>
            ))}
          </div>
        ))}
      </div>
      <div className="absolute inset-0" style={{ background: TINT }} />
    </div>
  );
}
