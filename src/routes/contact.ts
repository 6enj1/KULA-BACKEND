import { Router, Request, Response } from 'express';
import { sendEmail } from '../services/email';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  const { name, email, subject, message } = req.body;

  if (!name || !email || !subject || !message) {
    res.status(400).json({ success: false, error: 'All fields are required' });
    return;
  }

  // Basic email format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ success: false, error: 'Invalid email address' });
    return;
  }

  const subjectLabels: Record<string, string> = {
    partnership: 'Restaurant Partnership',
    support: 'Customer Support',
    press: 'Press Inquiry',
    other: 'Other',
  };

  const subjectLabel = subjectLabels[subject] || subject;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
      <div style="background: linear-gradient(135deg, #297D6B, #66D9A6); padding: 32px; text-align: center; border-radius: 0 0 24px 24px;">
        <h1 style="color: #ffffff; font-size: 24px; margin: 0; font-weight: 700;">New Contact Message</h1>
        <p style="color: rgba(255,255,255,0.85); font-size: 14px; margin: 8px 0 0;">${subjectLabel}</p>
      </div>

      <div style="padding: 32px;">
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px;">
          <tr>
            <td style="padding: 8px 0; color: #9ca3af; font-size: 13px; width: 80px; vertical-align: top;">From</td>
            <td style="padding: 8px 0; color: #1a1a1a; font-size: 15px;">${name}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #9ca3af; font-size: 13px; vertical-align: top;">Email</td>
            <td style="padding: 8px 0;"><a href="mailto:${email}" style="color: #297D6B; font-size: 15px;">${email}</a></td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #9ca3af; font-size: 13px; vertical-align: top;">Topic</td>
            <td style="padding: 8px 0; color: #1a1a1a; font-size: 15px;">${subjectLabel}</td>
          </tr>
        </table>

        <div style="background: #f8faf9; border: 1px solid #e8f0ed; border-radius: 12px; padding: 20px;">
          <p style="color: #6b7280; font-size: 12px; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 1px;">Message</p>
          <p style="color: #1a1a1a; font-size: 15px; line-height: 1.6; margin: 0; white-space: pre-wrap;">${message}</p>
        </div>

        <div style="margin-top: 24px; text-align: center;">
          <a href="mailto:${email}?subject=Re: ${subjectLabel}" style="display: inline-block; background: linear-gradient(135deg, #297D6B, #66D9A6); color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 10px; font-weight: 600; font-size: 14px;">
            Reply to ${name}
          </a>
        </div>
      </div>

      <div style="border-top: 1px solid #f0f0f0; padding: 20px 32px; text-align: center;">
        <p style="color: #9ca3af; font-size: 11px; margin: 0;">
          Sent from kulasave.co.za contact form
        </p>
      </div>
    </div>
  `;

  try {
    await sendEmail('hello@kulasave.co.za', `[KULA Contact] ${subjectLabel} — ${name}`, html, email);
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to send contact email:', error);
    res.status(500).json({ success: false, error: 'Failed to send message. Please try again.' });
  }
});

export default router;
