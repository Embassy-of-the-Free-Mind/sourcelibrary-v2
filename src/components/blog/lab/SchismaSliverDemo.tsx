'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ToneEngine } from './audio';
import { LabCard, PlayToggle, Readout } from './LabCard';

/**
 * Station II½ — Descartes' sliver, dragged shut.
 *
 * The upper circle of Compendium Musicae p31 divides the octave by string
 * numbers (540, 486, 480, 432, 405, 360, 324, 288) into major tones, minor
 * tones and semitones — and the division doesn't come out even: a sliver
 * labeled "Schisma" absorbs the remainder. The numbers say what it is:
 * 486:480 = 81:80, the syntonic comma, 21.5¢ — the disagreement between his
 * two sizes of D (10:9 vs 9:8 above C·540). Equal-temper his pie and the
 * two D's become one note: the sliver closes because the disagreement does.
 *
 * The reader drags the printed sliver shut. Rust lines drift from the
 * engraved radials by the true cents each boundary moves; the scale can be
 * played at any point of the morph.
 *
 * Registration: the plate is hand-drawn, so each printed radial's angle was
 * measured against the scan individually (screen degrees, clockwise from
 * east, from the wedge apex — which is NOT the rim's center). Tempering
 * drift is applied FROM those measured angles at 0.3°/cent, so rust
 * coincides with ink exactly at t=0. Coordinates are in the source image's
 * pixel space (645×1298); the SVG viewBox windows the upper circle.
 */

const PLATE =
  'https://images.sourcelibrary.org/gallery/69b1cafca282e3475aab4148/69b1cafca282e3475aab4167-0.jpg?v=1784332368366';

const APEX_X = 348;
const APEX_Y = 315;
const LINE_LEN = 182;
const VIEW = '80 55 542 585'; // upper circle + its string numbers (right edge includes the full "288")

const CENTS = (a: number, b: number) => 1200 * Math.log2(a / b);

/**
 * The moving boundary lines: string number, measured printed angle, just and
 * 12-TET pitch (cents above C·540). The 540 root line (printed at 32°) is
 * deliberately absent — the root is the fixed point of tempering, so its
 * rust line would sit on the ink forever.
 */
const BOUNDARIES = [
  { len: 486, just: CENTS(540, 486), tet: 200, printedDeg: 93 },
  { len: 480, just: CENTS(540, 480), tet: 200, printedDeg: 100 },
  { len: 432, just: CENTS(540, 432), tet: 400, printedDeg: 151.5 },
  { len: 405, just: CENTS(540, 405), tet: 500, printedDeg: 179 },
  { len: 360, just: CENTS(540, 360), tet: 700, printedDeg: 242 },
  { len: 324, just: CENTS(540, 324), tet: 900, printedDeg: 293 },
  { len: 288, just: CENTS(540, 288), tet: 1100, printedDeg: 0.5 },
];

const SLIVER_CENTS = CENTS(81, 80); // 21.51 — the syntonic comma

const ROOT_HZ = 262; // C·540 sounds near middle C

/** Ascending scale through the pie at morph position t (0 = as printed, 1 = equal-tempered). */
function scaleFreqs(t: number): number[] {
  const cents = [0, ...BOUNDARIES.map((b) => b.just + (b.tet - b.just) * t).sort((a, b) => a - b), 1200];
  return cents.map((c) => ROOT_HZ * Math.pow(2, c / 1200));
}

const rad = (d: number) => (d * Math.PI) / 180;

export default function SchismaSliverDemo() {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);

  const engineRef = useRef<ToneEngine | null>(null);
  const playingRef = useRef(false);
  const tRef = useRef(0);
  const dragRef = useRef<{ startX: number; startT: number } | null>(null);

  tRef.current = t;

  useEffect(() => () => { playingRef.current = false; engineRef.current?.dispose(); }, []);

  const loopScale = async () => {
    const e = engineRef.current;
    if (!e) return;
    while (playingRef.current) {
      const freqs = scaleFreqs(tRef.current);
      for (const f of freqs) {
        if (!playingRef.current) return;
        await e.playTones([f], 240, 'rich', 0.5);
      }
      await new Promise((r) => window.setTimeout(r, 350));
    }
  };

  const toggle = () => {
    if (playing) {
      playingRef.current = false;
      setPlaying(false);
      engineRef.current?.suspend();
      return;
    }
    if (!engineRef.current) engineRef.current = new ToneEngine();
    engineRef.current.ensure();
    playingRef.current = true;
    setPlaying(true);
    void loopScale();
  };

  const onPointerDown = (ev: React.PointerEvent<SVGPathElement>) => {
    (ev.target as SVGPathElement).setPointerCapture(ev.pointerId);
    dragRef.current = { startX: ev.clientX, startT: t };
  };
  const onPointerMove = (ev: React.PointerEvent<SVGPathElement>) => {
    const d = dragRef.current;
    if (!d) return;
    setT(Math.min(1, Math.max(0, d.startT + (ev.clientX - d.startX) / 220)));
  };
  const onPointerUp = () => { dragRef.current = null; };

  // All geometry as plain scalars/arrays before JSX (React Compiler hoist rule).
  const lines = BOUNDARIES.map((b) => {
    const deg = b.printedDeg + (b.tet - b.just) * 0.3 * t;
    return {
      len: b.len,
      x2: APEX_X + LINE_LEN * Math.cos(rad(deg)),
      y2: APEX_Y + LINE_LEN * Math.sin(rad(deg)),
    };
  });
  const d486 = BOUNDARIES.find((b) => b.len === 486)!;
  const d480 = BOUNDARIES.find((b) => b.len === 480)!;
  const a486 = rad(d486.printedDeg + (d486.tet - d486.just) * 0.3 * t);
  const a480 = rad(d480.printedDeg + (d480.tet - d480.just) * 0.3 * t);
  const sliverPath = `M ${APEX_X} ${APEX_Y} L ${APEX_X + LINE_LEN * Math.cos(a486)} ${APEX_Y + LINE_LEN * Math.sin(a486)} A ${LINE_LEN} ${LINE_LEN} 0 0 1 ${APEX_X + LINE_LEN * Math.cos(a480)} ${APEX_Y + LINE_LEN * Math.sin(a480)} Z`;
  // generous drag target around the printed sliver
  const hitA = rad(84);
  const hitB = rad(110);
  const hitPath = `M ${APEX_X} ${APEX_Y} L ${APEX_X + 200 * Math.cos(hitA)} ${APEX_Y + 200 * Math.sin(hitA)} A 200 200 0 0 1 ${APEX_X + 200 * Math.cos(hitB)} ${APEX_Y + 200 * Math.sin(hitB)} Z`;

  const dGapNow = Math.abs((d480.just + (d480.tet - d480.just) * t) - (d486.just + (d486.tet - d486.just) * t));
  const closed = dGapNow < 0.5;

  return (
    <LabCard
      title="Station II, continued — Drag his sliver shut"
      headerRight={<PlayToggle playing={playing} onClick={toggle} label="Play his scale" />}
      caption="Descartes' own pie, awake. The numbers around the rim are string lengths; the thin wedge marked Schisma is 486:480 — his two sizes of D, disagreeing by a comma. Drag the sliver shut (or use the slider) and watch every boundary drift by exactly the amount equal temperament demands, rust against ink. Then play the scale and hear the pie re-tune."
      sourceHref="/book/musicae-compendium-descartes?page=31"
      sourceLabel="Descartes, Compendium Musicae (1618), the octave divided"
    >
      <svg
        viewBox={VIEW}
        className="w-full max-w-[440px] mx-auto block rounded border border-border-light bg-white touch-none select-none"
        role="img"
        aria-label="Descartes' circular division of the octave, with a draggable sliver labeled Schisma; dragging it shut equal-tempers the scale"
      >
        <image href={PLATE} x="0" y="0" width="645" height="1298" />
        {t > 0.005 && (
          <g>
            {lines.map((l) => (
              <line key={l.len} x1={APEX_X} y1={APEX_Y} x2={l.x2} y2={l.y2}
                stroke="#a8503c" strokeWidth="2" strokeLinecap="round" opacity="0.85" />
            ))}
          </g>
        )}
        <path d={sliverPath} fill="#a8503c" fillOpacity={0.22 * (1 - t) + 0.05} stroke="none" />
        <path
          d={hitPath}
          fill="transparent"
          style={{ cursor: 'ew-resize' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          aria-hidden="true"
        />
      </svg>

      <label className="block mt-3 max-w-[440px] mx-auto">
        <span className="flex items-baseline justify-between text-sm text-secondary mb-1">
          <span>Temper the pie</span>
          <span className="font-mono text-primary">{Math.round(t * 100)}%</span>
        </span>
        <input
          type="range" min={0} max={1} step={0.005} value={t}
          onChange={(e) => setT(Number(e.target.value))}
          className="w-full accent-accent-rust"
          aria-label="Temper the scale from Descartes' just division to equal temperament"
        />
      </label>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <Readout label="The sliver" value={`${dGapNow.toFixed(1)} ¢`} note={closed ? 'closed — one D remains' : '486 : 480 = 81 : 80'} />
        <Readout label="Major tones" value={`${(203.91 - 3.91 * t).toFixed(1)} ¢`} note="9:8 → 200 ¢" />
        <Readout label="Minor tones" value={`${(182.4 + 17.6 * t).toFixed(1)} ¢`} note="10:9 → 200 ¢" />
      </div>

      <p className="mt-3 text-xs text-muted">
        Honesty note: this sliver is the <em>syntonic</em> comma (81:80, 21.5 ¢) — first cousin of
        the Pythagorean comma (23.5 ¢) that the stacked fifths above leave over. Same disease, same
        cure: Descartes drew two sizes of D, and{' '}
        <Link href="/book/complete-works-on-music-and-tuning-vol-1" className="text-accent-rust underline">
          Zhu Zaiyu&apos;s
        </Link>{' '}
        equal semitone makes them one note — which is why, as you drag, the sliver does not get
        hidden. It gets <em>resolved</em>.
      </p>
    </LabCard>
  );
}
