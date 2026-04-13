// Auth pages must never be cached (Cloudflare or Vercel ISR) to avoid
// hydration mismatches and stale CSRF tokens.
export const dynamic = 'force-dynamic';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
