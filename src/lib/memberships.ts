import { Db } from 'mongodb';
import { Resend } from 'resend';

export type MembershipRole = 'superadmin' | 'admin' | 'editor' | 'reader';

export interface InviteMemberParams {
  db: Db;
  email: string;
  role: MembershipRole;
  tenantId: string | null; // null = platform-level
  tenantName: string;      // used in invite email
  invitedBy: string | null;
  loginUrl: string;
}

/**
 * Invite a member to a tenant or the platform.
 * Idempotent — re-inviting the same email updates the role and re-sends the email.
 * Works for both platform-level (tenantId: null) and tenant-scoped invites.
 */
export async function inviteMember({
  db,
  email,
  role,
  tenantId,
  tenantName,
  invitedBy,
  loginUrl,
}: InviteMemberParams): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim();

  await db.collection('memberships').updateOne(
    { email: normalizedEmail, tenantId },
    {
      $set: { role },
      $setOnInsert: {
        email: normalizedEmail,
        tenantId,
        userId: null,
        status: 'pending',
        invitedBy,
        addedAt: new Date(),
      },
    },
    { upsert: true }
  );

  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: process.env.EMAIL_FROM || 'Source Library <noreply@sourcelibrary.org>',
      to: normalizedEmail,
      subject: `You've been invited to ${tenantName}`,
      html: buildInviteEmail(tenantName, role, loginUrl),
    });
  }
}

/**
 * Activate a pending membership on first sign-in.
 * Called from the JWT callback when a user with a pending record signs in.
 */
export async function activatePendingMembership({
  db,
  email,
  tenantId,
  userId,
}: {
  db: Db;
  email: string;
  tenantId: string | null;
  userId: string;
}): Promise<void> {
  await db.collection('memberships').updateOne(
    { email: email.toLowerCase().trim(), tenantId, status: 'pending' },
    { $set: { status: 'active', userId, joinedAt: new Date() } }
  );
}

function buildInviteEmail(tenantName: string, role: string, loginUrl: string): string {
  return `
<div style="font-family: Georgia, 'Times New Roman', serif; max-width: 520px; margin: 0 auto; padding: 40px 24px; color: #1a1612;">
  <div style="text-align: center; margin-bottom: 32px;">
    <img src="https://sourcelibrary.org/brand/svg/icon-only--black-on-white.svg" alt="Source Library" width="48" height="48" style="margin-bottom: 16px;" />
    <h1 style="font-size: 24px; font-weight: 500; margin: 0 0 8px; letter-spacing: -0.01em;">You&rsquo;ve been invited</h1>
    <p style="color: #6b6560; font-size: 15px; line-height: 1.6; margin: 0;">
      You&rsquo;ve been invited as <strong>${role}</strong> of <strong>${tenantName}</strong> on Source Library.
      Sign in to accept your invitation.
    </p>
  </div>
  <div style="text-align: center; margin: 32px 0;">
    <a href="${loginUrl}" style="display: inline-block; padding: 14px 40px; background: #9e4a3a; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 16px; font-family: -apple-system, sans-serif;">
      Sign In to Accept
    </a>
  </div>
  <div style="border-top: 1px solid #e8e4dc; padding-top: 24px; text-align: center;">
    <p style="color: #8a8480; font-size: 12px; line-height: 1.6; margin: 0;">
      Source Library &mdash; Rare texts, translated and searchable.
      <br />
      <a href="https://sourcelibrary.org" style="color: #8a8480;">sourcelibrary.org</a>
    </p>
  </div>
</div>
`;
}
