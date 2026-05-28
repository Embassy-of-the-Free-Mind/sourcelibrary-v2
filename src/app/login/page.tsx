import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/mongodb';
import { notFound } from 'next/navigation';
import { getTenantContext } from '@/lib/tenant-context';
import { TenantSignIn } from './TenantSignIn';

export default async function TenantLoginPage() {
  const ctx = await getTenantContext();
  if (!ctx?.id) notFound();

  const db = await getDb();
  const tenant = await db.collection('tenants').findOne({ id: ctx.id });
  if (!tenant || tenant.status === 'deleted') notFound();

  const slug = ctx.slug ?? (tenant.slug as string);
  const callbackUrl = ctx.source === 'subdomain' ? '/' : `/${slug}/`;

  const session = await auth();
  if (session?.user) {
    redirect(callbackUrl);
  }

  return (
    <TenantSignIn
      tenantSlug={slug}
      tenantName={tenant.name as string}
      tenantId={ctx.id}
      allowSignup={tenant.settings?.allowSignup ?? false}
      callbackUrl={callbackUrl}
    />
  );
}
