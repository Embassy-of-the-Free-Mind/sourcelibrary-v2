import { Metadata } from 'next';
import SiteHeader from '@/components/layout/SiteHeader';
import WelcomeForm from '@/components/welcome/WelcomeForm';
import WelcomeHero from '@/components/welcome/WelcomeHero';
import { getWelcomeHero } from '@/lib/welcome-hero';

export const metadata: Metadata = {
  title: 'Welcome preview — Source Library',
  robots: { index: false, follow: false },
};

// Temporary preview route — renders the welcome page UI without the auth gate,
// so the design can be reviewed regardless of account state. The form's POST will
// 401 since there is no session; that's expected for a UI-only preview.
export default async function WelcomePreviewPage() {
  const hero = await getWelcomeHero();

  return (
    <div className="min-h-screen bg-cream">
      <div className="absolute inset-x-0 top-0 z-10">
        <SiteHeader variant="dark" />
        <div className="max-w-3xl mx-auto px-6 mt-2">
          <span className="inline-block rounded-full bg-white/15 backdrop-blur-sm text-white px-3 py-1 text-xs font-medium uppercase tracking-wider border border-white/20">
            Preview only
          </span>
        </div>
      </div>
      <WelcomeHero firstName="Derek" hero={hero} />
      <div className="max-w-2xl mx-auto px-6 pb-16 -mt-6 md:-mt-10 relative">
        <WelcomeForm />
      </div>
    </div>
  );
}
