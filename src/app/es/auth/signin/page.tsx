import type { Metadata } from 'next';
import SignInForm from '@/components/auth/SignInForm';
import { siteOgImage } from '@/lib/og-locale';

// Spanish twin of /auth/signin — the acquisition funnel reaches Instagram/
// webview users who have no browser-translate button (#2763).

const ES_SIGNIN_TITLE = 'Entrar — Source Library';
const ES_SIGNIN_DESCRIPTION =
  'Entra en Source Library para leer, citar y guardar miles de fuentes primarias históricas, con ediciones en español.';

// The page itself is Spanish; without this it inherited the layout's English
// title, description and share card, which is what a shared link previewed (#4162).
export const metadata: Metadata = {
  title: ES_SIGNIN_TITLE,
  description: ES_SIGNIN_DESCRIPTION,
  alternates: { canonical: '/es/auth/signin', languages: { en: '/auth/signin', es: '/es/auth/signin' } },
  openGraph: {
    title: ES_SIGNIN_TITLE,
    description: ES_SIGNIN_DESCRIPTION,
    siteName: 'Source Library',
    type: 'website',
    locale: 'es_ES',
    url: 'https://sourcelibrary.org/es/auth/signin',
    images: [siteOgImage('es')],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@SourceLibrary_',
    title: ES_SIGNIN_TITLE,
    description: ES_SIGNIN_DESCRIPTION,
    images: [siteOgImage('es')],
  },
};

export default function SignInPageEs() {
  return <SignInForm locale="es" />;
}
