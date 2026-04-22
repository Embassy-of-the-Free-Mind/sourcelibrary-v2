'use client';

import dynamic from 'next/dynamic';

const VoiceAgentClient = dynamic(() => import('./VoiceAgentClient'), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center">
      <p className="text-stone-400">Loading voice agent...</p>
    </div>
  ),
});

export default function VoiceAgentLoader() {
  return <VoiceAgentClient />;
}
