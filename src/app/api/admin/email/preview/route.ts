import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/auth-helpers';
import { wrapInEmailShell } from '@/lib/email-templates';

export const POST = withAdminAuth(async (request: NextRequest) => {
  const body = await request.json();
  const { subject, html } = body;

  if (!subject || !html) {
    return NextResponse.json({ error: 'Subject and HTML are required' }, { status: 400 });
  }

  // If the HTML already contains a full document, return as-is
  // Otherwise wrap it in the email shell
  const isFullDoc = html.trim().startsWith('<!DOCTYPE') || html.trim().startsWith('<html');
  const rendered = isFullDoc ? html : wrapInEmailShell(subject, html);

  return NextResponse.json({ html: rendered });
});
