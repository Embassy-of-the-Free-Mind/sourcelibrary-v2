'use client';

import { useEffect, useRef } from 'react';

interface Props {
  threadId: string;
  format: string;
  audioUrl: string;
}

/**
 * Episode audio player with anonymous listen analytics.
 * Sends one event per pageview for: play, 25/50/75% (q1-q3), and complete (95% or ended).
 * No cookies, no PII — `vid` lives only in this component instance.
 */
export default function EpisodePlayer({ threadId, format, audioUrl }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const vidRef = useRef<string>('');
  const sentRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    vidRef.current = crypto.randomUUID();
  }, []);

  const send = (event: string) => {
    if (!vidRef.current || sentRef.current.has(event)) return;
    sentRef.current.add(event);
    const audio = audioRef.current;
    const payload = JSON.stringify({
      threadId,
      format,
      event,
      vid: vidRef.current,
      position: audio ? Math.round(audio.currentTime) : null,
      duration: audio && Number.isFinite(audio.duration) ? Math.round(audio.duration) : null,
    });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/podcast/events', payload);
      } else {
        fetch('/api/podcast/events', { method: 'POST', body: payload, keepalive: true });
      }
    } catch {
      // analytics must never break playback
    }
  };

  const onTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration === 0) return;
    const frac = audio.currentTime / audio.duration;
    if (frac >= 0.95) send('complete');
    else if (frac >= 0.75) send('q3');
    else if (frac >= 0.5) send('q2');
    else if (frac >= 0.25) send('q1');
  };

  return (
    <audio
      ref={audioRef}
      controls
      src={audioUrl}
      className="w-full mb-6"
      preload="metadata"
      onPlay={() => send('play')}
      onTimeUpdate={onTimeUpdate}
      onEnded={() => send('complete')}
    />
  );
}
