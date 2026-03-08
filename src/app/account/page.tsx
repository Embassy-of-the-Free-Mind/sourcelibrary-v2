import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import AccountClient from './AccountClient';

export const metadata = {
  title: 'Account — Source Library',
};

export default async function AccountPage() {
  const session = await auth();
  if (!session?.user) {
    redirect('/auth/signin?callbackUrl=/account');
  }

  return (
    <AccountClient
      user={{
        name: session.user.name || null,
        email: session.user.email || null,
        image: session.user.image || null,
      }}
    />
  );
}
