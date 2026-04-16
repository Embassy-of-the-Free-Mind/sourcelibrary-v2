import { redirect } from 'next/navigation';

export default async function TenantRoot({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  redirect(`/${tenant}/search`);
}
