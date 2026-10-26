import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../../../config/env';
import { logger } from '../../../shared/logger';
import { DeliveryBatchJobPayload } from '../delivery.queue';

export class EmailChannel {
  private transporter: Transporter | null = null;

  constructor() {
    if (
      env.SMTP_HOST &&
      env.SMTP_USER &&
      env.SMTP_PASS &&
      env.SMTP_USER !== 'your-email@gmail.com'
    ) {
      this.transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_PORT === 465,
        auth: {
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
        },
      });
    } else {
      logger.warn(
        '⚠️ SMTP credentials not configured in .env (using placeholder). Email channel will log-only until configured.'
      );
    }
  }

  public async sendAlert(
    toEmail: string,
    contest: DeliveryBatchJobPayload['contest'],
    reminderType: DeliveryBatchJobPayload['reminderType']
  ): Promise<void> {
    const startTimeIst = new Date(contest.startTimeIso).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'full',
      timeStyle: 'short',
    });

    const durationMins = Math.round(contest.durationSeconds / 60);
    const badge = reminderType === '30M_BEFORE' ? '🚨 Starts in 30 Minutes' : '📅 Starts in 24 Hours';

    if (!this.transporter) {
      logger.info(
        { toEmail, contestName: contest.name, reminderType },
        '📧 [Simulated Email] SMTP not set; skipping network send'
      );
      return;
    }

    await this.transporter.sendMail({
      from: `"PulseCP Alerts" <${env.SMTP_USER}>`,
      to: toEmail,
      subject: `${badge}: [${contest.platform}] ${contest.name}`,
      html: `
        <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
          <h2 style="margin-top: 0; color: #111827;">${badge}</h2>
          <p style="font-size: 16px; color: #374151;">
            <strong>${contest.name}</strong> on <strong>${contest.platform}</strong> is coming up.
          </p>
          <ul style="line-height: 1.8; color: #4b5563;">
            <li><strong>Start Time (IST):</strong> ${startTimeIst}</li>
            <li><strong>Duration:</strong> ${durationMins} minutes</li>
          </ul>
          <a href="${contest.url}" style="display: inline-block; margin-top: 12px; padding: 10px 18px; background: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600;">
            Go to Contest Page →
          </a>
        </div>
      `,
    });

    logger.debug({ toEmail, contestName: contest.name }, '📧 Sent HTML reminder email');
  }
}