import nodemailer from 'nodemailer';

const smtpPort = parseInt(process.env.SMTP_PORT || '465');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'cp73.domains.co.za',
  port: smtpPort,
  secure: smtpPort === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export async function sendEmail(to: string, subject: string, html: string, replyTo?: string) {
  await transporter.sendMail({
    from: process.env.SMTP_FROM || 'KULA <noreply@kulasave.co.za>',
    to,
    subject,
    html,
    ...(replyTo && { replyTo }),
  });
}

export async function sendInviteEmail(email: string, code: string, businessName: string) {
  const registrationLink = `https://dashboard.kulasave.co.za/dashboard/register?code=${code}`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
      <div style="background: linear-gradient(135deg, #297D6B, #66D9A6); padding: 40px 32px; text-align: center; border-radius: 0 0 24px 24px;">
        <h1 style="color: #ffffff; font-size: 28px; margin: 0; font-weight: 700; letter-spacing: -0.5px;">Welcome to KULA</h1>
        <p style="color: rgba(255,255,255,0.85); font-size: 16px; margin: 8px 0 0;">Your application has been approved!</p>
      </div>

      <div style="padding: 40px 32px;">
        <p style="color: #1a1a1a; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
          Hi there,
        </p>
        <p style="color: #4a4a4a; font-size: 16px; line-height: 1.6; margin: 0 0 24px;">
          Great news! Your partner application for <strong>${businessName}</strong> has been approved.
          You can now register your account and start listing surplus bags on KULA.
        </p>

        <div style="background: #f8faf9; border: 1px solid #e8f0ed; border-radius: 12px; padding: 24px; text-align: center; margin: 0 0 24px;">
          <p style="color: #6b7280; font-size: 13px; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 1px;">Your Invite Code</p>
          <p style="color: #297D6B; font-size: 28px; font-weight: 700; margin: 0; letter-spacing: 2px; font-family: monospace;">${code}</p>
        </div>

        <div style="text-align: center; margin: 32px 0;">
          <a href="${registrationLink}" style="display: inline-block; background: linear-gradient(135deg, #297D6B, #66D9A6); color: #ffffff; text-decoration: none; padding: 16px 40px; border-radius: 12px; font-weight: 600; font-size: 16px;">
            Complete Registration
          </a>
        </div>

        <p style="color: #9ca3af; font-size: 13px; line-height: 1.5; margin: 24px 0 0; text-align: center;">
          This invite code expires in 30 days. If the button doesn't work, copy and paste this link into your browser:<br/>
          <a href="${registrationLink}" style="color: #297D6B; word-break: break-all;">${registrationLink}</a>
        </p>
      </div>

      <div style="border-top: 1px solid #f0f0f0; padding: 24px 32px; text-align: center;">
        <p style="color: #9ca3af; font-size: 12px; margin: 0;">
          &copy; ${new Date().getFullYear()} KULA. Where nothing goes to waste, everyone eats well.
        </p>
      </div>
    </div>
  `;

  await sendEmail(email, 'Your KULA Partner Invite Code', html);
}
