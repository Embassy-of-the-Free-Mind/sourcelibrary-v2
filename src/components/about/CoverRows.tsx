import atlas from './covers-atlas.json';

/**
 * Rows of whole book covers from the hero's atlas (public/about/covers-atlas.jpg),
 * each at its own proportions, drawn as CSS sprites. Rows are always whole top
 * to bottom; the ends of each row run off the sides, as on the hero wall.
 */

const ITEMS = atlas.items as number[][];
const PER_ROW = 24;

export default function CoverRows({ rows = 2, height = 150, offset = 0, gap = 10, className = '' }: { rows?: number; height?: number; offset?: number; gap?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={`overflow-hidden flex flex-col ${className}`} style={{ gap }}>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex justify-center shrink-0" style={{ gap, height }}>
          {Array.from({ length: PER_ROW }, (_, k) => {
            const [x, y, w, h] = ITEMS[(offset + r * PER_ROW + k * 7) % ITEMS.length];
            const s = height / h;
            return (
              <i
                key={k}
                className="block shrink-0"
                style={{
                  width: Math.round(w * s),
                  height,
                  backgroundImage: 'url(/about/covers-atlas.jpg)',
                  backgroundSize: `${atlas.w * s}px ${atlas.h * s}px`,
                  backgroundPosition: `${-x * s}px ${-y * s}px`,
                }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
