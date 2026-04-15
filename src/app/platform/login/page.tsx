import { getSession } from '@/lib/auth-helpers';
import { redirect } from 'next/navigation';
import { PlatformSignIn } from './PlatformSignIn';

export default async function PlatformLoginPage() {
  const session = await getSession();
  if ((session?.user as any)?.role === 'superadmin') {
    redirect('/platform/dashboard');
  }

  return <PlatformSignIn />;
}
