import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Feedback - Source Library',
  description: 'View feedback and suggestions from Source Library users.',
  alternates: {
    canonical: '/feedback',
  },
};

export default function FeedbackLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
