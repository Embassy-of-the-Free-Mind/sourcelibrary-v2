import type { Metadata } from 'next';
import CoverMakerPicker from './CoverMakerPicker';

export const metadata: Metadata = {
  title: 'Cover maker',
  description: 'Make a new cover for a book in the library from its own binding, title page and plates.',
  robots: { index: false, follow: false },
};

export default function CoverMakerPage() {
  return <CoverMakerPicker />;
}
