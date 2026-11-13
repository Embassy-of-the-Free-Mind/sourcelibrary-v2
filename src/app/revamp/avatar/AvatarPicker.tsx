'use client';
/* eslint-disable @next/next/no-img-element */
import { useState } from 'react';

export default function AvatarPicker({ person, pics, current }: { person: string; pics: string[]; current: string | null }) {
  const [chosen, setChosen] = useState(current);
  const [saved, setSaved] = useState(false);
  const pick = async (src: string) => {
    setChosen(src); setSaved(false);
    const r = await fetch('/revamp/api/avatar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ person, src }) });
    setSaved(r.ok);
  };
  return (
    <>
      <div className="flex items-center gap-4 mb-8 h-20">
        {chosen ? <img src={chosen} alt="" className="w-20 h-20 object-cover border border-border-light" style={{ borderRadius: '50%' }} /> : <span className="w-20 h-20 bg-warm" style={{ borderRadius: '50%' }} />}
        <span className="text-[15px] text-primary">Curated by <b className="font-semibold">Symcyto</b>{saved && <span className="ml-3 text-muted">Saved</span>}</span>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-7 gap-3">
        {pics.map((src) => (
          <button key={src} type="button" onClick={() => pick(src)} className={`aspect-square overflow-hidden border-2 ${chosen === src ? 'border-primary' : 'border-transparent hover:border-border-medium'}`} style={{ borderRadius: '50%' }}>
            <img src={src} alt="" loading="lazy" className="w-full h-full object-cover" />
          </button>
        ))}
      </div>
    </>
  );
}
