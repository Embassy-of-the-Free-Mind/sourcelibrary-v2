'use client';

import { useEffect, useRef, useState } from 'react';

// Every date here is one the article itself gives (or its cited page gives).
// Undated items in the article (Landa's own writing, the Motul dictionary) are left out.
type Kind = 'hostile' | 'suppressed' | 'own' | 'later';
type Ev = { year: number; label: string; text: string; kind: Kind; lane: 0 | 1; dx?: number };

const EVENTS: Ev[] = [
  { year: 180, label: 'c. 180', text: 'Irenaeus writes Against Heresies, summarising the Valentinians', kind: 'hostile', lane: 0 },
  { year: 225, label: 'c. 225', text: 'Hippolytus writes the Refutation, copying out Naassene and Simonian texts', kind: 'hostile', lane: 0 },
  { year: 375, label: '370s', text: 'Epiphanius writes the Panarion, with Ptolemy’s Letter to Flora entire', kind: 'hostile', lane: 0 },
  { year: 1845, label: '1840s', text: 'A manuscript of seven books of the Refutation comes back from Mount Athos', kind: 'later', lane: 0 },
  { year: 1857, label: '1857', text: 'Harvey’s edition of Irenaeus', kind: 'later', lane: 0 },
  { year: 1915, label: '1915', text: 'Holl’s edition of Epiphanius', kind: 'later', lane: 0 },
  { year: 1921, label: '1921', text: 'Legge’s English Hippolytus', kind: 'later', lane: 0 },
  { year: 1945, label: '1945', text: 'The Nag Hammadi codices are dug up: Gnostic treatises in their own words', kind: 'own', lane: 0 },
  { year: 1562, label: '1562', text: 'Landa’s auto-da-fé at Maní: Maya books burned', kind: 'suppressed', lane: 1 },
  { year: 1577, label: '1577', text: 'Sahagún’s Florentine Codex records the rites and omens in Nahuatl and Spanish', kind: 'hostile', lane: 1 },
  // Same year as the codex; drawn a step to the right so both marks stay visible.
  { year: 1577, label: '1577', text: 'Royal decree of 22 April: Sahagún’s work to be collected, writing on native rites forbidden', kind: 'suppressed', lane: 1, dx: 12 },
  { year: 1606, label: '1606', text: 'Juan Bautista’s Sermonario names the Nahua specialists', kind: 'hostile', lane: 1 },
  { year: 1629, label: '1629', text: 'Ruiz de Alarcón’s Treatise records Nahua incantations', kind: 'hostile', lane: 1 },
  { year: 1759, label: '1759', text: 'Paredes’s Promptuario still warns against the Nanahualtin', kind: 'hostile', lane: 1 },
  { year: 1810, label: '1810', text: 'The Kaua Book of Chilam Balam: its year-count gives the Maya date for 1810', kind: 'own', lane: 1 },
  { year: 1864, label: '1864', text: 'Brasseur prints Landa’s account, a b c included', kind: 'later', lane: 1 },
  { year: 1892, label: '1892', text: 'Ruiz de Alarcón’s Treatise is printed', kind: 'later', lane: 1 },
  { year: 1952, label: '1952', text: 'Knorozov reads Landa’s signs as syllables', kind: 'later', lane: 1 },
];

const KINDS: { kind: Kind; name: string }[] = [
  { kind: 'hostile', name: 'Written against them' },
  { kind: 'suppressed', name: 'Burned or banned' },
  { kind: 'own', name: 'Their own words' },
  { kind: 'later', name: 'Printed or read later' },
];

const LANES = ['Gnostics', 'Nahua and Maya'];
const ORDER = EVENTS.map((_, i) => i).sort((a, b) => EVENTS[a].year - EVENTS[b].year || a - b);

// Broken axis: nothing in the article falls between 400 and 1540, so that stretch is cut out
// and marked with a gap. Two segments, each linear.
const SEGS = [
  { from: 150, to: 400, share: 0.22, ticks: [200, 300, 400] },
  { from: 1540, to: 1970, share: 0.72, ticks: [1600, 1700, 1800, 1900] },
];
const GAP_SHARE = 1 - SEGS[0].share - SEGS[1].share;

const H = 176;
const PAD_L = 14;
const PAD_R = 18;
const AXIS_Y = 138;
const LANE_Y = [58, 108];

function makeX(width: number) {
  const inner = width - PAD_L - PAD_R;
  const s0 = SEGS[0];
  const s1 = SEGS[1];
  const seg1Start = PAD_L + inner * (s0.share + GAP_SHARE);
  return {
    x: (yr: number) =>
      yr <= s0.to
        ? PAD_L + ((yr - s0.from) / (s0.to - s0.from)) * inner * s0.share
        : seg1Start + ((yr - s1.from) / (s1.to - s1.from)) * inner * s1.share,
    gapFrom: PAD_L + inner * s0.share,
    gapTo: seg1Start,
  };
}

function Mark({ kind, cx, cy, active }: { kind: Kind; cx: number; cy: number; active: boolean }) {
  const r = active ? 8 : 6;
  const stroke = 'var(--rt-surface)';
  if (kind === 'hostile') return <circle cx={cx} cy={cy} r={r} fill="var(--rt-hostile)" stroke={stroke} strokeWidth={2} />;
  if (kind === 'suppressed')
    return <rect x={cx - r} y={cy - r} width={r * 2} height={r * 2} rx={2} fill="var(--rt-suppressed)" stroke={stroke} strokeWidth={2} />;
  if (kind === 'own')
    return (
      <path
        d={`M${cx} ${cy - r - 2} L${cx + r + 2} ${cy} L${cx} ${cy + r + 2} L${cx - r - 2} ${cy} Z`}
        fill="var(--rt-own)"
        stroke={stroke}
        strokeWidth={2}
      />
    );
  return <circle cx={cx} cy={cy} r={r - 1} fill="var(--rt-surface)" stroke="var(--rt-later)" strokeWidth={2} />;
}

export default function RecordTimeline() {
  const [sel, setSel] = useState<number>(ORDER[0]);
  const [playing, setPlaying] = useState(false);
  const [shown, setShown] = useState(EVENTS.length);
  const [width, setWidth] = useState(720);
  const box = useRef<HTMLDivElement | null>(null);

  // Draw in real pixels so the labels stay readable at phone width.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!playing) return;
    let step = 0;
    const t = setInterval(() => {
      step += 1;
      if (step >= ORDER.length) {
        setPlaying(false);
        return;
      }
      setShown(step + 1);
      setSel(ORDER[step]);
    }, 900);
    return () => clearInterval(t);
  }, [playing]);

  const { x, gapFrom, gapTo } = makeX(width);
  const px = (e: Ev) => x(e.year) + (e.dx ?? 0);
  const visible = new Set(ORDER.slice(0, shown));
  const ev = EVENTS[sel];
  // Draw the selected mark last so it sits on top of its neighbours.
  const drawOrder = ORDER.filter((i) => visible.has(i) && i !== sel).concat(visible.has(sel) ? [sel] : []);

  return (
    <figure className="not-prose my-12 record-timeline">
      <style>{`
        .record-timeline { --rt-surface: var(--bg-white, #fff); --rt-hostile: #2a78d6; --rt-suppressed: #eb6834; --rt-own: #1baf7a; --rt-later: #8a857e; }
        [data-reader-theme='night'] .record-timeline { --rt-hostile: #3987e5; --rt-suppressed: #d95926; --rt-own: #199e70; --rt-later: #a49b8f; }
      `}</style>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-3 font-sans text-sm text-secondary">
        {KINDS.map((k) => (
          <span key={k.kind} className="inline-flex items-center gap-1.5">
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <Mark kind={k.kind} cx={9} cy={9} active={false} />
            </svg>
            {k.name}
          </span>
        ))}
        <button
          type="button"
          onClick={() => {
            if (playing) {
              setPlaying(false);
              setShown(EVENTS.length);
            } else {
              setShown(1);
              setSel(ORDER[0]);
              setPlaying(true);
            }
          }}
          className="ml-auto border border-border-medium px-3 py-1 text-sm text-primary hover:bg-warm"
        >
          {playing ? 'Pause' : 'Play in order'}
        </button>
      </div>

      <div className="border border-border-light bg-white">
        <div ref={box} className="w-full overflow-hidden">
          <svg
            width={width}
            height={H}
            viewBox={`0 0 ${width} ${H}`}
            className="block font-sans"
            role="img"
            aria-label="Timeline of the hostile books, the burnings and bans, the later editions, and the groups' own surviving words, from about 180 to 1952"
          >
            {SEGS.flatMap((s) => s.ticks).map((t) => (
              <g key={t}>
                <line x1={x(t)} x2={x(t)} y1={28} y2={AXIS_Y} stroke="var(--border-light, #e8e4dc)" strokeWidth={1} />
                <text x={x(t)} y={AXIS_Y + 18} textAnchor="middle" fontSize={12} fill="var(--text-muted, #6b6560)">
                  {t}
                </text>
              </g>
            ))}
            {LANES.map((name, i) => (
              <g key={name}>
                <line x1={PAD_L} x2={gapFrom} y1={LANE_Y[i]} y2={LANE_Y[i]} stroke="var(--border-medium, #d4cdc0)" strokeWidth={1} />
                <line x1={gapTo} x2={width - PAD_R} y1={LANE_Y[i]} y2={LANE_Y[i]} stroke="var(--border-medium, #d4cdc0)" strokeWidth={1} />
                <text x={PAD_L} y={LANE_Y[i] - 16} fontSize={13} fill="var(--text-secondary, #444)">
                  {name}
                </text>
              </g>
            ))}
            {/* the cut between 400 and 1540 */}
            {[0, 1].map((i) => (
              <g key={i} stroke="var(--text-muted, #6b6560)" strokeWidth={1}>
                <line x1={gapFrom + 3} x2={gapFrom + 9} y1={LANE_Y[i] + 6} y2={LANE_Y[i] - 6} />
                <line x1={gapTo - 9} x2={gapTo - 3} y1={LANE_Y[i] + 6} y2={LANE_Y[i] - 6} />
              </g>
            ))}
            {ev && visible.has(sel) && (
              <line x1={px(ev)} x2={px(ev)} y1={LANE_Y[ev.lane] + 10} y2={AXIS_Y} stroke="var(--text-muted, #6b6560)" strokeWidth={1} strokeDasharray="2 3" />
            )}
            {drawOrder.map((i) => {
              const e = EVENTS[i];
              return (
                <g
                  key={i}
                  tabIndex={0}
                  role="button"
                  aria-label={`${e.label}: ${e.text}`}
                  onMouseEnter={() => !playing && setSel(i)}
                  onFocus={() => !playing && setSel(i)}
                  onClick={() => {
                    setPlaying(false);
                    setShown(EVENTS.length);
                    setSel(i);
                  }}
                  style={{ cursor: 'pointer', outline: 'none' }}
                >
                  <circle cx={px(e)} cy={LANE_Y[e.lane]} r={12} fill="transparent" />
                  <Mark kind={e.kind} cx={px(e)} cy={LANE_Y[e.lane]} active={i === sel} />
                </g>
              );
            })}
          </svg>
        </div>
        <p className="font-sans text-sm text-primary px-4 pb-3 min-h-[3rem]" aria-live="polite">
          <strong>{ev.label}</strong> {ev.text}
        </p>
      </div>

      <figcaption className="mt-2 text-sm text-muted leading-relaxed">
        The two records side by side: when the hostile books were written, when the originals were burned or banned, when
        the books were printed or read again, and when the groups&rsquo; own words reach us. Hover or tap a mark. The axis
        skips the years 400 to 1540, where nothing in this story falls. Dates are the ones given in this article and its
        sources; undated items are left out.
        <details className="mt-2">
          <summary className="cursor-pointer">Show as a list</summary>
          <ul className="mt-2 space-y-1">
            {ORDER.map((i) => (
              <li key={i}>
                {EVENTS[i].label}, {LANES[EVENTS[i].lane]}: {EVENTS[i].text} (
                {KINDS.find((k) => k.kind === EVENTS[i].kind)?.name.toLowerCase()})
              </li>
            ))}
          </ul>
        </details>
      </figcaption>
    </figure>
  );
}
