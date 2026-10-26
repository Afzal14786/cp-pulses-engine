import express, { Request, Response, NextFunction } from "express";
import path from 'path';
import { asc, gt } from "drizzle-orm";
import { ZodError } from "zod";
import { env } from "./config/env";
import { db, verifyDbConnection } from "./config/db";
import { contests } from "./db/schema";
import { contestTriggerQueue } from "./modules/scheduler/trigger.queue";
import { IngestionService } from "./modules/ingestion/ingestion.service";
import preferencesRoutes from "./modules/preferences/preferences.routes";
import { AppError } from "./shared/errors";
import { logger } from "./shared/logger";

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const ingestionService = new IngestionService();

app.get("/health", async (_req, res, next) => {
  try {
    const triggerCounts = await contestTriggerQueue.getJobCounts(
      "delayed",
      "active",
      "waiting",
    );
    res.json({
      status: "ok",
      uptimeSeconds: Math.floor(process.uptime()),
      redisTriggers: triggerCounts,
    });
  } catch (err) {
    next(err);
  }
});

app.get("/api/contests/upcoming", async (req, res, next) => {
  try {
    const platformFilter = req.query.platform as string | undefined;
    const rows = await db
      .select()
      .from(contests)
      .where(gt(contests.startTime, new Date()))
      .orderBy(asc(contests.startTime));

    const filtered = platformFilter
      ? rows.filter((c) => c.platform === platformFilter.toUpperCase())
      : rows;

    const formatted = filtered.map((c) => ({
      ...c,
      startTimeIst: c.startTime.toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        dateStyle: "full",
        timeStyle: "short",
      }),
    }));

    res.json({ count: formatted.length, contests: formatted });
  } catch (err) {
    next(err);
  }
});

app.post("/api/contests/sync", async (_req, res, next) => {
  try {
    const result = await ingestionService.syncAllPlatforms();
    res.json({ status: "synced", result });
  } catch (err) {
    next(err);
  }
});

// Mount User Preferences & Channels API
app.use("/api/preferences", preferencesRoutes);

// Global Error Handler
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Validation Error",
      details: err.flatten().fieldErrors,
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  logger.error({ err }, "Unhandled API error");
  res.status(500).json({ error: "Internal Server Error" });
});

async function startServer() {
  await verifyDbConnection();
  app.listen(env.PORT, () => {
    logger.info(
      `🌐 PulseCP API Server listening on http://localhost:${env.PORT}`,
    );
  });
}

startServer().catch((err) => {
  logger.fatal({ err }, "Failed to start API server");
  process.exit(1);
});
