/**
 * The tint that sits between a hero's background imagery and its text.
 *
 * Desktop (`variant="side"`, the default) — three layers:
 *   1. a flat warm near-black at 72% — does most of the darkening, and is what
 *      makes white text legible over arbitrary page scans;
 *   2. a left-weighted gradient, so the side carrying the title is darker than
 *      the side that is just imagery;
 *   3. a faint rust glow up and to the right, which keeps the whole thing from
 *      reading as neutral grey.
 *
 * Mobile (`variant="bottom"`) — the same flat 72% base and the same rust glow,
 * but the directional gradient runs bottom-to-top instead of left-to-right,
 * because a phone hero stacks its text along the bottom rather than down one
 * side. A short top fade closes the hard seam where the dark navbar meets a
 * bright plate.
 *
 * The mobile variant exists because the collection heroes were hand-rolling a
 * single `from-dark/85 via-dark/45 to-dark/5` gradient whose flat middle was 45%
 * against desktop's 72%. Text sitting in that middle band measured 1.7:1 against
 * the collage. Both variants live here so the two collection pages and the book
 * hero cannot drift apart again.
 *
 * Expects a positioned ancestor; render it directly over the background layer.
 */
export default function HeroScrim({ variant = 'side' }: { variant?: 'side' | 'bottom' }) {
  return (
    <>
      <div className="absolute inset-0" style={{ background: 'rgba(16,12,8,0.72)' }} />
      {variant === 'side' ? (
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(90deg, rgba(14,10,7,0.5) 0%, rgba(14,10,7,0.12) 60%, transparent 100%)' }}
        />
      ) : (
        <>
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(0deg, rgba(14,10,7,0.72) 0%, rgba(14,10,7,0.6) 42%, rgba(14,10,7,0.22) 68%, transparent 100%)' }}
          />
          <div
            className="absolute inset-x-0 top-0 h-20"
            style={{ background: 'linear-gradient(180deg, rgba(14,10,7,0.55) 0%, transparent 100%)' }}
          />
        </>
      )}
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(120% 90% at 82% 18%, rgba(165,80,61,0.2) 0%, transparent 55%)' }}
      />
    </>
  );
}
