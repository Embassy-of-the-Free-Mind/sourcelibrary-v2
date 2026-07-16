'use client';

import { useEffect, useRef, useState } from 'react';
import { Music, Play, Square, X } from 'lucide-react';
import type { MusicTranscription } from '@/lib/music-transcriptions';

/**
 * Floating player for pages whose music has a transcription
 * (issue #3161 — hear the 1852 Shaker hymnal in the reader).
 *
 * Renders nothing unless transcriptions exist for the current page, so it is
 * inert on every other book. Notation rendering + synthesis are done entirely
 * client-side by abcjs (bundled, MIT) — no audio files, no external requests.
 * abcjs is loaded dynamically on first expand so readers who never open the
 * player pay no bundle cost.
 */
export default function HymnPlayer({ transcriptions }: { transcriptions: MusicTranscription[] }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const abcjsRef = useRef<typeof import('abcjs') | null>(null);
  const synthRef = useRef<{ stop: () => void } | null>(null);

  const current = transcriptions[active];

  // Render notation whenever the panel is open and the active tune changes
  useEffect(() => {
    if (!open || !current) return;
    let cancelled = false;
    (async () => {
      try {
        const abcjs = abcjsRef.current ?? (await import('abcjs'));
        abcjsRef.current = abcjs;
        if (cancelled || !paperRef.current) return;
        abcjs.renderAbc(paperRef.current, current.abc, {
          responsive: 'resize',
          add_classes: true,
        });
      } catch {
        if (!cancelled) setError('Notation could not be rendered.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, current]);

  // Stop audio when the tune changes or the component unmounts (page nav)
  useEffect(() => {
    return () => {
      synthRef.current?.stop();
      synthRef.current = null;
    };
  }, [active, current?.abc]);

  if (!transcriptions.length) return null;

  const stop = () => {
    synthRef.current?.stop();
    synthRef.current = null;
    setPlaying(false);
  };

  const play = async () => {
    if (playing) {
      stop();
      return;
    }
    setError(null);
    try {
      const abcjs = abcjsRef.current ?? (await import('abcjs'));
      abcjsRef.current = abcjs;
      if (!abcjs.synth.supportsAudio()) {
        setError('Audio is not supported in this browser.');
        return;
      }
      const tuneObj = abcjs.renderAbc('*', current.abc)[0];
      const synth = new abcjs.synth.CreateSynth();
      await synth.init({
        visualObj: tuneObj,
        options: {
          // Unaccompanied unison voice was Shaker practice — a plain timbre
          // is more faithful than anything produced. 73 = flute.
          program: 73,
        },
      });
      await synth.prime();
      synthRef.current = synth;
      setPlaying(true);
      synth.start();
      const ms = (synth as unknown as { duration?: number }).duration;
      if (typeof ms === 'number' && Number.isFinite(ms)) {
        setTimeout(() => setPlaying(p => (synthRef.current === synth ? false : p)), ms * 1000 + 250);
      }
    } catch {
      setError('Playback failed.');
      setPlaying(false);
    }
  };

  return (
    <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-40 max-w-[94vw]">
      {open && (
        <div className="mb-2 rounded-lg border border-border-light bg-cream shadow-xl p-4 w-[min(94vw,640px)] max-h-[50vh] overflow-y-auto">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div>
              <p className="font-serif text-base text-ink font-semibold">{current.title}</p>
              <p className="text-xs text-muted">
                {current.status === 'verified'
                  ? 'Transcribed from the original notation'
                  : 'Draft transcription — not yet verified against the scan'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close notation"
              className="text-muted hover:text-ink transition-colors shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div ref={paperRef} />
          {transcriptions.length > 1 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {transcriptions.map((t, i) => (
                <button
                  key={t.title + i}
                  type="button"
                  onClick={() => {
                    stop();
                    setActive(i);
                  }}
                  className={`text-xs px-2 py-1 rounded border transition-colors ${
                    i === active
                      ? 'border-ink text-ink'
                      : 'border-border-light text-muted hover:text-ink'
                  }`}
                >
                  {t.title}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 rounded-full border border-border-light bg-cream/95 backdrop-blur shadow-lg px-3 py-2">
        <button
          type="button"
          onClick={play}
          aria-label={playing ? 'Stop' : `Play ${current.title}`}
          className="flex items-center justify-center w-8 h-8 rounded-full bg-ink text-cream hover:opacity-85 transition-opacity"
        >
          {playing ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
        </button>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1.5 text-sm text-ink hover:opacity-75 transition-opacity"
          aria-expanded={open}
        >
          <Music className="w-4 h-4" />
          <span className="max-w-[40vw] truncate">{current.title}</span>
        </button>
        {error && <span className="text-xs text-[var(--status-error)]">{error}</span>}
      </div>
    </div>
  );
}
