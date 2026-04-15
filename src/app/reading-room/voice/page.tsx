import type { Metadata } from 'next';
import dynamic from 'next/dynamic';

const VoiceAgentClient = dynamic(() => import('./VoiceAgentClient'), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center">
      <p className="text-stone-400">Loading voice agent...</p>
    </div>
  ),
});

export const metadata: Metadata = {
  title: 'Voice Research — The Reading Room — Source Library',
  description: 'Have a voice conversation with the Librarian. Ask about alchemy, Hermetica, Kabbalah, and thousands of rare texts translated into English for the first time.',
};

export default function VoiceAgentPage() {
  return <VoiceAgentClient />;
}
