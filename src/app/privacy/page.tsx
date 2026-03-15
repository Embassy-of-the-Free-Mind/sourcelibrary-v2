import { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Privacy Policy - Source Library',
  description: 'Privacy policy for Source Library.',
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
      <header className="border-b" style={{ background: 'var(--bg-white)', borderColor: 'var(--border-light)' }}>
        <div className="max-w-3xl mx-auto px-6 py-4">
          <Link href="/" className="text-sm hover:opacity-70 transition-opacity" style={{ color: 'var(--text-muted)' }}>
            &larr; Back to Source Library
          </Link>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-medium mb-8" style={{ color: 'var(--text-primary)' }}>
          Privacy Policy
        </h1>
        <div className="prose-content space-y-6 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          <p><strong>Effective date:</strong> March 15, 2026</p>

          <p>
            Source Library is operated by the Ancient Wisdom Trust in partnership with the
            Embassy of the Free Mind, Amsterdam. We are committed to protecting your privacy.
          </p>

          <h2 className="text-lg font-medium mt-8 mb-3" style={{ color: 'var(--text-primary)' }}>What we collect</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li><strong>Account information:</strong> Email address (required for registration). Name and profile image if you sign in with Google.</li>
            <li>
              <strong>Usage analytics (first-party only):</strong> Pages visited, anonymized IP address (last octet truncated),
              referrer domain, country, and user agent. No third-party analytics services are used.
              This data is retained for 90 days and then automatically deleted.
            </li>
            <li><strong>Reading activity:</strong> Which books and pages you view, bookshelf selections. Retained for 90 days.</li>
            <li><strong>Performance metrics:</strong> Page load times and related technical metrics. Retained for 30 days.</li>
          </ul>

          <h2 className="text-lg font-medium mt-8 mb-3" style={{ color: 'var(--text-primary)' }}>Cookies and local storage</h2>
          <p>
            Source Library does not set any cookies for analytics or tracking purposes.
            We use <code>localStorage</code> for a single item (<code>sl_visitor_id</code>) used
            solely to prevent duplicate &ldquo;like&rdquo; actions. This identifier never leaves your browser
            and is not used for cross-site tracking.
          </p>

          <h2 className="text-lg font-medium mt-8 mb-3" style={{ color: 'var(--text-primary)' }}>What we don&rsquo;t collect</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>We set no tracking cookies and use no third-party analytics.</li>
            <li>We do not sell your data to third parties.</li>
            <li>We do not use your data for advertising.</li>
            <li>We do not share personal data with AI model providers.</li>
            <li>We do not perform cross-site tracking of any kind.</li>
          </ul>

          <h2 className="text-lg font-medium mt-8 mb-3" style={{ color: 'var(--text-primary)' }}>How we use your data</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>To provide and improve the Service.</li>
            <li>To send important updates about your account or the Service (rare — we don&rsquo;t spam).</li>
            <li>To generate aggregate statistics about library usage.</li>
          </ul>

          <h2 className="text-lg font-medium mt-8 mb-3" style={{ color: 'var(--text-primary)' }}>Legal basis (GDPR)</h2>
          <p>
            We process anonymized analytics data under the <strong>legitimate interest</strong> basis
            (Article 6(1)(f) GDPR). Because IP addresses are truncated before storage,
            the data we retain does not constitute personal data under GDPR.
            Account data is processed on the basis of <strong>contractual necessity</strong>.
          </p>

          <h2 className="text-lg font-medium mt-8 mb-3" style={{ color: 'var(--text-primary)' }}>Third-party services</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li><strong>Google OAuth:</strong> If you sign in with Google, we receive your name, email, and profile image. We do not access any other Google data.</li>
            <li><strong>Vercel:</strong> Hosting provider. <a href="https://vercel.com/legal/privacy-policy" className="underline" target="_blank" rel="noopener noreferrer">Vercel&rsquo;s privacy policy</a>.</li>
            <li><strong>MongoDB Atlas:</strong> Database hosting. Data stored in EU (Frankfurt).</li>
          </ul>

          <h2 className="text-lg font-medium mt-8 mb-3" style={{ color: 'var(--text-primary)' }}>Data retention</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>Analytics pageviews and events: <strong>90 days</strong>, then automatically deleted.</li>
            <li>Performance metrics: <strong>30 days</strong>, then automatically deleted.</li>
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
            <a href="mailto:derek@ancientwisdomtrust.org" className="underline">derek@ancientwisdomtrust.org</a>.
          </p>
        </div>
      </main>
    </div>
  );
}
