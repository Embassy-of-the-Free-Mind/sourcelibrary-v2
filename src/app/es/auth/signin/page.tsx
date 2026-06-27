import SignInForm from '@/components/auth/SignInForm';

// Spanish twin of /auth/signin — the acquisition funnel reaches Instagram/
// webview users who have no browser-translate button (#2763).
export default function SignInPageEs() {
  return <SignInForm locale="es" />;
}
