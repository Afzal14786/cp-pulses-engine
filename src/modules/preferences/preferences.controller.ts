import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { PreferencesService } from './preferences.service';

const preferencesService = new PreferencesService();

const updatePlatformSchema = z.object({
  platform: z.enum(['LEETCODE', 'CODEFORCES', 'CODECHEF', 'ATCODER']),
  remind24h: z.boolean(),
  remind30m: z.boolean(),
});

const updateChannelSchema = z.object({
  channelType: z.enum(['EMAIL', 'NTFY', 'TELEGRAM']),
  destination: z.string().min(1),
  isEnabled: z.boolean().default(true),
});

export class PreferencesController {
  public async listUsers(_req: Request, res: Response, next: NextFunction) {
    try {
      const usersList = await preferencesService.getAllUsers();
      res.json({ count: usersList.length, users: usersList });
    } catch (err) {
      next(err);
    }
  }

  public async getProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = z.string().uuid().parse(req.params.userId);
      const profile = await preferencesService.getUserProfile(userId);
      res.json(profile);
    } catch (err) {
      next(err);
    }
  }

  public async updatePlatform(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = z.string().uuid().parse(req.params.userId);
      const body = updatePlatformSchema.parse(req.body);
      const updated = await preferencesService.upsertPlatformPreference(
        userId,
        body.platform,
        body.remind24h,
        body.remind30m
      );
      res.json({ status: 'updated', preference: updated });
    } catch (err) {
      next(err);
    }
  }

  public async upsertChannel(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = z.string().uuid().parse(req.params.userId);
      const body = updateChannelSchema.parse(req.body);
      const channel = await preferencesService.upsertUserChannel(
        userId,
        body.channelType,
        body.destination,
        body.isEnabled
      );
      res.json({ status: 'updated', channel });
    } catch (err) {
      next(err);
    }
  }

  public async triggerTestAlert(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = z.string().uuid().parse(req.params.userId);
      const result = await preferencesService.sendInstantTestAlert(userId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }
}