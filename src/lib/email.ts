import nodemailer from 'nodemailer';

const DEFAULT_FROM = 'Source Library <noreply@sourcelibrary.org>';

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) return null;

  transporter = nodemailer.createTransport({
    host,
    port: 465,
    secure: true,
    auth: { user, pass },
  });

  return transporter;
}

export async function sendEmail(options: {
  to: string;
  subject: string;
  html: string;
  from?: string;
}): Promise<boolean> {
  const t = getTransporter();
  if (!t) {
    console.warn('[email] SMTP not configured (missing SMTP_HOST/SMTP_USER/SMTP_PASS)');
    return false;
  }

  try {
    await t.sendMail({
      from: options.from || DEFAULT_FROM,
      to: options.to,
      subject: options.subject,
      html: options.html,
    });
    return true;
  } catch (error) {
    console.error('[email] Send failed:', error);
    return false;
  }
}
