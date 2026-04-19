'use client';

import { useState } from 'react';

function formatTranscript(script: string): { speaker: string; text: string }[] {
  return script
    .split('\n')
    .filter(line => line.includes(':'))
    .map(line => {
      const colonIdx = line.indexOf(':');
      const speaker = line.slice(0, colonIdx).trim();
      const text = line.slice(colonIdx + 1).trim()
        .replace(/\[(laughs|whispers|enthusiasm|thoughtful|determination)\]/gi, '');
      return { speaker, text };
    })
    .filter(entry => entry.text.length > 0);
}

export default function TranscriptToggle({ script }: { script: string }) {
  const [open, setOpen] = useState(false);
  const entries = formatTranscript(script);

  if (entries.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen(!open)}
        className="text-[11px] text-[#9e4a3a] font-sans hover:underline"
      >
        {open ? 'Hide transcript' : 'Show transcript'}
      </button>
      {open && (
        <div className="mt-3 pt-3 border-t border-[#e0d9cc] space-y-2 max-h-[400px] overflow-y-auto">
          {entries.map((entry, i) => (
            <p key={i} className="text-[13px] font-body leading-relaxed text-[#333]">
              <span className="font-semibold text-[#1a1612]">{entry.speaker}:</span>{' '}
              {entry.text}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
