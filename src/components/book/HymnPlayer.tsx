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
// abcjs's own synth streams instrument samples from a third-party CDN at play
// time, which is both a broken promise (this player claims to be self-contained)
// and a silent-failure mode when that host is unreachable. Instead we take the
// parsed note sequence from setUpAudio() and schedule plain WebAudio oscillators
// — fully offline, and a plain unison tone suits unaccompanied Shaker singing.
interface AudioNoteEvent {
  cmd: string;
  pitch: number; // MIDI note number
  volume?: number; // 0–127
  start: number; // in whole notes
  duration: number; // in whole notes
}

export default function HymnPlayer({ transcriptions }: { transcriptions: MusicTranscription[] }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const abcjsRef = useRef<typeof import('abcjs') | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const endTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

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
          // Sing-along: lyrics big enough to read at arm's length
          format: { vocalfont: 'Georgia 16', gchordfont: 'Georgia 14' },
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
      if (endTimerRef.current) clearTimeout(endTimerRef.current);
      audioCtxRef.current?.close().catch(() => {});
      audioCtxRef.current = null;
    };
  }, [active, current?.abc]);

  if (!transcriptions.length) return null;

  const clearHighlights = () => {
    for (const t of highlightTimersRef.current) clearTimeout(t);
    highlightTimersRef.current = [];
    if (paperRef.current) {
      for (const el of paperRef.current.querySelectorAll('.hymn-now')) el.classList.remove('hymn-now');
    }
  };

  const stop = () => {
    if (endTimerRef.current) clearTimeout(endTimerRef.current);
    endTimerRef.current = null;
    clearHighlights();
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
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
      // Render into a detached element to get the parsed tune (the visible
      // panel may be closed); '*' would skip the layout pass setUpAudio needs.
      const holder = document.createElement('div');
      const tuneObj = abcjs.renderAbc(holder, current.abc, {})[0];
      const seq = (tuneObj as unknown as {
        setUpAudio: () => { tempo?: number; tracks?: AudioNoteEvent[][] };
      }).setUpAudio();
      const notes = (seq.tracks?.[0] ?? []).filter(e => e.cmd === 'note' && Number.isFinite(e.pitch));
      if (!notes.length) {
        setError('No notes to play.');
        return;
      }
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) {
        setError('Audio is not supported in this browser.');
        return;
      }
      const ctx = new Ctor();
      await ctx.resume();
      const wholeNoteSec = (4 * 60) / (seq.tempo || 92);
      // Longer lead-in when the panel has to open first, so the notation is
      // on screen before the first note sounds (and gets its highlight).
      const t0 = ctx.currentTime + (open ? 0.15 : 0.5);
      const master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      let endsAt = t0;
      for (const n of notes) {
        const freq = 440 * Math.pow(2, (n.pitch - 69) / 12);
        const start = t0 + n.start * wholeNoteSec;
        const dur = Math.max(0.09, n.duration * wholeNoteSec - 0.04);
        const osc = ctx.createOscillator();
        // Triangle wave: soft, breathy, close to an untrained unison voice.
        osc.type = 'triangle';
        osc.frequency.value = freq;
        const env = ctx.createGain();
        const peak = 0.85 * (typeof n.volume === 'number' ? Math.min(n.volume, 127) / 127 : 0.85);
        env.gain.setValueAtTime(0.0001, start);
        env.gain.linearRampToValueAtTime(peak, start + 0.02);
        env.gain.setValueAtTime(peak, Math.max(start + 0.02, start + dur - 0.05));
        env.gain.linearRampToValueAtTime(0.0001, start + dur);
        osc.connect(env);
        env.connect(master);
        osc.start(start);
        osc.stop(start + dur + 0.05);
        endsAt = Math.max(endsAt, start + dur);
      }
      audioCtxRef.current = ctx;
      setPlaying(true);
      // Sing-along follow: the notation panel opens automatically, and each
      // note + its lyric syllable lights up on the same clock the oscillators
      // were scheduled on. Index-matching works because these tunes are
      // monophonic: the k-th audio note is the k-th rendered .abcjs-note.
      if (!open) setOpen(true);
      const lead = (ctx.currentTime < t0 ? t0 - ctx.currentTime : 0) * 1000;
      notes.forEach((n, k) => {
        const at = lead + n.start * wholeNoteSec * 1000;
        highlightTimersRef.current.push(setTimeout(() => {
          const paper = paperRef.current;
          if (!paper) return;
          for (const el of paper.querySelectorAll('.hymn-now')) el.classList.remove('hymn-now');
          const noteEl = paper.querySelectorAll('.abcjs-note')[k];
          const lyricEl = paper.querySelectorAll('.abcjs-lyric')[k];
          noteEl?.classList.add('hymn-now');
          lyricEl?.classList.add('hymn-now');
          (noteEl as Element | undefined)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
        }, at));
      });
      endTimerRef.current = setTimeout(() => {
        if (audioCtxRef.current === ctx) {
          audioCtxRef.current = null;
          ctx.close().catch(() => {});
          clearHighlights();
          setPlaying(false);
        }
      }, (endsAt - ctx.currentTime) * 1000 + 300);
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
              <p className="font-serif text-base text-primary font-semibold">{current.title}</p>
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
              className="text-muted hover:text-primary transition-colors shrink-0"
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
                      ? 'border-primary text-primary'
                      : 'border-border-light text-muted hover:text-primary'
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
          className="flex items-center justify-center w-8 h-8 rounded-full bg-dark text-cream hover:opacity-85 transition-opacity"
        >
          {playing ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
        </button>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1.5 text-sm text-primary hover:opacity-75 transition-opacity"
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
