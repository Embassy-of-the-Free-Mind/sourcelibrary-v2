import { Metadata } from 'next';
import SiteHeader from '@/components/layout/SiteHeader';
import WelcomeForm from '@/components/welcome/WelcomeForm';

export const metadata: Metadata = {
  title: 'Welcome preview — Source Library',
  robots: { index: false, follow: false },
};

// Temporary preview route — renders the welcome page UI without the auth gate,
// so the design can be reviewed regardless of account state. Form is live but
// the POST will 401 since there is no session; that's intentional for a UI preview.
export default function WelcomePreviewPage() {
  return (
    <div className="min-h-screen bg-cream">
      <SiteHeader variant="light" />
      <div className="max-w-2xl mx-auto px-6 py-12 md:py-16">
        <div className="mb-4 inline-block rounded-full bg-accent-gold/15 text-accent-rust px-3 py-1 text-xs font-medium uppercase tracking-wider">
          Preview only
        </div>
        <h1 className="font-serif text-3xl md:text-4xl text-primary mb-3">
          Welcome, Derek.
        </h1>
        <p className="text-secondary leading-relaxed mb-8 max-w-xl">
          Source Library is built in the open by readers. Two quick questions so we can point you at texts you&rsquo;ll care about &mdash; or skip and start browsing.
        </p>
        <WelcomeForm />
      </div>
    </div>
  );
}
