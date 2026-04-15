import type { Metadata } from 'next';
import VoiceAgentLoader from './VoiceAgentLoader';

export const metadata: Metadata = {
  title: 'Voice Research — The Reading Room — Source Library',
  description: 'Have a voice conversation with the Librarian. Ask about alchemy, Hermetica, Kabbalah, and thousands of rare texts translated into English for the first time.',
};

export default function VoiceAgentPage() {
  return <VoiceAgentLoader />;
}
