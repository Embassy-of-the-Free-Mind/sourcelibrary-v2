'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

const ConstellationCanvas = dynamic(() => import('./ConstellationCanvas'), { ssr: false });

export interface ConstellationPoint {
  id: string;   // book_id
  t: string;    // title
  a: string;    // author
  y: number | null; // year
  l: string;    // language
  q: number | null; // quality_score
  c: string[];  // collections
  x: number;    // UMAP x [-1, 1]
  z: number;    // UMAP y [-1, 1]
}

export default function ConstellationLoader() {
  const [data, setData] = useState<ConstellationPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/constellation-data.json')
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch(e => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <p className="text-stone-500">Failed to load constellation data: {error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-6 h-6 border-2 border-stone-300 border-t-stone-600 rounded-full animate-spin mb-3" />
          <p className="text-stone-500 text-sm">Loading 29,000 points...</p>
        </div>
      </div>
    );
  }

  return <ConstellationCanvas points={data} />;
}
