/* eslint-disable @next/next/no-img-element */
/**
 * Stand-in for the stored hero collage. The real collage route builds and writes
 * to R2 on a cold slug, which a prototype must not trigger, so this lays out the
 * same plates in CSS. Tiles keep their own proportions.
 */
export default function HeroMosaic({ tiles }: { tiles: string[] }) {
  const cols = 7;
  const columns = Array.from({ length: cols }, (_, c) => tiles.filter((_t, i) => i % cols === c));
  return (
    <div aria-hidden className="absolute inset-0 flex gap-1 overflow-hidden" style={{ background: '#1a1612' }}>
      {columns.map((col, i) => (
        <div key={i} className={`flex-1 min-w-0 flex-col gap-1 ${i > 3 ? 'hidden md:flex' : 'flex'}`} style={{ marginTop: i % 2 ? -40 : 0 }}>
          {[...col, ...col, ...col].slice(0, 8).map((t, j) => (
            <img key={j} src={t} alt="" loading="eager" className="w-full h-auto block" />
          ))}
        </div>
      ))}
    </div>
  );
}
