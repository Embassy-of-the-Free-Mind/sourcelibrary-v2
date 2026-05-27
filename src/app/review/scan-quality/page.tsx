import type { Metadata } from 'next';
import ScanQualityReview from '@/components/review/ScanQualityReview';

export const metadata: Metadata = {
  title: 'Scan quality — Source Library',
  description: 'Help us classify how cleanly historical pages were digitized.',
};

export default function ScanQualityPage() {
  return <ScanQualityReview />;
}
