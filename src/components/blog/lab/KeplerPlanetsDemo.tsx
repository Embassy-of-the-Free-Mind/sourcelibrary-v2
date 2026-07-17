'use client';

import { useEffect, useRef, useState } from 'react';
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
 * planet.
 */
export default function KeplerPlanetsDemo() {
  const [playing, setPlaying] = useState(false);
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
    if (!e || !playing) return;
    e.setSiren('planet', p.base, fHigh, p.period, 0.5, 'sine');
  }, [playing, p, fHigh]);

  useEffect(() => () => { engineRef.current?.dispose(); }, []);

  const toggle = () => {
    if (playing) {
      engineRef.current?.stopAllVoices();
      engineRef.current?.suspend();
      setPlaying(false);
      return;
    }
    if (!engineRef.current) engineRef.current = new ToneEngine();
    engineRef.current.ensure();
    setPlaying(true);
  };

  return (
    <LabCard
      title="Station VII — The planets, auditioned"
      headerRight={<PlayToggle playing={playing} onClick={toggle} label="Hear the planet" />}
      caption="Pick a planet and hear it swing between its slowest and fastest motion, as Kepler notated — a continuous glissando, transposed into hearing range. Switch to the modern orbit to hear how far his harmony was from the measured sky."
      sourceHref="/book/the-harmony-of-the-world-kepler?page=325"
      sourceLabel="Kepler, Harmonices Mundi, Book V, ch. 4 (1619) — the table of extreme motions"
    >
      <div className="flex gap-1.5 mb-3 flex-wrap">
        {PLANETS.map((pl, i) => (
          <Chip key={pl.name} active={sel === i} onClick={() => setSel(i)}>{pl.name}</Chip>
        ))}
      </div>
      <div className="flex gap-1.5 mb-4">
        <Chip active={mode === 'kepler'} onClick={() => setMode('kepler')}>Kepler&apos;s harmony</Chip>
        <Chip active={mode === 'modern'} onClick={() => setMode('modern')}>Modern orbit</Chip>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <Readout label="Kepler assigned" value={`${p.ratio[0]}:${p.ratio[1]}`} note={`${p.interval} — ${Math.round(kc)} ¢`} />
        <Readout label="Modern orbit gives" value={`${Math.round(mc)} ¢`} note={`from e = ${p.e}`} />
        <Readout label="Kepler's error" value={`${dev.toFixed(1)} ¢`} note={verdict(dev)} />
      </div>

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
                onClick={() => setSel(i)}
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
