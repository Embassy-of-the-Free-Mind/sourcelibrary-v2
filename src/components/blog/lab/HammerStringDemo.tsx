'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ToneEngine, centsBetween } from './audio';
import { LabCard, PlayToggle, Readout, Chip } from './LabCard';

const BASE = 220;

/**
 * The hammer weights as Gaffurius printed them (Theorica Musicae, 1492, p46
 * of our copy): IIII, VI, VIII, VIIII, XII, XVI — six hammers, per the
 * page's own pairing table ("Ex xvi ad viij dupla proportione diapason
 * creabatur"; the OCR of p46 lists all six weights). The 9-pound hammer is
 * the fun one: 9:4 is a perfect square, so it is the ONE pair that still
 * sounds its promised interval (a fifth) under real sqrt-tension physics.
 */
const HAMMERS = [4, 6, 8, 9, 12, 16] as const;
const ROMAN: Record<number, string> = { 4: 'IIII', 6: 'VI', 8: 'VIII', 9: 'VIIII', 12: 'XII', 16: 'XVI' };

const GAFFURIUS_PLATE =
  'https://images.sourcelibrary.org/gallery/695688febe7c607c5f03c1da/69569e3b1479a63c110927ca-0.jpg?v=17805160105';

function intervalName(cents: number): string {
  const c = ((cents % 1200) + 1200) % 1200;
  const names: [number, string][] = [
    [0, 'unison / octave'], [204, 'whole tone'], [316, 'minor third'], [386, 'major third'],
    [498, 'fourth'], [600, 'tritone'], [702, 'fifth'], [814, 'minor sixth'],
    [884, 'major sixth'], [996, 'minor seventh'], [1088, 'major seventh'],
  ];
  let best = names[0];
  for (const n of names) if (Math.abs(n[0] - c) < Math.abs(best[0] - c)) best = n;
  return Math.abs(best[0] - c) <= 25 ? best[1] : 'no consonance';
}

/**
 * Station I — the smith's hammers, falsified.
 *
 * The legend (Boethius, pictured by Gaffurius) says consonance follows hammer
 * WEIGHT in simple ratios: double the weight, get the octave. Vincenzo Galilei
 * tested it (1581): frequency goes as the SQUARE ROOT of tension, so the
 * octave needs 4:1 — and the legend's 2:1 lands on a tritone. String LENGTH,
 * by contrast, really does behave as the legend claims.
 *
 * Two benches: the single-pair lab (sliders), and the whole smithy — all six
 * of Gaffurius's hammers at once, under the legend's law and under Galilei's.
 */
export default function HammerStringDemo() {
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState<'length' | 'weight'>('weight');
  const [length, setLength] = useState(1); // fraction of full string, 0.5–1
  const [weight, setWeight] = useState(1); // tension multiple, 1–5
  const [picked, setPicked] = useState<number[]>([]); // hammer weights, max 2

  // The whole smithy
  const [choirOn, setChoirOn] = useState(false);
  const [law, setLaw] = useState<'legend' | 'galilei'>('legend');

  const engineRef = useRef<ToneEngine | null>(null);

  const freq = mode === 'length' ? BASE / length : BASE * Math.sqrt(weight);
  const cents = Math.round(centsBetween(BASE, freq));
  const isOctave = Math.abs(cents - 1200) <= 6;
  const isTritone = Math.abs(cents - 600) <= 10;

  useEffect(() => {
    const e = engineRef.current;
    if (!e || !playing) return;
    e.setVoice('ref', BASE, 0.4, 'rich');
    e.setVoice('var', freq, 0.4, 'rich');
  }, [playing, freq]);

  // Five hammers at once. The legend's claim is that weight maps to pitch the
  // way length does — ratios straight through. Galilei's measurement: √.
  useEffect(() => {
    const e = engineRef.current;
    if (!e || !choirOn) return;
    for (const w of HAMMERS) {
      const ratio = law === 'legend' ? w / 4 : Math.sqrt(w / 4);
      e.setVoice(`smithy-${w}`, BASE * ratio, 0.22, 'rich');
    }
  }, [choirOn, law]);

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

  const togglePair = () => {
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

  const pickHammer = (w: number) => {
    const next = picked.includes(w)
      ? picked.filter((x) => x !== w)
      : [...picked.slice(-1), w];
    setPicked(next);
    if (next.length === 2) {
      const ratio = Math.max(next[0], next[1]) / Math.min(next[0], next[1]);
      setMode('weight');
      setWeight(Math.min(5, ratio));
      if (choirOn) { engineRef.current?.stopAllVoices(); setChoirOn(false); }
      ensureEngine();
      setPlaying(true);
    }
  };

  // Precomputed for JSX (React Compiler hoists member access above guards).
  const pickedLabel = picked.map((w) => ROMAN[w]).join(' : ');
  const pairRatio = picked.length === 2 ? Math.max(picked[0], picked[1]) / Math.min(picked[0], picked[1]) : null;
  const legendPromise = pairRatio === null ? '' : intervalName(1200 * Math.log2(pairRatio));
  const physicsDelivers = pairRatio === null ? '' : intervalName(1200 * Math.log2(Math.sqrt(pairRatio)));

  return (
    <LabCard
      title="Station I — Weigh the hammers"
      headerRight={<PlayToggle playing={playing} onClick={togglePair} label="Play both strings" />}
      caption="A fixed string sounds 220 Hz. Change the second one by shortening it, or by hanging weight on it — and watch which rule actually delivers the octave. The legend's 2:1 weight lands on the tritone."
      sourceHref="/book/dialogo-della-musica-antica-et-della-moderna-galilei"
      sourceLabel="Vincenzo Galilei, Dialogo (1581)"
    >
      <div className="flex gap-1.5 mb-4">
        <Chip active={mode === 'weight'} onClick={() => setMode('weight')}>Hang weights (tension)</Chip>
        <Chip active={mode === 'length'} onClick={() => setMode('length')}>Shorten the string</Chip>
      </div>

      {mode === 'weight' ? (
        <label className="block">
          <span className="flex items-baseline justify-between text-sm text-secondary mb-1">
            <span>Weight on the second string</span>
            <span className="font-mono text-primary">{weight.toFixed(2)}×</span>
          </span>
          <input
            type="range" min={1} max={5} step={0.01} value={weight}
            onChange={(e) => setWeight(Number(e.target.value))}
            className="w-full accent-[var(--accent-rust,#a8503c)]"
            aria-label="Tension multiple on the second string"
          />
        </label>
      ) : (
        <label className="block">
          <span className="flex items-baseline justify-between text-sm text-secondary mb-1">
            <span>Length of the second string</span>
            <span className="font-mono text-primary">{Math.round(length * 100)}%</span>
          </span>
          <input
            type="range" min={0.5} max={1} step={0.005} value={length}
            onChange={(e) => setLength(Number(e.target.value))}
            className="w-full accent-[var(--accent-rust,#a8503c)]"
            aria-label="Length of the second string as a fraction of the first"
          />
        </label>
      )}

      <div className="mt-4 grid grid-cols-3 gap-3">
        <Readout label="Second string" value={`${freq.toFixed(1)} Hz`} note="first stays 220.0 Hz" />
        <Readout label="Interval" value={`${cents} ¢`} note={isOctave ? '✓ OCTAVE' : isTritone ? 'tritone — the legend fails' : ' '} />
        <Readout
          label="The law"
          value={mode === 'weight' ? 'f ∝ √tension' : 'f ∝ 1 / length'}
          note={mode === 'weight' ? 'octave needs 4:1' : 'octave at 1/2 — as told'}
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        <Chip onClick={() => { setMode('weight'); setWeight(2); }}>The legend&apos;s claim: 2:1 weight</Chip>
        <Chip onClick={() => { setMode('weight'); setWeight(4); }}>Galilei&apos;s result: 4:1 weight</Chip>
        <Chip onClick={() => { setMode('length'); setLength(0.5); }}>Halve the string</Chip>
        <Chip onClick={() => { setMode('length'); setLength(2 / 3); }}>2/3 of the string (a fifth)</Chip>
      </div>

      <div className="mt-5 pt-4 border-t border-border-light">
        <p className="text-[11px] uppercase tracking-wider text-muted mb-2">
          The picture under test — press its numbers
        </p>
        <div className="md:flex md:gap-4">
          <Link
            href="/book/theorica-musicae-gaffurius?page=46"
            className="block md:w-56 shrink-0 rounded overflow-hidden border border-border-light hover:border-stone-300"
          >
            <img
              src={GAFFURIUS_PLATE}
              alt="Gaffurius's 1492 woodcut of the smithy legend: six men strike an anvil with hammers marked IIII, VI, VIII, VIIII, XII and XVI"
              className="w-full h-auto"
              loading="lazy"
            />
          </Link>
          <div className="mt-3 md:mt-0 min-w-0">
            <p className="text-xs text-secondary mb-2">
              Gaffurius&apos;s woodcut numbers six hammers — IIII, VI, VIII, VIIII, XII, XVI — and
              the page itself works through every pairing (an early reader re-inks them in the margins of{' '}
              <Link href="/book/theorica-musicae-gaffurius?page=46" className="text-accent-rust underline">our copy</Link>).
              Tap two hammers to hang exactly that weight ratio — and try VIIII : IIII, the one
              pair that keeps its promise even under the real law:
            </p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {HAMMERS.map((w) => (
                <Chip key={w} active={picked.includes(w)} onClick={() => pickHammer(w)}>{ROMAN[w]}</Chip>
              ))}
            </div>
            {pairRatio !== null && (
              <p className="text-xs text-muted mb-3">
                {pickedLabel} — the legend promises a {legendPromise}; the weights deliver a {physicsDelivers}.
              </p>
            )}
            <p className="text-xs text-secondary mb-2">
              And the legend&apos;s real claim is the whole smithy ringing in concord. Hear all six
              hammers under each law:
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <PlayToggle playing={choirOn} onClick={toggleChoir} label="Play the whole smithy" />
              <Chip active={law === 'legend'} onClick={() => setLaw('legend')}>As the legend tells it</Chip>
              <Chip active={law === 'galilei'} onClick={() => setLaw('galilei')}>As the weights actually pull</Chip>
            </div>
            <p className="text-xs text-muted mt-2">
              {law === 'legend'
                ? 'Ratios straight through: 4 : 6 : 8 : 9 : 12 : 16 rings as octaves, fifths, fourths and a tone — the miracle as told.'
                : 'Frequency follows √weight: the same numbers smear into a cluster nothing in music theory can name.'}
            </p>
          </div>
        </div>
      </div>
    </LabCard>
  );
}
