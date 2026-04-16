import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { TenantSignIn } from './TenantSignIn';

export default async function TenantLoginPage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant: slug } = await params;

  // Resolve tenant name and settings for display (tenantId already in headers from middleware)
  const h = await headers();
  const tenantId = h.get('x-tenant-id');
  if (!tenantId) notFound();

  const db = await getDb();
  const tenant = await db.collection('tenants').findOne({ id: tenantId });
  if (!tenant || tenant.status === 'deleted') notFound();

  // Already signed in → go to tenant home
  const session = await auth();
  if (session?.user) {
    redirect(`/${slug}/`);
  }

  return (
    <TenantSignIn
      tenantSlug={slug}
      tenantName={tenant.name as string}
      tenantId={tenantId}
      allowSignup={tenant.settings?.allowSignup ?? false}
      callbackUrl={`/${slug}/`}
    />
  );
}
