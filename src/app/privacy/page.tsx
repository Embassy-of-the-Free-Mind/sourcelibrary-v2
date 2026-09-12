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
          <p><strong>Effective date:</strong> September 1, 2026 (replaces the March 15, 2026 version)</p>

          <p>
            Source Library is operated by the Embassy of the Free Mind, Amsterdam.
            We are committed to protecting your privacy, and to describing what we
            actually do — this page is checked against our codebase, not aspirations.
          </p>

          <h2 className="text-lg font-medium mt-8 mb-3" style={{ color: 'var(--text-primary)' }}>Cookies and consent</h2>
          <p>
            Our analytics tools load for every visitor, but run in a <strong>cookieless
            mode</strong> until you accept: no identifier is stored in your browser, no
            analytics cookies are set, and no session recording takes place. If you
            click &ldquo;Accept,&rdquo; analytics cookies are enabled and a sample of visits may be
            session-recorded to help us improve the reading experience. If you decline,
            everything stays cookieless and recording stays off.
          </p>
          <p>
            Your choice is stored in your browser&rsquo;s local storage (not a cookie) and
            can be changed at any time via the &ldquo;Cookie Settings&rdquo; link in the footer.
          </p>

          <h2 className="text-lg font-medium mt-8 mb-3" style={{ color: 'var(--text-primary)' }}>What we collect</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li><strong>Account information:</strong> Email address (required for registration). Name and profile image if you sign in with Google.</li>
            <li><strong>First-party analytics</strong> (always active): Pages visited, country (from IP), referrer domain, user agent. IP addresses are anonymized (last octet removed) before storage.</li>
            <li><strong>Reading activity:</strong> Which books and pages you view. Used to personalize your experience; you can clear your reading history from your account.</li>
            <li><strong>Search queries:</strong> What you search for, with a truncated one-way hash of your IP and, if you are signed in, your account ID. Used to improve search.</li>
            <li><strong>Feedback and volunteering:</strong> If you use the feedback form, we store your message, the page it was sent from, your user agent, a truncated hash of your IP, and — only if you provide them — your name and email.</li>
            <li><strong>AI chat and &ldquo;ask&rdquo; features:</strong> The messages you type are processed to generate a response (see AI processing below); conversation threads in the Embassy chat are stored.</li>
            <li><strong>Anonymous visitor ID:</strong> A random ID stored in your browser identifies your likes and favorites while you are not signed in. It is sent with those actions, and if you later sign in it is used once to attach your existing favorites to your account.</li>
            <li><strong>Developer / dataset API:</strong> Requests made with an API key are logged (key, endpoint, records returned, anonymized IP) for rate limiting and EU AI Act compliance.</li>
          </ul>

          <h2 className="text-lg font-medium mt-8 mb-3" style={{ color: 'var(--text-primary)' }}>What we don&rsquo;t do</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>We do not sell your data to third parties.</li>
            <li>We do not use your data for advertising.</li>
            <li>We do not store full IP addresses. Analytics store an anonymized form (last octet removed); feedback and usage logs store a truncated one-way hash.</li>
            <li>We do not send your identity (name, email, account) to AI model providers.</li>
          </ul>

          <h2 className="text-lg font-medium mt-8 mb-3" style={{ color: 'var(--text-primary)' }}>AI processing</h2>
          <p>
            Text you type into AI features — search expansion, book chat, page
            &ldquo;ask,&rdquo; and the Embassy chat — is sent to Google&rsquo;s Gemini API together
            with the relevant book text to generate the response. Under Google&rsquo;s
            paid API terms this data is not used to train their models. Avoid
            putting personal information in these boxes; the text you type is the
            only thing about you these requests carry.
          </p>

          <h2 className="text-lg font-medium mt-8 mb-3" style={{ color: 'var(--text-primary)' }}>How we use your data</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>To provide and improve the Service.</li>
            <li>To send important updates about your account or the Service (rare — we don&rsquo;t spam).</li>
            <li>To generate aggregate statistics about library usage.</li>
            <li>To prevent abuse of our public forms and APIs.</li>
          </ul>

          <h2 className="text-lg font-medium mt-8 mb-3" style={{ color: 'var(--text-primary)' }}>Third-party services</h2>
          <p>Enabled only if you accept analytics cookies:</p>
          <ul className="list-disc pl-5 space-y-2">
            <li><strong>Google Analytics:</strong> Loads for all visitors in Google&rsquo;s Consent Mode with all storage denied; sets cookies only after you accept. IP anonymization is enabled. <a href="https://policies.google.com/privacy" className="underline" target="_blank" rel="noopener noreferrer">Google&rsquo;s privacy policy</a>.</li>
            <li><strong>PostHog</strong> (EU cloud, Frankfurt): Product analytics and session replay. Runs cookieless with recording off until you accept; after acceptance, a sample of visits may be recorded. <a href="https://posthog.com/privacy" className="underline" target="_blank" rel="noopener noreferrer">PostHog&rsquo;s privacy policy</a>.</li>
            <li><strong>Ahrefs Analytics:</strong> Aggregate traffic statistics; loads only after you accept. <a href="https://ahrefs.com/privacy" className="underline" target="_blank" rel="noopener noreferrer">Ahrefs&rsquo; privacy policy</a>.</li>
          </ul>
          <p className="mt-3">Always active (part of serving the site):</p>
          <ul className="list-disc pl-5 space-y-2">
            <li><strong>Cloudflare:</strong> Content delivery and security in front of the whole site. Cloudflare processes your IP address to serve requests and block abuse; we do not store it. <a href="https://www.cloudflare.com/privacypolicy/" className="underline" target="_blank" rel="noopener noreferrer">Cloudflare&rsquo;s privacy policy</a>.</li>
            <li><strong>Vercel:</strong> Hosting provider. <a href="https://vercel.com/legal/privacy-policy" className="underline" target="_blank" rel="noopener noreferrer">Vercel&rsquo;s privacy policy</a>.</li>
            <li><strong>Google OAuth:</strong> If you sign in with Google, we receive your name, email, and profile image. We do not access any other Google data.</li>
            <li><strong>Google Gemini:</strong> AI processing of text you submit to AI features (see above).</li>
            <li><strong>Resend:</strong> Delivers our emails; processes recipient addresses on our behalf. <a href="https://resend.com/legal/privacy-policy" className="underline" target="_blank" rel="noopener noreferrer">Resend&rsquo;s privacy policy</a>.</li>
            <li><strong>MongoDB Atlas:</strong> Database hosting. Data stored in the EU (Frankfurt).</li>
            <li><strong>Supabase and Cloudflare R2:</strong> Store library content — texts, translations, search indexes, page images — not personal data.</li>
          </ul>

          <h2 className="text-lg font-medium mt-8 mb-3" style={{ color: 'var(--text-primary)' }}>Data retention</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>Analytics and usage logs (already anonymized or hashed as described above): retained until periodically reviewed and pruned by a person. We deliberately do not run automated deletion jobs against our archives.</li>
            <li>Performance metrics: automatically deleted after 30 days.</li>
            <li>Feedback: retained until addressed, then periodically pruned.</li>
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
