import { Worker, Job } from "bullmq";
import { eq } from "drizzle-orm";
import { redisConnection } from "../../config/redis";
import { db } from "../../config/db";
import { notificationOutbox } from "../../db/schema";
import { logger } from "../../shared/logger";
import { DELIVERY_QUEUE_NAME, DeliveryBatchJobPayload } from "./delivery.queue";
import { NtfyChannel } from "./channels/ntfy.channel";
import { EmailChannel } from "./channels/email.channel";
import { TelegramChannel } from "./channels/telegram.channel";

const ntfyChannel = new NtfyChannel();
const emailChannel = new EmailChannel();
const telegramChannel = new TelegramChannel();

export function createDeliveryWorker(): Worker<DeliveryBatchJobPayload> {
  const worker = new Worker<DeliveryBatchJobPayload>(
    DELIVERY_QUEUE_NAME,
    async (job: Job<DeliveryBatchJobPayload>) => {
      const { contest, reminderType, channelType, targets } = job.data;
      let sentCount = 0;
      let skippedDuplicateCount = 0;
      let failedCount = 0;

      for (const target of targets) {
        const [outboxRecord] = await db
          .insert(notificationOutbox)
          .values({
            contestId: contest.id,
            userId: target.userId,
            channelType,
            reminderType,
            destination: target.destination,
            status: "PENDING",
          })
          .onConflictDoNothing()
          .returning();

        if (!outboxRecord) {
          skippedDuplicateCount++;
          continue;
        }

        try {
          if (channelType === "NTFY") {
            await ntfyChannel.sendAlert(
              target.destination,
              contest,
              reminderType,
            );
          } else if (channelType === "EMAIL") {
            await emailChannel.sendAlert(
              target.destination,
              contest,
              reminderType,
            );
          } else if (channelType === "TELEGRAM") {
            await telegramChannel.sendAlert(
              target.destination,
              contest,
              reminderType,
            );
          }

          await db
            .update(notificationOutbox)
            .set({
              status: "SENT",
              sentAt: new Date(),
            })
            .where(eq(notificationOutbox.id, outboxRecord.id));

          sentCount++;
        } catch (err) {
          failedCount++;
          const errorMessage = err instanceof Error ? err.message : String(err);

          await db
            .update(notificationOutbox)
            .set({
              status: "FAILED",
              errorMessage,
            })
            .where(eq(notificationOutbox.id, outboxRecord.id));

          logger.error(
            {
              err,
              userId: target.userId,
              channelType,
              contestName: contest.name,
            },
            "❌ Failed to deliver notification to target",
          );
        }
      }

      return { sentCount, skippedDuplicateCount, failedCount };
    },
    {
      connection: redisConnection,
      concurrency: 10,
      limiter: {
        max: 40,
        duration: 1000,
      },
    },
  );

  worker.on("completed", (job, stats) => {
    logger.info(
      {
        jobId: job.id,
        channel: job.data.channelType,
        contest: job.data.contest.name,
        stats,
      },
      "📬 Delivery batch completed",
    );
  });

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "❌ Delivery batch job failed");
  });

  return worker;
}
