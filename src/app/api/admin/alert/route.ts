import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/auth-helpers';

export const maxDuration = 15;

/**
 * POST /api/admin/alert
 *
 * Transactional alert delivery for internal automation (scheduled health checks,
 * cron failures, etc.). Sends a single email via Resend to ALERT_RECIPIENT.
 *
 * Auth: same as other admin routes — session OR Bearer CRON_SECRET.
 * Body: { subject: string, body: string, severity?: 'info' | 'warning' | 'critical' }
 */
export const POST = withAdminAuth(async (request: NextRequest) => {
  const recipient = process.env.ALERT_RECIPIENT || 'derek@playpowerlabs.com';

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json(
      { error: 'RESEND_API_KEY not configured' },
      { status: 500 }
    );
  }

  let payload: { subject?: unknown; body?: unknown; severity?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const subject = typeof payload.subject === 'string' ? payload.subject.trim() : '';
  const body = typeof payload.body === 'string' ? payload.body : '';
  const severity =
    payload.severity === 'critical' || payload.severity === 'warning' || payload.severity === 'info'
      ? payload.severity
      : 'warning';

  if (!subject || !body) {
    return NextResponse.json(
      { error: 'subject and body are required' },
      { status: 400 }
    );
  }

  const tag = severity === 'critical' ? '[CRITICAL]' : severity === 'warning' ? '[WARN]' : '[INFO]';
  const finalSubject = `${tag} ${subject}`;

  try {
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    const result = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'Source Library Alerts <noreply@sourcelibrary.org>',
      to: recipient,
      subject: finalSubject,
      text: body,
    });

    if (result.error) {
      console.error('[admin/alert] Resend error:', result.error);
      return NextResponse.json(
        { dispatched: false, error: result.error.message },
        { status: 502 }
      );
    }

    return NextResponse.json({
      dispatched: true,
      message_id: result.data?.id,
      recipient,
      severity,
    });
  } catch (error) {
    console.error('[admin/alert] Send failed:', error);
    return NextResponse.json(
      { dispatched: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
});
