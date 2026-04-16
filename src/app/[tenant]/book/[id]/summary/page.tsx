import { redirect } from 'next/navigation';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function SummaryRedirect({ params }: Props) {
  const { id } = await params;
  redirect(`/book/${id}/guide`);
}
