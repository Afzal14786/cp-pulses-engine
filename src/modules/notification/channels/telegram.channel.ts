import { logger } from '../../../shared/logger';
import { DeliveryBatchJobPayload } from '../delivery.queue';

export class TelegramChannel {
  private readonly botToken = process.env.TELEGRAM_BOT_TOKEN;

  public async sendAlert(
    chatId: string,
    contest: DeliveryBatchJobPayload['contest'],
    reminderType: DeliveryBatchJobPayload['reminderType']
  ): Promise<void> {
    if (!this.botToken) {
      logger.info(
        { chatId, contestName: contest.name },
        '🤖 [Simulated Telegram] TELEGRAM_BOT_TOKEN not set; skipping network send'
      );
      return;
    }

    const startTimeIst = new Date(contest.startTimeIso).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'short',
    });

    const durationHours = (contest.durationSeconds / 3600).toFixed(1);
    const header =
      reminderType === '30M_BEFORE'
        ? '🚨 *Starts in 30 Minutes!*'
        : '📅 *24-Hour Contest Reminder*';

    const text = [
      header,
      '',
      `*Platform:* ${contest.platform}`,
      `*Contest:* ${contest.name}`,
      `*Starts:* ${startTimeIst} IST`,
      `*Duration:* ${durationHours} hrs`,
      '',
      `[Open Contest Page](${contest.url})`,
    ].join('\n');

    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        disable_web_page_preview: false,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Telegram API error (${response.status}): ${errBody}`);
    }

    logger.debug({ chatId, contestName: contest.name }, '🤖 Sent Telegram alert');
  }
}