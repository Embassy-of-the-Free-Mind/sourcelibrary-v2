// Spanish edition of /auth/signin — the auth front door for Spanish-speaking
// (often Instagram/webview) visitors, who have no browser-translate affordance
// there (thin i18n, #2763). Shares the same client component as /auth/signin.
import SignInPage from '@/app/auth/signin/page';

// Auth pages must never be cached (Cloudflare or Vercel ISR) to avoid hydration
// mismatches and stale CSRF tokens — same as the English auth layout.
export const dynamic = 'force-dynamic';

export default function SignInPageEs() {
  return <SignInPage locale="es" />;
}
