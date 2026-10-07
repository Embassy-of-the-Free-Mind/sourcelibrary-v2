'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from 'd3';
import { CENTER_EV, EXTRA_TIES, GROUP_ORDER, GROUPS, NO_CENTER, PEOPLE, type Evidence, type Person } from './drebbel-network-data';

/**
 * Drebbel's circle: everyone with a documented, reported or merely claimed tie to
 * Cornelis Drebbel, as a network. Line style encodes how well each tie is attested;
 * a year slider replays the ties in the order they are first recorded, so a reader
 * sees the circle keep growing after his death in 1633 through the Kufflers.
 *
 * The layout is computed once (d3-force is deterministic for a fixed input), so the
 * server render and the client render agree and the plate is complete before any
 * script runs. React draws the SVG; d3 only does the arithmetic.
 */

const W = 1000;
const H = 820;
const CX = W / 2;
const CY = H / 2 + 6;
const FIRST_YEAR = 1590;
const LAST_YEAR = 1703;

interface Tie {
  source: string;
  target: string;
  ev: Evidence;
  label: string;
  year: number;
}

interface Placed extends Person {
  x: number;
  y: number;
}

const byId: Record<string, Person> = Object.fromEntries(PEOPLE.map((p) => [p.id, p]));

const TIES: Tie[] = (() => {
  const out: Tie[] = [];
  for (const p of PEOPLE) {
    if (p.id === 'drebbel' || NO_CENTER.has(p.id)) continue;
    out.push({ source: 'drebbel', target: p.id, ev: CENTER_EV[p.id] ?? p.ev, label: p.tie, year: p.year });
  }
  for (const [s, t, ev, label, y] of EXTRA_TIES) {
    out.push({ source: s, target: t, ev, label, year: y ?? Math.max(byId[s].year, byId[t].year) });
  }
  for (const t of out) t.year = Math.max(t.year, byId[t.source].year, byId[t.target].year);
  return out;
})();

const DEGREE: Record<string, number> = {};
for (const t of TIES) {
  DEGREE[t.source] = (DEGREE[t.source] ?? 0) + 1;
  DEGREE[t.target] = (DEGREE[t.target] ?? 0) + 1;
}

const radius = (id: string) => (id === 'drebbel' ? 18 : 5 + Math.sqrt(DEGREE[id] ?? 1) * 2.4);

const SHORT: Record<string, string> = {
  'Sophia Jansdr. Goltzius': 'Sophia Goltzius',
  'Johannes Sibertus Kuffler': 'J. S. Kuffler',
  'Gerrit Pietersz Schagen': 'Schagen',
  'Ysbrandt van Rietwyck': 'Van Rietwyck',
  'Henry, Prince of Wales': 'Prince Henry',
  'Duke of Buckingham': 'Buckingham',
  'Balthasar de Monconys': 'Monconys',
  'Johann Rudolf Glauber': 'Glauber',
  'Johann Moriaen': 'Moriaen',
  'William Camden': 'Camden',
  'John Selden': 'Selden',
  'Christopher Wren': 'Wren',
  'Robert Hooke': 'Hooke',
  'Federico Cesi': 'Cesi',
  'Giovanni Faber': 'Faber',
  'Gaspar Schott': 'Schott',
  'Marin Mersenne': 'Mersenne',
  'Pierre Borel': 'Borel',
  'Willem Boreel': 'Boreel',
  'Athanasius Kircher': 'Kircher',
  'John Wilkins': 'Wilkins',
  'Samuel Sorbière': 'Sorbière',
  'Samuel Hartlib': 'Hartlib',
  'Jonathan Goddard': 'Goddard',
};
const shortName = (n: string) => SHORT[n] ?? n;

function layout(): Record<string, Placed> {
  type N = SimulationNodeDatum & Person;
  const anchors: Record<string, [number, number]> = { self: [CX, CY] };
  GROUP_ORDER.forEach((g, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / GROUP_ORDER.length;
    anchors[g] = [CX + Math.cos(a) * 300, CY + Math.sin(a) * 270];
  });
  const nodes: N[] = PEOPLE.map((p) => ({ ...p }));
  const center = nodes.find((n) => n.id === 'drebbel')!;
  center.fx = CX;
  center.fy = CY;
  const links = TIES.map((t) => ({ source: t.source, target: t.target, center: t.source === 'drebbel' }));
  const sim = forceSimulation(nodes)
    .force(
      'link',
      forceLink<N, (typeof links)[number]>(links)
        .id((d) => d.id)
        .distance((l) => (l.center ? 190 : 60))
        .strength((l) => (l.center ? 0.12 : 0.35)),
    )
    .force('charge', forceManyBody().strength(-320))
    .force('x', forceX<N>((d) => anchors[d.group][0]).strength(0.4))
    .force('y', forceY<N>((d) => anchors[d.group][1]).strength(0.4))
    .force('collide', forceCollide<N>((d) => radius(d.id) + 22).iterations(3))
    .stop();
  for (let i = 0; i < 400; i++) sim.tick();
  const pad = 30;
  return Object.fromEntries(
    nodes.map((n) => [
      n.id,
      { ...n, x: Math.max(pad, Math.min(W - 130, n.x ?? CX)), y: Math.max(pad + 10, Math.min(H - pad, n.y ?? CY)) },
    ]),
  );
}

const DASH: Record<Evidence, string | undefined> = { doc: undefined, report: '6 3', weak: '1.5 3.5' };
const EV_LABEL: Record<Evidence, { text: string; cls: string }> = {
  doc: { text: 'Documented', cls: 'text-accent-sage-dark border-accent-sage-dark' },
  report: { text: 'Reported second-hand', cls: 'text-accent-gold-dark border-accent-gold-dark' },
  weak: { text: 'Unverified', cls: 'text-accent-rust border-accent-rust' },
};

function yearNote(y: number) {
  if (y >= LAST_YEAR) return 'Every tie, through the 1703 Huygens edition.';
  if (y < 1604) return 'Alkmaar and Haarlem: the engraver’s world.';
  if (y < 1610) return 'England: James I, Prince Henry, the perpetual motion at Eltham.';
  if (y < 1613) return 'Prague: Rudolf II, then prison under Matthias.';
  if (y < 1626) return 'London again: the submarine, the microscope, the Kufflers arrive.';
  if (y <= 1633) return 'War work for Charles I and Buckingham. Drebbel dies in London in 1633.';
  return 'After his death: the work travels through the Kufflers, Hartlib and the Royal Society.';
}

export default function DrebbelNetwork() {
  const pos = useMemo(layout, []);
  const [year, setYear] = useState(LAST_YEAR);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState('drebbel');
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const plateRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const play = () => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
      setPlaying(false);
      return;
    }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let y = year >= LAST_YEAR ? FIRST_YEAR : year;
    setYear(y);
    setPlaying(true);
    timer.current = setInterval(() => {
      y += 1;
      setYear(y);
      if (y >= LAST_YEAR && timer.current) {
        clearInterval(timer.current);
        timer.current = null;
        setPlaying(false);
      }
    }, reduce ? 20 : 110);
  };

  const shown = (p: Person) => p.id === 'drebbel' || (!hidden.has(p.group) && p.year <= year);
  const neighbours = useMemo(() => {
    const s = new Set([selected]);
    for (const t of TIES) {
      if (t.source === selected) s.add(t.target);
      if (t.target === selected) s.add(t.source);
    }
    return s;
  }, [selected]);
  const focus = selected !== 'drebbel';

  const person = byId[selected];
  const otherTies = TIES.filter(
    (t) => (t.source === selected || t.target === selected) && t.source !== 'drebbel' && t.target !== 'drebbel',
  ).map((t) => ({ other: t.source === selected ? t.target : t.source, label: t.label }));

  const choose = (id: string, scroll = false) => {
    setSelected(id);
    if (scroll) plateRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <figure className="not-prose my-10" aria-label="Network of Cornelis Drebbel’s associates">
      <div ref={plateRef} className="border border-border-light bg-white">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full h-auto" role="img" aria-label="Network centred on Cornelis Drebbel; select a name below the plate for details">
          <g>
            {TIES.map((t, i) => {
              const a = pos[t.source];
              const b = pos[t.target];
              if (!shown(a) || !shown(b) || t.year > year) return null;
              const center = t.source === 'drebbel';
              const dim = focus && t.source !== selected && t.target !== selected;
              return (
                <line
                  key={i}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={center ? GROUPS[b.group].color : '#6b6560'}
                  strokeWidth={center ? 1.6 : 1}
                  strokeOpacity={dim ? 0.07 : center ? 0.75 : 0.5}
                  strokeDasharray={DASH[t.ev]}
                />
              );
            })}
          </g>
          <g>
            {PEOPLE.map((p) => {
              const n = pos[p.id];
              if (!shown(p)) return null;
              const isCenter = p.id === 'drebbel';
              const r = radius(p.id);
              const dim = focus && !neighbours.has(p.id);
              return (
                <g
                  key={p.id}
                  transform={`translate(${n.x},${n.y})`}
                  opacity={dim ? 0.18 : 1}
                  tabIndex={0}
                  role="button"
                  aria-label={p.name}
                  aria-pressed={selected === p.id}
                  className="cursor-pointer focus:outline-none focus-visible:[&>circle]:stroke-accent-rust"
                  onClick={() => choose(p.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      choose(p.id);
                    }
                  }}
                >
                  <circle
                    r={r}
                    fill={GROUPS[p.group].color}
                    fillOpacity={p.group === 'unsupported' ? 0.55 : 1}
                    stroke={selected === p.id ? '#1a1612' : '#ffffff'}
                    strokeWidth={selected === p.id ? 2.5 : 1.5}
                  />
                  <text
                    x={isCenter ? 0 : r + 4}
                    y={isCenter ? -26 : 4}
                    textAnchor={isCenter ? 'middle' : 'start'}
                    fontSize={isCenter ? 24 : 13}
                    fill="#1a1612"
                    stroke="#ffffff"
                    strokeWidth={3}
                    strokeLinejoin="round"
                    paintOrder="stroke"
                    className={isCenter ? 'font-serif' : 'font-body'}
                    style={{ pointerEvents: 'none' }}
                  >
                    {isCenter ? 'Drebbel' : shortName(p.name)}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>

        <div className="border-t border-border-light px-4 py-3 space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <label htmlFor="drebbel-year" className="text-xs uppercase tracking-wider text-muted">
              Ties formed by
            </label>
            <span className="font-mono text-lg tabular-nums text-primary w-[4ch]">{year}</span>
            <input
              id="drebbel-year"
              type="range"
              min={FIRST_YEAR}
              max={LAST_YEAR}
              step={1}
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="flex-1 min-w-[160px] accent-[#9e4a3a]"
            />
            <button
              type="button"
              onClick={play}
              className="text-xs uppercase tracking-wider border border-border-medium px-3 py-1.5 text-primary hover:border-accent-rust hover:text-accent-rust"
            >
              {playing ? 'Pause' : 'Play'}
            </button>
          </div>
          <p className="text-sm italic text-muted font-body">{yearNote(year)}</p>
          <div className="flex flex-wrap gap-2">
            {GROUP_ORDER.map((g) => {
              const on = !hidden.has(g);
              return (
                <button
                  key={g}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setHidden((h) => {
                      const next = new Set(h);
                      if (next.has(g)) next.delete(g);
                      else next.add(g);
                      return next;
                    })
                  }
                  className={`inline-flex items-center gap-1.5 text-sm border border-border-light px-2 py-0.5 font-body text-primary ${on ? '' : 'opacity-40'}`}
                >
                  <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: GROUPS[g].color }} />
                  {GROUPS[g].label}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
            {(['doc', 'report', 'weak'] as Evidence[]).map((ev) => (
              <span key={ev} className="inline-flex items-center gap-1.5">
                <svg width="28" height="8" aria-hidden="true">
                  <line x1="0" y1="4" x2="28" y2="4" stroke="currentColor" strokeWidth="2" strokeDasharray={DASH[ev]} />
                </svg>
                {ev === 'doc' ? 'Documented (a letter, record or his own text)' : ev === 'report' ? 'Reported second-hand' : 'Unverified or not supported'}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="border border-t-0 border-border-light bg-cream px-5 py-5 space-y-3" aria-live="polite">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider" style={{ color: GROUPS[person.group].color }}>
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: GROUPS[person.group].color }} />
          {GROUPS[person.group].label}
        </div>
        <h3 className="font-serif text-2xl text-primary leading-tight">{person.name}</h3>
        <p className="font-mono text-sm text-muted">
          {[person.life, person.id !== 'drebbel' ? `tie from ${person.year}` : ''].filter(Boolean).join(' · ')}
        </p>
        <p className="font-body text-lg italic text-primary leading-snug">{person.tie}</p>
        {person.id !== 'drebbel' && (
          <span className={`inline-block text-[11px] uppercase tracking-wider border px-2 py-0.5 ${EV_LABEL[person.ev].cls}`}>
            {EV_LABEL[person.ev].text}
          </span>
        )}
        {person.evidence && <p className="font-body text-secondary leading-relaxed">{person.evidence}</p>}
        {person.links.length > 0 && (
          <ul className="space-y-1 text-sm">
            {person.links.map(([label, href]) => (
              <li key={href}>
                {href.startsWith('/') ? (
                  <Link href={href} className="text-accent-rust hover:underline">{label}</Link>
                ) : (
                  <a href={href} className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">{label}</a>
                )}
              </li>
            ))}
          </ul>
        )}
        {otherTies.length > 0 && (
          <p className="text-sm text-muted">
            Also linked to:{' '}
            {otherTies.map((t, i) => (
              <span key={t.other}>
                {i > 0 && ', '}
                <button type="button" onClick={() => choose(t.other)} className="text-accent-rust underline underline-offset-2">
                  {shortName(byId[t.other].name)}
                </button>{' '}
                ({t.label})
              </span>
            ))}
          </p>
        )}
        <p className="text-sm text-muted">
          {selected === 'drebbel' ? (
            `${PEOPLE.length - 1} people, ${TIES.length} ties. Click any name on the plate or in the list below.`
          ) : (
            <button type="button" onClick={() => choose('drebbel')} className="text-accent-rust underline underline-offset-2">
              Back to Drebbel
            </button>
          )}
        </p>
      </div>

      <div className="mt-6 columns-1 sm:columns-2 gap-8 text-sm">
        {GROUP_ORDER.map((g) => (
          <div key={g} className="break-inside-avoid mb-4">
            <p className="flex items-center gap-1.5 text-xs uppercase tracking-wider mb-1" style={{ color: GROUPS[g].color }}>
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: GROUPS[g].color }} />
              {GROUPS[g].label}
            </p>
            {PEOPLE.filter((p) => p.group === g)
              .sort((a, b) => a.year - b.year)
              .map((p) => (
                <button key={p.id} type="button" onClick={() => choose(p.id, true)} className="block text-left font-body text-primary hover:text-accent-rust py-px">
                  <span className="font-mono text-xs text-muted tabular-nums">{p.year}</span> {p.name}
                </button>
              ))}
          </div>
        ))}
      </div>
      <figcaption className="text-sm text-muted font-body mt-2">
        Sources: G. Tierie, <a href="http://www.drebbel.net/Tierie.pdf" className="text-accent-rust hover:underline">Cornelis Drebbel (1572–1633)</a>, Leiden 1932; the States General resolutions (REPUBLIC); Beeckman’s journal; Tymme 1612; Boyle 1660; Wilkins 1648. Book links open the passage in Source Library.
      </figcaption>
    </figure>
  );
}
