import { env } from '../../../config/env';
import { logger } from '../../../shared/logger';
import { DeliveryBatchJobPayload } from '../delivery.queue';

export class NtfyChannel {
  public async sendAlert(
    topic: string,
    contest: DeliveryBatchJobPayload['contest'],
    reminderType: DeliveryBatchJobPayload['reminderType']
  ): Promise<void> {
    const startTimeIst = new Date(contest.startTimeIso).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'short',
    });

    const durationHours = (contest.durationSeconds / 3600).toFixed(1);
    const isUrgent = reminderType === '30M_BEFORE';

    const title = isUrgent
      ? `[30m Left] ${contest.platform}: ${contest.name}`
      : `[24h Reminder] ${contest.platform}: ${contest.name}`;

    const message = [
      `📅 Starts: ${startTimeIst} IST`,
      `⏱️ Duration: ${durationHours} hrs`,
      `🔗 Link: ${contest.url}`,
    ].join('\n');

    const url = `${env.NTFY_BASE_URL.replace(/\/$/, '')}/${encodeURIComponent(topic)}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Title: title,
        Priority: isUrgent ? 'high' : 'default',
        Tags: isUrgent ? 'rotating_light,trophy' : 'calendar,computer',
        Actions: `view, Open Contest, ${contest.url}, clear=true`,
      },
      body: message,
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`ntfy.sh error (${response.status}): ${errBody}`);
    }

    logger.debug({ topic, contestName: contest.name }, '📱 Sent ntfy.sh phone notification');
  }
}