'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ToneEngine, centsBetween } from './audio';
import { LabCard, PlayToggle, Readout, Chip } from './LabCard';

/**
 * Kepler's own table (Harmonices Mundi V.4, p. 325 of our copy): extreme
 * apparent daily motions seen from the Sun, and the harmony he assigned to
 * each planet. `e` is the modern (J2000) orbital eccentricity; conservation
 * of angular momentum makes the true aphelion:perihelion angular-velocity
 * ratio ((1+e)/(1-e))² — Kepler states the squaring himself on the facing
 * page ("the proportion of the apparent motions is the double of the
 * proportion of the eccentric").
 */
interface Planet {
  name: string;
  arcs: string; // Kepler's measured extremes, min′ sec″ per day
  ratio: [number, number];
  interval: string;
  e: number;
  base: number; // audible root for the siren, Hz
  period: number; // siren sweep period, s — slower for the slow planets
}

const PLANETS: Planet[] = [
  { name: 'Mercury', arcs: '164′0″ – 384′0″', ratio: [5, 12], interval: 'octave + minor third', e: 0.2056, base: 294, period: 1.6 },
  { name: 'Venus', arcs: '94′50″ – 97′37″', ratio: [24, 25], interval: 'diesis', e: 0.0068, base: 262, period: 2.2 },
  { name: 'Earth', arcs: '57′3″ – 61′18″', ratio: [15, 16], interval: 'semitone', e: 0.0167, base: 220, period: 2.8 },
  { name: 'Mars', arcs: '26′14″ – 38′1″', ratio: [2, 3], interval: 'perfect fifth', e: 0.0934, base: 175, period: 3.4 },
  { name: 'Jupiter', arcs: '4′30″ – 5′30″', ratio: [5, 6], interval: 'minor third', e: 0.0489, base: 110, period: 4.2 },
  { name: 'Saturn', arcs: '1′46″ – 2′15″', ratio: [4, 5], interval: 'major third', e: 0.0565, base: 82, period: 5.2 },
];

/**
 * The 1619 engraving of the planet-songs (p336 of our copy) — six labeled
 * staff segments. Tap regions are fractions of the plate, mapped by eye
 * against the scan; the plate IS the planet selector.
 */
const KEPLER_PLATE =
  'https://images.sourcelibrary.org/gallery/697d9ca2e930671f09614566/697df4e48b76422bc971e8e9-0.jpg?v=17811346857';

const PLATE_REGIONS: { idx: number; label: string; x: number; y: number; w: number; h: number }[] = [
  { idx: 5, label: 'Saturnus', x: 1, y: 10, w: 22, h: 42 },
  { idx: 4, label: 'Jupiter', x: 23, y: 10, w: 20, h: 42 },
  { idx: 3, label: 'Mars ferè', x: 43, y: 10, w: 23, h: 42 },
  { idx: 2, label: 'Terra', x: 66, y: 10, w: 33, h: 42 },
  { idx: 1, label: 'Venus', x: 1, y: 52, w: 17, h: 40 },
  { idx: 0, label: 'Mercurius', x: 18, y: 52, w: 45, h: 40 },
];

const modernRatio = (e: number) => Math.pow((1 + e) / (1 - e), 2);
const keplerCents = (p: Planet) => centsBetween(p.ratio[0], p.ratio[1]);
const modernCents = (p: Planet) => centsBetween(1, modernRatio(p.e));

function verdict(dev: number): string {
  if (dev < 8) return 'nearly exact';
  if (dev < 30) return 'off by about a comma';
  if (dev < 60) return 'off by a quarter tone';
  return 'off by more than a semitone';
}

/**
 * Station VII — Kepler's planet-songs, scored against modern orbits.
 *
 * Each planet "sings" a glissando between its slowest (aphelion) and
 * fastest (perihelion) apparent motion. Kepler heard the consonances in
 * his table of extremes; modern eccentricities let us check him planet by
 * planet — and his engraving is the control panel.
 */
export default function KeplerPlanetsDemo() {
  const [playing, setPlaying] = useState(false);
  const [choirOn, setChoirOn] = useState(false);
  const [sel, setSel] = useState(2); // Earth
  const [mode, setMode] = useState<'kepler' | 'modern'>('kepler');

  const engineRef = useRef<ToneEngine | null>(null);

  const p = PLANETS[sel];
  const kc = keplerCents(p);
  const mc = modernCents(p);
  const dev = Math.abs(kc - mc);
  const spanCents = mode === 'kepler' ? kc : mc;
  const fHigh = p.base * Math.pow(2, spanCents / 1200);

  useEffect(() => {
    const e = engineRef.current;
    if (!e || !playing || choirOn) return;
    e.setSiren('planet', p.base, fHigh, p.period, 0.5, 'sine');
  }, [playing, choirOn, p, fHigh]);

  // The full choir — six voices on six periods, never resolving.
  useEffect(() => {
    const e = engineRef.current;
    if (!e || !choirOn) return;
    for (const pl of PLANETS) {
      const span = mode === 'kepler' ? keplerCents(pl) : modernCents(pl);
      const high = pl.base * Math.pow(2, span / 1200);
      e.setSiren(`choir-${pl.name}`, pl.base, high, pl.period, 0.16, 'sine');
    }
  }, [choirOn, mode]);

  useEffect(() => () => { engineRef.current?.dispose(); }, []);

  const ensureEngine = () => {
    if (!engineRef.current) engineRef.current = new ToneEngine();
    engineRef.current.ensure();
  };

  const stopAll = () => {
    engineRef.current?.stopAllVoices();
    engineRef.current?.suspend();
    setPlaying(false);
    setChoirOn(false);
  };

  const toggle = () => {
    if (playing) { stopAll(); return; }
    if (choirOn) { engineRef.current?.stopAllVoices(); setChoirOn(false); }
    ensureEngine();
    setPlaying(true);
  };

  const toggleChoir = () => {
    if (choirOn) { stopAll(); return; }
    if (playing) { engineRef.current?.stopAllVoices(); setPlaying(false); }
    ensureEngine();
    setChoirOn(true);
  };

  const selectPlanet = (i: number) => {
    if (choirOn) { engineRef.current?.stopAllVoices(); setChoirOn(false); }
    setSel(i);
  };

  /**
   * Schematic staff in the plate's own idiom: his two noteheads (hollow),
   * the modern upper notehead (filled) displaced by his error, and — while
   * the siren plays — a dot sweeping the active span. All geometry is
   * precomputed as scalars (React Compiler hoists member access, #3166).
   */
  const CENT_PX = 0.045;
  const yLow = 88;
  const yKepler = yLow - kc * CENT_PX;
  const yModern = yLow - mc * CENT_PX;
  const yActive = mode === 'kepler' ? yKepler : yModern;
  const sweepDur = `${p.period}s`;
  const staffLineYs = [28, 43, 58, 73, 88];
  const soloPlaying = playing && !choirOn;

  return (
    <LabCard
      title="Station VII — The planets, auditioned"
      headerRight={<PlayToggle playing={playing} onClick={toggle} label="Hear the planet" />}
      caption="Tap a planet on Kepler's engraving and hear it swing between its slowest and fastest motion, as he notated — a continuous glissando, transposed into hearing range. Switch to the modern orbit to hear how far his harmony was from the measured sky."
      sourceHref="/book/the-harmony-of-the-world-kepler?page=325"
      sourceLabel="Kepler, Harmonices Mundi, Book V, ch. 4 (1619) — the table of extreme motions"
    >
      <div className="relative rounded overflow-hidden border border-border-light mb-3 bg-white">
        <img
          src={KEPLER_PLATE}
          alt="Kepler's engraving of the planet-songs: six staves labeled Saturnus, Jupiter, Mars, Terra, Venus and Mercurius, each notating that planet's range of motion"
          className="w-full h-auto"
          loading="lazy"
        />
        {PLATE_REGIONS.map((r) => (
          <button
            key={r.label}
            onClick={() => selectPlanet(r.idx)}
            className={`absolute rounded-sm transition-colors border ${
              sel === r.idx
                ? 'border-accent-rust bg-accent-rust/15'
                : 'border-transparent hover:bg-accent-rust/10 hover:border-accent-rust/40'
            }`}
            style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` }}
            aria-label={`Select ${PLANETS[r.idx].name} (engraved as ${r.label})`}
            aria-pressed={sel === r.idx}
          />
        ))}
      </div>
      <p className="text-xs text-muted mb-4">
        The engraving is the instrument panel — tap a stave. It is the very page carrying the{' '}
        <Link href="/book/the-harmony-of-the-world-kepler?page=336" className="text-accent-rust underline">
          MI FA MI margin note
        </Link>
        ; the corner entry marked ☽ reserves a seat for the Moon.
      </p>

      <div className="flex gap-1.5 mb-3 flex-wrap">
        {PLANETS.map((pl, i) => (
          <Chip key={pl.name} active={sel === i && !choirOn} onClick={() => selectPlanet(i)}>{pl.name}</Chip>
        ))}
      </div>
      <div className="flex gap-1.5 mb-4 flex-wrap items-center">
        <Chip active={mode === 'kepler'} onClick={() => setMode('kepler')}>Kepler&apos;s harmony</Chip>
        <Chip active={mode === 'modern'} onClick={() => setMode('modern')}>Modern orbit</Chip>
        <span className="grow" />
        <PlayToggle playing={choirOn} onClick={toggleChoir} label="Play all six" />
      </div>
      {choirOn && (
        <p className="text-xs text-muted mb-4">
          The whole choir at once — the polyphony Kepler says the heavens sing perpetually, each
          planet on its own period, never resolving.
        </p>
      )}

      <div className="grid grid-cols-3 gap-3 mb-4">
        <Readout label="Kepler assigned" value={`${p.ratio[0]}:${p.ratio[1]}`} note={`${p.interval} — ${Math.round(kc)} ¢`} />
        <Readout label="Modern orbit gives" value={`${Math.round(mc)} ¢`} note={`from e = ${p.e}`} />
        <Readout label="Kepler's error" value={`${dev.toFixed(1)} ¢`} note={verdict(dev)} />
      </div>

      <svg viewBox="0 0 320 118" className="w-full max-w-[400px] mx-auto block mb-4" role="img"
        aria-label={`Schematic staff: ${p.name}'s glissando spans ${Math.round(kc)} cents in Kepler's notation; the measured orbit gives ${Math.round(mc)} cents`}>
        {staffLineYs.map((y) => (
          <line key={y} x1="8" y1={y} x2="312" y2={y} stroke="#d6d3d1" strokeWidth="1" />
        ))}
        <ellipse cx="70" cy={yLow} rx="7" ry="5" fill="none" stroke="currentColor" strokeWidth="1.6" className="text-primary" />
        <ellipse cx="118" cy={yKepler} rx="7" ry="5" fill="none" stroke="currentColor" strokeWidth="1.6" className="text-primary" />
        <text x="94" y="110" textAnchor="middle" fontSize="9" className="fill-stone-500">as he engraved it</text>
        <ellipse cx="196" cy={yModern} rx="7" ry="5" fill="currentColor" className="text-accent-rust" opacity="0.85" />
        <line x1="196" y1={yKepler} x2="196" y2={yModern} stroke="currentColor" strokeWidth="0.75" strokeDasharray="2 2" className="text-accent-rust" opacity="0.6" />
        <text x="196" y="110" textAnchor="middle" fontSize="9" className="fill-stone-500">the measured sky</text>
        {soloPlaying && (
          <circle cx="272" cy={yLow} r="4.5" fill="currentColor" className="text-accent-rust">
            <animate attributeName="cy" values={`${yLow};${yActive};${yLow}`} dur={sweepDur} repeatCount="indefinite" />
          </circle>
        )}
        <text x="272" y="110" textAnchor="middle" fontSize="9" className="fill-stone-500">the glissando</text>
      </svg>

      <table className="w-full text-xs text-secondary">
        <thead>
          <tr className="text-muted uppercase tracking-wider text-[10px]">
            <th className="text-left py-1 font-medium">Planet</th>
            <th className="text-left py-1 font-medium">His 1619 extremes</th>
            <th className="text-left py-1 font-medium">His harmony</th>
            <th className="text-left py-1 font-medium">Modern</th>
            <th className="text-left py-1 font-medium">Error</th>
          </tr>
        </thead>
        <tbody>
          {PLANETS.map((pl, i) => {
            const k = keplerCents(pl);
            const m = modernCents(pl);
            return (
              <tr
                key={pl.name}
                className={`border-t border-border-light cursor-pointer ${sel === i ? 'bg-accent-rust/5' : 'hover:bg-stone-50'}`}
                onClick={() => selectPlanet(i)}
              >
                <td className="py-1">{pl.name}</td>
                <td className="py-1 font-mono">{pl.arcs}</td>
                <td className="py-1">{pl.ratio[0]}:{pl.ratio[1]} <span className="text-muted">({Math.round(k)} ¢)</span></td>
                <td className="py-1 font-mono">{Math.round(m)} ¢</td>
                <td className="py-1 font-mono">{Math.abs(k - m).toFixed(0)} ¢</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </LabCard>
  );
}
