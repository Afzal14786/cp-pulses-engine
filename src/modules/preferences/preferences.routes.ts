import { Router } from 'express';
import { PreferencesController } from './preferences.controller';

const router = Router();
const controller = new PreferencesController();

router.get('/users', (req, res, next) => controller.listUsers(req, res, next));
router.get('/:userId', (req, res, next) => controller.getProfile(req, res, next));
router.put('/:userId/platforms', (req, res, next) => controller.updatePlatform(req, res, next));
router.post('/:userId/channels', (req, res, next) => controller.upsertChannel(req, res, next));
router.post('/:userId/test-alert', (req, res, next) => controller.triggerTestAlert(req, res, next));

export default router;