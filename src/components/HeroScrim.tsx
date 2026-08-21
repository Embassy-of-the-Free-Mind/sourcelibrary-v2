/**
 * The tint that sits between a hero's background imagery and its text.
 *
 * Three layers, in order:
 *   1. a flat warm near-black at 72% — does most of the darkening, and is what
 *      makes white text legible over arbitrary page scans;
 *   2. a left-weighted gradient, so the side carrying the title is darker than
 *      the side that is just imagery;
 *   3. a faint rust glow up and to the right, which keeps the whole thing from
 *      reading as neutral grey.
 *
 * Shared by the book hero (`HeroVariants`) and the collection hero so the two
 * genuinely match rather than happening to hold the same numbers — changing the
 * tint in one place changes it in both, which is the point.
 *
 * Expects a positioned ancestor; render it directly over the background layer.
 */
export default function HeroScrim() {
  return (
    <>
      <div className="absolute inset-0" style={{ background: 'rgba(16,12,8,0.72)' }} />
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(90deg, rgba(14,10,7,0.5) 0%, rgba(14,10,7,0.12) 60%, transparent 100%)' }}
      />
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(120% 90% at 82% 18%, rgba(165,80,61,0.2) 0%, transparent 55%)' }}
      />
    </>
  );
}
