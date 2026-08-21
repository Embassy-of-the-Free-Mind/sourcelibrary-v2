import { Metadata } from 'next';
import SiteHeader from '@/components/layout/SiteHeader';

export const metadata: Metadata = {
  title: 'Privacy Policy - Source Library',
  description: 'Privacy policy for Source Library.',
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
      <SiteHeader variant="light" />
      <main className="max-w-2xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-medium mb-8" style={{ color: 'var(--text-primary)' }}>
          Privacy Policy
        </h1>
        <div className="prose-content space-y-6 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          <p><strong>Effective date:</strong> March 15, 2026</p>

          <p>
            Source Library is operated by the Embassy of the Free Mind, Amsterdam.
            We are committed to protecting your privacy.
          </p>

          <h2 className="text-lg font-medium mt-8 mb-3" style={{ color: 'var(--text-primary)' }}>Cookies and consent</h2>
          <p>
            We ask for your consent before setting any analytics cookies. If you decline,
            no third-party tracking scripts are loaded and no cookies are set. The site
            works identically either way.
          </p>
          <p>
            Your choice is stored in your browser&rsquo;s local storage (not a cookie) and
            can be changed at any time via the &ldquo;Cookie Settings&rdquo; link in the footer.
          </p>

          <h2 className="text-lg font-medium mt-8 mb-3" style={{ color: 'var(--text-primary)' }}>What we collect</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li><strong>Account information:</strong> Email address (required for registration). Name and profile image if you sign in with Google.</li>
            <li><strong>First-party analytics</strong> (always active): Pages visited, country (from IP), referrer domain, user agent. IP addresses are anonymized (last octet removed) before storage. Data is automatically deleted after 90 days.</li>
            <li><strong>Reading activity:</strong> Which books and pages you view, reading history. Used to personalize your experience.</li>
            <li><strong>Local storage:</strong> A visitor ID (<code>sl_visitor_id</code>) for image likes deduplication. This never leaves your browser.</li>
          </ul>

          <h2 className="text-lg font-medium mt-8 mb-3" style={{ color: 'var(--text-primary)' }}>What we don&rsquo;t do</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>We do not sell your data to third parties.</li>
            <li>We do not use your data for advertising.</li>
            <li>We do not share personal data with AI model providers.</li>
            <li>We do not store full IP addresses.</li>
          </ul>

          <h2 className="text-lg font-medium mt-8 mb-3" style={{ color: 'var(--text-primary)' }}>How we use your data</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>To provide and improve the Service.</li>
            <li>To send important updates about your account or the Service (rare — we don&rsquo;t spam).</li>
            <li>To generate aggregate statistics about library usage.</li>
          </ul>

          <h2 className="text-lg font-medium mt-8 mb-3" style={{ color: 'var(--text-primary)' }}>Third-party services</h2>
          <p>The following services are only loaded if you accept analytics cookies:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li><strong>Google Analytics:</strong> Usage statistics with IP anonymization enabled. Sets cookies to distinguish visitors. <a href="https://policies.google.com/privacy" className="underline" target="_blank" rel="noopener noreferrer">Google&rsquo;s privacy policy</a>.</li>
            <li><strong>Ahrefs Analytics:</strong> Aggregate traffic statistics. <a href="https://ahrefs.com/privacy" className="underline" target="_blank" rel="noopener noreferrer">Ahrefs&rsquo; privacy policy</a>.</li>
          </ul>
          <p className="mt-3">The following services are always active (no cookies):</p>
          <ul className="list-disc pl-5 space-y-2">
            <li><strong>Google OAuth:</strong> If you sign in with Google, we receive your name, email, and profile image. We do not access any other Google data.</li>
            <li><strong>Vercel:</strong> Hosting provider. <a href="https://vercel.com/legal/privacy-policy" className="underline" target="_blank" rel="noopener noreferrer">Vercel&rsquo;s privacy policy</a>.</li>
            <li><strong>MongoDB Atlas:</strong> Database hosting. Data stored in EU (Frankfurt).</li>
          </ul>

          <h2 className="text-lg font-medium mt-8 mb-3" style={{ color: 'var(--text-primary)' }}>Data retention</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>Analytics data (pageviews, events): automatically deleted after 90 days.</li>
            <li>Performance metrics: automatically deleted after 30 days.</li>
            <li>Account data: retained as long as your account is active.</li>
          </ul>
          <p>
            You can request deletion of your account and associated data at any time
            by contacting us.
          </p>

          <h2 className="text-lg font-medium mt-8 mb-3" style={{ color: 'var(--text-primary)' }}>Your rights</h2>
          <p>
            Under GDPR and similar regulations, you have the right to access, correct, or
            delete your personal data. Contact us to exercise these rights.
          </p>

          <h2 className="text-lg font-medium mt-8 mb-3" style={{ color: 'var(--text-primary)' }}>Contact</h2>
          <p>
            Privacy questions? Contact us at{' '}
            <a href="mailto:team@sourcelibrary.org" className="underline">team@sourcelibrary.org</a>.
          </p>
        </div>
      </main>
    </div>
  );
}
